/* ---------------- buildings ----------------
   Each building is drawn from its traced footprint (D.buildings) with walls, a plinth, windows, doors and a
   proper roof (thin slabs with eaves, fascia, ridge cap). The main hall follows photos of the real temple:
   raised yellow platform, red columns along a front porch, a row of lanterns, a central gate with the red
   「寶華山慈惠堂」 sign, and stairs down to the plaza. Many small parts are merged into one mesh per material. */
const _bm = new THREE.Matrix4(), _bq = new THREE.Quaternion(), _be = new THREE.Euler(), _bp = new THREE.Vector3(), _bs = new THREE.Vector3(1, 1, 1);
function Batch(name) { this.name = name; this.parts = new Map(); }
Batch.prototype.add = function (geo, material, x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0) {
  _be.set(rx, ry, rz, 'YXZ'); _bq.setFromEuler(_be); _bp.set(x, y, z);
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  g.applyMatrix4(_bm.compose(_bp, _bq, _bs));
  if (!g.attributes.normal) g.computeVertexNormals();
  let list = this.parts.get(material);
  if (!list) this.parts.set(material, (list = []));
  list.push(g);
  return this;
};
Batch.prototype.build = function () {
  const grp = new THREE.Group(); grp.name = this.name;
  for (const [material, list] of this.parts) grp.add(new THREE.Mesh(mergeGeos(list), material));
  return grp;
};
function mergeGeos(list) {
  let n = 0; for (const g of list) n += g.attributes.position.count;
  const P = new Float32Array(n * 3), N = new Float32Array(n * 3), U = new Float32Array(n * 2);
  let o = 0;
  for (const g of list) {
    P.set(g.attributes.position.array, o * 3);
    N.set(g.attributes.normal.array, o * 3);
    if (g.attributes.uv) U.set(g.attributes.uv.array, o * 2);
    o += g.attributes.position.count; g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(P, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(U, 2));
  out.computeBoundingSphere();
  return out;
}
// A box whose texture coordinates are in metres, so patterns keep their real size on every face.
function boxM(sx, sy, sz) {
  const g = new THREE.BoxGeometry(sx, sy, sz), uv = g.attributes.uv;
  const dims = [[sz, sy], [sz, sy], [sx, sz], [sx, sz], [sx, sy], [sx, sy]];
  for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) { const i = f * 4 + k; uv.setXY(i, uv.getX(i) * dims[f][0], uv.getY(i) * dims[f][1]); }
  return g;
}
function gableTri(span, rise) {       // wall triangle under a gable, facing +x
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, span / 2, 0, 0, -span / 2, 0, rise, 0], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([span / 2, 0, -span / 2, 0, 0, rise], 2));
  g.computeVertexNormals();
  return g;
}

/* grey patterns that the material colour tints; UVs are in metres */
let _seedB = 7; const rndB = () => (_seedB = (_seedB * 16807) % 2147483647) / 2147483647;
function patternTex(w, h, draw, rx, ry) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry); t.encoding = THREE.sRGBEncoding; t.anisotropy = ANISO;
  return t;
}
const TEX = {
  wood: patternTex(256, 256, (g, w, h) => {          // 2 m of vertical planks, 0.2 m each
    for (let i = 0; i < 10; i++) {
      const v = 212 + rndB() * 40 | 0; g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(i * w / 10, 0, w / 10, h);
      g.strokeStyle = 'rgba(0,0,0,0.07)'; g.lineWidth = 1;
      for (let k = 0; k < 5; k++) { const x = i * w / 10 + 2 + rndB() * (w / 10 - 4); g.beginPath(); g.moveTo(x, 0); g.lineTo(x + (rndB() - 0.5) * 6, h); g.stroke(); }
      g.fillStyle = 'rgba(35,20,8,0.5)'; g.fillRect(i * w / 10, 0, 2, h);
    }
  }, 0.5, 0.5),
  corrugated: patternTex(64, 4, (g, w, h) => {      // 0.5 m of ribs, one every 12.5 cm, running down the slope
    for (let x = 0; x < w; x++) { const v = 200 + 55 * (0.5 + 0.5 * Math.cos(x / w * Math.PI * 8)) | 0; g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(x, 0, 1, h); }
  }, 2, 1),
  tiles: patternTex(128, 128, (g, w, h) => {        // 1 m of roof tiles in 25 cm courses
    for (let r = 0; r < 4; r++) {
      const y = r * h / 4, grd = g.createLinearGradient(0, y, 0, y + h / 4);
      grd.addColorStop(0, '#ffffff'); grd.addColorStop(1, '#a9a9a9'); g.fillStyle = grd; g.fillRect(0, y, w, h / 4);
      g.fillStyle = 'rgba(0,0,0,0.22)';
      for (let k = 0; k < 5; k++) g.fillRect(((k + (r % 2) * 0.5) * w / 4) % w, y, 2, h / 4);
    }
  }, 1, 1),
};
const matTCache = {};
const matT = (c, key) => matTCache[c + key] || (matTCache[c + key] = new THREE.MeshLambertMaterial({ color: c, map: TEX[key] }));
const matGlow = (c, e) => matCache[c + e] || (matCache[c + e] = new THREE.MeshLambertMaterial({ color: c, emissive: e }));
const matSide2 = (c) => matCache[c + '2'] || (matCache[c + '2'] = new THREE.MeshLambertMaterial({ color: c, side: THREE.DoubleSide }));

/* footprint frame: local x along the long side, local z across; group rotation.y = -a */
const worldOf = (b, x, z) => ({ x: b.cx + x * Math.cos(b.a) - z * Math.sin(b.a), z: b.cz + x * Math.sin(b.a) + z * Math.cos(b.a) });
const localOf = (b, wx, wz) => { const dx = wx - b.cx, dz = wz - b.cz; return { x: dx * Math.cos(b.a) + dz * Math.sin(b.a), z: -dx * Math.sin(b.a) + dz * Math.cos(b.a) }; };
function centroid(p) { let x = 0, z = 0; for (let i = 0; i < p.length; i += 2) { x += p[i]; z += p[i + 1]; } return [x / (p.length / 2), z / (p.length / 2)]; }
const plazaCentre = (id) => { const pl = D.plazas.find(p => p.id === id); return pl ? centroid(pl.p) : [0, 0]; };
function nearestRoad(b) {
  let best = null, bd = Infinity;
  for (const r of D.roads) for (let i = 0; i < r.p.length; i += 2) { const d = Math.hypot(r.p[i] - b.cx, r.p[i + 1] - b.cz); if (d < bd) { bd = d; best = [r.p[i], r.p[i + 1]]; } }
  return best || [b.cx, b.cz + 1];
}
const facing = (b, [wx, wz]) => (localOf(b, wx, wz).z >= 0 ? 1 : -1);
// which wall looks toward a point: 'front' / 'back' (the long sides, front = +z * front sign) or 'end+' / 'end-'
function wallToward(b, [wx, wz], front) {
  const q = localOf(b, wx, wz);
  if (Math.abs(q.x) / b.L > Math.abs(q.z) / b.W) return q.x > 0 ? 'end+' : 'end-';
  return (q.z >= 0) === (front > 0) ? 'front' : 'back';
}

/* ---- parts ---- */
function windowAt(P, x, y, z, ry, w, h, frame) {
  // a light frame flush with the wall, dark glass standing a little proud of it, a mullion and a sill
  const nx = Math.sin(ry), nz = Math.cos(ry);
  P.windows.add(boxM(w + 0.16, h + 0.16, 0.06), mat(frame), x + nx * 0.03, y, z + nz * 0.03, ry);
  P.windows.add(boxM(w - 0.04, h - 0.04, 0.04), mat('#2d3a41'), x + nx * 0.07, y, z + nz * 0.07, ry);
  P.windows.add(boxM(0.06, h - 0.04, 0.03), mat(frame), x + nx * 0.1, y, z + nz * 0.1, ry);
  P.windows.add(boxM(w + 0.3, 0.07, 0.16), mat(frame), x + nx * 0.08, y - h / 2 - 0.06, z + nz * 0.08, ry);
}
function doorAt(P, d, x, y0, z, ry) {
  const nx = Math.sin(ry), nz = Math.cos(ry), w = d.w, h = d.h;
  const out = (k) => [x + nx * k, z + nz * k];
  let [px, pz] = out(0.03);
  P.doors.add(boxM(w + 0.24, h + 0.12, 0.06), mat(d.frame || '#e9e4d9'), px, y0 + (h + 0.12) / 2, pz, ry);
  [px, pz] = out(0.08);
  const col = { wood: '#5d3b26', red: '#a3281b', metal: '#8b9195', roll: '#9aa0a3', glass: '#33424a' }[d.kind] || '#5d3b26';
  P.doors.add(boxM(w, h, 0.06), mat(col), px, y0 + h / 2, pz, ry);
  [px, pz] = out(0.12);
  if (d.kind === 'roll') {
    for (let s = 0.3; s < h - 0.1; s += 0.28) P.doors.add(boxM(w, 0.035, 0.02), mat('#6f7579'), px, y0 + s, pz, ry);
    const [hx, hz] = out(0.2); P.doors.add(boxM(w + 0.3, 0.4, 0.35), mat('#7d8387'), hx, y0 + h + 0.25, hz, ry);
  } else if (w > 1.4) {
    P.doors.add(boxM(0.05, h, 0.02), mat('#2a1d14'), px, y0 + h / 2, pz, ry);           // double door seam
  }
  if (d.kind === 'red') {                                                                  // gold studs band
    P.doors.add(boxM(w, 0.08, 0.02), mat('#d9a93a'), px, y0 + h * 0.62, pz, ry);
  }
  const [sx, sz] = out(0.45);
  P.trim.add(boxM(w + 0.8, 0.16, 0.8), mat('#b9b3a6'), sx, y0 + 0.02, sz, ry);              // door step
}
/* windows (and doors) on the four walls of a box Lw x Ww standing at y0 */
function openings(P, Lw, Ww, y0, o) {
  const floors = o.floors || 1, fh = o.h / floors, sp = o.spacing || 3.2, frame = o.frame || '#f1ede4';
  const sides = [
    { key: 'front', len: Lw, at: (s) => [s, o.front * Ww / 2], ry: o.front > 0 ? 0 : Math.PI },
    { key: 'back', len: Lw, at: (s) => [s, -o.front * Ww / 2], ry: o.front > 0 ? Math.PI : 0 },
    { key: 'end+', len: Ww, at: (s) => [Lw / 2, s], ry: Math.PI / 2 },
    { key: 'end-', len: Ww, at: (s) => [-Lw / 2, s], ry: -Math.PI / 2 },
  ];
  for (const sd of sides) {
    const doors = (o.doors || []).filter(d => d.side === sd.key);
    for (const d of doors) { const [x, z] = sd.at(d.at || 0); doorAt(P, d, x, y0, z, sd.ry); }
    if (sd.key.startsWith('end') && !o.windowsEnd) continue;
    const n = Math.floor((sd.len - 1.6) / sp);
    if (n < 1) continue;
    for (let f = 0; f < floors; f++) {
      for (let k = 0; k < n; k++) {
        const s = (k - (n - 1) / 2) * sp;
        if (f === 0 && doors.some(d => Math.abs(s - (d.at || 0)) < d.w / 2 + 1.0)) continue;
        const [x, z] = sd.at(s);
        windowAt(P, x, y0 + f * fh + (o.sill || 1.0) + 0.6, z, sd.ry, o.winW || 1.4, o.winH || 1.2, frame);
      }
    }
  }
}
function gableRoof(P, Lw, Ww, yTop, rh, o, wallM) {
  const ov = o.eave ?? 0.6, og = 0.45, t = 0.14;
  const th = Math.atan2(rh, Ww / 2), s = Ww / 2 + ov, Ls = s / Math.cos(th) + 0.05, tan = Math.tan(th);
  const roofM = o.roofTex ? matT(o.roof, o.roofTex) : mat(o.roof), trimM = mat(o.fascia || '#ece8df');
  const yR = yTop + rh + t;
  for (const sg of [-1, 1]) {
    const cy = yR - (s / 2) * tan - t / 2;
    P.roof.add(boxM(Lw + 2 * og, t, Ls), roofM, 0, cy, sg * s / 2, 0, sg * th);
    P.trim.add(boxM(Lw + 2 * og + 0.04, 0.22, 0.05), trimM, 0, yR - s * tan - t - 0.04, sg * (s + 0.02));        // fascia
    for (const sx of [-1, 1]) P.trim.add(boxM(0.07, 0.22, Ls), trimM, sx * (Lw / 2 + og + 0.02), cy - 0.02, sg * s / 2, 0, sg * th);   // barge boards
    if (o.stripes) {
      const ny = Math.cos(th), nz = sg * Math.sin(th);
      for (let k = 0; k < o.stripes; k++) {
        const x = -Lw / 2 + (k + 0.5) * Lw / o.stripes;
        P.roof.add(boxM(0.9, 0.04, Ls - 0.1), mat('#efece6'), x, cy + ny * (t / 2 + 0.02), sg * s / 2 + nz * (t / 2 + 0.02), 0, sg * th);
      }
    }
  }
  for (const sx of [-1, 1]) P.body.add(gableTri(Ww, rh), wallM, sx * Lw / 2, yTop, 0, sx > 0 ? 0 : Math.PI);
  P.roof.add(boxM(Lw + 2 * og + 0.12, 0.24, 0.46), mat(o.ridge || o.roof), 0, yR + 0.04, 0);
  return yR + 0.16;
}
function flatRoof(P, Lw, Ww, yTop, o) {
  P.roof.add(boxM(Lw + 0.3, 0.32, Ww + 0.3), mat(o.roof), 0, yTop + 0.16, 0);
  if (!o.parapet) return yTop + 0.32;
  const ph = 0.85, pt = 0.24, pm = mat(o.wall), cm = mat('#efebe2');
  for (const sg of [-1, 1]) {
    P.trim.add(boxM(Lw + 0.3, ph, pt), pm, 0, yTop + ph / 2, sg * (Ww / 2 + 0.15 - pt / 2));
    P.trim.add(boxM(pt, ph, Ww + 0.3), pm, sg * (Lw / 2 + 0.15 - pt / 2), yTop + ph / 2, 0);
    P.trim.add(boxM(Lw + 0.42, 0.1, pt + 0.12), cm, 0, yTop + ph, sg * (Ww / 2 + 0.15 - pt / 2));      // coping
    P.trim.add(boxM(pt + 0.12, 0.1, Ww + 0.42), cm, sg * (Lw / 2 + 0.15 - pt / 2), yTop + ph, 0);
  }
  return yTop + ph;
}
const newParts = (...names) => Object.fromEntries(['body', 'roof', 'trim', 'windows', 'doors', ...names].map(n => [n, new Batch(n)]));
function finish(b, P) {
  const grp = new THREE.Group(); grp.name = b.id;
  for (const k of Object.keys(P)) if (P[k].parts.size) grp.add(P[k].build());
  grp.position.set(b.cx, 0, b.cz); grp.rotation.y = -b.a;
  return grp;
}

/* an ordinary house: plinth, walls, openings, gable or flat roof */
function house(b, o) {
  const y0 = b.y - HMIN, P = newParts(), inset = o.inset ?? 0.6;
  const Lw = Math.max(2, b.L - inset), Ww = Math.max(2, b.W - inset * 1.3), h = b.h;
  const wallM = o.wallTex ? matT(o.wall, o.wallTex) : mat(o.wall);
  P.body.add(boxM(Lw, h + 2, Ww), wallM, 0, y0 + h / 2 - 1, 0);
  if (o.plinth !== false) P.trim.add(boxM(Lw + 0.12, 0.7, Ww + 0.12), mat(o.plinth || '#a9a294'), 0, y0 + 0.05, 0);
  if (o.floors > 1) for (let f = 1; f < o.floors; f++) P.trim.add(boxM(Lw + 0.16, 0.24, Ww + 0.16), mat(o.band || '#ece8df'), 0, y0 + f * h / o.floors, 0);
  openings(P, Lw, Ww, y0, { ...o, h });
  const top = b.roof === 'gable' ? gableRoof(P, Lw, Ww, y0 + h, b.rh, o, wallM) : flatRoof(P, Lw, Ww, y0 + h, o);
  if (o.extra) o.extra(P, { Lw, Ww, y0, h, top });
  return { grp: finish(b, P), top };
}

/* the open porch at the north-west end of the big wooden house: posts and a flat roof, no walls */
function openPorch(b, o) {
  const y0 = b.y - HMIN, P = newParts('columns'), Lw = b.L - 0.4, Ww = b.W - 0.4, h = b.h;
  P.trim.add(boxM(Lw + 0.2, 0.6, Ww + 0.2), mat('#c9c2b3'), 0, y0 - 0.05, 0);
  const nx = Math.max(2, Math.round(Lw / 3) + 1);
  for (let k = 0; k < nx; k++) for (const sg of [-1, 1]) {
    P.columns.add(boxM(0.22, h, 0.22), mat(o.post), -Lw / 2 + 0.2 + k * (Lw - 0.4) / (nx - 1), y0 + h / 2, sg * (Ww / 2 - 0.2));
  }
  P.trim.add(boxM(Lw + 0.1, 0.3, 0.25), mat(o.post), 0, y0 + h - 0.15, Ww / 2 - 0.2);
  P.trim.add(boxM(Lw + 0.1, 0.3, 0.25), mat(o.post), 0, y0 + h - 0.15, -Ww / 2 + 0.2);
  P.roof.add(boxM(Lw + 0.9, 0.26, Ww + 0.9), mat(b.rc), 0, y0 + h + 0.13, 0);
  P.trim.add(boxM(Lw + 0.94, 0.2, Ww + 0.94), mat('#ece8df'), 0, y0 + h + 0.02, 0);
  return { grp: finish(b, P), top: y0 + h + 0.26 };
}

/* the temple's sign: gold characters on red, redrawn once the calligraphy font has loaded */
const signCanvas = document.createElement('canvas'); signCanvas.width = 1024; signCanvas.height = 208;
const signTex = new THREE.CanvasTexture(signCanvas); signTex.encoding = THREE.sRGBEncoding; signTex.anisotropy = ANISO;
function drawSign() {
  const g = signCanvas.getContext('2d'), w = signCanvas.width, h = signCanvas.height;
  g.fillStyle = '#9c2216'; g.fillRect(0, 0, w, h);
  g.strokeStyle = '#d8ab3d'; g.lineWidth = 12; g.strokeRect(10, 10, w - 20, h - 20);
  g.lineWidth = 3; g.strokeRect(28, 28, w - 56, h - 56);
  g.fillStyle = '#f4d26a'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = '700 128px "LXGW WenKai TC", "Kaiti TC", "DFKai-SB", serif';
  const text = Array.from('寶華山慈惠堂');
  text.forEach((ch, i) => g.fillText(ch, w / 2 + (i - (text.length - 1) / 2) * 150, h / 2 + 6));
  signTex.needsUpdate = true;
}
drawSign(); onFonts(drawSign);

const MAIN_GATE_RIGHT = 15.5;     // metres, measured on the aerial photo
function mainHall(b) {
  const y0 = b.y - HMIN, L = b.L, Wd = b.W, h = b.h;
  const P = newParts('columns', 'lanterns', 'stairs', 'signboard', 'flags');
  const fs = facing(b, plazaCentre('P2'));
  const pd = 2.8, gw = 7.0, gd = 3.0, gh = h + 1.1;
  // The gate and its stairs are not in the middle: on the aerial photo they sit about 15.5 m to the
  // right of centre for someone facing the hall from the plaza (light stair strip between two red planters).
  const gx = fs * MAIN_GATE_RIGHT;
  const Lw = L - 0.8, Wr = Wd - 0.8;                 // roof-bearing box: back wall to the column line
  const Wb = Wr - pd, zb = -fs * pd / 2;             // enclosed hall
  const zf = fs * Wr / 2;                            // porch front (column line)
  const zg = zf + fs * gd;                           // front of the gate
  const yellow = mat('#dcae45'), red = mat('#ae2a1b'), white = mat('#f1ede4'), paving = mat('#d9d3c6');

  // the stairs climb from the plaza: find the ground at their foot to size the platform
  const foot = worldOf(b, gx, zg + fs * 3.5);
  const footY = Math.min(yAt(foot.x, foot.z), y0);
  const floorY = Math.max(y0 + 0.35, footY + 1.3);
  const base = Math.min(footY, y0) - 2;

  // platform: yellow retaining wall, pale paving on top (also under the gate)
  P.trim.add(boxM(L + 0.4, floorY - base, Wd + 0.2), yellow, 0, (floorY + base) / 2, 0);
  P.trim.add(boxM(L + 0.5, 0.08, Wd + 0.3), paving, 0, floorY + 0.04, 0);
  P.trim.add(boxM(gw + 0.8, floorY - base, gd + 0.4), yellow, gx, (floorY + base) / 2, zf + fs * (gd / 2 + 0.1));
  P.trim.add(boxM(gw + 0.9, 0.08, gd + 0.5), paving, gx, floorY + 0.04, zf + fs * (gd / 2 + 0.1));

  // enclosed hall with red doors behind the gate
  const wallM = mat('#efe2c0');
  P.body.add(boxM(Lw, h, Wb), wallM, 0, floorY + h / 2, zb);
  const front = zb + fs * Wb / 2, ryF = fs > 0 ? 0 : Math.PI, ryB = fs > 0 ? Math.PI : 0;
  for (const x of [-2.2, 0, 2.2]) doorAt(P, { w: 1.8, h: 2.9, kind: 'red', frame: '#d9a93a' }, gx + x, floorY, front, ryF);
  const n = Math.floor((Lw - 2) / 3.6);
  for (let k = 0; k < n; k++) {
    const x = (k - (n - 1) / 2) * 3.6;
    if (Math.abs(x - gx) > 4.4) windowAt(P, x, floorY + 1.7, front, ryF, 1.5, 1.4, '#b0281a');
    windowAt(P, x, floorY + 1.7, zb - fs * Wb / 2, ryB, 1.4, 1.2, '#f1ede4');
  }

  // roof over hall + porch
  const top = gableRoof(P, Lw, Wr, floorY + h, b.rh, { roof: b.rc, roofTex: 'corrugated', fascia: '#e6c05a', ridge: '#f4f2ec' }, wallM);

  // porch: red columns on stone bases, a yellow beam, white balustrade, a row of lanterns
  const colGeo = new THREE.CylinderGeometry(0.17, 0.17, h - 0.7, 12), baseGeo = new THREE.CylinderGeometry(0.26, 0.28, 0.28, 12);
  const nc = Math.round(Lw / 3.5);
  const colXs = [];
  for (let k = 0; k <= nc; k++) { const x = -Lw / 2 + 0.2 + k * (Lw - 0.4) / nc; if (Math.abs(x - gx) > gw / 2 + 0.6) colXs.push(x); }
  colXs.push(gx - gw / 2 + 0.3, gx + gw / 2 - 0.3);
  for (const x of colXs) {
    P.columns.add(colGeo, red, x, floorY + (h - 0.7) / 2, zf - fs * 0.25);
    P.columns.add(baseGeo, mat('#b9b3a6'), x, floorY + 0.14, zf - fs * 0.25);
  }
  P.trim.add(boxM(Lw + 0.3, 0.7, 0.34), mat('#e2b23b'), 0, floorY + h - 0.35, zf - fs * 0.25);
  for (const [x0, x1] of [[-Lw / 2 + 0.1, gx - gw / 2 - 0.2], [gx + gw / 2 + 0.2, Lw / 2 - 0.1]]) {
    if (x1 - x0 < 0.5) continue;
    const len = x1 - x0, cx = (x0 + x1) / 2, z = zf - fs * 0.25;
    P.trim.add(boxM(len, 0.09, 0.12), white, cx, floorY + 0.95, z);
    P.trim.add(boxM(len, 0.08, 0.1), white, cx, floorY + 0.14, z);
    for (let x = Math.min(x0, x1) + 0.15; x < Math.max(x0, x1); x += 0.28) P.trim.add(boxM(0.06, 0.76, 0.06), white, x, floorY + 0.55, z);
  }
  const lanternGeo = new THREE.IcosahedronGeometry(0.24, 1), cordGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.3, 4);
  for (let x = -Lw / 2 + 0.8; x <= Lw / 2 - 0.8; x += 1.25) {
    if (Math.abs(x - gx) < gw / 2 + 0.3) continue;
    P.lanterns.add(lanternGeo, matGlow('#f3cf58', '#5a3d08'), x, floorY + h - 1.0, zf + fs * 0.02);
    P.lanterns.add(cordGeo, mat('#4a3a2a'), x, floorY + h - 0.72, zf + fs * 0.02);
  }

  // the gate: taller red columns, flat white roof, the red sign on top, red lanterns
  const gColGeo = new THREE.CylinderGeometry(0.22, 0.22, gh - 0.35, 14);
  for (const x of [gx - gw / 2 + 0.3, gx + gw / 2 - 0.3]) for (const z of [zf - fs * 0.25, zg - fs * 0.35]) {
    P.columns.add(gColGeo, red, x, floorY + (gh - 0.35) / 2, z);
    P.columns.add(baseGeo, mat('#b9b3a6'), x, floorY + 0.14, z);
  }
  P.roof.add(boxM(gw + 0.9, 0.38, gd + 1.0), mat('#f3f1ea'), gx, floorY + gh + 0.02, zf + fs * (gd / 2 + 0.05));
  P.trim.add(boxM(gw + 0.94, 0.16, gd + 1.04), mat('#d8ab3d'), gx, floorY + gh - 0.2, zf + fs * (gd / 2 + 0.05));
  P.trim.add(boxM(gw - 0.2, 0.5, 0.3), red, gx, floorY + gh - 0.55, zg - fs * 0.35);
  const signY = floorY + gh + 0.21 + 0.85, signZ = zg + fs * 0.1;
  P.signboard.add(boxM(6.7, 1.6, 0.32), mat('#8f1f14'), gx, signY, signZ);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 1.3), new THREE.MeshLambertMaterial({ map: signTex }));
  face.position.set(gx, signY, signZ + fs * 0.17); face.rotation.y = fs > 0 ? 0 : Math.PI; face.name = 'sign-face';
  const redLantern = new THREE.IcosahedronGeometry(0.3, 1);
  for (let k = -2; k <= 2; k++) {
    P.lanterns.add(redLantern, matGlow('#d23a26', '#4a0c06'), gx + k * 1.25, floorY + gh - 1.25, zg - fs * 0.35);
    P.lanterns.add(cordGeo, mat('#4a3a2a'), gx + k * 1.25, floorY + gh - 0.85, zg - fs * 0.35);
  }
  // incense burner in the gate
  P.doors.add(new THREE.CylinderGeometry(0.5, 0.42, 0.7, 16), mat('#6b5434'), gx, floorY + 0.45, zf + fs * (gd / 2));
  P.doors.add(new THREE.CylinderGeometry(0.56, 0.56, 0.08, 16), mat('#8a6d3f'), gx, floorY + 0.84, zf + fs * (gd / 2));

  // stairs down to the plaza, between yellow cheek walls
  const rise = floorY - footY, ns = Math.max(3, Math.round(rise / 0.16)), rs = rise / ns, tread = 0.32, sw = 5.0;
  for (let k = 1; k < ns; k++) {
    const topY = floorY - k * rs, z0 = zg + fs * (k - 1) * tread;
    P.stairs.add(boxM(sw, topY - (footY - 1), tread), mat(k % 2 ? '#cfc9bd' : '#c8c2b5'), gx, (topY + footY - 1) / 2, z0 + fs * tread / 2);
  }
  const run = (ns - 1) * tread;
  const shape = new THREE.Shape([
    new THREE.Vector2(0, footY - 1), new THREE.Vector2(fs * (run + 0.3), footY - 1),
    new THREE.Vector2(fs * (run + 0.3), footY + 0.85), new THREE.Vector2(0, floorY + 0.95),
  ]);
  const cheek = new THREE.ExtrudeGeometry(shape, { depth: 0.32, bevelEnabled: false });
  for (const sg of [-1, 1]) P.stairs.add(cheek, yellow, gx + sg * (sw / 2 + 0.16) + 0.16, 0, zg, -Math.PI / 2);

  // flags beside the gate
  const poleGeo = new THREE.CylinderGeometry(0.045, 0.06, 6.4, 6), flagGeo = new THREE.PlaneGeometry(0.75, 2.3);
  const flagCols = ['#2f6fbf', '#e8c33a', '#c8321f', '#2f6fbf'];
  [-gw / 2 - 0.9, -gw / 2 - 1.9, gw / 2 + 1.9, gw / 2 + 0.9].map(x => gx + x).forEach((x, i) => {
    const z = zf + fs * (gd - 0.6);
    P.flags.add(poleGeo, mat('#c9ccce'), x, floorY + 3.2, z);
    P.flags.add(flagGeo, matSide2(flagCols[i]), x + (x > gx ? 0.42 : -0.42), floorY + 4.9, z);
  });

  const grp = finish(b, P);
  grp.add(face);
  return { grp, top: Math.max(top, signY + 0.85), entrance: worldOf(b, gx, zg + fs * (run + 1)) };
}

/* ---- which style each traced building gets ---- */
const WOOD = '#b5875a';
function styleFor(b) {
  const toPlaza = facing(b, plazaCentre('P2')), toRoad = facing(b, nearestRoad(b));
  switch (b.id) {
    case 'A': return { wall: WOOD, wallTex: 'wood', roof: b.rc, roofTex: 'tiles', ridge: b.ridge || '#e8e4da', fascia: '#5b4330', frame: '#6b4a2e',
      front: toPlaza, doors: [{ side: 'end+', at: 0, w: 2.0, h: 2.5, kind: 'wood', frame: '#6b4a2e' }, { side: 'front', at: 4, w: 1.1, h: 2.2, kind: 'wood', frame: '#6b4a2e' }] };
    case 'A-wing': return { wall: WOOD, wallTex: 'wood', roof: b.rc, roofTex: 'tiles', fascia: '#5b4330', frame: '#6b4a2e', front: toPlaza,
      doors: [{ side: 'front', at: 0, w: 1.1, h: 2.2, kind: 'wood', frame: '#6b4a2e' }] };
    case 'D': {
      // the kitchen's roll-up doors open onto the plaza; a plain door on the opposite wall
      const side = wallToward(b, plazaCentre('P2'), toPlaza);
      const back = { 'end+': 'end-', 'end-': 'end+', front: 'back', back: 'front' }[side];
      return { wall: '#e2dccd', roof: b.rc, roofTex: 'corrugated', front: toPlaza, windowsEnd: true,
      doors: [{ side, at: -4.2, w: 3.4, h: 2.9, kind: 'roll' }, { side, at: 4.2, w: 3.4, h: 2.9, kind: 'roll' }, { side: back, at: 0, w: 1.0, h: 2.1, kind: 'metal' }],
      extra: (P, s) => { P.trim.add(new THREE.CylinderGeometry(0.22, 0.22, 2.6, 10), mat('#9ca2a5'), s.Lw / 4, s.top + 0.4, -toPlaza * s.Ww / 5); } };
    }
    case 'E': return { wall: '#dcd6ca', roof: b.rc, parapet: true, floors: 2, front: toPlaza, windowsEnd: true, band: '#efebe2',
      doors: [{ side: 'front', at: 0, w: 2.4, h: 2.6, kind: 'glass' }],
      extra: (P, s) => {
        P.trim.add(boxM(3.6, 0.2, 1.6), mat('#efebe2'), 0, s.y0 + 3.0, toPlaza * (s.Ww / 2 + 0.8));            // canopy over the entrance
        for (const x of [-s.Lw / 2 + 3, -s.Lw / 2 + 5]) {                                                     // rooftop water tanks
          P.trim.add(new THREE.CylinderGeometry(0.75, 0.75, 1.5, 16), mat('#e9e6df'), x, s.y0 + s.h + 1.3, -toPlaza * (s.Ww / 2 - 2));
          P.trim.add(boxM(1.7, 0.5, 1.7), mat('#8d9396'), x, s.y0 + s.h + 0.3, -toPlaza * (s.Ww / 2 - 2));
        }
      } };
    case 'E-top': return { wall: '#eeebe4', roof: b.rc, plinth: false, front: toPlaza, doors: [{ side: 'front', at: 0, w: 1.0, h: 2.1, kind: 'metal' }], inset: 0.3 };
    case 'I': return { wall: '#a8764d', wallTex: 'wood', roof: b.rc, roofTex: 'corrugated', stripes: b.stripes, fascia: '#f0ece4', frame: '#f0ece4', front: toRoad,
      doors: [{ side: 'front', at: 0, w: 1.0, h: 2.1, kind: 'wood' }] };
    default: return { wall: b.wc, roof: b.rc, front: toPlaza, doors: [{ side: 'front', at: 0, w: 1.0, h: 2.1, kind: 'wood' }] };
  }
}

const tops = {};
const bldgGroups = {};
let mainEntrance = null;
for (const b of D.buildings) {
  let r;
  if (b.id === MAIN_HALL) { r = mainHall(b); mainEntrance = r.entrance; }
  else if (b.id === 'A-porch') r = openPorch(b, { post: '#7a5233' });
  else r = house(b, styleFor(b));
  if (!bldgGroups[b.group]) { const g = new THREE.Group(); g.name = 'building-' + b.group; g.userData.id = b.group; bldgGroups[b.group] = g; scene.add(g); }
  bldgGroups[b.group].add(r.grp);
  if (!tops[b.group] || b.id === b.group) tops[b.group] = { x: b.cx, z: b.cz, y: r.top, b };
}
(function waterTank() {
  // round tank on a low plinth with a shallow conical lid (dark lid seen in the aerial photo), a ladder up the side
  const p = D.pavilion, y0 = p.y - HMIN, P = newParts();
  const tankH = 4.5, lidH = 1.1;
  P.trim.add(new THREE.CylinderGeometry(p.r + 0.6, p.r + 0.6, 2, 28), mat('#cfc9bc'), 0, y0 - 0.6, 0);
  P.body.add(new THREE.CylinderGeometry(p.r, p.r, tankH, 40), mat('#8f9a96'), 0, y0 + 0.4 + tankH / 2, 0);
  for (const hh of [1.4, 2.9]) P.trim.add(new THREE.CylinderGeometry(p.r + 0.05, p.r + 0.05, 0.18, 40), mat('#6f7a77'), 0, y0 + 0.4 + hh, 0);
  P.roof.add(new THREE.ConeGeometry(p.r + 0.15, lidH, 40), mat(p.rc), 0, y0 + 0.4 + tankH + lidH / 2, 0);
  for (const s of [-0.25, 0.25]) P.trim.add(boxM(0.06, tankH + 0.6, 0.06), mat('#5d6466'), s, y0 + 0.4 + (tankH + 0.6) / 2, p.r + 0.18);
  for (let k = 0.4; k < tankH + 0.6; k += 0.35) P.trim.add(boxM(0.5, 0.04, 0.04), mat('#5d6466'), 0, y0 + 0.4 + k, p.r + 0.18);
  const grp = finish({ id: 'J', cx: p.cx, cz: p.cz, a: 0.4 }, P);
  const g = new THREE.Group(); g.name = 'building-J'; g.userData.id = 'J'; g.add(grp); scene.add(g); bldgGroups.J = g;
  tops.J = { x: p.cx, z: p.cz, y: y0 + 0.4 + tankH + lidH, b: { L: p.r * 2, W: p.r * 2, y: p.y, round: true } };
})();
for (const c of D.cars) {
  const grp = new THREE.Group(), y0 = c.y - HMIN;
  const body = new THREE.Mesh(new THREE.BoxGeometry(4.3, 0.9, 1.75), mat(c.c)); body.position.y = y0 + 0.75; grp.add(body);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.7, 1.55), mat('#3b4248')); cab.position.set(-0.2, y0 + 1.5, 0); grp.add(cab);
  grp.position.set(c.x, 0, c.z); grp.rotation.y = -(Math.PI * 0.73); scene.add(grp);
}
