# 寶華山慈惠堂 3D 地圖

臺東縣鹿野鄉瑞和村，寶華山慈惠堂園區的 3D 地圖。可以旋轉、縮放，點地點看說明，也能切換成空拍照。

**網址：** https://tx-huang.github.io/baohua-3d-map/

## 怎麼用

- 拖曳：旋轉視角
- 滾輪／雙指：縮放
- 右鍵拖曳／雙指拖曳：平移
- 點標籤或下方清單：飛到那個地方，看說明
- 網址後面加 `#reg` 會直接打開登記處，例如 `https://tx-huang.github.io/baohua-3d-map/#reg`

## 改名稱、說明

打開 `src/template.html`，最上面有三個清單：

- `NAMES`：地點名稱
- `GLYPHS`：標籤圓圈裡的那一個字
- `NOTES`：說明文字

改完要重新產生 `index.html`（見下面）。

## 重新產生 index.html

需要 Python 3，以及 `numpy`、`scipy`、`Pillow`、`matplotlib`。

```bash
python tools/fetch_dem.py data
python tools/fetch_photo.py data/photo 20 121.1862 22.9734 121.1904 22.9764 PHOTO2
python tools/build_detail.py data data/detail_data.js
python tools/assemble_detail.py src/template.html src/style.part.html data/detail_data.js build/artifact.html
python tools/assemble_standalone.py build/artifact.html index.html
```

前兩行會下載地形和空拍照，存到 `data/`，只需要跑一次。

- 建築位置是依空拍照用眼睛描出來的，寫在 `tools/build_detail.py` 的 `BUILDINGS`。
- 要拿掉的建築放在 `REMOVED`。

## 資料來源

- 空拍照：內政部國土測繪中心 正射影像（2023），依政府資料開放授權條款使用
- 地形：AWS Terrain Tiles（約 30 公尺精度）
- 3D 繪圖：three.js r147（MIT 授權，從 jsDelivr 載入）

建築的大小是照空拍照量的，高度是估計的，只供活動指引參考。
