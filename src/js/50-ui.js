/* ---------------- camera ---------------- */
const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = 0.12; controls.rotateSpeed = 0.75;
controls.minDistance = 18; controls.maxDistance = 900;
controls.maxPolarAngle = THREE.MathUtils.degToRad(78);
controls.screenSpacePanning = false;
controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
const deg = THREE.MathUtils.degToRad;
const offsetFor = (d, polar, az) => new THREE.Vector3(d * Math.sin(polar) * Math.sin(az), d * Math.cos(polar), d * Math.sin(polar) * Math.cos(az));
const homeTarget = (() => {      // middle of the buildings and plazas
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, y = 0;
  for (const p of FIXED) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); y += p.y; }
  return new THREE.Vector3((x0 + x1) / 2, y / FIXED.length - 6, (z0 + z1) / 2);
})();
const HOME = { target: homeTarget, dist: 330, polar: deg(48), az: deg(-10) };
function setView(v) { controls.target.copy(v.target); camera.position.copy(v.target).add(offsetFor(v.dist, v.polar, v.az)); controls.update(); needsRender = true; }
setView(HOME);
const camSph = () => new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));

let tween = null;
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
/* View changes travel along the orbit (angle, tilt, log-distance), not in a straight line,
   so switching to top view or jumping to a place never dips toward the ground or bounces in and out. */
function flyTo(target, offset, ms = 1000) {
  zoomGoal = null;
  if (reduceMotion) { controls.target.copy(target); camera.position.copy(target).add(offset); controls.update(); needsRender = true; return; }
  const from = camSph();
  const to = new THREE.Spherical().setFromVector3(offset);
  let dTheta = to.theta - from.theta; dTheta = Math.atan2(Math.sin(dTheta), Math.cos(dTheta));
  tween = { t0: null, ms, fromT: controls.target.clone(), toT: target.clone(),
            r0: Math.log(from.radius), r1: Math.log(to.radius), p0: from.phi, p1: to.phi, th0: from.theta, th1: from.theta + dTheta };
}
const tmpS = new THREE.Spherical(), tmpV = new THREE.Vector3();
function stepTween(now) {
  if (!tween) return false;
  if (tween.t0 === null) tween.t0 = now;
  const t = Math.min((now - tween.t0) / tween.ms, 1);
  const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  controls.target.lerpVectors(tween.fromT, tween.toT, e);
  tmpS.set(Math.exp(tween.r0 + (tween.r1 - tween.r0) * e), tween.p0 + (tween.p1 - tween.p0) * e, tween.th0 + (tween.th1 - tween.th0) * e);
  camera.position.copy(controls.target).add(tmpV.setFromSpherical(tmpS));
  if (t >= 1) tween = null;
  return true;
}
controls.addEventListener('start', () => { tween = null; });

/* Smooth wheel / trackpad zoom toward the point under the cursor.
   (The stock control zooms a fixed 5% per wheel event, which is jumpy with a mouse and far too fast on a trackpad.) */
let zoomGoal = null;
const zoomAnchor = new THREE.Vector3();
const zoomPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
function onWheel(e) {
  e.preventDefault(); e.stopPropagation();
  tween = null;
  const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
  const k = e.ctrlKey ? 0.012 : 0.0016;          // trackpad pinch arrives as ctrl + small wheel deltas
  const cur = zoomGoal ?? camera.position.distanceTo(controls.target);
  zoomGoal = THREE.MathUtils.clamp(cur * Math.exp(dy * k), controls.minDistance, controls.maxDistance);
  const ray = rayFrom(e.clientX, e.clientY);
  zoomPlane.constant = -controls.target.y;
  if (!ray.ray.intersectPlane(zoomPlane, zoomAnchor)) zoomAnchor.copy(controls.target);
  zoomAnchor.x = Math.min(Math.max(zoomAnchor.x, -W / 2), W / 2);
  zoomAnchor.z = Math.min(Math.max(zoomAnchor.z, -DEP / 2), DEP / 2);
  needsRender = true;
}
for (const el of [stage, pinLayer]) el.addEventListener('wheel', onWheel, { capture: true, passive: false });
const zoomOff = new THREE.Vector3();
function stepZoom(dt) {
  if (zoomGoal === null) return false;
  zoomOff.copy(camera.position).sub(controls.target);
  const r = zoomOff.length();
  const a = 1 - Math.exp(-dt * 13);
  const nr = Math.exp(Math.log(r) + (Math.log(zoomGoal) - Math.log(r)) * a);
  const s = nr / r;
  // scale camera and target about the anchor, so the ground under the cursor stays put
  controls.target.sub(zoomAnchor).multiplyScalar(s).add(zoomAnchor);
  camera.position.copy(controls.target).add(zoomOff.multiplyScalar(s));
  if (Math.abs(zoomGoal - nr) < nr * 0.001) zoomGoal = null;
  return true;
}
controls.addEventListener('change', () => {
  const t = controls.target;
  const cx = Math.min(Math.max(t.x, -W / 2), W / 2), cz = Math.min(Math.max(t.z, -DEP / 2), DEP / 2);
  if (cx !== t.x || cz !== t.z) { camera.position.x += cx - t.x; camera.position.z += cz - t.z; t.x = cx; t.z = cz; }
  needsRender = true;
});

/* ---------------- pins, chips, card ---------------- */
// The editor (60-editor.js) plugs into these.
const hooks = { pinDown: null, tap: null, show: null, hide: null, frame: null, chip: null };
const pinEls = new Map();
const chipsEl = document.getElementById('chips');
let activeId = null;
const KIND_CLASS = { hall: 't-hall', bldg: 't-bldg', plaza: 't-plaza', item: 't-checkin', path: 't-path' };
function glyphSpan(p) { const s = document.createElement('span'); s.className = 'glyph' + (p.letterGlyph ? ' letter' : ''); s.textContent = p.glyph; s.setAttribute('aria-hidden', 'true'); return s; }
let lastDragEnd = 0;
const markDragEnd = () => { lastDragEnd = performance.now(); };
function renderPins() {
  for (const el of pinEls.values()) el.remove();
  pinEls.clear();
  for (const p of POINTS) {
    const b = document.createElement('button');
    b.type = 'button'; b.dataset.id = p.id;
    b.className = `pin ${KIND_CLASS[p.kind]}` + (p.isBldg && !p.named ? ' compact' : '') + (p.kind === 'item' ? ' movable' : '');
    b.setAttribute('aria-label', p.name);
    const body = document.createElement('span'); body.className = 'pin-body';
    const tag = document.createElement('span'); tag.className = 'pin-tag';
    tag.append(glyphSpan(p), Object.assign(document.createElement('span'), { className: 'pin-name', textContent: p.name }));
    body.append(tag, Object.assign(document.createElement('span'), { className: 'pin-stem' }), Object.assign(document.createElement('span'), { className: 'pin-foot' }));
    b.append(body);
    b.addEventListener('click', () => { if (performance.now() - lastDragEnd < 350) return; select(p.id, { fly: !EDIT }); });
    b.addEventListener('pointerdown', (e) => { if (hooks.pinDown) hooks.pinDown(e, p.id); });
    if (p.id === activeId) b.classList.add('is-active');
    pinLayer.append(b); pinEls.set(p.id, b);
  }
  renderChips();
  if (activeId && !byId[activeId]) deselect();
  else if (activeId) refreshCard();
  needsRender = true;
}
function addGroup(label) { const s = document.createElement('span'); s.className = 'chip-group'; s.textContent = label; chipsEl.append(s); }
function addChip(p) {
  const c = document.createElement('button'); c.type = 'button'; c.className = `chip ${KIND_CLASS[p.kind]}`; c.dataset.id = p.id;
  if (p.id === activeId) c.classList.add('is-active');
  c.append(glyphSpan(p), document.createTextNode(p.name)); c.addEventListener('click', () => select(p.id)); chipsEl.append(c);
}
const rank = (p) => (p.kind === 'hall' ? 0 : p.named ? 1 : 2);
function renderChips() {
  chipsEl.replaceChildren();
  const events = POINTS.filter(p => p.isEvent);
  if (events.length) { addGroup('活動'); events.forEach(addChip); }
  addGroup('建築'); POINTS.filter(p => p.isBldg).sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id)).forEach(addChip);
  addGroup('廣場'); POINTS.filter(p => p.kind === 'plaza').forEach(addChip);
}
function relabel(id) {      // name / glyph changed while editing: update the pin and chip in place
  const p = byId[id]; if (!p) return;
  const pin = pinEls.get(id);
  if (pin) {
    pin.setAttribute('aria-label', p.name);
    pin.querySelector('.pin-name').textContent = p.name;
    const g = pin.querySelector('.glyph'); g.textContent = p.glyph; g.classList.toggle('letter', !!p.letterGlyph);
    pin.classList.toggle('compact', p.isBldg && !p.named);
  }
  const chip = chipsEl.querySelector(`.chip[data-id="${CSS.escape(id)}"]`);
  if (chip) { chip.replaceChildren(glyphSpan(p), document.createTextNode(p.name)); }
  if (id === activeId) refreshCard();
}

const card = document.getElementById('card');
const cardGlyph = document.getElementById('cardGlyph');
function refreshCard() {
  const p = byId[activeId]; if (!p) return;
  cardGlyph.className = `glyph ${KIND_CLASS[p.kind]}` + (p.letterGlyph ? ' letter' : ''); cardGlyph.textContent = p.glyph;
  document.getElementById('cardName').textContent = p.name;
  const bits = [p.isEvent ? '活動' : p.isBldg ? '建築' : '廣場'];
  if (p.kind === 'item') bits.push(LC.ITEM_TYPES[p.type].label);
  if (p.kind === 'path') bits.push('走道');
  if (p.isBldg && p.named) bits.push(`代號 ${p.id}`);
  if (p.size) bits.push(p.size);
  bits.push(`海拔約 ${p.elev} 公尺`);
  document.getElementById('cardMeta').textContent = bits.join(' · ');
  document.getElementById('cardNote').textContent = p.note;
  document.getElementById('cardTodo').hidden = p.named || EDIT;
  const staffList = document.getElementById('cardStaffList');
  staffList.replaceChildren(...p.staff.map(n => Object.assign(document.createElement('li'), { textContent: n })));
  document.getElementById('cardStaff').hidden = p.staff.length === 0 || EDIT;
  document.getElementById('cardNote').hidden = !p.note || EDIT;
}
function select(id, opt = {}) {
  const p = byId[id]; if (!p) return;
  activeId = id;
  pinLayer.classList.add('pins-dim');
  for (const [k, el] of pinEls) el.classList.toggle('is-active', k === id);
  for (const c of chipsEl.querySelectorAll('.chip[data-id]')) c.classList.toggle('is-active', c.dataset.id === id);
  const chip = chipsEl.querySelector(`.chip[data-id="${CSS.escape(id)}"]`);
  if (chip) chip.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' });
  refreshCard();
  card.hidden = false;
  if (hooks.show) hooks.show(p);
  try { history.replaceState(null, '', location.pathname + location.search + '#' + id); } catch (e) {}
  if (opt.fly !== false) {
    const sph = camSph();
    const dist = p.near ? Math.min(Math.max(sph.radius, 26), 38) : Math.min(Math.max(sph.radius, 60), 130);
    const polar = topView ? 0.001 : Math.min(Math.max(sph.phi, deg(40)), deg(62));
    const theta = p.viewDir && !topView ? Math.atan2(p.viewDir[0], p.viewDir[1]) : sph.theta;
    flyTo(new THREE.Vector3(p.x, p.y - (p.near ? 1 : 2), p.z), offsetFor(dist, polar, theta));
  }
  needsRender = true;
}
function deselect() {
  activeId = null; card.hidden = true; pinLayer.classList.remove('pins-dim');
  for (const el of pinEls.values()) el.classList.remove('is-active');
  for (const c of chipsEl.querySelectorAll('.chip')) c.classList.remove('is-active');
  if (hooks.hide) hooks.hide();
  try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
  needsRender = true;
}
document.getElementById('cardClose').addEventListener('click', deselect);

/* tapping the 3D model: a building, a table or a walkway opens its card */
const pickables = () => [itemRoot, pathRoot, ...Object.values(bldgGroups)];
function pickAt(clientX, clientY) {
  const hits = rayFrom(clientX, clientY).intersectObjects(pickables(), true);
  for (const h of hits) {
    for (let o = h.object; o; o = o.parent) if (o.userData && o.userData.id && byId[o.userData.id]) return o.userData.id;
  }
  return null;
}
(function tapDetector() {
  let down = null, multi = false;
  stage.addEventListener('pointerdown', (e) => {
    if (down) { multi = true; return; }
    down = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() }; multi = false;
  }, true);
  const end = (e) => {
    if (!down || e.pointerId !== down.id) return;
    const d = down; down = null;
    if (multi || e.type === 'pointercancel' || e.button > 0) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6 || performance.now() - d.t > 500) return;
    if (hooks.tap && hooks.tap(e)) return;
    const id = pickAt(e.clientX, e.clientY);
    if (id) select(id, { fly: !EDIT });
  };
  stage.addEventListener('pointerup', end, true);
  stage.addEventListener('pointercancel', end, true);
})();

/* tools */
const viewBtn = document.getElementById('viewToggle');
function setTop(on) { topView = on; viewBtn.setAttribute('aria-pressed', String(on)); }
viewBtn.addEventListener('click', () => {
  setTop(!topView);
  const sph = camSph();
  flyTo(controls.target.clone(), offsetFor(topView ? Math.max(sph.radius, 260) : sph.radius, topView ? 0.001 : deg(55), topView ? 0 : sph.theta));
});
const photoBtn = document.getElementById('photoToggle');
photoBtn.addEventListener('click', () => {
  photoMode = !photoMode;
  photoBtn.setAttribute('aria-pressed', String(photoMode));
  terrainMat.map = photoMode ? photoTex : modelTex;
  terrainMat.needsUpdate = true;
  contourU.value = photoMode ? 0 : 1;
  trees.visible = !photoMode;
  needsRender = true;
});
document.getElementById('homeBtn').addEventListener('click', () => { setTop(false); flyTo(HOME.target.clone(), offsetFor(HOME.dist, HOME.polar, HOME.az)); });
document.getElementById('compass').addEventListener('click', () => {
  const sph = camSph();
  flyTo(controls.target.clone(), offsetFor(sph.radius, sph.phi, 0), 700);
});
const needle = document.getElementById('needle');
const coarse = window.matchMedia('(pointer: coarse)').matches;
document.getElementById('hint').textContent = coarse ? '單指拖曳旋轉 · 雙指縮放、平移 · 點標籤或建築看說明' : '左鍵拖曳旋轉 · 右鍵平移 · 滾輪縮放 · 點標籤或建築看說明';

function applyTheme() { fog.color.set(getComputedStyle(document.documentElement).getPropertyValue('--sky-2').trim() || '#f1f4f1'); needsRender = true; }
window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);
new MutationObserver(applyTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

/* ---------------- render loop ---------------- */
const v = new THREE.Vector3();
function screenOf(x, y, z) {
  v.set(x, y, z).project(camera);
  const rect = renderer.domElement.getBoundingClientRect();
  return { x: rect.left + (v.x + 1) / 2 * rect.width, y: rect.top + (1 - v.y) / 2 * rect.height, behind: v.z >= 1 };
}
function placePins() {
  const w = stage.clientWidth, h = stage.clientHeight;
  for (const p of POINTS) {
    const el = pinEls.get(p.id);
    if (!el) continue;
    v.set(p.x, p.y, p.z).project(camera);
    const vis = v.z < 1 && v.x > -1.15 && v.x < 1.15 && v.y > -1.15 && v.y < 1.25;
    if (el.hidden === vis) el.hidden = !vis;
    if (!vis) continue;
    el.style.transform = `translate3d(${((v.x + 1) / 2 * w).toFixed(1)}px, ${((1 - v.y) / 2 * h).toFixed(1)}px, 0)`;
    const d = camera.position.distanceTo(v.set(p.x, p.y, p.z));
    const zi = String(p.id === activeId ? 100000 : 50000 - Math.round(d));
    if (el.style.zIndex !== zi) el.style.zIndex = zi;
  }
  if (hooks.frame) hooks.frame(w, h);
}
function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  renderer.setSize(w, h, false);
  renderer.domElement.style.width = w + 'px'; renderer.domElement.style.height = h + 'px';
  camera.aspect = w / Math.max(h, 1); camera.fov = w < h ? 52 : 40; camera.updateProjectionMatrix();
  needsRender = true;
}
new ResizeObserver(resize).observe(stage);
resize(); applyTheme();
/* Adaptive sharpness: if a device can't keep up while the view is moving, render fewer pixels. */
let pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
const frameGaps = [];
let lastTick = null, lastDrawn = false;
function adapt(gap) {
  frameGaps.push(gap);
  if (frameGaps.length < 40) return;
  const sorted = frameGaps.slice().sort((a, b) => a - b); frameGaps.length = 0;
  if (sorted[20] > 26 && pixelRatio > 1) {
    pixelRatio = Math.max(1, pixelRatio - 0.25);
    renderer.setPixelRatio(pixelRatio); resize();
  }
}
function tick(now) {
  const dt = lastTick === null ? 1 / 60 : Math.min((now - lastTick) / 1000, 0.05);
  const gap = lastTick === null ? 0 : now - lastTick;
  lastTick = now;
  const tw = stepTween(now), zm = stepZoom(dt), moved = controls.update();
  if (tw || zm || moved || needsRender) {
    if (lastDrawn && gap > 0) adapt(gap);
    const dist = camera.position.distanceTo(controls.target);
    fog.near = dist * 1.6; fog.far = dist * 5;
    renderer.render(scene, camera);
    placePins();
    needle.style.transform = `rotate(${controls.getAzimuthalAngle()}rad)`;
    needsRender = false;
    lastDrawn = true;
  } else lastDrawn = false;
}
function loop(now) { requestAnimationFrame(loop); tick(now); }
