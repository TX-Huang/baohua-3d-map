/* ---------------- trees ---------------- */
const TREE_COLS = ['#3e6a39', '#4b7a3f', '#5a8946', '#355f38'];
const treeGeo = new THREE.IcosahedronGeometry(1, 1);
const trees = new THREE.InstancedMesh(treeGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), D.trees.length);
(function placeTrees() {
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), col = new THREE.Color();
  let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  D.trees.forEach(([x, z, r, hf, v], i) => {
    const hy = r * hf * 1.05;
    p.set(x, yAt(x, z) + hy + 0.8, z);
    s.set(r, hy, r);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * Math.PI);
    m.compose(p, q, s);
    trees.setMatrixAt(i, m);
    col.set(TREE_COLS[v]).offsetHSL((rnd() - 0.5) * 0.02, 0, (rnd() - 0.5) * 0.06);
    trees.setColorAt(i, col);
  });
})();
scene.add(trees);

/* ---------------- ground texture ---------------- */
function paintModel() {
  const TH = Math.round(TW * DEP / W), ppm = TW / W;
  texCanvas.width = TW; texCanvas.height = TH;
  const g = texCanvas.getContext('2d');
  const X = (x) => (x + W / 2) * ppm, Y = (z) => (z + DEP / 2) * ppm;
  const path = (p, close) => { g.beginPath(); for (let i = 0; i < p.length; i += 2) { const x = X(p[i]), y = Y(p[i + 1]); i ? g.lineTo(x, y) : g.moveTo(x, y); } if (close) g.closePath(); };
  let seed = 3; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const grain = (lo, hi) => {
    const n = document.createElement('canvas'); n.width = n.height = 128;
    const ng = n.getContext('2d'); const d = ng.createImageData(128, 128);
    for (let i = 0; i < d.data.length; i += 4) { const v = lo + rnd() * (hi - lo); d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; }
    ng.putImageData(d, 0, 0); return g.createPattern(n, 'repeat');
  };
  const multiplyGrain = (pat, alpha) => { g.save(); g.globalCompositeOperation = 'multiply'; g.globalAlpha = alpha; g.fillStyle = pat; g.fillRect(0, 0, TW, TH); g.restore(); };

  // forest floor
  g.fillStyle = '#577b48'; g.fillRect(0, 0, TW, TH);
  multiplyGrain(grain(170, 255), 0.5);
  // grass and scrub
  g.save(); g.filter = 'blur(6px)';
  for (const p of D.grass) { path(p, true); g.fillStyle = '#95b06c'; g.fill(); }
  g.restore();
  // plazas, plus paved patches without a label
  const pavedAreas = D.plazas.concat((D.paved || []).map(p => ({ p })));
  // kerb outlines first, then every fill on top: overlapping areas merge without inner lines
  for (const pl of pavedAreas) { path(pl.p, true); g.lineWidth = 0.9 * ppm; g.strokeStyle = '#b9b3a6'; g.stroke(); }
  for (const pl of pavedAreas) { path(pl.p, true); g.fillStyle = '#d3cec3'; g.fill(); }
  g.save();
  for (const pl of D.plazas) { path(pl.p, true); g.clip(); }
  g.restore();
  for (const pl of pavedAreas) {
    g.save(); path(pl.p, true); g.clip();
    g.strokeStyle = 'rgba(150,143,128,0.35)'; g.lineWidth = Math.max(1, 0.12 * ppm);
    g.translate(TW / 2, TH / 2); g.rotate(-0.7);
    for (let k = -TW; k < TW; k += 4 * ppm) { g.beginPath(); g.moveTo(k, -TW); g.lineTo(k, TW); g.stroke(); g.beginPath(); g.moveTo(-TW, k); g.lineTo(TW, k); g.stroke(); }
    g.restore();
  }
  // roads
  g.lineCap = 'round'; g.lineJoin = 'round';
  for (const r of D.roads) { path(r.p); g.strokeStyle = r.kind === 'asphalt' ? '#d9d4c7' : '#a8a293'; g.lineWidth = (r.w + 1.0) * ppm; g.stroke(); }
  const main = D.roads.find(r => r.id === 'main');
  if (main) { // yellow-painted kerb along the hairpin by the temple, as in the aerial photo
    const k = main.p.length; const sub = main.p.slice(k - 14);
    path(sub); g.strokeStyle = '#e1b83a'; g.lineWidth = (main.w + 0.9) * ppm; g.stroke();
  }
  for (const r of D.roads) { path(r.p); g.strokeStyle = r.kind === 'asphalt' ? '#8b8c87' : '#c4beb0'; g.lineWidth = r.w * ppm; g.stroke(); }
  multiplyGrain(grain(215, 255), 0.25);

  // soft shadows (light from the north-west, so shadows fall south-east)
  const soft = (x, z, rx, alpha) => {
    const cx = X(x), cy = Y(z), R = rx * ppm;
    const grd = g.createRadialGradient(cx, cy, R * 0.15, cx, cy, R);
    grd.addColorStop(0, `rgba(20,35,20,${alpha})`); grd.addColorStop(1, 'rgba(20,35,20,0)');
    g.fillStyle = grd; g.fillRect(cx - R, cy - R, R * 2, R * 2);
  };
  for (const [x, z, r, hf] of D.trees) soft(x + r * 0.55, z + r * 0.55, r * 1.35, 0.32 * Math.min(hf, 1.1));
  for (const b of D.buildings) {
    const k = (b.h + (b.rh || 0)) * 0.55;
    for (let s = 1; s <= 6; s++) {
      g.save(); g.translate(k * ppm * s / 6, k * ppm * s / 6); path(b.p, true);
      g.fillStyle = 'rgba(25,30,25,0.07)'; g.fill(); g.restore();
    }
  }
  { const p = D.pavilion; soft(p.cx + 2, p.cz + 2, p.r * 1.6, 0.35); }

  // building footprints (visible at the eaves)
  for (const b of D.buildings) { path(b.p, true); g.fillStyle = '#bdb5a5'; g.fill(); }

  // labels painted on the ground
  const label = (text, x, z, ang, size, color, weight = 500) => {
    g.save(); g.translate(X(x), Y(z)); g.rotate(ang);
    g.font = `${weight} ${size * ppm}px "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = size * ppm * 0.22; g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineJoin = 'round';
    g.strokeText(text, 0, 0); g.fillStyle = color; g.fillText(text, 0, 0); g.restore();
  };
  const alongRoad = (r, frac, text, size, color, shift) => {
    const p = r.p; let len = 0; const segs = [];
    for (let i = 2; i < p.length; i += 2) { const l = Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]); segs.push([i, l]); len += l; }
    let acc = 0; const target = len * frac;
    for (const [i, l] of segs) {
      if (acc + l >= target) {
        const t = (target - acc) / l, x = p[i - 2] + (p[i] - p[i - 2]) * t, z = p[i - 1] + (p[i + 1] - p[i - 1]) * t;
        let a = Math.atan2(p[i + 1] - p[i - 1], p[i] - p[i - 2]);
        if (a > Math.PI / 2) a -= Math.PI; if (a < -Math.PI / 2) a += Math.PI;
        label(text, x - Math.sin(a) * shift, z + Math.cos(a) * shift, a, size, color);
        return;
      }
      acc += l;
    }
  };
  if (main) alongRoad(main, 0.36, '華 山 產 業 道 路', 2.6, '#4d4a42', 0);
  const up = D.roads.find(r => r.id === 'up');
  if (up) alongRoad(up, 0.55, '往寶華山頂', 2.4, '#4d4a42', -4.5);
  { const [x, z] = D.edges.west; label('← 往牌樓・山下', x + 16, z - 8, 0.08, 2.8, '#3c3a34', 700); }

  // scale bar, bottom-left corner
  { const x0 = -W / 2 + 6, z0 = DEP / 2 - 6, seg = 10;
    for (let k = 0; k < 5; k++) { g.fillStyle = k % 2 ? '#f6f3ea' : '#2c2b27'; g.fillRect(X(x0 + k * seg), Y(z0) - 0.6 * ppm, seg * ppm, 1.2 * ppm); }
    g.strokeStyle = '#2c2b27'; g.lineWidth = Math.max(1, 0.15 * ppm); g.strokeRect(X(x0), Y(z0) - 0.6 * ppm, 5 * seg * ppm, 1.2 * ppm);
    g.font = `500 ${2.2 * ppm}px "Noto Sans TC", sans-serif`; g.textBaseline = 'bottom'; g.fillStyle = '#f6f3ea';
    g.textAlign = 'left'; g.fillText('0', X(x0), Y(z0) - 1.0 * ppm);
    g.textAlign = 'right'; g.fillText('50 公尺', X(x0 + 5 * seg), Y(z0) - 1.0 * ppm);
  }
  modelTex.needsUpdate = true;
  needsRender = true;
}
onFonts(paintModel);
