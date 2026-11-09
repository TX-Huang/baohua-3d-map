/* ====== 設定 ======
   地點名稱、說明、工作人員、桌子、走道都放在 layout.json，可以在網址加 ?edit 進編輯模式修改。 */
const LC = window.LayoutCore;
const REPO = 'TX-Huang/baohua-3d-map', BRANCH = 'main', LAYOUT_FILE = 'layout.json';
const params = new URLSearchParams(location.search);
const EDIT = params.has('edit');
const DEBUG = params.has('debug');
const MAIN_HALL = 'B';
const HOME_ID = 'P2';
let needsRender = true;
let topView = false;
let photoMode = false;

// Ask for the published layout right away; the 3D model is built while it downloads.
const layoutRequest = (function () {
  if (!/^https?:$/.test(location.protocol) || !window.fetch) return Promise.resolve(null);
  const ctl = window.AbortController ? new AbortController() : null;
  const timer = setTimeout(() => ctl && ctl.abort(), EDIT ? 12000 : 6000);
  return fetch(LAYOUT_FILE + '?t=' + Date.now(), { cache: 'no-store', signal: ctl ? ctl.signal : undefined })
    .then(r => (r.ok ? r.json() : null)).catch(() => null).finally(() => clearTimeout(timer));
})();

const D = window.MAPDATA;
const G = D.grid, GEO = D.geo;
const COLS = G.cols, ROWS = G.rows, STEP = G.step, W = G.width, DEP = G.depth, HMIN = G.hmin;
const BASE_Y = -14;
const H = (function () {
  const bin = atob(G.b64); const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  const u16 = new Uint16Array(u8.buffer); const out = new Float32Array(u16.length);
  for (let i = 0; i < u16.length; i++) out[i] = u16[i] / 100;     // metres above HMIN
  return out;
})();
const HMAX = H.reduce((m, v) => Math.max(m, v), 0);
function yAt(x, z) {
  const c = Math.min(Math.max((x + W / 2) / STEP, 0), COLS - 1.001);
  const r = Math.min(Math.max((z + DEP / 2) / STEP, 0), ROWS - 1.001);
  const c0 = Math.floor(c), r0 = Math.floor(r), fc = c - c0, fr = r - r0, i = r0 * COLS + c0;
  return (H[i] * (1 - fc) + H[i + 1] * fc) * (1 - fr) + (H[i + COLS] * (1 - fc) + H[i + COLS + 1] * fc) * fr;
}
/* Floors people can walk on above the ground (the main hall's platform and stairs). Each entry has
   at(x, z): the floor height at a map point, or -Infinity off it (walkways and tables sit on whichever
   is higher, the ground or the floor, so they are not buried under the steps), and
   hit(ray): how far along a camera ray it is hit, or null (for taps). */
const WALK = [];
function surfaceAt(x, z) {
  let y = yAt(x, z);
  for (const w of WALK) { const s = w.at(x, z); if (s > y) y = s; }
  return y;
}
const toLocal = (lon, lat) => LC.toLocal(GEO, lon, lat);
const toLonLat = (x, z) => LC.toLonLat(GEO, x, z);
const clampX = (x) => Math.min(Math.max(x, -W / 2 + 1), W / 2 - 1);
const clampZ = (z) => Math.min(Math.max(z, -DEP / 2 + 1), DEP / 2 - 1);

const stage = document.getElementById('stage');
const pinLayer = document.getElementById('pins');
const loading = document.getElementById('loading');
if (!window.THREE || !THREE.OrbitControls || !LC) { loading.firstElementChild.textContent = '3D 元件載入失敗，請重新整理頁面。'; return; }
let renderer;
try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); }
catch (err) { loading.firstElementChild.textContent = '這台裝置無法顯示 3D，請改用新版 Chrome 或 Safari。'; return; }
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.setClearColor(0x000000, 0);
stage.appendChild(renderer.domElement);
const ANISO = Math.min(8, renderer.capabilities.getMaxAnisotropy());

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 1, 5000);
const fog = new THREE.Fog(0xf1f4f1, 600, 2000);
scene.fog = fog;
scene.add(new THREE.HemisphereLight(0xf3f6ff, 0x5b4a38, 0.62));
const sun = new THREE.DirectionalLight(0xfff3e0, 0.92);
sun.position.set(-300, 420, -260);      // north-west light, matches the baked shadows
scene.add(sun);
const matCache = {};
const mat = (c) => matCache[c] || (matCache[c] = new THREE.MeshLambertMaterial({ color: c }));

/* fonts: some textures (ground labels, the temple sign, walkway text) are drawn again once the web fonts arrive */
const fontWaiters = [];
const onFonts = (fn) => fontWaiters.push(fn);
const fontsReady = Promise.race([
  Promise.all([
    document.fonts.load('500 30px "Noto Sans TC"', '華山產業道路往寶華頂牌樓下公尺0510'),
    document.fonts.load('700 60px "LXGW WenKai TC"', '寶華山慈惠堂神明專用'),
  ]),
  new Promise(r => setTimeout(r, 2500)),
]).catch(() => {});
fontsReady.then(() => { for (const fn of fontWaiters) fn(); needsRender = true; });

/* ---------------- terrain ---------------- */
const geo = new THREE.PlaneGeometry(W, DEP, COLS - 1, ROWS - 1);
geo.rotateX(-Math.PI / 2);
const pos = geo.attributes.position;
for (let i = 0; i < pos.count; i++) pos.setY(i, H[i]);
geo.computeVertexNormals();

const TW = Math.min(4096, renderer.capabilities.maxTextureSize || 4096);
const texCanvas = document.createElement('canvas');
const modelTex = new THREE.CanvasTexture(texCanvas);
modelTex.encoding = THREE.sRGBEncoding;
modelTex.anisotropy = ANISO;
const photoTex = new THREE.TextureLoader().load(D.photo, () => { needsRender = true; });
photoTex.encoding = THREE.sRGBEncoding;
photoTex.anisotropy = ANISO;

const contourU = { value: 1 };
const terrainMat = new THREE.MeshLambertMaterial({ map: modelTex });
terrainMat.extensions = { derivatives: true };
terrainMat.onBeforeCompile = (shader) => {
  shader.uniforms.uHmin = { value: HMIN };
  shader.uniforms.uContour = contourU;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nuniform float uHmin; varying float vElev;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvElev = position.y + uHmin;');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying float vElev; uniform float uContour;')
    .replace('#include <map_fragment>', `#include <map_fragment>
      float f5 = vElev / 5.0; float w5 = fwidth(f5);
      float d5 = min(fract(f5), 1.0 - fract(f5));
      float minor = (1.0 - smoothstep(0.0, w5 * 1.1, d5)) * (1.0 - smoothstep(0.15, 0.45, w5));
      float f25 = vElev / 25.0; float w25 = fwidth(f25);
      float d25 = min(fract(f25), 1.0 - fract(f25));
      float major = (1.0 - smoothstep(0.0, w25 * 1.5, d25)) * (1.0 - smoothstep(0.25, 0.6, w25));
      diffuseColor.rgb *= 1.0 - max(minor * 0.12, major * 0.26) * uContour;`);
};
const terrain = new THREE.Mesh(geo, terrainMat);
scene.add(terrain);

(function buildBlock() {
  const edges = [[], [], [], []];
  for (let c = 0; c < COLS; c++) edges[0].push([c, 0]);
  for (let r = 0; r < ROWS; r++) edges[1].push([COLS - 1, r]);
  for (let c = COLS - 1; c >= 0; c--) edges[2].push([c, ROWS - 1]);
  for (let r = ROWS - 1; r >= 0; r--) edges[3].push([0, r]);
  const P = [];
  for (const e of edges) for (let k = 0; k < e.length - 1; k++) {
    const [c1, r1] = e[k], [c2, r2] = e[k + 1];
    const x1 = -W / 2 + c1 * STEP, z1 = -DEP / 2 + r1 * STEP, y1 = H[r1 * COLS + c1];
    const x2 = -W / 2 + c2 * STEP, z2 = -DEP / 2 + r2 * STEP, y2 = H[r2 * COLS + c2];
    P.push(x1, y1, z1, x1, BASE_Y, z1, x2, y2, z2, x2, y2, z2, x1, BASE_Y, z1, x2, BASE_Y, z2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.computeVertexNormals();
  scene.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: 0x6b5843, side: THREE.DoubleSide })));
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(W, DEP).rotateX(Math.PI / 2), mat(0x4a3c2e));
  plate.position.y = BASE_Y; scene.add(plate);
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const cg = c.getContext('2d'); const grd = cg.createRadialGradient(128, 128, 30, 128, 128, 128);
  grd.addColorStop(0, 'rgba(0,0,0,0.28)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
  cg.fillStyle = grd; cg.fillRect(0, 0, 256, 256);
  const sh = new THREE.Mesh(new THREE.PlaneGeometry(W * 1.6, DEP * 1.7).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
  sh.position.y = BASE_Y - 25; scene.add(sh);
})();

/* Where does a screen point hit the ground? The terrain: walk along the camera ray until it dips below it.
   The walkable floors (steps, platform): their boxes are hit exactly, so a tap lands on the step that was
   tapped and a thin step edge is never skipped. Walls and roofs are looked through. */
const _ray = new THREE.Raycaster(), _ndc = new THREE.Vector2();
function rayFrom(clientX, clientY) {
  const rect = renderer.domElement.getBoundingClientRect();
  _ndc.set((clientX - rect.left) / rect.width * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  camera.updateMatrixWorld();
  _ray.setFromCamera(_ndc, camera);
  return _ray;
}
const GROUND_BOX = new THREE.Box3(new THREE.Vector3(-W / 2, -1, -DEP / 2), new THREE.Vector3(W / 2, HMAX + 5, DEP / 2));
const _hit = new THREE.Vector3();
function terrainHit(ray) {        // distance along the ray, or null
  const o = ray.origin, d = ray.direction;
  let t0 = 0;
  if (!GROUND_BOX.containsPoint(o)) { if (!ray.intersectBox(GROUND_BOX, _hit)) return null; t0 = _hit.distanceTo(o); }
  const above = (t) => o.y + d.y * t - yAt(o.x + d.x * t, o.z + d.z * t);
  const t1 = t0 + Math.hypot(W, DEP, HMAX + 6);
  let prev = t0;
  for (let t = t0; t <= t1; t += 0.5) {
    const x = o.x + d.x * t, z = o.z + d.z * t;
    if (Math.abs(x) > W / 2 + 0.5 || Math.abs(z) > DEP / 2 + 0.5) { if (t > t0 + 1) return null; prev = t; continue; }
    if (above(t) <= 0) {
      let a = prev, b = t;
      for (let k = 0; k < 14; k++) { const m = (a + b) / 2; if (above(m) > 0) a = m; else b = m; }
      return b;
    }
    prev = t;
  }
  return null;
}
function groundAt(clientX, clientY) {
  const ray = rayFrom(clientX, clientY).ray;
  let t = terrainHit(ray);
  for (const w of WALK) { const h = w.hit(ray); if (h !== null && (t === null || h < t)) t = h; }
  if (t === null) return null;
  const x = clampX(ray.origin.x + ray.direction.x * t), z = clampZ(ray.origin.z + ray.direction.z * t);
  return { x, y: ray.origin.y + ray.direction.y * t, z };
}
