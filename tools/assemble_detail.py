import os, sys
tpl, css, data, out = sys.argv[1:5]
os.makedirs(os.path.dirname(out) or '.', exist_ok=True)
html = open(tpl, encoding='utf-8').read()
assert '<!--__CSS__-->' in html and '/*__MAPDATA__*/' in html
html = html.replace('<!--__CSS__-->', open(css, encoding='utf-8').read())
html = html.replace('/*__MAPDATA__*/', open(data, encoding='utf-8').read())
open(out, 'w', encoding='utf-8', newline='\n').write(html)
print('wrote', out, len(html.encode('utf-8')) // 1024, 'KB')
