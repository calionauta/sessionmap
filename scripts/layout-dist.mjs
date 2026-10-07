// Post-build: directory-style URLs for GitHub Pages (no rewrites there).
//
//   /      → PT landing   (public/landing.html, CTA + toggle rewritten)
//   /en/   → EN landing   (public/landing-en.html, relative paths lifted)
//   /app/  → the app      (vite's index.html, moved; assets stay absolute
//                          under /sessionmap/, so the subpath just works)
//
// Legacy /landing.html + /landing-en.html remain as meta-refresh stubs so
// old shared links keep landing somewhere sensible. Dev (`bun run dev`)
// is untouched: it still serves the app at / and the landings by filename.
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const pub = join(root, 'public');

/** Fail loudly when a landing edit breaks the layout contract below. */
function mustContain(haystack, needle, file) {
  if (!haystack.includes(needle)) {
    throw new Error(`layout-dist: ${file} no longer contains ${needle}`);
  }
}

const ptRaw = readFileSync(join(pub, 'landing.html'), 'utf8');
mustContain(ptRaw, 'href="./en/"', 'landing.html (lang toggle)');
mustContain(ptRaw, 'href="./app/"', 'landing.html (CTA)');
const pt = ptRaw;

const enRaw = readFileSync(join(pub, 'landing-en.html'), 'utf8');
mustContain(enRaw, 'href="../"', 'landing-en.html (lang toggle)');
mustContain(enRaw, 'href="../app/"', 'landing-en.html (CTA)');
const en = enRaw
  .replace('src="./how-it-works.mp4"', 'src="../how-it-works.mp4"')
  .replace('poster="./how-it-works-poster.jpg"', 'poster="../how-it-works-poster.jpg"');
mustContain(en, 'src="../how-it-works.mp4"', 'landing-en.html (media rewrite)');
mustContain(en, 'poster="../how-it-works-poster.jpg"', 'landing-en.html (poster rewrite)');

mkdirSync(join(dist, 'app'), { recursive: true });
mkdirSync(join(dist, 'en'), { recursive: true });
renameSync(join(dist, 'index.html'), join(dist, 'app', 'index.html'));
writeFileSync(join(dist, 'index.html'), pt);
writeFileSync(join(dist, 'en', 'index.html'), en);

const stub = (to) =>
  `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${to}"><link rel="canonical" href="${to}"></head><body></body></html>\n`;
for (const [old, to] of [
  ['landing.html', '/sessionmap/'],
  ['landing-en.html', '/sessionmap/en/'],
]) {
  rmSync(join(dist, old), { force: true });
  writeFileSync(join(dist, old), stub(to));
}

console.log('dist layout ok: / (pt) · /en/ · /app/ · legacy stubs');
