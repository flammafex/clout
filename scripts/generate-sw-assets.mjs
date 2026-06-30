/**
 * Generate sw-assets.json — a manifest of static assets for the service worker.
 *
 * Scans src/web/public/ recursively and writes a root-relative URL array to
 * src/web/public/sw-assets.json. The service worker fetches this manifest on
 * install so its precache list stays in sync with actual files automatically.
 *
 * Run by `npm run copy-static` before copying public/ into dist/.
 */
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, '..', 'src', 'web', 'public');
const OUTPUT_FILE = join(PUBLIC_DIR, 'sw-assets.json');

// Files that must never appear in the precache manifest.
const EXCLUDE_FILES = new Set([
  'service-worker.js',
  'sw-assets.json',
]);

/**
 * Recursively collect files under `dir`, returning paths relative to `dir`.
 * @param {string} dir
 * @returns {string[]}
 */
function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else {
      out.push(relative(PUBLIC_DIR, full));
    }
  }
  return out;
}

const files = walk(PUBLIC_DIR)
  .filter((rel) => !EXCLUDE_FILES.has(rel))
  // Normalize Windows separators and make root-relative URL.
  .map((rel) => '/' + rel.split(sep).join('/'))
  // Stable, human-readable ordering.
  .sort();

// Always ensure the app shell root is precached.
if (!files.includes('/')) {
  files.unshift('/');
}

writeFileSync(OUTPUT_FILE, JSON.stringify(files, null, 2) + '\n', 'utf8');

console.log(`[generate-sw-assets] Wrote ${files.length} entries to ${OUTPUT_FILE}`);
for (const url of files) {
  console.log(`  ${url}`);
}
