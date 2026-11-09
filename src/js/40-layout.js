/* ---------------- event items and walkways (from layout.json) ---------------- */
let LAYOUT = LC.normalizeLayout(window.LAYOUT_FALLBACK);
const itemRoot = new THREE.Group(); itemRoot.name = 'items'; scene.add(itemRoot);
const pathRoot = new THREE.Group(); pathRoot.name = 'paths'; scene.add(pathRoot);
const itemObjs = new Map(), pathObjs = new Map();
/* Saved positions as map metres. Anything off the map (a mistyped coordinate) is pulled to the nearest
   edge, so it stays visible and can be dragged back or deleted instead of breaking the page. */
let offMap = 0;
function onMap(lon, lat) {
  const { x, z } = toLocal(lon, lat), cx = clampX(x), cz = clampZ(z);
  if (cx !== x || cz !== z) offMap++;
  return { x: cx, z: cz };
}

/* 3D models, standing on the ground at y = 0, front toward local -z */
const IG = {
  cloth: new THREE.BoxGeometry(1.8, 0.76, 0.75), board: new THREE.BoxGeometry(1.84, 0.04, 0.79),
  seat: new THREE.BoxGeometry(0.45, 0.45, 0.45), back: new THREE.BoxGeometry(0.45, 0.5, 0.06),
  leg: new THREE.BoxGeometry(0.06, 2.4, 0.06), valX: new THREE.BoxGeometry(3.0, 0.3, 0.03), valZ: new THREE.BoxGeometry(0.03, 0.3, 3.0),
  canopy: new THREE.ConeGeometry(2.13, 0.8, 4, 1).rotateY(Math.PI / 4),
  coneBase: new THREE.BoxGeometry(0.42, 0.04, 0.42), cone: new THREE.ConeGeometry(0.17, 0.7, 18), coneBand: new THREE.CylinderGeometry(0.11, 0.13, 0.12, 18),
};
const ITEM_MODELS = {
  table: { h: 0.8, size: '桌子約 1.8 × 0.75 公尺', parts: [
    ['cloth', '#b5361e', 0, 0.38, 0], ['board', '#f3efe6', 0, 0.78, 0],
    ['seat', '#3d4246', -0.45, 0.23, 0.75], ['seat', '#3d4246', 0.45, 0.23, 0.75],
    ['back', '#3d4246', -0.45, 0.7, 0.95], ['back', '#3d4246', 0.45, 0.7, 0.95]] },
  tent: { h: 3.2, size: '帳篷約 3 × 3 公尺', parts: [
    ['leg', '#c9ccce', -1.45, 1.2, -1.45], ['leg', '#c9ccce', 1.45, 1.2, -1.45], ['leg', '#c9ccce', -1.45, 1.2, 1.45], ['leg', '#c9ccce', 1.45, 1.2, 1.45],
    ['valX', '#b5361e', 0, 2.27, -1.5], ['valX', '#b5361e', 0, 2.27, 1.5], ['valZ', '#b5361e', -1.5, 2.27, 0], ['valZ', '#b5361e', 1.5, 2.27, 0],
    ['canopy', '#f4f2ec', 0, 2.82, 0]] },
  marker: { h: 0.75, size: '', parts: [
    ['coneBase', '#2b2f33', 0, 0.02, 0], ['cone', '#e8692c', 0, 0.39, 0], ['coneBand', '#f4f2ec', 0, 0.4, 0]] },
};
function makeItem(it) {
  const g = new THREE.Group();
  for (const [k, c, x, y, z] of ITEM_MODELS[it.type].parts) { const m = new THREE.Mesh(IG[k], mat(c)); m.position.set(x, y, z); g.add(m); }
  g.userData.id = it.id; g.name = 'item-' + it.id;
  placeItem(g, it);
  return g;
}
function placeItem(g, it) {
  const { x, z } = onMap(it.lon, it.lat);
  g.position.set(x, surfaceAt(x, z), z);
  g.rotation.y = -it.rot * Math.PI / 180;
}

/* walkway texture: carpet colour, two edge stripes, the words written along the strip, repeating.
   Everything is measured in walkway widths, so one texture serves every width. */
const pathTexCache = new Map();
function pathTexture(style, text) {
  const key = style + '|' + text;
  let e = pathTexCache.get(key);
  if (e) return e;
  const S = LC.PATH_STYLES[style], chars = Array.from(text), px = 128;
  const tileW = chars.length ? chars.length * 0.74 + 1.4 : 2;
  const c = document.createElement('canvas'); c.width = px; c.height = Math.round(tileW * px);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.ClampToEdgeWrapping; tex.wrapT = THREE.RepeatWrapping; tex.flipY = false;
  tex.encoding = THREE.sRGBEncoding; tex.anisotropy = ANISO; tex.repeat.set(1, 1 / tileW);
  const draw = () => {
    const g = c.getContext('2d'), w = c.width, h = c.height;
    g.fillStyle = S.base; g.fillRect(0, 0, w, h);
    g.fillStyle = S.edge; g.fillRect(w * 0.05, 0, w * 0.07, h); g.fillRect(w * 0.88, 0, w * 0.07, h);
    if (!chars.length) return;
    // v grows along the walk and the canvas is seen mirrored from above, so write in a flipped frame:
    // the characters then stand upright for someone walking from the first point toward the last.
    g.save(); g.translate(0, h); g.scale(1, -1);
    g.fillStyle = S.text; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `700 ${Math.round(w * 0.6)}px "LXGW WenKai TC", "Noto Sans TC", "Microsoft JhengHei", sans-serif`;
    chars.forEach((ch, i) => g.fillText(ch, w / 2, w * (0.7 + 0.37 + i * 0.74)));
    g.restore();
    tex.needsUpdate = true; needsRender = true;
  };
  draw();
  if (chars.length && document.fonts) document.fonts.load(`700 76px "LXGW WenKai TC"`, text).then(draw).catch(() => {});
  e = { tex, tileW, material: new THREE.MeshLambertMaterial({ map: tex, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }) };
  pathTexCache.set(key, e);
  return e;
}
const pathLocal = (p) => p.pts.map(([lon, lat]) => { const q = onMap(lon, lat); return [q.x, q.z]; });
function pathGeometry(local, width) {
  const r = LC.ribbon(local, width, surfaceAt, { step: 0.5, lift: 0.08, across: 0.25 });
  const uv = r.uvs; for (let i = 1; i < uv.length; i += 2) uv[i] /= width;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(r.positions, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(r.indices); g.computeVertexNormals(); g.computeBoundingSphere();
  return { g, length: r.length };
}
function makePath(p, local) {
  const { g, length } = pathGeometry(local, p.width);
  const mesh = new THREE.Mesh(g, pathTexture(p.style, p.text).material);
  mesh.userData.id = p.id; mesh.name = 'path-' + p.id; mesh.renderOrder = 1;
  return { mesh, length };
}

/* ---------------- places: fixed buildings and plazas, plus the items and walkways ---------------- */
const FIXED = [];
for (const id of Object.keys(tops).sort()) {
  const t = tops[id];
  const size = t.b.round ? `直徑約 ${Math.round(t.b.L)} 公尺` : `約 ${Math.round(t.b.L)} × ${Math.round(t.b.W)} 公尺`;
  FIXED.push({ id, kind: id === MAIN_HALL ? 'hall' : 'bldg', x: t.x, z: t.z, y: t.y + 1, size, elev: Math.round(t.b.y) });
}
for (const pl of D.plazas) {
  const [x, z] = centroid(pl.p);
  FIXED.push({ id: pl.id, kind: 'plaza', x, z, y: yAt(x, z) + 0.5, elev: Math.round(pl.y) });
}
let POINTS = [], byId = {};
function placePoint(p) {
  const o = LAYOUT.places[p.id] || {}, isBldg = p.kind !== 'plaza';
  return Object.assign(p, {
    isBldg, named: !!o.name, name: o.name || (isBldg ? `${p.id} 棟` : `廣場 ${p.id.slice(1)}`),
    glyph: o.glyph || (isBldg ? p.id : '場'), letterGlyph: isBldg && !o.glyph,
    note: o.note || '', staff: o.staff || [], fixed: true,
  });
}
function itemPoint(it) {
  const { x, z } = onMap(it.lon, it.lat), gy = surfaceAt(x, z), M = ITEM_MODELS[it.type], th = -it.rot * Math.PI / 180;
  return { id: it.id, kind: 'item', type: it.type, x, z, y: gy + M.h + 0.5, elev: Math.round(gy + HMIN), size: M.size,
    name: it.name, glyph: it.glyph, note: it.note, staff: it.staff, named: true, isEvent: true, near: true,
    viewDir: it.type === 'table' ? [-Math.sin(th), -Math.cos(th)] : null };
}
function pathPoint(p, local, length) {
  const [x, z] = LC.pointAt(local, 0.5), gy = surfaceAt(x, z);
  return { id: p.id, kind: 'path', x, z, y: gy + 0.7, elev: Math.round(gy + HMIN),
    size: `長約 ${Math.max(1, Math.round(length))} 公尺 · 寬 ${p.width} 公尺`,
    name: p.name, glyph: '道', note: p.note, staff: p.staff, named: true, isEvent: true, near: false, local };
}
function applyLayout() {
  offMap = 0;
  for (const g of itemObjs.values()) itemRoot.remove(g);
  itemObjs.clear();
  for (const m of pathObjs.values()) { pathRoot.remove(m); m.geometry.dispose(); }
  pathObjs.clear();
  const pts = FIXED.map(placePoint);
  for (const it of LAYOUT.items) { const g = makeItem(it); itemRoot.add(g); itemObjs.set(it.id, g); pts.push(itemPoint(it)); }
  for (const p of LAYOUT.paths) {
    const local = pathLocal(p), { mesh, length } = makePath(p, local);
    pathRoot.add(mesh); pathObjs.set(p.id, mesh); pts.push(pathPoint(p, local, length));
  }
  POINTS = pts; byId = Object.fromEntries(pts.map(p => [p.id, p]));
  renderPins();
  needsRender = true;
}
// cheap updates while editing (no full rebuild)
function moveItemLive(id, x, z) {
  const g = itemObjs.get(id), p = byId[id];
  if (!g || !p) return;
  const gy = surfaceAt(x, z);
  g.position.set(x, gy, z);
  Object.assign(p, { x, z, y: gy + ITEM_MODELS[p.type].h + 0.5, elev: Math.round(gy + HMIN) });
  needsRender = true;
}
function reshapePathLive(id, local, width) {
  const mesh = pathObjs.get(id), p = byId[id];
  if (!mesh || !p) return;
  const { g, length } = pathGeometry(local, width);
  mesh.geometry.dispose(); mesh.geometry = g;
  const [x, z] = LC.pointAt(local, 0.5);
  Object.assign(p, { x, z, y: surfaceAt(x, z) + 0.7, local, size: `長約 ${Math.max(1, Math.round(length))} 公尺 · 寬 ${width} 公尺` });
  needsRender = true;
}
function restylePathLive(id, style, text) {
  const mesh = pathObjs.get(id);
  if (mesh) { mesh.material = pathTexture(style, text).material; needsRender = true; }
}
