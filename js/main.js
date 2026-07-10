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
   5) 首頁 Hero 飄動光點（妖光 / 螢火感）
   - 只在首頁（有 id="heroFx" 的畫布）執行
   - 使用者若在系統開了「減少動態」，就不播放
   - 想調數量/顏色：改下面 COUNT 與 COLORS
------------------------------------------------------------ */
(function heroLights() {
  const canvas = document.getElementById("heroFx");
  if (!canvas) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) return;

  const ctx = canvas.getContext("2d");
  const COUNT = 46;                                   // 光點數量
  const COLORS = ["#7fd6c8", "#c9a45c", "#e7a6b6"];   // 妖光青 / 金 / 櫻
  let w, h, dots;

  function resize() {
    w = canvas.width = canvas.offsetWidth;
    h = canvas.height = canvas.offsetHeight;
  }
  function seed() {
    dots = Array.from({ length: COUNT }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      r: Math.random() * 2 + 0.6,
      a: Math.random() * 0.6 + 0.15,
      dx: (Math.random() - 0.5) * 0.25,
      dy: -(Math.random() * 0.35 + 0.08),
      tw: Math.random() * Math.PI * 2,
      c: COLORS[Math.floor(Math.random() * COLORS.length)],
    }));
  }
  function frame() {
    ctx.clearRect(0, 0, w, h);
    for (const d of dots) {
      d.x += d.dx; d.y += d.dy; d.tw += 0.03;
      if (d.y < -10) { d.y = h + 10; d.x = Math.random() * w; }
      if (d.x < -10) d.x = w + 10;
      if (d.x > w + 10) d.x = -10;
      const flick = d.a * (0.6 + 0.4 * Math.sin(d.tw));
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
      ctx.fillStyle = d.c;
      ctx.globalAlpha = flick;
      ctx.shadowBlur = 8; ctx.shadowColor = d.c;
      ctx.fill();
    }
    ctx.globalAlpha = 1; ctx.shadowBlur = 0;
    requestAnimationFrame(frame);
  }
  resize(); seed(); frame();
  window.addEventListener("resize", () => { resize(); seed(); });
})();
