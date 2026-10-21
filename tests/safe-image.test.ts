import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeImage } from '../src/lib/safe-image';

test('safeImage: accetta percorsi interni e https', () => {
  assert.equal(safeImage('/demo/yoga-alba.svg'), '/demo/yoga-alba.svg');
  assert.equal(safeImage('https://example.com/a.jpg'), 'https://example.com/a.jpg');
});
test('safeImage: rifiuta tutto il resto', () => {
  for (const bad of [null, undefined, '', 'http://example.com/a.jpg', 'javascript:alert(1)', 'data:image/svg+xml;base64,AAAA', '//evil.com/a.png', 'demo/a.svg', 'https://' + 'a'.repeat(500)]) {
    assert.equal(safeImage(bad as never), null, String(bad).slice(0, 30));
  }
});
