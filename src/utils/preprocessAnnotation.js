// File: scripts/preprocessAnnotation.js
import fs from 'fs';
import readline from 'readline';
import { createGunzip } from 'zlib';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

async function preprocessAnnotation(inputFile, outputDbFile) {
  console.log(`Processing annotation file: ${inputFile}`);
  console.log(`Output database will be: ${outputDbFile}`);
  
  // Create/open SQLite database
  const db = await open({
    filename: outputDbFile,
    driver: sqlite3.Database
  });
  
  // Create the table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS snp_annotations (
      chromosome TEXT,
      position INTEGER,
      rsid TEXT,
      allele TEXT,
      symbol TEXT,
      feature_type TEXT,
      consequence TEXT,
      PRIMARY KEY (chromosome, position)
    );
    CREATE INDEX IF NOT EXISTS idx_chr_pos ON snp_annotations(chromosome, position);
  `);

  const fileStream = fs.createReadStream(inputFile);
  const gunzip = createGunzip();
  const rl = readline.createInterface({
    input: fileStream.pipe(gunzip),
    crlfDelay: Infinity
  });

  let count = 0;
  const batchSize = 10000;
  let batch = [];

  console.log('Beginning file processing...');
  
  // Begin transaction for faster inserts
  await db.exec('BEGIN TRANSACTION');
  
  for await (const line of rl) {
    // Skip header lines
    if (line.startsWith('#')) continue;
    
    const fields = line.split('\t');
    if (fields.length < 20) continue;
    
    const snpData = {
      chromosome: fields[0],
      position: parseInt(fields[1]),
      rsid: fields[14] || 'Unknown',  // Existing_variation
      allele: fields[4] || 'Unknown', // Allele
      symbol: fields[19] || 'Unknown', // SYMBOL (gene)
      feature_type: fields[7] || 'Unknown', // Feature_type
      consequence: fields[8] || 'Unknown'  // Consequence
    };
    
    batch.push(snpData);
    count++;
    
    // Process in batches for performance
    if (batch.length >= batchSize) {
      const stmt = await db.prepare(`
        INSERT OR REPLACE INTO snp_annotations 
        (chromosome, position, rsid, allele, symbol, feature_type, consequence)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      
      for (const data of batch) {
        await stmt.run(
          data.chromosome,
          data.position,
          data.rsid,
          data.allele,
          data.symbol,
          data.feature_type,
          data.consequence
        );
      }
      
      await stmt.finalize();
      batch = [];
      
      console.log(`Processed ${count} records...`);
    }
  }
  
  // Insert any remaining records
  if (batch.length > 0) {
    const stmt = await db.prepare(`
      INSERT OR REPLACE INTO snp_annotations 
      (chromosome, position, rsid, allele, symbol, feature_type, consequence)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    
    for (const data of batch) {
      await stmt.run(
        data.chromosome,
        data.position,
        data.rsid,
        data.allele,
        data.symbol,
        data.feature_type,
        data.consequence
      );
    }
    
    await stmt.finalize();
  }
  
  // Commit the transaction
  await db.exec('COMMIT');
  
  // Create a spatial index for nearest lookup
  await db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS snp_positions USING rtree(
      id,              -- Integer primary key
      min_pos, max_pos, -- Position bounds (same value for points)
      +chromosome      -- Additional column for chromosome filtering
    );
  `);
  
  console.log('Creating spatial index for nearest neighbor searches...');
  
  // Populate the rtree
  await db.exec('BEGIN TRANSACTION');
  
  const allSnps = await db.all('SELECT rowid, chromosome, position FROM snp_annotations');
  const posStmt = await db.prepare('INSERT INTO snp_positions VALUES (?, ?, ?, ?)');
  
  for (const snp of allSnps) {
    await posStmt.run(
      snp.rowid,
      snp.position, snp.position,  // Min and max are the same for a point
      snp.chromosome
    );
  }
  
  await posStmt.finalize();
  await db.exec('COMMIT');
  
  console.log(`Processing complete. Total records: ${count}`);
  await db.close();
}

// Call the function with appropriate paths
const inputFile = '/home/ac.guptahr/platlas-backend/DATABASE/gwPheWAS_All.annotation.txt.gz';
const outputDbFile = '/home/ac.guptahr/platlas-backend/src/utils/snp_annotations.db';

preprocessAnnotation(inputFile, outputDbFile)
  .catch(err => console.error('Error during preprocessing:', err));