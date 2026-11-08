"""Assemble the single-file page: src/template.html + CSS + the scripts in src/js + map data + layout.json.

usage: python tools/assemble_detail.py SRC_DIR MAPDATA_JS LAYOUT_JSON OUT_HTML
The output is written for the Artifact viewer (no <html>/<head>/<body>); assemble_standalone.py wraps it.
"""
import glob, json, os, sys

src, data, layout, out = sys.argv[1:5]
read = lambda p: open(p, encoding='utf-8').read()
html = read(os.path.join(src, 'template.html'))
app = '\n'.join(read(f) for f in sorted(glob.glob(os.path.join(src, 'js', '[0-9]*.js'))))
# layout.json holds text people typed: keep it from closing the <script> it is embedded in
lay = json.dumps(json.loads(read(layout)), ensure_ascii=False, separators=(',', ':')).replace('<', '\\u003c')
parts = {
    '<!--__CSS__-->': read(os.path.join(src, 'style.part.html')),
    '/*__LAYOUT_CORE__*/': read(os.path.join(src, 'js', 'layout-core.js')),
    '/*__LAYOUT__*/null': lay,
    '/*__MAPDATA__*/': read(data),
    '/*__APP__*/': app,
}
for k, v in parts.items():
    assert html.count(k) == 1, f'placeholder {k} must appear once'
    if k != '<!--__CSS__-->':
        assert '</script' not in v.lower(), f'{k} would close its <script> early'
for k, v in parts.items():
    html = html.replace(k, v)
os.makedirs(os.path.dirname(out) or '.', exist_ok=True)
open(out, 'w', encoding='utf-8', newline='\n').write(html)
print('wrote', out, len(html.encode('utf-8')) // 1024, 'KB')
