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
  collection, getDocs, addDoc, deleteDoc, query, orderBy, serverTimestamp
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
