import { readFileSync, statSync, readdirSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { SITE_DIR, listPublishFiles } from './site-files.mjs';

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

// The published folder must mirror the publishable sources exactly
// (run `npm run build` to refresh it) and contain nothing else.
const problems = [];
const expected = listPublishFiles();
const expectedSet = new Set(expected);
for (const f of expected) {
  const out = join(SITE_DIR, f);
  if (!existsSync(out)) problems.push(`missing: ${out}`);
  else if (!readFileSync(out).equals(readFileSync(f))) problems.push(`out of date: ${out}`);
}
function walkAll(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walkAll(join(dir, e.name)) : [join(dir, e.name)]
  );
}
if (existsSync(SITE_DIR)) {
  for (const out of walkAll(SITE_DIR)) {
    const rel = relative(SITE_DIR, out);
    if (!expectedSet.has(rel)) problems.push(`unexpected file: ${out}`);
  }
}
for (const must of ['index.html', 'episodes/index.html', 'sitemap.xml', 'llms.txt', 'robots.txt', 'style.css', 'main.js']) {
  if (!expectedSet.has(must)) problems.push(`required file not published: ${must}`);
}
if (problems.length > 0) {
  console.error(`${SITE_DIR}/ does not match the build (run npm run build):`);
  for (const p of problems.slice(0, 50)) console.error('  - ' + p);
  if (problems.length > 50) console.error(`  ... and ${problems.length - 50} more`);
  process.exit(1);
}

console.log(`Build output is up to date (${expected.length} files in ${SITE_DIR}/).`);
