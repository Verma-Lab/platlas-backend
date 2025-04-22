// save-snp-ids.js
import sqlite3 from 'sqlite3';
import fs from 'fs';

const db = new sqlite3.Database('/nfs/platlas_stor/db/genomics-backend/phewas_mrmega.db', sqlite3.OPEN_READONLY);
const outputStream = fs.createWriteStream('snp_ids.txt');

db.each("SELECT DISTINCT SNP_ID FROM phewas_snp_data_mrmega", (err, row) => {
  if (err) {
    console.error(err);
    return;
  }
  outputStream.write(row.SNP_ID + '\n');
});

db.close(() => {
  outputStream.end();
  console.log('Extraction complete');
});