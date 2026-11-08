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
  const width = () => page.evaluate(() => { const g = window.__map.objectFor('w1').geometry.attributes.position.array; return Math.hypot(g[0] - g[3], g[2] - g[5]); });
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
