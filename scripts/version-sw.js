// Post-build: injeta o BUILD_ID no service worker pra invalidar o cache antigo
// a cada deploy. Sem isso, o PWA da loja fica preso na versão cacheada.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root      = path.resolve(__dirname, '..');
const swPath    = path.join(root, 'dist', 'sw.js');

if (!fs.existsSync(swPath)) {
  console.error('[version-sw] dist/sw.js não existe — rodou npm run build antes?');
  process.exit(1);
}

// BUILD_ID = timestamp + 6 chars aleatórios. Único por deploy, legível em devtools.
const ts   = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
const rand = Math.random().toString(36).slice(2, 8);
const buildId = `${ts}-${rand}`;

const src = fs.readFileSync(swPath, 'utf8');
const out = src.replaceAll('__BUILD_ID__', buildId);

if (src === out) {
  console.error('[version-sw] placeholder __BUILD_ID__ não encontrado em dist/sw.js');
  process.exit(1);
}

fs.writeFileSync(swPath, out);
console.log(`[version-sw] CACHE = nutriops-${buildId}`);
