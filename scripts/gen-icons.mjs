// Compatibilita' con "npm run icons": le icone si generano ora con Pillow dal logo originale (scripts/gen-icons.py).
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = join(dirname(fileURLToPath(import.meta.url)), 'gen-icons.py');
const r = spawnSync('python3', [script], { stdio: 'inherit' });
process.exit(r.status ?? 1);
