// Costruisce i due bundle del harness e2e con esbuild (da /opt/npm-tools). NON usa Next.
//  - server.mjs: pagine (server component risolti da un mini-RSC) + route handler API, nello stesso processo (stato demo condiviso)
//  - client.js : i componenti 'use client' reali, montati dal browser
import { readFileSync, readdirSync, statSync, mkdirSync, existsSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from '/opt/npm-tools/node_modules/esbuild/lib/main.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const src = join(root, 'src');
export const outDir = join(here, '.out');

const walk = (d, out = []) => { for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? walk(p, out) : out.push(p); } return out; };
const isClient = (code) => /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*['"]use client['"]/.test(code);
const exportsOf = (code) => {
  const names = new Set();
  for (const m of code.matchAll(/^export\s+(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z0-9_$]+)/gm)) names.add(m[1]);
  for (const m of code.matchAll(/^export\s*\{([^}]*)\}/gm)) m[1].split(',').map((s) => s.trim().split(/\s+as\s+/).pop()).filter(Boolean).forEach((n) => names.add(n));
  if (/^export\s+default\b/m.test(code)) names.add('default');
  return [...names];
};
const clientFiles = () => walk(src).filter((f) => /\.(tsx?|jsx?)$/.test(f)).map((f) => ({ f, code: readFileSync(f, 'utf8') })).filter((x) => isClient(x.code));

function routesModule() {
  const app = join(src, 'app');
  const imports = []; const routes = []; let n = 0;
  const imp = (file) => { const id = `m${n++}`; imports.push(`import * as ${id} from ${JSON.stringify(file)};`); return id; };
  const find = (dir, name) => ['tsx', 'ts'].map((e) => join(dir, `${name}.${e}`)).find((p) => existsSync(p));
  const rootLayout = imp(find(app, 'layout'));
  const rootNotFound = find(app, 'not-found') ? imp(find(app, 'not-found')) : 'null';
  const visit = (dir, segs, layouts, error, loading) => {
    const own = find(dir, 'layout');
    if (own && dir !== app) layouts = [...layouts, imp(own)];
    const err = find(dir, 'error'); if (err) error = imp(err);
    const ld = find(dir, 'loading'); if (ld) loading = imp(ld);
    const page = find(dir, 'page');
    if (page) routes.push(`{ segs: ${JSON.stringify(segs)}, page: ${imp(page)}, layouts: [${layouts.join(',')}], error: ${error}, loading: ${loading} }`);
    for (const d of readdirSync(dir)) {
      const p = join(dir, d);
      if (!statSync(p).isDirectory() || (dir === app && d === 'api')) continue;
      const group = /^\(.*\)$/.test(d);
      visit(p, group ? segs : [...segs, d], layouts, error, loading);
    }
  };
  visit(app, [], [rootLayout], 'null', 'null');
  return `${imports.join('\n')}\nexport const rootLayout = ${rootLayout};\nexport const notFound = ${rootNotFound};\nexport const routes = [${routes.join(',\n')}];`;
}
function registryModule() {
  const lines = []; const entries = [];
  clientFiles().forEach(({ f, code }, i) => {
    lines.push(`import * as c${i} from ${JSON.stringify(f)};`);
    for (const n of exportsOf(code)) entries.push(`${JSON.stringify(`${relative(root, f)}#${n}`)}: c${i}[${JSON.stringify(n)}]`);
  });
  return `${lines.join('\n')}\nexport const registry = {${entries.join(',')}};`;
}

const plugin = (side) => ({
  name: 'harness',
  setup(b) {
    b.onResolve({ filter: /^virtual:/ }, (a) => ({ path: a.path, namespace: 'virtual' }));
    b.onLoad({ filter: /.*/, namespace: 'virtual' }, (a) => ({ contents: a.path === 'virtual:routes' ? routesModule() : registryModule(), resolveDir: root, loader: 'js' }));
    if (side === 'server') {
      // confine 'use client': sul server i moduli client diventano riferimenti, come in un vero server component
      b.onLoad({ filter: /\.(tsx?|jsx?)$/ }, (a) => {
        if (!a.path.startsWith(src)) return null;
        const code = readFileSync(a.path, 'utf8');
        if (!isClient(code)) return null;
        const rel = relative(root, a.path);
        const body = exportsOf(code).map((n) => (n === 'default' ? `export default mk(${JSON.stringify(`${rel}#default`)});` : `export const ${n} = mk(${JSON.stringify(`${rel}#${n}`)});`)).join('\n');
        return { contents: `const mk = (id) => { const f = function () { throw new Error('Componente client usato sul server: ' + id); }; f.$$ref = id; return f; };\n${body}`, loader: 'js' };
      });
    }
  },
});
const common = (side) => ({
  bundle: true, jsx: 'automatic', tsconfig: join(root, 'tsconfig.json'), nodePaths: ['/opt/npm-tools/node_modules'], logLevel: 'warning',
  loader: { '.css': 'empty' }, sourcemap: 'inline', plugins: [plugin(side)],
  alias: {
    'next/link': join(here, 'shims/link.tsx'), 'next/navigation': join(here, 'shims/navigation.ts'), 'next/headers': join(here, 'shims/headers.ts'),
    'next/font/google': join(here, 'shims/font.ts'), 'next/server': join(here, 'shims/server.ts'),
    qrcode: join(here, 'stubs/qrcode.ts'), '@supabase/supabase-js': join(here, 'stubs/unavailable.ts'), '@anthropic-ai/sdk': join(here, 'stubs/unavailable.ts'),
  },
});

export async function build() {
  mkdirSync(outDir, { recursive: true });
  await esbuild.build({ ...common('server'), entryPoints: [join(here, 'entry-server.tsx')], outfile: join(outDir, 'server.mjs'), platform: 'node', format: 'esm', target: 'node22',
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" }, define: { 'process.env.NODE_ENV': '"development"' } });
  await esbuild.build({ ...common('client'), entryPoints: [join(here, 'entry-client.tsx')], outfile: join(outDir, 'client.js'), platform: 'browser', format: 'iife', target: 'chrome120',
    banner: { js: 'globalThis.process = { env: {} };' }, define: { 'process.env.NODE_ENV': '"development"' } });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) { await build(); console.log('harness e2e costruito in', outDir); }
