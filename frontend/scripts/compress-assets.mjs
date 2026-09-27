// Writes .br and .gz copies of the built JS/CSS next to the originals. The
// server sends one of them when the browser accepts it (see src/app.ts), so the
// app is compressed once at build time instead of on every request.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const assets = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public/assets');
let before = 0;
let after = 0;
for (const name of fs.readdirSync(assets)) {
  if (!/\.(js|css|svg)$/.test(name)) continue;
  const file = path.join(assets, name);
  const raw = fs.readFileSync(file);
  if (raw.length < 1024) continue;
  const br = zlib.brotliCompressSync(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: raw.length } });
  fs.writeFileSync(`${file}.br`, br);
  fs.writeFileSync(`${file}.gz`, zlib.gzipSync(raw, { level: 9 }));
  before += raw.length;
  after += br.length;
}
console.log(`✓ compressed assets: ${Math.round(before / 1024)} KB → ${Math.round(after / 1024)} KB brotli`);
