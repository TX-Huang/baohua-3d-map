/* Layout data: what the event staff can edit on the map (place names, notes, staff lists,
   movable items such as tables, and walkways drawn on the ground).
   Pure functions only, no three.js and no DOM, so Node can test them (tests/layout-core.test.js).
   Positions are stored as longitude/latitude so the data survives a rebuild of the 3D model. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LayoutCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ITEM_TYPES = {
    table: { label: '桌子', name: '桌子', glyph: '桌', prefix: 't' },
    tent: { label: '帳篷', name: '帳篷', glyph: '棚', prefix: 'k' },
    marker: { label: '標記', name: '標記點', glyph: '點', prefix: 'm' },
  };
  const PATH_STYLES = {
    red: { label: '紅毯', base: '#b5361e', edge: '#e8c35a', text: '#fbe08a' },
    yellow: { label: '黃色', base: '#e9c445', edge: '#9a6a12', text: '#8a2414' },
    white: { label: '白色', base: '#f4f1ea', edge: '#b5361e', text: '#b5361e' },
  };
  const PATH_DEFAULTS = { name: '走道', text: '神明專用', style: 'red', prefix: 'w' };
  const PATH_WIDTH = { min: 0.8, max: 8, def: 2 };
  const LIMITS = { name: 24, glyph: 1, note: 300, staffName: 20, staffCount: 30, text: 12, pathPts: 80, items: 300, paths: 60, ribbonSamples: 4000 };
  const ID_RE = /^[A-Za-z0-9_-]{1,24}$/;

  const isObj = (o) => o !== null && typeof o === 'object' && !Array.isArray(o);
  // own keys only: "constructor" or "toString" must not count as an item type or a colour
  const has = (table, key) => typeof key === 'string' && Object.prototype.hasOwnProperty.call(table, key);
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  // Text people typed: no control characters, trimmed, cut to a maximum number of characters.
  function clean(v, max) {
    if (typeof v !== 'string') return '';
    const s = v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
    const chars = Array.from(s);
    return chars.length > max ? chars.slice(0, max).join('').trim() : s;
  }
  const cleanNote = (v) => clean(typeof v === 'string' ? v.replace(/\r\n?/g, '\n') : v, LIMITS.note);
  function glyphOf(v, fallback) {
    const s = clean(v, 8);
    return s ? Array.from(s)[0] : fallback;
  }
  function parseStaff(v) {
    const list = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[\n,，、;；]+/) : [];
    const out = [];
    for (const n of list) {
      const s = clean(n, LIMITS.staffName);
      if (s) out.push(s);
      if (out.length >= LIMITS.staffCount) break;
    }
    return out;
  }
  const normDeg = (d) => { const r = ((d % 360) + 360) % 360; return Math.round(r * 1000) / 1000; };
  const clampWidth = (w) => Math.round(Math.min(PATH_WIDTH.max, Math.max(PATH_WIDTH.min, w)) * 100) / 100;
  const round7 = (v) => Math.round(v * 1e7) / 1e7;
  function lonLat(p) {
    if (!Array.isArray(p) || p.length < 2) return null;
    const lon = num(p[0]), lat = num(p[1]);
    if (lon === null || lat === null || Math.abs(lon) > 180 || Math.abs(lat) > 90) return null;
    return [round7(lon), round7(lat)];
  }

  function normItem(o) {
    if (!isObj(o) || !ID_RE.test(o.id) || !has(ITEM_TYPES, o.type)) return null;
    const ll = lonLat([o.lon, o.lat]);
    if (!ll) return null;
    const t = ITEM_TYPES[o.type];
    return {
      id: o.id, type: o.type,
      name: clean(o.name, LIMITS.name) || t.name,
      glyph: glyphOf(o.glyph, t.glyph),
      lon: ll[0], lat: ll[1],
      rot: normDeg(num(o.rot) ?? 0),
      note: cleanNote(o.note),
      staff: parseStaff(o.staff),
    };
  }
  function normPath(o) {
    if (!isObj(o) || !ID_RE.test(o.id) || !Array.isArray(o.pts)) return null;
    const pts = [];
    for (const p of o.pts.slice(0, LIMITS.pathPts)) { const q = lonLat(p); if (!q) return null; pts.push(q); }
    if (pts.length < 2) return null;
    return {
      id: o.id,
      name: clean(o.name, LIMITS.name) || PATH_DEFAULTS.name,
      text: typeof o.text === 'string' ? clean(o.text, LIMITS.text) : PATH_DEFAULTS.text,
      width: clampWidth(num(o.width) ?? PATH_WIDTH.def),
      style: has(PATH_STYLES, o.style) ? o.style : PATH_DEFAULTS.style,
      pts,
      note: cleanNote(o.note),
      staff: parseStaff(o.staff),
    };
  }
  function normPlace(o) {
    if (!isObj(o)) return null;
    return { name: clean(o.name, LIMITS.name), glyph: glyphOf(o.glyph, ''), note: cleanNote(o.note), staff: parseStaff(o.staff) };
  }

  function normalizeLayout(raw) {
    const out = { v: 1, updated: null, places: {}, items: [], paths: [] };
    if (!isObj(raw)) return out;
    if (typeof raw.updated === 'string' && !Number.isNaN(Date.parse(raw.updated))) out.updated = raw.updated;
    if (isObj(raw.places)) {
      for (const id of Object.keys(raw.places)) {
        if (!ID_RE.test(id)) continue;
        const p = normPlace(raw.places[id]);
        if (p) out.places[id] = p;
      }
    }
    const seen = new Set();
    if (Array.isArray(raw.items)) {
      for (const o of raw.items) {
        const it = normItem(o);
        if (!it || seen.has(it.id) || out.items.length >= LIMITS.items) continue;
        seen.add(it.id); out.items.push(it);
      }
    }
    if (Array.isArray(raw.paths)) {
      for (const o of raw.paths) {
        const p = normPath(o);
        if (!p || seen.has(p.id) || out.paths.length >= LIMITS.paths) continue;
        seen.add(p.id); out.paths.push(p);
      }
    }
    return out;
  }

  /* ---------- editing ---------- */
  function nextId(layout, prefix) {
    const used = new Set([...layout.items, ...layout.paths].map(o => o.id));
    let n = 1;
    while (used.has(prefix + n)) n++;
    return prefix + n;
  }
  function addItem(layout, type, lon, lat, rot) {
    if (!has(ITEM_TYPES, type) || layout.items.length >= LIMITS.items) return null;
    const it = normItem({ id: nextId(layout, ITEM_TYPES[type].prefix), type, lon, lat, rot: rot || 0 });
    if (it) layout.items.push(it);
    return it;
  }
  function addPath(layout, pts) {
    if (layout.paths.length >= LIMITS.paths) return null;
    const p = normPath({ id: nextId(layout, PATH_DEFAULTS.prefix), pts });
    if (p) layout.paths.push(p);
    return p;
  }
  function findEntity(layout, id) {
    const item = layout.items.find(o => o.id === id);
    if (item) return { kind: 'item', obj: item };
    const path = layout.paths.find(o => o.id === id);
    if (path) return { kind: 'path', obj: path };
    return null;
  }
  function removeEntity(layout, id) {
    for (const key of ['items', 'paths']) {
      const i = layout[key].findIndex(o => o.id === id);
      if (i >= 0) { layout[key].splice(i, 1); return true; }
    }
    return false;
  }
  // Apply the fields a person may change. Type and id never change; bad values are ignored.
  function patchText(obj, patch, defaults) {
    if ('name' in patch) obj.name = clean(patch.name, LIMITS.name) || defaults.name;
    if ('glyph' in patch) obj.glyph = glyphOf(patch.glyph, defaults.glyph);
    if ('note' in patch) obj.note = cleanNote(patch.note);
    if ('staff' in patch) obj.staff = parseStaff(patch.staff);
  }
  function patchItem(obj, patch) {
    patchText(obj, patch, ITEM_TYPES[obj.type]);
    if ('rot' in patch && num(patch.rot) !== null) obj.rot = normDeg(patch.rot);
    const ll = ('lon' in patch || 'lat' in patch) ? lonLat([patch.lon, patch.lat]) : null;
    if (ll) { obj.lon = ll[0]; obj.lat = ll[1]; }
  }
  function patchPath(obj, patch) {
    patchText(obj, patch, { name: PATH_DEFAULTS.name, glyph: '' });
    if ('text' in patch) obj.text = clean(patch.text, LIMITS.text);
    if ('width' in patch && num(Number(patch.width)) !== null) obj.width = clampWidth(Number(patch.width));
    if ('style' in patch && has(PATH_STYLES, patch.style)) obj.style = patch.style;
    if ('pts' in patch && Array.isArray(patch.pts)) {
      const pts = patch.pts.slice(0, LIMITS.pathPts).map(lonLat);
      if (pts.length >= 2 && pts.every(Boolean)) obj.pts = pts;
    }
  }
  function updateEntity(layout, id, patch) {
    const found = findEntity(layout, id);
    if (found) {
      (found.kind === 'item' ? patchItem : patchPath)(found.obj, patch);
      return found.obj;
    }
    if (!ID_RE.test(id)) return null;
    const place = layout.places[id] || (layout.places[id] = { name: '', glyph: '', note: '', staff: [] });
    patchText(place, patch, { name: '', glyph: '' });
    return place;
  }

  /* ---------- coordinates ---------- */
  const toLocal = (geo, lon, lat) => ({ x: (lon - geo.lon0) * geo.mLon, z: -(lat - geo.lat0) * geo.mLat });
  const toLonLat = (geo, x, z) => ({ lon: round7(geo.lon0 + x / geo.mLon), lat: round7(geo.lat0 - z / geo.mLat) });

  /* ---------- walkway geometry ---------- */
  function pathLength(pts) {
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    return len;
  }
  function pointAt(pts, frac) {
    const target = pathLength(pts) * Math.min(Math.max(frac, 0), 1);
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      if (acc + l >= target && l > 0) {
        const t = (target - acc) / l;
        return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t];
      }
      acc += l;
    }
    return pts[pts.length - 1].slice();
  }
  /* A flat strip of the given width laid along the points ([x, z] in metres), sampled every `step` metres
     so it follows the ground (y from yFn). u runs 0 (left edge, walking from the first point) to 1;
     v is the distance along the strip in metres. Corners use a mitre capped at 2x the half-width. */
  function ribbon(pts, width, yFn, opt) {
    const lift = (opt && opt.lift) || 0;
    const P = pts.filter((p, i) => i === 0 || Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) > 1e-6);
    // never more than LIMITS.ribbonSamples samples, however long the path (a mistyped point can be far away)
    const step = Math.max((opt && opt.step) || 0.5, pathLength(P) / LIMITS.ribbonSamples);
    const S = [];       // samples: x, z, distance, nx, nz (left normal, already mitred)
    if (P.length < 2) return { positions: new Float32Array(0), uvs: new Float32Array(0), indices: [], length: 0 };
    const segN = [];
    for (let i = 1; i < P.length; i++) {
      const dx = P[i][0] - P[i - 1][0], dz = P[i][1] - P[i - 1][1], l = Math.hypot(dx, dz);
      segN.push([dz / l, -dx / l, l]);        // left of the walking direction, seen from above (x east, z south)
    }
    let dist = 0;
    for (let i = 0; i < segN.length; i++) {
      const [nx, nz, l] = segN[i];
      const n = Math.max(1, Math.ceil(l / step));
      for (let k = 0; k < n; k++) {
        const t = k / n;
        let mx = nx, mz = nz;
        if (k === 0 && i > 0) {             // corner: average the two normals, stretch to keep the width
          const [px, pz] = segN[i - 1];
          let ax = px + nx, az = pz + nz; const al = Math.hypot(ax, az);
          if (al > 1e-6) { ax /= al; az /= al; const c = Math.max(ax * nx + az * nz, 0.5); mx = ax / c; mz = az / c; }
        }
        S.push([P[i][0] + (P[i + 1][0] - P[i][0]) * t, P[i][1] + (P[i + 1][1] - P[i][1]) * t, dist + l * t, mx, mz]);
      }
      dist += l;
    }
    const last = segN[segN.length - 1];
    S.push([P[P.length - 1][0], P[P.length - 1][1], dist, last[0], last[1]]);
    const hw = width / 2, positions = new Float32Array(S.length * 6), uvs = new Float32Array(S.length * 4), indices = [];
    S.forEach(([x, z, d, nx, nz], k) => {
      const lx = x + nx * hw, lz = z + nz * hw, rx = x - nx * hw, rz = z - nz * hw;
      positions.set([lx, yFn(lx, lz) + lift, lz, rx, yFn(rx, rz) + lift, rz], k * 6);
      uvs.set([0, d, 1, d], k * 4);
      if (k > 0) { const a = (k - 1) * 2; indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    });
    return { positions, uvs, indices, length: dist };
  }

  /* ---------- saving ---------- */
  function serialize(layout, now) {
    const out = normalizeLayout(layout);
    out.updated = (now || new Date()).toISOString();
    return JSON.stringify(out, null, 2) + '\n';
  }
  function utf8ToBase64(str) {
    if (typeof Buffer !== 'undefined') return Buffer.from(str, 'utf8').toString('base64');
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function base64ToUtf8(b64) {
    const s = String(b64 || '').replace(/\s+/g, '');
    if (typeof Buffer !== 'undefined') return Buffer.from(s, 'base64').toString('utf8');
    const bin = atob(s), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  // What a layout says, ignoring its time stamp and formatting: two layouts with the same fingerprint show the same map.
  const fingerprint = (layout) => JSON.stringify({ ...normalizeLayout(layout), updated: null });
  function readFile(file) {         // a Contents API file response -> the parsed JSON inside it, or null
    try { return JSON.parse(base64ToUtf8(file && file.content)); } catch (e) { return null; }
  }
  const failure = (status) => ({ ok: false, status,
    code: status === 0 ? 'network' : status === 401 ? 'auth' : status === 403 ? 'forbidden' : status === 404 ? 'notfound' : 'http' });
  async function call(fetch, url, opts) {
    try { return await fetch(url, opts); } catch (e) { return { ok: false, status: 0 }; }
  }
  /* Commit the text as `path` in the GitHub repository (Contents API). Resolves to {ok:true, sha} or
     {ok:false, code, status}: auth (bad or expired key), forbidden (key can't write), notfound (key
     can't see the repo), conflict (the file on GitHub is not the version the edits started from;
     remoteUpdated says when that one was published), network, http (anything else).
     baseFingerprint: fingerprint() of the version the edits started from (null = unknown, always ask);
     leave it undefined to skip the check. force: true overwrites anyway (the editor agreed).
     A 409/422 race is retried once, and the retry checks for a conflict again. */
  async function publish({ fetch, token, repo, branch, path, text, message, baseFingerprint, force }) {
    if (!token) return { ok: false, code: 'auth', status: 0 };
    const url = `https://api.github.com/repos/${repo}/contents/${path}`;
    const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    for (let attempt = 0; attempt < 2; attempt++) {
      let res = await call(fetch, `${url}?ref=${encodeURIComponent(branch)}&t=${Date.now()}`, { headers, cache: 'no-store' });
      if (res.status !== 200 && res.status !== 404) return failure(res.status);
      const file = res.status === 200 ? await res.json() : null;
      if (file && !force && baseFingerprint !== undefined) {
        const remote = readFile(file);
        if (baseFingerprint === null || !remote || fingerprint(remote) !== baseFingerprint) {
          return { ok: false, code: 'conflict', status: 200, remoteUpdated: isObj(remote) && typeof remote.updated === 'string' ? remote.updated : null };
        }
      }
      const body = { message, content: utf8ToBase64(text), branch };
      if (file && file.sha) body.sha = file.sha;
      res = await call(fetch, url, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (res.ok) { const j = await res.json(); return { ok: true, sha: j && j.content ? j.content.sha : undefined }; }
      if ((res.status === 409 || res.status === 422) && attempt === 0) continue;
      return failure(res.status);
    }
    return failure(409);
  }

  return {
    ITEM_TYPES, PATH_STYLES, PATH_DEFAULTS, PATH_WIDTH, LIMITS,
    normalizeLayout, parseStaff, nextId, addItem, addPath, findEntity, removeEntity, updateEntity,
    toLocal, toLonLat, pathLength, pointAt, ribbon, serialize, utf8ToBase64, fingerprint, publish,
  };
});
