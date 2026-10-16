import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function flat(o: any, p = ''): string[] {
  return Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? flat(v, `${p}${k}.`) : [`${p}${k}`]));
}
const load = (l: string) => JSON.parse(readFileSync(join(__dirname, '..', 'messages', `${l}.json`), 'utf8'));

test('i18n: it/en/de hanno le stesse chiavi e nessun valore vuoto', () => {
  const it = flat(load('it')).sort();
  for (const l of ['en', 'de']) {
    assert.deepEqual(flat(load(l)).sort(), it, `chiavi diverse in ${l}`);
  }
  const vuoti = (o: any, p = ''): string[] => Object.entries(o).flatMap(([k, v]) => (typeof v === 'string' ? (v.trim() ? [] : [p + k]) : vuoti(v, `${p}${k}.`)));
  for (const l of ['it', 'en', 'de']) assert.deepEqual(vuoti(load(l)), []);
});
