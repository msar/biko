// Regenera favicon.png, pwa-192.png y pwa-512.png desde public/logo.png (macOS sips).
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const dir = path.resolve(import.meta.dirname, '../public');
const logo = path.join(dir, 'logo.png');

if (!existsSync(logo)) {
  console.error('Falta public/logo.png — agregá el logo antes de correr este script.');
  process.exit(1);
}

for (const [out, size] of [
  ['favicon.png', 32],
  ['pwa-192.png', 192],
  ['pwa-512.png', 512],
]) {
  execSync(`sips -z ${size} ${size} "${logo}" --out "${path.join(dir, out)}"`, { stdio: 'inherit' });
  console.log(`${out} generado`);
}
