"""Fetch Terrarium elevation tiles (AWS open data) for the map area and save a mosaic + metadata."""
import math, os, sys, io, json, urllib.request
import numpy as np
from PIL import Image

OUT = sys.argv[1]
Z = 15
W_LON, E_LON = 121.158, 121.207
S_LAT, N_LAT = 22.960, 22.995


def tile_xy(lon, lat, z):
    n = 2 ** z
    x = (lon + 180) / 360 * n
    y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
    return x, y


fx0, fy0 = tile_xy(W_LON, N_LAT, Z)
fx1, fy1 = tile_xy(E_LON, S_LAT, Z)
tx0, ty0, tx1, ty1 = int(fx0), int(fy0), int(fx1), int(fy1)
os.makedirs(os.path.join(OUT, 'tiles'), exist_ok=True)
mosaic = np.zeros(((ty1 - ty0 + 1) * 256, (tx1 - tx0 + 1) * 256), dtype=np.float32)
for ty in range(ty0, ty1 + 1):
    for tx in range(tx0, tx1 + 1):
        p = os.path.join(OUT, 'tiles', f'{Z}_{tx}_{ty}.png')
        if not os.path.exists(p):
            url = f'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{Z}/{tx}/{ty}.png'
            req = urllib.request.Request(url, headers={'User-Agent': 'map-builder/1.0'})
            with urllib.request.urlopen(req, timeout=60) as r, open(p, 'wb') as f:
                f.write(r.read())
        a = np.asarray(Image.open(p).convert('RGB')).astype(np.float32)
        h = a[..., 0] * 256 + a[..., 1] + a[..., 2] / 256 - 32768
        mosaic[(ty - ty0) * 256:(ty - ty0 + 1) * 256, (tx - tx0) * 256:(tx - tx0 + 1) * 256] = h
np.save(os.path.join(OUT, 'dem_mosaic.npy'), mosaic)
json.dump({'z': Z, 'tx0': tx0, 'ty0': ty0, 'bbox': [W_LON, S_LAT, E_LON, N_LAT]},
          open(os.path.join(OUT, 'dem_meta.json'), 'w'))
print('tiles', tx1 - tx0 + 1, 'x', ty1 - ty0 + 1, 'min', mosaic.min(), 'max', mosaic.max())
