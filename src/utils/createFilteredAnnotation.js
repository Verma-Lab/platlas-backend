import fs from 'fs';
import readline from 'readline';
import { createGunzip } from 'zlib';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

// Database paths
const GWAMA_DB = '/nfs/platlas_stor/db/genomics-backend/phewas_gwama.db';
const MRMEGA_DB = '/nfs/platlas_stor/db/genomics-backend/phewas_mrmega.db';
const SNP_ANNOTATION = '/home/ac.guptahr/platlas-backend/DATABASE/gwPheWAS_All.annotation.txt.gz';
const OUTPUT_ANNOTATION = '/home/ac.guptahr/platlas-backend/DATABASE/filtered_SNP_annotation.txt';

// Function to get SNP_IDs and their source database
async function getSNPsFromDB(dbPath, tableName, sourceName) {
  const db = await open({
    filename: dbPath,
    driver: sqlite3.Database,
    mode: sqlite3.OPEN_READONLY
  });

  const snpMap = new Map();
  const rows = await db.all(`SELECT DISTINCT SNP_ID FROM ${tableName}`);
  rows.forEach(row => snpMap.set(row.SNP_ID, sourceName));
  console.log(`Found ${snpMap.size} unique SNPs in ${tableName} (${dbPath})`);

  await db.close();
  return snpMap;
}

// Function to combine SNP sources
function combineSNPSources(gwamaSNPs, mrmegaSNPs) {
  const allSNPs = new Map();
  for (const [snp, source] of gwamaSNPs) {
    allSNPs.set(snp, source);
  }
  for (const [snp, source] of mrmegaSNPs) {
    if (allSNPs.has(snp)) {
      allSNPs.set(snp, 'GWAMA,MR-MEGA');
    } else {
      allSNPs.set(snp, source);
    }
  }
  return allSNPs;
}

// Main function to create filtered annotation file
async function createFilteredAnnotation() {
  try {
    // Step 1: Get SNP_IDs from both databases
    console.log('Fetching SNPs from GWAMA database...');
    const gwamaSNPs = await getSNPsFromDB(GWAMA_DB, 'phewas_snp_data', 'GWAMA');
    console.log('Fetching SNPs from MR-MEGA database...');
    const mrmegaSNPs = await getSNPsFromDB(MRMEGA_DB, 'phewas_snp_data_mrmega', 'MR-MEGA');

    // Step 2: Combine SNP sources
    const allSNPs = combineSNPSources(gwamaSNPs, mrmegaSNPs);
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
      if (columns.length < 4) {
        console.warn(`Skipping malformed line: ${line}`);
        continue;
      }

      // Location column is at index 3 (0-based)
      const location = columns[3];
      if (allSNPs.has(location)) {
        // Append SourceDB column
        const sourceDB = allSNPs.get(location);
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