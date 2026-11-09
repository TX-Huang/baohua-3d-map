/* ---------------- edit mode (?edit) ----------------
   Add tables / tents / markers, drag them on the ground, draw walkways, edit names, notes and staff.
   Changes are kept as a draft on this device (localStorage) until 「發布」 commits layout.json to GitHub
   with the editor's own key (a fine-grained token that only this browser stores). */
const TOKEN_KEY = 'baohua.ghToken', DRAFT_KEY = 'baohua.draft';
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} },
};
// publishedUpdated / publishedFp: the version on the website (its time stamp and LC.fingerprint).
// baseFp: fingerprint of the version these edits started from (a draft keeps its own; null = unknown).
// Right before publishing, GitHub's copy must still match baseFp, or the editor is asked first.
let publishedUpdated = null, publishedFp = null, baseFp = null, publishCount = 0, draftSaved = true;
const toastEl = document.getElementById('toast');
let toastTimer = null;
function toast(msg, ms = 5000) {
  toastEl.textContent = msg; toastEl.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { toastEl.hidden = true; }, ms);
}
function loadDraft() {
  const s = store.get(DRAFT_KEY); if (!s) return null;
  try { const d = JSON.parse(s); return d && d.layout ? { layout: LC.normalizeLayout(d.layout), baseFp: typeof d.baseFp === 'string' ? d.baseFp : null } : null; }
  catch (e) { return null; }
}
const isDirty = () => publishedFp === null || LC.fingerprint(LAYOUT) !== publishedFp;
function updateStatus() {
  const s = document.getElementById('editStatus'), dirty = isDirty();
  s.textContent = !dirty ? '和網站上的一樣'
    : draftSaved ? '有修改還沒發布（先存在這台裝置）'
    : '有修改還沒發布。這台裝置存不了草稿，關掉網頁前請先發布！';
  s.classList.toggle('dirty', dirty);
}
function saveDraft() {
  if (!isDirty()) { store.del(DRAFT_KEY); draftSaved = true; }
  else draftSaved = store.set(DRAFT_KEY, JSON.stringify({ layout: LAYOUT, baseFp, savedAt: new Date().toISOString() }));
  updateStatus();
}

/* undo */
const undoStack = [];
const undoBtn = document.getElementById('undoBtn');
function snapshot() { undoStack.push(JSON.stringify(LAYOUT)); if (undoStack.length > 80) undoStack.shift(); undoBtn.disabled = false; }
function undo() {
  if (!undoStack.length || drag) return;
  if (drawing) finishDraw(false);
  LAYOUT = LC.normalizeLayout(JSON.parse(undoStack.pop()));
  undoBtn.disabled = !undoStack.length;
  applyLayout(); saveDraft();
  if (activeId && byId[activeId]) showForm(byId[activeId]);
}
function changedRebuild() { applyLayout(); saveDraft(); }

/* adding things */
function addAtCentre(type) {
  if (drawing) finishDraw(false);
  const r = stage.getBoundingClientRect();
  const g = groundAt(r.left + r.width / 2, r.top + r.height * 0.42) || { x: controls.target.x, z: controls.target.z };
  const off = camera.position.clone().sub(controls.target);
  const th = Math.atan2(-off.x, -off.z);                 // turn the front of the new item toward the camera
  const ll = toLonLat(g.x, g.z);
  snapshot();
  const it = LC.addItem(LAYOUT, type, ll.lon, ll.lat, -th * 180 / Math.PI);
  if (!it) { undoStack.pop(); toast('東西太多了，加不進去。'); return; }
  changedRebuild();
  select(it.id, { fly: false });
  toast(`加了一個${LC.ITEM_TYPES[type].label}。拖曳它的標籤就能移動。`, 4000);
}

/* dragging items (by their pin or the model itself) and walkway corners */
let drag = null;
function startDrag(e, d) {
  e.preventDefault(); e.stopPropagation();
  const p = byId[d.id];
  const [gx, gz] = d.kind === 'item' ? [p.x, p.z] : p.local[d.idx];
  const s = screenOf(gx, surfaceAt(gx, gz), gz);
  drag = { ...d, pointerId: e.pointerId, ox: e.clientX - s.x, oy: e.clientY - s.y, sx: e.clientX, sy: e.clientY, moved: false };
  window.addEventListener('pointermove', onDragMove, true);
  window.addEventListener('pointerup', onDragEnd, true);
  window.addEventListener('pointercancel', onDragEnd, true);
}
function onDragMove(e) {
  if (!drag || e.pointerId !== drag.pointerId) return;
  if (!drag.moved) {
    if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 4) return;
    drag.moved = true; snapshot(); document.body.classList.add('dragging');
  }
  const g = groundAt(e.clientX - drag.ox, e.clientY - drag.oy);
  if (!g) return;
  if (drag.kind === 'item') moveItemLive(drag.id, g.x, g.z);
  else {
    const p = byId[drag.id], local = p.local.map(q => q.slice());
    local[drag.idx] = [g.x, g.z];
    reshapePathLive(drag.id, local, LC.findEntity(LAYOUT, drag.id).obj.width);
  }
}
function onDragEnd(e) {
  if (!drag || e.pointerId !== drag.pointerId) return;
  window.removeEventListener('pointermove', onDragMove, true);
  window.removeEventListener('pointerup', onDragEnd, true);
  window.removeEventListener('pointercancel', onDragEnd, true);
  const d = drag; drag = null; document.body.classList.remove('dragging');
  if (!d.moved) return;                          // just a click: the click handler selects it
  markDragEnd();
  const p = byId[d.id];
  if (d.kind === 'item') { const ll = toLonLat(p.x, p.z); LC.updateEntity(LAYOUT, d.id, { lon: ll.lon, lat: ll.lat }); }
  else LC.updateEntity(LAYOUT, d.id, { pts: p.local.map(([x, z]) => { const ll = toLonLat(x, z); return [ll.lon, ll.lat]; }) });
  saveDraft();
  if (activeId !== d.id) select(d.id, { fly: false }); else refreshCard();
}

/* drawing a walkway: tap points on the ground, then 完成 */
let drawing = null;
const drawbar = document.getElementById('drawbar'), editbarRow = document.getElementById('editbarRow');
function startDraw() {
  deselect();
  drawing = { pts: [], mesh: null };
  drawbar.hidden = false; editbarRow.hidden = true;
  pinLayer.classList.add('drawing');
  updateDrawHint();
}
function updateDrawHint() {
  const n = drawing ? drawing.pts.length : 0;
  document.getElementById('drawHint').textContent = n < 2
    ? `在地上點一下，放走道的點（已放 ${n} 個，至少 2 個）`
    : `已放 ${n} 個點。可以繼續點，或按「完成」`;
  document.getElementById('drawUndo').disabled = n === 0;
}
function refreshDrawPreview() {
  if (drawing.mesh) { pathRoot.remove(drawing.mesh); drawing.mesh.geometry.dispose(); drawing.mesh = null; }
  if (drawing.pts.length >= 2) {
    const { g } = pathGeometry(drawing.pts, LC.PATH_WIDTH.def);
    drawing.mesh = new THREE.Mesh(g, pathTexture(LC.PATH_DEFAULTS.style, LC.PATH_DEFAULTS.text).material);
    drawing.mesh.renderOrder = 1; pathRoot.add(drawing.mesh);
  }
  updateDrawHint(); needsRender = true;
}
function finishDraw(save) {
  if (!drawing) return;
  if (save && drawing.pts.length < 2) { toast('走道至少要放兩個點。'); return; }
  const d = drawing; drawing = null;
  if (d.mesh) { pathRoot.remove(d.mesh); d.mesh.geometry.dispose(); }
  drawbar.hidden = true; editbarRow.hidden = false;
  pinLayer.classList.remove('drawing');
  needsRender = true;
  if (!save) return;
  snapshot();
  const p = LC.addPath(LAYOUT, d.pts.map(([x, z]) => { const ll = toLonLat(x, z); return [ll.lon, ll.lat]; }));
  if (!p) { undoStack.pop(); toast('走道太多了，加不進去。'); return; }
  changedRebuild();
  select(p.id, { fly: false });
  toast('走道畫好了。下面可以改地上的字、寬度和顏色；拖曳白色圓點可以調整位置。', 6000);
}

/* corner handles (and the dots while drawing) live in the pin layer */
const handleEls = [];
function handlePoints() {
  if (drawing) return drawing.pts;
  const p = activeId && byId[activeId];
  return p && p.kind === 'path' ? p.local : [];
}
function placeHandles(w, h) {
  const pts = handlePoints();
  while (handleEls.length > pts.length) handleEls.pop().remove();
  while (handleEls.length < pts.length) {
    const idx = handleEls.length, b = document.createElement('button');
    b.type = 'button'; b.className = 'vhandle'; b.setAttribute('aria-label', `走道第 ${idx + 1} 個點，拖曳可以移動`);
    b.addEventListener('pointerdown', (e) => { if (drawing || e.button > 0 || !activeId) return; startDrag(e, { kind: 'vertex', id: activeId, idx }); });
    pinLayer.append(b); handleEls.push(b);
  }
  pts.forEach(([x, z], i) => {
    const el = handleEls[i];
    v.set(x, surfaceAt(x, z) + 0.1, z).project(camera);
    const vis = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
    el.hidden = !vis;
    el.classList.toggle('dot', !!drawing);
    if (vis) el.style.transform = `translate3d(${((v.x + 1) / 2 * w).toFixed(1)}px, ${((1 - v.y) / 2 * h).toFixed(1)}px, 0)`;
  });
}

/* the edit form inside the card */
const form = document.getElementById('editForm');
const widthOut = document.getElementById('widthOut');
let armed = true;
const entityOf = (p) => (p.fixed ? (LAYOUT.places[p.id] || { name: '', glyph: '', note: '', staff: [] }) : LC.findEntity(LAYOUT, p.id).obj);
function showForm(p) {
  const e = entityOf(p), F = form.elements;
  form.dataset.kind = p.fixed ? 'place' : p.kind;
  F.name.value = e.name || ''; F.name.placeholder = p.fixed ? p.name : '';
  F.glyph.value = e.glyph || ''; F.glyph.placeholder = p.glyph;
  F.note.value = e.note || '';
  F.staff.value = (e.staff || []).join('\n');
  if (p.kind === 'path') {
    F.text.value = e.text; F.width.value = e.width; widthOut.textContent = e.width;
    for (const r of form.querySelectorAll('[name="style"]')) r.checked = r.value === e.style;
  }
  form.hidden = false; armed = true;
  needsRender = true;
}
function hideForm() { form.hidden = true; needsRender = true; }
function onFormInput(ev) {
  const t = ev.target, id = activeId, p = byId[id];
  if (!t.name || !p) return;
  const patch = {};
  if (t.name === 'style') { if (!t.checked) return; patch.style = t.value; }
  else patch[t.name] = t.value;
  if (armed) { snapshot(); armed = false; }
  const e = LC.updateEntity(LAYOUT, id, patch);
  if (!e) return;
  if (p.fixed) placePoint(p);
  else Object.assign(p, { name: e.name, note: e.note, staff: e.staff }, p.kind === 'item' ? { glyph: e.glyph } : {});
  if (p.kind === 'path') {
    if ('width' in patch) { widthOut.textContent = e.width; reshapePathLive(id, p.local, e.width); }
    if ('text' in patch || 'style' in patch) restylePathLive(id, e.style, e.text);
  }
  relabel(id);
  saveDraft();
}
form.addEventListener('focusin', () => { armed = true; });
form.addEventListener('input', onFormInput);
form.addEventListener('change', (ev) => { if (ev.target.name === 'style') onFormInput(ev); armed = true; });
form.addEventListener('submit', (ev) => ev.preventDefault());
for (const b of form.querySelectorAll('[data-rot]')) b.addEventListener('click', () => {
  const p = byId[activeId]; if (!p || p.kind !== 'item') return;
  const it = LC.findEntity(LAYOUT, p.id).obj;
  snapshot();
  LC.updateEntity(LAYOUT, p.id, { rot: it.rot + Number(b.dataset.rot) });
  const g = itemObjs.get(p.id); g.rotation.y = -it.rot * Math.PI / 180;
  Object.assign(p, itemPoint(it));
  saveDraft(); needsRender = true;
});
document.getElementById('flipPath').addEventListener('click', () => {
  const p = byId[activeId]; if (!p || p.kind !== 'path') return;
  const e = LC.findEntity(LAYOUT, p.id).obj;
  snapshot();
  LC.updateEntity(LAYOUT, p.id, { pts: e.pts.slice().reverse() });
  reshapePathLive(p.id, p.local.slice().reverse(), e.width);
  saveDraft();
});
document.getElementById('deleteBtn').addEventListener('click', () => {
  const p = byId[activeId]; if (!p || p.fixed) return;
  snapshot();
  LC.removeEntity(LAYOUT, p.id);
  deselect();
  changedRebuild();
  toast(`已刪除「${p.name}」。按「復原」可以拿回來。`, 5000);
});

/* publishing */
const ERRORS = {
  auth: '鑰匙不對或已經過期。再按一次「發布」，貼上新的鑰匙就好。修改都還留在這台裝置上。',
  forbidden: '這把鑰匙沒有寫入權限：建立鑰匙時，Contents 要選「Read and write」。修改都還留著。',
  notfound: '這把鑰匙看不到 baohua-3d-map：建立鑰匙時要選這個 repository。修改都還留著。',
  network: '網路連不上，還沒發布。修改都還留在這台裝置上，等一下再按一次「發布」。',
  http: 'GitHub 暫時有問題，還沒發布。修改都還留著，等一下再試。',
  conflict: '網站上有比較新的版本，還沒發布。修改都還留在這台裝置上。',
  conflictKept: '沒有發布：網站上有比較新的版本。修改都還留在這台裝置上。',
};
const publishBtn = document.getElementById('publishBtn');
let publishing = false;
function askToken() {
  const dlg = document.getElementById('tokenDialog'), input = document.getElementById('tokenInput');
  const save = document.getElementById('tokenSave'), cancel = document.getElementById('tokenCancel');
  input.value = '';
  return new Promise((resolve) => {
    const done = (val) => { save.onclick = cancel.onclick = null; dlg.removeEventListener('cancel', onEsc); if (dlg.open) dlg.close(); resolve(val); };
    const onEsc = (e) => { e.preventDefault(); done(null); };
    save.onclick = () => { const val = input.value.trim(); if (!val) { input.focus(); return; } store.set(TOKEN_KEY, val); done(val); };
    cancel.onclick = () => done(null);
    dlg.addEventListener('cancel', onEsc);
    dlg.showModal(); input.focus();
  });
}
async function publishNow() {
  if (publishing) return;
  if (drawing) finishDraw(false);
  let token = store.get(TOKEN_KEY);
  if (!token) { token = await askToken(); if (!token) return; }
  publishing = true; publishBtn.disabled = true;
  toast('發布中…', 30000);
  const text = LC.serialize(LAYOUT);
  const send = (force) => LC.publish({ fetch: (u, o) => window.fetch(u, o), token, repo: REPO, branch: BRANCH, path: LAYOUT_FILE, text,
    message: '更新活動地圖（網站編輯模式）', baseFingerprint: baseFp, force });
  let res = await send(false);
  if (!res.ok && res.code === 'conflict') {
    // someone (or another device) published after these edits started: overwrite only if the editor says so
    const when = res.remoteUpdated ? new Date(res.remoteUpdated).toLocaleString('zh-TW', { hour12: false }) : '不明時間';
    if (window.confirm(`網站上的版本比你開始改的時候新（${when} 發布的，可能是別台裝置）。\n\n要用你現在的版本蓋掉它嗎？\n按「取消」就先不發布，修改會留在這台裝置。`)) res = await send(true);
    else res = { ok: false, code: 'conflictKept' };
  }
  publishing = false; publishBtn.disabled = false;
  if (!res.ok) {
    if (res.code === 'auth') store.del(TOKEN_KEY);
    toast(ERRORS[res.code] || ERRORS.http, 12000);
    return;
  }
  const sent = LC.normalizeLayout(JSON.parse(text));
  publishedUpdated = sent.updated; LAYOUT.updated = sent.updated; publishedFp = baseFp = LC.fingerprint(sent);
  publishCount++;
  saveDraft();                 // clears the draft, unless something was changed while the request was out
  toast(isDirty() ? '已發布！發布途中改的東西還沒發布，再按一次「發布」。' : '已發布！大約 1 分鐘後，大家重新整理網頁就會看到。', 9000);
  watchLive(sent.updated);
}
// GitHub Pages takes about a minute to pick the new file up; tell the editor when it is live.
function watchLive(stamp) {
  let n = 0;
  const timer = setInterval(async () => {
    if (++n > 36 || publishedUpdated !== stamp) { clearInterval(timer); return; }
    try {
      const r = await fetch(LAYOUT_FILE + '?t=' + Date.now(), { cache: 'no-store' });
      const j = r.ok ? await r.json() : null;
      if (j && j.updated === stamp) { clearInterval(timer); toast('已發布，大家現在重新整理就看得到了 ✓', 8000); }
    } catch (e) { /* keep waiting */ }
  }, 5000);
}

function initEditor() {
  document.body.classList.add('editing');
  document.getElementById('editbar').hidden = false;
  document.getElementById('hint').textContent = '拖曳桌子的標籤可以移動 · 點標籤或建築可以改資料';
  for (const b of document.querySelectorAll('[data-add]')) b.addEventListener('click', () => addAtCentre(b.dataset.add));
  document.getElementById('drawPath').addEventListener('click', startDraw);
  document.getElementById('drawDone').addEventListener('click', () => finishDraw(true));
  document.getElementById('drawCancel').addEventListener('click', () => finishDraw(false));
  document.getElementById('drawUndo').addEventListener('click', () => { if (drawing && drawing.pts.length) { drawing.pts.pop(); refreshDrawPreview(); } });
  undoBtn.addEventListener('click', undo);
  publishBtn.addEventListener('click', publishNow);
  document.getElementById('forgetToken').addEventListener('click', () => { store.del(TOKEN_KEY); toast('這台裝置上的鑰匙已清除，下次發布會再問一次。'); });
  document.getElementById('exitEdit').addEventListener('click', () => {
    const q = new URLSearchParams(location.search); q.delete('edit');
    const s = q.toString();
    location.href = location.pathname + (s ? '?' + s : '') + location.hash;
  });
  hooks.pinDown = (e, id) => { if (!drawing && e.button === 0 && byId[id] && byId[id].kind === 'item') startDrag(e, { kind: 'item', id }); };
  hooks.tap = (e) => {
    if (!drawing) return false;
    const g = groundAt(e.clientX, e.clientY);
    if (g) { drawing.pts.push([g.x, g.z]); refreshDrawPreview(); }
    return true;
  };
  hooks.show = showForm;
  hooks.hide = hideForm;
  hooks.frame = placeHandles;
  // grab a table / tent / cone itself (not only its pin)
  stage.addEventListener('pointerdown', (e) => {
    if (drawing || drag || e.button !== 0) return;
    const id = pickAt(e.clientX, e.clientY);
    if (id && byId[id].kind === 'item') startDrag(e, { kind: 'item', id });
  }, true);
  window.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); undo(); }
    else if (e.key === 'Escape' && drawing) finishDraw(false);
    else if (e.key === 'Enter' && drawing && !typing) finishDraw(true);
  });
  window.addEventListener('beforeunload', () => { if (drag) onDragEnd({ pointerId: drag.pointerId }); });
  updateStatus();
}
