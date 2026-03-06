#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const RESPONSES_DIR = path.join(__dirname, 'responses');
const RESULT_DIR = path.join(__dirname, 'result');

// Ensure result dir exists
if (!fs.existsSync(RESULT_DIR)) {
  fs.mkdirSync(RESULT_DIR, { recursive: true });
}

// Find all products_03-03-2026_*.json files
const files = fs.readdirSync(RESPONSES_DIR)
  .filter(f => f.startsWith('products_03-03-2026_') && f.endsWith('.json'))
  .sort((a, b) => {
    const numA = parseInt(a.replace('products_03-03-2026_', '').replace('.json', ''));
    const numB = parseInt(b.replace('products_03-03-2026_', '').replace('.json', ''));
    return numA - numB;
  });

if (files.length === 0) {
  console.error('No files found matching products_03-03-2026_*.json in responses/');
  process.exit(1);
}

console.log(`Found ${files.length} files to consolidate...`);

const allItems = [];
let errors = 0;

files.forEach((file, index) => {
  const filepath = path.join(RESPONSES_DIR, file);
  try {
    const data = JSON.parse(fs.readFileSync(filepath, 'utf8'));
    if (data.items && Array.isArray(data.items)) {
      allItems.push(...data.items);
    } else {
      console.warn(`  Warning: ${file} has no items array`);
    }
    if ((index + 1) % 50 === 0) {
      console.log(`  Processed ${index + 1}/${files.length} files (${allItems.length} items so far)...`);
    }
  } catch (err) {
    console.error(`  Error reading ${file}: ${err.message}`);
    errors++;
  }
});

console.log(`\nTotal items collected: ${allItems.length}`);
if (errors > 0) console.warn(`Errors: ${errors} files could not be read`);

// Build consolidated JSON
const consolidated = {
  total: allItems.length,
  generatedAt: new Date().toISOString(),
  sourceFiles: files.length,
  items: allItems
};

// Save JSON
const jsonFilename = 'products_03-03-2026_consolidated.json';
const jsonPath = path.join(RESULT_DIR, jsonFilename);
fs.writeFileSync(jsonPath, JSON.stringify(consolidated, null, 2), 'utf8');
console.log(`\nJSON saved: result/${jsonFilename}`);

// Build CSV
const fields = ['id', 'displayName', 'creationDate'];

let csvContent = fields.join(',') + '\n';

allItems.forEach(item => {
  const row = fields.map(field => {
    let value = item[field];
    if (value === null || value === undefined) return '';
    value = String(value);
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      value = '"' + value.replace(/"/g, '""') + '"';
    }
    return value;
  });
  csvContent += row.join(',') + '\n';
});

const csvFilename = 'products_03-03-2026_consolidated.csv';
const csvPath = path.join(RESULT_DIR, csvFilename);
fs.writeFileSync(csvPath, csvContent, 'utf8');
console.log(`CSV saved:  result/${csvFilename}`);
console.log(`\nColumns: ${fields.join(', ')}`);
console.log(`Total rows: ${allItems.length}`);
