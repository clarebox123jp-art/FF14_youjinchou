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
   5) 相簿：點照片放大（燈箱 Lightbox），可關閉
   - 只在有相簿照片的頁面作用，其他頁自動略過
   - 關閉方式：右上角 ×、點灰色背景、按 Esc
------------------------------------------------------------ */
(function () {
  const imgs = document.querySelectorAll(".photo .photo-frame img");
  if (!imgs.length) return;

  const lb = document.createElement("div");
  lb.className = "lightbox";
  lb.innerHTML =
    '<button class="lb-close" aria-label="關閉放大">×</button>' +
    '<img class="lb-img" alt="" />' +
    '<p class="lb-cap"></p>';
  document.body.appendChild(lb);

  const lbImg = lb.querySelector(".lb-img");
  const lbCap = lb.querySelector(".lb-cap");
  const closeBtn = lb.querySelector(".lb-close");

  function openLB(src, alt, cap) {
    lbImg.src = src;
    lbImg.alt = alt || "";
    lbCap.textContent = cap || "";
    lb.classList.add("open");
    document.body.style.overflow = "hidden"; // 放大時鎖住背景捲動
  }
  function closeLB() {
    lb.classList.remove("open");
    document.body.style.overflow = "";
    lbImg.removeAttribute("src");
  }

  imgs.forEach(function (img) {
    img.addEventListener("click", function () {
      const fig = img.closest(".photo");
      const capEl = fig ? fig.querySelector(".cap") : null;
      openLB(img.currentSrc || img.src, img.alt, capEl ? capEl.textContent : "");
    });
  });
  closeBtn.addEventListener("click", closeLB);
  lb.addEventListener("click", function (e) { if (e.target === lb) closeLB(); }); // 點背景關閉
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && lb.classList.contains("open")) closeLB();
  });
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
    function update() {
      const i = currentIndex();
      if (curEl) curEl.textContent = i + 1;
      if (prev) prev.disabled = i === 0;
      if (next) next.disabled = i === slides.length - 1;
    }
    function goTo(i) {
      i = Math.max(0, Math.min(slides.length - 1, i));
      const s = slides[i];
      track.scrollTo({ left: s.offsetLeft - (track.clientWidth - s.offsetWidth) / 2, behavior: "smooth" });
    }
    if (prev) prev.addEventListener("click", function () { goTo(currentIndex() - 1); });
    if (next) next.addEventListener("click", function () { goTo(currentIndex() + 1); });
    let t;
    track.addEventListener("scroll", function () { clearTimeout(t); t = setTimeout(update, 80); });
    window.addEventListener("resize", update);
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
    const imgs = box.querySelectorAll("img");
    const fig  = box.closest("figure");
    const cap  = fig ? fig.querySelector("figcaption") : null;
    const setCap = (i) => { if (cap) cap.textContent = imgs[i].dataset.cap || imgs[i].alt || ""; };
    if (!imgs.length) return;
    imgs[0].classList.add("is-on");
    setCap(0);
    if (imgs.length < 2 || reduce) return;
    let i = 0;
    setInterval(function () {
      imgs[i].classList.remove("is-on");
      i = (i + 1) % imgs.length;
      imgs[i].classList.add("is-on");
      setCap(i);
    }, SLIDE_MS);
  });
})();
