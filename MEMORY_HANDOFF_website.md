# MEMORY_HANDOFF — 幻想友人帳 公會網站（2026-07-14 v7 · 鐵則④自動化＝Firestore 直讀線上內容）

> **專案已上線**：GitHub Pages ＝ https://clarebox123jp-art.github.io/FF14_youjinchou/
> Repo：`clarebox123jp-art/FF14_youjinchou`（main /(root)）。純 HTML/CSS/JS＋Firebase。
> 老師慣用繁體中文（台灣）、無網頁開發經驗、需逐步教學；GitHub 網頁介面上傳；上傳後 Ctrl+F5。
> **★ 接手**：`git clone --depth 1 https://github.com/clarebox123jp-art/FF14_youjinchou.git`，鐵則① str_replace 續改。
> 根目錄＝五 HTML＋style.css＋main.js＋firebase-app.js（css/、js/ 子夾是停用舊檔）；fonts/（poem-kai.woff2）、images/（menu/、rooms/）、audio/（風鈴聲.mp3）、動畫/。

## ◎ 鐵則④自動化：Firestore 直讀（2026-07-14 實測可用）

siteContent 對外開放讀取，Claude 動任何頁面文字前，**自行以 web_fetch 抓下列網址**取得老師的線上修正內容（等同 📋 匯出、內容更完整），不再需要老師手動貼匯出。抓取失敗時才退回請老師跑 📋。

**文字專用（日常用這條；field mask 排除相簿 base64 圖檔，回應輕量）：**
```
https://firestore.googleapis.com/v1/projects/ff14-youjinchou/databases/(default)/documents/siteContent?pageSize=300&mask.fieldPaths=page&mask.fieldPaths=kind&mask.fieldPaths=key&mask.fieldPaths=container&mask.fieldPaths=cap&mask.fieldPaths=order&mask.fieldPaths=text&mask.fieldPaths=size&mask.fieldPaths=color&mask.fieldPaths=font&mask.fieldPaths=hidden&mask.fieldPaths=lyrics&mask.fieldPaths=imgsize
```

**完整版（含相簿新增/替換圖的 src base64；量極大，僅救援用）：**
```
https://firestore.googleapis.com/v1/projects/ff14-youjinchou/databases/(default)/documents/siteContent?pageSize=300
```

資料結構：`page-{頁}` 文件的 text/size/color/font map＝各編輯鍵的線上值；kind:add/replace 文件＝相簿線上新增/替換圖（src 為 dataURL）。烘入流程不變：把線上值寫進 HTML 當新預設（舊文留註解）→ 老師上傳 → 按 🧹 清理。

## 一、店況

店名 **茶談百緣**（hero h1；eyebrow 幻想友人帳·RP Shop；明細抬頭【茶談百緣｜幻想友人帳 RP 商店・測試預約單】）。輕〜中度 RP、每 20 分鐘一時段、四場次制（早10-12/午14-17/晚20-24/午夜24-02，開店時辰可點字改）。頁首 .cover-carousel 三圖 18 秒輪播（rp-sign/rp-cover/shop-cocktail-illust）。右上角茶杯 GIF 下《喫茶閒趣》小詩（橫書右對齊逐句浮現 16s 循環；字型 fonts/poem-kai.woff2＝教育部標準楷書 27 字 subset 14KB）。

**頁面順序**：服務內容（四卡柔焦背景照 .job-photo，文字色 #745399/#3a6350/#2f4b6e 已烘入）→ 開店時辰 → 帳目計費（**價目表 7 列 data-fee-bind 活綁定 💰 設定**）→ 線上預約入口（標題＋測試警語＋✦開始預約✦）→ 入席登記 → 餐單（壹）→ 店員名簿（貳）→ 服務設定 → orderSection：參包廂／帳前約定（合併版 id=rulesSection）／肆明細送出／**伍・我的預約紀錄** → 活動告示板（兩卡內文＝「尚在規劃中，敬請期待！」佔位）→ 貴賓優待 → 貴客榜（可自動同步）→ 店舖職務（含 #staffRules 店員服務守則）→ 尋帳而來。

## 二、Firebase／資料模型

管理員唯一帳號 clarebox123@gmail.com；Firestore asia-east1；線上圖＝WebP dataURL。
- `shopPartners`（kind 區分）：staff（★欄位：fee/badge/available/rpRoles/rpGender/rpStyles/rpPhoto/**shifts**［週循環班表 "一二三四|晚場"］）｜menu（cat/sub/tag/badge/price；36 道現實比例價 1,800〜26,400 已烘入 DEFAULT_MENU）｜room（10 間；cap/price/badge/available；中央舞台區 order 0＝開放區域免費 cap6）
- `siteContent`：page-{頁}／config-shop／config-admin／config-fonts／config-menulabels／config-orderfees{seat50000,named100000,persona50000,role100000,photo10000,min5000}／**config-orderform{formUrl,entryId,csvUrl,sheetUrl,staffCsvUrl,vipCsvUrl,open,vol}**／bg-{頁}

**老師的實際外部連結（已接線、勿弄丟）**：
- 表單送出 https://docs.google.com/forms/d/e/1FAIpQLScYGPV20mk0MWyjsTQWzyNLXiWvI_CR6y-NTU3u6BSbDXLJ0Q/formResponse ＋ entry.1052623286
- 訂單回應 CSV https://docs.google.com/spreadsheets/d/e/2PACX-1vR7Q5RKmzagiizkqHK_W8DcDw67kjGBWgDAbKImfsznfHVyriooCrRcu-Rv9xdI8S80RwROWPSQPRxM/pub?output=csv
- 訂單回應試算表 ID＝1MLDvseouEc61FL6bfRzODTr-TVjItqZU6C-wStMCHzE（分頁「表單回應 1」）
- 營運管理試算表 ID＝1FCsOUqbWcpeyd-Ea65fDxX4DizHQp28D（六分頁：職務手冊/排班登記表/預約總表/收支帳本/營運總覽/訂單核對）
- 料理材料表 https://docs.google.com/spreadsheets/d/1YVMvU6qcXleH7rgMKyfq2ffrB60f28Ca/edit?gid=557173134

## 三、預約系統 v3（第 18 段）現況

流程順流無回捲：入席登記（伺服器/ID 必填、同行≤3 逐位填齊、**日期 min=今天+3**、**場次 radio 四選一**、詳細入席時間）→ 壹餐單卡 −/＋（低消 5,000）→ 貳店員卡勾「☑指名」0〜3 位（0＝隨緣）＋**卡上展開面板**（性別呈現顯示、身分＋10萬/單、風格＋5萬/單——選項只列排班表登記項，「皆可」展全清單；狀態集中 `prefState` Map）→ 服務設定（時長/模式/同行自動帶入/顧客甲乙丙丁逐位身分）→ 參包廂（可不選＝中央舞台區免費；容納上限檢查）→ 帳前約定（合併版，同意勾選連 #rulesSection）→ 肆：**#odServiceList 逐項結算**（指名逐位×時段／隨緣／加拍／**兩列可取消勾選的 RP 加價**——取消即扣款並同步名簿面板，雙向）＋四行 totals ＋送出 → **伍・我的預約紀錄**（localStorage yjc_orders ≤20 筆；帳單卡 modal＝和紙底＋緣印，截圖分享；附刪除）。

計價：隨緣 seat×時段；指名 Σ(個別fee||named)×時段；RP 加價僅指名時每單一次；加拍 photo×張；包廂費各標（免費顯原文）。**排班即時提示**：選日期＋場次後，指名店員依 shifts 沒班 → odPickedNote ⚠＋寫入明細（不擋單）。

送單：管理員試用中（🛎「開放所有訪客送單」未勾）；蜜罐 #odWeb＋2 分冷卻＋同內容 10 分防重。接單通知：管理員在頁 45 秒輪詢訂單 CSV → 風鈴＋toast（開訂單列表／📋顧客罐頭通知／**📣DC出勤工作單**——日期場次入席顧客指名包廂餐點崗位預估營收）。

## 四、管理員功能一覽（管理列）

＋新增/⤓匯入 店員·餐點·包廂（匯入開頭自動 removeDuplicatesByName 清重複）｜💰價目設定（六數字 → config-orderfees，**活綁定價目表**）｜🛎送單/通知設定（6 連結欄＋音量＋開放開關）｜**⟳更新店員排班表**（讀 staffCsvUrl：表頭關鍵字對欄、同名取最後列、canonDays 解析 每日/平日/假日/X至Y/頓號 → 寫回 available/fee/rpRoles/rpGender/rpStyles/rpPhoto/shifts；店員卡顯示 🕐可預約(formatShifts 壓縮)/🎭身分/💬風格+📸）｜📊排班表·🏮預約開關（僅商店頁）｜🖼背景｜🖋字型庫（內建＋毛筆楷書 EduKaiStd＝jsDelivr 8.4MB 惰性載入＋華康三款本機字型）｜📋匯出｜🧹清理。管理列可滾輪＋拖曳捲動；編輯工具列停靠右側垂直欄。

**貴客榜自動排行**：config vipCsvUrl（預約總表發布 CSV）→ 狀態=已完成 依顧客角色ID 彙總 → 前五名寫入 .rank-board；有含「金額」表頭的欄依總消費排、無則顯示完成次數（**已建議老師在預約總表補「消費金額」欄**）。

## 五、Google 試算表接線（訂單核對分頁已由 Claude 直接接線）

A1=IMPORTRANGE(訂單回應表)（Excel 開會 #NAME 屬正常、上 Google 即活；上傳用「管理版本→上傳新版本」保 ID）。C~J 解析公式 300 列：消費日期/場次/入席/顧客/指名/料理/包廂/排班核對。**排班登記表已改週循環制**（B星期＝一至四/假日等、D詳細時段新欄）→ 核對公式＝星期＋時段版：排班表 O 欄貼 canonDays 展開公式、訂單核對 J 欄用 MID("日一二三四五六",WEEKDAY(...)) 比對 O＋LEFT(場次,2)＋店員＋可被指名＋G<>"請假"（完整公式在 2026-07-13 對話尾段，老師可能已貼）。K=📣DC工作單自動文、L=💬指名異動回覆（J 亮 ✖ 時自動生成：保留席位代班／取消不列紀錄）、M=材料表 HYPERLINK。

## 六、頭號雷區（勿回退）

1. shopPartners 查詢**禁多欄位 orderBy**（複合索引地雷）→ 無排序抓＋客戶端排序。
2. 匯入按鈕先跑 removeDuplicatesByName（讀取壞掉時代疊過 4 份）。
3. 動態容器（#menuList/#staffList/#roomList）**不掛 reveal**、render 開頭補 .in。
4. **EXCLUDE 含 #roomList**：包廂 cap 等文字點字編輯只改字面不改驗證欄位、同字連坐——一律走 ✎ 表單。
5. 「帳目價目表」＝data-fee-bind 活值，改 💰 即全站同步；別再手改表格數字。
6. 訂單明細行文格式是核對公式的鉤子（消費日期：/場次：/顧客：/指名：/――― 料理 ―――…），改字前先想試算表。
7. 鐵則④改頁面文字先要 📋 匯出；烘入後按 🧹。新資產英數檔名；根目錄檔案放最外層。
8. 華康三款＝本機字型（商業授權不可嵌入）；毛筆楷書全字集走 jsDelivr。

## 七、待辦

0. **2026-07-14 本輪已改（檔案已交付，確認老師都上傳）**：style.css＝餐點卡名稱/價格上下兩行（.menu-card .menu-head display:block 加強版）＋店員卡 🎭/💬 文字加深（--ink 500）＋.room-unpick 樣式；firebase-app.js＝服務設定整併（全域「身分 chips/性別/風格」欄位移除、#odRoleShow 常駐顯示名簿勾選、未選一律「隨緣」、odGlobalPrefs 不再隱藏）＋包廂勾選旁「✕ 取消」鈕；shop.html＝odGlobalPrefs 區塊改寫。
1. 老師流程驗收：上傳→匯入×3→💰確認（加拍 10000）→🛎六欄→⟳排班→測試單→風鈴→工作單→訂單核對 ✔。
2. **貴客榜驗收**：老師已在預約總表加「消費金額」欄（程式端表頭含「金額」即吃到、金額填純數字勿用「萬」、狀態須以「已完成」開頭）——但 2026-07-14 抓取時新欄尚未見於試算表（可能快取），待確認欄位在預約總表分頁且加在最右端（中間插欄會位移其他分頁的欄參照）；測試法＝加一列狀態已完成＋金額 120000 的假資料，等 5 分鐘 Ctrl+F5 看榜。預約總表舊欄位（30分×n）可趁機對齊 20 分制。
3. 包廂容納人數逐間 ✎ 確認（老師曾線上改字面：1→3、2→4、2→3 對應不明）；同行上限是否放寬 >4。
4. 店員真人照片/人設/豐川奏照片；正式營業：移除測試警語、🏮 開放送單、黑名單流程。
5. 導覽「相簿」→「相片集錦」統一；audio/bgm.mp3；清 css/js 舊檔。

## 八、協作鐵則／公會資料／驗證（不變）

①str_replace 精修＋舊文留註解＋CSS 檔尾疊加＋JS 模組段｜②先說明等「輸出」（小修正與明確 bug 可直接交）、「我去睡覺」＝預授權｜③精緻文青版文案｜④動頁面文字前先取線上內容→烘入→🧹——**取法已自動化：Claude 自行 web_fetch 本文件開頭的 Firestore 直讀網址**，失敗才請老師跑 📋 匯出。
鳳凰服；公會房白銀鄉 9 區 30 號；會長小克瑞爾（DC ke7235）；幹部 Izumi澄/九里斯蒂安/拉可帕萩琴/豐川奏/九尾焱狐；Discord https://discord.com/invite/ff14yujincho 。
驗證：node --check main.js；firebase-app.js ES import 檢查（僅 SyntaxError 算錯）；CSS 括號、HTML 註解/section 成對；圖檔引用存在；xlsx 交付前 recalc.py（訂單核對 A1 的 IMPORTRANGE #NAME 屬預期例外）。
