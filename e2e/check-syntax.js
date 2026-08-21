#!/usr/bin/env node
/**
 * Syntax gate for the E2E suite.
 *
 * A stray brace in a spec or helper takes down the entire run with an error that
 * points at the collection phase rather than the file, so this checks every
 * file up front and names the ones that fail. Wired in as the `pretest:e2e`
 * script; two such breakages had already landed on this branch undetected.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = __dirname;

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'fixtures') continue;
      out.push(...walk(full));
    } else if (entry.name.endsWith('.js')) {
      out.push(full);
    }
  }
  return out;
}

const files = walk(ROOT);
const failures = [];

for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  try {
    // Compile without executing: catches syntax errors, ignores missing imports.
    new vm.Script(source, { filename: file });
  } catch (err) {
    failures.push({ file: path.relative(process.cwd(), file), message: err.message });
  }
}

if (failures.length > 0) {
  console.error(`\nSyntax errors in ${failures.length} E2E file(s):\n`);
  for (const f of failures) {
    console.error(`  ${f.file}`);
    console.error(`    ${f.message}\n`);
  }
  process.exit(1);
}

console.log(`Syntax OK: ${files.length} E2E files`);
