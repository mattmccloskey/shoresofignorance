import { readFileSync, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const episodes = JSON.parse(readFileSync('episodes.json', 'utf-8'));
// Compare against the NEWEST updatedAt (episodes[0] is not necessarily the
// most recently updated). index.html is checked against the newest overall;
// each episode page is checked against its own episode's updatedAt, because
// build.mjs skips rewriting pages whose content hasn't changed.
const times = episodes
  .map((ep) => new Date(ep.updatedAt).getTime())
  .filter((t) => Number.isFinite(t));
if (times.length === 0) {
  console.error('No updatedAt found in episodes.json');
  process.exit(1);
}
const jsonTime = Math.max(...times);
const epTime = new Map(
  episodes
    .filter((ep) => ep.number != null && ep.updatedAt)
    .map((ep) => [String(ep.number), new Date(ep.updatedAt).getTime()])
);

const filesToCheck = [['index.html', jsonTime]];
for (const entry of readdirSync('episodes', { withFileTypes: true })) {
  if (entry.isDirectory()) {
    const t = epTime.get(entry.name);
    if (t !== undefined) filesToCheck.push([join('episodes', entry.name, 'index.html'), t]);
  }
}

const stale = [];
for (const [file, minTime] of filesToCheck) {
  try {
    const mtime = statSync(file).mtime.getTime();
    if (mtime < minTime) {
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
