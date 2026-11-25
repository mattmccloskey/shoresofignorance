/**
 * Which files get published. Shared by build.mjs (copies them into SITE_DIR)
 * and verify-build.mjs (checks SITE_DIR matches the sources).
 *
 * The site is built in place at the repo root, then only these files are
 * copied into SITE_DIR, which is what Cloudflare serves. Anything not listed
 * here (node_modules, episodes.json and its backups, build scripts, package
 * files, wrangler.jsonc, deploy.log, README, og-manifest.json, .git) is never
 * published.
 */
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const SITE_DIR = 'site';

// Root-level files to publish (optional ones are copied only if present).
const ROOT_FILES = ['index.html', 'style.css', 'main.js', 'sitemap.xml', 'llms.txt', 'robots.txt'];
const OPTIONAL_ROOT_FILES = ['404.html', 'favicon.ico', 'favicon.svg', 'apple-touch-icon.png', 'site.webmanifest', '_headers', '_redirects'];

// Whole directories to publish, minus these paths.
const DIRS = ['assets', 'episodes'];
const DIR_EXCLUDES = new Set(['episodes/og-manifest.json']);

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.isFile()) out.push(p);
  }
  return out;
}

/** Repo-relative paths of every file that should be published. */
export function listPublishFiles() {
  const files = [...ROOT_FILES];
  for (const f of OPTIONAL_ROOT_FILES) if (existsSync(f)) files.push(f);
  for (const d of DIRS) files.push(...walk(d).filter((p) => !DIR_EXCLUDES.has(p)));
  return files.sort();
}
