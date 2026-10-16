// Segnaposto di 'qrcode' (non installabile): disegna una matrice derivata dal testo. NON e' un QR leggibile.
export function toCanvas(canvas: HTMLCanvasElement, text: string, o: { width?: number } = {}) {
  const size = o.width ?? 300; const n = 25; const cell = Math.floor(size / n);
  canvas.width = canvas.height = cell * n;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#fff'; g.fillRect(0, 0, canvas.width, canvas.height); g.fillStyle = '#000';
  let h = 2166136261; for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { h = Math.imul(h ^ (x * 31 + y), 16777619); if ((h >>> 7) & 1) g.fillRect(x * cell, y * cell, cell, cell); }
  for (const [ox, oy] of [[0, 0], [n - 7, 0], [0, n - 7]]) { g.fillStyle = '#000'; g.fillRect(ox * cell, oy * cell, 7 * cell, 7 * cell); g.fillStyle = '#fff'; g.fillRect((ox + 1) * cell, (oy + 1) * cell, 5 * cell, 5 * cell); g.fillStyle = '#000'; g.fillRect((ox + 2) * cell, (oy + 2) * cell, 3 * cell, 3 * cell); }
  return Promise.resolve();
}
export default { toCanvas };
