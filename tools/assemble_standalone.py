"""Wrap the assembled page (written for the Artifact viewer, which adds its own <html>/<head>/<body>)
into a complete standalone HTML document for static hosting such as GitHub Pages."""
import sys

src, out = sys.argv[1:3]
html = open(src, encoding='utf-8').read()
marker = '<div id="app">'
assert marker in html, 'page body marker not found'
head, body = html.split(marker, 1)
extra = (
    '<meta name="description" content="臺東鹿野寶華山慈惠堂園區的 3D 地圖：主殿、大木屋、廚房、宿舍、停車場位置一次看清楚。">\n'
    '<meta property="og:title" content="寶華山慈惠堂 3D 地圖">\n'
    '<meta property="og:description" content="臺東鹿野寶華山慈惠堂園區的 3D 地圖，可旋轉、縮放，點地點看說明。">\n'
)
doc = ('<!doctype html>\n<html lang="zh-Hant">\n<head>\n' + head.strip() + '\n' + extra + '</head>\n<body>\n'
       + marker + body.rstrip() + '\n</body>\n</html>\n')
open(out, 'w', encoding='utf-8', newline='\n').write(doc)
print('wrote', out, len(doc.encode('utf-8')) // 1024, 'KB')
