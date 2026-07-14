/* ============================================================
   幻想友人帳 · Firebase 模組（firebase-app.js）
   放置位置：repo 根目錄（跟 index.html 同層）
   ------------------------------------------------------------
   功能分段：
   0) Firebase 初始化（config 可公開，安全由 Firestore 規則把關）
   1) 訪客計數（首頁 #visitorCount；同一台瀏覽器只累加一次）
   2) RP 商店工作夥伴：從 Firestore 讀出並渲染成 .member 卡
   3) 管理模式：網址加 #admin 顯示登入鈕 → Google 登入
      （只有 ADMIN_EMAIL 能進入）→ 新增／編輯／刪除夥伴、上傳照片
   ------------------------------------------------------------
   照片存法：不用 Firebase Storage（免綁信用卡），
   照片在瀏覽器端先壓縮成小圖（最長邊 900px、JPEG q0.82），
   以 dataURL 字串直接存進 Firestore 文件（上限 1MB，壓縮後遠低於此）。
   ============================================================ */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, increment,
  collection, getDocs, addDoc, deleteDoc, query, orderBy, serverTimestamp,
  where, deleteField, arrayUnion, arrayRemove
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/* ---------- 0) 初始化 ---------- */
const firebaseConfig = {
  apiKey: "AIzaSyBHMKHLRjeQVcEqnnhgY_qmZOH4SZP3sM4",
  authDomain: "ff14-youjinchou.firebaseapp.com",
  projectId: "ff14-youjinchou",
  storageBucket: "ff14-youjinchou.firebasestorage.app",
  messagingSenderId: "912716178706",
  appId: "1:912716178706:web:180a4c43ce4b8455207fcb"
};
const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

const ADMIN_EMAIL = "clarebox123@gmail.com";   // ★ 唯一的管理員帳號

/* ============================================================
   1) 訪客計數（只在有 #visitorCount 的頁面執行＝首頁）
   - Firestore 文件 stats/visitors { count }
   - localStorage 記「這台瀏覽器算過了」，重整不會重複累加
   ============================================================ */
(async function visitorCounter() {
  const el = document.getElementById("visitorCount");
  if (!el) return;
  const ref = doc(db, "stats", "visitors");
  try {
    const counted = localStorage.getItem("yjc_visited");
    if (!counted) {
      const snap = await getDoc(ref);
      if (snap.exists()) {
        await updateDoc(ref, { count: increment(1) });
      } else {
        await setDoc(ref, { count: 1 });
      }
      localStorage.setItem("yjc_visited", "1");
    }
    const snap = await getDoc(ref);
    el.textContent = snap.exists() ? snap.data().count.toLocaleString("zh-TW") : "1";
  } catch (e) {
    console.warn("訪客計數暫時無法讀取：", e);
    const banner = document.getElementById("visitBanner");
    if (banner) banner.style.display = "none";   // 讀不到就整條隱藏，不留破洞
  }
})();

/* ============================================================
   2) RP 商店工作夥伴（只在有 #partnerList 的頁面執行＝shop.html）
   ============================================================ */
const partnerList  = document.getElementById("partnerList");
const partnerEmpty = document.getElementById("partnerEmpty");
let isAdmin = false;
let partnersCache = [];   // [{id, data}]

const esc = (s) => String(s ?? "").replace(/[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function loadPartners() {
  if (!partnerList) return;
  try {
    /* 舊查詢（需要 Firestore 複合索引，未建索引會整個失敗→永遠顯示內建預設、無法編輯。2026-07-13 修正）：
       const q = query(collection(db, "shopPartners"), orderBy("order"), orderBy("createdAt")); */
    const q = collection(db, "shopPartners");
    const snap = await getDocs(q);
    /* ★ 2026-07-11：同一集合現在也存「店員名簿」（kind:"staff"，見第 13 段），
       這裡把店員濾掉，避免誤入舊的工作夥伴清單。
       舊寫法備查：partnersCache = snap.docs.map((d) => ({ id: d.id, data: d.data() })); */
    partnersCache = snap.docs
      .map((d) => ({ id: d.id, data: d.data() }))
      .filter((x) => x.data.kind !== "staff" && x.data.kind !== "menu" && x.data.kind !== "room");
    partnersCache.sort((a, b) => (a.data.order || 0) - (b.data.order || 0));   /* ★ 2026-07-13 客戶端排序 */
  } catch (e) {
    console.warn("讀取工作夥伴失敗：", e);
    partnersCache = [];
  }
  renderPartners();
}

function renderPartners() {
  if (!partnerList) return;
  partnerList.innerHTML = "";
  if (partnerEmpty) partnerEmpty.style.display = partnersCache.length ? "none" : "";
  for (const { id, data: p } of partnersCache) {
    const card = document.createElement("article");
    card.className = "member";
    const img = p.photo
      ? `<img src="${p.photo}" alt="${esc(p.name)} 的照片" loading="lazy" />`
      : `<div class="noimg" aria-hidden="true"><span>印</span></div>`;
    card.innerHTML = `
      ${img}
      <div class="info">
        <p class="role">${esc(p.role)}</p>
        <h3>${esc(p.name)}</h3>
        <p class="meta"><b>ID：</b>${esc(p.charId)}</p>
        <p class="meta"><b>遊玩時間：</b>${esc(p.playtime)}</p>
        <p style="margin-top:8px">${esc(p.bio)}</p>
      </div>`;
    if (isAdmin) {
      const bar = document.createElement("div");
      bar.className = "admin-actions";
      bar.innerHTML = `<button type="button" data-act="edit">✎ 編輯</button>
                       <button type="button" data-act="del">✕ 刪除</button>`;
      bar.querySelector('[data-act="edit"]').onclick = () => openPartnerForm(id, p);
      bar.querySelector('[data-act="del"]').onclick = async () => {
        if (!confirm(`確定要刪除「${p.name}」這張夥伴卡嗎？（無法復原）`)) return;
        await deleteDoc(doc(db, "shopPartners", id));
        loadPartners();
      };
      card.appendChild(bar);
    }
    partnerList.appendChild(card);
  }
}
loadPartners();

/* ---------- 照片壓縮：檔案 → 小尺寸 JPEG dataURL ---------- */
function compressImage(file, maxSide = 900, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => {
      URL.revokeObjectURL(url);
      let { width: w, height: h } = im;
      if (Math.max(w, h) > maxSide) {
        const k = maxSide / Math.max(w, h);
        w = Math.round(w * k); h = Math.round(h * k);
      }
      const cv = document.createElement("canvas");
      cv.width = w; cv.height = h;
      cv.getContext("2d").drawImage(im, 0, 0, w, h);
      // 優先輸出 WebP（比 JPEG 輕約 25%）；少數不支援的瀏覽器自動退回 JPEG
      const dataUrl = cv.toDataURL(WEBP_OK ? "image/webp" : "image/jpeg", quality);
      if (dataUrl.length > 900_000) reject(new Error("照片壓縮後仍太大，請換一張或先裁小一點。"));
      else resolve(dataUrl);
    };
    im.onerror = () => { URL.revokeObjectURL(url); reject(new Error("讀不到這張圖片檔。")); };
    im.src = url;
  });
}

/* ---------- 新增／編輯夥伴的表單（燈箱式） ---------- */
function openPartnerForm(id = null, p = {}) {
  closePartnerForm();
  const wrap = document.createElement("div");
  wrap.className = "admin-modal";
  wrap.id = "partnerModal";
  wrap.innerHTML = `
    <div class="admin-modal-card">
      <h3>${id ? "編輯夥伴" : "新增夥伴"}</h3>
      <label>職務（例：店長 · 場景設計）<input id="pfRole" value="${esc(p.role)}" /></label>
      <label>角色名稱<input id="pfName" value="${esc(p.name)}" /></label>
      <label>ID（例：角色名@Phoenix）<input id="pfId" value="${esc(p.charId)}" /></label>
      <label>遊玩時間<input id="pfTime" value="${esc(p.playtime)}" /></label>
      <label>一句簡介<textarea id="pfBio" rows="2">${esc(p.bio)}</textarea></label>
      <label>照片（可不選＝維持不變／無照片）<input id="pfPhoto" type="file" accept="image/*" /></label>
      <label>排序（數字小的排前面）<input id="pfOrder" type="number" value="${Number.isFinite(p.order) ? p.order : (partnersCache.length + 1)}" /></label>
      <p class="admin-hint" id="pfMsg"></p>
      <div class="admin-modal-btns">
        <button type="button" id="pfSave" class="admin-btn primary">儲存</button>
        <button type="button" id="pfCancel" class="admin-btn">取消</button>
      </div>
    </div>`;
  document.body.appendChild(wrap);
  wrap.addEventListener("click", (e) => { if (e.target === wrap) closePartnerForm(); });
  document.getElementById("pfCancel").onclick = closePartnerForm;
  document.getElementById("pfSave").onclick = async () => {
    const msg = document.getElementById("pfMsg");
    const btn = document.getElementById("pfSave");
    try {
      btn.disabled = true; msg.textContent = "儲存中…";
      const data = {
        role:     document.getElementById("pfRole").value.trim(),
        name:     document.getElementById("pfName").value.trim(),
        charId:   document.getElementById("pfId").value.trim(),
        playtime: document.getElementById("pfTime").value.trim(),
        bio:      document.getElementById("pfBio").value.trim(),
        order:    Number(document.getElementById("pfOrder").value) || 0,
      };
      if (!data.name) throw new Error("「角色名稱」不能空白。");
      const file = document.getElementById("pfPhoto").files[0];
      if (file) data.photo = await compressImage(file);
      if (id) {
        await updateDoc(doc(db, "shopPartners", id), data);
      } else {
        data.photo = data.photo || "";
        data.createdAt = serverTimestamp();
        await addDoc(collection(db, "shopPartners"), data);
      }
      closePartnerForm();
      loadPartners();
    } catch (e) {
      btn.disabled = false;
      msg.textContent = "❌ " + (e.message || "儲存失敗，請再試一次。");
    }
  };
}
function closePartnerForm() {
  const m = document.getElementById("partnerModal");
  if (m) m.remove();
}

/* ============================================================
   3) 管理模式
   - 進入方式：網址結尾加上 #admin（例：…/shop.html#admin）→ 出現登入鈕
   - 登入後驗證是否為 ADMIN_EMAIL；不是就登出並提示
   ============================================================ */
function buildAdminUI() {
  if (document.getElementById("adminFab")) return;
  const fab = document.createElement("button");
  fab.id = "adminFab";
  fab.className = "admin-btn admin-fab";
  fab.type = "button";
  fab.textContent = "🔑 管理員登入";
  fab.onclick = async () => {
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (e) {
      if (e && e.code !== "auth/popup-closed-by-user") alert("登入失敗：" + (e.message || e));
    }
  };
  document.body.appendChild(fab);
}

function buildAdminBar(email) {
  removeAdminBar();
  const bar = document.createElement("div");
  bar.id = "adminBar";
  bar.className = "admin-bar";
  bar.innerHTML = `
    <span>🔧 管理模式（${esc(email)}）</span>
    ${partnerList ? '<button type="button" id="abAdd" class="admin-btn primary">＋ 新增夥伴</button>' : ""}
    ${document.getElementById("staffList") ? '<button type="button" id="abStaffAdd" class="admin-btn primary">＋ 新增店員</button><button type="button" id="abStaffSeed" class="admin-btn">⤓ 匯入預設店員</button>' : ""}
    ${document.getElementById("menuList") ? '<button type="button" id="abMenuAdd" class="admin-btn primary">＋ 新增餐點</button><button type="button" id="abMenuSeed" class="admin-btn">⤓ 匯入預設餐單</button>' : ""}
    ${document.getElementById("roomList") ? '<button type="button" id="abRoomAdd" class="admin-btn primary">＋ 新增包廂</button><button type="button" id="abRoomSeed" class="admin-btn">⤓ 匯入預設包廂</button>' : ""}
    ${document.getElementById("orderSection") ? '<button type="button" id="abFees" class="admin-btn">💰 價目設定</button><button type="button" id="abOrderCfg" class="admin-btn">🛎 送單/通知設定</button><button type="button" id="abStaffSync" class="admin-btn">⟳ 更新店員排班表</button>' : ""}
    ${document.getElementById("lyricsTrack") ? '<button type="button" id="abLyrics" class="admin-btn">🎼 歌詞設定</button>' : ""}
    ${document.getElementById("bookingBtn") ? '<button type="button" id="abBooking" class="admin-btn">🏮 預約開關</button>' : ""}
    ${document.getElementById("menuList") ? '<button type="button" id="abSheet" class="admin-btn">📊 排班表</button>' : ""}
    <button type="button" id="abBg" class="admin-btn">🖼 背景設定</button>
    <button type="button" id="abFonts" class="admin-btn">🖋 字型庫</button>
    <button type="button" id="abExport" class="admin-btn">📋 匯出內容</button>
    <button type="button" id="abClean" class="admin-btn">🧹 清理失效編輯</button>
    <button type="button" id="abOut" class="admin-btn">登出</button>`;
  document.body.appendChild(bar);
  /* ★ 2026-07-11：直式選單可收合——套用上次記住的收合狀態（點標題列切換，見第 12 段） */
  try { if (localStorage.getItem("yjcAdminFold") === "1") bar.classList.add("folded"); } catch (_) {}
  const add = document.getElementById("abAdd");
  if (add) add.onclick = () => openPartnerForm();
  /* ★ 2026-07-11：店員名簿（實作在第 13 段） */
  const sAdd = document.getElementById("abStaffAdd");
  if (sAdd) sAdd.onclick = () => openStaffForm();
  const sSeed = document.getElementById("abStaffSeed");
  if (sSeed) sSeed.onclick = seedDefaultStaff;
  /* ★ 2026-07-12：餐單（實作在第 16 段） */
  const mAdd = document.getElementById("abMenuAdd");
  if (mAdd) mAdd.onclick = () => openMenuForm();
  const mSeed = document.getElementById("abMenuSeed");
  if (mSeed) mSeed.onclick = seedDefaultMenu;
  /* ★ 2026-07-12：包廂（實作在第 18 段） */
  const rAdd = document.getElementById("abRoomAdd");
  if (rAdd) rAdd.onclick = () => openRoomForm();
  const rSeed = document.getElementById("abRoomSeed");
  if (rSeed) rSeed.onclick = seedDefaultRooms;
  /* ★ 2026-07-12 v2.1：預約價目線上設定（實作在第 18 段，經 window.YJC_ORDER 呼叫） */
  /* ★ 2026-07-13：管理列按鈕變多後可捲動——滾輪原生支援（CSS overflow），
     這裡補「滑鼠按住拖曳」捲動：位移超過 6px 才視為拖曳，並攔下拖曳後的誤點擊 */
  const barEl = document.querySelector(".admin-bar");
  if (barEl && !barEl.dataset.dragScroll) {
    barEl.dataset.dragScroll = "1";
    let dragY = null, dragTop = 0, moved = false;
    barEl.addEventListener("pointerdown", (e) => { dragY = e.clientY; dragTop = barEl.scrollTop; moved = false; });
    barEl.addEventListener("pointermove", (e) => {
      if (dragY === null) return;
      const dy = e.clientY - dragY;
      if (Math.abs(dy) > 6) { moved = true; barEl.scrollTop = dragTop - dy; }
    });
    const endDrag = () => { dragY = null; };
    barEl.addEventListener("pointerup", endDrag);
    barEl.addEventListener("pointerleave", endDrag);
    barEl.addEventListener("click", (e) => { if (moved) { e.stopPropagation(); e.preventDefault(); moved = false; } }, true);
  }
  const feeBtn = document.getElementById("abFees");
  if (feeBtn) feeBtn.onclick = () => window.YJC_ORDER?.openFees?.();
  const ocfgBtn = document.getElementById("abOrderCfg");
  if (ocfgBtn) ocfgBtn.onclick = () => window.YJC_ORDER?.openOrderCfg?.();
  const ssyBtn = document.getElementById("abStaffSync");
  if (ssyBtn) ssyBtn.onclick = () => window.YJC_ORDER?.syncStaffSchedule?.();
  const lyBtn = document.getElementById("abLyrics");
  if (lyBtn) lyBtn.onclick = openLyricsEditor;
  /* ★ 2026-07-11 新增：預約開關／內部排班表／背景設定（實作在第 10 段） */
  const bkBtn = document.getElementById("abBooking");
  if (bkBtn) bkBtn.onclick = openBookingConfig;
  const shBtn = document.getElementById("abSheet");   /* ★ 2026-07-13：排班表僅商店頁有，需防呆 */
  if (shBtn) shBtn.onclick = openSheetLink;
  document.getElementById("abBg").onclick = openBgConfig;
  /* ★ 2026-07-11：字型庫（Google Fonts 名單，實作在第 4 段尾） */
  document.getElementById("abFonts").onclick = openFontLibrary;
  fetchLibFonts();   // 先把名單抓好，開編輯工具列時字型選單直接就緒
  document.getElementById("abExport").onclick = exportOverrides;
  document.getElementById("abClean").onclick = cleanStaleEdits;
  document.getElementById("abOut").onclick = () => signOut(auth);
}
function removeAdminBar() {
  const b = document.getElementById("adminBar");
  if (b) b.remove();
}

if (location.hash === "#admin") buildAdminUI();
window.addEventListener("hashchange", () => {
  if (location.hash === "#admin") buildAdminUI();
});

onAuthStateChanged(auth, (user) => {
  const fab = document.getElementById("adminFab");
  if (user && user.email === ADMIN_EMAIL) {
    isAdmin = true;
    if (fab) fab.style.display = "none";
    buildAdminBar(user.email);
  } else {
    if (user) {                      // 登入了但不是管理員
      alert("此 Google 帳號沒有管理權限。");
      signOut(auth);
    }
    isAdmin = false;
    removeAdminBar();
    if (fab) fab.style.display = "";
  }
  renderPartners();                  // 依身分重畫（顯示／隱藏編輯鈕）
  renderStaff();                     // ★ 2026-07-11：店員名簿同樣依身分重畫（第 13 段）
  renderMenu();                      // ★ 2026-07-12：餐單同樣依身分重畫（第 16 段）
  renderRooms();                     // ★ 2026-07-12：包廂同樣依身分重畫（第 17 段）
});

/* ============================================================
   4) 全站線上編輯（管理模式限定）
   ------------------------------------------------------------
   資料存法（都在 siteContent 集合，規則已涵蓋、不必改規則）：
   - 文件 page-{頁名}：{ text: {段落鍵: HTML}, hidden: [圖片鍵] }
   - 文件（自動 ID）：{ page, kind:"add"|"replace", container/key, src, cap, order }
   每段文字／每張圖的「鍵」＝內容指紋（雜湊），所以顏色調整、排版改版
   不會弄丟編輯；但若 Claude 之後改了某段的「預設文字」，該段的線上編輯
   會自動失效回到新預設（屬正常現象，重新編輯即可）。
   ============================================================ */
const PAGE = ((location.pathname.split("/").pop() || "index.html").replace(".html", "")) || "index";
const pageRef = doc(db, "siteContent", "page-" + PAGE);

function h32(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(36); }

/* 可編輯文字的範圍（排除動態產生與管理介面本身）
   ※ .photo .cap ＝ 相簿照片的和紙標籤圖說（不論在不在 .wrap 內都涵蓋） */
/* ★ 2026-07-13：加入 .hours-day / .hours-time——「開店時辰」的星期與時段是 <span>，
   原本不在可編輯清單內，補上後管理員點字即可修改營業時間
   舊值備查：".wrap h1,.wrap h2,.wrap h3,.wrap p,.wrap figcaption,.hero-inner h1,.hero-inner p,.footer p,.footer h3,.photo .cap" */
const EDIT_SEL = ".wrap h1,.wrap h2,.wrap h3,.wrap p,.wrap figcaption,.hero-inner h1,.hero-inner p,.footer p,.footer h3,.photo .cap,.hours-card .hours-day,.hours-card .hours-time";
/* ★ 2026-07-11：加入 #staffList（店員名簿卡片由 Firestore 動態產生，不走段落編輯）
   舊值備查："#partnerList,.admin-bar,.admin-modal,.lyrics-panel,.visit-banner,.edit-bar" */
/* ★ 2026-07-12：再加入 #menuList——餐點文字（品名/簡介/價格/標籤）由餐單 ✎ 表單與
   點價格機制管理，不走段落編輯，避免動態重繪造成編輯紀錄脫鉤
   舊值備查："#partnerList,#staffList,.admin-bar,.admin-modal,.lyrics-panel,.visit-banner,.edit-bar" */
/* ★ 2026-07-13：再加入 #roomList——包廂容納人數等文字若用點字編輯，只會改字面、
   不會改資料庫 cap 欄位（預約人數驗證用），造成「畫面 6 位、系統擋 4 位」的矛盾；
   且多間包廂同字會被一起改。包廂內容一律走 ✎ 表單。
   舊值備查："#partnerList,#staffList,#menuList,.admin-bar,.admin-modal,.lyrics-panel,.visit-banner,.edit-bar" */
const EXCLUDE = "#partnerList,#staffList,#menuList,#roomList,.admin-bar,.admin-modal,.lyrics-panel,.visit-banner,.edit-bar";

const textDefaults = {};                 // 每段的預設內容（供「回復預設」）
function collectEditables() {
  const seen = {}; const out = [];
  document.querySelectorAll(EDIT_SEL).forEach((el) => {
    if (el.closest(EXCLUDE)) return;
    if (el.dataset.docId) return;   // 線上新增照片的圖說走「照片文件」路線，不給文字鍵（避免訪客看不到編輯）
    if (!el.dataset.editKey) {
      // ★ 鍵值以「壓掉空白後的內容」計算：搬區塊、改縮排都不會讓線上編輯脫鉤
      const norm = el.textContent.replace(/\s+/g, " ").trim().slice(0, 80);
      const base = "t" + h32(norm + "|" + el.tagName);
      const n = (seen[base] = (seen[base] || 0) + 1);
      el.dataset.editKey = n > 1 ? base + "-" + n : base;
      textDefaults[el.dataset.editKey] = el.innerHTML;
    }
    out.push(el);
  });
  return out;
}
function collectImgs() {
  /* ★ 2026-07-11：加入 #staffList——店員照片由「✎編輯」表單管理，不吃隱藏/換圖/⊞尺寸徽章。
     舊值備查："#partnerList,.admin-modal" */
  /* ★ 2026-07-12：再加入 #menuList——餐點照片同理由餐單「✎編輯」表單管理，
     避免徽章的換圖/隱藏紀錄與 Firestore 餐單資料互相打架。
     舊值備查："#partnerList,#staffList,.admin-modal" */
  return Array.from(document.querySelectorAll(".wrap img, .hero-inner img"))
    .filter((im) => !im.closest("#partnerList,#staffList,#menuList,.admin-modal"));
}
const imgKeyOf = (im) => im.dataset.imgKey || (im.dataset.imgKey = "i" + h32(im.getAttribute("src") || ""));

let pageData = { text: {}, hidden: [] };
let imgDocs = [];                        // 線上新增／更換的圖片文件
const hiddenHosts = {};                  // 圖片鍵 → 被隱藏的節點（供管理模式復原）

let overridesReady;                      // Promise：內容套用完成
async function applyOverrides() {
  try {
    const els = collectEditables();
    const snap = await getDoc(pageRef);
    pageData = Object.assign({ text: {}, hidden: [] }, snap.exists() ? snap.data() : {});
    els.forEach((el) => {
      const v = pageData.text && pageData.text[el.dataset.editKey];
      if (typeof v === "string") el.innerHTML = v;
    });

    const qs = await getDocs(query(collection(db, "siteContent"), where("page", "==", PAGE)));
    imgDocs = qs.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.order || 0) - (b.order || 0));

    // 更換過的圖
    collectImgs().forEach((im) => {
      const rep = imgDocs.find((d) => d.kind === "replace" && d.key === imgKeyOf(im));
      if (rep) im.src = rep.src;
    });
    // 線上新增的圖 → 塞進對應容器
    imgDocs.filter((d) => d.kind === "add").forEach((d) => {
      const box = document.querySelector('[data-imglist="' + d.container + '"]');
      if (!box || box.querySelector('[data-doc-id="' + d.id + '"]')) return;
      if (box.classList.contains("car-track")) {
        const fig = document.createElement("figure");
        fig.className = "photo"; fig.dataset.docId = d.id;
        fig.innerHTML = '<div class="photo-frame"><img loading="lazy" /></div><figcaption class="cap"></figcaption>';
        const im = fig.querySelector("img");
        im.src = d.src; im.alt = d.cap || "";
        const capEl = fig.querySelector(".cap");
        capEl.textContent = d.cap || "";
        capEl.dataset.docId = d.id;          // 圖說可直接點擊編輯（存回這張照片的文件）
        if (d.capColor) capEl.style.color = d.capColor;   // ★ 2026-07-11：圖說顏色
        if (d.capFont) { ensureFontLoaded(d.capFont); capEl.style.fontFamily = fontStack(d.capFont); }   // ★ 圖說字型
        box.appendChild(fig);
      } else {
        const im = document.createElement("img");
        im.src = d.src; im.alt = d.cap || ""; im.dataset.cap = d.cap || ""; im.dataset.docId = d.id;
        box.appendChild(im);
      }
    });
    // 隱藏的圖
    (pageData.hidden || []).forEach((k) => hideImgByKey(k));

    // ★ 字級調整（size map：段落鍵 → 倍率）
    Object.entries(pageData.size || {}).forEach(([k, v]) => {
      const el = document.querySelector('[data-edit-key="' + k + '"]');
      if (!el || !(v > 0)) return;
      if (!el.dataset.basePx) el.dataset.basePx = parseFloat(getComputedStyle(el).fontSize);
      el.style.fontSize = (el.dataset.basePx * v) + "px";
    });
    // ★ 文字顏色（color map：段落鍵 → 色碼；2026-07-11 加入，管理員色票／色碼設定）
    Object.entries(pageData.color || {}).forEach(([k, v]) => {
      const el = document.querySelector('[data-edit-key="' + k + '"]');
      if (el && v) el.style.color = v;
    });
    // ★ 字型（font map：段落鍵 → 字型家族名；2026-07-11 加入，含字型庫的 Google Fonts）
    Object.entries(pageData.font || {}).forEach(([k, v]) => {
      const el = document.querySelector('[data-edit-key="' + k + '"]');
      if (el && v) { ensureFontLoaded(v); el.style.fontFamily = fontStack(v); }
    });
    // ★ 圖片尺寸（imgsize map：圖片鍵 → 寬度倍率，相對原本版位）
    collectImgs().forEach((im) => {
      const v = (pageData.imgsize || {})[imgKeyOf(im)];
      if (!v) return;
      im.style.width = (v * 100) + "%"; im.style.height = "auto";
      im.style.display = "block"; im.style.marginLeft = "auto"; im.style.marginRight = "auto";
    });
    // ★ 歌詞排版（lyrics：{lines:[每行文字], size:字級倍率}）
    const lyTrack = document.getElementById("lyricsTrack");
    if (lyTrack) {
      if (!defaultLyricsHTML) defaultLyricsHTML = lyTrack.innerHTML;   // 先留預設，供「回復預設」
      const ly = pageData.lyrics;
      if (ly) {
        if (Array.isArray(ly.lines) && ly.lines.length) {
          const html = ly.lines.map(renderLyricLine).join("");
          lyTrack.innerHTML = html + html;                             // 自帶複製一份＝無縫循環
        }
        if (ly.size > 0) lyTrack.style.setProperty("--lyr-k", ly.size);
      }
    }

    document.dispatchEvent(new Event("yjc-overrides"));
  } catch (e) {
    console.warn("線上內容載入失敗（顯示網頁預設）：", e);
  }
}
function hideImgByKey(k) {
  const im = document.querySelector('[data-img-key="' + k + '"]') ||
             collectImgs().find((x) => imgKeyOf(x) === k);
  if (!im) return;
  im.setAttribute("data-yjc-hidden", "1");
  const host = im.closest(".photo, .about-figure") || im;
  host.style.display = "none";
  hiddenHosts[k] = { im, host };
}
overridesReady = applyOverrides();

/* ---------- 管理模式：文字編輯 ---------- */
/* ★ 2026-07-11：文字顏色色票（和風九色，供編輯工具列點選） */
const YJC_SWATCHES = [
  { n: "墨",     v: "#2c2620" },
  { n: "淡墨褐", v: "#6f6353" },
  { n: "朱",     v: "#c0433a" },
  { n: "古金",   v: "#b08d3f" },
  { n: "藍",     v: "#2f4b6e" },
  { n: "櫻",     v: "#d98a99" },
  { n: "常磐綠", v: "#3a6350" },
  { n: "江戸紫", v: "#745399" },
  { n: "紙白",   v: "#faf4e8" },
];
/* ★ 2026-07-11：字型系統
   - 內建四種＝五頁本來就載入的字型，選了即生效
   - 字型庫（管理列「🖋 字型庫」）＝老師自己加的 Google Fonts 名單，
     存 siteContent/config-fonts {list:[…]}；用到時才動態掛 <link> 載入 */
const YJC_FONTS_BUILTIN = [
  { n: "文楷（標題預設）", f: "LXGW WenKai TC" },
  { n: "粉圓（內文預設）", f: "jf-openhuninn" },
  { n: "思源黑體",         f: "Noto Sans TC" },
  { n: "思源宋體",         f: "Noto Serif TC" },
  /* ★ 2026-07-13 新增：毛筆楷書＝教育部標準楷書全字集網頁版（@font-face 在 style.css，
     字檔約 8.4MB、選用該字型的段落出現時才會下載）。
     華康三款為商業字型，依法不能內嵌散布——以「本機字型」方式登錄：
     觀看者電腦有安裝就會顯示，沒安裝會退回預設字型 */
  { n: "毛筆楷書（教育部標準楷書）", f: "EduKaiStd" },
  { n: "華康康亭流（需觀看者本機安裝）", f: "華康康亭流" },
  { n: "華康POP1體（需觀看者本機安裝）", f: "華康POP1體W9" },
  { n: "華康古印體（需觀看者本機安裝）", f: "華康古印體" },
];
let libFonts = [];                 // 字型庫名單（Google Fonts 家族名）
let libFontsLoaded = false;
const loadedFontLinks = new Set();
function fontStack(f) { return "'" + f + "', 'Noto Sans TC', sans-serif"; }
function ensureFontLoaded(f) {
  if (!f || YJC_FONTS_BUILTIN.some((x) => x.f === f)) return;   // 內建的頁面已載
  if (loadedFontLinks.has(f)) return;
  loadedFontLinks.add(f);
  const l = document.createElement("link");
  l.rel = "stylesheet";
  l.href = "https://fonts.googleapis.com/css2?family=" +
           encodeURIComponent(f).replace(/%20/g, "+") + ":wght@400;700&display=swap";
  document.head.appendChild(l);
}
async function fetchLibFonts() {
  if (libFontsLoaded) return;
  try {
    const s = await getDoc(doc(db, "siteContent", "config-fonts"));
    libFonts = (s.exists() && Array.isArray(s.data().list)) ? s.data().list : [];
  } catch (_) { libFonts = []; }
  libFontsLoaded = true;
}

let editingEl = null, editBar = null;
let editSelCleanup = null;   // ★ 2026-07-11：結束編輯時解除「選取範圍追蹤」
function startEdit(el) {
  finishEdit(false);
  editingEl = el;
  const docMode = !el.dataset.editKey && !!el.dataset.docId;   // 線上新增照片的圖說：存回該照片文件
  const key = el.dataset.editKey;
  el.dataset.before = el.innerHTML;
  // ★ 字級調整（2026-07 加入）：以載入時的原始字級為基準做倍率
  if (!el.dataset.basePx) el.dataset.basePx = parseFloat(getComputedStyle(el).fontSize);
  let curK = (!docMode && pageData.size && pageData.size[key]) || 1;
  const k0 = curK;
  const applyK = () => { el.style.fontSize = curK === 1 ? "" : (el.dataset.basePx * curK) + "px"; };
  // ★ 文字顏色（2026-07-11 加入）：色票／色碼即時預覽，儲存才寫進 Firebase
  el.dataset.beforeColor = el.style.color || "";
  let curColor = docMode
    ? ((imgDocs.find((d) => d.id === el.dataset.docId) || {}).capColor || "")
    : ((pageData.color && pageData.color[key]) || "");
  const c0 = curColor;
  const applyColor = () => { el.style.color = curColor || ""; };
  // ★ 字型（2026-07-11 加入）：每段可個別換字型，選單含內建四種＋字型庫
  el.dataset.beforeFont = el.style.fontFamily || "";
  let curFont = docMode
    ? ((imgDocs.find((d) => d.id === el.dataset.docId) || {}).capFont || "")
    : ((pageData.font && pageData.font[key]) || "");
  const f0 = curFont;
  const applyFont = () => {
    if (curFont) { ensureFontLoaded(curFont); el.style.fontFamily = fontStack(curFont); }
    else el.style.fontFamily = "";
  };
  // ★ 選取變色（2026-07-11 加入）：追蹤編輯中最後一次的文字選取，
  //   點色票時若有選取＝只改選到的字（<span style="color:…"> 存進文字內容），沒選取＝整段變色
  let lastRange = null;
  const selWatch = () => {
    const sel = window.getSelection();
    if (sel.rangeCount && !sel.isCollapsed && el.contains(sel.anchorNode) && el.contains(sel.focusNode)) {
      lastRange = sel.getRangeAt(0).cloneRange();
    } else if (sel.rangeCount && sel.isCollapsed && el.contains(sel.anchorNode)) {
      lastRange = null;   // 在段落內點一下（取消選取）＝回到「整段變色」模式
    }
  };
  document.addEventListener("selectionchange", selWatch);
  editSelCleanup = () => document.removeEventListener("selectionchange", selWatch);
  const paintSel = (color) => {
    if (!lastRange || lastRange.collapsed) return false;
    const sel = window.getSelection();
    sel.removeAllRanges(); sel.addRange(lastRange);
    document.execCommand("styleWithCSS", false, true);
    document.execCommand("foreColor", false, color || "inherit");   // 空色＝清回繼承色
    if (sel.rangeCount) lastRange = sel.getRangeAt(0).cloneRange();
    return true;
  };
  el.contentEditable = "true";
  el.classList.add("editing");
  el.focus();
  document.body.classList.add("yjc-editing");
  editBar = document.createElement("div");
  editBar.className = "edit-bar";
  editBar.innerHTML =
    '<span>✎ 正在編輯</span>' +
    (docMode ? "" :
      '<button type="button" class="admin-btn" data-a="sminus">A−</button>' +
      '<span class="eb-pct" id="ebPct"></span>' +
      '<button type="button" class="admin-btn" data-a="splus">A＋</button>') +
    '<button type="button" class="admin-btn primary" data-a="save">儲存</button>' +
    '<button type="button" class="admin-btn" data-a="cancel">取消</button>' +
    (docMode ? "" : '<button type="button" class="admin-btn" data-a="reset">回復預設</button>') +
    /* ★ 2026-07-11：文字顏色列（色票＋色碼輸入＋還原色）＋字型選單 */
    '<div class="eb-colors">' +
      '<span title="字型">🖋</span><select id="ebFont" class="eb-font"></select>' +
      '<span title="文字顏色">🎨</span>' +
      YJC_SWATCHES.map((c) =>
        '<button type="button" class="eb-sw" data-c="' + c.v + '" title="' + c.n + " " + c.v + '" style="background:' + c.v + '"></button>'
      ).join("") +
      '<input class="eb-hex" id="ebHex" placeholder="#色碼" maxlength="7" spellcheck="false" />' +
      '<button type="button" class="admin-btn" data-a="cclear">還原色</button>' +
    '</div>';
  document.body.appendChild(editBar);
  const pct = document.getElementById("ebPct");
  const showPct = () => { if (pct) pct.textContent = Math.round(curK * 100) + "%"; };
  showPct();
  // ★ 2026-07-11：色碼輸入框——沒選字時輸入即整段預覽；選了字則打完色碼「按 Enter」套用到選取範圍
  const hexInp = document.getElementById("ebHex");
  const HEXRE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
  if (hexInp) {
    hexInp.value = curColor;
    hexInp.addEventListener("input", () => {
      const v = hexInp.value.trim();
      if (HEXRE.test(v) && (!lastRange || lastRange.collapsed)) { curColor = v; applyColor(); }
    });
    hexInp.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      const v = hexInp.value.trim();
      if (!HEXRE.test(v)) { alert("色碼格式：#f60 或 #ff6600"); return; }
      if (!paintSel(v)) { curColor = v; applyColor(); }
    });
  }
  // ★ 2026-07-11：字型選單（內建四種＋字型庫；字型庫載入後補進選單）
  const fontSel = document.getElementById("ebFont");
  const buildFontOptions = () => {
    if (!fontSel) return;
    const opts = [["", "預設字型"]]
      .concat(YJC_FONTS_BUILTIN.map((x) => [x.f, x.n]))
      .concat(libFonts.map((f) => [f, f + "（字型庫）"]));
    fontSel.innerHTML = opts.map(([v, n]) =>
      '<option value="' + esc(v) + '"' + (v === curFont ? " selected" : "") + ">" + esc(n) + "</option>").join("");
  };
  buildFontOptions();
  fetchLibFonts().then(buildFontOptions);
  if (fontSel) fontSel.addEventListener("change", () => { curFont = fontSel.value; applyFont(); });
  // ★ 點色票前先擋掉預設的搶焦點行為，才不會弄丟正在選取的文字
  editBar.addEventListener("mousedown", (e) => {
    if (e.target.closest('.eb-sw,[data-a="cclear"]')) e.preventDefault();
  });
  editBar.addEventListener("click", async (e) => {
    // ★ 2026-07-11：色票點選＋還原色（有選取＝只改選到的字；沒選取＝整段）
    const sw = e.target.closest(".eb-sw");
    if (sw) {
      if (!paintSel(sw.dataset.c)) { curColor = sw.dataset.c; applyColor(); }
      if (hexInp) hexInp.value = sw.dataset.c;
      return;
    }
    const a = e.target.dataset.a;
    if (a === "cclear") {
      if (!paintSel("")) { curColor = ""; applyColor(); }
      if (hexInp) hexInp.value = "";
      return;
    }
    if (a === "sminus" || a === "splus") {
      curK = Math.min(3, Math.max(0.5, Math.round((curK + (a === "splus" ? 0.1 : -0.1)) * 10) / 10));
      applyK(); showPct();
      return;
    }
    if (a === "cancel") {
      editingEl.innerHTML = editingEl.dataset.before;
      curK = k0; applyK();
      curColor = c0; editingEl.style.color = editingEl.dataset.beforeColor || "";   // ★ 顏色一起還原
      curFont = f0; editingEl.style.fontFamily = editingEl.dataset.beforeFont || "";   // ★ 字型一起還原
      finishEdit(true);
    }
    if (a === "save") {
      try {
        if (docMode) {
          const cap = editingEl.textContent.trim();
          // ★ 2026-07-11：圖說連同顏色、字型一起存回照片文件（capColor／capFont）
          await updateDoc(doc(db, "siteContent", editingEl.dataset.docId),
            { cap, capColor: curColor || deleteField(), capFont: curFont || deleteField() });
          const rec = imgDocs.find((d) => d.id === editingEl.dataset.docId);
          if (rec) {
            rec.cap = cap;
            if (curColor) rec.capColor = curColor; else delete rec.capColor;
            if (curFont)  rec.capFont  = curFont;  else delete rec.capFont;
          }
          editingEl.style.color = curColor || "";
          editingEl.style.fontFamily = curFont ? fontStack(curFont) : "";
          const im = editingEl.closest("figure")?.querySelector("img");
          if (im) { im.alt = cap; if (im.dataset.cap !== undefined) im.dataset.cap = cap; }
        } else {
          const html = editingEl.innerHTML;
          const payload = {
            text:  { [key]: html },
            size:  { [key]: curK === 1 ? deleteField() : curK },
            color: { [key]: curColor ? curColor : deleteField() },   // ★ 2026-07-11 顏色
            font:  { [key]: curFont ? curFont : deleteField() },     // ★ 2026-07-11 字型
          };
          await setDoc(pageRef, payload, { merge: true });
          pageData.text[key] = html;
          if (!pageData.size) pageData.size = {};
          if (curK === 1) delete pageData.size[key]; else pageData.size[key] = curK;
          if (!pageData.color) pageData.color = {};
          if (curColor) pageData.color[key] = curColor; else delete pageData.color[key];
          if (!pageData.font) pageData.font = {};
          if (curFont) pageData.font[key] = curFont; else delete pageData.font[key];
        }
        finishEdit(true);
      } catch (err) { alert("儲存失敗：" + (err.message || err)); }
    }
    if (a === "reset") {
      try {
        await setDoc(pageRef, { text: { [key]: deleteField() }, size: { [key]: deleteField() }, color: { [key]: deleteField() }, font: { [key]: deleteField() } }, { merge: true });
        delete pageData.text[key];
        if (pageData.size) delete pageData.size[key];
        if (pageData.color) delete pageData.color[key];   // ★ 2026-07-11 顏色一併回復
        if (pageData.font)  delete pageData.font[key];    // ★ 2026-07-11 字型一併回復
        editingEl.innerHTML = textDefaults[key] || editingEl.dataset.before;
        editingEl.style.fontSize = "";
        editingEl.style.color = "";
        editingEl.style.fontFamily = "";
        finishEdit(true);
      } catch (err) { alert("回復失敗：" + (err.message || err)); }
    }
  });
}
function finishEdit(clean) {
  if (editSelCleanup) { editSelCleanup(); editSelCleanup = null; }   // ★ 2026-07-11：解除選取追蹤
  if (editBar) { editBar.remove(); editBar = null; }
  if (editingEl) {
    editingEl.contentEditable = "false";
    editingEl.classList.remove("editing");
    if (!clean) editingEl.innerHTML = editingEl.dataset.before || editingEl.innerHTML;
    editingEl = null;
  }
  document.body.classList.remove("yjc-editing");
}
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && editingEl) { editingEl.innerHTML = editingEl.dataset.before; editingEl.style.color = editingEl.dataset.beforeColor || ""; editingEl.style.fontFamily = editingEl.dataset.beforeFont || ""; finishEdit(true); } });   // ★ 2026-07-11：Esc 也把顏色、字型還原

/* ---------- 管理模式：圖片 隱藏／復原／更換 ---------- */
async function toggleHideImg(im) {
  const k = imgKeyOf(im);
  const docId = (im.closest("[data-doc-id]") || im).dataset ? (im.closest("[data-doc-id]")?.dataset.docId || im.dataset.docId) : null;
  if (docId) {                                   // 線上新增的圖 → 直接刪文件
    if (!confirm("刪除這張線上新增的照片？（無法復原）")) return;
    await deleteDoc(doc(db, "siteContent", docId));
    (im.closest(".photo") || im).remove();
    document.dispatchEvent(new Event("yjc-overrides"));
    return;
  }
  if (im.getAttribute("data-yjc-hidden")) {      // 已隱藏 → 復原
    await setDoc(pageRef, { hidden: arrayRemove(k) }, { merge: true });
    im.removeAttribute("data-yjc-hidden");
    const host = hiddenHosts[k] ? hiddenHosts[k].host : (im.closest(".photo, .about-figure") || im);
    host.style.display = ""; host.classList.remove("yjc-ghost");
  } else {                                       // 隱藏（管理模式下改成半透明，不真的消失）
    await setDoc(pageRef, { hidden: arrayUnion(k) }, { merge: true });
    im.setAttribute("data-yjc-hidden", "1");
    const host = im.closest(".photo, .about-figure") || im;
    host.classList.add("yjc-ghost");
    hiddenHosts[k] = { im, host };
  }
  refreshBadges();
  document.dispatchEvent(new Event("yjc-overrides"));
}
function replaceImg(im) {
  const inp = document.createElement("input");
  inp.type = "file"; inp.accept = "image/*";
  inp.onchange = async () => {
    const f = inp.files[0]; if (!f) return;
    try {
      const src = await compressImage(f, 1400, 0.82);
      const k = imgKeyOf(im);
      const old = imgDocs.find((d) => d.kind === "replace" && d.key === k);
      if (old) await updateDoc(doc(db, "siteContent", old.id), { src });
      else await addDoc(collection(db, "siteContent"), { page: PAGE, kind: "replace", key: k, src, order: Date.now() });
      im.src = src;
    } catch (e) { alert("更換失敗：" + (e.message || e)); }
  };
  inp.click();
}
function addImgTo(container) {
  const box = document.querySelector('[data-imglist="' + container + '"]');
  const wrap = document.createElement("div");
  wrap.className = "admin-modal"; wrap.id = "addImgModal";
  wrap.innerHTML =
    '<div class="admin-modal-card"><h3>新增照片</h3>' +
    '<label>照片檔案<input id="aiFile" type="file" accept="image/*" /></label>' +
    '<label>照片說明（相簿的和紙標籤／輪播圖說）<textarea id="aiCap" rows="2"></textarea></label>' +
    '<p class="admin-hint" id="aiMsg"></p>' +
    '<div class="admin-modal-btns">' +
    '<button type="button" class="admin-btn primary" id="aiSave">上傳</button>' +
    '<button type="button" class="admin-btn" id="aiCancel">取消</button></div></div>';
  document.body.appendChild(wrap);
  wrap.addEventListener("click", (e) => { if (e.target === wrap) wrap.remove(); });
  wrap.querySelector("#aiCancel").onclick = () => wrap.remove();
  wrap.querySelector("#aiSave").onclick = async () => {
    const f = wrap.querySelector("#aiFile").files[0];
    const cap = wrap.querySelector("#aiCap").value.trim();
    const msg = wrap.querySelector("#aiMsg");
    if (!f) { msg.textContent = "請先選一張照片。"; return; }
    try {
      msg.textContent = "上傳中…";
      const src = await compressImage(f, box && box.classList.contains("car-track") ? 1400 : 1200, 0.82);
      await addDoc(collection(db, "siteContent"), { page: PAGE, kind: "add", container, src, cap, order: Date.now() });
      wrap.remove();
      imgDocs = []; await applyOverrides();       // 重新套用 → 新照片入列
      if (isAdmin) refreshBadges();
    } catch (e) { msg.textContent = "❌ " + (e.message || e); }
  };
}

/* ---------- 管理模式：把編輯介面掛上頁面 ---------- */
let editingEnabled = false;
async function enableEditing() {
  await overridesReady;
  if (editingEnabled) return;
  editingEnabled = true;
  // 文字：點一下開始編輯（管理模式中，可編輯段落內的連結不會跳轉、改為進入編輯）
  document.addEventListener("click", (e) => {
    if (!isAdmin) return;
    if (e.target.closest(".img-badge,.edit-bar,.admin-bar,.admin-modal")) return;
    const el = e.target.closest("[data-edit-key], figcaption[data-doc-id]");
    if (!el || editingEl === el) return;
    e.preventDefault();
    startEdit(el);
  });
  collectEditables().forEach((el) => el.classList.add("edit-able"));
  refreshBadges();
  // 隱藏中的圖在管理模式顯示成半透明可復原
  Object.values(hiddenHosts).forEach(({ host }) => { host.style.display = ""; host.classList.add("yjc-ghost"); });
  // 每個照片容器加「＋加照片」
  document.querySelectorAll("[data-imglist]").forEach((box) => {
    if (box.dataset.addBtn) return;
    box.dataset.addBtn = "1";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "admin-btn imglist-add";
    btn.textContent = "＋ 加照片";
    btn.onclick = () => addImgTo(box.dataset.imglist);
    (box.closest(".carousel") || box.parentElement).insertAdjacentElement("afterend", btn);
  });
}
function refreshBadges() {
  document.querySelectorAll(".img-badge").forEach((b) => b.remove());
  if (!isAdmin) return;
  document.querySelectorAll("figcaption[data-doc-id]").forEach((c) => c.classList.add("edit-able")); // 線上新增照片的圖說也給編輯提示
  collectImgs().forEach((im) => {
    if (im.closest(".about-slides") && !im.classList.contains("is-on") && !im.getAttribute("data-yjc-hidden")) return; // 疊圖只標當前那張
    const host = im.closest(".photo, .about-figure, .member, figure") || im.parentElement;
    if (!host || host.querySelector(":scope > .img-badge")) return;
    host.classList.add("img-admin-host");
    const b = document.createElement("div");
    b.className = "img-badge";
    const hidden = !!im.getAttribute("data-yjc-hidden");
    const sizable = !im.closest(".car-track,.about-slides");   // 跑馬燈與輪播內尺寸統一，不個別調
    b.innerHTML =
      '<button type="button" data-a="hide">' + (hidden ? "↩ 復原" : "✕ 隱藏") + "</button>" +
      (hidden ? "" : '<button type="button" data-a="rep">↻ 換圖</button>') +
      (hidden || !sizable ? "" : '<button type="button" data-a="size">⊞ 尺寸</button>');
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      const target = im.closest(".about-slides") ? im.closest(".about-slides").querySelector("img.is-on") || im : im;
      if (e.target.dataset.a === "hide") toggleHideImg(target);
      if (e.target.dataset.a === "rep") replaceImg(target);
      if (e.target.dataset.a === "size") openImgSize(im);
    });
    host.appendChild(b);
  });
}
setInterval(() => { if (isAdmin) refreshBadges(); }, 3200);  // 輪播換張時，徽章跟著當前那張

/* 登入狀態掛上編輯 */
onAuthStateChanged(auth, (user) => {
  if (user && user.email === ADMIN_EMAIL) enableEditing();
  else { finishEdit(true); refreshBadges(); }
});

/* ============================================================
   5) 匯出線上編輯（管理列「📋 匯出內容」）
   把「這一頁」所有線上編輯整理成一份文字，複製貼給 Claude，
   Claude 之後改網頁時就會以這份為準，不會把老師的編輯改倒退。
   ============================================================ */
async function exportOverrides() {
  // ★ 匯出前先自動優化：把這一頁線上儲存的照片轉成輕量 WebP（非 webp 或過大者），
  //   替換 Firebase 裡的檔案並同步畫面；結果列在下方報告裡。
  const btn = document.getElementById("abExport");
  let optReport = [];
  try {
    if (btn) { btn.disabled = true; btn.textContent = "⏳ 檢查照片中…"; }
    optReport = await optimizeStoredImages();
  } catch (e) {
    optReport = ["⚠ 優化過程發生問題：" + (e.message || e)];
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "📋 匯出內容"; }
  }
  const lines = [];
  lines.push("=== 幻想友人帳 線上編輯匯出 ===");
  lines.push("頁面：" + PAGE + ".html　　匯出時間：" + new Date().toLocaleString("zh-TW"));
  lines.push("");

  const textKeys = Object.keys(pageData.text || {});
  lines.push("【改過的文字】" + (textKeys.length ? "" : "（無）"));
  textKeys.forEach((k) => {
    const el = document.querySelector('[data-edit-key="' + k + '"]');
    const now = pageData.text[k].replace(/<br\s*\/?>/gi, "／").replace(/<[^>]+>/g, "").trim();
    const was = (textDefaults[k] || "").replace(/<br\s*\/?>/gi, "／").replace(/<[^>]+>/g, "").trim();
    lines.push("・目前顯示：「" + now + "」");
    if (/color\s*:/.test(pageData.text[k])) {
      lines.push("　（此段內含「局部文字變色」，下面附原始HTML，貼給 Claude 即可連變色一起併回預設）");
      lines.push("　原始HTML：" + pageData.text[k]);
    }
    if (was) lines.push("　（網頁預設原是：「" + was.slice(0, 60) + (was.length > 60 ? "…" : "") + "」）");
    if (!el) lines.push("　⚠ 此段在目前頁面上找不到（可能預設文字已被改過而脫鉤）");
  });
  lines.push("");

  /* ★ 2026-07-11：字級也列進匯出（原本漏了） */
  const sizeKeys = Object.keys(pageData.size || {});
  lines.push("【調整過字級的文字】" + (sizeKeys.length ? "" : "（無）"));
  sizeKeys.forEach((k) => {
    const el = document.querySelector('[data-edit-key="' + k + '"]');
    const txt = el ? el.textContent.replace(/\s+/g, " ").trim().slice(0, 40) : "";
    lines.push("・" + (txt ? "「" + txt + "」" : "（段落鍵 " + k + "）") + " → 字級 " + Math.round(pageData.size[k] * 100) + "%");
    if (!el) lines.push("　⚠ 此段在目前頁面上找不到（可能已脫鉤）");
  });
  lines.push("");

  /* ★ 2026-07-11：字型設定 */
  const fontKeys = Object.keys(pageData.font || {});
  lines.push("【調整過字型的文字】" + (fontKeys.length ? "" : "（無）"));
  fontKeys.forEach((k) => {
    const el = document.querySelector('[data-edit-key="' + k + '"]');
    const txt = el ? el.textContent.replace(/\s+/g, " ").trim().slice(0, 40) : "";
    lines.push("・" + (txt ? "「" + txt + "」" : "（段落鍵 " + k + "）") + " → 字型 " + pageData.font[k]);
    if (!el) lines.push("　⚠ 此段在目前頁面上找不到（可能已脫鉤）");
  });
  lines.push("");

  const hid = pageData.hidden || [];
  lines.push("【隱藏的圖片】" + (hid.length ? "" : "（無）"));
  hid.forEach((k) => {
    const rec = hiddenHosts[k];
    const alt = rec && rec.im ? (rec.im.alt || rec.im.getAttribute("src") || k) : k;
    lines.push("・" + alt);
  });
  lines.push("");

  const adds = imgDocs.filter((d) => d.kind === "add");
  lines.push("【線上新增的照片】" + (adds.length ? "" : "（無）"));
  adds.forEach((d) => {
    let extra = "";
    if (d.capColor) extra += "／圖說顏色 " + d.capColor;
    if (d.capFont)  extra += "／圖說字型 " + d.capFont;
    lines.push("・容器 " + d.container + "：「" + (d.cap || "（無說明）") + "」" + extra);
  });
  lines.push("");

  const reps = imgDocs.filter((d) => d.kind === "replace");
  lines.push("【線上更換過的圖片】" + (reps.length ? "" : "（無）"));
  reps.forEach((d) => {
    const im = document.querySelector('[data-img-key="' + d.key + '"]');
    lines.push("・" + (im ? (im.alt || d.key) : d.key));
  });

  /* ★ 2026-07-11：改過顏色的文字也列進匯出，方便 Claude 併回 HTML 預設 */
  const colKeys = Object.keys(pageData.color || {});
  lines.push("");
  lines.push("【改過顏色的文字】" + (colKeys.length ? "" : "（無）"));
  colKeys.forEach((k) => {
    const el = document.querySelector('[data-edit-key="' + k + '"]');
    const txt = el ? el.textContent.replace(/\s+/g, " ").trim().slice(0, 40) : "";
    lines.push("・" + (txt ? "「" + txt + "」" : "（段落鍵 " + k + "）") + " → 顏色 " + pageData.color[k]);
    if (!el) lines.push("　⚠ 此段在目前頁面上找不到（可能預設文字已被改過而脫鉤）");
  });

  /* ★ 2026-07-11：圖片尺寸、歌詞、本頁背景（含濾鏡）、全站字型庫——完整修改細節一次匯齊 */
  const imszKeys = Object.keys(pageData.imgsize || {});
  lines.push("");
  lines.push("【調整過大小的圖片】" + (imszKeys.length ? "" : "（無）"));
  imszKeys.forEach((k) => {
    const im = document.querySelector('[data-img-key="' + k + '"]') || collectImgs().find((x) => imgKeyOf(x) === k);
    lines.push("・" + (im ? (im.alt || im.getAttribute("src") || k) : k + "（頁面上找不到）") + " → 寬度 " + Math.round(pageData.imgsize[k] * 100) + "%");
  });

  lines.push("");
  lines.push("【歌詞設定（about 專用）】" + (pageData.lyrics ? "" : "（無自訂）"));
  if (pageData.lyrics) {
    if (Array.isArray(pageData.lyrics.lines)) lines.push("・自訂歌詞 " + pageData.lyrics.lines.length + " 行（完整內容以頁面顯示為準）");
    if (pageData.lyrics.size > 0) lines.push("・歌詞字級 " + Math.round(pageData.lyrics.size * 100) + "%");
  }

  lines.push("");
  lines.push("【本頁背景】");
  lines.push("・自訂背景圖：" + (bgHasCustomSrc ? "有（線上上傳）" : "無（使用網頁預設）"));
  if (bgFxCache) {
    const f = Object.assign({ op: 100, br: 100, sa: 100 }, bgFxCache);
    lines.push("・背景濾鏡：透明度 " + f.op + "%／明亮度 " + f.br + "%／彩度 " + f.sa + "%");
  } else {
    lines.push("・背景濾鏡：未調整（全部 100%）");
  }

  await fetchLibFonts();
  lines.push("");
  lines.push("【字型庫（全站共用）】" + (libFonts.length ? "" : "（空）"));
  libFonts.forEach((f) => lines.push("・" + f));

  lines.push("");
  lines.push("【照片自動優化（轉 WebP 輕量版）】" + (optReport.length ? "" : "（這頁的線上照片都已是輕量版，無需處理）"));
  optReport.forEach((s) => lines.push("・" + s));

  const wrap = document.createElement("div");
  wrap.className = "admin-modal";
  wrap.innerHTML =
    '<div class="admin-modal-card"><h3>📋 匯出線上編輯（' + PAGE + '.html）</h3>' +
    '<p class="admin-hint" style="color:var(--muted)">全選複製下面的內容，貼給 Claude 當作「目前版本」的依據。每一頁要分別匯出。</p>' +
    '<textarea readonly rows="14" style="width:100%;margin-top:8px;font-size:0.82rem"></textarea>' +
    '<div class="admin-modal-btns">' +
    '<button type="button" class="admin-btn primary" data-a="copy">複製全部</button>' +
    '<button type="button" class="admin-btn" data-a="close">關閉</button></div></div>';
  wrap.querySelector("textarea").value = lines.join("\n");
  document.body.appendChild(wrap);
  wrap.addEventListener("click", (e) => {
    if (e.target === wrap || e.target.dataset.a === "close") wrap.remove();
    if (e.target.dataset.a === "copy") {
      const ta = wrap.querySelector("textarea");
      ta.select();
      navigator.clipboard?.writeText(ta.value).then(
        () => { e.target.textContent = "✓ 已複製"; },
        () => { document.execCommand("copy"); e.target.textContent = "✓ 已複製"; }
      );
    }
  });
}

/* ============================================================
   6) 照片自動優化（「📋 匯出內容」時自動執行）
   - 檢查對象：這一頁線上「新增／更換」的照片＋商店夥伴照片
   - 條件：不是 WebP 格式，或超過約 450KB
   - 動作：瀏覽器端重新壓成 WebP（不支援 WebP 的瀏覽器用 JPEG），
           確定有省下至少 15% 才替換 Firebase 裡的檔案並同步畫面
   ※ 只處理存在 Firebase 的線上照片；GitHub images/ 裡的檔案
     另由 Claude 轉檔（老師提供原圖 → Claude 交付 webp）。
   ============================================================ */
const WEBP_OK = (() => {
  try { return document.createElement("canvas").toDataURL("image/webp").startsWith("data:image/webp"); }
  catch (e) { return false; }
})();
const dataUrlKB = (s) => Math.round((s.length * 3) / 4 / 1024);

function recompressDataUrl(src, maxSide = 1400, quality = 0.8) {
  return new Promise((resolve) => {
    const im = new Image();
    im.onload = () => {
      let { width: w, height: h } = im;
      if (Math.max(w, h) > maxSide) {
        const k = maxSide / Math.max(w, h);
        w = Math.round(w * k); h = Math.round(h * k);
      }
      const cv = document.createElement("canvas");
      cv.width = w; cv.height = h;
      cv.getContext("2d").drawImage(im, 0, 0, w, h);
      resolve(cv.toDataURL(WEBP_OK ? "image/webp" : "image/jpeg", quality));
    };
    im.onerror = () => resolve(null);
    im.src = src;
  });
}

async function optimizeStoredImages() {
  const report = [];
  const fmt = WEBP_OK ? "WebP" : "JPEG（此瀏覽器不支援輸出 WebP）";
  const needsWork = (s) =>
    typeof s === "string" && s.startsWith("data:image/") &&
    (!s.startsWith("data:image/webp") || dataUrlKB(s) > 450);

  // 這一頁的 新增／更換 圖片文件
  for (const d of imgDocs) {
    if (!needsWork(d.src)) continue;
    const nu = await recompressDataUrl(d.src, d.kind === "add" ? 1400 : 1400);
    if (!nu || nu.length >= d.src.length * 0.85) continue;   // 省不到 15% 就不折騰
    await updateDoc(doc(db, "siteContent", d.id), { src: nu });
    const label = d.kind === "add" ? '新增照片「' + (d.cap || d.container) + '」' : "更換過的圖片";
    report.push(label + "：" + dataUrlKB(d.src) + " KB → " + dataUrlKB(nu) + " KB（" + fmt + "）");
    // 同步目前畫面
    if (d.kind === "add") {
      const n = document.querySelector('[data-doc-id="' + d.id + '"] img, img[data-doc-id="' + d.id + '"]');
      if (n) n.src = nu;
    } else {
      const n = document.querySelector('[data-img-key="' + d.key + '"]');
      if (n) n.src = nu;
    }
    d.src = nu;
  }

  // 商店夥伴照片（僅商店頁有資料）
  for (const rec of partnersCache) {
    const p = rec.data;
    if (!needsWork(p.photo)) continue;
    const nu = await recompressDataUrl(p.photo, 900);
    if (!nu || nu.length >= p.photo.length * 0.85) continue;
    await updateDoc(doc(db, "shopPartners", rec.id), { photo: nu });
    report.push('夥伴「' + p.name + '」照片：' + dataUrlKB(p.photo) + " KB → " + dataUrlKB(nu) + " KB（" + fmt + "）");
    p.photo = nu;
  }
  if (report.length && partnerList) renderPartners();
  return report;
}

/* ============================================================
   7) 清理失效編輯（管理列「🧹 清理失效編輯」）
   刪掉「在目前頁面上已找不到對應段落」的文字編輯紀錄——
   通常出現在：該段的預設文字已由 Claude 更新（例如把線上編輯
   同步成新預設之後），舊紀錄變成孤兒、只會在匯出清單裡當雜訊。
   只清文字紀錄；隱藏圖片、新增照片、更換圖片都不會動。
   ============================================================ */
/* ★ 2026-07-11 升級：連失效的「字級」「顏色」紀錄一起清（原本只清文字）。
   舊版備查：
   async function cleanStaleEdits() {
     const keys = Object.keys(pageData.text || {});
     const stale = keys.filter((k) => !document.querySelector('[data-edit-key="' + k + '"]'));
     if (!stale.length) { alert("這一頁沒有失效的編輯紀錄，很乾淨！"); return; }
     if (!confirm("找到 " + stale.length + " 筆失效的文字編輯紀錄（頁面上已沒有對應段落）。\n清掉它們嗎？目前顯示的內容不會有任何變化。")) return;
     try {
       const patch = {};
       stale.forEach((k) => { patch[k] = deleteField(); });
       await setDoc(pageRef, { text: patch }, { merge: true });
       stale.forEach((k) => delete pageData.text[k]);
       alert("已清理 " + stale.length + " 筆。");
     } catch (e) { alert("清理失敗：" + (e.message || e)); }
   }
*/
async function cleanStaleEdits() {
  const gone   = (k) => !document.querySelector('[data-edit-key="' + k + '"]');
  const staleT = Object.keys(pageData.text  || {}).filter(gone);
  const staleS = Object.keys(pageData.size  || {}).filter(gone);
  const staleC = Object.keys(pageData.color || {}).filter(gone);
  const staleF = Object.keys(pageData.font  || {}).filter(gone);   // ★ 2026-07-11 字型
  const total  = staleT.length + staleS.length + staleC.length + staleF.length;
  if (!total) { alert("這一頁沒有失效的編輯紀錄，很乾淨！"); return; }
  if (!confirm("找到 " + total + " 筆失效紀錄（文字 " + staleT.length + "、字級 " + staleS.length + "、顏色 " + staleC.length + "、字型 " + staleF.length + "）。\n清掉它們嗎？目前顯示的內容不會有任何變化。")) return;
  try {
    const payload = {};
    if (staleT.length) { payload.text  = {}; staleT.forEach((k) => { payload.text[k]  = deleteField(); }); }
    if (staleS.length) { payload.size  = {}; staleS.forEach((k) => { payload.size[k]  = deleteField(); }); }
    if (staleC.length) { payload.color = {}; staleC.forEach((k) => { payload.color[k] = deleteField(); }); }
    if (staleF.length) { payload.font  = {}; staleF.forEach((k) => { payload.font[k]  = deleteField(); }); }
    await setDoc(pageRef, payload, { merge: true });
    staleT.forEach((k) => delete pageData.text[k]);
    staleS.forEach((k) => { if (pageData.size)  delete pageData.size[k]; });
    staleC.forEach((k) => { if (pageData.color) delete pageData.color[k]; });
    staleF.forEach((k) => { if (pageData.font)  delete pageData.font[k]; });
    alert("已清理 " + total + " 筆。");
  } catch (e) { alert("清理失敗：" + (e.message || e)); }
}

/* ★ 2026-07-11：字型庫（管理列「🖋 字型庫」）
   - 老師去 fonts.google.com 逛（語言篩 Chinese (Traditional) 或 Japanese），
     把字型「名稱」原樣貼進來（大小寫、空格要一致，例：Kiwi Maru）
   - 加入時會即時載入並顯示試打字樣，確認有中文再儲存
   - 名單存 siteContent/config-fonts {list:[…]}，全站五頁的字型選單共用 */
function openFontLibrary() {
  const wrap = document.createElement("div");
  wrap.className = "admin-modal";
  wrap.innerHTML =
    '<div class="admin-modal-card"><h3>🖋 字型庫（全站共用）</h3>' +
    '<p style="font-size:0.82rem;color:var(--muted)">到 fonts.google.com（語言篩選 Chinese (Traditional) / Japanese）找喜歡的字型，' +
    '把「字型名稱」原樣貼進下面加入。加入後會出現在編輯工具列的字型選單。<br>※ 名稱大小寫與空格要一致；純英文字型套在中文段落只有英數字會變。</p>' +
    '<div id="flList" style="margin:10px 0"></div>' +
    '<label>新增字型名稱：<input id="flName" placeholder="例：Kiwi Maru" spellcheck="false" /></label>' +
    '<p id="flPrev" style="font-size:1.15rem;margin:8px 0;min-height:1.6em"></p>' +
    '<div class="admin-modal-btns">' +
    '<button type="button" class="admin-btn" data-a="try">試載入</button>' +
    '<button type="button" class="admin-btn primary" data-a="add">加入名單</button>' +
    '<button type="button" class="admin-btn primary" data-a="save">儲存</button>' +
    '<button type="button" class="admin-btn" data-a="cancel">取消</button></div></div>';
  document.body.appendChild(wrap);
  let pending = libFonts.slice();                      // 先改副本，按「儲存」才寫入
  const listEl = wrap.querySelector("#flList");
  const nameEl = wrap.querySelector("#flName");
  const prevEl = wrap.querySelector("#flPrev");
  const renderList = () => {
    listEl.innerHTML = pending.length
      ? pending.map((f, i) =>
          '<p style="display:flex;align-items:center;gap:8px;margin:4px 0">' +
          '<button type="button" class="admin-btn" data-del="' + i + '">✕</button>' +
          '<span style="font-family:' + fontStack(f).replace(/"/g, "&quot;") + '">' + esc(f) + '　永遠的幻想 Aa123</span></p>').join("")
      : '<p style="color:var(--muted);font-size:0.84rem">（字型庫還是空的）</p>';
    pending.forEach((f) => ensureFontLoaded(f));
  };
  fetchLibFonts().then(() => { pending = libFonts.slice(); renderList(); });
  renderList();
  const tryLoad = () => {
    const f = nameEl.value.trim();
    if (!f) { prevEl.textContent = ""; return ""; }
    ensureFontLoaded(f);
    prevEl.style.fontFamily = fontStack(f);
    prevEl.textContent = f + "：永遠的幻想 帳中留名 Aa123（字有變樣＝載入成功）";
    return f;
  };
  wrap.addEventListener("click", async (e) => {
    const del = e.target.dataset.del;
    if (del !== undefined) { pending.splice(Number(del), 1); renderList(); return; }
    const a = e.target.dataset.a;
    if (e.target === wrap || a === "cancel") { wrap.remove(); return; }
    if (a === "try") { tryLoad(); return; }
    if (a === "add") {
      const f = tryLoad();
      if (!f) { alert("請先輸入字型名稱。"); return; }
      if (pending.includes(f)) { alert("這個字型已經在名單裡了。"); return; }
      pending.push(f); nameEl.value = ""; renderList();
      return;
    }
    if (a === "save") {
      try {
        await setDoc(doc(db, "siteContent", "config-fonts"), { list: pending, updated: Date.now() });
        libFonts = pending.slice();
        alert("✅ 字型庫已更新（" + libFonts.length + " 套）。");
        wrap.remove();
      } catch (err) { alert("儲存失敗：" + (err.message || err)); }
    }
  });
}

/* ============================================================
   8) 歌詞排版編輯（管理列「🎼 歌詞設定」，僅公會介紹頁出現）
   - 一行＝一句歌詞；行尾的（中文）自動顯示成小字翻譯
   - 可自由增刪行、改字、換行；字級 50%～200%
   - 存於 page-about 文件的 lyrics 欄位；「回復預設」清掉即回原歌詞
   ============================================================ */
let defaultLyricsHTML = "";   // 載入時的預設歌詞（applyOverrides 會填）

function renderLyricLine(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  const m = s.match(/^(.*?)\s*[（(]([^）)]*)[）)]\s*$/);   // 行尾（中文）→ 小字
  if (m && m[1]) return "<p>" + esc(m[1]) + " <span>(" + esc(m[2]) + ")</span></p>";
  return "<p>" + esc(s) + "</p>";
}

function openLyricsEditor() {
  const track = document.getElementById("lyricsTrack");
  if (!track) return;
  // 目前顯示的歌詞 → 還原成「一行一句」文字（取前半，內容有複製一份）
  const ps = Array.from(track.children).slice(0, track.children.length / 2);
  const lines = ps.map((p) => {
    const span = p.querySelector("span");
    const cn = span ? span.textContent.replace(/^\(|\)$/g, "") : "";
    const jp = (span ? p.textContent.replace(span.textContent, "") : p.textContent).trim();
    return cn ? jp + " (" + cn + ")" : jp;
  });
  const curSize = (pageData.lyrics && pageData.lyrics.size) || 1;

  const wrap = document.createElement("div");
  wrap.className = "admin-modal";
  wrap.innerHTML =
    '<div class="admin-modal-card"><h3>🎼 歌詞設定</h3>' +
    '<p class="admin-hint" style="color:var(--muted)">一行＝一句。想在句中換行就拆成兩行；行尾用（　）包住的字會顯示成小字中文翻譯。</p>' +
    '<textarea id="lyTa" rows="14" style="width:100%;margin-top:6px;font-size:0.84rem"></textarea>' +
    '<label style="margin-top:10px">歌詞字級：<b id="lyPct">' + Math.round(curSize * 100) + '%</b>' +
    '<input id="lySize" type="range" min="50" max="200" step="5" value="' + Math.round(curSize * 100) + '" style="width:100%" /></label>' +
    '<p class="admin-hint" id="lyMsg"></p>' +
    '<div class="admin-modal-btns">' +
    '<button type="button" class="admin-btn primary" data-a="save">儲存</button>' +
    '<button type="button" class="admin-btn" data-a="cancel">取消</button>' +
    '<button type="button" class="admin-btn" data-a="reset">回復預設</button></div></div>';
  wrap.querySelector("#lyTa").value = lines.join("\n");
  document.body.appendChild(wrap);
  const sizeInp = wrap.querySelector("#lySize");
  sizeInp.addEventListener("input", () => {
    wrap.querySelector("#lyPct").textContent = sizeInp.value + "%";
    track.style.setProperty("--lyr-k", sizeInp.value / 100);   // 即時預覽
  });
  wrap.addEventListener("click", async (e) => {
    if (e.target === wrap || e.target.dataset.a === "cancel") {
      track.style.setProperty("--lyr-k", curSize);             // 還原預覽
      wrap.remove(); return;
    }
    const a = e.target.dataset.a;
    if (a === "save") {
      try {
        const newLines = wrap.querySelector("#lyTa").value.split("\n").map((s) => s.trim()).filter(Boolean);
        if (!newLines.length) throw new Error("歌詞不能是空的。");
        const size = sizeInp.value / 100;
        await setDoc(pageRef, { lyrics: { lines: newLines, size } }, { merge: true });
        pageData.lyrics = { lines: newLines, size };
        const html = newLines.map(renderLyricLine).join("");
        track.innerHTML = html + html;
        track.style.setProperty("--lyr-k", size);
        wrap.remove();
      } catch (err) { wrap.querySelector("#lyMsg").textContent = "❌ " + (err.message || err); }
    }
    if (a === "reset") {
      if (!confirm("回復成網頁預設的歌詞與字級？")) return;
      try {
        await setDoc(pageRef, { lyrics: deleteField() }, { merge: true });
        delete pageData.lyrics;
        if (defaultLyricsHTML) track.innerHTML = defaultLyricsHTML;
        track.style.removeProperty("--lyr-k");
        wrap.remove();
      } catch (err) { wrap.querySelector("#lyMsg").textContent = "❌ " + (err.message || err); }
    }
  });
}

/* ============================================================
   9) 圖片尺寸調整（圖片徽章「⊞ 尺寸」）
   - 以原本版位寬度為 100%，可調 30%～200%，即時預覽
   - 跑馬燈與輪播內的照片尺寸統一，不提供個別調整
   ============================================================ */
function openImgSize(im) {
  const k = imgKeyOf(im);
  const cur = ((pageData.imgsize || {})[k] || 1) * 100;
  const orig = { w: im.style.width, h: im.style.height, d: im.style.display, ml: im.style.marginLeft, mr: im.style.marginRight };
  const preview = (v) => {
    im.style.width = v + "%"; im.style.height = "auto";
    im.style.display = "block"; im.style.marginLeft = "auto"; im.style.marginRight = "auto";
  };
  const wrap = document.createElement("div");
  wrap.className = "admin-modal";
  wrap.innerHTML =
    '<div class="admin-modal-card"><h3>⊞ 圖片尺寸</h3>' +
    '<label>寬度：<b id="isPct">' + Math.round(cur) + '%</b>（100%＝原本版位大小）' +
    '<input id="isRange" type="range" min="30" max="200" step="5" value="' + Math.round(cur) + '" style="width:100%" /></label>' +
    '<div class="admin-modal-btns">' +
    '<button type="button" class="admin-btn primary" data-a="save">儲存</button>' +
    '<button type="button" class="admin-btn" data-a="cancel">取消</button>' +
    '<button type="button" class="admin-btn" data-a="reset">還原 100%</button></div></div>';
  document.body.appendChild(wrap);
  const rng = wrap.querySelector("#isRange");
  rng.addEventListener("input", () => {
    wrap.querySelector("#isPct").textContent = rng.value + "%";
    preview(rng.value);
  });
  const restore = () => { Object.assign(im.style, { width: orig.w, height: orig.h, display: orig.d, marginLeft: orig.ml, marginRight: orig.mr }); };
  wrap.addEventListener("click", async (e) => {
    if (e.target === wrap || e.target.dataset.a === "cancel") { restore(); wrap.remove(); return; }
    const a = e.target.dataset.a;
    if (a === "save") {
      try {
        const v = rng.value / 100;
        await setDoc(pageRef, { imgsize: { [k]: v === 1 ? deleteField() : v } }, { merge: true });
        if (!pageData.imgsize) pageData.imgsize = {};
        if (v === 1) { delete pageData.imgsize[k]; restore(); im.style.width = ""; }
        else { pageData.imgsize[k] = v; preview(rng.value); }
        wrap.remove();
      } catch (err) { alert("儲存失敗：" + (err.message || err)); }
    }
    if (a === "reset") {
      try {
        await setDoc(pageRef, { imgsize: { [k]: deleteField() } }, { merge: true });
        if (pageData.imgsize) delete pageData.imgsize[k];
        restore(); im.style.width = ""; im.style.height = ""; im.style.display = ""; im.style.marginLeft = ""; im.style.marginRight = "";
        wrap.remove();
      } catch (err) { alert("還原失敗：" + (err.message || err)); }
    }
  });
}

/* ============================================================
   10) 預約系統開關＋內部排班表連結＋每頁背景線上更換
   ------------------------------------------------------------
   資料存法（都在 siteContent 集合，規則已涵蓋、不必改規則）：
   - siteContent/config-shop  ：{ bookingOpen: 布林, bookingUrl: Google表單網址 }
   - siteContent/config-admin ：{ sheetUrl: 內部試算表網址 }
     ※ 誠實提醒：Firestore 的 siteContent 全站可讀，網址本身藏不住；
       真正的鎖是試算表權限設「僅限受邀者」——連結外流路人也打不開。
   - siteContent/bg-{頁名}    ：{ src: 背景圖 dataURL（WebP 或 ≤700KB 的 GIF）}
     背景以 !important 樣式覆蓋，時段背景／內頁輪播照常運作但被蓋住；
     「回復預設」刪掉文件即恢復原本背景，零風險。
   ============================================================ */

/* ---------- 10a) 預約按鈕：讀開關、切換「敬請期待／立即預約」 ---------- */
const bookingBtnEl = document.getElementById("bookingBtn");
let bookingCfg = { bookingOpen: false, bookingUrl: "" };

function paintBooking() {
  if (!bookingBtnEl) return;
  const open = !!(bookingCfg.bookingOpen && bookingCfg.bookingUrl);
  bookingBtnEl.textContent = open ? "🏮 立即預約" : "🏮 預約系統｜敬請期待！";
  bookingBtnEl.classList.toggle("is-closed", !open);
  if (open) {
    bookingBtnEl.href = bookingCfg.bookingUrl;
    bookingBtnEl.target = "_blank";
    bookingBtnEl.removeAttribute("aria-disabled");
  } else {
    bookingBtnEl.href = "#";
    bookingBtnEl.removeAttribute("target");
    bookingBtnEl.setAttribute("aria-disabled", "true");
  }
}
if (bookingBtnEl) {
  bookingBtnEl.addEventListener("click", (e) => {
    if (bookingBtnEl.classList.contains("is-closed")) e.preventDefault();  // 關閉時點了不跳
  });
  (async () => {
    try {
      const snap = await getDoc(doc(db, "siteContent", "config-shop"));
      if (snap.exists()) bookingCfg = Object.assign(bookingCfg, snap.data());
    } catch (e) { console.warn("預約開關讀取失敗（維持敬請期待）：", e); }
    paintBooking();
  })();
}

/* ---------- 10b) 管理列「🏮 預約開關」：開／關＋填表單網址 ---------- */
function openBookingConfig() {
  const wrap = document.createElement("div");
  wrap.className = "admin-modal";
  wrap.innerHTML =
    '<div class="admin-modal-card"><h3>🏮 預約系統開關</h3>' +
    '<label><input type="radio" name="bkSw" value="off"' + (bookingCfg.bookingOpen ? "" : " checked") + ' /> 關閉（顯示「敬請期待！」）</label>' +
    '<label><input type="radio" name="bkSw" value="on"' + (bookingCfg.bookingOpen ? " checked" : "") + ' /> 開放（按鈕連到預約表單）</label>' +
    '<label>Google 預約表單網址：<input id="bkUrl" type="url" placeholder="https://forms.gle/…" value="' + esc(bookingCfg.bookingUrl || "") + '" /></label>' +
    '<p style="font-size:0.8rem;color:var(--muted)">※ 選「開放」但沒填網址時，前台仍會顯示敬請期待。</p>' +
    '<div class="admin-modal-btns">' +
    '<button type="button" class="admin-btn primary" data-a="save">儲存</button>' +
    '<button type="button" class="admin-btn" data-a="cancel">取消</button></div></div>';
  document.body.appendChild(wrap);
  wrap.addEventListener("click", async (e) => {
    if (e.target === wrap || e.target.dataset.a === "cancel") { wrap.remove(); return; }
    if (e.target.dataset.a !== "save") return;
    try {
      const openSel = wrap.querySelector('input[name="bkSw"]:checked').value === "on";
      const url = wrap.querySelector("#bkUrl").value.trim();
      if (url && !/^https:\/\//.test(url)) { alert("表單網址請以 https:// 開頭。"); return; }
      await setDoc(doc(db, "siteContent", "config-shop"), { bookingOpen: openSel, bookingUrl: url }, { merge: true });
      bookingCfg = { bookingOpen: openSel, bookingUrl: url };
      paintBooking();
      wrap.remove();
    } catch (err) { alert("儲存失敗：" + (err.message || err)); }
  });
}

/* ---------- 10c) 管理列「📊 排班表」：開內部試算表（Shift＋點＝重設網址） ---------- */
async function openSheetLink(e) {
  try {
    const ref = doc(db, "siteContent", "config-admin");
    const snap = await getDoc(ref);
    let url = snap.exists() ? (snap.data().sheetUrl || "") : "";
    if (!url || (e && e.shiftKey)) {
      const nu = prompt("貼上內部試算表（Google Sheets）網址：", url);
      if (nu === null) return;
      url = nu.trim();
      if (url && !/^https:\/\//.test(url)) { alert("網址請以 https:// 開頭。"); return; }
      await setDoc(ref, { sheetUrl: url }, { merge: true });
      if (!url) return;
    }
    window.open(url, "_blank", "noopener");
  } catch (err) { alert("開啟失敗：" + (err.message || err)); }
}

/* ---------- 10d) 每頁背景線上更換＋★2026-07-11 背景濾鏡（透明度／明亮度／彩度） ---------- */
const bgRef = doc(db, "siteContent", "bg-" + PAGE);
let bgFxCache = null;          // 目前濾鏡設定 {op,br,sa}（百分比）
let bgHasCustomSrc = false;    // 這頁是否有自訂背景圖（供匯出報告）

function applyCustomBg(src) {
  let st = document.getElementById("yjcBgStyle");
  if (!src) { if (st) st.remove(); return; }
  if (!st) { st = document.createElement("style"); st.id = "yjcBgStyle"; document.head.appendChild(st); }
  const u = 'url("' + src + '")';
  let css = "";
  if (document.getElementById("homeBg")) css += "#homeBg{background-image:" + u + " !important;}";
  if (document.getElementById("pageBg")) css += "#pageBg .pbg-slide{background-image:" + u + " !important;}";
  if (!css) css = "body{background-image:" + u + " !important;background-size:cover !important;background-position:center !important;background-attachment:fixed !important;}";
  st.textContent = css;
}
/* ★ 濾鏡加在「背景容器」（#homeBg／#pageBg 本體）上：
   輪播淡入淡出做在容器裡的 .pbg-slide，所以照常運作、只是整體被調色 */
function applyBgFx(fx) {
  let st = document.getElementById("yjcBgFxStyle");
  const v = Object.assign({ op: 100, br: 100, sa: 100 }, fx || {});
  const isDefault = Number(v.op) === 100 && Number(v.br) === 100 && Number(v.sa) === 100;
  if (isDefault) { if (st) st.remove(); return; }
  if (!st) { st = document.createElement("style"); st.id = "yjcBgFxStyle"; document.head.appendChild(st); }
  const rule = "{opacity:" + (v.op / 100) + " !important;filter:brightness(" + (v.br / 100) + ") saturate(" + (v.sa / 100) + ") !important;}";
  let css = "";
  if (document.getElementById("homeBg")) css += "#homeBg" + rule;
  if (document.getElementById("pageBg")) css += "#pageBg" + rule;
  st.textContent = css;
}
(async () => {
  try {
    const snap = await getDoc(bgRef);
    if (snap.exists()) {
      if (snap.data().src) { applyCustomBg(snap.data().src); bgHasCustomSrc = true; }
      bgFxCache = snap.data().fx || null;
      applyBgFx(bgFxCache);
    }
  } catch (e) { console.warn("自訂背景讀取失敗（顯示預設背景）：", e); }
})();

function openBgConfig() {
  const wrap = document.createElement("div");
  wrap.className = "admin-modal";
  wrap.innerHTML =
    '<div class="admin-modal-card"><h3>🖼 背景設定（' + PAGE + '.html）</h3>' +
    '<p style="font-size:0.84rem;color:var(--muted)">照片（JPG/PNG/WebP）會自動壓成 WebP；GIF 動圖原樣儲存、檔案需 ≤ 700KB。</p>' +
    '<label>選擇新背景：<input id="bgFile" type="file" accept="image/*" /></label>' +
    '<p id="bgMsg" style="font-size:0.8rem;color:var(--muted)"></p>' +
    /* ★ 2026-07-11：背景濾鏡三滑桿（不換圖也能單獨調；拖動即時預覽，儲存才寫入） */
    '<label>透明度 <b id="fxOpV"></b><input id="fxOp" type="range" min="20" max="100" step="5" /></label>' +
    '<label>明亮度 <b id="fxBrV"></b><input id="fxBr" type="range" min="40" max="160" step="5" /></label>' +
    '<label>彩度 <b id="fxSaV"></b>（0＝黑白）<input id="fxSa" type="range" min="0" max="200" step="10" /></label>' +
    '<div class="admin-modal-btns">' +
    '<button type="button" class="admin-btn primary" data-a="save">儲存並套用</button>' +
    '<button type="button" class="admin-btn" data-a="reset">回復預設背景</button>' +
    '<button type="button" class="admin-btn" data-a="cancel">取消</button></div></div>';
  document.body.appendChild(wrap);
  let pendingSrc = "";
  const msg = wrap.querySelector("#bgMsg");
  /* ★ 2026-07-11：濾鏡滑桿——帶入現值、拖動即時預覽 */
  const fx0 = Object.assign({ op: 100, br: 100, sa: 100 }, bgFxCache || {});
  const sliders = { op: wrap.querySelector("#fxOp"), br: wrap.querySelector("#fxBr"), sa: wrap.querySelector("#fxSa") };
  const vals    = { op: wrap.querySelector("#fxOpV"), br: wrap.querySelector("#fxBrV"), sa: wrap.querySelector("#fxSaV") };
  const readFx  = () => ({ op: Number(sliders.op.value), br: Number(sliders.br.value), sa: Number(sliders.sa.value) });
  const paintFxLabels = () => { const f = readFx(); vals.op.textContent = f.op + "%"; vals.br.textContent = f.br + "%"; vals.sa.textContent = f.sa + "%"; };
  Object.keys(sliders).forEach((k) => {
    sliders[k].value = fx0[k];
    sliders[k].addEventListener("input", () => { paintFxLabels(); applyBgFx(readFx()); });
  });
  paintFxLabels();
  wrap.querySelector("#bgFile").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    msg.textContent = "處理中…";
    try {
      if (f.type === "image/gif") {
        if (f.size > 700 * 1024) throw new Error("GIF 超過 700KB，請先用線上工具（如 ezgif.com）壓縮。");
        pendingSrc = await new Promise((res, rej) => {
          const r = new FileReader();
          r.onload = () => res(r.result);
          r.onerror = () => rej(new Error("讀不到這個 GIF 檔。"));
          r.readAsDataURL(f);
        });
        if (pendingSrc.length > 950_000) throw new Error("GIF 編碼後仍太大，請再壓小一點。");
      } else {
        pendingSrc = await compressImage(f, 1600, 0.78);   // 背景用大圖：最長邊 1600
      }
      msg.textContent = "✅ 已就緒（約 " + Math.round(pendingSrc.length / 1024) + " KB），按「儲存並套用」生效。";
      applyCustomBg(pendingSrc);                            // 即時預覽
    } catch (err) { pendingSrc = ""; msg.textContent = "⚠️ " + (err.message || err); }
  });
  wrap.addEventListener("click", async (e) => {
    if (e.target === wrap || e.target.dataset.a === "cancel") {
      wrap.remove();
      // 取消＝把預覽（背景圖＋濾鏡）還原成 Firestore 現況
      try {
        const s = await getDoc(bgRef);
        applyCustomBg(s.exists() ? s.data().src : "");
        applyBgFx(s.exists() ? s.data().fx : null);
      } catch (_) {}
      return;
    }
    if (e.target.dataset.a === "save") {
      /* ★ 2026-07-11：不換圖也能只存濾鏡（merge 寫入，不會蓋掉已存的背景圖） */
      try {
        const fx = readFx();
        const payload = { fx, updated: Date.now() };
        if (pendingSrc) payload.src = pendingSrc;
        await setDoc(bgRef, payload, { merge: true });
        bgFxCache = fx;
        if (pendingSrc) bgHasCustomSrc = true;
        applyBgFx(fx);
        wrap.remove();
      } catch (err) { alert("儲存失敗：" + (err.message || err)); }
    }
    if (e.target.dataset.a === "reset") {
      try {
        await deleteDoc(bgRef);
        applyCustomBg("");
        applyBgFx(null);                        // ★ 濾鏡一併回復
        bgFxCache = null; bgHasCustomSrc = false;
        wrap.remove();
      } catch (err) { alert("還原失敗：" + (err.message || err)); }
    }
  });
}

/* ============================================================
   11) 內容保護（防隨手複製圖片＋主控台警語）
   ------------------------------------------------------------
   ※ 誠實說明：網頁原始碼與圖片天生是公開的，這一段只能「勸退隨手右鍵
     另存／拖曳」的訪客，擋不了有心人截圖或看原始碼。
     真正防「駭客竄改網站」的是：
     ① Firestore 規則（只有 ADMIN_EMAIL 能寫入）——已上線；
     ② GitHub 帳號密碼＋兩步驟驗證（2FA）——請務必開啟；
     ③ Google 帳號安全（管理員信箱本身的 2FA）。
   管理模式編輯不受影響（管理員登入後放行右鍵）。
   ============================================================ */
(function contentGuard() {
  document.addEventListener("contextmenu", (e) => {
    if (isAdmin) return;                                  // 管理員照常用右鍵
    if (e.target.closest("img, .page-bg, .home-petals")) e.preventDefault();
  });
  document.addEventListener("dragstart", (e) => {
    if (isAdmin) return;
    if (e.target.closest("img")) e.preventDefault();
  });
  try {
    console.log("%c幻想友人帳", "font-size:20px;color:#b03a2e;font-weight:bold");
    console.log("本站內容（文字／圖片／設計）© 幻想友人帳，請勿盜用。網站異動皆有紀錄。");
  } catch (_) {}
})();

/* ============================================================
   12) 管理列收合開關
   - 點管理列最上方「🔧 管理模式（信箱）」那一列 → 收合／展開
   - 狀態存 localStorage（yjcAdminFold），換頁、下次登入都記得
   ============================================================ */
document.addEventListener("click", (e) => {
  const sp = e.target.closest("#adminBar > span");
  if (!sp) return;
  const bar = document.getElementById("adminBar");
  const folded = bar.classList.toggle("folded");
  try { localStorage.setItem("yjcAdminFold", folded ? "1" : "0"); } catch (_) {}
});

/* ============================================================
   13) RP 商店「店員名簿」（只在有 #staffList 的頁面執行＝shop.html）
   ------------------------------------------------------------
   - 資料存在既有的 shopPartners 集合、以 kind:"staff" 標記
     → 不必動 Firestore 規則（管理員可寫、全站可讀）
   - Firestore 還沒有店員資料時，前台先顯示內建預設 8 位（DEFAULT_STAFF）；
     管理列按「⤓ 匯入預設店員」寫入資料庫後，每張卡即可 ✎編輯／✕刪除
   - 照片欄位兩種都吃：repo 相對路徑（如 images/officer-clair.webp）
     或線上上傳、canvas 壓縮後的 WebP dataURL
   ============================================================ */
const staffList  = document.getElementById("staffList");
const staffEmpty = document.getElementById("staffEmpty");

/* 內建預設名單（2026-07-11 老師定案；順序＝order） */
const DEFAULT_STAFF = [
  { name: "小克瑞爾",   role: "帳簿主", services: "公會長 · 網站維護",   photo: "images/officer-clair.webp",     order: 1 },
  { name: "卡爾",       role: "店員",   services: "角色扮演／陪座聊天", photo: "images/卡爾.jpg",               order: 2 },
  { name: "拉可帕萩琴", role: "店員",   services: "角色扮演／陪座聊天", photo: "images/officer-rakopa.webp",    order: 3 },
  { name: "小露貓",     role: "店員",   services: "角色扮演／陪座聊天", photo: "images/小露貓.jpg",             order: 4 },
  /* ★ 2026-07-11 追加兩位店員：order 用 4.1／4.2 小數插隊，
     這樣就算資料庫先前已匯入過（九里斯蒂安=5 起跳），
     再補匯這兩位也會乖乖排在店員群後面、不會打亂順序 */
  { name: "菲亞梅塔",   role: "店員",   services: "角色扮演／陪座聊天", photo: "images/菲亞梅塔.jpg",           order: 4.1 },
  { name: "哈魯德",     role: "店員",   services: "角色扮演／陪座聊天", photo: "images/哈魯德.jpg",             order: 4.2 },
  { name: "九里斯蒂安", role: "鏡花司", services: "裝潢布置",           photo: "images/officer-christian.webp", order: 5 },
  { name: "狂月巴",     role: "能樂司", services: "樂器表演",           photo: "images/狂月巴.jpg",             order: 6 },
  { name: "埃米爾",     role: "花魁",   services: "舞蹈表演",           photo: "images/埃米爾.jpg",             order: 7 },
  { name: "骸梅十穗",   role: "留影司", services: "美照攝影",           photo: "images/officer-toho.webp",      order: 8 },
];

let staffCache = [];             // Firestore 版 [{id, data}]
let staffUsingDefault = true;    // true＝目前顯示的是內建預設（尚未匯入資料庫）

async function loadStaff() {
  if (!staffList) return;
  try {
    /* 舊查詢（需要 Firestore 複合索引，未建索引會整個失敗→永遠顯示內建預設、無法編輯。2026-07-13 修正）：
       const q = query(collection(db, "shopPartners"), orderBy("order"), orderBy("createdAt")); */
    const q = collection(db, "shopPartners");
    const snap = await getDocs(q);
    staffCache = snap.docs
      .map((d) => ({ id: d.id, data: d.data() }))
      .filter((x) => x.data.kind === "staff");
    staffCache.sort((a, b) => (a.data.order || 0) - (b.data.order || 0));   /* ★ 2026-07-13 客戶端排序 */
  } catch (e) {
    console.warn("讀取店員名簿失敗：", e);
    staffCache = [];
  }
  staffUsingDefault = staffCache.length === 0;
  renderStaff();
}

/* ★ 2026-07-12：店員卡多張照片輪播（卡片內小輪播；燈箱另有左右切換）
   ★ 2026-07-14：輪播切換時同步更新照片下方的「身分」說明（.staff-photo-cap，
     讀各 img 的 data-cap）；指示點改為可點擊，點哪顆就切到哪張／哪個身分 */
function startStaffCarousel(card) {
  const imgs = Array.from(card.querySelectorAll(".staff-photo img"));
  const dots = Array.from(card.querySelectorAll(".staff-dots .sd"));
  const capEl = card.querySelector(".staff-photo-cap");
  /* ★ 2026-07-14 v4：換字也淡入淡出——先降透明、換完字再升回（照片本身的交叉淡化在 CSS） */
  const setCap = (n) => {
    if (!capEl) return;
    const t = (imgs[n]?.dataset.cap || "").trim();
    capEl.style.opacity = "0";
    setTimeout(() => {
      capEl.textContent = t;
      capEl.hidden = !t;
      capEl.style.opacity = "1";
    }, 280);
  };
  if (imgs.length < 2) return;
  let i = 0, timer = null;
  const go = (n) => {
    imgs[i].hidden = true; if (dots[i]) dots[i].classList.remove("on");
    i = (n + imgs.length) % imgs.length;
    imgs[i].hidden = false; if (dots[i]) dots[i].classList.add("on");
    setCap(i);
  };
  const play = () => { timer = setInterval(() => go(i + 1), 3500); };
  const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
  dots.forEach((d, n) => {
    d.style.cursor = "pointer";
    d.onclick = (e) => { e.stopPropagation(); stop(); go(n); play(); };
  });
  card.addEventListener("mouseenter", stop);
  card.addEventListener("mouseleave", play);
  play();
}

/* ★ 2026-07-13：把匯入的週循環班表壓成可讀字串（一二三四→一至四；全七天→每日） */
function formatShifts(shifts) {
  const DAYS = "一二三四五六日";
  const pretty = (days) => {
    if (days === DAYS) return "每日";
    if (days === "一二三四五") return "平日";
    if (days === "六日") return "假日";
    const i = DAYS.indexOf(days[0]);
    if (days.length >= 3 && DAYS.slice(i, i + days.length) === days)
      return `週${days[0]}至${days[days.length - 1]}`;
    return "週" + Array.from(days).join("、");
  };
  return (shifts || []).map((sh) => {
    const [d, s] = String(sh).split("|");
    return `${pretty(d || "")}${s ? "・" + s + (s.length <= 2 && s !== "午夜" ? "" : "") : ""}`;
  }).join("｜");
}

function renderStaff() {
  if (!staffList) return;
  staffList.classList.add("in");   /* ★ 2026-07-12：同餐單，防 reveal 門檻造成整塊隱形 */
  staffList.innerHTML = "";
  const rows = staffUsingDefault
    ? DEFAULT_STAFF.map((d) => ({ id: null, data: d }))
    : staffCache;
  if (staffEmpty) staffEmpty.style.display = rows.length ? "none" : "";
  for (const { id, data: s } of rows) {
    const card = document.createElement("article");
    card.className = "staff-card";
    // ★ 2026-07-12：照片改吃陣列 photos[]（可多張輪播）；相容舊的單張 photo 欄位
    const pics = (Array.isArray(s.photos) && s.photos.length) ? s.photos : (s.photo ? [s.photo] : []);
    /* ★ 2026-07-14：每張照片可對應一個「身分」說明（photoCaps[]，與 photos[] 同索引；
       輪播切到哪張，身分就同步顯示在照片下方；沒填的照片不顯示） */
    const caps = Array.isArray(s.photoCaps) ? s.photoCaps : [];
    const inner = pics.length
      ? pics.map((src, i) => `<img src="${src}" alt="${esc(s.name)} 的照片" loading="lazy" data-cap="${esc(caps[i] || "")}"${i === 0 ? "" : ' hidden'} />`).join("")
      : `<div class="noimg" aria-hidden="true"><span>印</span></div>`;
    const dots = pics.length > 1
      ? `<div class="staff-dots">${pics.map((_, i) => `<span class="sd${i === 0 ? " on" : ""}"></span>`).join("")}</div>` : "";
    // ★ 2026-07-12：角色設定（人設）——有填才顯示「看角色設定」
    const persona = (s.persona || "").trim();
    /* ★ 2026-07-14 v2：改橫式名冊——照片在左、文字包進 .staff-info 在右
       （舊直式短冊版：photo 與各行文字同層平鋪，備查於 git 歷史）
       ★ 2026-07-14 v3：照片包進 .staff-photo-col，下方掛 .staff-photo-cap 身分說明（隨輪播同步） */
    card.innerHTML = `
      <div class="staff-photo-col">
        <div class="staff-photo" data-name="${esc(s.name)}" data-role="${esc(s.role)}">${inner}${dots}</div>
        <p class="staff-photo-cap"${(caps[0] || "").trim() ? "" : " hidden"}>${esc(caps[0] || "")}</p>
      </div>
      <div class="staff-info">
      <h3>${esc(s.name)}</h3>
      ${s.badge ? `<p class="staff-badge${s.available === false ? " is-off" : ""}">${esc(s.badge)}</p>` : ""}
      <p class="staff-role">${esc(s.role)}</p>
      <p class="staff-serv">${esc(s.services)}</p>
      ${Array.isArray(s.shifts) && s.shifts.length ? `<p class="staff-shifts">🕐 可預約：${esc(formatShifts(s.shifts))}</p>` : ""}
      ${s.rpRoles ? `<p class="staff-rpline staff-rp-roles">🎭 可接身分：${esc(s.rpRoles)}</p>` : ""}
      ${s.rpStyles ? `<p class="staff-rpline staff-rp-styles">💬 風格：${esc(s.rpStyles)}${s.rpPhoto === "是" ? "　📸 可加拍" : ""}</p>` : ""}
      ${""/* ★ 2026-07-14：staff-rp-roles / staff-rp-styles 細分 class 供分色資訊框使用 */}
      ${persona ? `<button type="button" class="staff-persona-btn">看角色設定 ▾</button>
      <div class="staff-persona" hidden>${esc(persona).replace(/\n/g, "<br>")}</div>` : ""}
      </div>`;
    // 卡片內照片自動輪播（每 3.5 秒換一張；hover 暫停）
    if (pics.length > 1) startStaffCarousel(card);
    const pbtn = card.querySelector(".staff-persona-btn");
    if (pbtn) pbtn.onclick = () => {
      const box = card.querySelector(".staff-persona");
      const open = box.hasAttribute("hidden");
      if (open) box.removeAttribute("hidden"); else box.setAttribute("hidden", "");
      pbtn.textContent = open ? "收合角色設定 ▴" : "看角色設定 ▾";
    };
    if (isAdmin && id) {
      const bar = document.createElement("div");
      bar.className = "admin-actions";
      bar.innerHTML = `<button type="button" data-act="edit">✎ 編輯</button>
                       <button type="button" data-act="del">✕ 刪除</button>`;
      bar.querySelector('[data-act="edit"]').onclick = () => openStaffForm(id, s);
      bar.querySelector('[data-act="del"]').onclick = async () => {
        if (!confirm(`確定要刪除店員「${s.name}」嗎？（無法復原）`)) return;
        await deleteDoc(doc(db, "shopPartners", id));
        loadStaff();
      };
      card.appendChild(bar);
    }
    staffList.appendChild(card);
  }
  /* 管理員看到的還是內建預設時 → 提醒先匯入才能逐張編輯 */
  if (isAdmin && staffUsingDefault && rows.length) {
    const hint = document.createElement("p");
    hint.className = "staff-default-hint";
    hint.textContent = "目前顯示內建預設名單；按管理列「⤓ 匯入預設店員」寫入資料庫後，才能逐張編輯／刪除。";
    staffList.appendChild(hint);
  }
  /* ★ 2026-07-12：通知點餐模組（第 17 段）重建「指名店員」勾選清單 */
  if (window.YJC_ORDER) window.YJC_ORDER.refreshStaff();
}
renderStaff();   // 先立刻畫出內建預設（避免等待 Firestore 期間空白）
loadStaff();     // 再讀 Firestore，有資料就換成線上版

/* ---------- 新增／編輯店員的表單（燈箱式，比照夥伴表單） ---------- */
function openStaffForm(id = null, s = {}) {
  closeStaffForm();
  // ★ 2026-07-12：照片改用陣列（多張輪播）；相容舊的單張 photo
  let photos = (Array.isArray(s.photos) && s.photos.length) ? s.photos.slice() : (s.photo ? [s.photo] : []);
  /* ★ 2026-07-14：每張照片的「身分」說明（photoCaps 與 photos 同索引；
     刪除／排序照片時一併同步搬動） */
  let caps = photos.map((_, i) => (Array.isArray(s.photoCaps) ? s.photoCaps[i] : "") || "");
  const wrap = document.createElement("div");
  wrap.className = "admin-modal";
  wrap.id = "staffModal";
  wrap.innerHTML = `
    <div class="admin-modal-card">
      <h3>${id ? "編輯店員" : "新增店員"}</h3>
      <label>玩家 ID（例：小克瑞爾）<input id="sfName" value="${esc(s.name)}" /></label>
      <label>職務名稱（例：帳簿主）<input id="sfRole" value="${esc(s.role)}" /></label>
      <label>服務項目（例：公會長 · 網站維護）<input id="sfServ" value="${esc(s.services)}" /></label>
      <label>指名費（Gil／每 20 分鐘時段；留空＝採用店內預設指名價）<input id="sfFee" value="${esc(s.fee || "")}" placeholder="例：1500" /></label>
      <label>狀態標籤（顯示在卡片上；例：本日休假、新人見習，留空＝不顯示）
        <input id="sfBadge" list="sfBadgeOpts" value="${esc(s.badge || "")}" placeholder="例：本日休假" />
        <datalist id="sfBadgeOpts">
          <option value="本日休假"></option>
          <option value="新人見習"></option>
          <option value="人氣店員"></option>
        </datalist></label>
      <label class="admin-check"><input id="sfAvail" type="checkbox" ${s.available === false ? "" : "checked"} /> 開放被指名（取消勾選＝顧客無法勾選此店員）</label>
      <label>角色設定・人設（可多行，選填；訪客點「看角色設定」展開）
        <textarea id="sfPersona" rows="4" placeholder="例：白銀鄉小店的帳簿主，總在櫃檯後細數著往來的緣分……">${esc(s.persona || "")}</textarea></label>
      <label>照片（可多張，會在卡片上自動輪播；每張可在下方縮圖填「身分」，輪播到哪張就顯示哪個身分）<input id="sfPhoto" type="file" accept="image/*" multiple /></label>
      <div id="sfThumbs" class="sf-thumbs"></div>
      <label>排序（數字小的排前面）<input id="sfOrder" type="number" value="${Number.isFinite(s.order) ? s.order : (staffCache.length + 1)}" /></label>
      <p class="admin-hint" id="sfMsg"></p>
      <div class="admin-modal-btns">
        <button type="button" id="sfSave" class="admin-btn primary">儲存</button>
        <button type="button" id="sfCancel" class="admin-btn">取消</button>
      </div>
    </div>`;
  document.body.appendChild(wrap);
  const thumbs = document.getElementById("sfThumbs");
  const renderThumbs = () => {
    thumbs.innerHTML = photos.length
      ? photos.map((src, i) => `
          <div class="sf-thumb">
            <img src="${src}" alt="照片 ${i + 1}" />
            <div class="sf-thumb-btns">
              <button type="button" data-mv="${i}" data-dir="-1" title="往前">◀</button>
              <button type="button" data-rm="${i}" title="刪除">✕</button>
              <button type="button" data-mv="${i}" data-dir="1" title="往後">▶</button>
            </div>
            <input type="text" class="sf-cap" data-cap="${i}" maxlength="14" placeholder="身分（選填）" value="${esc(caps[i] || "")}" />
          </div>`).join("")
      : `<p class="admin-hint">目前沒有照片；選檔後會顯示縮圖。第一張為卡片預設封面。</p>`;
  };
  renderThumbs();
  /* ★ 2026-07-14：身分輸入即時寫回 caps（重繪縮圖前先收齊，避免打到一半被洗掉） */
  thumbs.addEventListener("input", (e) => {
    if (e.target.dataset.cap !== undefined) caps[Number(e.target.dataset.cap)] = e.target.value;
  });
  thumbs.addEventListener("click", (e) => {
    const rm = e.target.dataset.rm, mv = e.target.dataset.mv;
    if (rm !== undefined) { photos.splice(Number(rm), 1); caps.splice(Number(rm), 1); renderThumbs(); }
    else if (mv !== undefined) {
      const i = Number(mv), j = i + Number(e.target.dataset.dir);
      if (j >= 0 && j < photos.length) {
        [photos[i], photos[j]] = [photos[j], photos[i]];
        [caps[i], caps[j]] = [caps[j], caps[i]];   /* ★ 2026-07-14：身分跟著照片一起搬 */
        renderThumbs();
      }
    }
  });
  document.getElementById("sfPhoto").onchange = async (e) => {
    const msg = document.getElementById("sfMsg");
    try {
      msg.textContent = "壓縮圖片中…";
      for (const f of Array.from(e.target.files)) { photos.push(await compressImage(f)); caps.push(""); }
      e.target.value = ""; msg.textContent = ""; renderThumbs();
    } catch (err) { msg.textContent = "❌ 圖片處理失敗：" + (err.message || err); }
  };
  wrap.addEventListener("click", (e) => { if (e.target === wrap) closeStaffForm(); });
  document.getElementById("sfCancel").onclick = closeStaffForm;
  document.getElementById("sfSave").onclick = async () => {
    const msg = document.getElementById("sfMsg");
    const btn = document.getElementById("sfSave");
    try {
      btn.disabled = true; msg.textContent = "儲存中…";
      const data = {
        kind:     "staff",
        name:     document.getElementById("sfName").value.trim(),
        role:     document.getElementById("sfRole").value.trim(),
        services: document.getElementById("sfServ").value.trim(),
        fee:      document.getElementById("sfFee").value.trim(),        // ★ 個別指名費
        badge:    document.getElementById("sfBadge").value.trim(),      // ★ 狀態標籤
        available: document.getElementById("sfAvail").checked,          // ★ 可否被指名
        persona:  document.getElementById("sfPersona").value.trim(),   // ★ 人設
        photos:   photos,                                              // ★ 多張照片
        photoCaps: photos.map((_, i) => (caps[i] || "").trim()),       // ★ 2026-07-14：各照片對應身分
        photo:    photos[0] || "",                                     // 相容舊欄位（封面）
        order:    Number(document.getElementById("sfOrder").value) || 0,
      };
      if (!data.name) throw new Error("「玩家 ID」不能空白。");
      if (id) {
        await updateDoc(doc(db, "shopPartners", id), data);
      } else {
        data.createdAt = serverTimestamp();
        await addDoc(collection(db, "shopPartners"), data);
      }
      closeStaffForm();
      loadStaff();
    } catch (e) {
      btn.disabled = false;
      msg.textContent = "❌ " + (e.message || "儲存失敗，請再試一次。");
    }
  };
}
function closeStaffForm() {
  const m = document.getElementById("staffModal");
  if (m) m.remove();
}

/* ---------- 一鍵把內建預設店員寫進 Firestore（★2026-07-11 升級：只補缺漏） ----------
   同名店員資料庫已有的會自動跳過，所以之後預設名單加了新人，
   老師再按一次「⤓ 匯入預設店員」就只會補上新加的，不會出現重複卡片。
   舊版備查（無去重，整批寫入）：
   async function seedDefaultStaff() {
     if (!confirm(staffUsingDefault
       ? "要把內建預設的 8 位店員寫進資料庫嗎？寫入後即可逐張編輯／刪除。"
       : "資料庫已經有店員資料，再匯入會多出重複的 8 張預設卡，確定要繼續嗎？")) return;
     try {
       for (const s of DEFAULT_STAFF) {
         await addDoc(collection(db, "shopPartners"), { kind: "staff", ...s, createdAt: serverTimestamp() });
       }
       alert("✅ 已匯入預設店員名單，現在每張卡都可以編輯或刪除了。");
       loadStaff();
     } catch (e) {
       alert("❌ 匯入失敗：" + (e.message || e));
     }
   }
------------------------------------------------------------------------------ */
async function seedDefaultStaff() {
  staffCache = await removeDuplicatesByName(staffCache, "店員");   /* ★ 2026-07-13 先清重複 */
  const existing = new Set(staffCache.map((x) => x.data.name));   // 資料庫已有的店員名字
  const missing  = DEFAULT_STAFF.filter((s) => !existing.has(s.name));
  if (!missing.length) {
    alert("預設名單裡的店員都已經在資料庫了，不需要匯入。");
    return;
  }
  if (!confirm(`要把還沒入庫的 ${missing.length} 位預設店員（${missing.map((s) => s.name).join("、")}）寫進資料庫嗎？寫入後即可逐張編輯／刪除。`)) return;
  try {
    for (const s of missing) {
      await addDoc(collection(db, "shopPartners"), { kind: "staff", ...s, createdAt: serverTimestamp() });
    }
    alert(`✅ 已匯入 ${missing.length} 位店員。`);
    loadStaff();
  } catch (e) {
    alert("❌ 匯入失敗：" + (e.message || e));
  }
}

/* ============================================================
   16) RP 商店「茶點・餐單」（只在有 #menuList 的頁面執行＝shop.html）
   ------------------------------------------------------------
   - 資料存既有 shopPartners 集合、以 kind:"menu" 標記（不必動規則）
   - ★ 2026-07-12 改版：分兩大類 wafu（和風）／yoshoku（洋食）
     （舊四類 main/dessert/drink/special 已停用；殘留舊分類的餐點會
      集中顯示在「其他」區，管理員按 ✎ 重新分類即可歸位）
   - ★ 新增 tag 欄位（顯示等級與星級，例：Lv.70 ★★★），可留空
   - Firestore 沒資料時先顯示內建預設餐單（DEFAULT_MENU，皆為 FF14
     遊戲內實際料理＋咖啡廳常見飲品）；管理列「⤓ 匯入預設餐單」寫入後
     即可逐張 ✎編輯／✕刪除、線上上傳照片
   - 卡片走 .photo/.photo-frame 結構 → 自動吃 main.js 第 5 段燈箱（可左右切換）
   ============================================================ */
const menuList  = document.getElementById("menuList");
const menuEmpty = document.getElementById("menuEmpty");

/* ★ 2026-07-12 舊四分類（已停用，保留備查）
const MENU_CATS = [
  { key: "main",    label: "主食" },
  { key: "dessert", label: "甜點" },
  { key: "drink",   label: "飲品" },
  { key: "special", label: "特調" },
];
*/
const MENU_CATS = [
  { key: "wafu",    label: "和風" },
  { key: "yoshoku", label: "洋食" },
];
/* ★ 2026-07-12：大分類之下再細分四小類（sub 欄位；舊資料沒有 sub 會排在小標前、不影響顯示） */
const MENU_SUBCATS = [
  { key: "starter", label: "前菜" },
  { key: "main",    label: "主餐" },
  { key: "dessert", label: "甜點" },
  { key: "drink",   label: "飲料" },
];
const SUB_KEYS = new Set(MENU_SUBCATS.map((s) => s.key));

/* ★ 2026-07-12 舊預設餐單（已停用，保留備查）
const DEFAULT_MENU = [
  { cat: "main",    name: "鮭魚飯糰",       desc: "包入鹽漬鮭魚的和風飯糰，樸實暖心。",             price: "", order: 1 },
  { cat: "main",    name: "狐狸烏龍麵",     desc: "甜煮油豆皮鋪在熱湯烏龍上，一口暖到心底。",       price: "", order: 2 },
  { cat: "main",    name: "什錦握壽司",     desc: "當令海鮮握成一貫貫，師傅手作誠意滿滿。",         price: "", order: 3 },
  { cat: "main",    name: "天婦羅蓋飯",     desc: "酥炸時蔬與海老鋪飯，淋上特製丼汁。",             price: "", order: 4 },
  { cat: "dessert", name: "蜜糖吐司",       desc: "外酥內軟的厚片，佐蜂蜜與鮮奶油。",               price: "", order: 5 },
  { cat: "dessert", name: "抹茶大福",       desc: "軟糯麻糬裹著濃郁抹茶餡，回甘不膩。",             price: "", order: 6 },
  { cat: "dessert", name: "銅鑼燒",         desc: "鬆軟餅皮夾入紅豆餡的經典和菓子。",               price: "", order: 7 },
  { cat: "drink",   name: "拿鐵咖啡",       desc: "濃縮咖啡與綿密奶泡，畫上一葉拉花。",             price: "", order: 8 },
  { cat: "drink",   name: "季節紅茶",       desc: "選用當季茶葉，冷熱皆宜。",                       price: "", order: 9 },
  { cat: "drink",   name: "鮮榨果汁",       desc: "當日新鮮水果現榨，酸甜清爽。",                   price: "", order: 10 },
  { cat: "special", name: "櫻花氣泡飲",     desc: "鹽漬櫻花漂浮於氣泡之中，粉嫩浪漫。",             price: "", order: 11 },
  { cat: "special", name: "友人帳特調",     desc: "本店原創——以緣分為名的一杯，滋味由你來訪時揭曉。", price: "", order: 12 },
];
*/
/* ★ 2026-07-12 新版預設餐單（FF14 遊戲內實際料理／飲品，共 31 道）
   - 縮圖已裁自遊戲截圖，存 images/menu/*.webp（英數檔名）
   - tag＝遊戲內等級與星級；price 留空＝顯示「價目待公告」風格（不標價）
   - 老師可線上按 ✎ 換更漂亮的實拍照片、改分類、補價格
   ★ 2026-07-14：每道介紹尾端補上「推薦給…的你。」一句（原介紹全文保留為前段，
     未刪任何舊文；前台會把這句獨立成朱紅小字第二行）。已入庫的餐點按管理列
     「⤓ 匯入預設餐單」即可自動同步——只更新「介紹仍是舊版預設」的餐點，
     老師自己改寫過的介紹一律不動 */
const DEFAULT_MENU = [
  /* —— 和風 —— */
  { cat: "wafu",    name: "章魚燒", sub: "starter",         tag: "Lv.70 ★★★",  desc: "鐵板上滾出焦香圓球，柴魚花在熱氣裡輕輕起舞。推薦給想念祭典喧鬧的你。",     price: "3,600 Gil", photo: "images/menu/takoyaki.webp",             order: 1 },
  { cat: "wafu",    name: "什錦壽司卷", sub: "main",     tag: "Lv.70 ★★★",  desc: "什錦餡料捲進醋飯與海苔，一刀切開便是繽紛。推薦給喜歡驚喜藏在切面裡的你。",       price: "5,400 Gil", photo: "images/menu/sushi-roll.webp",           order: 2 },
  { cat: "wafu",    name: "關東煮", sub: "main",         tag: "Lv.70 ★★★",  desc: "昆布高湯慢燉入味，寒夜裡最溫柔的一鍋。推薦給奔波一日、想被慢慢暖回來的你。",           price: "4,500 Gil", photo: "images/menu/oden.webp",                 order: 3 },
  { cat: "wafu",    name: "茶碗蒸", sub: "starter",         tag: "Lv.70 ★★",   desc: "滑嫩蒸蛋藏著海味珍饈，入口即化的溫潤。推薦給胃口小巧、偏愛細膩滋味的你。",           price: "2,400 Gil", photo: "images/menu/chawanmushi.webp",          order: 4 },
  { cat: "wafu",    name: "草原奶茶", sub: "drink",       tag: "Lv.70 ★★",   desc: "草原游牧風味的鹹香奶茶，醇厚而質樸。推薦給嚮往遠方草原與自由的你。",             price: "2,700 Gil", photo: "images/menu/steppe-milktea.webp",       order: 5 },
  { cat: "wafu",    name: "紅蓮特飲", sub: "drink",       tag: "Lv.70 ★★★",  desc: "如紅蓮燃燒般的豔色特調，入喉一瞬暖意升騰。推薦給今天需要一點勇氣的你。",       price: "4,500 Gil", photo: "images/menu/guren-drink.webp",          order: 6 },
  /* —— 洋食・鹹食 —— */
  { cat: "yoshoku", name: "王室鮭魚排", sub: "main",     tag: "Lv.70 ★★",   desc: "嫩煎鮭魚佐宮廷醬汁，名符其實的王室待遇。推薦給想好好犒賞自己一頓的你。",         price: "14,400 Gil", photo: "images/menu/royal-salmon.webp",         order: 7 },
  { cat: "yoshoku", name: "披薩", sub: "main",           tag: "Lv.80 ★★★★", desc: "窯烤餅皮鋪滿熔岩般的起司，趁熱拉絲最迷人。推薦給喜歡與朋友分食同樂的你。",       price: "9,600 Gil", photo: "images/menu/pizza.webp",                order: 8 },
  { cat: "yoshoku", name: "奶油雞肉寬麵", sub: "main",   tag: "Lv.80 ★★★★", desc: "寬扁麵條裹上濃郁奶油白醬，雞肉香嫩多汁。推薦給無法抗拒濃郁奶香的你。",         price: "8,400 Gil", photo: "images/menu/chicken-pasta.webp",        order: 9 },
  { cat: "yoshoku", name: "煙燻雞肉", sub: "main",       tag: "Lv.80 ★★★",  desc: "木香煙燻入骨，外皮金黃、肉質柔嫩。推薦給鍾情炭火與木香的你。",               price: "7,800 Gil", photo: "images/menu/smoked-chicken.webp",       order: 10 },
  { cat: "yoshoku", name: "炸蟹餅", sub: "starter",         tag: "Lv.80 ★★★",  desc: "滿滿蟹肉煎至金黃酥脆，海潮鮮味在齒間迸發。推薦給想先嚐一口大海的你。",       price: "7,500 Gil", photo: "images/menu/crab-cake.webp",            order: 11 },
  { cat: "yoshoku", name: "辣醬炒全蟹", sub: "main",     tag: "Lv.80 ★★★",  desc: "整隻鮮蟹裹上濃烈辣醬，豪邁而過癮的一皿。推薦給嗜辣如命、吃飯講究痛快的你。",         price: "20,400 Gil", photo: "images/menu/chili-crab.webp",           order: 12 },
  { cat: "yoshoku", name: "南瓜濃湯", sub: "starter",       tag: "Lv.90 ★★",   desc: "金黃南瓜熬成綿密濃湯，一匙暖進心底。推薦給怕冷、想從第一口就暖起來的你。",             price: "3,600 Gil", photo: "images/menu/pumpkin-potage.webp",       order: 13 },
  { cat: "yoshoku", name: "鳳梨沙拉", sub: "starter",       tag: "Lv.80 ★★★",  desc: "酸甜鳳梨與鮮蔬相遇，清爽開胃的南國風情。推薦給想以清爽揭開序幕的你。",         price: "4,800 Gil", photo: "images/menu/pineapple-salad.webp",      order: 14 },
  { cat: "yoshoku", name: "蘋果新薯沙拉", sub: "starter",   tag: "Lv.80 ★★★",  desc: "蘋果的脆甜遇上新薯的綿密，樸實卻耐人尋味。推薦給偏愛樸實家常味的你。",       price: "4,500 Gil", photo: "images/menu/apple-potato-salad.webp",   order: 15 },
  /* —— 洋食・甜點 —— */
  { cat: "yoshoku", name: "焦糖烤布蕾", sub: "dessert",     tag: "Lv.60 ★",    desc: "敲開琥珀糖殼，滑嫩布蕾在匙尖顫動。推薦給享受敲碎糖殼那一瞬的你。",               price: "3,600 Gil", photo: "images/menu/creme-brulee.webp",         order: 16 },
  { cat: "yoshoku", name: "生日蛋糕", sub: "dessert",       tag: "Lv.60 ★",    desc: "插上蠟燭便是慶典——為特別的日子預留的一份甜。推薦給想為重要的人慶祝的你。",     price: "26,400 Gil", photo: "images/menu/birthday-cake.webp",        order: 17 },
  { cat: "yoshoku", name: "蘋果卷", sub: "dessert",         tag: "Lv.60 ★★★",  desc: "酥皮層層裹著肉桂蘋果餡，暖香撲鼻。推薦給著迷肉桂暖香的你。",               price: "3,900 Gil", photo: "images/menu/apple-strudel.webp",        order: 18 },
  { cat: "yoshoku", name: "仙子莓乳酪蛋糕", sub: "dessert", tag: "Lv.80 ★★",   desc: "仙子莓的酸甜點綴濃郁乳酪，夢幻般的粉紅滋味。推薦給少女心從未退役的你。",     price: "4,500 Gil", photo: "images/menu/pixieberry-cheesecake.webp", order: 19 },
  { cat: "yoshoku", name: "檸檬格子鬆餅", sub: "dessert",   tag: "Lv.80 ★★★",  desc: "格紋鬆餅淋上檸檬糖霜，酸甜清新的午後時光。推薦給想在午後偷閒片刻的你。",       price: "4,200 Gil", photo: "images/menu/lemon-waffle.webp",         order: 20 },
  { cat: "yoshoku", name: "蜂蜜牛角麵包", sub: "dessert",   tag: "Lv.80 ★★★",  desc: "千層酥皮刷上金黃蜂蜜，出爐時香氣四溢。推薦給早晨需要一點甜的你。",           price: "2,400 Gil", photo: "images/menu/honey-croissant.webp",      order: 21 },
  { cat: "yoshoku", name: "烏雞布丁", sub: "dessert",       tag: "Lv.80 ★★★",  desc: "烏雞蛋蒸出的絲滑布丁，蛋香濃郁、甜而不膩。推薦給獨鍾古早蛋香的你。",       price: "3,000 Gil", photo: "images/menu/silkie-pudding.webp",       order: 22 },
  { cat: "yoshoku", name: "軟果糕", sub: "dessert",         tag: "Lv.80 ★★★",  desc: "入口即化的果香軟糕，輕盈如雲朵。推薦給飯後只想來一點點甜的你。",                 price: "1,800 Gil", photo: "images/menu/soft-fruit-cake.webp",      order: 23 },
  { cat: "yoshoku", name: "白桃塔", sub: "dessert",         tag: "Lv.90 ★★",   desc: "白桃薄片如花瓣鋪展，果香與塔皮的溫柔協奏。推薦給喜歡細細品味、不急不徐的你。",       price: "4,800 Gil", photo: "images/menu/peach-tart.webp",           order: 24 },
  { cat: "yoshoku", name: "無花果餅乾", sub: "dessert",     tag: "Lv.90 ★★",   desc: "無花果乾烘進酥餅，樸實的甜與茶最相配。推薦給喜歡配茶閒聊的你。",           price: "1,800 Gil", photo: "images/menu/fig-biscuit.webp",          order: 25 },
  /* —— 洋食・飲品 —— */
  { cat: "yoshoku", name: "熱巧克力", sub: "drink",       tag: "Lv.60 ★",    desc: "濃醇可可緩緩升起白霧，捧在手心便是冬日。推薦給今天想被好好安慰的你。",         price: "3,600 Gil", photo: "images/menu/hot-chocolate.webp",        order: 26 },
  { cat: "yoshoku", name: "果香特飲", sub: "drink",       tag: "Lv.60 ★★★",  desc: "數種果實調和的琥珀色特飲，酸甜恰到好處。推薦給選擇困難、什麼果味都想要的你。",         price: "4,200 Gil", photo: "images/menu/fruit-drink.webp",          order: 27 },
  { cat: "yoshoku", name: "仙子莓茶", sub: "drink",       tag: "Lv.80 ★★",   desc: "仙子莓染紅的茶湯，莓果香氣在杯中盤旋。推薦給偏愛莓果微酸的你。",           price: "3,900 Gil", photo: "images/menu/pixieberry-tea.webp",       order: 28 },
  { cat: "yoshoku", name: "黃金鳳梨汁", sub: "drink",     tag: "Lv.80 ★★★",  desc: "現榨黃金鳳梨，陽光般燦爛的酸甜。推薦給需要補充陽光的你。",                 price: "4,500 Gil", photo: "images/menu/pineapple-juice.webp",      order: 29 },
  { cat: "yoshoku", name: "白桃汁", sub: "drink",         tag: "Lv.90 ★★",   desc: "熟成白桃現榨成汁，溫柔的粉色甜香。推薦給不嗜咖啡、只愛果香的你。",               price: "4,500 Gil", photo: "images/menu/peach-juice.webp",          order: 30 },
  { cat: "yoshoku", name: "薩維奈奶茶", sub: "drink",     tag: "Lv.90 ★★",   desc: "南國香料燉煮的奶茶，異域風情繚繞舌尖。推薦給著迷異國香料的你。",           price: "3,600 Gil", photo: "images/menu/thavnairian-chai.webp",     order: 31 },
/* ★ 2026-07-12 追加五道（sub＝小分類） */
  { cat: "yoshoku", name: "鮮奶油咖啡",     sub: "drink",   tag: "Lv.78",       desc: "濃縮咖啡頂上一朵鮮奶油雲，苦甜在杯中交融。推薦給熬夜趕路、需要一杯提神的你。",       price: "3,900 Gil", photo: "images/menu/cream-coffee.webp",   order: 32 },
  { cat: "wafu",    name: "抹茶",           sub: "drink",   tag: "Lv.70 ★★★",  desc: "茶筅刷出翡翠色的細沫，一碗靜心的東方風雅。推薦給想沉澱心緒、靜坐片刻的你。",       price: "4,500 Gil", photo: "images/menu/matcha.webp",         order: 33 },
  { cat: "yoshoku", name: "近東蝦咖哩",     sub: "main",    tag: "Lv.90 ★★★",  desc: "近東香料燉出濃郁咖哩，鮮蝦飽滿、辛香繚繞。推薦給循著香料去旅行的你。",       price: "11,400 Gil", photo: "images/menu/prawn-curry.webp",    order: 34 },
  { cat: "yoshoku", name: "高級烤牛肉",     sub: "main",    tag: "Lv.80 ★★",   desc: "低溫慢烤鎖住肉汁，切面粉嫩如玫瑰綻放。推薦給無肉不歡、講究火候的你。",           price: "17,400 Gil", photo: "images/menu/roast-beef.webp",     order: 35 },
  { cat: "yoshoku", name: "賢人漢堡",       sub: "main",    tag: "Lv.90 ★★",   desc: "賢人也點頭的豪華層疊——多汁肉排與融化起司的智慧。推薦給豪邁大口、不拘小節的你。", price: "9,600 Gil", photo: "images/menu/archon-burger.webp",  order: 36 },
];

let menuCache = [];
let menuUsingDefault = true;
/* ★ 2026-07-12：大分類／小分類標題可由管理員改名，覆寫存 siteContent/config-menulabels
   （鍵＝wafu/yoshoku/starter/main/dessert/drink；沒有覆寫就用程式內建名稱） */
let MENU_LABELS = {};
const labelOf = (key, fallback) => MENU_LABELS[key] || fallback;

async function loadMenu() {
  if (!menuList) return;
  try {
    const ls = await getDoc(doc(db, "siteContent", "config-menulabels"));
    MENU_LABELS = ls.exists() ? (ls.data() || {}) : {};
  } catch (e) { MENU_LABELS = {}; }
  try {
    /* 舊查詢（需要 Firestore 複合索引，未建索引會整個失敗→永遠顯示內建預設、無法編輯。2026-07-13 修正）：
       const q = query(collection(db, "shopPartners"), orderBy("order"), orderBy("createdAt")); */
    const q = collection(db, "shopPartners");
    const snap = await getDocs(q);
    menuCache = snap.docs
      .map((d) => ({ id: d.id, data: d.data() }))
      .filter((x) => x.data.kind === "menu");
    menuCache.sort((a, b) => (a.data.order || 0) - (b.data.order || 0));   /* ★ 2026-07-13 客戶端排序 */
  } catch (e) {
    console.warn("讀取餐單失敗：", e);
    menuCache = [];
  }
  menuUsingDefault = menuCache.length === 0;
  renderMenu();
}

/* ★ 2026-07-12：管理員點分類標題即可改名（存 siteContent/config-menulabels；
   輸入空白＝清除覆寫、回到內建名稱） */
function attachLabelRename(el, key, fallback) {
  if (!el) return;
  el.classList.add("edit-able");
  el.title = "點一下修改分類名稱";
  el.style.cursor = "pointer";
  el.onclick = async () => {
    const cur = labelOf(key, fallback);
    const v = prompt(`分類名稱（留空＝回復內建「${fallback}」）`, cur);
    if (v === null) return;
    try {
      const ref = doc(db, "siteContent", "config-menulabels");
      if (v.trim()) await setDoc(ref, { [key]: v.trim() }, { merge: true });
      else await setDoc(ref, { [key]: deleteField() }, { merge: true });
      loadMenu();
    } catch (e) { alert("❌ 更名失敗：" + (e.message || e)); }
  };
}

function renderMenu() {
  if (!menuList) return;
  /* ★ 2026-07-12：保險絲——若容器還掛著 reveal（舊版 HTML 或快取），渲染後直接補 .in，
     避免「動態長高的清單達不到 IntersectionObserver 15% 門檻→整塊隱形」的間歇性消失 */
  menuList.classList.add("in");
  menuList.innerHTML = "";
  /* ★ 2026-07-14：新增 hidden 欄位——hidden=true 的餐點訪客看不到；
     管理員仍看得到（卡片半透明＋「已隱藏」標示），可隨時一鍵再開
     舊寫法備查：const rows = menuUsingDefault ? DEFAULT_MENU.map(...) : menuCache; */
  const allRows = menuUsingDefault
    ? DEFAULT_MENU.map((d) => ({ id: null, data: d }))
    : menuCache;
  const rows = isAdmin ? allRows : allRows.filter((r) => r.data.hidden !== true);
  if (menuEmpty) menuEmpty.style.display = rows.length ? "none" : "";

  // 依分類分組，照 MENU_CATS 順序輸出（空分類略過）
  // ★ 2026-07-12：改為和風／洋食兩大類；殘留舊分類（main/dessert/drink/special
  //   或缺 cat）的餐點集中到最後的「其他」區，避免改版後憑空消失
  const knownCats = new Set(MENU_CATS.map((c) => c.key));
  const groups = [
    ...MENU_CATS,
    { key: "__other", label: isAdmin ? "其他（請按 ✎ 重新分類為和風或洋食）" : "其他" },
  ];
  for (const cat of groups) {
    const items = cat.key === "__other"
      ? rows.filter((r) => !knownCats.has(r.data.cat || ""))
      : rows.filter((r) => (r.data.cat || "") === cat.key);
    if (!items.length) continue;
    const group = document.createElement("div");
    group.className = "menu-group";
    group.innerHTML = `<h3 class="menu-cat">${esc(cat.key === "__other" ? cat.label : labelOf(cat.key, cat.label))}</h3>`;
    if (isAdmin && cat.key !== "__other") attachLabelRename(group.querySelector(".menu-cat"), cat.key, cat.label);
    /* ★ 2026-07-12：大分類之下再依 sub 細分（前菜/主餐/甜點/飲料）；
       沒有 sub 的舊資料排在最前面、不加小標，不會憑空消失
       舊版（單層 .menu-grid，備查）：
       const grid = document.createElement("div"); grid.className = "menu-grid";
       for (const { id, data: m } of items) { …卡片… } group.appendChild(grid); */
    const subGroups = [{ key: "__nosub", label: "" }, ...MENU_SUBCATS];
    for (const sub of subGroups) {
      const subItems = sub.key === "__nosub"
        ? items.filter((r) => !SUB_KEYS.has(r.data.sub || ""))
        : items.filter((r) => (r.data.sub || "") === sub.key);
      if (!subItems.length) continue;
      if (sub.label) {
        const sh = document.createElement("h4");
        sh.className = "menu-subcat";
        sh.textContent = labelOf(sub.key, sub.label);
        if (isAdmin) attachLabelRename(sh, sub.key, sub.label);
        group.appendChild(sh);
      }
      const grid = document.createElement("div");
      grid.className = "menu-grid";
      for (const { id, data: m } of subItems) {
      const card = document.createElement("article");
      card.className = "menu-card photo";   // 帶 .photo → 吃相簿燈箱
      if (m.hidden === true) card.classList.add("is-hidden");   /* ★ 2026-07-14：管理員視角的隱藏標示 */
      /* ★ 2026-07-14 v6：照片包進 .menu-photo-col（−/＋ 點餐鍵掛在圖下方）；
         角標顯示章＝訪客限定（管理員改看圖上的 🔥/⛔ 懸浮開關，亮＝套用中，避免重疊） */
      const cornerHtml = (!isAdmin && m.corner)
        ? `<span class="menu-corner ${m.corner === "缺貨中" ? "is-out" : "is-hot"}">${esc(m.corner)}</span>` : "";
      const pic = m.photo
        ? `<div class="photo-frame">${cornerHtml}<img src="${m.photo}" alt="${esc(m.name)}" loading="lazy" /></div>`
        : `<div class="photo-frame menu-noimg">${cornerHtml}<span>膳</span></div>`;
      /* ★ 2026-07-12：價格顯示升級——
         訪客：有標價才顯示；管理員：一律顯示（未標價時顯示「＋標價」），
         點價格即可直接輸入更新（毋須開整張編輯表單） */
      const priceHtml = m.price
        ? `<span class="menu-price${isAdmin ? " menu-price-edit" : ""}" title="${isAdmin ? "點一下修改價格" : ""}">${esc(m.price)}</span>`
        : (isAdmin ? `<span class="menu-price menu-price-edit is-empty" title="點一下標價">＋標價</span>` : "");
      /* ★ 2026-07-14：介紹裡的「推薦給…的你」獨立成第二行小字（.menu-reco，樣式在 style.css 檔尾）；
         沒有這句的介紹照舊整段顯示，不受影響 */
      const descHtml = (() => {
        const d = esc(m.desc || "");
        const i = d.indexOf("推薦給");
        return i > -1 ? d.slice(0, i) + `<span class="menu-reco">` + d.slice(i) + `</span>` : d;
      })();
      card.innerHTML = `
        <div class="menu-photo-col">${pic}</div>
        <div class="menu-body">
          <div class="menu-head">
            <span class="menu-name">${esc(m.name)}</span>
            ${priceHtml}
          </div>
          ${""/* ★ 2026-07-14 v6：依老師指定移除等級星級列；舊寫法備查：
               ${m.tag ? `<div class="menu-tag">...</div>` : ""} （tag 欄位資料仍保留在資料庫） */}
          <p class="menu-desc">${descHtml}</p>
          ${m.badge ? `<div class="menu-badge${m.badge === "已售完" ? " is-soldout" : ""}">${esc(m.badge)}</div>` : ""}
          ${isAdmin && m.hidden === true ? `<div class="menu-hidden-tag">🙈 已隱藏（訪客看不到）</div>` : ""}
        </div>`;
      // 燈箱抓圖說用：.photo 內放一個隱藏的 .cap
      // ★ 2026-07-12：style.css 的 .photo .cap 會蓋過 hidden 屬性，導致卡片下方
      //   重複顯示餐點名稱 → 改用行內樣式強制隱藏（燈箱仍讀得到文字）；
      //   下方可見的標籤改由 menu-badge（狀態標籤：活動限定／已售完／主廚推薦／自訂）呈現
      const cap = document.createElement("span");
      cap.className = "cap"; cap.hidden = true;
      cap.style.display = "none";
      cap.textContent = m.price ? `${m.name} · ${m.price}` : m.name;
      card.appendChild(cap);
      if (isAdmin) {
        /* ★ 2026-07-12：點價格直接改價（存回 Firestore；預設餐單提示先匯入） */
        const pe = card.querySelector(".menu-price-edit");
        if (pe) pe.onclick = async (ev) => {
          ev.stopPropagation();
          if (!id) { alert("目前顯示的是內建預設餐單。請先按管理列「⤓ 匯入預設餐單」寫進資料庫，才能標價。"); return; }
          const v = prompt(`「${m.name}」的價格（例：500 Gil；留空＝不標價）`, m.price || "");
          if (v === null) return;
          try {
            await updateDoc(doc(db, "shopPartners", id), { price: v.trim() });
            loadMenu();
          } catch (e) { alert("❌ 價格更新失敗：" + (e.message || e)); }
        };
      }
      if (isAdmin && id) {
        /* ★ 2026-07-14 v6：圖片角標快速開關改懸浮在圖片左上角（點亮＝套用、再點＝取消；兩者互斥） */
        const tagBar = document.createElement("div");
        tagBar.className = "menu-corner-admin";
        tagBar.innerHTML = `<button type="button" data-c="熱銷中" class="${m.corner === "熱銷中" ? "on" : ""}">🔥 熱銷中</button>
                            <button type="button" data-c="缺貨中" class="${m.corner === "缺貨中" ? "on" : ""}">⛔ 缺貨中</button>`;
        tagBar.querySelectorAll("button").forEach((b) => b.onclick = async (ev) => {
          ev.stopPropagation();
          try {
            await updateDoc(doc(db, "shopPartners", id), { corner: m.corner === b.dataset.c ? "" : b.dataset.c });
            loadMenu();
          } catch (e) { alert("❌ 角標切換失敗：" + (e.message || e)); }
        });
        card.querySelector(".photo-frame")?.appendChild(tagBar);
        const bar = document.createElement("div");
        bar.className = "admin-actions";
        /* ★ 2026-07-14：加入「隱藏／顯示」一鍵開關（寫 hidden 欄位）
           舊寫法備查：bar.innerHTML = `✎ 編輯 ✕ 刪除` 兩鈕 */
        bar.innerHTML = `<button type="button" data-act="edit">✎ 編輯</button>
                         <button type="button" data-act="hide">${m.hidden === true ? "👁 顯示" : "🙈 隱藏"}</button>
                         <button type="button" data-act="del">✕ 刪除</button>`;
        bar.querySelector('[data-act="edit"]').onclick = () => openMenuForm(id, m);
        bar.querySelector('[data-act="hide"]').onclick = async () => {
          try {
            await updateDoc(doc(db, "shopPartners", id), { hidden: m.hidden !== true });
            loadMenu();
          } catch (e) { alert("❌ 隱藏／顯示切換失敗：" + (e.message || e)); }
        };
        bar.querySelector('[data-act="del"]').onclick = async () => {
          if (!confirm(`確定要刪除餐點「${m.name}」嗎？（無法復原）`)) return;
          await deleteDoc(doc(db, "shopPartners", id));
          loadMenu();
        };
        card.appendChild(bar);
      }
      grid.appendChild(card);
      }
      group.appendChild(grid);
    }   /* ← ★ 2026-07-12：sub 細分迴圈結束 */
    menuList.appendChild(group);
  }

  if (isAdmin && menuUsingDefault && rows.length) {
    const hint = document.createElement("p");
    hint.className = "staff-default-hint";
    hint.textContent = "目前顯示內建預設餐單；按管理列「⤓ 匯入預設餐單」寫入資料庫後，才能逐張編輯／刪除、上傳照片。";
    menuList.appendChild(hint);
  }
  /* ★ 2026-07-12：通知點餐模組（第 17 段）在每張餐點卡補上「−／＋」數量鈕 */
  if (window.YJC_ORDER) window.YJC_ORDER.decorateMenu();
}
renderMenu();   // 先立刻畫出內建預設
loadMenu();     // 再讀 Firestore

/* ---------- 新增／編輯餐點表單 ---------- */
function openMenuForm(id = null, m = {}) {
  closeMenuForm();
  const wrap = document.createElement("div");
  wrap.className = "admin-modal";
  wrap.id = "menuModal";
  const catOpts = MENU_CATS.map((c) =>
    `<option value="${c.key}"${(m.cat || "main") === c.key ? " selected" : ""}>${c.label}</option>`).join("");
  wrap.innerHTML = `
    <div class="admin-modal-card">
      <h3>${id ? "編輯餐點" : "新增餐點"}</h3>
      <label>分類<select id="mfCat">${catOpts}</select></label>
      <label>小分類（前菜／主餐／甜點／飲料）<select id="mfSub">${MENU_SUBCATS.map((c) =>
        `<option value="${c.key}"${(m.sub || "main") === c.key ? " selected" : ""}>${c.label}</option>`).join("")}</select></label>
      <label>品名（例：章魚燒）<input id="mfName" value="${esc(m.name)}" /></label>
      <label>等級星級（可留空；例：Lv.70 ★★★）<input id="mfTag" value="${esc(m.tag || "")}" /></label>
      <label>狀態標籤（顯示在簡介下方；可從清單選或自行輸入，留空＝不顯示）
        <input id="mfBadge" list="mfBadgeOpts" value="${esc(m.badge || "")}" placeholder="例：主廚推薦" />
        <datalist id="mfBadgeOpts">
          <option value="活動限定"></option>
          <option value="已售完"></option>
          <option value="主廚推薦"></option>
        </datalist></label>
      <label>簡介（一兩句話介紹）
        <textarea id="mfDesc" rows="3" placeholder="例：甜煮油豆皮鋪在熱湯烏龍上，一口暖到心底。">${esc(m.desc || "")}</textarea></label>
      <label>價格（可留空＝暫不標價；例：8,000 Gil）<input id="mfPrice" value="${esc(m.price || "")}" /></label>
      <label class="admin-check"><input id="mfHidden" type="checkbox"${m.hidden === true ? " checked" : ""} /> 暫時隱藏此餐點（訪客看不到，可隨時再開）</label>
      <label>照片（可不選＝維持不變／無照片）<input id="mfPhoto" type="file" accept="image/*" /></label>
      <label>排序（數字小的排前面）<input id="mfOrder" type="number" value="${Number.isFinite(m.order) ? m.order : (menuCache.length + 1)}" /></label>
      <p class="admin-hint" id="mfMsg"></p>
      <div class="admin-modal-btns">
        <button type="button" id="mfSave" class="admin-btn primary">儲存</button>
        <button type="button" id="mfCancel" class="admin-btn">取消</button>
      </div>
    </div>`;
  document.body.appendChild(wrap);
  wrap.addEventListener("click", (e) => { if (e.target === wrap) closeMenuForm(); });
  document.getElementById("mfCancel").onclick = closeMenuForm;
  document.getElementById("mfSave").onclick = async () => {
    const msg = document.getElementById("mfMsg");
    const btn = document.getElementById("mfSave");
    try {
      btn.disabled = true; msg.textContent = "儲存中…";
      const data = {
        kind:  "menu",
        cat:   document.getElementById("mfCat").value,
        sub:   document.getElementById("mfSub").value,
        name:  document.getElementById("mfName").value.trim(),
        tag:   document.getElementById("mfTag").value.trim(),
        badge: document.getElementById("mfBadge").value.trim(),
        desc:  document.getElementById("mfDesc").value.trim(),
        price: document.getElementById("mfPrice").value.trim(),
        hidden: document.getElementById("mfHidden").checked,   /* ★ 2026-07-14：隱藏開關 */
        order: Number(document.getElementById("mfOrder").value) || 0,
      };
      if (!data.name) throw new Error("「品名」不能空白。");
      const file = document.getElementById("mfPhoto").files[0];
      if (file) data.photo = await compressImage(file);
      if (id) {
        await updateDoc(doc(db, "shopPartners", id), data);
      } else {
        data.photo = data.photo || "";
        data.createdAt = serverTimestamp();
        await addDoc(collection(db, "shopPartners"), data);
      }
      closeMenuForm();
      loadMenu();
    } catch (e) {
      btn.disabled = false;
      msg.textContent = "❌ " + (e.message || "儲存失敗，請再試一次。");
    }
  };
}
function closeMenuForm() {
  const m = document.getElementById("menuModal");
  if (m) m.remove();
}

/* ---------- 一鍵匯入預設餐單（只補缺漏，以品名去重） ----------
   ★ 2026-07-12：改版換餐單後，若資料庫裡還有「不在新預設名單內」的舊餐點，
   會先詢問要不要一併刪除（確定＝整份換新；取消＝保留舊的、只補缺漏） */
/* ============================================================
   ★ 2026-07-13：重複資料清理（共用工具）
   ------------------------------------------------------------
   起因：先前資料庫「讀取」壞掉（複合索引問題）期間，每按一次「⤓ 匯入」
   程式都誤判資料庫是空的、把整份預設再寫一次 → 同名資料疊了好幾份。
   本工具在三個匯入按鈕開頭執行：同名（同 kind）只留一筆，優先保留
   「內容最豐富」的那筆（自訂照片 > 有標價/人設 > 先到），其餘詢問後刪除。
   ============================================================ */
async function removeDuplicatesByName(cache, label) {
  const byName = new Map();
  const extras = [];
  const scoreOf = (y) =>
    (((y.data.photo || "").startsWith("data:") || (y.data.photos || []).some((p) => String(p).startsWith("data:"))) ? 4 : 0) +
    (y.data.price ? 2 : 0) + (y.data.persona ? 1 : 0) + (y.data.badge ? 1 : 0);
  for (const x of cache) {
    const n = x.data.name;
    if (!n) { extras.push(x); continue; }          // 連名字都沒有的空資料一併清
    const kept = byName.get(n);
    if (!kept) { byName.set(n, x); continue; }
    if (scoreOf(x) > scoreOf(kept)) { extras.push(kept); byName.set(n, x); }
    else extras.push(x);
  }
  if (!extras.length) return cache;
  if (!confirm(`偵測到 ${extras.length} 筆重複的${label}（先前匯入按鈕誤重複寫入所致）。\n\n按「確定」＝自動清除重複、每種只保留一筆（優先保留有自訂照片或標價的那筆）。`)) {
    return cache;
  }
  try {
    for (const x of extras) await deleteDoc(doc(db, "shopPartners", x.id));
    alert(`✔ 已清除 ${extras.length} 筆重複${label}。`);
  } catch (e) { alert("❌ 清除重複失敗：" + (e.message || e)); }
  return Array.from(byName.values());
}

async function seedDefaultMenu() {
  menuCache = await removeDuplicatesByName(menuCache, "餐點");   /* ★ 2026-07-13 先清重複 */
  const defaultNames = new Set(DEFAULT_MENU.map((m) => m.name));
  const stale = menuCache.filter((x) => !defaultNames.has(x.data.name));
  if (stale.length) {
    if (confirm(`資料庫裡有 ${stale.length} 道不在新版餐單內的舊餐點（例如「${stale[0].data.name}」）。\n\n按「確定」＝刪除這些舊餐點、換成全新餐單；\n按「取消」＝保留舊餐點，只補匯入新的品項。`)) {
      try {
        for (const x of stale) await deleteDoc(doc(db, "shopPartners", x.id));
        menuCache = menuCache.filter((x) => defaultNames.has(x.data.name));
      } catch (e) { alert("❌ 刪除舊餐點失敗：" + (e.message || e)); return; }
    }
  }
  const existing = new Set(menuCache.map((x) => x.data.name));
  /* ★ 2026-07-12：分類細分後，替「已在資料庫、但還沒有 sub 小分類」的同名餐點
     自動補上預設的 cat/sub（不動老師改過的其他欄位） */
  try {
    for (const x of menuCache) {
      const d = DEFAULT_MENU.find((m) => m.name === x.data.name);
      const patch = {};
      if (d && !SUB_KEYS.has(x.data.sub || "")) { patch.cat = d.cat; patch.sub = d.sub; }
      if (d && d.price && !x.data.price) patch.price = d.price;   /* ★ 2026-07-13：只補空價，不動老師改過的 */
      /* ★ 2026-07-14：介紹補「推薦給…的你」——只在資料庫裡的介紹仍是舊版預設
         （＝新介紹的開頭前段）時更新；老師自己改寫過的介紹一律不動 */
      if (d && d.desc && x.data.desc && x.data.desc !== d.desc && d.desc.startsWith(x.data.desc)) patch.desc = d.desc;
      if (d && Object.keys(patch).length) {
        await updateDoc(doc(db, "shopPartners", x.id), patch);
      }
    }
  } catch (e) { console.warn("同步小分類失敗：", e); }
  const missing  = DEFAULT_MENU.filter((m) => !existing.has(m.name));
  if (!missing.length) { alert("預設餐單裡的餐點都已經在資料庫了，不需要匯入。"); loadMenu(); return; }
  if (!confirm(`要把還沒入庫的 ${missing.length} 道餐點寫進資料庫嗎？寫入後即可逐張編輯／刪除、上傳照片。`)) { loadMenu(); return; }
  try {
    for (const m of missing) {
      await addDoc(collection(db, "shopPartners"), { kind: "menu", ...m, createdAt: serverTimestamp() });
    }
    alert(`✅ 已匯入 ${missing.length} 道餐點。`);
    loadMenu();
  } catch (e) {
    alert("❌ 匯入失敗：" + (e.message || e));
  }
}

/* ============================================================
   17) ★ 2026-07-12：包廂・雅座（kind:"room"；只在有 #roomList 的頁面＝shop.html）
   ------------------------------------------------------------
   - 沿用 shopPartners 集合，kind:"room"（不必動規則）
   - 卡片走 .photo/.photo-frame 結構 → 自動吃 main.js 第 5 段燈箱（左右切換範圍＝.room-grid）
   - 管理員可 ✎ 編輯名稱/介紹/容納人數/包廂費/狀態標籤/是否開放勾選、✕ 刪除、＋新增
   - 勾選（預約用 radio）由第 18 段點餐模組負責
   ============================================================ */
const roomList  = document.getElementById("roomList");
const roomEmpty = document.getElementById("roomEmpty");

const DEFAULT_ROOMS = [
  { name: "雨幕咖啡廳雅座",   cap: 5,   /* ★ 2026-07-13 依老師線上調整 3→5 */ desc: "窗外雨絲垂落花影，暖燈下一席茶座——雨聲是最好的伴談。",         price: "", available: true, badge: "", photo: "images/rooms/rain-cafe.webp",      order: 1 },
  { name: "咖啡廳吧檯雅座",   cap: 2, desc: "彩繪玻璃與香草吊燈下的吧檯座，看店員在眼前調理一杯緣分。",     price: "", available: true, badge: "", photo: "images/rooms/cafe-counter.webp",   order: 2 },
  { name: "和風別墅",         cap: 2, desc: "圍爐燒水、竹影搖曳，褟褟米上的私語時光。",                     price: "", available: true, badge: "", photo: "images/rooms/wafu-villa.webp",     order: 3 },
  { name: "知識天井澡堂",     cap: 2, desc: "天光自玻璃頂灑落，書香與湯煙共蒸騰的祕湯書齋。",               price: "", available: true, badge: "", photo: "images/rooms/skylight-bath.webp",  order: 4 },
  /* ★ 2026-07-12 深夜：中央舞台由貴賓席改為開放區域（免費、供公會成員掛網、座位不保證）
     舊值備查：{ name:"中央舞台貴賓席", cap:3, desc:"紅幕與薔薇簇擁的最佳視野，把整間店的燈火盡收眼底。", price:"" } */
  /* ★ 2026-07-13：中央舞台區已不再作包廂使用，定位＝開放區域（未指定包廂者的預設入席處）
     舊值備查：desc="紅幕與薔薇簇擁的中央舞台，開放給公會成員自由歇腳掛網——不收分文，但座位有限、先到先得。" */
  { name: "中央舞台區",       cap: 6,   /* ★ 2026-07-13 依老師線上調整 4→6 */ desc: "已不作包廂使用——紅幕與薔薇簇擁的中央舞台，開放公會成員掛網休憩；未指定包廂的客人也可在此與店員互動、觀賞台上演出。座位有限、先到先得。", price: "免費", available: true, badge: "開放區域", photo: "images/rooms/stage-vip.webp",      order: 0 },   /* ★ 2026-07-13：排序改 0＝清單第一（原 5） */
  { name: "夢幻花叢",         cap: 1, desc: "白花如雪、彩鯉悠游，吊椅輕晃的一人份夢境。",                   price: "", available: true, badge: "", photo: "images/rooms/dream-garden.webp",   order: 6 },
  { name: "金碧輝煌主沙發",   cap: 1, desc: "金磚與典籍環繞的豪奢一隅，貓咪掌櫃偶爾同席。",                 price: "", available: true, badge: "", photo: "images/rooms/golden-lounge.webp",  order: 7 },
  { name: "祕密的閱讀小空間", cap: 1, desc: "書塔林立、光束斜落——只有你與故事知道的角落。",                 price: "", available: true, badge: "", photo: "images/rooms/secret-reading.webp", order: 8 },
  { name: "大電視沙發客廳",   cap: 1, desc: "爐火、白沙發與巨幕——窩進來看一部片的距離。",                   price: "", available: true, badge: "", photo: "images/rooms/tv-lounge.webp",      order: 9 },
  { name: "海景大浴室",       cap: 2, desc: "落日沉入海平線，湯煙裊裊的私人觀景湯屋。",                     price: "", available: true, badge: "", photo: "images/rooms/ocean-bath.webp",     order: 10 },
];

let roomCache = [];
let roomUsingDefault = true;

async function loadRooms() {
  if (!roomList) return;
  try {
    /* 舊查詢（orderBy 會排除缺 order 欄位的文件，統一改客戶端排序 2026-07-13）：
       const snap = await getDocs(query(collection(db, "shopPartners"), orderBy("order"))); */
    const snap = await getDocs(collection(db, "shopPartners"));
    roomCache = snap.docs
      .map((d) => ({ id: d.id, data: d.data() }))
      .filter((x) => x.data.kind === "room");
    roomCache.sort((a, b) => (a.data.order || 0) - (b.data.order || 0));   /* ★ 2026-07-13 客戶端排序 */
    roomUsingDefault = roomCache.length === 0;
  } catch (e) {
    console.warn("讀取包廂失敗：", e);
    roomCache = []; roomUsingDefault = true;
  }
  renderRooms();
}

function renderRooms() {
  if (!roomList) return;
  roomList.classList.add("in");   /* 防 reveal 門檻造成隱形（同餐單） */
  roomList.innerHTML = "";
  const rows = roomUsingDefault
    ? DEFAULT_ROOMS.map((d) => ({ id: null, data: d }))
    : roomCache;
  if (roomEmpty) roomEmpty.style.display = rows.length ? "none" : "";
  for (const { id, data: r } of rows) {
    const card = document.createElement("figure");
    card.className = "room-card photo" + (r.available === false ? " is-closed" : "");
    card.dataset.room = r.name;
    const priceHtml = r.price
      ? `<span class="room-price${isAdmin ? " menu-price-edit" : ""}">${esc(r.price)}</span>`
      : (isAdmin ? `<span class="room-price menu-price-edit is-empty">＋標價</span>` : "");
    card.innerHTML = `
      <div class="photo-frame">
        ${r.photo ? `<img src="${r.photo}" alt="${esc(r.name)}" loading="lazy" />` : `<div class="menu-noimg"><span>房</span></div>`}
        ${r.available === false ? `<div class="room-closed-veil">暫停開放</div>` : ""}
      </div>
      <span class="cap" hidden style="display:none">${esc(r.name)}（最多 ${Number(r.cap) || 1} 位）</span>
      <figcaption class="room-body">
        <div class="room-head"><span class="room-name">${esc(r.name)}</span>${priceHtml}</div>
        <p class="room-capline">最多同時容納 ${Number(r.cap) || 1} 位客人</p>
        ${r.badge ? `<div class="menu-badge">${esc(r.badge)}</div>` : ""}
        <p class="room-desc">${esc(r.desc || "")}</p>
        <div class="room-pickslot"></div>
      </figcaption>`;
    if (isAdmin) {
      const pe = card.querySelector(".menu-price-edit");
      if (pe) pe.onclick = async (ev) => {
        ev.stopPropagation();
        if (!id) { alert("目前顯示的是內建預設包廂。請先按管理列「⤓ 匯入預設包廂」寫進資料庫，才能標價。"); return; }
        const v = prompt(`「${r.name}」的包廂費（每次；例：3,000 Gil；留空＝不標價）`, r.price || "");
        if (v === null) return;
        try { await updateDoc(doc(db, "shopPartners", id), { price: v.trim() }); loadRooms(); }
        catch (e) { alert("❌ 價格更新失敗：" + (e.message || e)); }
      };
    }
    if (isAdmin && id) {
      const btns = document.createElement("div");
      btns.className = "staff-admin-btns";
      btns.innerHTML = `<button type="button" class="admin-btn">✎ 編輯</button><button type="button" class="admin-btn danger">✕ 刪除</button>`;
      const [eBtn, dBtn] = btns.querySelectorAll("button");
      eBtn.onclick = () => openRoomForm(id, r);
      dBtn.onclick = async () => {
        if (!confirm(`確定要刪除包廂「${r.name}」嗎？`)) return;
        try { await deleteDoc(doc(db, "shopPartners", id)); loadRooms(); }
        catch (e) { alert("❌ 刪除失敗：" + (e.message || e)); }
      };
      card.querySelector(".room-body").appendChild(btns);
    }
    roomList.appendChild(card);
  }
  if (isAdmin && roomUsingDefault && rows.length) {
    const hint = document.createElement("p");
    hint.className = "staff-default-hint";
    hint.textContent = "目前顯示內建預設包廂；按管理列「⤓ 匯入預設包廂」寫入資料庫後，才能逐間編輯／刪除、設定開放與費用。";
    roomList.appendChild(hint);
  }
  if (window.YJC_ORDER) window.YJC_ORDER.refreshRooms();
}

function closeRoomForm() { document.getElementById("roomModal")?.remove(); }
function openRoomForm(id = null, r = {}) {
  closeRoomForm();
  const wrap = document.createElement("div");
  wrap.className = "admin-modal";
  wrap.id = "roomModal";
  wrap.innerHTML = `
    <div class="admin-modal-card">
      <h3>${id ? "編輯包廂" : "新增包廂"}</h3>
      <label>包廂名稱（例：海景大浴室）<input id="rfName" value="${esc(r.name || "")}" /></label>
      <label>介紹（一兩句話）<textarea id="rfDesc" rows="3">${esc(r.desc || "")}</textarea></label>
      <label>最多同時容納人數<input id="rfCap" type="number" min="1" max="8" value="${Number(r.cap) || 1}" /></label>
      <label>包廂費（每次；可留空＝暫不標價；例：3,000 Gil）<input id="rfPrice" value="${esc(r.price || "")}" /></label>
      <label>狀態標籤（例：整修中、人氣包廂；留空＝不顯示）<input id="rfBadge" value="${esc(r.badge || "")}" /></label>
      <label class="admin-check"><input id="rfAvail" type="checkbox" ${r.available === false ? "" : "checked"} /> 開放被勾選預約（取消勾選＝顯示「暫停開放」）</label>
      <label>照片（可不選＝維持不變）<input id="rfPhoto" type="file" accept="image/*" /></label>
      <label>排序（數字小的排前面）<input id="rfOrder" type="number" value="${Number.isFinite(r.order) ? r.order : (roomCache.length + 1)}" /></label>
      <p class="admin-hint" id="rfMsg"></p>
      <div class="admin-modal-btns">
        <button type="button" id="rfSave" class="admin-btn primary">儲存</button>
        <button type="button" id="rfCancel" class="admin-btn">取消</button>
      </div>
    </div>`;
  document.body.appendChild(wrap);
  wrap.addEventListener("click", (e) => { if (e.target === wrap) closeRoomForm(); });
  document.getElementById("rfCancel").onclick = closeRoomForm;
  document.getElementById("rfSave").onclick = async () => {
    const msg = document.getElementById("rfMsg");
    const btn = document.getElementById("rfSave");
    try {
      btn.disabled = true; msg.textContent = "儲存中…";
      const data = {
        kind:  "room",
        name:  document.getElementById("rfName").value.trim(),
        desc:  document.getElementById("rfDesc").value.trim(),
        cap:   Math.max(1, Number(document.getElementById("rfCap").value) || 1),
        price: document.getElementById("rfPrice").value.trim(),
        badge: document.getElementById("rfBadge").value.trim(),
        available: document.getElementById("rfAvail").checked,
        order: Number(document.getElementById("rfOrder").value) || 0,
      };
      if (!data.name) throw new Error("「包廂名稱」不能空白。");
      const file = document.getElementById("rfPhoto").files[0];
      if (file) data.photo = await compressImage(file);
      if (id) {
        await updateDoc(doc(db, "shopPartners", id), data);
      } else {
        data.photo = data.photo || "";
        data.createdAt = serverTimestamp();
        await addDoc(collection(db, "shopPartners"), data);
      }
      closeRoomForm();
      loadRooms();
    } catch (e) {
      btn.disabled = false;
      msg.textContent = "❌ " + (e.message || "儲存失敗，請再試一次。");
    }
  };
}

/* 一鍵匯入預設包廂（同餐單模式：先問是否清掉不在名單內的舊包廂，再補匯入缺漏） */
async function seedDefaultRooms() {
  roomCache = await removeDuplicatesByName(roomCache, "包廂");   /* ★ 2026-07-13 先清重複 */
  const names = new Set(DEFAULT_ROOMS.map((r) => r.name));
  const stale = roomCache.filter((x) => !names.has(x.data.name));
  if (stale.length && confirm(`資料庫裡有 ${stale.length} 間不在預設名單內的包廂（例如「${stale[0].data.name}」）。\n\n按「確定」＝刪除它們換成預設名單；按「取消」＝保留、只補匯入缺漏。`)) {
    try {
      for (const x of stale) await deleteDoc(doc(db, "shopPartners", x.id));
      roomCache = roomCache.filter((x) => names.has(x.data.name));
    } catch (e) { alert("❌ 刪除失敗：" + (e.message || e)); return; }
  }
  /* ★ 2026-07-13：中央舞台區改制（開放區域＋排第一）——已入庫的舊資料一併同步 */
  try {
    const stage = roomCache.find((x) => x.data.name === "中央舞台區" || x.data.name === "中央舞台貴賓席");
    const d = DEFAULT_ROOMS.find((r) => r.name === "中央舞台區");
    if (stage && d && (stage.data.order !== d.order || stage.data.desc !== d.desc || stage.data.name !== d.name)) {
      await updateDoc(doc(db, "shopPartners", stage.id),
        { name: d.name, desc: d.desc, badge: d.badge, price: d.price, cap: d.cap, order: d.order });
      stage.data = { ...stage.data, name: d.name };
    }
  } catch (e) { console.warn("同步中央舞台區失敗：", e); }
  const existing = new Set(roomCache.map((x) => x.data.name));
  const missing = DEFAULT_ROOMS.filter((r) => !existing.has(r.name));
  if (!missing.length) { alert("預設包廂都已經在資料庫了，不需要匯入。"); loadRooms(); return; }
  if (!confirm(`要把還沒入庫的 ${missing.length} 間包廂寫進資料庫嗎？寫入後即可逐間編輯／設定開放與費用。`)) { loadRooms(); return; }
  try {
    for (const r of missing) {
      await addDoc(collection(db, "shopPartners"), { kind: "room", ...r, createdAt: serverTimestamp() });
    }
    alert(`✔ 已匯入 ${missing.length} 間包廂。`);
    loadRooms();
  } catch (e) { alert("❌ 匯入失敗：" + (e.message || e)); }
}

loadRooms();

/* ============================================================
   18) ★ 2026-07-12 v2：線上預約點餐（原第 17 段 v1 已由本段取代）
   ------------------------------------------------------------
   - 流程：餐點(必選,低消)→店員卡片勾選指名(0~3位)→服務設定→包廂擇一→明細送出
   - 指名與不指名分開計價：
       不指名(隨緣)＝FEE.seat × 時段數（1 位店員）
       指名＝Σ(各店員個別指名費，未設定則用 FEE.named) × 時段數
   - 包廂費＝所選包廂的 price（未標價＝0 併註記）
   - 純前端試算，僅產生明細文字供複製（測試模式，不寫入 Firestore）
   ============================================================ */
(function () {
  const sec = document.getElementById("orderSection");
  if (!sec) return;

  /* ★ 2026-07-12 v2.1：價目改為「RP 輕重計價」，且管理員可線上修正——
     預設值讀 data 屬性，若 siteContent/config-orderfees 有設定則覆寫 */
  const FEE = {
    seat:    Number(sec.dataset.feeSeat)    || 0,   // 不指名（隨緣）／時段
    named:   Number(sec.dataset.feeNamed)   || 0,   // 指名基本／位／時段
    persona: Number(sec.dataset.feePersona) || 0,   // 勾選個性（服務風格）加價／單
    role:    Number(sec.dataset.feeRole)    || 0,   // 勾選職業扮演身分加價／單
    photo:   Number(sec.dataset.feePhoto)   || 0,
    min:     Number(sec.dataset.minOrder)   || 0,
  };
  (async () => {
    try {
      const snap = await getDoc(doc(db, "siteContent", "config-orderfees"));
      if (snap.exists()) {
        const d = snap.data() || {};
        for (const k of ["seat","named","persona","role","photo","min"]) {
          if (Number.isFinite(Number(d[k])) && d[k] !== "" && d[k] !== null && d[k] !== undefined) FEE[k] = Number(d[k]);
        }
        document.querySelectorAll("#staffList .staff-pick").forEach((el) => el.remove());
        refreshStaff();
        writeFeeNote();
        updateTotals();
      }
    } catch (e) { /* 讀不到就用預設 */ }
  })();
  const fmt = (n) => n.toLocaleString("zh-Hant-TW") + " Gil";
  const num = (t) => parseInt(String(t || "").replace(/[^\d]/g, ""), 10) || 0;

  const pickVal = (nm) => document.querySelector(`input[name="${nm}"]:checked`)?.value || "隨緣";

  /* ---------- ★ 2026-07-13 深夜：顧客資訊（伺服器/ID＋同行最多3位） ---------- */
  const coWrap = document.getElementById("custCoWrap");
  const hasCo  = document.getElementById("custHasCo");
  if (hasCo) hasCo.onchange = () => { coWrap.style.display = hasCo.checked ? "" : "none"; syncGuests(); };
  function coRows() {
    return Array.from(document.querySelectorAll("#custCoWrap .cust-co")).map((row) => ({
      server: row.querySelector(".coServer").value.trim(),
      id:     row.querySelector(".coId").value.trim(),
    }));
  }
  function syncGuests() {
    const n = 1 + (hasCo && hasCo.checked ? coRows().filter((r) => r.server && r.id).length : 0);
    const sel = document.getElementById("odGuests");
    if (sel) sel.value = String(Math.min(4, Math.max(1, n)));
    renderGuestRoles();   /* ★ 人數變動 → 顧客甲乙丙丁欄位跟著長 */
    updateTotals();
  }
  document.querySelectorAll("#custCoWrap input").forEach((el) => el.addEventListener("input", syncGuests));

  /* ---------- ★ 2026-07-13 深夜：指名店員 → 逐位顯示排班表登記的可選項 ---------- */
  const GUEST_TAG = ["甲","乙","丙","丁"];
  function splitOpts(t) {
    return String(t || "").split(/[、,，／/;；]+/).map((x) => x.trim()).filter(Boolean);
  }
  /* ★ 2026-07-13：依匯入的週循環班表，判斷店員在「所選日期＋場次」是否有班
     （班表未匯入＝回傳 null 不提示；有匯入才做判斷） */
  function staffOnDuty(name) {
    const s = staffRows().find((x) => x.name === name);
    if (!s || !Array.isArray(s.shifts) || !s.shifts.length) return null;
    const dv = document.getElementById("custDate")?.value;
    const sess = (document.querySelector('input[name="custSession"]:checked')?.value || "").slice(0, 2);
    if (!dv || !sess) return null;
    const w = "日一二三四五六"[new Date(dv + "T00:00:00").getDay()];
    return s.shifts.some((sh) => {
      const [days, s2] = String(sh).split("|");
      return days.includes(w) && sess.startsWith(String(s2).slice(0, 2));
    });
  }
  function dutyWarnings() {
    return Array.from(pickedStaff).filter((n) => staffOnDuty(n) === false);
  }
  /* ★ 2026-07-14：名簿即時出勤標示——客人選好「日期＋場次」後，
     每張店員卡依週循環班表標示：有班＝照片角落綠標「✓ 本場有班」；
     無班＝整張卡轉黑白（.is-offduty）＋照片上醒目朱紅標「本場無班」。
     未匯入班表的店員、或日期／場次未選齊時不標示（staffOnDuty 回 null）。
     維持「不擋單」原則：無班仍可勾選指名，明細照舊寫入 ⚠ 提醒 */
  function refreshDutyBadges() {
    document.querySelectorAll("#staffList .staff-card").forEach((card) => {
      card.classList.remove("is-offduty");
      card.querySelectorAll(".staff-duty-tag").forEach((el) => el.remove());
      const name = card.querySelector("h3")?.textContent?.trim();
      if (!name) return;
      const duty = staffOnDuty(name);
      if (duty === null) return;
      const photo = card.querySelector(".staff-photo");
      if (photo) {
        const tag = document.createElement("span");
        tag.className = "staff-duty-tag " + (duty ? "is-on" : "is-off");
        tag.textContent = duty ? "✓ 本場有班" : "本場無班";
        photo.appendChild(tag);
      }
      if (!duty) card.classList.add("is-offduty");
    });
  }

  function staffProfile(name) {
    const s = staffRows().find((x) => x.name === name) || {};
    return { roles: s.rpRoles || "", gender: s.rpGender || "", styles: s.rpStyles || "" };
  }
  /* ★ 2026-07-13 v3：選擇狀態集中存 prefState（帳單端取消勾選也改這裡 → 雙向同步） */
  const prefState = new Map();   // 店員名 → { role, style }
  function prefOf(name) {
    if (!prefState.has(name)) prefState.set(name, { role: "隨緣", style: "隨緣" });
    return prefState.get(name);
  }
  function renderStaffPrefs() {
    const names = Array.from(pickedStaff);
    /* ★ 2026-07-13 v2：odGlobalPrefs 不再於指名時隱藏——性別／風格欄已移除，
       「店員扮演身分」改為常駐顯示名簿勾選結果（updateRoleShow）。
       舊行為備查：const glob = document.getElementById("odGlobalPrefs");
                   if (glob) glob.style.display = names.length ? "none" : ""; */
    /* 面板直接長在店員名簿卡片上（.staff-pick 下方） */
    document.querySelectorAll("#staffList .staff-pick-prefs").forEach((el) => el.remove());
    names.forEach((n, i) => {
      const card = Array.from(document.querySelectorAll("#staffList .staff-card"))
        .find((c) => c.querySelector("h3")?.textContent?.trim() === n);
      const host = card?.querySelector(".staff-pick");
      if (!host) return;
      const p = staffProfile(n);
      const st = prefOf(n);
      const roleOpts  = p.roles.trim() === "皆可" ? ROLES.filter((r) => r !== "隨緣") : splitOpts(p.roles);
      const styleOpts = p.styles.trim() === "皆可" ? STYLES.filter((r) => r !== "隨緣") : splitOpts(p.styles);
      const chips = (opts, group, cur) => ['<label class="order-chip"><input type="radio" name="' + group + '" value="隨緣"' + (cur === "隨緣" ? " checked" : "") + ' />隨緣</label>']
        .concat(opts.map((o) => `<label class="order-chip"><input type="radio" name="${group}" value="${esc(o)}"${cur === o ? " checked" : ""} />${esc(o)}</label>`)).join("");
      const box = document.createElement("div");
      box.className = "staff-pick-prefs";
      box.innerHTML = `
        ${p.gender ? `<p class="staff-pref-gender">扮演性別呈現：${esc(p.gender)}</p>` : ""}
        <div class="staff-pref-row"><em>身分<small>＋${fmt(FEE.role)}/單</small></em><div class="order-choice-wrap">${
          roleOpts.length ? chips(roleOpts, "odRoleS" + i, st.role)
          : '<span class="order-note">尚未登記可接身分</span>'}</div></div>
        <div class="staff-pref-row"><em>風格<small>＋${fmt(FEE.persona)}/單</small></em><div class="order-choice-wrap">${
          styleOpts.length ? chips(styleOpts, "odStyleS" + i, st.style)
          : '<span class="order-note">尚未登記可接風格</span>'}</div></div>`;
      box.querySelectorAll('input[name="odRoleS' + i + '"]').forEach((el) =>
        el.addEventListener("change", () => { prefOf(n).role = el.value; updateTotals(); }));
      box.querySelectorAll('input[name="odStyleS' + i + '"]').forEach((el) =>
        el.addEventListener("change", () => { prefOf(n).style = el.value; updateTotals(); }));
      host.appendChild(box);
    });
  }
  function collectStaffPrefs() {
    return Array.from(pickedStaff).map((n, i) => {
      const p = staffProfile(n);
      const st = prefOf(n);
      return { name: n, tag: "店員" + "ABC"[i], role: st.role || "隨緣", style: st.style || "隨緣", gender: p.gender };
    });
  }
  /* ★ 2026-07-13 v2：「店員扮演身分」唯讀顯示——即時同步店員名簿卡片勾選結果；
     未指名或未勾選一律顯示「隨緣」（由 updateTotals 帶動，帳單端取消勾選也會同步） */
  function updateRoleShow() {
    const el = document.getElementById("odRoleShow");
    if (!el) return;
    el.textContent = pickedStaff.size
      ? collectStaffPrefs().map((p) => `${p.name}：扮演＝${p.role}／風格＝${p.style}`).join("　・　")
      : "隨緣";
  }
  /* 顧客逐位扮演身分（人數變動時重建、保留已填內容） */
  function renderGuestRoles() {
    const box = document.getElementById("odGuestRoles");
    if (!box) return;
    const n = Number(document.getElementById("odGuests")?.value) || 1;
    const old = Array.from(box.querySelectorAll("input")).map((el) => el.value);
    box.innerHTML = Array.from({ length: n }, (_, i) =>
      `<input type="text" class="od-guest-role" maxlength="30" placeholder="顧客${GUEST_TAG[i]} 的扮演身分（例：迷路的吟遊詩人）" value="${esc(old[i] || "")}" />`
    ).join("");
  }
  function guestRoleLines() {
    return Array.from(document.querySelectorAll("#odGuestRoles input"))
      .map((el, i) => ({ tag: GUEST_TAG[i], v: el.value.trim() }))
      .filter((x) => x.v);
  }
  { /* ★ 預約日期最小值＝今天+3（瀏覽器日曆直接反灰不可選） */
    const d = new Date(); d.setDate(d.getDate() + 3);
    const el = document.getElementById("custDate");
    if (el) el.min = d.toISOString().slice(0, 10);
  }
  /* 顧客資訊驗證：回傳錯誤訊息或 null */
  function validateCustomer() {
    const sv = document.getElementById("custServer")?.value.trim();
    const cid = document.getElementById("custId")?.value.trim();
    if (!sv || !cid) return "請先在「入席登記 · 顧客資訊」填寫您的伺服器與角色 ID。";
    if (hasCo && hasCo.checked) {
      const rows = coRows();
      const complete = rows.filter((r) => r.server && r.id);
      const partial  = rows.filter((r) => (r.server && !r.id) || (!r.server && r.id));
      if (partial.length) return "同行顧客資料不完整：每一位都需要「伺服器＋角色 ID」都填妥。";
      if (!complete.length) return "已勾選「有同行顧客」，請至少填妥一位同行者的伺服器與 ID（或取消勾選）。";
    }
    /* ★ 2026-07-13：預約日期（3 天前規則）＋入席時間 */
    const dv = document.getElementById("custDate")?.value;
    if (!dv) return "請選擇「預約消費日期」。";
    const min = new Date(); min.setHours(0, 0, 0, 0); min.setDate(min.getDate() + 3);
    if (new Date(dv + "T00:00:00") < min) return "依本店規定，最晚需於消費日 3 天前預訂——請選擇 3 天後（含）的日期。";
    if (!document.querySelector('input[name="custSession"]:checked')) return "請先勾選來訪場次（早場／午場／晚場／午夜場）。";
    if (!document.getElementById("custTime")?.value.trim()) return "請填寫詳細入席時間（例：21:30）。";
    return null;
  }

  const dishes = new Map();
  let extraPhotos = 0;
  const pickedStaff = new Set();
  let pickedRoom = null;   // { name, price, cap }

  const ROLES  = ["小學老師","外科醫師","心理醫師","餐飲業","導遊","股市專家","電玩遊戲業者","電玩迷","動漫迷","運動員","球類運動迷","社畜","在學生","隨緣"]  /* ★ 2026-07-13：移除「遊戲中的NPC」 */;
  const STYLES = ["溫柔內向","大方風趣","善於挑逗","火爆易怒","冷血無情","誠實正直","隨緣"];

  /* ---------- 料理數量鈕（長在餐點卡上） ---------- */
  function decorateMenu() {
    const list = document.getElementById("menuList");
    if (!list) return;
    list.querySelectorAll(".menu-card").forEach((card) => {
      if (card.querySelector(".menu-order")) return;
      const body = card.querySelector(".menu-body");
      const name = card.querySelector(".menu-name")?.textContent?.trim();
      if (!body || !name) return;
      const bar = document.createElement("div");
      bar.className = "menu-order";
      bar.innerHTML =
        '<button type="button" class="mo-btn" data-mo="-1" aria-label="減少">−</button>' +
        '<span class="mo-qty">' + (dishes.get(name)?.qty || 0) + "</span>" +
        '<button type="button" class="mo-btn" data-mo="1" aria-label="增加">＋</button>';
      /* ★ 2026-07-14 v6：−/＋ 點餐鍵改掛在圖片下方（.menu-photo-col）；找不到才退回文字欄 */
      (card.querySelector(".menu-photo-col") || body).appendChild(bar);
    });
    updateTotals();
  }
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".menu-order .mo-btn");
    if (!btn) return;
    const card = btn.closest(".menu-card");
    const name = card.querySelector(".menu-name")?.textContent?.trim();
    if (!name) return;
    const price = num(card.querySelector(".menu-price")?.textContent);
    const cur = dishes.get(name)?.qty || 0;
    const next = Math.max(0, Math.min(20, cur + Number(btn.dataset.mo)));
    if (next === 0) dishes.delete(name); else dishes.set(name, { qty: next, price });
    card.querySelector(".mo-qty").textContent = next;
    updateTotals();
  });

  /* ---------- 店員卡片上的「☑ 指名」（最多 3 位；0 位＝隨緣） ---------- */
  function staffRows() {
    return (typeof staffCache !== "undefined" && staffCache.length)
      ? staffCache.map((x) => x.data) : DEFAULT_STAFF;
  }
  function feeOf(name) {
    const s = staffRows().find((x) => x.name === name);
    return num(s && s.fee) || FEE.named;
  }
  function refreshStaff() {
    const list = document.getElementById("staffList");
    if (!list) return;
    // 先清掉舊勾選中已不存在／已關閉的店員
    const openNames = new Set(staffRows().filter((s) => s.available !== false).map((s) => s.name));
    for (const n of Array.from(pickedStaff)) if (!openNames.has(n)) pickedStaff.delete(n);
    list.querySelectorAll(".staff-card").forEach((card) => {
      if (card.querySelector(".staff-pick")) return;
      const name = card.querySelector("h3")?.textContent?.trim();
      if (!name) return;
      const s = staffRows().find((x) => x.name === name);
      const bar = document.createElement("div");
      bar.className = "staff-pick";
      if (s && s.available === false) {
        bar.innerHTML = `<span class="staff-pick-off">🚫 暫不受理指名</span>`;
      } else {
        const ck = pickedStaff.has(name) ? " checked" : "";
        bar.innerHTML = `<label><input type="checkbox" class="staff-pick-ck" value="${esc(name)}"${ck} /> 指名 <small>＋${fmt(feeOf(name))}／時段</small></label>`;
        bar.querySelector("input").onchange = (e) => {
          if (e.target.checked && pickedStaff.size >= 3) {
            e.target.checked = false;
            alert("指名店員最多 3 位喔。");
            return;
          }
          e.target.checked ? pickedStaff.add(name) : pickedStaff.delete(name);
          renderStaffPrefs();   /* ★ 指名變動 → 逐位可選項面板重繪 */
          updateTotals();
        };
      }
      card.appendChild(bar);
    });
    renderStaffPrefs();   /* ★ 卡片重建後，把已勾店員的選項面板掛回去 */
    refreshDutyBadges();  /* ★ 2026-07-14：卡片重建後，出勤標示也要掛回去 */
    updateTotals();
  }

  /* ---------- 包廂 radio（長在包廂卡上；擇一） ---------- */
  function refreshRooms() {
    const list = document.getElementById("roomList");
    if (!list) return;
    const rows = (typeof roomCache !== "undefined" && roomCache.length)
      ? roomCache.map((x) => x.data) : DEFAULT_ROOMS;
    if (pickedRoom && !rows.some((r) => r.name === pickedRoom.name && r.available !== false)) pickedRoom = null;
    list.querySelectorAll(".room-card").forEach((card) => {
      const slot = card.querySelector(".room-pickslot");
      const name = card.dataset.room;
      const r = rows.find((x) => x.name === name);
      if (!slot || !r) return;
      if (r.available === false) { slot.innerHTML = ""; return; }
      const ck = pickedRoom && pickedRoom.name === name ? " checked" : "";
      /* ★ 2026-07-13 v2：勾選後旁邊補「✕ 取消」鈕（radio 無法點第二次取消）；
         取消＝退回中央舞台區（免費）。舊版 slot 只有 label 一枚。 */
      slot.innerHTML = `<label class="room-pick"><input type="radio" name="roomPick" value="${esc(name)}"${ck} /> 選這間包廂</label>` +
        (ck ? `<button type="button" class="room-unpick">✕ 取消</button>` : "");
      card.classList.toggle("is-picked", !!ck);
      slot.querySelector("input").onchange = () => {
        pickedRoom = { name: r.name, price: num(r.price), rawPrice: r.price || "", cap: Number(r.cap) || 1 };
        refreshRooms();   /* 重繪各卡：帶出取消鈕＋同步 is-picked＋updateTotals */
      };
      const un = slot.querySelector(".room-unpick");
      if (un) un.onclick = () => { pickedRoom = null; refreshRooms(); };
    });
    updateTotals();
  }

  /* ---------- 扮演身分／服務風格 chips ---------- */
  function buildChips(boxId, groupName, opts) {
    const box = document.getElementById(boxId);
    if (!box) return;
    box.innerHTML = opts.map((o) =>
      `<label class="order-chip"><input type="radio" name="${groupName}" value="${o}"${o === "隨緣" ? " checked" : ""} />${o}</label>`).join("");
  }
  /* ★ 2026-07-13 v2：全域 chips 欄位移除（身分/風格改於店員名簿卡片勾選）——
     舊呼叫備查：buildChips("odRoleBox","odRole",ROLES)；buildChips("odStyleBox","odStyle",STYLES)。
     buildChips 本體保留（有 if(!box) 防呆），日後如需恢復直接還原兩行即可。 */

  /* ---------- 加拍 ---------- */
  const photoQtyEl = document.getElementById("odPhotoQty");
  document.getElementById("odPhotoPlus").onclick  = () => { extraPhotos = Math.min(10, extraPhotos + 1); photoQtyEl.textContent = extraPhotos; updateTotals(); };
  document.getElementById("odPhotoMinus").onclick = () => { extraPhotos = Math.max(0,  extraPhotos - 1); photoQtyEl.textContent = extraPhotos; updateTotals(); };

  /* ---------- 試算 ---------- */
  function calc() {
    let dishTotal = 0;
    dishes.forEach((v) => { dishTotal += v.qty * v.price; });
    const units = (Number(document.getElementById("odDuration").value) || 20) / 20;
    const namedN = pickedStaff.size;
    const staffFee = namedN > 0
      ? Array.from(pickedStaff).reduce((sum, n) => sum + feeOf(n), 0) * units
      : FEE.seat * units;
    /* ★ RP 輕重加價（僅指名時計）：任一指名店員被勾了個性/身分即計（每單一次）
       2026-07-13 改讀逐店員面板 */
    const sp = namedN > 0 ? collectStaffPrefs() : [];
    const styleOn = sp.some((p) => p.style && p.style !== "隨緣");
    const roleOn  = sp.some((p) => p.role  && p.role  !== "隨緣");
    const rpFee = (styleOn ? FEE.persona : 0) + (roleOn ? FEE.role : 0);
    const rpLevel = namedN === 0 ? "" : (styleOn && roleOn ? "重" : (styleOn || roleOn ? "中" : "輕"));
    const photoFee = extraPhotos * FEE.photo;
    const roomFee = pickedRoom ? pickedRoom.price : 0;
    return { dishTotal, serviceTotal: staffFee + rpFee + photoFee, roomFee,
             grand: dishTotal + staffFee + rpFee + photoFee + roomFee,
             units, namedN, styleOn, roleOn, rpFee, rpLevel };
  }
  function updateTotals() {
    const c = calc();
    const listEl = document.getElementById("orderDishList");
    if (listEl) {
      if (!dishes.size) listEl.innerHTML = '<p class="order-empty">尚未點選任何餐點。</p>';
      else listEl.innerHTML = Array.from(dishes.entries()).map(([n, v]) =>
        `<div class="order-dish-row"><span>${esc(n)} × ${v.qty}</span><b>${v.price ? fmt(v.qty * v.price) : "未定價"}</b></div>`).join("");
    }
    const minEl = document.getElementById("orderMinNote");
    if (minEl) {
      if (!FEE.min) minEl.textContent = "";
      else if (c.dishTotal >= FEE.min) { minEl.textContent = "✔ 已達單點料理低消 " + fmt(FEE.min); minEl.className = "order-min-note ok"; }
      else { minEl.textContent = "尚差 " + fmt(FEE.min - c.dishTotal) + " 達到單點料理低消（" + fmt(FEE.min) + "）"; minEl.className = "order-min-note"; }
    }
    const pk = document.getElementById("odPickedNote");
    if (pk) {
      const warns = c.namedN ? dutyWarnings() : [];
      pk.textContent = (c.namedN
        ? `目前指名：${c.namedN} 位（${Array.from(pickedStaff).join("、")}）`
        : "目前指名：0 位（隨緣，由店家安排 1 位店員）")
        + (warns.length ? `　⚠ 依排班表，${warns.join("、")} 於所選日期／場次未排班——仍可送單，店家將與您確認代班或改期。` : "");
    }
    /* ★ 2026-07-13 v3：服務逐項結算＋帳單端可直接取消 RP 加價（同步名簿勾選） */
    const svcEl = document.getElementById("odServiceList");
    if (svcEl) {
      const rows = [];
      if (c.namedN) {
        Array.from(pickedStaff).forEach((n) => rows.push(`<div class="osl-row"><span>指名 ${esc(n)}</span><b>${fmt(feeOf(n))} × ${c.units} 時段</b></div>`));
        const sp2 = collectStaffPrefs();
        const roleSel  = sp2.filter((p) => p.role  !== "隨緣");
        const styleSel = sp2.filter((p) => p.style !== "隨緣");
        if (roleSel.length) rows.push(`<label class="osl-row osl-ck"><span><input type="checkbox" id="odCkRole" checked /> 指定職業身分（${roleSel.map((p) => `${esc(p.name)}＝${esc(p.role)}`).join("、")}）</span><b>＋${fmt(FEE.role)}</b></label>`);
        if (styleSel.length) rows.push(`<label class="osl-row osl-ck"><span><input type="checkbox" id="odCkStyle" checked /> 指定個性風格（${styleSel.map((p) => `${esc(p.name)}＝${esc(p.style)}`).join("、")}）</span><b>＋${fmt(FEE.persona)}</b></label>`);
      } else {
        rows.push(`<div class="osl-row"><span>隨緣坐檯（店家安排 1 位）</span><b>${fmt(FEE.seat)} × ${c.units} 時段</b></div>`);
      }
      if (extraPhotos) rows.push(`<div class="osl-row"><span>額外加拍 × ${extraPhotos} 張</span><b>＋${fmt(extraPhotos * FEE.photo)}</b></div>`);
      svcEl.innerHTML = rows.join("");
      const ckR = document.getElementById("odCkRole");
      if (ckR) ckR.onchange = () => {   /* 取消勾選 → 全部身分改回隨緣 → 名簿面板同步重繪 */
        Array.from(pickedStaff).forEach((n) => { prefOf(n).role = "隨緣"; });
        renderStaffPrefs(); updateTotals();
      };
      const ckS = document.getElementById("odCkStyle");
      if (ckS) ckS.onchange = () => {
        Array.from(pickedStaff).forEach((n) => { prefOf(n).style = "隨緣"; });
        renderStaffPrefs(); updateTotals();
      };
    }
    document.getElementById("odDishTotal").textContent    = fmt(c.dishTotal);
    document.getElementById("odServiceTotal").textContent = fmt(c.serviceTotal);
    document.getElementById("odRoomTotal").textContent    = pickedRoom
      ? (pickedRoom.price ? fmt(c.roomFee) : (pickedRoom.rawPrice || "價目待公告"))
      : "開放區域（免費）";   /* ★ 2026-07-13：未選包廂＝中央舞台區開放區域 */
    document.getElementById("odGrandTotal").textContent   = fmt(c.grand);
    updateRoleShow();   /* ★ 2026-07-13 v2：同步「店員扮演身分」唯讀顯示 */
  }
  document.getElementById("odDuration").onchange = updateTotals;
  document.getElementById("odGuests").onchange = updateTotals;
  document.getElementById("custDate")?.addEventListener("change", updateTotals);
  document.getElementById("custSessionBox")?.addEventListener("change", updateTotals);
  /* ★ 2026-07-14：日期／場次一變動，名簿出勤標示即時重算 */
  document.getElementById("custDate")?.addEventListener("change", refreshDutyBadges);
  document.getElementById("custSessionBox")?.addEventListener("change", refreshDutyBadges);
  /* ★ 勾個性／職業身分（自訂輸入）→ 即時重算
     ★ 2026-07-13 v2：odRoleBox/odStyleBox/odStyleCustom 已移除，監聽一併除役——
     舊三行備查：odRoleBox.change／odStyleBox.change／odStyleCustom.input → updateTotals */
  document.getElementById("odRoleCustom")?.addEventListener("input", updateTotals);

  function writeFeeNote() {
    /* ★ 2026-07-13：帳目價目表同步顯示 💰 設定值（單一真相，杜絕表格與實收不同步） */
    const bindFmt = { seat: (v) => fmt(v), named: (v) => fmt(v), persona: (v) => "＋" + fmt(v),
                      role: (v) => "＋" + fmt(v), photo: (v) => "＋" + fmt(v), min: (v) => fmt(v) };
    document.querySelectorAll("[data-fee-bind]").forEach((el) => {
      const k = el.dataset.feeBind;
      if (bindFmt[k] && Number.isFinite(FEE[k])) el.textContent = bindFmt[k](FEE[k]);
    });
    document.getElementById("odFeeNote").textContent =
      `（測試價目：不指名(隨緣) ${fmt(FEE.seat)}／時段・指名基本 ${fmt(FEE.named)}／位／時段（店員可個別定價）・RP加價：勾選個性 ＋${fmt(FEE.persona)}、勾選職業身分 ＋${fmt(FEE.role)}（兩者皆選＝重度RP）・加拍 ${fmt(FEE.photo)}／張・單點低消 ${fmt(FEE.min)}；包廂費依各包廂標示。管理員可按「💰 價目設定」線上修正）`;
  }
  writeFeeNote();

  /* ---------- 送出（測試＝產生明細文字） ---------- */
  const pick = pickVal;
  document.getElementById("odGenerate").onclick = () => {
    const c = calc();
    if (document.getElementById("odWeb")?.value) return;   /* 蜜罐被填＝機器人，靜默擋下 */
    const custErr = validateCustomer();
    if (custErr) { alert(custErr); return; }
    if (!dishes.size) { alert("請先在上方「茶點・餐單」點選至少 1 道料理。"); return; }
    if (FEE.min && c.dishTotal < FEE.min) { alert("單點料理尚未達到低消 " + fmt(FEE.min) + "，請再加點一些餐點。"); return; }
    /* ★ 2026-07-13：包廂改為可不選——未指定者於中央舞台區（開放區域・免費）入席 */
    const guests = Number(document.getElementById("odGuests").value) || 1;
    if (pickedRoom && guests > pickedRoom.cap) { alert(`「${pickedRoom.name}」最多容納 ${pickedRoom.cap} 位，同行 ${guests} 位超過上限，請換一間包廂或調整人數。`); return; }
    if (!document.getElementById("odAgree").checked) { alert("請先勾選同意「帳前約定」與善良風俗聲明。"); return; }
    const roleCustom  = document.getElementById("odRoleCustom").value.trim();
    /* ★ 2026-07-13 v2：odStyleCustom 欄位已移除（風格改於店員名簿卡片勾選）
       舊行備查：const styleCustom = document.getElementById("odStyleCustom").value.trim(); */
    const dur = document.getElementById("odDuration").value;
    const lines = [];
    lines.push("【茶談百緣｜幻想友人帳 RP 商店・測試預約單】");   /* ★ 2026-07-13 店名定案 */
    lines.push("※ 本店尚未正式營業，此明細僅為功能測試，不成立任何訂單。");
    lines.push("顧客暱稱：" + (document.getElementById("odNick").value.trim() || "（未填）"));
    {
      const dv = document.getElementById("custDate").value;
      const wd = ["日","一","二","三","四","五","六"][new Date(dv + "T00:00:00").getDay()];
      lines.push(`消費日期：${dv.replace(/-/g, "/")}（週${wd}）`);
      lines.push("場次：" + (document.querySelector('input[name="custSession"]:checked')?.value || ""));
      lines.push("期望入席：" + document.getElementById("custTime").value.trim());
    }
    lines.push("顧客：" + document.getElementById("custServer").value.trim() + "｜" + document.getElementById("custId").value.trim());
    if (hasCo && hasCo.checked) coRows().filter((r) => r.server && r.id)
      .forEach((r, k) => lines.push(`同行${k + 1}：${r.server}｜${r.id}`));
    lines.push("同行人數：" + guests + " 位（含本人；所有點餐與指名合併同一張帳單）");
    lines.push("――― 料理 ―――");
    dishes.forEach((v, n) => lines.push(`　${n} × ${v.qty}${v.price ? "　" + fmt(v.qty * v.price) : "（未定價）"}`));
    lines.push("　料理小計：" + fmt(c.dishTotal) + (FEE.min ? `（低消 ${fmt(FEE.min)} ✔）` : ""));
    lines.push("――― 店員服務 ―――");
    lines.push(`　時長：${dur} 分鐘（${c.units} 個時段）`);
    lines.push("　指名：" + (c.namedN ? Array.from(pickedStaff).map((n) => `${n}（${fmt(feeOf(n))}/時段）`).join("、") : "隨緣（不指名價）"));
    lines.push("　服務模式：" + pick("odMode"));
    if (c.namedN) {
      collectStaffPrefs().forEach((p) => {
        lines.push(`　${p.tag} ${p.name}：扮演＝${p.role}／風格＝${p.style}` + (p.gender ? `（性別呈現：${p.gender}）` : ""));
      });
      if (roleCustom) lines.push(`　自訂身分備註：${roleCustom}`);
    } else {
      /* ★ 2026-07-13 v2：全域「身分 chips／性別 radio／風格 chips」欄位移除——
         隨緣時僅列顧客自行輸入，未填一律「隨緣」。舊三行備查：
         扮演身分偏好 pick("odRole")＋roleCustom／性別偏好 pick("odGender")／風格偏好 pick("odStyle")＋styleCustom */
      lines.push("　扮演身分偏好：" + (roleCustom || "隨緣"));
      lines.push("　性別偏好：隨緣");
      lines.push("　風格偏好：隨緣");
    }
    guestRoleLines().forEach((g) => lines.push(`　顧客${g.tag} 扮演身分：${g.v}`));
    { const warns = c.namedN ? dutyWarnings() : [];
      if (warns.length) lines.push(`　※ 排班提示：${warns.join("、")} 於該日期／場次未排班（送單後由店家確認代班或改期）`); }
    if (c.namedN) lines.push(`　RP 程度：${c.rpLevel}` + (c.rpFee ? `（個性${c.styleOn ? " ＋" + fmt(FEE.persona) : "—"}／職業身分${c.roleOn ? " ＋" + fmt(FEE.role) : "—"}）` : "（基本，無加價）"));
    lines.push(`　拍照：含 1 張專業拍照` + (extraPhotos ? `＋加拍 ${extraPhotos} 張` : ""));
    lines.push("　店員服務小計：" + fmt(c.serviceTotal));
    lines.push("――― 包廂 ―――");
    if (pickedRoom) lines.push(`　${pickedRoom.name}（最多 ${pickedRoom.cap} 位）：` + (pickedRoom.price ? fmt(c.roomFee) : (pickedRoom.rawPrice || "價目待公告")));
    else lines.push("　未指定包廂——於中央舞台區（開放區域）入席，免費；座位先到先得。");
    lines.push("――― 總計：" + fmt(c.grand) + " ―――");
    const memo = document.getElementById("odMemo").value.trim();
    if (memo) lines.push("特殊需求：" + memo);
    const orderText = lines.join("\n");
    document.getElementById("odResult").value = orderText;
    document.getElementById("odResultWrap").style.display = "";
    /* ★ 2026-07-13：可送單時顯示送出按鈕（試用期＝僅管理員；正式開放在 🛎 設定打勾） */
    let sb = document.getElementById("odSubmit");
    if (canSubmitNow()) {
      if (!sb) {
        sb = document.createElement("button");
        sb.type = "button"; sb.id = "odSubmit"; sb.className = "btn primary";
        sb.style.marginTop = "8px";
        document.getElementById("odCopy").after(sb);
      }
      sb.textContent = isAdmin && OCFG.open !== true ? "📨 送出預約單（管理員試用）" : "📨 送出預約單";
      sb.onclick = () => submitOrder(orderText);
    } else if (sb) sb.remove();
    document.getElementById("odResult").scrollIntoView({ behavior: "smooth", block: "center" });
  };
  document.getElementById("odCopy").onclick = async () => {
    const ta = document.getElementById("odResult");
    try { await navigator.clipboard.writeText(ta.value); alert("已複製預約明細！"); }
    catch { ta.select(); document.execCommand("copy"); alert("已複製預約明細！"); }
  };

  /* ============================================================
     ★ 2026-07-13 深夜：真送單（Google 表單）＋防濫用＋管理員接單通知
     ------------------------------------------------------------
     - 設定存 siteContent/config-orderform：
       { formUrl（…/formResponse）, entryId（entry.123456）, csvUrl（回應試算表發布CSV）,
         sheetUrl（訂單列表網址）, open（true=所有訪客可送；false=僅管理員試用）, vol（通知音量0-100） }
     - 防濫用（純前端能做的都做了）：蜜罐欄位／同機 2 分鐘冷卻／同內容 10 分鐘防重送。
       ※ 誠實說明：靜態網站擋不了決心滿滿的攻擊者，真正的流量防護在 Google 表單端
       （表單可另開「僅限登入 Google 帳號者作答」＝最有效的防機器人）。
     - 通知：管理員登入時每 45 秒輪詢 CSV，偵測到新回應→風鈴聲＋右下角視窗
       （點開訂單列表／一鍵複製給顧客的預約成功通知訊息）。
     ============================================================ */
  const OCFG = { formUrl: "", entryId: "", csvUrl: "", sheetUrl: "", staffCsvUrl: "", vipCsvUrl: "", open: false, vol: 60 };
  let ocfgLoaded = false;
  (async () => {
    try {
      const snap = await getDoc(doc(db, "siteContent", "config-orderform"));
      if (snap.exists()) Object.assign(OCFG, snap.data() || {});
    } catch (_) {}
    ocfgLoaded = true;
    renderVipBoard();   /* ★ 2026-07-13：設定載入後同步貴客榜 */
  })();

  /* ---------- ★ 2026-07-13：貴客榜＝預約總表「已完成」自動彙總 ----------
     讀預約總表發布 CSV，狀態=已完成的列依「顧客角色ID」彙總：
     有「金額」欄→依總消費排行；沒有→依完成次數排行。榜單前 5 名寫進 .rank-board。 */
  async function renderVipBoard() {
    const board = document.querySelector(".rank-board");
    if (!board || !OCFG.vipCsvUrl) return;
    try {
      const res = await fetch(OCFG.vipCsvUrl, { cache: "no-store" });
      const rows = parseCSV(await res.text());
      const hi = rows.findIndex((r) => r.some((c) => String(c).includes("顧客角色ID")));
      if (hi < 0) return;
      const H = rows[hi].map((c) => String(c));
      const iId = H.findIndex((h) => h.includes("顧客角色ID"));
      const iSt = H.findIndex((h) => h.includes("狀態"));
      const iAmt = H.findIndex((h) => h.includes("金額"));
      const agg = new Map();
      for (const r of rows.slice(hi + 1)) {
        const id = String(r[iId] || "").trim();
        const st = String(r[iSt] || "").trim();
        if (!id || id.includes("範例") || !st.startsWith("已完成")) continue;
        const amt = iAmt >= 0 ? (parseInt(String(r[iAmt]).replace(/[^\d]/g, ""), 10) || 0) : 0;
        const cur = agg.get(id) || { n: 0, sum: 0 };
        cur.n += 1; cur.sum += amt;
        agg.set(id, cur);
      }
      if (!agg.size) return;
      const ranked = Array.from(agg.entries())
        .sort((a, b) => (b[1].sum - a[1].sum) || (b[1].n - a[1].n));
      const linesEl = board.querySelectorAll(".rank-line");
      ranked.slice(0, linesEl.length).forEach(([id, v], i) => {
        const line = linesEl[i];
        const nameEl = line.querySelector("b");
        const amtEl = line.querySelector(".rank-amt");
        if (nameEl) nameEl.textContent = id;
        if (amtEl) amtEl.textContent = v.sum ? v.sum.toLocaleString("zh-Hant-TW") + " Gil" : `完成 ${v.n} 次`;
      });
    } catch (e) { console.warn("貴客榜同步失敗：", e); }
  }

  function canSubmitNow() {
    return ocfgLoaded && OCFG.formUrl && OCFG.entryId && (OCFG.open === true || isAdmin);
  }
  function hashText(t) { let h = 0; for (let i = 0; i < t.length; i++) { h = (h * 31 + t.charCodeAt(i)) | 0; } return String(h); }
  async function submitOrder(text) {
    if (document.getElementById("odWeb")?.value) return;                       /* 蜜罐 */
    const now = Date.now();
    const lastTs = Number(localStorage.getItem("yjc_order_ts") || 0);
    if (now - lastTs < 120000) { alert("送單太頻繁囉，請稍候 2 分鐘再試。"); return; }
    const h = hashText(text);
    if (localStorage.getItem("yjc_order_hash") === h && now - lastTs < 600000) {
      alert("這張單剛剛已經送出過了，請不要重複送單。"); return;
    }
    try {
      const body = new URLSearchParams();
      body.append(OCFG.entryId, text);
      await fetch(OCFG.formUrl, { method: "POST", mode: "no-cors",
        headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
      localStorage.setItem("yjc_order_ts", String(now));
      localStorage.setItem("yjc_order_hash", h);
      /* ★ 2026-07-13：保存到本裝置的預約紀錄（最多 20 筆） */
      try {
        const arr = JSON.parse(localStorage.getItem("yjc_orders") || "[]");
        arr.unshift({ ts: now, text });
        localStorage.setItem("yjc_orders", JSON.stringify(arr.slice(0, 20)));
        renderMyOrders();
      } catch (_) {}
      alert("📨 預約單已送出！我們收到後會盡快與您聯繫。\n（已存入下方「伍・我的預約紀錄」，可隨時查看帳單）");
    } catch (e) { alert("❌ 送出失敗，請改用「複製明細」貼到 Discord 預約區：" + (e.message || e)); }
  }

  /* ---------- ★ 2026-07-13：伍・我的預約紀錄（本裝置） ---------- */
  function renderMyOrders() {
    const wrap = document.getElementById("myOrdersWrap");
    const list = document.getElementById("myOrders");
    if (!wrap || !list) return;
    let arr = [];
    try { arr = JSON.parse(localStorage.getItem("yjc_orders") || "[]"); } catch (_) {}
    wrap.style.display = arr.length ? "" : "none";
    list.innerHTML = arr.map((o, i) => {
      const d = new Date(o.ts);
      const when = `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
      const total = (o.text.match(/――― 總計：([^ ―]+)/) || [, "—"])[1];
      const date  = (o.text.match(/消費日期：([^\n]+)/) || [, ""])[1];
      return `<div class="myorder-row"><span>${esc(when)} 送出｜消費日 ${esc(date)}｜總計 ${esc(total)}</span>
        <span class="myorder-btns"><button type="button" class="admin-btn" data-mo-view="${i}">查看帳單</button>
        <button type="button" class="admin-btn danger" data-mo-del="${i}">刪除</button></span></div>`;
    }).join("");
    list.querySelectorAll("[data-mo-view]").forEach((b) => b.onclick = () => openBill(arr[Number(b.dataset.moView)]));
    list.querySelectorAll("[data-mo-del]").forEach((b) => b.onclick = () => {
      if (!confirm("刪除這筆本機紀錄？（不影響店家端的訂單）")) return;
      arr.splice(Number(b.dataset.moDel), 1);
      localStorage.setItem("yjc_orders", JSON.stringify(arr));
      renderMyOrders();
    });
  }
  function openBill(o) {
    document.getElementById("billModal")?.remove();
    const wrap = document.createElement("div");
    wrap.className = "admin-modal"; wrap.id = "billModal";
    const d = new Date(o.ts);
    wrap.innerHTML = `
      <div class="bill-card">
        <div class="bill-head"><span class="hanko">緣</span>
          <div><b>茶談百緣</b><small>幻想友人帳 · RP Shop</small></div></div>
        <pre class="bill-body">${esc(o.text)}</pre>
        <div class="bill-foot">送出時間：${d.toLocaleString("zh-TW")}　※ 截圖此帳單即可分享給同行友人</div>
        <div class="admin-modal-btns"><button type="button" class="admin-btn" id="billClose">關閉</button></div>
      </div>`;
    document.body.appendChild(wrap);
    wrap.addEventListener("click", (e) => { if (e.target === wrap) wrap.remove(); });
    document.getElementById("billClose").onclick = () => wrap.remove();
  }
  renderMyOrders();

  /* ---------- 管理員接單通知（輪詢發布的回應 CSV） ---------- */
  function parseCSV(t) {
    const rows = []; let cur = [""], q = false;
    for (let i = 0; i < t.length; i++) {
      const ch = t[i];
      if (q) {
        if (ch === '"') { if (t[i + 1] === '"') { cur[cur.length - 1] += '"'; i++; } else q = false; }
        else cur[cur.length - 1] += ch;
      } else if (ch === '"') q = true;
      else if (ch === ",") cur.push("");
      else if (ch === "\n") { rows.push(cur); cur = [""]; }
      else if (ch !== "\r") cur[cur.length - 1] += ch;
    }
    if (cur.length > 1 || cur[0]) rows.push(cur);
    return rows.filter((r) => r.some((c) => c.trim()));
  }
  function notifyToast(orderText) {
    document.getElementById("odToast")?.remove();
    const m = orderText.match(/顧客：([^｜\n]+)｜([^\n]+)/);
    const server = m ? m[1].trim() : "", cid = m ? m[2].trim() : "";
    /* ★ 2026-07-13：DC 出勤工作單（時間/店員/職務/總營收，一鍵複製發到公會 DC） */
    const g = (re) => (orderText.match(re) || [, ""])[1].trim();
    const workOrder = [
      "📣【茶談百緣 · 出勤工作單】",
      `日期：${g(/消費日期：([^\n]+)/)}　${g(/場次：([^\n]+)/)}`,
      `入席：${g(/期望入席：([^\n]+)/)}｜顧客：${server}｜${cid}`,
      "指名：" + g(/指名：([^\n]+)/).replace(/（[^）]*）/g, ""),
      "包廂：" + g(/――― 包廂 ―――\n　?([^\n]+)/),
      "餐點：\n" + ((orderText.match(/――― 料理 ―――\n([\s\S]+?)\n　料理小計/) || [, "（見明細）"])[1]),
      "需求崗位：NPC陪聊店員、備餐、攝影師",
      "預估營收：" + g(/――― 總計：([^ ―]+)/),
      "可出勤的店員請在下方回覆 ✋",
    ].join("\n");
    const reply = `【茶談百緣】預約確認通知\n${cid || "貴客"} 樣${server ? `（${server}）` : ""}您好，已收到您的預約單！\n內容已登記，我們會依單準備。小提醒：\n・最晚請於消費日 3 天前完成預訂\n・同行點餐與指名將合併於同一張帳單\n如需修改或取消請提前告知，期待您的光臨 🍵`;
    const t = document.createElement("div");
    t.id = "odToast"; t.className = "od-toast";
    t.innerHTML = `<b>🔔 收到新預約單！</b><span>${esc(cid ? `${server}｜${cid}` : "點開查看內容")}</span>
      <div class="od-toast-btns">
        ${OCFG.sheetUrl || OCFG.csvUrl ? `<button type="button" class="admin-btn primary" id="otOpen">開啟訂單列表</button>` : ""}
        <button type="button" class="admin-btn" id="otCopy">📋 複製通知訊息</button>
        <button type="button" class="admin-btn" id="otWork">📣 複製工作單</button>
        <button type="button" class="admin-btn" id="otClose">✕</button>
      </div>`;
    document.body.appendChild(t);
    const openBtn = document.getElementById("otOpen");
    if (openBtn) openBtn.onclick = () => window.open(OCFG.sheetUrl || OCFG.csvUrl, "_blank");
    document.getElementById("otCopy").onclick = async () => {
      try { await navigator.clipboard.writeText(reply); alert("已複製通知訊息，貼到遊戲密語或信件即可。"); } catch (_) {}
    };
    document.getElementById("otWork").onclick = async () => {
      try { await navigator.clipboard.writeText(workOrder); alert("已複製出勤工作單，貼到公會 Discord 徵集店員即可。"); } catch (_) {}
    };
    document.getElementById("otClose").onclick = () => t.remove();
    try {
      const bell = new Audio("audio/風鈴聲.mp3");
      bell.volume = Math.min(1, Math.max(0, (Number(OCFG.vol) || 60) / 100));
      bell.play().catch(() => {});
    } catch (_) {}
  }
  setInterval(async () => {
    if (!isAdmin || !OCFG.csvUrl) return;
    try {
      const res = await fetch(OCFG.csvUrl, { cache: "no-store" });
      const rows = parseCSV(await res.text());
      const n = Math.max(0, rows.length - 1);           /* 扣掉表頭 */
      const seen = Number(localStorage.getItem("yjc_orders_seen") || -1);
      if (seen === -1) { localStorage.setItem("yjc_orders_seen", String(n)); return; }
      if (n > seen) {
        localStorage.setItem("yjc_orders_seen", String(n));
        const last = rows[rows.length - 1];
        notifyToast(last.join("\n"));
      }
    } catch (_) {}
  }, 45000);

  /* ---------- ★ 2026-07-13：⟳ 更新店員排班表（CSV → 店員檔案） ----------
     讀排班登記表發布的 CSV，依表頭找欄位，同名店員取「最後一列」為準，
     寫回店員資料庫：可被指名/指名費/可接扮演身分/性別呈現/可接風格/加拍。
     店員名簿卡片與預約表單的逐位可選項會立即更新。 */
  async function syncStaffSchedule() {
    if (!OCFG.staffCsvUrl) { openOrderCfg(); alert("請先在 🛎 設定裡貼上「排班登記表」發布的 CSV 連結。"); return; }
    if (typeof staffCache === "undefined" || !staffCache.length) {
      alert("店員名簿還沒匯入資料庫——請先按「⤓ 匯入預設店員」再更新排班。"); return;
    }
    try {
      const res = await fetch(OCFG.staffCsvUrl, { cache: "no-store" });
      const rows = parseCSV(await res.text());
      const hi = rows.findIndex((r) => r.some((c) => String(c).includes("值班店員")));
      if (hi < 0) throw new Error("CSV 裡找不到「值班店員」表頭——請確認發布的是排班登記表分頁。");
      const H = rows[hi].map((c) => String(c));
      const col = (kw) => H.findIndex((h) => h.includes(kw));
      const iName = col("值班店員"), iAvail = col("可被指名"), iFee = col("指名費"),
            iRole = col("可接扮演身分"), iGen = col("性別"), iSty = col("可接服務風格"), iPh = col("可配合加拍"),
            iWeek = col("星期"), iSess = col("時段"), iStat = col("出勤");
      /* ★ 2026-07-13：排班表改週循環制——「星期」欄可能是 每日/平日/假日/一至四/一、三、五/單日 */
      const DAYS = "一二三四五六日";
      const canonDays = (t) => {
        t = String(t || "").trim();
        if (!t) return "";
        if (t.includes("每日") || t.includes("皆可")) return DAYS;
        if (t.includes("平日")) return "一二三四五";
        if (t.includes("假日") || t.includes("週末") || t.includes("周末")) return "六日";
        const m = t.match(/([一二三四五六日]).?至.?([一二三四五六日])/);
        if (m) {
          const a = DAYS.indexOf(m[1]), b = DAYS.indexOf(m[2]);
          if (a >= 0 && b >= a) return DAYS.slice(a, b + 1);
        }
        return Array.from(t).filter((ch) => DAYS.includes(ch)).join("");
      };
      const prof = new Map();
      const shiftsMap = new Map();
      for (const r of rows.slice(hi + 1)) {
        const name = String(r[iName] || "").trim();
        if (!name || name.includes("範例")) continue;
        /* 班表：星期集合｜時段前兩字（早場/午場/晚場/午夜），請假列不算班 */
        const stat = iStat >= 0 ? String(r[iStat] || "").trim() : "";
        const days = canonDays(iWeek >= 0 ? r[iWeek] : "");
        const sess = iSess >= 0 ? String(r[iSess] || "").trim().slice(0, 2) : "";
        if (days && sess && stat !== "請假") {
          if (!shiftsMap.has(name)) shiftsMap.set(name, []);
          shiftsMap.get(name).push(days + "|" + sess);
        }
        prof.set(name, {
          available: iAvail >= 0 ? String(r[iAvail]).trim() !== "否" : true,
          fee:       iFee  >= 0 ? String(r[iFee]  || "").replace(/[^\d]/g, "") : "",
          rpRoles:   iRole >= 0 ? String(r[iRole] || "").trim() : "",
          rpGender:  iGen  >= 0 ? String(r[iGen]  || "").trim() : "",
          rpStyles:  iSty  >= 0 ? String(r[iSty]  || "").trim() : "",
          rpPhoto:   iPh   >= 0 ? String(r[iPh]   || "").trim() : "",
        });
      }
      for (const [name, p] of prof) p.shifts = shiftsMap.get(name) || [];   /* ★ 班表一併寫入 */
      if (!prof.size) { alert("排班表裡沒有讀到任何店員資料列。"); return; }
      const updated = [], unmatched = [];
      for (const [name, p] of prof) {
        const hit = staffCache.find((x) => x.data.name === name);
        if (!hit) { unmatched.push(name); continue; }
        await updateDoc(doc(db, "shopPartners", hit.id), p);
        updated.push(name);
      }
      alert(`✔ 排班表匯入完成！\n已更新 ${updated.length} 位：${updated.join("、") || "（無）"}` +
            (unmatched.length ? `\n⚠ 排班表有、但店員名簿找不到同名（請對齊 ID）：${unmatched.join("、")}` : ""));
      loadStaff();
    } catch (e) { alert("❌ 更新失敗：" + (e.message || e)); }
  }

  /* ---------- 🛎 送單／通知設定 ---------- */
  function openOrderCfg() {
    document.getElementById("ocfgModal")?.remove();
    const wrap = document.createElement("div");
    wrap.className = "admin-modal"; wrap.id = "ocfgModal";
    wrap.innerHTML = `
      <div class="admin-modal-card">
        <h3>🛎 送單／接單通知設定</h3>
        <label>Google 表單送出網址（表單網址結尾改成 /formResponse）
          <input id="ofUrl" value="${esc(OCFG.formUrl)}" placeholder="https://docs.google.com/forms/d/e/…/formResponse" /></label>
        <label>明細欄位的 entry 代碼（預填連結裡的 entry.數字）
          <input id="ofEntry" value="${esc(OCFG.entryId)}" placeholder="entry.1234567890" /></label>
        <label>回應試算表「發布到網路」的 CSV 連結（接單通知用，可留空）
          <input id="ofCsv" value="${esc(OCFG.csvUrl)}" placeholder="https://docs.google.com/spreadsheets/d/e/…/pub?output=csv" /></label>
        <label>訂單列表網址（通知視窗「開啟訂單列表」按鈕，可填回應試算表網址）
          <input id="ofSheet" value="${esc(OCFG.sheetUrl)}" /></label>
        <label>排班登記表「發布到網路」CSV 連結（⟳ 更新店員排班表用；發布時選「排班登記表」分頁＋CSV）
          <input id="ofStaffCsv" value="${esc(OCFG.staffCsvUrl)}" placeholder="https://docs.google.com/spreadsheets/…/pub?gid=…&single=true&output=csv" /></label>
        <label>預約總表「發布到網路」CSV 連結（貴客榜自動排行用；狀態＝已完成的列會依顧客彙總，可留空）
          <input id="ofVipCsv" value="${esc(OCFG.vipCsvUrl)}" placeholder="發布時選「預約總表」分頁＋CSV" /></label>
        <label>通知音量（0〜100）<input id="ofVol" type="number" min="0" max="100" value="${Number(OCFG.vol) || 60}" /></label>
        <label class="admin-check"><input id="ofOpen" type="checkbox" ${OCFG.open === true ? "checked" : ""} /> 開放所有訪客送單（取消勾選＝僅管理員可送，試用期建議關閉）</label>
        <p class="admin-hint" id="ofMsg">防濫用：蜜罐欄位＋同機 2 分鐘冷卻＋同內容 10 分鐘防重送已內建；更強的防護請在 Google 表單開「僅限登入者作答」。</p>
        <div class="admin-modal-btns">
          <button type="button" id="ofTest" class="admin-btn">🔔 測試通知音</button>
          <button type="button" id="ofSave" class="admin-btn primary">儲存</button>
          <button type="button" id="ofCancel" class="admin-btn">取消</button>
        </div>
      </div>`;
    document.body.appendChild(wrap);
    wrap.addEventListener("click", (e) => { if (e.target === wrap) wrap.remove(); });
    document.getElementById("ofCancel").onclick = () => wrap.remove();
    document.getElementById("ofTest").onclick = () => {
      const b = new Audio("audio/風鈴聲.mp3");
      b.volume = Math.min(1, Math.max(0, (Number(document.getElementById("ofVol").value) || 60) / 100));
      b.play().catch(() => alert("瀏覽器擋掉了自動播放，請再點一次。"));
    };
    document.getElementById("ofSave").onclick = async () => {
      try {
        const vals = {
          formUrl:  document.getElementById("ofUrl").value.trim(),
          entryId:  document.getElementById("ofEntry").value.trim(),
          csvUrl:   document.getElementById("ofCsv").value.trim(),
          sheetUrl: document.getElementById("ofSheet").value.trim(),
          staffCsvUrl: document.getElementById("ofStaffCsv").value.trim(),
          vipCsvUrl:  document.getElementById("ofVipCsv").value.trim(),
          vol:      Math.min(100, Math.max(0, Number(document.getElementById("ofVol").value) || 60)),
          open:     document.getElementById("ofOpen").checked,
        };
        await setDoc(doc(db, "siteContent", "config-orderform"), vals, { merge: true });
        Object.assign(OCFG, vals);
        wrap.remove();
        alert("✔ 已儲存送單／通知設定。");
      } catch (e) { document.getElementById("ofMsg").textContent = "❌ 儲存失敗：" + (e.message || e); }
    };
  }

  /* ---------- ★ v2.1：管理員線上修正價目（存 siteContent/config-orderfees） ---------- */
  function openFees() {
    document.getElementById("feeModal")?.remove();
    const wrap = document.createElement("div");
    wrap.className = "admin-modal";
    wrap.id = "feeModal";
    const row = (id, label, val) =>
      `<label>${label}<input id="${id}" type="number" min="0" value="${val}" /></label>`;
    wrap.innerHTML = `
      <div class="admin-modal-card">
        <h3>💰 預約價目設定（Gil）</h3>
        ${row("feSeat",    "不指名（隨緣）／每 20 分鐘時段", FEE.seat)}
        ${row("feNamed",   "指名基本／每位店員／每時段（店員可個別覆寫）", FEE.named)}
        ${row("fePersona", "RP 加價：勾選個性（服務風格）／每單", FEE.persona)}
        ${row("feRole",    "RP 加價：勾選職業扮演身分／每單", FEE.role)}
        ${row("fePhoto",   "額外加拍／每張", FEE.photo)}
        ${row("feMin",     "單點料理低消", FEE.min)}
        <p class="admin-hint" id="feMsg">修改後全站立即生效（存於資料庫，蓋過網頁內建預設值）。</p>
        <div class="admin-modal-btns">
          <button type="button" id="feSave" class="admin-btn primary">儲存</button>
          <button type="button" id="feCancel" class="admin-btn">取消</button>
        </div>
      </div>`;
    document.body.appendChild(wrap);
    wrap.addEventListener("click", (e) => { if (e.target === wrap) wrap.remove(); });
    document.getElementById("feCancel").onclick = () => wrap.remove();
    document.getElementById("feSave").onclick = async () => {
      const msg = document.getElementById("feMsg");
      try {
        const vals = {
          seat:    Number(document.getElementById("feSeat").value)    || 0,
          named:   Number(document.getElementById("feNamed").value)   || 0,
          persona: Number(document.getElementById("fePersona").value) || 0,
          role:    Number(document.getElementById("feRole").value)    || 0,
          photo:   Number(document.getElementById("fePhoto").value)   || 0,
          min:     Number(document.getElementById("feMin").value)     || 0,
        };
        await setDoc(doc(db, "siteContent", "config-orderfees"), vals, { merge: true });
        Object.assign(FEE, vals);
        document.querySelectorAll("#staffList .staff-pick").forEach((el) => el.remove());
        refreshStaff();
        writeFeeNote();
        updateTotals();
        wrap.remove();
      } catch (e) { msg.textContent = "❌ 儲存失敗：" + (e.message || e); }
    };
  }

  /* ★ 2026-07-12：「開始預約」按鈕 → 平滑捲到餐單區，讓顧客從壹開始點
     ★ 2026-07-14：改捲到「入席登記・顧客資訊」（#custInfo）——預約流程實際從登記開始；
       找不到時才退回餐單區（舊行為備查：menuSection → menuList） */
  const startBtn = document.getElementById("odStart");
  if (startBtn) startBtn.onclick = () => {
    const target = document.getElementById("custInfo")
      || document.getElementById("menuSection") || document.getElementById("menuList");
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  window.YJC_ORDER = { decorateMenu, refreshStaff, refreshRooms, openFees, openOrderCfg, syncStaffSchedule };
  decorateMenu();
  refreshStaff();
  refreshRooms();
  renderGuestRoles();
  renderStaffPrefs();
  updateTotals();
})();
