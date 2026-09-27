// Fails the build when the bundle carries React's development build.
// Only the development build calls performance.measure (render tracks); a
// production bundle has none. Shipping it crashed Mission Control tabs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const assets = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public/assets');
const offenders = fs
  .readdirSync(assets)
  .filter((f) => f.endsWith('.js'))
  .filter((f) => fs.readFileSync(path.join(assets, f), 'utf8').includes('performance.measure'));
if (offenders.length) {
  console.error(`\n✖ Development React in the production bundle (${offenders.join(', ')}).`);
  console.error('  Build with NODE_ENV=production; check the host does not inject NODE_ENV=development at build time.\n');
  process.exit(1);
}
console.log('✓ production React build');
