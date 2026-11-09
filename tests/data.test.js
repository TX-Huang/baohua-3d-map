// Checks on the map data (made by tools/build_detail.py) as it ships inside index.html.
// Run `npm run build` first, then: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const start = html.indexOf('window.MAPDATA=') + 'window.MAPDATA='.length;
const D = JSON.parse(html.slice(start, html.indexOf('};', start) + 1));
const AREAS = [...D.plazas.map(p => ({ id: p.id, p: p.p })), ...D.paved.map((p, i) => ({ id: `paved ${i}`, p }))];

function inside(x, z, p) {
  let hit = false;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const [xi, zi, xj, zj] = [p[i], p[i + 1], p[j], p[j + 1]];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) hit = !hit;
  }
  return hit;
}
function edgeDist(x, z, p) {
  let best = Infinity;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const ax = p[j], az = p[j + 1], ex = p[i] - ax, ez = p[i + 1] - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez)));
    best = Math.min(best, Math.hypot(x - ax - ex * t, z - az - ez * t));
  }
  return best;
}

test('廣場和鋪面上沒有樹：樹幹不站在上面，樹冠也不會伸進去', () => {
  const bad = [];
  for (const [x, z, r] of D.trees) {
    for (const a of AREAS) {
      if (inside(x, z, a.p)) bad.push(`tree at ${x},${z} stands on ${a.id}`);
      else if (edgeDist(x, z, a.p) < r) bad.push(`tree at ${x},${z} (crown ${r} m) reaches ${(r - edgeDist(x, z, a.p)).toFixed(1)} m over ${a.id}`);
    }
  }
  assert.deepEqual(bad, []);
});

test('只拿掉廣場和鋪面上的樹，山上的樹都還在', () => {
  assert.ok(D.trees.length >= 2400, `only ${D.trees.length} trees left`);
});
