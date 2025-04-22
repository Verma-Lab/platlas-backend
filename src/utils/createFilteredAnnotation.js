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

// Function to get SNP_IDs in chunks
async function getSNPsFromDB(dbPath, tableName, sourceName) {
  const db = await open({
    filename: dbPath,
    driver: sqlite3.Database,
    mode: sqlite3.OPEN_READONLY
  });

  const snpSet = new Set();
  const batchSize = 10000; // Process 10,000 rows at a time
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const rows = await db.all(
      `SELECT DISTINCT SNP_ID FROM ${tableName} LIMIT ${batchSize} OFFSET ${offset}`
    );
    rows.forEach(row => snpSet.add(row.SNP_ID));
    console.log(`Fetched ${snpSet.size} SNPs from ${tableName} (offset: ${offset})`);
    offset += batchSize;
    if (rows.length < batchSize) hasMore = false;
  }

  console.log(`Found ${snpSet.size} unique SNPs in ${tableName} (${dbPath})`);
  await db.close();
  return { snpSet, sourceName };
}

// Function to combine SNP sources
function combineSNPSources(gwamaResult, mrmegaResult) {
  const allSNPs = new Map();
  for (const snp of gwamaResult.snpSet) {
    allSNPs.set(snp, gwamaResult.sourceName);
  }
  for (const snp of mrmegaResult.snpSet) {
    if (allSNPs.has(snp)) {
      allSNPs.set(snp, 'GWAMA,MR-MEGA');
    } else {
      allSNPs.set(snp, mrmegaResult.sourceName);
    }
  }
  return allSNPs;
}

// Main function to create filtered annotation file
async function createFilteredAnnotation() {
  try {
    // Step 1: Get SNP_IDs from both databases
    console.log('Fetching SNPs from GWAMA database...');
    const gwamaResult = await getSNPsFromDB(GWAMA_DB, 'phewas_snp_data', 'GWAMA');
    console.log('Fetching SNPs from MR-MEGA database...');
    const mrmegaResult = await getSNPsFromDB(MRMEGA_DB, 'phewas_snp_data_mrmega', 'MR-MEGA');

    // Step 2: Combine SNP sources
    const allSNPs = combineSNPSources(gwamaResult, mrmegaResult);
    console.log(`Total unique SNPs from both databases: ${allSNPs.size}`);

    // Step 3: Read and filter the annotation file
    console.log('Reading and filtering annotation file...');
    const inputStream = fs.createReadStream(SNP_ANNOTATION).pipe(createGunzip());
    const outputStream = fs.createWriteStream(OUTPUT_ANNOTATION);
    
    const rl = readline.createInterface({
      input: inputStream,
      crlfDelay: Infinity
    });

    let isFirstLine = true;
    let filteredCount = 0;

    for await (const line of rl) {
      if (isFirstLine) {
        // Write header with new SourceDB column
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
      if (allSNPs.has(snpId)) {
        // Append SourceDB column
        const sourceDB = allSNPs.get(snpId);
        outputStream.write(`${line}\t${sourceDB}\n`);
        filteredCount++;
      }
    }

    outputStream.end();
    console.log(`Filtered ${filteredCount} SNPs to ${OUTPUT_ANNOTATION}`);
    console.log('Done.');
  } catch (error) {
    console.error('Error creating filtered annotation:', error);
  }
}

// Run the script
createFilteredAnnotation();