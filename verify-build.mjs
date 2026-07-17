import { readFileSync, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const episodes = JSON.parse(readFileSync('episodes.json', 'utf-8'));
const updatedAt = episodes[0]?.updatedAt;
if (!updatedAt) {
  console.error('No updatedAt found in episodes.json');
  process.exit(1);
}
const jsonTime = new Date(updatedAt).getTime();

const filesToCheck = ['index.html'];
for (const entry of readdirSync('episodes', { withFileTypes: true })) {
  if (entry.isDirectory()) {
    filesToCheck.push(join('episodes', entry.name, 'index.html'));
  }
}

const stale = [];
for (const file of filesToCheck) {
  try {
    const mtime = statSync(file).mtime.getTime();
    if (mtime < jsonTime) {
      stale.push(file);
    }
  } catch {
    stale.push(file);
  }
}

if (stale.length > 0) {
  console.error('Stale build output (older than episodes.json):');
  for (const f of stale) console.error('  - ' + f);
  process.exit(1);
}

console.log('Build output is up to date.');
