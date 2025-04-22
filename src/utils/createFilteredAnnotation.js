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

// Function to create and populate temporary SQLite table
async function createTempTable() {
  const tempDB = await open({
    filename: ':memory:', // In-memory database
    driver: sqlite3.Database
  });

  // Create temporary table for annotation IDs
  await tempDB.exec(`
    CREATE TABLE temp_snp_ids (
      snp_id TEXT PRIMARY KEY
    )
  `);

  console.log('Reading annotation file to populate temp table...');
  const inputStream = fs.createReadStream(SNP_ANNOTATION).pipe(createGunzip());
  const rl = readline.createInterface({
    input: inputStream,
    crlfDelay: Infinity
  });

  let processedCount = 0;
  const batchSize = 10000;
  let batch = [];

  for await (const line of rl) {
    if (line.startsWith('#')) continue;

    const columns = line.split('\t');
    if (columns.length < 3) {
      console.warn(`Skipping malformed line: ${line}`);
      continue;
    }

    const snpId = columns[2]; // ID column
    batch.push([snpId]);
    processedCount++;

    if (batch.length >= batchSize) {
      await tempDB.run(
        `INSERT INTO temp_snp_ids (snp_id) VALUES ${batch.map(() => '(?)').join(', ')}`,
        batch.flat()
      );
      batch = [];
      console.log(`Inserted ${processedCount} SNP IDs into temp table`);
    }
  }

  // Insert remaining batch
  if (batch.length > 0) {
    await tempDB.run(
      `INSERT INTO temp_snp_ids (snp_id) VALUES ${batch.map(() => '(?)').join(', ')}`,
      batch.flat()
    );
    console.log(`Inserted ${processedCount} SNP IDs into temp table (final batch)`);
  }

  return tempDB;
}

// Function to get matching SNPs with source
async function getMatchingSNPs(tempDB) {
  console.log('Joining with GWAMA and MR-MEGA databases...');
  const gwamaDB = new sqlite3.Database(GWAMA_DB, sqlite3.OPEN_READONLY);
  const mrmegaDB = new sqlite3.Database(MRMEGA_DB, sqlite3.OPEN_READONLY);

  const snpSources = new Map();

  // Attach databases
  await tempDB.exec(`
    ATTACH DATABASE '${GWAMA_DB}' AS gwama;
    ATTACH DATABASE '${MRMEGA_DB}' AS mrmega;
  `);

  // Query to find matching SNPs
  const rows = await tempDB.all(`
    SELECT t.snp_id,
           CASE WHEN g.SNP_ID IS NOT NULL THEN 1 ELSE 0 END AS in_gwama,
           CASE WHEN m.SNP_ID IS NOT NULL THEN 1 ELSE 0 END AS in_mrmega
    FROM temp_snp_ids t
    LEFT JOIN gwama.phewas_snp_data g ON t.snp_id = g.SNP_ID
    LEFT JOIN mrmega.phewas_snp_data_mrmega m ON t.snp_id = m.SNP_ID
    WHERE g.SNP_ID IS NOT NULL OR m.SNP_ID IS NOT NULL
  `);

  rows.forEach(row => {
    let sourceDB = '';
    if (row.in_gwama && row.in_mrmega) {
      sourceDB = 'GWAMA,MR-MEGA';
    } else if (row.in_gwama) {
      sourceDB = 'GWAMA';
    } else if (row.in_mrmega) {
      sourceDB = 'MR-MEGA';
    }
    snpSources.set(row.snp_id, sourceDB);
  });

  console.log(`Found ${snpSources.size} matching SNPs`);
  gwamaDB.close();
  mrmegaDB.close();
  return snpSources;
}

// Main function to create filtered annotation file
async function createFilteredAnnotation() {
  try {
    // Step 1: Create and populate temp table
    const tempDB = await createTempTable();

    // Step 2: Get matching SNPs with sources
    const snpSources = await getMatchingSNPs(tempDB);

    // Step 3: Filter annotation file and write output
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

    for await (const line of rl) {
      if (isFirstLine) {
        outputStream.write(`${line}\tSourceDB\n`);
        isFirstLine = false;
        continue;
      }

      const columns = line.split('\t');
      if (columns.length < 3) {
        console.warn(`Skipping malformed line: ${line}`);
        continue;
      }

      const snpId = columns[2]; // ID column
      processedCount++;

      if (snpSources.has(snpId)) {
        const sourceDB = snpSources.get(snpId);
        outputStream.write(`${line}\t${sourceDB}\n`);
        filteredCount++;
      }

      if (processedCount % 10000 === 0) {
        console.log(`Processed ${processedCount} SNPs, filtered ${filteredCount}`);
      }
    }

    outputStream.end();
    console.log(`Processed ${processedCount} SNPs, filtered ${filteredCount} to ${OUTPUT_ANNOTATION}`);

    // Step 4: Clean up
    await tempDB.close();
    console.log('Done.');
  } catch (error) {
    console.error('Error creating filtered annotation:', error);
  }
}

// Run the script
createFilteredAnnotation();