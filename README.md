# 寶華山慈惠堂 3D 地圖

臺東縣鹿野鄉瑞和村，寶華山慈惠堂園區的 3D 地圖。可以旋轉、縮放，點地點看說明和工作人員，也能切換成空拍照。

**網址：** https://tx-huang.github.io/baohua-3d-map/

## 怎麼看

- 拖曳：旋轉視角
- 滾輪／雙指：縮放
- 右鍵拖曳／雙指拖曳：平移
- 點標籤、下方清單、或直接點建築：飛到那裡，看說明和工作人員
- 網址後面加 `#代號` 會直接打開那個地方，例如登記處：`https://tx-huang.github.io/baohua-3d-map/#reg`

## 編輯模式（擺桌子、畫走道、改工作人員）

打開 **https://tx-huang.github.io/baohua-3d-map/?edit**

- **＋ 桌子／＋ 帳篷／＋ 標記**：放在畫面中間。拖曳它的標籤（或物件本身）就能移動，表單裡可以左右轉 15 度。
- **✎ 畫走道**：在地上點出走道經過的點，按「完成」。之後可以改地上的字（預設「神明專用」）、寬度、顏色；拖曳白色圓點調整位置；「字的方向對調」讓字從另一頭看是正的。
- **點任何標籤或建築**：改名稱、圓圈裡的字、說明、工作人員（一行一個名字）。
- **↶ 復原**：退回上一步（也可以按 Ctrl+Z）。
- 改到一半關掉也沒關係：修改會先存在這台裝置，下次打開 `?edit` 還在。
- **發布**：把修改放上網站，大約 1 分鐘後大家重新整理就看得到。

### 發布用的 GitHub 鑰匙（只要做一次）

第一次按「發布」會要一把鑰匙（fine-grained personal access token）：

1. 打開 https://github.com/settings/personal-access-tokens/new
2. Token name 填「寶華山地圖」，Expiration 選 90 days
3. Repository access 選「Only select repositories」，再選 `baohua-3d-map`
4. Permissions → Repository permissions → **Contents** 改成「Read and write」
5. 按 Generate token，把 `github_pat_` 開頭的那串字貼進網站

鑰匙只存在那台裝置的瀏覽器裡，不會放到網站上。鑰匙只能改這個 repository 的檔案。要換鑰匙，按編輯工具列下面的「換鑰匙」。

沒有鑰匙的人打開 `?edit` 也可以試著擺，但改的東西只會留在自己的裝置，不會影響網站。

## 資料放哪裡

- `layout.json`：地點名稱、說明、工作人員、桌子、走道。編輯模式按「發布」改的就是這個檔案；也可以直接在 GitHub 上改它。
- `src/`：網頁的程式。`src/js/` 裡的檔案依檔名順序接在一起。
- `tools/build_detail.py`：建築位置（依空拍照描出來的）。要拿掉的建築放在 `REMOVED`。

## 重新產生 index.html

需要 Python 3（`numpy`、`scipy`、`Pillow`、`matplotlib`）和 Node.js。

```bash
python tools/fetch_dem.py data
python tools/fetch_photo.py data/photo 20 121.1862 22.9734 121.1904 22.9764 PHOTO2
python tools/build_detail.py data data/detail_data.js
npm run build
```

前三行會下載地形和空拍照、算出地圖資料，存到 `data/`，只需要跑一次。之後改程式只要 `npm run build`。

只改 `layout.json` 不用重新產生 `index.html`：網頁每次打開都會讀最新的 `layout.json`。

## 測試

```bash
npm install
npx playwright install chromium
npm run build
npm test
```

## 資料來源

- 空拍照：內政部國土測繪中心 正射影像（2023），依政府資料開放授權條款使用
- 地形：AWS Terrain Tiles（約 30 公尺精度）
- 主殿外觀：參考網路上的實景照片繪製
- 3D 繪圖：three.js r147（MIT 授權，從 jsDelivr 載入）

建築的大小是照空拍照量的，高度和外觀是估計的，只供活動指引參考。
