/* ============================================================
   公會網站共用程式  main.js
   負責：背景音樂開關、按鍵音效、手機選單、滑動淡入

   ★★★ 新手設定區：換音樂／音效檔案改這兩行 ★★★
   把你的檔案放進 audio/ 資料夾，改成你的檔名即可。
   ============================================================ */
const DEFAULT_BGM = "audio/bgm.m4a";   // 各頁預設背景音樂
// 個別頁面想用專屬音樂：在該頁 <body> 加 data-bgm="audio/檔名.m4a"（例：RP 商店頁）
const BGM_SRC   = (document.body && document.body.dataset.bgm) || DEFAULT_BGM;
// const BGM_SRC   = "audio/bgm.m4a";  // ← 舊：固定單一音樂，保留備查（鐵則①）
// const BGM_SRC   = "audio/bgm.mp3";  // ← 更舊：檔名對不上，保留備查
const CLICK_SRC = "audio/圖鑑翻頁.mp3"; // 按鍵音效（圖鑑翻頁）
// const CLICK_SRC = "audio/click.mp3";   // ← 舊：範例音效，保留備查（鐵則①）
const CLICK_VOLUME = 0.35;             // 按鍵音效音量 0~1
const BGM_VOLUME   = 0.45;             // 背景音樂音量 0~1

/* ------------------------------------------------------------
   1) 背景音樂開關
   - 不會自動出聲（瀏覽器會擋自動播放，也比較不惱人）
   - 使用者按一下才開始，狀態會記住，換頁後沿用
------------------------------------------------------------ */
const bgm = new Audio(BGM_SRC);
bgm.loop = true;
bgm.volume = BGM_VOLUME;

const audioBtn = document.getElementById("audioBtn");
let musicOn = localStorage.getItem("musicOn") === "true";

function refreshAudioBtn() {
  if (!audioBtn) return;
  audioBtn.classList.toggle("playing", musicOn);
  audioBtn.querySelector(".note").textContent = musicOn ? "♪" : "♪";
  audioBtn.querySelector(".label").textContent = musicOn ? "音樂：開" : "音樂：關";
}

function startMusic() {
  bgm.play().catch(() => {
    /* 檔案不存在或被瀏覽器擋下時，安靜略過，不讓網站壞掉 */
  });
}

if (audioBtn) {
  refreshAudioBtn();
  // 若上次是開著的，等使用者第一次點畫面任一處就接續播放（繞過自動播放限制）
  if (musicOn) {
    const resume = () => { startMusic(); window.removeEventListener("pointerdown", resume); };
    window.addEventListener("pointerdown", resume);
  }
  audioBtn.addEventListener("click", () => {
    musicOn = !musicOn;
    localStorage.setItem("musicOn", musicOn);
    if (musicOn) startMusic(); else bgm.pause();
    refreshAudioBtn();
  });
}

/* ------------------------------------------------------------
   2) 按鍵音效
   - 幫所有有 class="sfx" 的連結／按鈕加上點擊音
   - 每次都用複製的音軌，才能連點時聲音重疊不卡
------------------------------------------------------------ */
function playClick() {
  try {
    const s = new Audio(CLICK_SRC);
    s.volume = CLICK_VOLUME;
    s.play().catch(() => {});
  } catch (e) { /* 忽略 */ }
}
document.querySelectorAll(".sfx").forEach((el) => {
  el.addEventListener("click", playClick);
});

/* ------------------------------------------------------------
   3) 手機版選單（漢堡按鈕）
------------------------------------------------------------ */
const navToggle = document.getElementById("navToggle");
const navLinks  = document.getElementById("navLinks");
if (navToggle && navLinks) {
  navToggle.addEventListener("click", () => navLinks.classList.toggle("open"));
  // 點連結後自動收起選單
  navLinks.querySelectorAll("a").forEach((a) =>
    a.addEventListener("click", () => navLinks.classList.remove("open"))
  );
}

/* ------------------------------------------------------------
   4) 滑動淡入：元素滑進畫面時才浮現
------------------------------------------------------------ */
const io = new IntersectionObserver(
  (entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
    });
  },
  { threshold: 0.15 }
);
document.querySelectorAll(".reveal").forEach((el) => io.observe(el));

/* ------------------------------------------------------------
   5) 首頁 Hero 飄落櫻花瓣（和風）
   - 只在首頁（有 id="heroFx" 的畫布）執行
   - 使用者若在系統開了「減少動態」，就不播放
   - 想調數量/顏色：改下面 COUNT 與 COLORS
------------------------------------------------------------ */
(function heroPetals() {
  const canvas = document.getElementById("heroFx");
  if (!canvas) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) return;

  const ctx = canvas.getContext("2d");
  const COUNT = 26;                                   // 花瓣數量（別太多，淡淡的就好）
  const COLORS = ["#e7a6b6", "#f0c3ce", "#d98a99"];   // 深淺不一的櫻色
  let w, h, petals;

  function resize() {
    w = canvas.width = canvas.offsetWidth;
    h = canvas.height = canvas.offsetHeight;
  }
  function seed() {
    petals = Array.from({ length: COUNT }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      s: Math.random() * 5 + 4,        // 大小
      a: Math.random() * 0.4 + 0.35,   // 透明度
      dy: Math.random() * 0.5 + 0.35,  // 落下速度
      sway: Math.random() * 0.8 + 0.3, // 左右擺幅
      rot: Math.random() * Math.PI,    // 旋轉角
      dr: (Math.random() - 0.5) * 0.03,
      ph: Math.random() * Math.PI * 2, // 擺動相位
      c: COLORS[Math.floor(Math.random() * COLORS.length)],
    }));
  }
  function drawPetal(p) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.globalAlpha = p.a;
    ctx.fillStyle = p.c;
    // 用兩段貝茲曲線畫一片花瓣
    ctx.beginPath();
    ctx.moveTo(0, -p.s);
    ctx.bezierCurveTo(p.s * 0.7, -p.s * 0.5, p.s * 0.5, p.s * 0.6, 0, p.s);
    ctx.bezierCurveTo(-p.s * 0.5, p.s * 0.6, -p.s * 0.7, -p.s * 0.5, 0, -p.s);
    ctx.fill();
    ctx.restore();
  }
  function frame() {
    ctx.clearRect(0, 0, w, h);
    for (const p of petals) {
      p.ph += 0.02;
      p.y += p.dy;
      p.x += Math.sin(p.ph) * p.sway;
      p.rot += p.dr;
      if (p.y > h + 12) { p.y = -12; p.x = Math.random() * w; }
      drawPetal(p);
    }
    ctx.globalAlpha = 1;
    requestAnimationFrame(frame);
  }
  resize(); seed(); frame();
  window.addEventListener("resize", () => { resize(); seed(); });
})();

/* ------------------------------------------------------------
   5) 相簿：點照片放大（燈箱 Lightbox）＋★2026-07-11 上一張／下一張
   - 只在有相簿照片的頁面作用，其他頁自動略過
   - 切換範圍＝同一條軌道（.car-track）；隱藏中的照片自動跳過；循環輪播
   - 關閉：右上角 ×、點灰色背景、Esc　　切換：左右箭頭鈕、鍵盤 ← →、手機左右滑
------------------------------------------------------------ */
(function () {
  /* 舊版（鐵則①保留備查）：頁面載入當下沒有 .photo 就整個略過——
     但 shop.html 的餐單卡是 Firebase 之後才動態渲染的，會被誤跳過
  const imgs = document.querySelectorAll(".photo .photo-frame img");
  if (!imgs.length) return;
  */
  // ★ 2026-07-12：有靜態照片「或」有餐單容器（#menuList，照片晚點才進來）都初始化；
  //   點擊走事件委派，動態新增的餐點照片自動有燈箱＋左右切換
  const imgs = document.querySelectorAll(".photo .photo-frame img");
  if (!imgs.length && !document.getElementById("menuList")) return;

  const lb = document.createElement("div");
  lb.className = "lightbox";
  lb.innerHTML =
    '<button class="lb-close" aria-label="關閉放大">×</button>' +
    '<button class="lb-nav prev" aria-label="上一張">‹</button>' +
    '<img class="lb-img" alt="" />' +
    '<button class="lb-nav next" aria-label="下一張">›</button>' +
    '<p class="lb-cap"></p>';
  document.body.appendChild(lb);

  const lbImg = lb.querySelector(".lb-img");
  const lbCap = lb.querySelector(".lb-cap");
  const closeBtn = lb.querySelector(".lb-close");
  const prevBtn = lb.querySelector(".lb-nav.prev");
  const nextBtn = lb.querySelector(".lb-nav.next");

  let group = [];      // 目前這條軌道可見的 .photo 清單
  let idx = 0;         // 目前顯示第幾張

  // 取某張照片所屬群組裡「目前可見」的照片（隱藏的跳過）
  // 相簿＝同一條 .car-track；餐單＝同一個 .menu-group；其餘退回全頁
  // ★ 2026-07-12：餐單細分前菜/主餐/甜點/飲料後，改以整個大分類（.menu-group）
  //   為切換範圍，左右切換才不會被小分類切得太碎（舊值＝.menu-grid，備查）
  function siblingsOf(fig) {
    const scope = fig.closest(".car-track, .menu-group, .room-grid") || document;
    return Array.from(scope.querySelectorAll(".photo"))
      .filter((p) => p.style.display !== "none" && p.querySelector(".photo-frame img"));
  }
  function showAt(i) {
    if (!group.length) return;
    idx = (i + group.length) % group.length;   // 循環
    const fig = group[idx];
    const img = fig.querySelector(".photo-frame img");
    const capEl = fig.querySelector(".cap");
    /* ★ 2026-07-14：換圖淡入淡出——先降透明，下一影格再升回（transition 在 style.css .lb-img） */
    lbImg.style.opacity = "0";
    lbImg.src = img.currentSrc || img.src;
    lbImg.alt = img.alt || "";
    requestAnimationFrame(() => requestAnimationFrame(() => { lbImg.style.opacity = "1"; }));
    lbCap.textContent = capEl ? capEl.textContent : "";
    const multi = group.length > 1;
    prevBtn.style.display = multi ? "" : "none";   // 只有一張就藏箭頭
    nextBtn.style.display = multi ? "" : "none";
  }
  function openFrom(fig) {
    group = siblingsOf(fig);
    const start = group.indexOf(fig);
    showAt(start < 0 ? 0 : start);
    lb.classList.add("open");
    document.body.style.overflow = "hidden";  // 放大時鎖住背景捲動
  }
  function closeLB() {
    lb.classList.remove("open");
    document.body.style.overflow = "";
    lbImg.removeAttribute("src");
    group = [];
  }

  // 事件委派——之後線上新增的照片也自動有燈箱
  document.addEventListener("click", function (e) {
    const img = e.target.closest(".photo .photo-frame img");
    if (!img || document.body.classList.contains("yjc-editing")) return;
    const fig = img.closest(".photo");
    if (fig) openFrom(fig);
  });
  closeBtn.addEventListener("click", closeLB);
  prevBtn.addEventListener("click", function (e) { e.stopPropagation(); showAt(idx - 1); });
  nextBtn.addEventListener("click", function (e) { e.stopPropagation(); showAt(idx + 1); });
  lb.addEventListener("click", function (e) { if (e.target === lb) closeLB(); }); // 點背景關閉
  document.addEventListener("keydown", function (e) {
    if (!lb.classList.contains("open")) return;
    if (e.key === "Escape") closeLB();
    else if (e.key === "ArrowLeft") showAt(idx - 1);
    else if (e.key === "ArrowRight") showAt(idx + 1);
  });
  // 手機左右滑動切換
  let sx = null;
  lb.addEventListener("touchstart", function (e) { sx = e.touches[0].clientX; }, { passive: true });
  lb.addEventListener("touchend", function (e) {
    if (sx === null) return;
    const dx = e.changedTouches[0].clientX - sx;
    if (Math.abs(dx) > 45) showAt(idx + (dx < 0 ? 1 : -1));
    sx = null;
  }, { passive: true });
})();

/* ------------------------------------------------------------
   6) 相簿跑馬燈：左右捲動 + 下方「第幾張 / 共幾張」計數
   - 左右箭頭、觸控滑動皆可；到頭/尾時箭頭變淡
   - 只在有 #galleryCarousel 的頁面作用
------------------------------------------------------------ */
/* 舊版（單一 #galleryCarousel，保留備查，鐵則①）：
(function () {
  const car = document.getElementById("galleryCarousel");
  if (!car) return;
  const track = car.querySelector(".car-track");
  const slides = Array.from(track.querySelectorAll(".photo"));
  const curEl = car.querySelector(".cur");
  const totalEl = car.querySelector(".total");
  const prev = car.querySelector(".prev");
  const next = car.querySelector(".next");
  if (!slides.length) return;
  if (totalEl) totalEl.textContent = slides.length;
  function currentIndex() {
    const center = track.scrollLeft + track.clientWidth / 2;
    let best = 0, bestDist = Infinity;
    slides.forEach(function (s, i) {
      const c = s.offsetLeft + s.offsetWidth / 2;
      const d = Math.abs(c - center);
      if (d < bestDist) { bestDist = d; best = i; }
    });
    return best;
  }
  ...（其餘同下方新版邏輯）...
})();
*/

// 新版：自動初始化頁面上「每個」 .carousel（相簿現在有上下兩排）
(function () {
  const cars = document.querySelectorAll(".carousel");
  if (!cars.length) return;
  cars.forEach(initCarousel);

  function initCarousel(car) {
    const track = car.querySelector(".car-track");
    if (!track) return;
    // 舊：const slides = Array.from(track.querySelectorAll(".photo"));（固定清單，線上增刪照片後會失準，保留備查）
    // 新：活清單——每次都重新數，線上新增／隱藏照片後計數與箭頭自動正確
    const slides = () => Array.from(track.querySelectorAll(".photo")).filter((s) => s.style.display !== "none");
    const curEl = car.querySelector(".cur");
    const totalEl = car.querySelector(".total");
    const prev = car.querySelector(".prev");
    const next = car.querySelector(".next");
    // 舊：if (!slides().length) return;（空軌道直接不初始化——線上加了照片也不會醒來，保留備查，鐵則①）
    // 新（2026-07-11）：空軌道也照常初始化＝「待命」；update() 用 is-empty 類別
    //   隱藏箭頭與計數、顯示「敬請期待」提示（.car-empty），第一張照片加入後自動醒來。

    function currentIndex() {
      const list = slides();
      if (!list.length) return 0;
      const center = track.scrollLeft + track.clientWidth / 2;
      let best = 0, bestDist = Infinity;
      list.forEach(function (s, i) {
        const c = s.offsetLeft + s.offsetWidth / 2;
        const d = Math.abs(c - center);
        if (d < bestDist) { bestDist = d; best = i; }
      });
      return best;
    }
    function update() {
      const list = slides();
      car.classList.toggle("is-empty", !list.length);   // 空軌道：藏箭頭計數、顯示敬請期待
      const i = currentIndex();
      if (totalEl) totalEl.textContent = list.length;
      if (curEl) curEl.textContent = Math.min(i + 1, list.length);
      if (prev) prev.disabled = i === 0;
      if (next) next.disabled = i >= list.length - 1;
    }
    function goTo(i) {
      const list = slides();
      i = Math.max(0, Math.min(list.length - 1, i));
      const s = list[i];
      if (!s) return;
      track.scrollTo({ left: s.offsetLeft - (track.clientWidth - s.offsetWidth) / 2, behavior: "smooth" });
    }
    if (prev) prev.addEventListener("click", function () { goTo(currentIndex() - 1); });
    if (next) next.addEventListener("click", function () { goTo(currentIndex() + 1); });
    let t;
    track.addEventListener("scroll", function () { clearTimeout(t); t = setTimeout(update, 80); });
    window.addEventListener("resize", update);
    document.addEventListener("yjc-overrides", update);   // 線上內容套用後重新計數
    update();
  }
})();

/* ------------------------------------------------------------
   7) 首頁時段背景：依「台灣時間」決定 清晨黃昏 / 白天 / 夜晚
   - 只在有 #homeBg 的首頁作用
   - 6:00-7:59、16:00-17:59 → 黃昏；8:00-15:59 → 白天；18:00-5:59 → 夜晚
------------------------------------------------------------ */
(function () {
  const el = document.getElementById("homeBg");
  if (!el) return;
  let hour;
  try {
    hour = parseInt(new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Taipei", hour: "numeric", hour12: false
    }).format(new Date()), 10);
  } catch (e) {
    hour = new Date().getHours();  // 萬一環境不支援時區，退回本機時間
  }
  if (hour === 24) hour = 0;
  let cls;
  if ((hour >= 6 && hour < 8) || (hour >= 16 && hour < 18)) cls = "is-dusk";
  else if (hour >= 8 && hour < 16) cls = "is-day";
  else cls = "is-night";
  el.classList.add(cls);
})();

/* ------------------------------------------------------------
   8) 關閉／離開網頁時，確保背景音樂停止（含手機切到背景、bfcache 情況）
------------------------------------------------------------ */
(function () {
  window.addEventListener("pagehide", function () {
    try { bgm.pause(); } catch (e) {}
  });
})();

/* ------------------------------------------------------------
   9) 內頁固定背景：多張時每 5 秒淡入淡出輪播（單張則不動作）
   - 只在有 #pageBg 且 .pbg-slide 超過一張的頁面作用（目前＝公會介紹）
   - 尊重系統「減少動態」：只顯示第一張、不輪播
------------------------------------------------------------ */
(function () {
  const bg = document.getElementById("pageBg");
  if (!bg) return;
  const slides = Array.from(bg.querySelectorAll(".pbg-slide"));
  if (slides.length < 2) return;                 // 單張背景不需要輪播
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) return;                            // 減少動態：維持第一張即可
  let i = 0;
  setInterval(function () {
    slides[i].classList.remove("is-on");
    i = (i + 1) % slides.length;
    slides[i].classList.add("is-on");
  }, 5000);                                      // 每 5 秒切下一張
})();

/* ------------------------------------------------------------
   10) 背景音樂音量滑桿（所有頁面）
   - 出現在右下角「♪ 音樂」鈕的上方
   - 音量記 localStorage，換頁沿用；預設沿用 BGM_VOLUME
------------------------------------------------------------ */
(function () {
  if (!audioBtn) return;
  const wrap = document.createElement("div");
  wrap.className = "vol-wrap";
  wrap.innerHTML =
    '<span class="vol-ico" aria-hidden="true">🔊</span>' +
    '<input type="range" class="vol-slider" min="0" max="100" step="1" aria-label="背景音樂音量" />';
  document.body.appendChild(wrap);
  const slider = wrap.querySelector("input");
  const saved = parseInt(localStorage.getItem("bgmVol"), 10);
  const v = Number.isFinite(saved) ? saved : Math.round(BGM_VOLUME * 100);
  slider.value = v;
  bgm.volume = v / 100;
  slider.addEventListener("input", function () {
    bgm.volume = slider.value / 100;
    localStorage.setItem("bgmVol", slider.value);
  });
})();

/* ------------------------------------------------------------
   11) 主題曲歌詞跑馬燈（只在有 #lyricsTrack 的頁面作用＝公會介紹）
   - 歌詞由下往上連續捲動（內容自動複製一份接在後面，無縫循環）
   - 跟著音樂走：音樂播放時捲動、暫停時停住（body.bgm-on）
   - 捲動速度：每句約 3.4 秒，句數多寡自動換算（想調快慢改這個數字）
------------------------------------------------------------ */
(function () {
  const setCls = (on) => document.body.classList.toggle("bgm-on", on);
  bgm.addEventListener("play",  () => setCls(true));
  bgm.addEventListener("pause", () => setCls(false));
  setCls(!bgm.paused);

  const track = document.getElementById("lyricsTrack");
  if (!track) return;
  const SEC_PER_LINE = 3.4;
  const lines = track.children.length;
  track.innerHTML += track.innerHTML;              // 複製一份 → 無縫循環
  track.style.animationDuration = (lines * SEC_PER_LINE) + "s";

  // 音樂開始後隱藏「點右下角聆聽」提示
  const hint = document.getElementById("lyricsHint");
  if (hint) bgm.addEventListener("play", () => { hint.style.display = "none"; });
})();

/* ------------------------------------------------------------
   12) 公會介紹「日常」迷你輪播：頁面上每個 .about-slides 各自輪播
   - 每張 3 秒（想調快慢改 SLIDE_MS）、1 秒淡入淡出
   - 圖說（figcaption）跟著照片換（取 img 的 data-cap，沒有就用 alt）
   - 尊重「減少動態」：停在第一張
------------------------------------------------------------ */
(function () {
  const SLIDE_MS = 3000;
  const boxes = document.querySelectorAll(".about-slides");
  if (!boxes.length) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  boxes.forEach(function (box) {
    // 舊：const imgs = box.querySelectorAll("img");（固定清單，保留備查）
    // 新：活清單——線上新增／隱藏照片後輪播自動跟上
    const live = () => Array.from(box.querySelectorAll("img:not([data-yjc-hidden])"));
    const fig  = box.closest("figure");
    const cap  = fig ? fig.querySelector("figcaption") : null;
    if (cap) cap.style.transition = "opacity .3s ease";   /* ★ 2026-07-14：圖說換字淡入淡出 */
    const setCap = (im) => {
      if (!cap || !im) return;
      cap.style.opacity = "0";
      setTimeout(function () {
        cap.textContent = im.dataset.cap || im.alt || "";
        cap.style.opacity = "1";
      }, 280);
    };
    /* 舊版備查：const setCap = (im) => { if (cap && im) cap.textContent = im.dataset.cap || im.alt || ""; }; */
    let list = live();
    if (!list.length) return;
    list[0].classList.add("is-on");
    setCap(list[0]);
    if (reduce) return;
    let i = 0;
    setInterval(function () {
      list = live();
      if (list.length < 2) return;
      list.forEach((im) => im.classList.remove("is-on"));
      i = (i + 1) % list.length;
      list[i].classList.add("is-on");
      setCap(list[i]);
    }, SLIDE_MS);
  });
})();

/* ------------------------------------------------------------
   13) 歌詞平滑捲動引擎（取代第 11 段的 CSS 動畫；11 段仍負責
       複製歌詞做無縫循環、隱藏提示、bgm-on 狀態）
   - 速率以「整首歌 3 分 20 秒」估算：一輪歌詞恰好 200 秒捲完，
     歌曲與歌詞盡量同時結束；每次歌曲重頭，歌詞也回到第一句
   - 音樂播放時自動往上捲；滑鼠拖曳／滾輪／觸控可自由看整份歌詞，
     放開約 1.2 秒後自動接續上捲；無縫循環不會捲到底
------------------------------------------------------------ */
(function () {
  const view  = document.querySelector(".lyrics-view");
  const track = document.getElementById("lyricsTrack");
  if (!view || !track) return;
  const SONG_SECONDS = 200;   // ★ 整首歌 3 分 20 秒＝200 秒：歌詞恰好在這段時間內捲完一輪（想微調快慢改這個數字）
  let paused = false, resumeT = null, dragging = false, startY = 0, startTop = 0;
  let pos = 0;                // ★ 用 JS 變數累積捲動量（scrollTop 只收整數，直接 += 小數會被捨去＝之前不會動的原因）

  const halfH = () => track.scrollHeight / 2;             // 內容有複製一份，一半＝一輪
  const speed = () => halfH() / (SONG_SECONDS * 1000);    // px / 毫秒：一輪歌詞 ÷ 一首歌的時間

  let last = performance.now();
  (function step(now) {
    const dt = Math.min(now - last, 100); last = now;      // 分頁切走再回來不暴衝
    const h = halfH();
    const autoOn = !paused && !dragging && document.body.classList.contains("bgm-on");
    if (autoOn) {
      pos += speed() * dt;
      if (h > 0) { if (pos >= h) pos -= h; else if (pos < 0) pos += h; }
      view.scrollTop = pos;                                // 整數化交給瀏覽器，pos 保留小數繼續累積
    } else {
      // 玩家手動捲動中：跟著實際位置走，放開後從這裡續捲
      if (h > 0 && !dragging) {                            // 拖曳中不跳接縫，放開才處理（避免位置打架）
        if (view.scrollTop >= h) view.scrollTop -= h;
        else if (view.scrollTop < 0) view.scrollTop += h;
      }
      pos = view.scrollTop;
    }
    requestAnimationFrame(step);
  })(last);

  // 歌曲每播完一輪（loop 重頭），歌詞回到第一句重新對齊
  let lastTime = 0;
  bgm.addEventListener("timeupdate", function () {
    if (bgm.currentTime < lastTime - 2 && !dragging) { pos = 0; view.scrollTop = 0; }
    lastTime = bgm.currentTime;
  });

  function pauseThenResume() {
    paused = true; clearTimeout(resumeT);
    resumeT = setTimeout(() => { paused = false; last = performance.now(); }, 1200);
  }
  // 滑鼠拖曳（觸控用原生捲動即可）
  view.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "mouse") return;
    dragging = true; startY = e.clientY; startTop = view.scrollTop;
    view.setPointerCapture(e.pointerId); view.classList.add("grabbing");
    e.preventDefault();
  });
  view.addEventListener("pointermove", (e) => {
    if (dragging) view.scrollTop = startTop - (e.clientY - startY);
  });
  ["pointerup", "pointercancel"].forEach((ev) =>
    view.addEventListener(ev, () => {
      if (!dragging) return;
      dragging = false; view.classList.remove("grabbing"); pauseThenResume();
    })
  );
  view.addEventListener("wheel", pauseThenResume, { passive: true });
  view.addEventListener("touchmove", pauseThenResume, { passive: true });
})();

/* ------------------------------------------------------------
   14) RP 商店「店員名簿」燈箱：點長條照片 → 放大看完整原圖
        ＋★2026-07-11 上一張／下一張
        ＋★2026-07-14 v8 改版：單張放大 → 「店員特寫面板」
          同時橫列該店員最多 3 張照片，每張下方顯示 🎭 完整身分
          （data-cap）＋簡介（data-desc；沒填由文青預設句補上）
   - 只在有 #staffList 的頁面（shop.html）作用
   - 卡片由 firebase-app.js 第 13 段動態產生 → 用事件委派，
     之後線上新增／編輯的店員照片也自動有燈箱
   - ‹ ›＝切換上一位／下一位店員（有照片者循環）；沿用 .lightbox 樣式
   - 關閉：右上 ×、點背景、Esc　　切換：左右箭頭鈕、鍵盤 ← →、手機左右滑
------------------------------------------------------------ */
(function () {
  if (!document.getElementById("staffList")) return;

  const lb = document.createElement("div");
  lb.className = "lightbox staff-lb";
  lb.innerHTML =
    '<button class="lb-close" aria-label="關閉放大">×</button>' +
    '<button class="lb-nav prev" aria-label="上一位">‹</button>' +
    '<div class="staff-lb-panel">' +
    '  <p class="staff-lb-title"></p>' +
    '  <div class="staff-lb-strip"></div>' +
    '</div>' +
    '<button class="lb-nav next" aria-label="下一位">›</button>';
  document.body.appendChild(lb);

  const panel = lb.querySelector(".staff-lb-panel");
  const title = lb.querySelector(".staff-lb-title");
  const strip = lb.querySelector(".staff-lb-strip");
  const prevBtn = lb.querySelector(".lb-nav.prev");
  const nextBtn = lb.querySelector(".lb-nav.next");

  let group = [];   // 有照片的 .staff-photo 清單
  let idx = 0;

  function photoBoxes() {
    return Array.from(document.querySelectorAll("#staffList .staff-photo"))
      .filter((b) => b.querySelector("img"));   // 「印」佔位（無照片）不列入
  }
  /* 沒填簡介時的預設句（依照片序輪替；有身分者以身分開場） */
  const FALLBACK = [
    "帳中一影，靜候有緣人入席。",
    "光影流轉，換個角度又是另一段緣。",
    "茶煙裊裊之間，等一句攀談。",
  ];
  function escT(s) {
    return String(s || "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function showAt(i) {
    if (!group.length) return;
    idx = (i + group.length) % group.length;    // 循環
    const box = group[idx];
    const name = box.dataset.name || "";
    const role = box.dataset.role || "";
    /* ★ 淡入淡出：面板整塊先降透明，內容換好再升回（transition 在 style.css） */
    panel.style.opacity = "0";
    const imgs = Array.from(box.querySelectorAll("img")).slice(0, 3);   // 最多 3 張
    title.textContent = name && role ? name + " · " + role : name;
    strip.innerHTML = imgs.map(function (im, n) {
      const cap = (im.dataset.cap || "").trim();
      const desc = (im.dataset.desc || "").trim()
        || (cap ? "以「" + cap + "」之姿在帳中恭候——攀談一句，故事便開始。" : FALLBACK[n % FALLBACK.length]);
      return '<figure>' +
        '<img src="' + (im.currentSrc || im.src) + '" alt="' + escT(im.alt || name) + '" />' +
        (cap ? '<p class="staff-lb-cap">🎭 ' + escT(cap) + '</p>' : '') +
        '<p class="staff-lb-desc">' + escT(desc) + '</p>' +
        '</figure>';
    }).join("");
    requestAnimationFrame(function () { requestAnimationFrame(function () { panel.style.opacity = "1"; }); });
    const multi = group.length > 1;
    prevBtn.style.display = multi ? "" : "none";
    nextBtn.style.display = multi ? "" : "none";
  }
  function openFrom(box) {
    group = photoBoxes();
    const start = group.indexOf(box);
    showAt(start < 0 ? 0 : start);
    lb.classList.add("open");
    document.body.style.overflow = "hidden";
  }
  function closeLB() {
    lb.classList.remove("open");
    document.body.style.overflow = "";
    strip.innerHTML = "";
    group = [];
  }

  document.addEventListener("click", function (e) {
    if (e.target.closest(".staff-dots")) return;   // 點指示點不觸發燈箱
    const box = e.target.closest("#staffList .staff-photo");
    if (!box || !box.querySelector("img")) return;
    openFrom(box);
  });
  lb.querySelector(".lb-close").addEventListener("click", closeLB);
  prevBtn.addEventListener("click", function (e) { e.stopPropagation(); showAt(idx - 1); });
  nextBtn.addEventListener("click", function (e) { e.stopPropagation(); showAt(idx + 1); });
  lb.addEventListener("click", function (e) { if (e.target === lb) closeLB(); });
  document.addEventListener("keydown", function (e) {
    if (!lb.classList.contains("open")) return;
    if (e.key === "Escape") closeLB();
    else if (e.key === "ArrowLeft") showAt(idx - 1);
    else if (e.key === "ArrowRight") showAt(idx + 1);
  });
  let sx = null;
  lb.addEventListener("touchstart", function (e) { sx = e.touches[0].clientX; }, { passive: true });
  lb.addEventListener("touchend", function (e) {
    if (sx === null) return;
    const dx = e.changedTouches[0].clientX - sx;
    if (Math.abs(dx) > 45) showAt(idx + (dx < 0 ? 1 : -1));
    sx = null;
  }, { passive: true });
})();

/* ------------------------------------------------------------
   15) RP 商店：計費小算盤＋社群入口列（只在 shop.html 作用）
   - 小算盤公式：客人數 × 店員數 × 時長(盞) × 指名費 ＋ 包廂費
     （★ 2026-07-12：一盞＝20 分鐘，由 30 分鐘改制；公式本身不變）
   - 單價讀自帶 data-price-name／data-price-room 的欄位文字，
     管理員線上改數字後即時反映（每次算都重讀，所以改完就生效）
   - 社群列：href 還停在「#」的按鈕自動隱藏（噗浪／Threads 未開通時）
------------------------------------------------------------ */
(function () {
  // (a) 計費小算盤
  const calc = document.getElementById("shopCalc");
  if (calc) {
    const parseNum = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return NaN;
      const n = parseInt((el.textContent || "").replace(/[^\d]/g, ""), 10);
      return Number.isFinite(n) ? n : NaN;
    };
    const g = document.getElementById("calcGuests");
    const s = document.getElementById("calcStaff");
    const d = document.getElementById("calcDur");
    const r = document.getElementById("calcRoom");
    const out = document.getElementById("calcTotal");
    const fmt = (n) => n.toLocaleString("en-US");
    function recalc() {
      const nameFee = parseNum("[data-price-name]");
      const roomFee = parseNum("[data-price-room]");
      // 單價還沒填（顯示「—」）時，先不給數字，提示管理員填價
      if (!Number.isFinite(nameFee)) { out.textContent = "價目待公告"; return; }
      const guests = Math.max(1, parseInt(g.value, 10) || 1);
      const staff  = Math.max(1, parseInt(s.value, 10) || 1);
      const dur    = Math.max(1, parseInt(d.value, 10) || 1);
      let total = guests * staff * dur * nameFee;
      if (r.checked && Number.isFinite(roomFee)) total += roomFee;
      out.textContent = fmt(total);
    }
    [g, s, d, r].forEach((el) => { el.addEventListener("input", recalc); el.addEventListener("change", recalc); });
    recalc();
    // 管理員線上改完價目後，點空白處失焦時重算一次
    document.addEventListener("click", function (e) {
      if (e.target.closest("[data-price-name],[data-price-room]")) return;
      setTimeout(recalc, 50);
    });
  }

  // (b) 社群入口列：未填網址（href 仍為 #）的按鈕自動隱藏
  document.querySelectorAll(".social-row [data-social]").forEach(function (a) {
    const href = a.getAttribute("href") || "";
    if (!href || href === "#") a.style.display = "none";
  });
})();
