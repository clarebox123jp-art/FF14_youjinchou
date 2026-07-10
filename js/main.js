/* ============================================================
   公會網站共用程式  main.js
   負責：背景音樂開關、按鍵音效、手機選單、滑動淡入

   ★★★ 新手設定區：換音樂／音效檔案改這兩行 ★★★
   把你的檔案放進 audio/ 資料夾，改成你的檔名即可。
   ============================================================ */
const BGM_SRC   = "audio/bgm.mp3";     // 背景音樂（自己放一首進 audio/）
const CLICK_SRC = "audio/click.mp3";   // 按鍵音效（已附一個範例，可換）
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
