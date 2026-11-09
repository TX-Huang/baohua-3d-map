// Browser tests for the built page (index.html + layout.json), driven by Playwright's Chromium.
// Run `npm run build` first, then: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8', '.js': 'text/javascript' };
let server, base, browser;

test.before(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/`;
  browser = await chromium.launch();
});
test.after(async () => { await browser?.close(); server?.close(); });

const PUBLISHED = JSON.parse(fs.readFileSync(path.join(ROOT, 'layout.json'), 'utf8'));
// the site's own layout.json (not the GitHub API URL, which also ends in layout.json)
const siteLayout = (url) => url.hostname === '127.0.0.1' && url.pathname === '/layout.json';

async function open(query = '?debug', { viewport = { width: 1280, height: 800 }, context, layout } = {}) {
  const ctx = context || await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  if (layout !== undefined) {
    await page.route(siteLayout, route => layout === 404
      ? route.fulfill({ status: 404, body: '' })
      : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(layout) }));
  }
  await page.goto(base + query);
  await page.waitForFunction(() => window.__map && window.__map.ready === true, null, { timeout: 30000 });
  return { page, ctx, errors };
}
const pts = (page) => page.evaluate(() => window.__map.points());
const lay = (page) => page.evaluate(() => window.__map.layout());
async function waitIdle(page) { await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))); }
async function groundScreen(page, x, z) {
  return page.evaluate(([x, z]) => window.__map.screenOf(x, window.__map.yAt(x, z), z), [x, z]);
}
async function pinCenter(page, id) {
  const box = await page.locator(`.pin[data-id="${id}"] .pin-tag`).boundingBox();
  assert.ok(box, `pin ${id} is on screen`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
async function dragPin(page, id, dx, dz) {
  const p = (await pts(page)).find(q => q.id === id);
  const from = await groundScreen(page, p.x, p.z);
  const to = await groundScreen(page, p.x + dx, p.z + dz);
  const start = await pinCenter(page, id);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (let k = 1; k <= 8; k++) await page.mouse.move(start.x + (to.x - from.x) * k / 8, start.y + (to.y - from.y) * k / 8);
  await page.mouse.up();
  await waitIdle(page);
  return { x: p.x + dx, z: p.z + dz, before: p };
}

/* ---------------- viewing ---------------- */
test('一般模式：讀 layout.json，標籤都在，看不到編輯工具', async () => {
  const { page, ctx, errors } = await open('?debug');
  const ids = (await pts(page)).map(p => p.id);
  for (const id of ['A', 'B', 'D', 'E', 'I', 'J', 'P1', 'P2', 'reg']) assert.ok(ids.includes(id), `has ${id}`);
  assert.equal(await page.locator('#editbar').isVisible(), false);
  assert.equal(await page.locator('.pin[data-id="B"] .pin-name').textContent(), PUBLISHED.places.B.name);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('一般模式：#reg 會打開登記處卡片，顯示工作人員', async () => {
  const { page, ctx } = await open('?debug#reg');
  await page.locator('#card').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#cardName').textContent(), '登記處');
  assert.deepEqual(await page.locator('#cardStaffList li').allTextContents(), PUBLISHED.items.find(i => i.id === 'reg').staff);
  assert.equal(await page.locator('#editForm').isVisible(), false);
  await ctx.close();
});

test('一般模式：layout.json 換了，網站就跟著變', async () => {
  const changed = JSON.parse(JSON.stringify(PUBLISHED));
  const reg = changed.items.find(i => i.id === 'reg');
  changed.items.push({ ...reg, id: 't9', name: '茶水桌', glyph: '茶', lon: reg.lon + 0.00005, staff: ['小明'] });
  changed.places.B.name = '寶華主殿';
  const { page, ctx } = await open('?debug', { layout: changed });
  assert.equal(await page.locator('.pin[data-id="t9"] .pin-name').textContent(), '茶水桌');
  assert.equal(await page.locator('.pin[data-id="B"] .pin-name').textContent(), '寶華主殿');
  assert.ok(await page.evaluate(() => !!window.__map.objectFor('t9')), 'table model exists');
  await ctx.close();
});

test('一般模式：layout.json 讀不到時，用網頁內建的資料照常顯示', async () => {
  const { page, ctx, errors } = await open('?debug', { layout: 404 });
  const ids = (await pts(page)).map(p => p.id);
  assert.ok(ids.includes('reg') && ids.includes('B'));
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('一般模式：標籤拖不動', async () => {
  const { page, ctx } = await open('?debug');
  const before = (await pts(page)).find(p => p.id === 'reg');
  await page.evaluate(() => { const p = window.__map.points().find(q => q.id === 'reg'); window.__map.lookAt(p.x, p.z, 45); });
  await waitIdle(page);
  await dragPin(page, 'reg', 6, 0);
  const after = (await pts(page)).find(p => p.id === 'reg');
  assert.ok(Math.hypot(after.x - before.x, after.z - before.z) < 0.01);
  await ctx.close();
});

/* ---------------- editing ---------------- */
test('編輯模式：?edit 會出現編輯工具列', async () => {
  const { page, ctx } = await open('?edit&debug');
  assert.equal(await page.locator('#editbar').isVisible(), true);
  for (const sel of ['[data-add="table"]', '[data-add="tent"]', '[data-add="marker"]', '#drawPath', '#undoBtn', '#publishBtn', '#exitEdit']) {
    assert.equal(await page.locator('#editbar ' + sel).count(), 1, sel);
  }
  await ctx.close();
});

test('編輯模式：新增桌子、改名字和工作人員，重新整理後還在（草稿）', async () => {
  const { page, ctx } = await open('?edit&debug');
  await page.click('[data-add="table"]');
  const L1 = await lay(page);
  assert.equal(L1.items.length, PUBLISHED.items.length + 1);
  const id = L1.items[L1.items.length - 1].id;
  assert.ok(await page.evaluate((id) => !!window.__map.objectFor(id), id), '3D table exists');
  await page.locator('#editForm').waitFor({ state: 'visible' });
  await page.fill('#editForm [name="name"]', '茶水桌');
  await page.fill('#editForm [name="staff"]', '王小明\n李大華');
  await waitIdle(page);
  assert.equal(await page.locator(`.pin[data-id="${id}"] .pin-name`).textContent(), '茶水桌');
  const item = (await lay(page)).items.find(i => i.id === id);
  assert.deepEqual(item.staff, ['王小明', '李大華']);

  await page.reload();
  await page.waitForFunction(() => window.__map && window.__map.ready === true);
  const again = (await lay(page)).items.find(i => i.id === id);
  assert.equal(again?.name, '茶水桌', 'draft survives a reload');
  assert.match(await page.locator('#editStatus').textContent(), /未發布|還沒發布/);

  // the normal page on the same device still shows what was published
  const view = await ctx.newPage();
  await view.goto(base + '?debug');
  await view.waitForFunction(() => window.__map && window.__map.ready === true);
  assert.equal((await view.evaluate(() => window.__map.layout())).items.some(i => i.id === id), false);
  await ctx.close();
});

test('編輯模式：拖曳桌子的標籤，桌子移到放開的地方', async () => {
  const { page, ctx } = await open('?edit&debug');
  await page.evaluate(() => { const p = window.__map.points().find(q => q.id === 'reg'); window.__map.lookAt(p.x, p.z, 45); });
  await waitIdle(page);
  const target = await dragPin(page, 'reg', 7, 4);
  const after = (await pts(page)).find(p => p.id === 'reg');
  assert.ok(Math.hypot(after.x - target.x, after.z - target.z) < 1.0, `moved to ${after.x},${after.z}, wanted ${target.x},${target.z}`);
  const obj = await page.evaluate(() => { const o = window.__map.objectFor('reg'); return { x: o.position.x, z: o.position.z }; });
  assert.ok(Math.hypot(obj.x - after.x, obj.z - after.z) < 0.01, '3D model moved with the pin');
  const item = (await lay(page)).items.find(i => i.id === 'reg');
  const local = await page.evaluate(([lon, lat]) => window.__map.toLocal(lon, lat), [item.lon, item.lat]);
  assert.ok(Math.hypot(local.x - after.x, local.z - after.z) < 0.05, 'saved position matches');
  await ctx.close();
});

test('編輯模式：旋轉按鈕一次轉 15 度', async () => {
  const { page, ctx } = await open('?edit&debug#reg');
  await page.locator('#editForm').waitFor({ state: 'visible' });
  const r0 = (await lay(page)).items.find(i => i.id === 'reg').rot;
  await page.click('#editForm [data-rot="15"]');
  const r1 = (await lay(page)).items.find(i => i.id === 'reg').rot;
  assert.ok(Math.abs(((r1 - r0 + 360) % 360) - 15) < 1e-6, `${r0} -> ${r1}`);
  const ry = await page.evaluate(() => window.__map.objectFor('reg').rotation.y);
  assert.ok(Math.abs(Math.cos(ry) - Math.cos(-r1 * Math.PI / 180)) < 1e-6 && Math.abs(Math.sin(ry) - Math.sin(-r1 * Math.PI / 180)) < 1e-6);
  await ctx.close();
});

test('編輯模式：畫一條走道，地上寫「神明專用」', async () => {
  const { page, ctx } = await open('?edit&debug');
  const P2 = (await pts(page)).find(p => p.id === 'P2');
  await page.evaluate(([x, z]) => window.__map.lookAt(x, z, 80), [P2.x, P2.z]);
  await waitIdle(page);
  await page.click('#drawPath');
  assert.equal(await page.locator('#drawbar').isVisible(), true);
  const marks = [[-8, -4], [0, 0], [8, 3]];
  for (const [dx, dz] of marks) {
    const s = await groundScreen(page, P2.x + dx, P2.z + dz);
    await page.mouse.click(s.x, s.y);
  }
  await page.click('#drawDone');
  const L1 = await lay(page);
  assert.equal(L1.paths.length, PUBLISHED.paths.length + 1);
  const p = L1.paths[L1.paths.length - 1];
  assert.equal(p.text, '神明專用');
  assert.equal(p.pts.length, 3);
  const first = await page.evaluate(([lon, lat]) => window.__map.toLocal(lon, lat), p.pts[0]);
  assert.ok(Math.hypot(first.x - (P2.x - 8), first.z - (P2.z - 4)) < 1.0, 'first point is where I clicked');
  const mesh = await page.evaluate((id) => { const o = window.__map.objectFor(id); return o && { type: o.type, n: o.geometry.attributes.position.count }; }, p.id);
  assert.equal(mesh?.type, 'Mesh');
  assert.ok(mesh.n > 10);
  assert.equal(await page.locator(`.pin[data-id="${p.id}"]`).count(), 1);
  assert.equal(await page.locator('#drawbar').isVisible(), false);
  // the form is open for the new walkway
  assert.equal(await page.locator('#editForm [name="text"]').inputValue(), '神明專用');
  await ctx.close();
});

test('編輯模式：改走道的字、寬度、顏色，3D 跟著變', async () => {
  const withPath = JSON.parse(JSON.stringify(PUBLISHED));
  const reg = withPath.items.find(i => i.id === 'reg');
  withPath.paths = [{ id: 'w1', name: '神明走道', text: '神明專用', width: 2, style: 'red',
    pts: [[reg.lon, reg.lat], [reg.lon + 0.0001, reg.lat + 0.00005]], note: '', staff: [] }];
  const { page, ctx } = await open('?edit&debug#w1', { layout: withPath });
  await page.locator('#editForm').waitFor({ state: 'visible' });
  // left edge to right edge of the first cross-section (the right edge is the first vertex with u = 1)
  const width = () => page.evaluate(() => {
    const geo = window.__map.objectFor('w1').geometry, g = geo.attributes.position.array, uv = geo.attributes.uv.array;
    let j = 0; while (uv[j * 2] < 1) j++;
    return Math.hypot(g[0] - g[j * 3], g[2] - g[j * 3 + 2]);
  });
  assert.ok(Math.abs(await width() - 2) < 0.01);
  await page.fill('#editForm [name="width"]', '4');
  await page.fill('#editForm [name="text"]', '請勿通行');
  await page.check('#editForm [name="style"][value="yellow"]');
  await waitIdle(page);
  assert.ok(Math.abs(await width() - 4) < 0.01);
  const p = (await lay(page)).paths[0];
  assert.equal(p.text, '請勿通行');
  assert.equal(p.width, 4);
  assert.equal(p.style, 'yellow');
  await ctx.close();
});

test('編輯模式：刪除後可以復原', async () => {
  const { page, ctx } = await open('?edit&debug#reg');
  await page.locator('#editForm').waitFor({ state: 'visible' });
  await page.click('#deleteBtn');
  assert.equal((await lay(page)).items.some(i => i.id === 'reg'), false);
  assert.equal(await page.locator('.pin[data-id="reg"]').count(), 0);
  assert.equal(await page.evaluate(() => !!window.__map.objectFor('reg')), false);
  await page.click('#undoBtn');
  assert.equal((await lay(page)).items.some(i => i.id === 'reg'), true);
  assert.equal(await page.locator('.pin[data-id="reg"]').count(), 1);
  await ctx.close();
});

test('編輯模式：復原名稱後，表單也跟著變回來', async () => {
  const { page, ctx } = await open('?edit&debug#reg');
  await page.locator('#editForm').waitFor({ state: 'visible' });
  await page.fill('#editForm [name="name"]', '報到處');
  await page.click('#undoBtn');
  assert.equal(await page.inputValue('#editForm [name="name"]'), '登記處');
  assert.equal(await page.locator('.pin[data-id="reg"] .pin-name').textContent(), '登記處');
  // typing again after the undo is its own undo step
  await page.fill('#editForm [name="name"]', '服務台');
  await page.click('#undoBtn');
  assert.equal(await page.inputValue('#editForm [name="name"]'), '登記處');
  await ctx.close();
});

test('座標打錯（離寺廟很遠）的走道和桌子不會讓網頁當掉', async () => {
  const bad = JSON.parse(JSON.stringify(PUBLISHED));
  const reg = bad.items.find(i => i.id === 'reg');
  bad.items.push({ ...reg, id: 't7', name: '很遠的桌子', lon: 0.5, lat: 0.5 });
  bad.paths = [{ id: 'w1', name: '打錯的走道', text: '神明專用', width: 2, style: 'red', pts: [[reg.lon, reg.lat], [0, 0]], note: '', staff: [] }];
  const t0 = Date.now();
  const { page, ctx, errors } = await open('?debug', { layout: bad });
  assert.ok(Date.now() - t0 < 25000);
  assert.deepEqual(errors, []);
  assert.ok((await pts(page)).some(p => p.id === 'reg'));
  await ctx.close();
});

/* ---------------- publishing ---------------- */
// remoteUpdated: the `updated` stamp of layout.json on GitHub right now; putGate: a promise the PUT waits for
async function mockGitHub(page, { getStatus = 200, putStatus = 200, remoteUpdated = PUBLISHED.updated, putGate = null } = {}) {
  const seen = { get: [], put: [] };
  let published = null;
  const remoteLayout = JSON.parse(JSON.stringify(PUBLISHED));
  if (remoteUpdated !== PUBLISHED.updated) { remoteLayout.updated = remoteUpdated; remoteLayout.places.B.name = '別台裝置改的'; }
  const remoteText = JSON.stringify(remoteLayout);
  await page.route('https://api.github.com/**', async route => {
    const req = route.request();
    if (req.method() === 'GET') {
      seen.get.push(req.headers().authorization);
      const content = Buffer.from(published || remoteText, 'utf8').toString('base64').replace(/(.{60})/g, '$1\n');
      return route.fulfill({ status: getStatus, contentType: 'application/json', body: JSON.stringify({ sha: 'sha-old', encoding: 'base64', content }) });
    }
    if (req.method() === 'PUT') {
      const body = JSON.parse(req.postData());
      seen.put.push({ auth: req.headers().authorization, body });
      if (putGate) await putGate;
      if (putStatus < 300) published = Buffer.from(body.content, 'base64').toString('utf8');
      return route.fulfill({ status: putStatus, contentType: 'application/json', body: JSON.stringify({ content: { sha: 'sha-new' } }) });
    }
    return route.fulfill({ status: 405, body: '' });
  });
  // GitHub Pages picks the new file up after the commit
  await page.route(siteLayout, route => route.fulfill({ status: 200, contentType: 'application/json',
    body: published || JSON.stringify(PUBLISHED) }));
  return seen;
}

test('發布：第一次會要鑰匙，送出新的 layout 到 GitHub，成功後清掉草稿', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const seen = await mockGitHub(page);
  await page.goto(base + '?edit&debug');
  await page.waitForFunction(() => window.__map && window.__map.ready === true);
  await page.click('[data-add="tent"]');
  await page.fill('#editForm [name="name"]', '休息帳篷');
  await page.click('#publishBtn');
  await page.locator('#tokenDialog').waitFor({ state: 'visible' });
  await page.fill('#tokenInput', 'test-token-123');
  await page.click('#tokenSave');
  await page.waitForFunction(() => /已發布/.test(document.getElementById('toast').textContent), null, { timeout: 15000 });
  assert.equal(seen.put.length, 1);
  assert.equal(seen.put[0].auth, 'Bearer test-token-123');
  assert.equal(seen.put[0].body.sha, 'sha-old');
  const sent = JSON.parse(Buffer.from(seen.put[0].body.content, 'base64').toString('utf8'));
  assert.ok(sent.items.some(i => i.name === '休息帳篷' && i.type === 'tent'));
  assert.ok(sent.items.some(i => i.id === 'reg'), 'keeps everything else');
  assert.equal(await page.evaluate(() => localStorage.getItem('baohua.draft')), null);
  // second publish does not ask for the key again
  await page.click('[data-add="marker"]');
  await page.click('#publishBtn');
  await page.waitForFunction(() => document.querySelectorAll('#toast').length && window.__map.publishCount() === 2, null, { timeout: 15000 });
  assert.equal(await page.locator('#tokenDialog').isVisible(), false);
  assert.equal(seen.put.length, 2);
  await ctx.close();
});

test('發布：鑰匙不對時說清楚，修改還留著', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await mockGitHub(page, { getStatus: 401 });
  await page.goto(base + '?edit&debug');
  await page.waitForFunction(() => window.__map && window.__map.ready === true);
  await page.evaluate(() => localStorage.setItem('baohua.ghToken', 'bad'));
  await page.click('[data-add="table"]');
  await page.click('#publishBtn');
  await page.waitForFunction(() => /鑰匙/.test(document.getElementById('toast').textContent), null, { timeout: 15000 });
  assert.notEqual(await page.evaluate(() => localStorage.getItem('baohua.draft')), null);
  await ctx.close();
});

/* ---------------- phones ---------------- */
test('手機：編輯工具列和表單不會撐出畫面', async () => {
  const { page, ctx } = await open('?edit&debug', { viewport: { width: 375, height: 812 } });
  await page.click('[data-add="table"]');
  await page.locator('#editForm').waitFor({ state: 'visible' });
  await waitIdle(page);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  for (const sel of ['#editbar', '#card']) {
    const b = await page.locator(sel).boundingBox();
    assert.ok(b.x >= 0 && b.x + b.width <= 375 + 0.5, `${sel} fits across`);
    assert.ok(b.y >= 0 && b.y + b.height <= 812 + 0.5, `${sel} fits down`);
  }
  await ctx.close();
});

/* ---------------- buildings ---------------- */
test('建築：主殿有招牌、柱子、樓梯、燈籠；每棟都有門窗', async () => {
  const { page, ctx } = await open('?debug');
  const info = await page.evaluate(() => {
    const out = {};
    for (const id of ['A', 'B', 'D', 'E', 'I']) {
      const g = window.__map.buildingGroup(id);
      const names = new Set(); let tris = 0;
      g.traverse(o => { if (o.name) names.add(o.name); if (o.isMesh) { const gg = o.geometry; tris += (gg.index ? gg.index.count : gg.attributes.position.count) / 3; } });
      out[id] = { names: [...names], tris };
    }
    return out;
  });
  for (const n of ['signboard', 'columns', 'stairs', 'lanterns']) assert.ok(info.B.names.includes(n), `main hall has ${n}`);
  for (const id of ['A', 'B', 'D', 'E', 'I']) {
    assert.ok(info[id].names.includes('windows') || info[id].names.includes('doors'), `${id} has doors or windows`);
    assert.ok(info[id].tris > 300, `${id} has detail (${info[id].tris} triangles)`);
  }
  await ctx.close();
});

test('發布：網站上有比較新的版本時先問，不會直接蓋掉', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const seen = await mockGitHub(page, { remoteUpdated: '2099-01-01T00:00:00.000Z' });
  await page.goto(base + '?edit&debug');
  await page.waitForFunction(() => window.__map && window.__map.ready === true);
  await page.evaluate(() => localStorage.setItem('baohua.ghToken', 'tok'));
  await page.click('[data-add="table"]');
  let asked = 0;
  page.once('dialog', d => { asked++; d.dismiss(); });
  await page.click('#publishBtn');
  await page.waitForFunction(() => /比較新/.test(document.getElementById('toast').textContent), null, { timeout: 15000 });
  assert.equal(asked, 1, 'asked before overwriting');
  assert.equal(seen.put.length, 0, 'nothing written after "no"');
  assert.notEqual(await page.evaluate(() => localStorage.getItem('baohua.draft')), null);
  page.once('dialog', d => { asked++; d.accept(); });
  await page.click('#publishBtn');
  await page.waitForFunction(() => window.__map.publishCount() === 1, null, { timeout: 15000 });
  assert.equal(asked, 2);
  assert.equal(seen.put.length, 1);
  await ctx.close();
});

test('發布：送出途中又改了東西，那些修改還留在草稿', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  let release;
  const putGate = new Promise(r => { release = r; });
  const seen = await mockGitHub(page, { putGate });
  await page.goto(base + '?edit&debug#reg');
  await page.waitForFunction(() => window.__map && window.__map.ready === true);
  await page.evaluate(() => localStorage.setItem('baohua.ghToken', 'tok'));
  await page.locator('#editForm').waitFor({ state: 'visible' });
  await page.fill('#editForm [name="name"]', '報到處');
  await page.click('#publishBtn');
  for (let k = 0; k < 50 && !seen.put.length; k++) await page.waitForTimeout(100);
  assert.equal(seen.put.length, 1, 'PUT is pending');
  await page.fill('#editForm [name="staff"]', '莛茜\n新來的');
  release();
  await page.waitForFunction(() => window.__map.publishCount() === 1, null, { timeout: 15000 });
  const draft = await page.evaluate(() => localStorage.getItem('baohua.draft'));
  assert.ok(draft, 'the later change is still saved');
  assert.deepEqual(JSON.parse(draft).layout.items.find(i => i.id === 'reg').staff, ['莛茜', '新來的']);
  assert.match(await page.locator('#editStatus').textContent(), /還沒發布/);
  await ctx.close();
});

test('建築：主殿樓梯不在正中間，面向主殿時偏右約 15 公尺（照空拍圖）', async () => {
  const { page, ctx } = await open('?debug');
  const r = await page.evaluate(() => {
    const hall = window.__map.buildingGroup('B').getObjectByName('B');
    const stairs = hall.getObjectByName('stairs');
    const c = new THREE.Box3().setFromObject(stairs).getCenter(new THREE.Vector3());
    const a = -hall.rotation.y, dx = c.x - hall.position.x, dz = c.z - hall.position.z;
    const along = dx * Math.cos(a) + dz * Math.sin(a), across = -dx * Math.sin(a) + dz * Math.cos(a);
    // facing the hall from the front, "right" is +along when the front is +across, and -along otherwise
    return { right: along * Math.sign(across), across };
  });
  assert.ok(Math.abs(r.right - 15.5) < 1.5, `stairs are ${r.right.toFixed(1)} m right of the middle`);
  await ctx.close();
});

test('手機：用手指拖曳登記處的標籤，桌子會跟著移動', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await page.goto(base + '?edit&debug');
  await page.waitForFunction(() => window.__map && window.__map.ready === true);
  await page.evaluate(() => { const p = window.__map.points().find(q => q.id === 'reg'); window.__map.lookAt(p.x, p.z, 40); });
  await waitIdle(page);
  const p = (await pts(page)).find(q => q.id === 'reg');
  const from = await groundScreen(page, p.x, p.z), to = await groundScreen(page, p.x + 4, p.z + 3);
  const start = await pinCenter(page, 'reg');
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
  await touch('touchStart', start.x, start.y);
  for (let k = 1; k <= 10; k++) await touch('touchMove', start.x + (to.x - from.x) * k / 10, start.y + (to.y - from.y) * k / 10);
  await touch('touchEnd');
  await waitIdle(page);
  const after = (await pts(page)).find(q => q.id === 'reg');
  assert.ok(Math.hypot(after.x - (p.x + 4), after.z - (p.z + 3)) < 1.0, `moved to ${after.x.toFixed(1)},${after.z.toFixed(1)}`);
  assert.match(await page.locator('#editStatus').textContent(), /還沒發布/);
  await ctx.close();
});

/* ---- walkways and items on the main hall's stairs and platform ---- */
// The stairs in the hall's own frame (x along the hall, z across it): their middle (cx), the top step
// next to the gate (near), the bottom on the plaza side (far), which way is out (fs), the highest point (top),
// and the sides of the steps themselves (tx0..tx1, without the yellow side walls).
async function hallStairs(page) {
  return page.evaluate(() => {
    const hall = window.__map.buildingGroup('B').getObjectByName('B');
    hall.updateMatrixWorld(true);
    const v = new THREE.Vector3(), lo = new THREE.Vector3(Infinity, Infinity, Infinity), hi = lo.clone().negate();
    let tx0 = Infinity, tx1 = -Infinity;
    const square = (c) => Math.abs(c) < 1e-3 || Math.abs(Math.abs(c) - 1) < 1e-3;
    hall.getObjectByName('stairs').traverse(o => {
      if (!o.isMesh) return;
      const P = o.geometry.attributes.position, N = o.geometry.attributes.normal;
      let steps = true;                          // the steps are plain boxes; the side walls have a sloping top
      for (let i = 0; i < N.count && steps; i++) steps = square(N.getX(i)) && square(N.getY(i)) && square(N.getZ(i));
      for (let i = 0; i < P.count; i++) {
        hall.worldToLocal(v.fromBufferAttribute(P, i).applyMatrix4(o.matrixWorld)); lo.min(v); hi.max(v);
        if (steps) { tx0 = Math.min(tx0, v.x); tx1 = Math.max(tx1, v.x); }
      }
    });
    const [near, far] = Math.abs(lo.z) < Math.abs(hi.z) ? [lo.z, hi.z] : [hi.z, lo.z];
    return { cx: (lo.x + hi.x) / 2, near, far, fs: Math.sign(far - near), top: hi.y, tx0, tx1 };
  });
}
const hallPoint = (page, x, z) => page.evaluate(([x, z]) => {
  const hall = window.__map.buildingGroup('B').getObjectByName('B');
  hall.updateMatrixWorld(true);
  const w = hall.localToWorld(new THREE.Vector3(x, 0, z));
  return { x: w.x, z: w.z };
}, [x, z]);
// height of the hall's own surface (step, floor) under a point, looking down from just above the stairs
const hallFloorBelow = (page, x, z, fromY) => page.evaluate(([x, z, fromY]) => {
  const hall = window.__map.buildingGroup('B').getObjectByName('B');
  const hit = new THREE.Raycaster(new THREE.Vector3(x, fromY, z), new THREE.Vector3(0, -1, 0)).intersectObject(hall, true)[0];
  return hit ? hit.point.y : null;
}, [x, z, fromY]);

test('畫走道：點在主殿樓梯上，點就落在那一階，不是樓梯後面的地面', async () => {
  const { page, ctx } = await open('?edit&debug');
  const S = await hallStairs(page);
  const run = Math.abs(S.far - S.near);
  const step = await hallPoint(page, S.cx, S.near + S.fs * run * 0.25);
  const y = await hallFloorBelow(page, step.x, step.z, S.top + 0.6);
  assert.ok(y !== null, 'there is a step there');
  await page.evaluate(([x, z]) => window.__map.lookAt(x, z, 40), [step.x, step.z]);
  await waitIdle(page);
  await page.click('#drawPath');
  const s = await page.evaluate(([x, y, z]) => window.__map.screenOf(x, y, z), [step.x, y, step.z]);
  await page.mouse.click(s.x, s.y);
  const plaza = await hallPoint(page, S.cx, S.far + S.fs * 6);
  const s2 = await groundScreen(page, plaza.x, plaza.z);
  await page.mouse.click(s2.x, s2.y);
  await page.click('#drawDone');
  const p = (await lay(page)).paths.at(-1);
  const first = await page.evaluate(([lon, lat]) => window.__map.toLocal(lon, lat), p.pts[0]);
  const off = Math.hypot(first.x - step.x, first.z - step.z);
  assert.ok(off < 0.3, `the point landed ${off.toFixed(2)} m away from the step I tapped`);
  await ctx.close();
});

test('畫走道：從旁邊低角度點樓梯中間，點還是落在那一階', async () => {
  const { page, ctx } = await open('?edit&debug');
  const S = await hallStairs(page);
  const run = Math.abs(S.far - S.near);
  const step = await hallPoint(page, S.cx, S.near + S.fs * run * 0.4);
  const y = await hallFloorBelow(page, step.x, step.z, S.top + 0.6);
  // camera off to the side of the stairs (along the hall), low: about 20 degrees above the steps
  const eye = await hallPoint(page, S.cx + 14, S.near + S.fs * run * 0.4);
  await page.evaluate(([t, e, y]) => {
    const m = window.__map;
    m.controls.target.set(t.x, y, t.z); m.camera.position.set(e.x, y + 5, e.z); m.controls.update();
  }, [step, eye, y]);
  await waitIdle(page);
  await page.click('#drawPath');
  const s = await page.evaluate(([x, y, z]) => window.__map.screenOf(x, y, z), [step.x, y, step.z]);
  await page.mouse.click(s.x, s.y);
  await page.mouse.click(s.x, Math.min(s.y + 60, 780));
  await page.click('#drawDone');
  const p = (await lay(page)).paths.at(-1);
  const first = await page.evaluate(([lon, lat]) => window.__map.toLocal(lon, lat), p.pts[0]);
  const off = Math.hypot(first.x - step.x, first.z - step.z);
  assert.ok(off < 0.3, `the point landed ${off.toFixed(2)} m away from the step I tapped`);
  await ctx.close();
});

// a layout with one extra walkway or item, placed in the main hall's frame
async function layoutWithHallThing(make) {
  const probe = await open('?debug');
  const S = await hallStairs(probe.page);
  const local = make(S);
  const lonLat = [];
  for (const [x, z] of local.at) {
    const w = await hallPoint(probe.page, x, z);
    lonLat.push(await probe.page.evaluate(([x, z]) => window.__map.toLonLat(x, z), [w.x, w.z]));
  }
  await probe.ctx.close();
  const layout = JSON.parse(JSON.stringify(PUBLISHED));
  local.add(layout, lonLat);
  return { layout, S };
}

test('走道從廣場走上主殿樓梯到門樓地板：整條鋪在樓梯和地板上面，不會被埋住', async () => {
  const { layout, S } = await layoutWithHallThing(S => {
    const x = S.cx + 1.4;     // beside the incense burner in the middle of the gate
    return {
      at: [[x, S.far + S.fs * 3], [x, S.near - S.fs * 2.4]],
      add: (L, ll) => L.paths.push({ id: 'wstairs', name: '上樓梯', text: '神明專用', style: 'red', width: 1.4,
        pts: ll.map(q => [q.lon, q.lat]), note: '', staff: [] }),
    };
  });
  const { page, ctx, errors } = await open('?debug', { layout });
  const r = await page.evaluate((fromY) => {
    const hall = window.__map.buildingGroup('B').getObjectByName('B');
    const P = window.__map.objectFor('wstairs').geometry.attributes.position, ray = new THREE.Raycaster();
    const out = { onHall: 0, buried: [], floating: [] };
    for (let i = 0; i < P.count; i++) {
      const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
      ray.set(new THREE.Vector3(x, fromY, z), new THREE.Vector3(0, -1, 0));
      const hit = ray.intersectObject(hall, true)[0];
      if (!hit) continue;                       // out on the plaza
      out.onHall++;
      if (y < hit.point.y - 0.01) out.buried.push(+(hit.point.y - y).toFixed(2));
      // a straight carpet over steps touches their front edges; behind each edge it is one step height above
      else if (y - hit.point.y > 0.35) out.floating.push(+(y - hit.point.y).toFixed(2));
    }
    return out;
  }, S.top + 0.6);
  assert.ok(r.onHall >= 8, `${r.onHall} corners of the walkway are on the stairs or the floor`);
  assert.deepEqual(r.buried, [], 'metres under the steps / floor');
  assert.deepEqual(r.floating, [], 'metres above the steps / floor');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('桌子放在主殿門樓的地板上：站在地板上，不會陷進去', async () => {
  const { layout, S } = await layoutWithHallThing(S => ({
    at: [[S.cx + 2.0, S.near - S.fs * 1.5]],
    add: (L, [q]) => L.items.push({ id: 'tgate', type: 'table', name: '門樓桌', glyph: '桌', lon: q.lon, lat: q.lat, rot: 0, note: '', staff: [] }),
  }));
  const { page, ctx } = await open('?debug', { layout });
  const g = await page.evaluate(() => { const o = window.__map.objectFor('tgate'); return { x: o.position.x, y: o.position.y, z: o.position.z }; });
  const floor = await hallFloorBelow(page, g.x, g.z, S.top + 0.6);
  assert.ok(floor !== null, 'the table is over the gate floor');
  assert.ok(g.y >= floor - 0.01 && g.y - floor < 0.2, `table stands at ${g.y.toFixed(2)}, floor is ${floor.toFixed(2)}`);
  await ctx.close();
});

test('走道一邊超出樓梯：鋪在台階上的部分還是在台階上面', async () => {
  const { layout, S } = await layoutWithHallThing(S => {
    // 2 m wide, columns every 0.25 m: the side of the steps falls between two columns, 0.17 m from one of them
    const x = S.tx1 - 0.42;
    return {
      at: [[x, S.far + S.fs * 3], [x, S.near + S.fs * 0.6]],
      add: (L, ll) => L.paths.push({ id: 'wside', name: '偏一邊', text: '神明專用', style: 'red', width: 2,
        pts: ll.map(q => [q.lon, q.lat]), note: '', staff: [] }),
    };
  });
  const { page, ctx } = await open('?debug', { layout });
  const r = await page.evaluate(([fromY, tx0, tx1]) => {
    const hall = window.__map.buildingGroup('B').getObjectByName('B');
    hall.updateMatrixWorld(true);
    const geo = window.__map.objectFor('wside').geometry, P = geo.attributes.position, I = geo.index.array;
    const ray = new THREE.Raycaster(), A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
    const out = { checked: 0, buried: [] };
    for (let t = 0; t < I.length; t += 3) {
      A.fromBufferAttribute(P, I[t]); B.fromBufferAttribute(P, I[t + 1]); C.fromBufferAttribute(P, I[t + 2]);
      for (const [a, b, c] of [[1 / 3, 1 / 3, 1 / 3], [0.6, 0.2, 0.2], [0.2, 0.6, 0.2], [0.2, 0.2, 0.6]]) {
        const q = A.clone().multiplyScalar(a).addScaledVector(B, b).addScaledVector(C, c);
        const lx = hall.worldToLocal(q.clone()).x;
        if (lx < tx0 + 0.05 || lx > tx1 - 0.05) continue;    // only points over the steps, right up to their sides
        ray.set(new THREE.Vector3(q.x, fromY, q.z), new THREE.Vector3(0, -1, 0));
        const hit = ray.intersectObject(hall, true)[0];
        if (!hit || hit.face.normal.y < 0.99) continue;      // flat tops of steps and floor only
        out.checked++;
        if (q.y < hit.point.y - 0.01) out.buried.push(+(hit.point.y - q.y).toFixed(2));
      }
    }
    return out;
  }, [S.top + 0.6, S.tx0, S.tx1]);
  assert.ok(r.checked >= 10, `${r.checked} points over the steps checked`);
  assert.deepEqual(r.buried.slice(0, 10), [], `${r.buried.length} points are under the steps (metres)`);
  await ctx.close();
});

/* ---------------- trees ---------------- */
// Every trunk and crown in the scene, measured in world metres and matched to its tree in the map data.
async function treeReport(page) {
  return page.evaluate(() => {
    const m = window.__map, T = m.trees, data = window.MAPDATA.trees;
    T.updateMatrixWorld(true);
    const trunks = T.getObjectByName('tree-trunks'), crowns = T.children.filter(o => o.name === 'tree-crowns');
    const M = new THREE.Matrix4(), v = new THREE.Vector3(), pos = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
    const key = (x, z) => `${x.toFixed(1)},${z.toFixed(1)}`;
    const trees = new Map(data.map(([x, z, r]) => [key(x, z), { r, ground: m.yAt(x, z) }]));
    const measure = (mesh, i) => {
      mesh.getMatrixAt(i, M); M.premultiply(mesh.matrixWorld); M.decompose(pos, q, sc);
      const P = mesh.geometry.attributes.position; let lo = Infinity, hi = -Infinity, reach = 0;
      for (let k = 0; k < P.count; k++) {
        v.fromBufferAttribute(P, k).applyMatrix4(M);
        lo = Math.min(lo, v.y); hi = Math.max(hi, v.y); reach = Math.max(reach, Math.hypot(v.x - pos.x, v.z - pos.z));
      }
      return { k: key(pos.x, pos.z), lo, hi, reach };
    };
    const trunkAt = new Map(), problems = [];
    if (trunks) for (let i = 0; i < trunks.count; i++) { const t = measure(trunks, i); trunkAt.set(t.k, t); }
    let nCrowns = 0, tris = 0;
    for (const mesh of [trunks, ...crowns].filter(Boolean)) {
      const g = mesh.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3 * mesh.count;
    }
    for (const mesh of crowns) for (let i = 0; i < mesh.count; i++) {
      nCrowns++;
      const c = measure(mesh, i), t = trunkAt.get(c.k), tree = trees.get(c.k);
      if (!tree) { problems.push(`crown at ${c.k} has no tree in the data`); continue; }
      if (c.lo < tree.ground + 1.5) problems.push(`crown at ${c.k} hangs ${(c.lo - tree.ground).toFixed(2)} m above the ground`);
      if (c.reach > tree.r + 0.02) problems.push(`crown at ${c.k} reaches ${c.reach.toFixed(2)} m, data says ${tree.r}`);
      if (!t) { problems.push(`crown at ${c.k} has no trunk`); continue; }
      if (t.lo > tree.ground - 0.2) problems.push(`trunk at ${c.k} starts ${(t.lo - tree.ground).toFixed(2)} m from the ground (floats)`);
      if (t.hi < c.lo + 0.5) problems.push(`trunk at ${c.k} stops ${(c.lo - t.hi).toFixed(2)} m below its crown`);
    }
    const shading = crowns.map(mesh => {
      const P = mesh.geometry.attributes.position, C = mesh.geometry.attributes.color;
      if (!C) return null;
      const vs = []; for (let k = 0; k < P.count; k++) vs.push([P.getY(k), (C.getX(k) + C.getY(k) + C.getZ(k)) / 3]);
      vs.sort((a, b) => a[0] - b[0]);
      const n = Math.max(1, Math.floor(vs.length / 4)), mean = (a) => a.reduce((s, x) => s + x[1], 0) / a.length;
      return { low: mean(vs.slice(0, n)), top: mean(vs.slice(-n)) };
    });
    return { nData: data.length, nTrunks: trunks ? trunks.count : 0, nCrowns, problems, shading, tris };
  });
}

test('樹：每棵都有樹幹，從地下長進樹冠裡；樹冠離地至少 1.5 公尺，也不會比資料裡的大', async () => {
  const { page, ctx, errors } = await open('?debug');
  const r = await treeReport(page);
  assert.equal(r.nTrunks, r.nData, 'one trunk per tree');
  assert.equal(r.nCrowns, r.nData, 'one crown per tree');
  assert.deepEqual(r.problems.slice(0, 10), [], `${r.problems.length} problems`);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('樹：樹冠下面比上面暗，像曬不到太陽', async () => {
  const { page, ctx } = await open('?debug');
  const r = await treeReport(page);
  assert.ok(r.shading.length >= 1, 'has crowns');
  for (const s of r.shading) {
    assert.ok(s, 'crown has shading colours');
    assert.ok(s.low < s.top * 0.85, `bottom ${s.low.toFixed(2)} vs top ${s.top.toFixed(2)}`);
  }
  await ctx.close();
});

test('樹：全部加起來不超過 70 萬個三角形（手機才跑得動）', async () => {
  const { page, ctx } = await open('?debug');
  const r = await treeReport(page);
  assert.ok(r.tris > 0 && r.tris <= 700000, `${r.tris} triangles`);
  await ctx.close();
});

test('樹：切到空拍照時樹幹和樹冠都藏起來，切回來又出現', async () => {
  const { page, ctx } = await open('?debug');
  const shown = () => page.evaluate(() => {
    const T = window.__map.trees, out = [];
    window.__map.scene.traverse(o => { if (/^tree-/.test(o.name)) { let vis = true; for (let p = o; p; p = p.parent) vis = vis && p.visible; out.push(vis); } });
    return { n: out.length, visible: out.filter(Boolean).length, inGroup: !!T };
  });
  const before = await shown();
  assert.ok(before.inGroup && before.n >= 2, `tree meshes: ${before.n}`);
  assert.equal(before.visible, before.n);
  await page.click('#photoToggle');
  assert.equal((await shown()).visible, 0);
  await page.click('#photoToggle');
  assert.equal((await shown()).visible, before.n);
  await ctx.close();
});

test('樹：舊手機算不準小數時不畫葉子花紋（才不會變成雜訊），一般手機照畫', async () => {
  const leafy = (page) => page.evaluate(() => {
    const m = window.__map, gl = m.renderer.getContext();
    m.renderer.render(m.scene, m.camera);
    return { precision: m.renderer.capabilities.precision,
      leafy: m.renderer.info.programs.some(p => /leafHash/.test(gl.getShaderSource(p.fragmentShader))) };
  });
  const normal = await open('?debug');
  assert.deepEqual(await leafy(normal.page), { precision: 'highp', leafy: true });
  await normal.ctx.close();
  // a phone whose GPU has no high-precision floats in pixel shaders
  const ctx = await browser.newContext({ viewport: { width: 800, height: 600 } });
  await ctx.addInitScript(() => {
    for (const C of [WebGLRenderingContext, WebGL2RenderingContext]) {
      const orig = C.prototype.getShaderPrecisionFormat;
      C.prototype.getShaderPrecisionFormat = function (shader, type) {
        return type === this.HIGH_FLOAT ? { rangeMin: 0, rangeMax: 0, precision: 0 } : orig.call(this, shader, type);
      };
    }
  });
  const old = await open('?debug', { context: ctx });
  assert.deepEqual(await leafy(old.page), { precision: 'mediump', leafy: false });
  assert.deepEqual(old.errors, []);
  await ctx.close();
});
