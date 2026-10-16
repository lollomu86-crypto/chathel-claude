// T-D3: stessi casi di supabase/tests/0005_parity_test.sql. Una sola fonte (parity-cases.json): se TS e SQL divergono, falliscono entrambi.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sanitizeNickname, normalizeText, checkMessage } from '../src/lib/rules/social';

const cases = JSON.parse(readFileSync('tests/parity-cases.json', 'utf8')) as {
  nicknames: { input: string; expected: string | null }[];
  messages: { input: string; expected: string }[];
};

test('T-D3 parità nickname TS/SQL (casi condivisi)', () => {
  for (const c of cases.nicknames) assert.equal(sanitizeNickname(c.input), c.expected, JSON.stringify(c.input));
});
test('T-D3 parità normalizzazione messaggi TS/SQL (casi condivisi)', () => {
  for (const c of cases.messages) assert.equal(normalizeText(c.input), c.expected, JSON.stringify(c.input));
});
test('T-D3 parità limiti messaggio: vuoto e oltre 280 punti di codice', () => {
  assert.throws(() => checkMessage('   '), { reason: 'invalid_message' });
  assert.equal([...checkMessage('😀'.repeat(280))].length, 280);
  assert.throws(() => checkMessage('😀'.repeat(281)), { reason: 'too_long' });
});
