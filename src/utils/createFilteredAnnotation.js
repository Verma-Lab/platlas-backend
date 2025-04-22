import fs from 'fs';
import readline from 'readline';
import { createGunzip } from 'zlib';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

// Database and file paths
const GWAMA_DB = '/nfs/platlas_stor/db/genomics-backend/phewas_gwama.db';
const MRMEGA_DB = '/nfs/platlas_stor/db/genomics-backend/phewas_mrmega.db';
const SNP_ANNOTATION = '/home/ac.guptahr/platlas-backend/DATABASE/gwPheWAS_All.annotation.txt.gz';
const OUTPUT_ANNOTATION = '/home/ac.guptahr/platlas-backend/DATABASE/filtered_SNP_annotation.txt';

// Function to initialize database connections and prepared statements
async function initializeDB() {
  const gwamaDB = await open({
    filename: GWAMA_DB,
    driver: sqlite3.Database,
    mode: sqlite3.OPEN_READONLY
  });
  const mrmegaDB = await open({
    filename: MRMEGA_DB,
    driver: sqlite3.Database,
    mode: sqlite3.OPEN_READONLY
  });

  // Prepare statements for faster queries
  const gwamaStmt = await gwamaDB.prepare('SELECT 1 FROM phewas_snp_data WHERE SNP_ID = ? LIMIT 1');
  const mrmegaStmt = await mrmegaDB.prepare('SELECT 1 FROM phewas_snp_data_mrmega WHERE SNP_ID = ? LIMIT 1');

  return { gwamaDB, mrmegaDB, gwamaStmt, mrmegaStmt };
}

// Function to close database connections and statements
async function closeDB({ gwamaDB, mrmegaDB, gwamaStmt, mrmegaStmt }) {
  await gwamaStmt.finalize();
  await mrmegaStmt.finalize();
  await gwamaDB.close();
  await mrmegaDB.close();
}

// Main function to create filtered annotation file
async function createFilteredAnnotation() {
  try {
    // Step 1: Initialize databases
    console.log('Initializing database connections...');
    const db = await initializeDB();

    // Step 2: Read and filter the annotation file
    console.log('Reading and filtering annotation file...');
    const inputStream = fs.createReadStream(SNP_ANNOTATION).pipe(createGunzip());
    const outputStream = fs.createWriteStream(OUTPUT_ANNOTATION);
    
    const rl = readline.createInterface({
      input: inputStream,
      crlfDelay: Infinity
    });

    let isFirstLine = true;
    let processedCount = 0;
    let filteredCount = 0;

    for await (const line of rl) {
      if (isFirstLine) {
        // Write header with SourceDB column
        outputStream.write(`${line}\tSourceDB\n`);
        isFirstLine = false;
        continue;
      }

      // Split tab-delimited line
      const columns = line.split('\t');
      if (columns.length < 3) {
        console.warn(`Skipping malformed line: ${line}`);
        continue;
      }

      // ID column is at index 2 (0-based)
      const snpId = columns[2];
      processedCount++;

      // Query both databases
      const gwamaExists = await db.gwamaStmt.get(snpId);
      const mrmegaExists = await db.mrmegaStmt.get(snpId);

      let sourceDB = '';
      if (gwamaExists && mrmegaExists) {
        sourceDB = 'GWAMA,MR-MEGA';
      } else if (gwamaExists) {
        sourceDB = 'GWAMA';
      } else if (mrmegaExists) {
        sourceDB = 'MR-MEGA';
      }

      if (sourceDB) {
        outputStream.write(`${line}\t${sourceDB}\n`);
        filteredCount++;
      }

      // Log progress every 100,000 rows
      if (processedCount % 100000 === 0) {
        console.log(`Processed ${processedCount} SNPs, filtered ${filteredCount}`);
      }
    }

    outputStream.end();
    console.log(`Processed ${processedCount} SNPs, filtered ${filteredCount} to ${OUTPUT_ANNOTATION}`);
    
    // Step 3: Clean up
    await closeDB(db);
    console.log('Done.');
  } catch (error) {
    console.error('Error creating filtered annotation:', error);
  }
}

// Run the script
createFilteredAnnotation();