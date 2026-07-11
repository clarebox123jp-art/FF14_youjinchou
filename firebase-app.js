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
    const q = query(collection(db, "shopPartners"), orderBy("order"), orderBy("createdAt"));
    const snap = await getDocs(q);
    partnersCache = snap.docs.map((d) => ({ id: d.id, data: d.data() }));
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
      const dataUrl = cv.toDataURL("image/jpeg", quality);
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
    <button type="button" id="abOut" class="admin-btn">登出</button>`;
  document.body.appendChild(bar);
  const add = document.getElementById("abAdd");
  if (add) add.onclick = () => openPartnerForm();
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
const EDIT_SEL = ".wrap h1,.wrap h2,.wrap h3,.wrap p,.wrap figcaption,.hero-inner h1,.hero-inner p,.footer p,.footer h3,.photo .cap";
const EXCLUDE = "#partnerList,.admin-bar,.admin-modal,.lyrics-panel,.visit-banner,.edit-bar";

const textDefaults = {};                 // 每段的預設內容（供「回復預設」）
function collectEditables() {
  const seen = {}; const out = [];
  document.querySelectorAll(EDIT_SEL).forEach((el) => {
    if (el.closest(EXCLUDE)) return;
    if (!el.dataset.editKey) {
      const base = "t" + h32(el.textContent.trim().slice(0, 80) + "|" + el.tagName);
      const n = (seen[base] = (seen[base] || 0) + 1);
      el.dataset.editKey = n > 1 ? base + "-" + n : base;
      textDefaults[el.dataset.editKey] = el.innerHTML;
    }
    out.push(el);
  });
  return out;
}
function collectImgs() {
  return Array.from(document.querySelectorAll(".wrap img, .hero-inner img"))
    .filter((im) => !im.closest("#partnerList,.admin-modal"));
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
        box.appendChild(fig);
      } else {
        const im = document.createElement("img");
        im.src = d.src; im.alt = d.cap || ""; im.dataset.cap = d.cap || ""; im.dataset.docId = d.id;
        box.appendChild(im);
      }
    });
    // 隱藏的圖
    (pageData.hidden || []).forEach((k) => hideImgByKey(k));
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
let editingEl = null, editBar = null;
function startEdit(el) {
  finishEdit(false);
  editingEl = el;
  const docMode = !el.dataset.editKey && !!el.dataset.docId;   // 線上新增照片的圖說：存回該照片文件
  el.dataset.before = el.innerHTML;
  el.contentEditable = "true";
  el.classList.add("editing");
  el.focus();
  document.body.classList.add("yjc-editing");
  editBar = document.createElement("div");
  editBar.className = "edit-bar";
  editBar.innerHTML =
    '<span>✎ 正在編輯文字</span>' +
    '<button type="button" class="admin-btn primary" data-a="save">儲存</button>' +
    '<button type="button" class="admin-btn" data-a="cancel">取消</button>' +
    (docMode ? "" : '<button type="button" class="admin-btn" data-a="reset">回復預設</button>');
  document.body.appendChild(editBar);
  editBar.addEventListener("click", async (e) => {
    const a = e.target.dataset.a;
    if (a === "cancel") { editingEl.innerHTML = editingEl.dataset.before; finishEdit(true); }
    if (a === "save") {
      try {
        if (docMode) {
          const cap = editingEl.textContent.trim();
          await updateDoc(doc(db, "siteContent", editingEl.dataset.docId), { cap });
          const im = editingEl.closest("figure")?.querySelector("img");
          if (im) { im.alt = cap; if (im.dataset.cap !== undefined) im.dataset.cap = cap; }
        } else {
          const key = editingEl.dataset.editKey, html = editingEl.innerHTML;
          await setDoc(pageRef, { text: { [key]: html } }, { merge: true });
          pageData.text[key] = html;
        }
        finishEdit(true);
      } catch (err) { alert("儲存失敗：" + (err.message || err)); }
    }
    if (a === "reset") {
      const key = editingEl.dataset.editKey;
      try {
        await setDoc(pageRef, { text: { [key]: deleteField() } }, { merge: true });
        delete pageData.text[key];
        editingEl.innerHTML = textDefaults[key] || editingEl.dataset.before;
        finishEdit(true);
      } catch (err) { alert("回復失敗：" + (err.message || err)); }
    }
  });
}
function finishEdit(clean) {
  if (editBar) { editBar.remove(); editBar = null; }
  if (editingEl) {
    editingEl.contentEditable = "false";
    editingEl.classList.remove("editing");
    if (!clean) editingEl.innerHTML = editingEl.dataset.before || editingEl.innerHTML;
    editingEl = null;
  }
  document.body.classList.remove("yjc-editing");
}
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && editingEl) { editingEl.innerHTML = editingEl.dataset.before; finishEdit(true); } });

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
    b.innerHTML =
      '<button type="button" data-a="hide">' + (hidden ? "↩ 復原" : "✕ 隱藏") + "</button>" +
      (hidden ? "" : '<button type="button" data-a="rep">↻ 換圖</button>');
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      const target = im.closest(".about-slides") ? im.closest(".about-slides").querySelector("img.is-on") || im : im;
      if (e.target.dataset.a === "hide") toggleHideImg(target);
      if (e.target.dataset.a === "rep") replaceImg(target);
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
