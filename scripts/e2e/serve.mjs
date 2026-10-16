// Costruisce e avvia il harness e2e: node scripts/e2e/serve.mjs [porta]   (usato anche dagli script e2e-*.mjs)
import { build, outDir } from './build.mjs';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

export async function startE2eServer(port = Number(process.env.PORT || 3200)) {
  await build();
  const mod = await import(pathToFileURL(join(outDir, 'server.mjs')).href + `?t=${Date.now()}`);
  const s = await mod.startServer(port, outDir);
  return { ...s, base: `http://localhost:${port}` };
}
import { fileURLToPath } from 'node:url';
if (process.argv[1] === fileURLToPath(import.meta.url)) { const s = await startE2eServer(Number(process.argv[2]) || 3200); console.log('harness e2e su', s.base); }
