// Unit tests for the pure layout logic (no browser needed): npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../src/js/layout-core.js');

const GEO = { lon0: 121.1878763806343, lat0: 22.974887469693417, mLon: 102541.50807480329, mLat: 110743.6445478205 };

const sample = () => ({
  v: 1,
  updated: '2026-11-08T00:00:00.000Z',
  places: {
    B: { name: '主殿', glyph: '殿', note: '主殿說明', staff: ['甲'] },
    P2: { name: '主殿廣場', glyph: '場', note: '', staff: ['陶明潔', '李函紋'] },
  },
  items: [
    { id: 'reg', type: 'table', name: '登記處', glyph: '登', lon: 121.1880985, lat: 22.9751757, rot: 52.2, note: 'n', staff: ['莛茜'] },
  ],
  paths: [
    { id: 'w1', name: '神明走道', text: '神明專用', width: 2, style: 'red', pts: [[121.1881, 22.9752], [121.1882, 22.9753]], note: '', staff: [] },
  ],
});

test('normalize keeps valid places, items and paths', () => {
  const out = L.normalizeLayout(sample());
  assert.equal(out.places.B.name, '主殿');
  assert.deepEqual(out.places.P2.staff, ['陶明潔', '李函紋']);
  assert.equal(out.items.length, 1);
  assert.equal(out.items[0].id, 'reg');
  assert.equal(out.items[0].type, 'table');
  assert.deepEqual(out.items[0].staff, ['莛茜']);
  assert.equal(out.paths.length, 1);
  assert.equal(out.paths[0].text, '神明專用');
  assert.equal(out.paths[0].pts.length, 2);
});

test('normalize drops broken entries instead of failing', () => {
  const raw = sample();
  raw.items.push({ id: 'x1', type: 'rocket', lon: 121.18, lat: 22.97 });            // unknown type
  raw.items.push({ id: 'x2', type: 'table', lon: 'abc', lat: 22.97 });              // bad coordinates
  raw.items.push({ id: 'reg', type: 'tent', lon: 121.18, lat: 22.97 });             // duplicate id
  raw.items.push({ id: '<b>', type: 'tent', lon: 121.18, lat: 22.97 });             // unsafe id
  raw.paths.push({ id: 'w2', pts: [[121.18, 22.97]] });                              // one point is not a path
  raw.paths.push({ id: 'w3', pts: [[121.18, 22.97], [NaN, 1]] });                   // bad point
  const out = L.normalizeLayout(raw);
  assert.deepEqual(out.items.map(i => i.id), ['reg']);
  assert.deepEqual(out.paths.map(p => p.id), ['w1']);
});

test('normalize trims long text and strips control characters', () => {
  const raw = sample();
  raw.items[0].name = '登記\u0000處' + 'あ'.repeat(100);
  raw.items[0].note = 'x'.repeat(5000);
  raw.items[0].staff = ['  莛茜  ', '', 'y'.repeat(100)];
  const out = L.normalizeLayout(raw);
  assert.ok(out.items[0].name.startsWith('登記處'));
  assert.ok(out.items[0].name.length <= L.LIMITS.name);
  assert.ok(out.items[0].note.length <= L.LIMITS.note);
  assert.equal(out.items[0].staff[0], '莛茜');
  assert.equal(out.items[0].staff.length, 2);
  assert.ok(out.items[0].staff[1].length <= L.LIMITS.staffName);
});

test('normalize of garbage returns an empty layout', () => {
  for (const g of [null, undefined, 'x', 42, [], { items: 'no' }]) {
    const out = L.normalizeLayout(g);
    assert.deepEqual(out.items, []);
    assert.deepEqual(out.paths, []);
    assert.deepEqual(out.places, {});
  }
});

test('normalize ignores names inherited from Object (type "constructor", style "toString")', () => {
  const raw = sample();
  raw.items.push({ id: 'x1', type: 'constructor', lon: 121.18, lat: 22.97 });
  raw.items.push({ id: 'x2', type: '__proto__', lon: 121.18, lat: 22.97 });
  raw.paths[0].style = 'toString';
  const out = L.normalizeLayout(raw);
  assert.deepEqual(out.items.map(i => i.id), ['reg']);
  assert.equal(out.paths[0].style, 'red');
  assert.equal(L.addItem(out, 'constructor', 121.18, 22.97), null);
  L.updateEntity(out, 'w1', { style: 'hasOwnProperty' });
  assert.equal(out.paths[0].style, 'red');
});

test('addItem and addPath stop at the same limits that loading enforces', () => {
  const lay = L.normalizeLayout({});
  for (let k = 0; k < L.LIMITS.items; k++) assert.ok(L.addItem(lay, 'marker', 121.18, 22.97));
  assert.equal(L.addItem(lay, 'marker', 121.18, 22.97), null);
  for (let k = 0; k < L.LIMITS.paths; k++) assert.ok(L.addPath(lay, [[121.18, 22.97], [121.181, 22.971]]));
  assert.equal(L.addPath(lay, [[121.18, 22.97], [121.181, 22.971]]), null);
  assert.equal(L.normalizeLayout(JSON.parse(JSON.stringify(lay))).items.length, L.LIMITS.items);
});

test('glyph keeps one character, falls back to the type default', () => {
  const raw = sample();
  raw.items[0].glyph = '登記';
  raw.items.push({ id: 't1', type: 'table', lon: 121.18, lat: 22.97 });
  const out = L.normalizeLayout(raw);
  assert.equal(out.items[0].glyph, '登');
  assert.equal(out.items[1].glyph, L.ITEM_TYPES.table.glyph);
  assert.equal(out.items[1].name, L.ITEM_TYPES.table.name);
});

test('path style and width are limited to the allowed choices', () => {
  const raw = sample();
  raw.paths[0].style = 'javascript:alert(1)';
  raw.paths[0].width = 999;
  const out = L.normalizeLayout(raw);
  assert.equal(out.paths[0].style, 'red');
  assert.equal(out.paths[0].width, L.PATH_WIDTH.max);
});

test('toLocal and toLonLat round-trip within 1 cm', () => {
  const { x, z } = L.toLocal(GEO, 121.1880985, 22.9751757);
  assert.ok(Math.abs(x - 22.78) < 0.05 && Math.abs(z + 31.92) < 0.05, `${x}, ${z}`);
  const back = L.toLonLat(GEO, x, z);
  const again = L.toLocal(GEO, back.lon, back.lat);
  assert.ok(Math.hypot(again.x - x, again.z - z) < 0.01);
});

test('addItem gives each new item its own id, default name and glyph', () => {
  const lay = L.normalizeLayout(sample());
  const a = L.addItem(lay, 'table', 121.188, 22.975);
  const b = L.addItem(lay, 'table', 121.188, 22.975);
  const c = L.addItem(lay, 'tent', 121.188, 22.975);
  assert.notEqual(a.id, b.id);
  assert.equal(lay.items.length, 4);
  assert.equal(a.name, '桌子');
  assert.equal(c.glyph, L.ITEM_TYPES.tent.glyph);
  assert.equal(new Set(lay.items.map(i => i.id)).size, 4);
});

test('addPath needs at least two points and starts with the default text', () => {
  const lay = L.normalizeLayout(sample());
  assert.equal(L.addPath(lay, [[121.18, 22.97]]), null);
  const p = L.addPath(lay, [[121.18, 22.97], [121.181, 22.971], [121.182, 22.972]]);
  assert.equal(p.text, '神明專用');
  assert.equal(p.width, L.PATH_WIDTH.def);
  assert.notEqual(p.id, 'w1');
});

test('removeEntity deletes items and paths but never fixed places', () => {
  const lay = L.normalizeLayout(sample());
  assert.equal(L.removeEntity(lay, 'reg'), true);
  assert.equal(L.removeEntity(lay, 'w1'), true);
  assert.equal(L.removeEntity(lay, 'B'), false);
  assert.equal(lay.items.length, 0);
  assert.equal(lay.paths.length, 0);
  assert.equal(lay.places.B.name, '主殿');
});

test('updateEntity sanitises fields and creates a place entry when needed', () => {
  const lay = L.normalizeLayout(sample());
  L.updateEntity(lay, 'A', { name: '大木屋', staff: '王小明\n李大華' });
  assert.equal(lay.places.A.name, '大木屋');
  assert.deepEqual(lay.places.A.staff, ['王小明', '李大華']);
  L.updateEntity(lay, 'reg', { rot: 370, name: '報到處', type: 'tent', lon: 'bad' });
  const reg = lay.items[0];
  assert.equal(reg.name, '報到處');
  assert.equal(reg.rot, 10);
  assert.equal(reg.type, 'table', 'type cannot be changed');
  assert.equal(reg.lon, 121.1880985, 'bad coordinates are ignored');
  L.updateEntity(lay, 'w1', { width: 3.5, text: '神明專用道', style: 'yellow' });
  assert.equal(lay.paths[0].width, 3.5);
  assert.equal(lay.paths[0].style, 'yellow');
  assert.equal(lay.paths[0].text, '神明專用道');
});

test('parseStaff splits on new lines, commas and 、, and drops blanks', () => {
  assert.deepEqual(L.parseStaff('陶明潔、李函紋, 李函蒨\n\n  黃亦修 ，Chris'), ['陶明潔', '李函紋', '李函蒨', '黃亦修', 'Chris']);
  assert.deepEqual(L.parseStaff(''), []);
});

test('ribbon: keeps its width, u goes 0..1 across, v grows with distance, y comes from the ground', () => {
  const r = L.ribbon([[0, 0], [10, 0]], 2, (x, z) => x * 0.1, { step: 1, lift: 0.05 });
  const P = r.positions, U = r.uvs;
  const n = P.length / 3;
  assert.equal(n % 2, 0);
  assert.ok(Math.abs(r.length - 10) < 1e-9);
  for (let k = 0; k < n; k += 2) {
    const w = Math.hypot(P[k * 3] - P[k * 3 + 3], P[k * 3 + 2] - P[k * 3 + 5]);
    assert.ok(Math.abs(w - 2) < 1e-6, `width ${w}`);
    assert.equal(U[k * 2], 0); assert.equal(U[k * 2 + 2], 1);
    const x = P[k * 3];
    assert.ok(Math.abs(P[k * 3 + 1] - (x * 0.1 + 0.05)) < 1e-6);
  }
  assert.ok(U[(n - 1) * 2 + 1] > U[1]);
  assert.ok(Math.abs(U[(n - 1) * 2 + 1] - 10) < 1e-6);
  assert.equal(r.indices.length, (n / 2 - 1) * 6);
});

test('ribbon: a sharp corner does not explode the width', () => {
  const r = L.ribbon([[0, 0], [10, 0], [0, 0.5]], 2, () => 0, { step: 0.5 });
  const P = r.positions;
  for (let k = 0; k < P.length / 3; k += 2) {
    const w = Math.hypot(P[k * 3] - P[k * 3 + 3], P[k * 3 + 2] - P[k * 3 + 5]);
    assert.ok(w <= 2 * 2.01, `width ${w} at pair ${k / 2}`);
  }
});

test('ribbon: the left edge is on the left when walking from the first point', () => {
  // walking north (z decreasing); the left side is west (x smaller)
  const r = L.ribbon([[0, 0], [0, -10]], 2, () => 0, { step: 5 });
  assert.ok(r.positions[0] < r.positions[3]);
});

test('ribbon: a path hundreds of kilometres long stays small (no freeze)', () => {
  const r = L.ribbon([[0, 0], [500000, 0], [500000, 400000]], 2, () => 0, { step: 0.5 });
  assert.ok(r.positions.length / 6 <= L.LIMITS.ribbonSamples + 2, `${r.positions.length / 6} samples`);
  assert.ok(Math.abs(r.length - 900000) < 1);
});

test('ribbon: with `across`, extra columns follow the ground across the width', () => {
  const r = L.ribbon([[0, 0], [10, 0]], 2, (x, z) => z * z, { step: 1, across: 0.5 });
  const cols = 5, P = r.positions, U = r.uvs, n = P.length / 3, rows = n / cols;
  assert.equal(rows, 11);
  for (let k = 0; k < rows; k++) for (let j = 0; j < cols; j++) {
    const i = k * cols + j, z = P[i * 3 + 2];
    assert.ok(Math.abs(U[i * 2] - j / (cols - 1)) < 1e-9, `u at row ${k} col ${j}`);
    assert.ok(Math.abs(P[i * 3 + 1] - z * z) < 1e-9, 'each column takes its own height');
    if (j) assert.ok(Math.abs(Math.hypot(P[i * 3] - P[i * 3 - 3], z - P[i * 3 - 1]) - 0.5) < 1e-6, 'columns 0.5 m apart');
  }
  assert.equal(r.indices.length, (rows - 1) * (cols - 1) * 6);
  const I = r.indices, flat = L.ribbon([[0, 0], [0, -10], [-5, -12]], 2, () => 0, { step: 1, across: 0.5 });
  for (let t = 0; t < flat.indices.length; t += 3) {
    const [a, b, c] = [flat.indices[t], flat.indices[t + 1], flat.indices[t + 2]].map(i => [flat.positions[i * 3], flat.positions[i * 3 + 2]]);
    assert.ok((b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]) > 0, `triangle ${t / 3} faces down`);
  }
  assert.ok(I.length > 0);
  // a very wide walkway does not get an unbounded number of columns
  const wide = L.ribbon([[0, 0], [1, 0]], 8, () => 0, { step: 1, across: 0.25 });
  assert.equal(wide.positions.length / 3 / 2, 17);
});

test('ribbon: every triangle faces up, so it is visible from above', () => {
  for (const pts of [[[0, 0], [10, 0]], [[0, 0], [0, -10], [-5, -12]]]) {
    const r = L.ribbon(pts, 2, () => 0, { step: 1 });
    const P = r.positions, I = r.indices;
    for (let t = 0; t < I.length; t += 3) {
      const [a, b, c] = [I[t], I[t + 1], I[t + 2]].map(i => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]);
      const u = [b[0] - a[0], b[2] - a[2]], v = [c[0] - a[0], c[2] - a[2]];
      const ny = u[1] * v[0] - u[0] * v[1];         // y of (b-a) x (c-a) when all y are 0
      assert.ok(ny > 0, `triangle ${t / 3} faces down`);
    }
  }
});

test('pointAt finds the middle of an L-shaped path', () => {
  const m = L.pointAt([[0, 0], [10, 0], [10, 10]], 0.5);
  assert.ok(Math.abs(m[0] - 10) < 1e-9 && Math.abs(m[1]) < 1e-9);
});

test('utf8ToBase64 encodes Chinese the same way as Buffer', () => {
  const s = '{"name":"神明專用"}';
  assert.equal(L.utf8ToBase64(s), Buffer.from(s, 'utf8').toString('base64'));
});

test('serialize stamps the time and parses back to the same layout', () => {
  const lay = L.normalizeLayout(sample());
  const txt = L.serialize(lay, new Date('2026-11-09T01:02:03Z'));
  const back = JSON.parse(txt);
  assert.equal(back.updated, '2026-11-09T01:02:03.000Z');
  assert.deepEqual(L.normalizeLayout(back).items, lay.items);
  assert.ok(txt.endsWith('\n'));
});

/* ---------- publishing to GitHub ---------- */
// a Contents API answer holding this layout; content wrapped at 60 characters like GitHub does
const remote = (layout, sha) => ({ status: 200, body: { sha, content: Buffer.from(JSON.stringify(layout), 'utf8').toString('base64').replace(/(.{60})/g, '$1\n') } });
const BASE = () => ({ ...sample(), updated: '2026-11-08T00:00:00.000Z' });
const NEWER = () => { const l = BASE(); l.updated = '2026-11-09T10:00:00.000Z'; l.places.B.name = '別台裝置改的'; return l; };

test('fingerprint ignores the time stamp and formatting, but not the content', () => {
  const a = BASE(), b = { ...BASE(), updated: '2030-01-01T00:00:00.000Z' };
  assert.equal(L.fingerprint(a), L.fingerprint(b));
  assert.equal(L.fingerprint(a), L.fingerprint(JSON.parse(JSON.stringify(a, null, 4))));
  assert.notEqual(L.fingerprint(a), L.fingerprint(NEWER()));
});

test('publish stops when the website has a newer version than the one the edits started from', async () => {
  const f = fakeFetch([remote(NEWER(), 'abc')]);
  const res = await L.publish({ ...pubArgs(f), baseFingerprint: L.fingerprint(BASE()) });
  assert.equal(res.ok, false);
  assert.equal(res.code, 'conflict');
  assert.equal(res.remoteUpdated, '2026-11-09T10:00:00.000Z');
  assert.equal(f.calls.length, 1, 'nothing was written');
});

test('publish notices a change made straight on GitHub even if the time stamp was left alone', async () => {
  const edited = BASE(); edited.places.P2.staff.push('直接在 GitHub 加的人');
  const f = fakeFetch([remote(edited, 'abc')]);
  const res = await L.publish({ ...pubArgs(f), baseFingerprint: L.fingerprint(BASE()) });
  assert.equal(res.code, 'conflict');
});

test('publish asks when it cannot tell which version the edits started from', async () => {
  const f = fakeFetch([remote(BASE(), 'abc')]);
  const res = await L.publish({ ...pubArgs(f), baseFingerprint: null });
  assert.equal(res.code, 'conflict');
});

test('publish goes ahead when the website still has the version the edits started from', async () => {
  const f = fakeFetch([remote({ ...BASE(), updated: '2026-11-08T05:00:00.000Z' }, 'abc'), { status: 200, body: { content: { sha: 'def' } } }]);
  const res = await L.publish({ ...pubArgs(f), baseFingerprint: L.fingerprint(BASE()) });
  assert.equal(res.ok, true);
  assert.equal(JSON.parse(f.calls[1].opts.body).sha, 'abc');
});

test('publish with force overwrites a newer version (after the editor said yes)', async () => {
  const f = fakeFetch([remote(NEWER(), 'abc'), { status: 200, body: { content: { sha: 'def' } } }]);
  const res = await L.publish({ ...pubArgs(f), baseFingerprint: L.fingerprint(BASE()), force: true });
  assert.equal(res.ok, true);
});

test('publish does not retry over a commit that landed meanwhile', async () => {
  const f = fakeFetch([remote(BASE(), 'old'), { status: 409 }, remote(NEWER(), 'fresh')]);
  const res = await L.publish({ ...pubArgs(f), baseFingerprint: L.fingerprint(BASE()) });
  assert.equal(res.code, 'conflict');
  assert.equal(f.calls.length, 3);
});

function fakeFetch(script) {
  const calls = [];
  const fn = async (url, opts = {}) => {
    calls.push({ url, opts });
    const step = script.shift();
    if (!step) throw new Error('unexpected request ' + url);
    if (step.throw) throw new TypeError('Failed to fetch');
    return { ok: step.status >= 200 && step.status < 300, status: step.status, json: async () => step.body || {} };
  };
  fn.calls = calls;
  return fn;
}
const pubArgs = (fetch) => ({ fetch, token: 'tok123', repo: 'TX-Huang/baohua-3d-map', branch: 'main', path: 'layout.json',
  text: '{"name":"神明專用"}\n', message: '更新地圖配置' });

test('publish reads the current sha, then PUTs base64 content with the token', async () => {
  const f = fakeFetch([{ status: 200, body: { sha: 'abc' } }, { status: 200, body: { content: { sha: 'def' } } }]);
  const res = await L.publish(pubArgs(f));
  assert.deepEqual(res, { ok: true, sha: 'def' });
  assert.equal(f.calls.length, 2);
  assert.match(f.calls[0].url, /^https:\/\/api\.github\.com\/repos\/TX-Huang\/baohua-3d-map\/contents\/layout\.json\?ref=main/);
  assert.equal(f.calls[0].opts.headers.Authorization, 'Bearer tok123');
  assert.equal(f.calls[1].opts.method, 'PUT');
  const body = JSON.parse(f.calls[1].opts.body);
  assert.equal(body.sha, 'abc');
  assert.equal(body.branch, 'main');
  assert.equal(Buffer.from(body.content, 'base64').toString('utf8'), '{"name":"神明專用"}\n');
});

test('publish creates the file when it does not exist yet', async () => {
  const f = fakeFetch([{ status: 404 }, { status: 201, body: { content: { sha: 'new' } } }]);
  const res = await L.publish(pubArgs(f));
  assert.equal(res.ok, true);
  assert.equal(JSON.parse(f.calls[1].opts.body).sha, undefined);
});

test('publish explains failures with a short code', async () => {
  assert.equal((await L.publish(pubArgs(fakeFetch([{ status: 401 }])))).code, 'auth');
  assert.equal((await L.publish(pubArgs(fakeFetch([{ status: 200, body: { sha: 'a' } }, { status: 403 }])))).code, 'forbidden');
  assert.equal((await L.publish(pubArgs(fakeFetch([{ throw: true }])))).code, 'network');
  assert.equal((await L.publish(pubArgs(fakeFetch([{ status: 200, body: { sha: 'a' } }, { status: 500 }])))).code, 'http');
});

test('publish retries once with a fresh sha when the file changed meanwhile', async () => {
  const f = fakeFetch([
    { status: 200, body: { sha: 'old' } }, { status: 409 },
    { status: 200, body: { sha: 'fresh' } }, { status: 200, body: { content: { sha: 'done' } } },
  ]);
  const res = await L.publish(pubArgs(f));
  assert.equal(res.ok, true);
  assert.equal(JSON.parse(f.calls[3].opts.body).sha, 'fresh');
});

test('publish refuses to run without a token', async () => {
  const res = await L.publish({ ...pubArgs(fakeFetch([])), token: '' });
  assert.equal(res.code, 'auth');
});
