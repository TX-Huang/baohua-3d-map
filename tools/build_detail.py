"""Build the data file for the close-up temple map.

All tracing below is in pixel coordinates of photo/PHOTO2_z20.png (NLSC orthophoto, zoom 20, ~0.137 m/px),
read off the aerial photo by eye. Output: local metres, x = east, z = south, origin = centre of the area.
"""
import json, math, sys, os, base64, io
import numpy as np
from PIL import Image
from scipy.ndimage import map_coordinates, distance_transform_edt, gaussian_filter
from matplotlib.path import Path

S = sys.argv[1]
OUT = sys.argv[2]
Z = 20
AREA = (100, 450, 2400, 2000)          # x0, y0, x1, y1 in photo px
STEP = 1.5                             # terrain grid spacing, metres

meta = json.load(open(os.path.join(S, 'photo', 'PHOTO2_z20.png.json')))
W_, S_, E_, N_ = meta['bbox']


def txy(lon, lat, z):
    n = 2 ** z
    return (lon + 180) / 360 * n, (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n


FX0, FY0 = txy(W_, N_, Z)


def px2ll(px, py):
    n = 2 ** Z
    gx, gy = FX0 + px / 256, FY0 + py / 256
    return gx / n * 360 - 180, math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * gy / n))))


lonA, latA = px2ll(AREA[0], AREA[3])
lonB, latB = px2ll(AREA[2], AREA[1])
LON0, LAT0 = (lonA + lonB) / 2, (latA + latB) / 2
phi = math.radians(LAT0)
M_LAT = 111132.92 - 559.82 * math.cos(2 * phi) + 1.175 * math.cos(4 * phi)
M_LON = 111412.84 * math.cos(phi) - 93.5 * math.cos(3 * phi)


def ll2m(lon, lat):
    return (lon - LON0) * M_LON, -(lat - LAT0) * M_LAT


def p2m(px, py):
    return ll2m(*px2ll(px, py))


x_min, z_max = ll2m(lonA, latA)
x_max, z_min = ll2m(lonB, latB)
WID, DEP = x_max - x_min, z_max - z_min
COLS = int(WID // STEP) + 1
ROWS = int(DEP // STEP) + 1
WID, DEP = (COLS - 1) * STEP, (ROWS - 1) * STEP
gx = np.linspace(-WID / 2, WID / 2, COLS)
gz = np.linspace(-DEP / 2, DEP / 2, ROWS)
GX, GZ = np.meshgrid(gx, gz)

# ---------- base DEM ----------
dmeta = json.load(open(os.path.join(S, 'dem_meta.json')))
dem = np.load(os.path.join(S, 'dem_mosaic.npy'))
LON = LON0 + GX / M_LON
LAT = LAT0 - GZ / M_LAT
n15 = 2 ** dmeta['z']
dpx = ((LON + 180) / 360 * n15 - dmeta['tx0']) * 256 - 0.5
dpy = ((1 - np.arcsinh(np.tan(np.radians(LAT))) / math.pi) / 2 * n15 - dmeta['ty0']) * 256 - 0.5
H = map_coordinates(dem, [dpy.ravel(), dpx.ravel()], order=3, mode='nearest').reshape(ROWS, COLS)
H = gaussian_filter(H, 6)       # 30 m source data: keep it smooth, the pads below add the crisp detail

# ---------- traced features (photo px) ----------
def rect(cx, cy, L, Wd, ang):
    a = math.radians(ang)
    u = (math.cos(a), math.sin(a))
    v = (-math.sin(a), math.cos(a))
    return [(cx + su * L / 2 * u[0] + sv * Wd / 2 * v[0], cy + su * L / 2 * u[1] + sv * Wd / 2 * v[1])
            for su, sv in ((-1, -1), (1, -1), (1, 1), (-1, 1))]


BUILDINGS = [
    # id, label, group, footprint, wall height m, roof kind, roof height m, roof colour, wall colour
    dict(id='A', group='A', fp=rect(1195, 975, 290, 140, 43), h=6.0, roof='gable', rh=4.0, rc='#41474b', wc='#efe6d4', ridge='#e8e4da'),
    dict(id='A-wing', group='A', fp=rect(1297, 957, 100, 58, 43), h=4.5, roof='gable', rh=2.2, rc='#4a5054', wc='#efe6d4'),
    dict(id='A-porch', group='A', fp=rect(1062, 922, 40, 118, 43), h=3.8, roof='flat', rh=0, rc='#d6d2c8', wc='#efe6d4'),
    dict(id='B', group='B', fp=rect(1580, 1120, 370, 95, 38), h=4.5, roof='gable', rh=1.6, rc='#e3e3dd', wc='#d8d2c6'),
    # C is an open steel-frame shed; the user marked it shorter than the dark roof in the photo:
    # keep the north-west 68 %, the strip toward the kitchen (D) becomes paved ground (see PAVED).
    dict(id='C', group='C', fp=rect(1612 - 0.766 * 19, 1312 - 0.643 * 19, 82, 110, 40), h=4.5, roof='gable', rh=1.4, rc='#575c5f', wc='#e2dccf'),
    dict(id='D', group='D', fp=rect(1735, 1400, 180, 140, 40), h=5.0, roof='gable', rh=2.0, rc='#e9e7e1', wc='#ddd6c9'),
    dict(id='E', group='E', fp=rect(1834, 1657, 285, 180, 45), h=8.0, roof='flat', rh=0, rc='#7d7f7b', wc='#d5d0c5'),
    dict(id='E-top', group='E', fp=rect(1915, 1672, 62, 50, 45), h=2.6, roof='flat', rh=0, rc='#f0eee8', wc='#e9e5dc', on='E'),
    dict(id='F', group='F', fp=[(672, 670), (800, 640), (835, 695), (700, 730)], h=4.0, roof='gable', rh=1.6, rc='#9cc6a7', wc='#e6e1d6'),
    dict(id='F-annex', group='F', fp=[(600, 700), (680, 710), (690, 745), (605, 740)], h=3.0, roof='gable', rh=1.0, rc='#7c3d35', wc='#e6e1d6'),
    dict(id='G', group='G', fp=[(700, 825), (785, 790), (795, 825), (705, 860)], h=3.5, roof='gable', rh=1.4, rc='#94c3a3', wc='#e6e1d6'),
    dict(id='G-2', group='G', fp=[(655, 815), (690, 810), (700, 870), (665, 875)], h=3.5, roof='gable', rh=1.4, rc='#94c3a3', wc='#e6e1d6'),
    dict(id='H', group='H', fp=[(580, 875), (640, 845), (675, 870), (660, 905), (600, 905)], h=4.0, roof='flat', rh=0, rc='#f2f1ec', wc='#e6e1d6'),
    dict(id='I', group='I', fp=[(730, 985), (910, 945), (920, 1000), (755, 1055)], h=4.5, roof='gable', rh=1.8, rc='#7e3035', wc='#e2dccf', stripes=6),
    dict(id='K', group='K', fp=rect(235, 718, 60, 35, 0), h=3.0, roof='gable', rh=1.2, rc='#9cc6a7', wc='#e6e1d6'),
]
PAVILION = dict(id='J', group='J', c=(245, 770), r=42, h=3.2, rh=2.6, rc='#3e413e')

PLAZAS = [
    dict(id='P1', poly=[(300, 720), (430, 705), (560, 712), (640, 745), (705, 775), (700, 815), (640, 845),
                        (605, 880), (595, 945), (525, 948), (515, 880), (470, 862), (400, 880), (330, 870), (296, 820)]),
    dict(id='P2', poly=[(1320, 990), (1440, 990), (1470, 1040), (1700, 1230), (1640, 1300), (1560, 1380),
                        (1470, 1330), (1380, 1250), (1290, 1170), (1250, 1120), (1330, 1070)]),
]
PAVED = [rect(1612, 1312, 128, 116, 40)]     # the full dark-roof area in the photo (C), now plain pavement

# Buildings the user asked to leave off the map: drop the model, keep the ground clear (no trees) as pavement.
REMOVED = {'C', 'F', 'G', 'H', 'K'}
PAVED += [b['fp'] for b in BUILDINGS if b['group'] in REMOVED and b['group'] != 'C']
BUILDINGS = [b for b in BUILDINGS if b['group'] not in REMOVED]
GRASS = [
    [(1150, 1150), (1300, 1180), (1450, 1320), (1600, 1420), (1660, 1520), (1600, 1610), (1450, 1560),
     (1300, 1410), (1150, 1300)],
    [(720, 800), (800, 760), (900, 720), (980, 760), (1000, 850), (900, 900), (800, 940), (720, 900)],
    [(150, 700), (300, 690), (300, 880), (180, 900), (120, 820)],
]
ROADS = [
    dict(id='main', w=7.0, kind='asphalt', name='華山產業道路',
         pts=[(60, 935), (100, 945), (200, 960), (300, 975), (400, 990), (500, 1000), (600, 995), (700, 980), (800, 950),
              (900, 905), (980, 860), (1060, 815), (1140, 790), (1220, 780), (1300, 795), (1360, 830), (1400, 880),
              (1415, 950), (1405, 1020)]),
    dict(id='up', w=4.0, kind='concrete', name='往山頂',
         pts=[(690, 785), (800, 735), (900, 668), (1000, 600), (1120, 500), (1240, 400)]),
]
CARS = [(1515, 1290, '#f4f4f2'), (1530, 1305, '#f4f4f2'), (1545, 1318, '#3a5c9a'), (1560, 1331, '#2b2f33')]
EDGE_WEST = (100, 935)      # where the main road leaves the model
EDGE_NE = (1240, 450)       # where the mountain road leaves the model


def mpoly(pts):
    return [p2m(x, y) for x, y in pts]


def mrect_info(poly_m):
    """Minimum-area oriented rectangle of a polygon (metres): centre, length, width, angle (rad, of long side)."""
    pts = np.array(poly_m)
    best = None
    for i in range(len(pts)):
        e = pts[(i + 1) % len(pts)] - pts[i]
        a = math.atan2(e[1], e[0])
        u = np.array([math.cos(a), math.sin(a)]); v = np.array([-u[1], u[0]])
        pu, pv = pts @ u, pts @ v
        area = (pu.max() - pu.min()) * (pv.max() - pv.min())
        if best is None or area < best[0]:
            cu, cv = (pu.max() + pu.min()) / 2, (pv.max() + pv.min()) / 2
            c = cu * u + cv * v
            L, Wd = pu.max() - pu.min(), pv.max() - pv.min()
            if Wd > L:
                L, Wd, a = Wd, L, a + math.pi / 2
            best = (area, float(c[0]), float(c[1]), float(L), float(Wd), a)
    return best[1:]


def mask_of(poly_m):
    return Path(poly_m).contains_points(np.c_[GX.ravel(), GZ.ravel()]).reshape(ROWS, COLS)


def blend_pad(mask, level, feather=7.0):
    global H
    d = distance_transform_edt(~mask) * STEP
    w = np.clip(1 - d / feather, 0, 1)
    w = w * w * (3 - 2 * w)
    H = H * (1 - w) + level * w


def bilinear(x, z):
    c = (x + WID / 2) / STEP; r = (z + DEP / 2) / STEP
    return float(map_coordinates(H, [[r], [c]], order=1, mode='nearest')[0])


# plazas: flatten to their median height
plazas_m = []
for p in PLAZAS:
    pm = mpoly(p['poly'])
    m = mask_of(pm)
    lvl = float(np.median(H[m]))
    blend_pad(m, lvl, 6)
    plazas_m.append(dict(id=p['id'], p=pm, y=lvl))
paved_m = []
plaza_masks = [(mask_of(p['p']), p['y']) for p in plazas_m]
for poly in PAVED:
    pm = mpoly(poly)
    m = mask_of(pm)
    # a patch that touches a plaza continues it at the same height, so no step or crease shows
    lvl = next((y for pmask, y in plaza_masks if (pmask & m).any()), float(np.median(H[m])))
    blend_pad(m, lvl, 4)
    paved_m.append(pm)

# roads: smooth the long profile, flatten the cross-section
roads_m = []
for r in ROADS:
    pts = mpoly(r['pts'])
    dense = []
    for (x1, z1), (x2, z2) in zip(pts, pts[1:]):
        L = math.hypot(x2 - x1, z2 - z1); k = max(int(L / 1.0), 1)
        for i in range(k):
            dense.append((x1 + (x2 - x1) * i / k, z1 + (z2 - z1) * i / k))
    dense.append(pts[-1])
    dense = np.array(dense)
    hs = np.array([bilinear(x, z) for x, z in dense])
    hs = np.convolve(np.pad(hs, 12, mode='edge'), np.ones(25) / 25, mode='valid')
    # distance from each grid node to the polyline (via nearest dense sample)
    from scipy.spatial import cKDTree
    tree = cKDTree(dense)
    dist, idx = tree.query(np.c_[GX.ravel(), GZ.ravel()])
    dist = dist.reshape(ROWS, COLS); idx = idx.reshape(ROWS, COLS)
    half = r['w'] / 2
    w = np.clip(1 - (dist - half - 0.5) / 5.0, 0, 1)
    w = w * w * (3 - 2 * w)
    H = H * (1 - w) + hs[idx] * w
    roads_m.append(dict(id=r['id'], w=r['w'], kind=r['kind'], name=r['name'], p=[v for x, z in pts for v in (round(x, 2), round(z, 2))]))

# buildings: each sits on its own level pad
bld_out = []
for b in BUILDINGS:
    pm = mpoly(b['fp'])
    m = mask_of(pm)
    if not m.any():
        m = mask_of(pm)  # tiny footprint: fall back to centroid sample below
    cx, cz, L, Wd, ang = mrect_info(pm)
    if b.get('on'):
        base = next(o for o in bld_out if o['id'] == b['on'])
        lvl = base['y'] + base['h']
    else:
        lvl = float(np.median(H[m])) if m.any() else bilinear(cx, cz)
        blend_pad(m, lvl, 4)
    o = dict(id=b['id'], group=b['group'], cx=round(cx, 2), cz=round(cz, 2), L=round(L, 2), W=round(Wd, 2),
             a=round(ang, 4), y=round(lvl, 2), h=b['h'], roof=b['roof'], rh=b['rh'], rc=b['rc'], wc=b['wc'],
             p=[v for x, z in pm for v in (round(x, 2), round(z, 2))])
    if b.get('ridge'): o['ridge'] = b['ridge']
    if b.get('stripes'): o['stripes'] = b['stripes']
    bld_out.append(o)

pc = p2m(*PAVILION['c'])
pr = PAVILION['r'] * 0.1374
pav = dict(id='J', group='J', cx=round(pc[0], 2), cz=round(pc[1], 2), r=round(pr, 2), y=round(bilinear(*pc), 2),
           h=PAVILION['h'], rh=PAVILION['rh'], rc=PAVILION['rc'])
blend_pad(mask_of([(pc[0] + pr * math.cos(t), pc[1] + pr * math.sin(t)) for t in np.linspace(0, 2 * math.pi, 16)]), pav['y'], 3)

grass_m = [[v for x, z in mpoly(g) for v in (round(x, 2), round(z, 2))] for g in GRASS]

# ---------- trees ----------
rng = np.random.default_rng(42)
blocked = np.zeros((ROWS, COLS), bool)
for p in plazas_m:
    blocked |= mask_of(p['p'])
for pm in paved_m:
    blocked |= mask_of(pm)
for b in bld_out:
    pts = [(b['p'][i], b['p'][i + 1]) for i in range(0, len(b['p']), 2)]
    blocked |= mask_of(pts)
dist_block = distance_transform_edt(~blocked) * STEP
road_dist = np.full((ROWS, COLS), 1e9)
from scipy.spatial import cKDTree
for r in roads_m:
    pts = np.array(r['p']).reshape(-1, 2)
    dense = []
    for (x1, z1), (x2, z2) in zip(pts, pts[1:]):
        L = math.hypot(x2 - x1, z2 - z1); k = max(int(L / 1.0), 1)
        for i in range(k): dense.append((x1 + (x2 - x1) * i / k, z1 + (z2 - z1) * i / k))
    d, _ = cKDTree(np.array(dense)).query(np.c_[GX.ravel(), GZ.ravel()])
    road_dist = np.minimum(road_dist, d.reshape(ROWS, COLS) - r['w'] / 2)
grass_mask = np.zeros((ROWS, COLS), bool)
for g in GRASS:
    grass_mask |= mask_of(mpoly(g))
pav_mask = np.hypot(GX - pc[0], GZ - pc[1]) < pr + 4

trees = []
SP = 4.6
for z0 in np.arange(-DEP / 2 + 1, DEP / 2 - 1, SP):
    for x0 in np.arange(-WID / 2 + 1, WID / 2 - 1, SP):
        x = x0 + rng.uniform(-SP * 0.45, SP * 0.45)
        z = z0 + rng.uniform(-SP * 0.45, SP * 0.45)
        if abs(x) > WID / 2 - 1.5 or abs(z) > DEP / 2 - 1.5:
            continue
        c = int(round((x + WID / 2) / STEP)); r = int(round((z + DEP / 2) / STEP))
        if dist_block[r, c] < 2.5 or road_dist[r, c] < 2.2 or pav_mask[r, c]:
            continue
        if grass_mask[r, c] and rng.random() > 0.14:
            continue
        rad = rng.uniform(2.1, 3.6)
        trees.append((round(x, 1), round(z, 1), round(rad, 2), round(rng.uniform(0.75, 1.25), 2), int(rng.integers(0, 4))))


# The user asked for clear plazas: no tree stands on a plaza or paved patch, and no crown reaches over one.
# Filtering after the loop keeps the random sequence, so every other tree stays where it was.
def edge_dist(x, z, poly):
    best = 1e9
    for (ax, az), (bx, bz) in zip(poly, poly[1:] + poly[:1]):
        ex, ez = bx - ax, bz - az
        t = min(1, max(0, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez)))
        best = min(best, math.hypot(x - ax - ex * t, z - az - ez * t))
    return best


clear = [p['p'] for p in plazas_m] + paved_m
trees = [t for t in trees
         if not any(Path(poly).contains_point((t[0], t[1])) or edge_dist(t[0], t[1], poly) < t[2] for poly in clear)]
print('trees', len(trees))

cars = []
for px_, py_, col in CARS:
    x, z = p2m(px_, py_)
    cars.append(dict(x=round(x, 2), z=round(z, 2), y=round(bilinear(x, z), 2), c=col))

# ---------- photo layer ----------
img = Image.open(os.path.join(S, 'photo', 'PHOTO2_z20.png')).crop(AREA)
buf = io.BytesIO(); img.save(buf, 'JPEG', quality=70, optimize=True)
photo_b64 = base64.b64encode(buf.getvalue()).decode()

hmin, hmax = float(H.min()), float(H.max())
dm = np.clip(np.round((H - hmin) * 100), 0, 65535).astype('<u2')    # centimetres above hmin
data = dict(
    grid=dict(cols=COLS, rows=ROWS, step=STEP, width=WID, depth=DEP, hmin=hmin, hmax=hmax,
              b64=base64.b64encode(dm.tobytes()).decode()),
    geo=dict(lon0=LON0, lat0=LAT0, mLon=M_LON, mLat=M_LAT),
    buildings=bld_out, pavilion=pav, plazas=[dict(id=p['id'], y=round(p['y'], 2), p=[v for x, z in p['p'] for v in (round(x, 2), round(z, 2))]) for p in plazas_m],
    roads=roads_m, grass=grass_m, trees=trees, cars=cars,
    paved=[[v for x, z in pm for v in (round(x, 2), round(z, 2))] for pm in paved_m],
    edges=dict(west=p2m(*EDGE_WEST), ne=p2m(*EDGE_NE)),
    photo='data:image/jpeg;base64,' + photo_b64,
)
js = 'window.MAPDATA=' + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';'
open(OUT, 'w', encoding='utf-8').write(js)
print('grid', COLS, ROWS, 'area m', round(WID), round(DEP), 'h', round(hmin, 1), round(hmax, 1))
print('photo KB', len(photo_b64) // 1024, 'data KB', len(js.encode()) // 1024)
for b in bld_out:
    print(b['id'], 'L', round(b['L'], 1), 'W', round(b['W'], 1), 'y', round(b['y'], 1))
for p in plazas_m:
    print(p['id'], round(p['y'], 1))
