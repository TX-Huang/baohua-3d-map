"""Download NLSC orthophoto tiles for a bbox and stitch them into one image (Web Mercator)."""
import math, os, sys, json, urllib.request, io
from concurrent.futures import ThreadPoolExecutor
from PIL import Image

out_dir, z = sys.argv[1], int(sys.argv[2])
W, S, E, N = map(float, sys.argv[3:7])
layer = sys.argv[7] if len(sys.argv) > 7 else 'PHOTO2'


def txy(lon, lat):
    n = 2 ** z
    return (lon + 180) / 360 * n, (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n


fx0, fy0 = txy(W, N)
fx1, fy1 = txy(E, S)
tx0, ty0, tx1, ty1 = int(fx0), int(fy0), int(fx1), int(fy1)
os.makedirs(os.path.join(out_dir, f'{layer}_{z}'), exist_ok=True)


def get(t):
    tx, ty = t
    p = os.path.join(out_dir, f'{layer}_{z}', f'{tx}_{ty}.jpg')
    if not os.path.exists(p):
        url = f'https://wmts.nlsc.gov.tw/wmts/{layer}/default/GoogleMapsCompatible/{z}/{ty}/{tx}'
        b = urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'map-builder/1.0'}), timeout=60).read()
        open(p, 'wb').write(b)
    return t, p


tiles = [(tx, ty) for ty in range(ty0, ty1 + 1) for tx in range(tx0, tx1 + 1)]
with ThreadPoolExecutor(6) as ex:
    res = list(ex.map(get, tiles))
mos = Image.new('RGB', ((tx1 - tx0 + 1) * 256, (ty1 - ty0 + 1) * 256))
for (tx, ty), p in res:
    mos.paste(Image.open(p).convert('RGB'), ((tx - tx0) * 256, (ty - ty0) * 256))
# crop to bbox
cx0, cy0 = round((fx0 - tx0) * 256), round((fy0 - ty0) * 256)
cx1, cy1 = round((fx1 - tx0) * 256), round((fy1 - ty0) * 256)
crop = mos.crop((cx0, cy0, cx1, cy1))
name = os.path.join(out_dir, f'{layer}_z{z}.png')
crop.save(name)
json.dump({'z': z, 'bbox': [W, S, E, N], 'size': crop.size}, open(name + '.json', 'w'))
print(name, crop.size, len(tiles), 'tiles')
