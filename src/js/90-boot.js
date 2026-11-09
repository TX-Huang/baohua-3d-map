/* ---------------- start ---------------- */
let ready = false;
applyLayout();
paintModel();
loading.hidden = true;
requestAnimationFrame(loop);
layoutRequest.then((raw) => {
  const published = raw ? LC.normalizeLayout(raw) : null;
  publishedUpdated = published ? published.updated : LAYOUT.updated;
  publishedFp = baseFp = LC.fingerprint(published || LAYOUT);
  if (EDIT) {
    const draft = loadDraft();
    if (draft) {
      LAYOUT = draft.layout;
      baseFp = draft.baseFp;
      if (baseFp !== publishedFp) {
        toast('提醒：網站上的版本比這份草稿新。按「發布」時會先問你要不要蓋掉它。', 10000);
      }
    } else if (published) LAYOUT = published;
    applyLayout();
    initEditor();
    if (offMap) toast('有東西的位置在地圖外面，先放在地圖邊緣了。請拖回正確位置，或刪掉它。', 10000);
  } else if (published) {
    LAYOUT = published;
    applyLayout();
  }
  const hashId = decodeURIComponent((location.hash || '').slice(1));
  if (byId[hashId]) select(hashId);
  ready = true;
});
window.addEventListener('hashchange', () => { const id = decodeURIComponent(location.hash.slice(1)); if (byId[id] && id !== activeId) select(id); });
if (DEBUG) window.__map = {
  renderer, scene, camera, controls, placePins, tick,
  get ready() { return ready; },
  layout: () => JSON.parse(JSON.stringify(LAYOUT)),
  points: () => POINTS.map(({ id, kind, x, y, z, name }) => ({ id, kind, x, y, z, name })),
  screenOf: (x, y, z) => { const s = screenOf(x, y, z); return { x: s.x, y: s.y }; },
  yAt, groundAt, toLocal, toLonLat,
  objectFor: (id) => itemObjs.get(id) || pathObjs.get(id) || null,
  buildingGroup: (id) => bldgGroups[id] || null,
  lookAt: (x, z, dist) => { tween = null; zoomGoal = null; setView({ target: new THREE.Vector3(x, yAt(x, z), z), dist, polar: deg(50), az: camSph().theta }); },
  publishCount: () => publishCount,
};
