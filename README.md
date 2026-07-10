# 幻想友人帳 · FF14 公會網站（鳳凰伺服器）

純 HTML / CSS / JavaScript 的靜態網站，不需要編譯，打開就能看，改檔案就能改內容。

## 資料夾結構

```
ff14-guild/
├── index.html      首頁
├── about.html      公會介紹
├── members.html    成員介紹
├── gallery.html    相簿
├── css/
│   └── style.css   全站樣式（最上面有「設定區」可改顏色/字型）
├── js/
│   └── main.js     背景音樂、按鍵音效、手機選單、淡入效果
├── images/         照片（已附佔位圖，換成你自己的）
└── audio/          聲音（放 bgm.mp3 背景音樂、click.mp3 按鍵音效）
```

## 常見修改對照表

| 想改什麼 | 去哪裡改 |
|---|---|
| 公會名稱、標語、介紹文字 | 各 `.html` 裡，找到對應中文直接改 |
| 顏色 | `css/style.css` 最上面 `:root` 的顏色變數 |
| 字型 | 換 `.html` `<head>` 的 Google Fonts 連結 + 改 `style.css` 的 `--font-display` / `--font-body` |
| 成員照片 | 換 `images/member-1.jpg` 等檔案，或改 `members.html` 的 `<img src>` |
| 相簿照片 | 換 `images/gallery-1.jpg` 等檔案，或改 `gallery.html` 的 `<img src>` |
| 背景音樂 | 放 `audio/bgm.mp3` |
| 按鍵音效 | 換 `audio/click.mp3` |

## 本機預覽

用 VS Code 裝「Live Server」外掛，對 `index.html` 按右鍵 →「Open with Live Server」。
或在此資料夾開終端機執行：`python3 -m http.server 8000`，再開瀏覽器到 `http://localhost:8000`。

## 上線

- GitHub Pages：把整個資料夾 push 到 repo → Settings → Pages → 選 main 分支 → 存檔。
- Firebase Hosting：`firebase init hosting`（public 設為此資料夾）→ `firebase deploy`。

## 授權提醒

截圖用自己拍的沒問題；背景音樂請用免版稅來源，不要用官方配樂。
本站與 SQUARE ENIX 無關。
