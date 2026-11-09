/* ---------------- trees ---------------- */
// A tree is a trunk that forks into two limbs, under a crown of overlapping leaf masses. There are four kinds
// of crown, one per leaf colour, so each reads as its own kind of tree. Sizes come from the map data:
// r = crown radius in metres, hf = how tall the tree is for its width.
const TREE_COLS = ['#3e6a39', '#4b7a3f', '#5a8946', '#355f38'];
// leaf masses [x, y, z, radius], roughly in crown radii; the first one is the middle of the crown
const CROWN_KINDS = [
  [[0, 0.75, 0, 0.62], [0.45, 0.6, 0.12, 0.42], [-0.4, 0.62, 0.25, 0.42], [0.05, 0.6, -0.45, 0.42], [-0.08, 1.15, 0.05, 0.45], [0.25, 1.0, 0.3, 0.36]], // round dome
  [[0, 0.75, 0, 0.52], [0, 1.25, 0, 0.47], [0.32, 0.95, 0.15, 0.36], [-0.3, 1.0, -0.2, 0.35], [0.05, 1.55, 0.05, 0.38]], // tall and narrow
  [[0, 0.55, 0, 0.5], [0.58, 0.45, 0.15, 0.4], [-0.52, 0.48, -0.1, 0.42], [0.1, 0.42, 0.58, 0.38], [-0.15, 0.45, -0.58, 0.4], [0.05, 0.85, 0.05, 0.38]], // wide, flat-topped
  [[0, 0.65, 0, 0.52], [0.45, 0.95, 0.2, 0.38], [-0.38, 0.5, -0.3, 0.4], [0.15, 1.25, -0.15, 0.36], [-0.42, 0.98, 0.35, 0.33]], // uneven clumps
];
// one closed surface around all the leaf masses: from the crown's middle, each direction goes out to where it
// leaves the leaf masses (a soft maximum, so the folds between them are rounded, not sharp), plus a few broad
// bumps. Fitted so the bottom is at y = 0 and the widest reach is exactly 1 crown radius.
// Shading is baked into vertex colours: darker low down and in the folds.
function crownGeometry(blobs, rnd) {
  const ico = new THREE.IcosahedronGeometry(1, 2).attributes.position, seen = new Map(), dirs = [], index = [];
  for (let i = 0; i < ico.count; i++) {   // weld the corners the icosahedron repeats, so normals come out smooth
    const k = [ico.getX(i), ico.getY(i), ico.getZ(i)].map(a => Math.round(a * 1e4)).join();
    if (!seen.has(k)) { seen.set(k, dirs.length); dirs.push(new THREE.Vector3(ico.getX(i), ico.getY(i), ico.getZ(i)).normalize()); }
    index.push(seen.get(k));
  }
  const lumps = Array.from({ length: 5 }, () => [new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize(), 3 + rnd() * 2, rnd() * 6.28]);
  const cy = blobs[0][1], o = new THREE.Vector3(), P = new Float32Array(dirs.length * 3);
  dirs.forEach((d, i) => {
    let sum = 0;
    for (const [bx, by, bz, br] of blobs) {   // where the ray leaves this leaf mass
      o.set(-bx, cy - by, -bz);
      const b = o.dot(d), disc = b * b - o.lengthSq() + br * br;
      if (disc >= 0) sum += Math.max(0, -b + Math.sqrt(disc)) ** 8;
    }
    const t = sum ** (1 / 8) * (1 + 0.05 * lumps.reduce((s, [u, f, ph]) => s + Math.sin(d.dot(u) * f + ph), 0) / lumps.length);
    P.set([d.x * t, cy + d.y * t, d.z * t], i * 3);
  });
  let lo = Infinity, reach = 0;
  for (let i = 0; i < P.length; i += 3) { lo = Math.min(lo, P[i + 1]); reach = Math.max(reach, Math.hypot(P[i], P[i + 2])); }
  for (let i = 0; i < P.length; i += 3) { P[i] /= reach; P[i + 1] = (P[i + 1] - lo) / reach; P[i + 2] /= reach; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setIndex(index); g.computeVertexNormals(); g.computeBoundingBox();
  const top = g.boundingBox.max.y, mid = (cy - lo) / reach, N = g.attributes.normal, C = new Float32Array(P.length), v = new THREE.Vector3();
  for (let i = 0; i < P.length; i += 3) {
    const h = P[i + 1] / top, k = i / 3;
    const out = v.set(P[i], P[i + 1] - mid, P[i + 2]).normalize().dot(o.set(N.getX(k), N.getY(k), N.getZ(k)));
    const shade = (0.5 + 0.5 * h * h * (3 - 2 * h)) * (0.72 + 0.28 * Math.max(0, out)) * (1 + (rnd() - 0.5) * 0.14);
    C.set([shade * (1 + 0.05 * h), shade * (1 + 0.03 * h), shade * (1 - 0.06 * h)], i);   // tops catch a warmer light
  }
  g.setAttribute('color', new THREE.BufferAttribute(C, 3));
  return g;
}
// trunk and two limbs: widths in crown radii, height 0 to 1, stretched to each tree's trunk length
function trunkGeometry() {
  const parts = [new THREE.CylinderGeometry(0.05, 0.085, 0.62, 6, 1, true).translate(0, 0.31, 0)];
  for (const a of [0.45, -0.45]) parts.push(new THREE.CylinderGeometry(0.022, 0.042, 0.46, 5, 1, true).translate(0, 0.23, 0).rotateZ(-a).translate(0, 0.58, 0));
  const pos = [], nor = [], idx = [];
  for (const p of parts) {
    const base = pos.length / 3;
    pos.push(...p.attributes.position.array); nor.push(...p.attributes.normal.array);
    for (const i of p.index.array) idx.push(base + i);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}
const trees = new THREE.Group(); trees.name = 'trees';
(function placeTrees() {
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), col = new THREE.Color(), UP = new THREE.Vector3(0, 1, 0);
  let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const crownMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  // leaf clusters: light and dark patches under a metre across, painted per pixel from where the leaves are in the
  // world (so no two trees match), and each cluster tilted to catch the light on one side (bump shading).
  // Faded out far away, where a pixel is wider than a cluster and it would shimmer. Left out on GPUs without
  // high-precision floats: the hash needs them, and would turn to speckle (plain shaded crowns instead).
  crownMat.extensions = { derivatives: true };
  crownMat.onBeforeCompile = (sh) => {
    if (renderer.capabilities.precision !== 'highp') return;
    sh.vertexShader = 'varying vec3 vLeaf;\n' + sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
      vec4 leafP = vec4( transformed, 1.0 );
      #ifdef USE_INSTANCING
        leafP = instanceMatrix * leafP;
      #endif
      vLeaf = ( modelMatrix * leafP ).xyz;`);
    sh.fragmentShader = `varying vec3 vLeaf;
      float leafHash( vec3 p ) { p = fract( p * 0.3183099 + 0.1 ); p *= 17.0; return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) ); }
      float leafNoise( vec3 x ) {
        vec3 i = floor( x ), f = fract( x ); f = f * f * ( 3.0 - 2.0 * f );
        return mix( mix( mix( leafHash( i ), leafHash( i + vec3( 1, 0, 0 ) ), f.x ), mix( leafHash( i + vec3( 0, 1, 0 ) ), leafHash( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
                    mix( mix( leafHash( i + vec3( 0, 0, 1 ) ), leafHash( i + vec3( 1, 0, 1 ) ), f.x ), mix( leafHash( i + vec3( 0, 1, 1 ) ), leafHash( i + vec3( 1, 1, 1 ) ), f.x ), f.y ), f.z );
      }
` + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      float leafNear = 1.0 - smoothstep( 180.0, 450.0, length( vViewPosition ) );
      float leaf = leafNoise( vLeaf * 1.6 ) * 0.55 + leafNoise( vLeaf * 4.3 + 17.0 ) * 0.45;
      diffuseColor.rgb *= mix( 1.0, 0.62 + 0.6 * leaf, leafNear );`).replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      {
        vec3 dpx = dFdx( - vViewPosition ), dpy = dFdy( - vViewPosition );
        vec3 r1 = cross( dpy, normal ), r2 = cross( normal, dpx );
        float det = dot( dpx, r1 ), bump = 0.35 * leafNear;
        vec3 grad = sign( det ) * ( dFdx( leaf * bump ) * r1 + dFdy( leaf * bump ) * r2 );
        normal = normalize( abs( det ) * normal - grad );
      }`);
  };
  const counts = CROWN_KINDS.map((_, k) => D.trees.filter(t => t[4] === k).length), used = counts.map(() => 0);
  const crowns = CROWN_KINDS.map((blobs, k) => new THREE.InstancedMesh(crownGeometry(blobs, rnd), crownMat, counts[k]));
  const trunks = new THREE.InstancedMesh(trunkGeometry(), new THREE.MeshLambertMaterial({ color: 0xffffff }), D.trees.length);
  // three.js r147 culls an InstancedMesh by its one model at the origin, not by where the copies stand
  for (const mesh of crowns) { mesh.name = 'tree-crowns'; mesh.frustumCulled = false; }
  trunks.name = 'tree-trunks'; trunks.frustumCulled = false;
  D.trees.forEach(([x, z, r, hf, v], i) => {
    const ground = yAt(x, z), clear = Math.min(2.6, Math.max(1.6, 0.5 * r * hf)), crownH = crowns[v].geometry.boundingBox.max.y * r * hf;
    q.setFromAxisAngle(UP, rnd() * Math.PI * 2);
    m.compose(p.set(x, ground + clear, z), q, s.set(r, r * hf, r));
    const j = used[v]++;
    crowns[v].setMatrixAt(j, m);
    crowns[v].setColorAt(j, col.set(TREE_COLS[v]).offsetHSL((rnd() - 0.5) * 0.03, (rnd() - 0.5) * 0.08, (rnd() - 0.5) * 0.07));
    // from 0.6 m under the ground (so slopes never show a gap) to halfway up the crown
    m.compose(p.set(x, ground - 0.6, z), q, s.set(r, 0.6 + clear + 0.45 * crownH, r));
    trunks.setMatrixAt(i, m);
    trunks.setColorAt(i, col.set('#3d3128').offsetHSL(0, 0, (rnd() - 0.5) * 0.08));
  });
  trees.add(trunks, ...crowns);
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
