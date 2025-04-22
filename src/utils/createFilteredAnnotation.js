import fs from 'fs';
import readline from 'readline';
import { createGunzip } from 'zlib';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

// Database and file paths (from constants.js)
const MRMEGA_DB = '/nfs/platlas_stor/db/genomics-backend/phewas_mrmega.db';
const SNP_ANNOTATION = '/home/ac.guptahr/platlas-backend/DATABASE/gwPheWAS_All.annotation.txt.gz';
const OUTPUT_ANNOTATION = '/home/ac.guptahr/platlas-backend/DATABASE/filtered_SNP_annotation.txt';

// Table name
const MRMEGA_TABLE = 'phewas_snp_data_mrmega';

// Function to initialize database connection and prepared statement
async function initializeDB() {
  const mrmegaDB = await open({
    filename: MRMEGA_DB,
    driver: sqlite3.Database,
    mode: sqlite3.OPEN_READONLY
  });

  // Prepare statement for querying SNP_ID
  // Query: SELECT 1 FROM phewas_snp_data_mrmega WHERE SNP_ID = ? LIMIT 1
  const mrmegaStmt = await mrmegaDB.prepare(`SELECT 1 FROM ${MRMEGA_TABLE} WHERE SNP_ID = ? LIMIT 1`);

  return { mrmegaDB, mrmegaStmt };
}

// Function to close database connection and statement
async function closeDB({ mrmegaDB, mrmegaStmt }) {
  await mrmegaStmt.finalize();
  await mrmegaDB.close();
}

// Main function to create filtered annotation file
async function createFilteredAnnotation() {
  try {
    // Step 1: Initialize database
    console.log('Initializing database connection to MR-MEGA...');
    const db = await initializeDB();

    // Step 2: Stream and filter annotation file
    console.log('Filtering annotation file...');
    const inputStream = fs.createReadStream(SNP_ANNOTATION).pipe(createGunzip());
    const outputStream = fs.createWriteStream(OUTPUT_ANNOTATION);
    
    const rl = readline.createInterface({
      input: inputStream,
      crlfDelay: Infinity
    });

    let isFirstLine = true;
    let processedCount = 0;
    let filteredCount = 0;
    const seenIds = new Set(); // Track unique IDs

    for await (const line of rl) {
      if (isFirstLine) {
        outputStream.write(`${line}\tSourceDB\n`);
        isFirstLine = false;
        continue;
      }

      const columns = line.split('\t');
      if (columns.length < 3) {
        processedCount++;
        if (processedCount % 100 === 0) {
          console.log(`Processed row ${processedCount}: Malformed line, Skipped`);
        }
        continue;
      }

      const snpId = columns[2]; // ID column
      processedCount++;

      // Skip if ID has been processed
      if (seenIds.has(snpId)) {
        if (processedCount % 100 === 0) {
          console.log(`Processed row ${processedCount}: ID=${snpId}, Skipped (duplicate)`);
        }
        continue;
      }
      seenIds.add(snpId);

      // Query MR-MEGA database
      // Executes: SELECT 1 FROM phewas_snp_data_mrmega WHERE SNP_ID = snpId LIMIT 1
      const mrmegaExists = await db.mrmegaStmt.get(snpId);

      if (mrmegaExists) {
        outputStream.write(`${line}\tMR-MEGA\n`);
        filteredCount++;
        console.log(`Processed row ${processedCount}: ID=${snpId}, Included=true, SourceDB=MR-MEGA`);
      } else if (processedCount % 100 === 0) {
        console.log(`Processed row ${processedCount}: ID=${snpId}, Included=false`);
      }
    }

    outputStream.end();
    console.log(`Processed ${processedCount} rows, filtered ${filteredCount} unique SNPs to ${OUTPUT_ANNOTATION}`);
    
    // Step 3: Clean up
    await closeDB(db);
    console.log('Done.');
  } catch (error) {
    console.error('Error creating filtered annotation:', error);
    // Ensure database is closed on error
    await closeDB(db);
  }
}

// Run the script
createFilteredAnnotation();