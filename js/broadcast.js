/* =========================================================================
   ZAHROUN — Broadcast banner
   ========================================================================= */

import { db } from "./firebase-config.js";
import { getDoc, doc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

function hexToRgba(hex, alpha) {
  if (!hex || hex.length < 7) return `rgba(255,255,255,${alpha.toFixed(2)})`;
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${alpha.toFixed(2)})`;
}

(async function showBroadcast() {
  try {
    // sessionStorage cache — broadcast changes infrequently; avoid a Firestore read on every page
    const _BC_KEY = 'zhr_bc_v2';
    const _BC_TTL = 5 * 60 * 1000; // 5 minutes
    let d = null;
    try {
      const raw = sessionStorage.getItem(_BC_KEY);
      if (raw) {
        const { data, ts } = JSON.parse(raw);
        if (Date.now() - ts < _BC_TTL) d = data;
      }
    } catch {}
    if (!d) {
      const snap = await getDoc(doc(db, "settings", "broadcast"));
      if (!snap.exists()) { sessionStorage.setItem(_BC_KEY, JSON.stringify({ data: null, ts: Date.now() })); return; }
      d = snap.data();
      try { sessionStorage.setItem(_BC_KEY, JSON.stringify({ data: d, ts: Date.now() })); } catch {}
    }
    if (!d) return;
    if (!d.enabled) return;

    const isCarouselType = d.type === "carousel" && Array.isArray(d.carouselMessages) && d.carouselMessages.length > 0;
    if (!isCarouselType && !d.message) return;

    const dismissKey  = "bc_v_" + (d.updatedAt?.seconds || "0");
    if (localStorage.getItem(dismissKey)) return;

    // Close button visibility (default: true)
    const dismissible = d.dismissible !== false;

    // ── Carousel mode ────────────────────────────────────────────────────
    if (isCarouselType) {
      const msgs         = d.carouselMessages;
      const bg           = d.bgColor || "#111111";
      const fg           = d.fgColor || "#ffffff";
      const intervalSecs = typeof d.carouselInterval === "number" ? d.carouselInterval : 4;
      let idx = 0;

      const bar = document.createElement("div");
      bar.id = "zahroun-bc-bar";
      bar.setAttribute("role", "banner");
      bar.style.cssText = [
        "position:fixed;top:0;left:0;right:0;z-index:99999",
        `background:${bg};color:${fg}`,
        "font-family:var(--font-sans,'Inter',sans-serif);font-size:.87rem",
        `padding:.4rem ${dismissible ? "3rem" : "2.5rem"}`,
        "display:flex;align-items:center;justify-content:center",
        "min-height:40px;overflow:hidden"
      ].join(";");

      const arrowCss = `position:absolute;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;font-size:1.15rem;font-weight:700;color:${fg};opacity:.75;padding:.2rem .7rem;z-index:3;line-height:1;`;
      const prevBtn = document.createElement("button");
      prevBtn.setAttribute("aria-label", "Previous");
      prevBtn.style.cssText = arrowCss + "left:.35rem;";
      prevBtn.innerHTML = "&#8249;";

      const nextBtn = document.createElement("button");
      nextBtn.setAttribute("aria-label", "Next");
      nextBtn.style.cssText = arrowCss + `right:${dismissible ? "2.2rem" : ".35rem"};`;
      nextBtn.innerHTML = "&#8250;";

      const msgEl = document.createElement("span");
      msgEl.style.cssText = "position:relative;z-index:1;text-align:center;padding:0 .5rem;transition:opacity .25s ease;";
      msgEl.textContent = msgs[0];

      function goTo(n) {
        idx = ((n % msgs.length) + msgs.length) % msgs.length;
        msgEl.style.opacity = "0";
        setTimeout(() => { msgEl.textContent = msgs[idx]; msgEl.style.opacity = "1"; }, 260);
      }

      let timer = null;
      function resetTimer() {
        clearInterval(timer);
        if (intervalSecs > 0) timer = setInterval(() => goTo(idx + 1), intervalSecs * 1000);
      }

      prevBtn.onclick = () => { goTo(idx - 1); resetTimer(); };
      nextBtn.onclick = () => { goTo(idx + 1); resetTimer(); };
      bar.appendChild(prevBtn);
      bar.appendChild(msgEl);
      bar.appendChild(nextBtn);

      const headerElC = document.querySelector(".header");

      if (dismissible) {
        const closeBtn = document.createElement("button");
        closeBtn.setAttribute("aria-label", "Dismiss");
        closeBtn.innerHTML = "&#x2715;";
        closeBtn.style.cssText = `position:absolute;right:.55rem;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;color:${fg};font-size:.95rem;line-height:1;padding:.2rem .4rem;opacity:.65;z-index:3;`;
        closeBtn.addEventListener("click", () => {
          clearInterval(timer);
          const barH = bar.offsetHeight || 0;
          bar.remove();
          if (headerElC) headerElC.style.top = "0px";
          const cp = parseFloat(document.body.style.paddingTop) || parseFloat(getComputedStyle(document.body).paddingTop);
          document.body.style.paddingTop = Math.max(0, cp - barH) + "px";
          localStorage.setItem(dismissKey, "1");
        });
        bar.appendChild(closeBtn);
      }

      document.body.insertBefore(bar, document.body.firstChild);
      document.dispatchEvent(new CustomEvent("zahroun-bc-appeared"));

      // Re-layout whenever the bar's height changes — web-font load or viewport
      // resize can reflow the text after the first measurement, which left the
      // header offset stale (bar overlapping header until a refresh).
      const layoutBarC = () => {
        const barH = bar.isConnected ? (bar.offsetHeight || 40) : 0;
        if (headerElC) headerElC.style.top = barH + "px";
        const hdrH = headerElC ? headerElC.offsetHeight : (window.innerWidth <= 768 ? 68 : 78);
        document.body.style.paddingTop = (barH + hdrH) + "px";
      };
      requestAnimationFrame(layoutBarC);
      if (window.ResizeObserver) new ResizeObserver(layoutBarC).observe(bar);
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => layoutBarC());
      window.addEventListener("resize", layoutBarC);

      if (intervalSecs > 0) timer = setInterval(() => goTo(idx + 1), intervalSecs * 1000);
      return;
    }

    // ── Normal (non-carousel) mode ───────────────────────────────────────
    const PRESETS = {
      promo:   { bg: "#111111", fg: "#D4AF37" },
      info:    { bg: "#1a3c5e", fg: "#ffffff"  },
      emerald: { bg: "#1ADFE2", fg: "#111111"  },
      warning: { bg: "#6b1a2a", fg: "#ffffff"  }
    };
    const preset = PRESETS[d.type] || PRESETS.promo;
    const bg = d.bgColor || preset.bg;
    const fg = d.fgColor || preset.fg;

    // Intensity: support legacy string and new number (1-100)
    const INTENSITIES = { low: 0.10, normal: 0.25, high: 0.42, max: 0.65 };
    const rawIntensity = d.effectIntensity;
    const intensity    = typeof rawIntensity === "number" ? rawIntensity / 100 : (INTENSITIES[rawIntensity] || 0.25);
    const effectColor  = d.effectColor || "#ffffff";
    const effectArea   = d.effectArea  || "inside";
    const eHigh = hexToRgba(effectColor, intensity);
    const eLow  = hexToRgba(effectColor, intensity * 0.40);
    const eGlow = hexToRgba(effectColor, intensity * 1.90);

    const showBeam  = effectArea === "inside" || effectArea === "both";
    const showOuter = effectArea === "outside" || effectArea === "both" || effectArea === "edge-rim" || effectArea === "ambient" || effectArea === "bottom-line";

    // Speed
    const SPEEDS  = { slow: 2.2, normal: 1.0, fast: 0.48, vfast: 0.25 };
    const bgMult  = SPEEDS[d.bgSpeed]   || 1;
    const txtMult = SPEEDS[d.textSpeed] || 1;

    const BG_BASE   = { shimmer: 2.6, "shimmer-fast": 0.75, "golden-glow": 1.9, glass: 4.0, neon: 1.8 };
    const TEXT_BASE = {
      ticker: 16, "ticker-r": 16,
      "slide-left": 4.5, "slide-right": 4.5, "slide-top": 4.5, "slide-bottom": 4.5,
      fade: 4.5, bounce: 4.5, flip: 4.5, blink: 1.0
    };

    const bgAnim  = d.animation || "none";
    const txtAnim = d.textAnim  || "none";
    const bgDur   = ((BG_BASE[bgAnim]    || 2)   * bgMult).toFixed(2);
    const txtDur  = ((TEXT_BASE[txtAnim] || 4.5) * txtMult).toFixed(2);

    // Inject CSS
    const styleEl = document.createElement("style");
    styleEl.textContent = `
      @keyframes bc-beam-sw { from{transform:translateX(-120%)} to{transform:translateX(300%)} }
      @keyframes bc-beam-gl { from{transform:translateX(-120%) skewX(-12deg)} to{transform:translateX(300%) skewX(-12deg)} }
      @keyframes bc-gglow   {
        0%,100%{box-shadow:0 2px 12px 3px ${eLow},inset 0 0 10px ${eLow}}
        50%    {box-shadow:0 4px 28px 9px ${eHigh},inset 0 0 28px ${eHigh}}
      }
      @keyframes bc-neon    { 0%,100%{filter:brightness(1) saturate(1);opacity:1} 50%{filter:brightness(1.45) saturate(1.4);opacity:.88} }
      @keyframes bc-ticker  { from{left:101%} to{left:-101%} }
      @keyframes bc-tickerr { from{left:-101%} to{left:101%} }
      @keyframes bc-slidel  { 0%,8%{transform:translateX(-120%);opacity:0} 18%,78%{transform:translateX(0);opacity:1} 90%,100%{transform:translateX(120%);opacity:0} }
      @keyframes bc-slider  { 0%,8%{transform:translateX(120%);opacity:0}  18%,78%{transform:translateX(0);opacity:1} 90%,100%{transform:translateX(-120%);opacity:0} }
      @keyframes bc-slidet  { 0%,8%{transform:translateY(-200%);opacity:0} 18%,78%{transform:translateY(0);opacity:1} 90%,100%{transform:translateY(200%);opacity:0} }
      @keyframes bc-slideb  { 0%,8%{transform:translateY(200%);opacity:0}  18%,78%{transform:translateY(0);opacity:1} 90%,100%{transform:translateY(-200%);opacity:0} }
      @keyframes bc-fade    { 0%,8%{opacity:0} 18%,78%{opacity:1} 90%,100%{opacity:0} }
      @keyframes bc-bounce  { 0%,8%{transform:translateY(-200%) scale(.5);opacity:0} 20%{transform:translateY(12%) scale(1.08)} 28%,78%{transform:translateY(0) scale(1);opacity:1} 90%,100%{transform:scale(.4);opacity:0} }
      @keyframes bc-flip    { 0%,8%{transform:rotateX(-90deg);opacity:0} 20%,78%{transform:rotateX(0deg);opacity:1} 90%,100%{transform:rotateX(90deg);opacity:0} }
      @keyframes bc-blink   { 0%,49%{opacity:1} 50%,99%{opacity:0} }
    `;
    document.head.appendChild(styleEl);

    // Build bar
    const bar = document.createElement("div");
    bar.id = "zahroun-bc-bar";
    bar.setAttribute("role", "banner");
    bar.style.cssText = [
      "position:fixed;top:0;left:0;right:0;z-index:99999",
      `background:${bg};color:${fg}`,
      "font-family:var(--font-sans,'Inter',sans-serif);font-size:.87rem",
      `padding:.55rem ${dismissible ? "3rem" : "1.5rem"}`,
      "display:flex;align-items:center;justify-content:center",
      "line-height:1.5;min-height:38px",
      "clip-path:inset(-80px -80px 0 -80px)",
      showBeam ? "overflow:hidden" : ""
    ].filter(Boolean).join(";");

    // Background animation
    if (bgAnim === "shimmer" || bgAnim === "shimmer-fast") {
      if (showBeam) {
        const beam = document.createElement("span");
        beam.style.cssText = [
          "position:absolute;top:0;width:42%;height:100%;pointer-events:none;z-index:2",
          `background:linear-gradient(90deg,transparent,${eHigh},transparent)`,
          `animation:bc-beam-sw ${bgDur}s ease-in-out infinite`
        ].join(";");
        bar.appendChild(beam);
      }
      if (showOuter) bar.style.boxShadow = `0 3px 20px 5px ${eGlow}`;
    } else if (bgAnim === "glass") {
      if (showBeam) {
        const beam = document.createElement("span");
        beam.style.cssText = [
          "position:absolute;top:0;width:42%;height:100%;pointer-events:none;z-index:2",
          `background:linear-gradient(105deg,transparent 35%,${eHigh} 48%,${eLow} 55%,transparent 68%)`,
          "transform:skewX(-10deg)",
          `animation:bc-beam-gl ${bgDur}s ease-in-out infinite 1.5s`
        ].join(";");
        bar.appendChild(beam);
      }
      if (showOuter) bar.style.boxShadow = `0 3px 20px 5px ${eGlow}`;
    } else if (bgAnim === "golden-glow") {
      bar.style.animation = `bc-gglow ${bgDur}s ease-in-out infinite`;
      if (showOuter) bar.style.boxShadow = `0 3px 20px 5px ${eGlow}`;
    } else if (bgAnim === "neon") {
      bar.style.animation = `bc-neon ${bgDur}s ease-in-out infinite`;
      if (showOuter) bar.style.boxShadow = `0 3px 20px 5px ${eGlow}`;
    }

    // Premium effect area styles
    if (effectArea === "edge-rim") {
      styleEl.textContent += `@keyframes bc-rim{0%,100%{box-shadow:0 0 0 1.5px ${eHigh},inset 0 0 0 1.5px ${eLow},0 0 10px 3px ${eGlow}}50%{box-shadow:0 0 0 2px ${eGlow},inset 0 0 0 1.5px ${eHigh},0 0 20px 8px ${eGlow}}}`;
      const prev = bar.style.animation;
      bar.style.animation = prev ? `${prev},bc-rim ${bgDur}s ease-in-out infinite` : `bc-rim ${bgDur}s ease-in-out infinite`;
    } else if (effectArea === "bottom-line") {
      styleEl.textContent += `@keyframes bc-bline{0%,100%{opacity:.5;left:20%;right:20%}50%{opacity:1;left:5%;right:5%}}`;
      const line = document.createElement("div");
      line.style.cssText = `position:absolute;bottom:0;left:5%;right:5%;height:2px;border-radius:99px;background:${eHigh};box-shadow:0 -5px 14px 5px ${eGlow};pointer-events:none;z-index:3;animation:bc-bline ${bgDur}s ease-in-out infinite;`;
      bar.appendChild(line);
    } else if (effectArea === "ambient") {
      const a1 = hexToRgba(effectColor, Math.min(intensity * 1.3, 0.92));
      const a2 = hexToRgba(effectColor, intensity * 0.6);
      const a3 = hexToRgba(effectColor, intensity * 0.22);
      styleEl.textContent += `@keyframes bc-ambient{0%,100%{box-shadow:0 0 16px 5px ${a2},0 0 32px 12px ${a3},inset 0 0 16px ${hexToRgba(effectColor,intensity*0.1)}}50%{box-shadow:0 0 28px 10px ${a1},0 0 52px 20px ${a2},inset 0 0 28px ${hexToRgba(effectColor,intensity*0.2)}}}`;
      const prev = bar.style.animation;
      bar.style.animation = prev ? `${prev},bc-ambient ${bgDur}s ease-in-out infinite` : `bc-ambient ${bgDur}s ease-in-out infinite`;
    }

    // Content wrapper
    const isTicker = txtAnim === "ticker" || txtAnim === "ticker-r";
    const center   = document.createElement("div");
    center.style.cssText = isTicker
      ? "position:absolute;white-space:nowrap;display:flex;align-items:center;gap:.65rem;z-index:1;"
      : "display:flex;align-items:center;gap:.65rem;flex-wrap:wrap;justify-content:center;position:relative;z-index:1;";

    const msgSpan = document.createElement("span");
    msgSpan.textContent = d.message;
    center.appendChild(msgSpan);

    if (d.link && d.linkText) {
      const a = document.createElement("a");
      a.href = d.link;
      a.textContent = d.linkText;
      a.style.cssText = `color:${fg};font-weight:700;text-decoration:underline;white-space:nowrap;`;
      center.appendChild(a);
    }

    // Text animation
    const TMAP = {
      "slide-left":   "bc-slidel", "slide-right":  "bc-slider",
      "slide-top":    "bc-slidet", "slide-bottom": "bc-slideb",
      fade: "bc-fade", bounce: "bc-bounce", flip: "bc-flip", blink: "bc-blink"
    };
    if (isTicker) {
      center.style.animation = `${txtAnim === "ticker" ? "bc-ticker" : "bc-tickerr"} ${txtDur}s linear infinite`;
    } else if (TMAP[txtAnim]) {
      center.style.animation = `${TMAP[txtAnim]} ${txtDur}s ease-in-out infinite`;
    }
    bar.appendChild(center);

    // Close button (only if dismissible)
    const headerEl = document.querySelector(".header");
    if (dismissible) {
      const closeBtn = document.createElement("button");
      closeBtn.setAttribute("aria-label", "Dismiss");
      closeBtn.innerHTML = "&#x2715;";
      closeBtn.style.cssText = [
        "position:absolute;right:.85rem;top:50%;transform:translateY(-50%)",
        "background:none;border:none;cursor:pointer",
        `color:${fg}`,
        "font-size:1rem;line-height:1;padding:.2rem .4rem;opacity:.75;z-index:3"
      ].join(";");
      closeBtn.addEventListener("click", () => {
        const barH = bar.offsetHeight || 0;
        bar.remove();
        if (headerEl) headerEl.style.top = "0px";
        const cp = parseFloat(document.body.style.paddingTop) || parseFloat(getComputedStyle(document.body).paddingTop);
        document.body.style.paddingTop = Math.max(0, cp - barH) + "px";
        localStorage.setItem(dismissKey, "1");
      });
      bar.appendChild(closeBtn);
    }

    document.body.insertBefore(bar, document.body.firstChild);

    // Re-layout whenever the bar's height changes — web-font load or viewport
    // resize can reflow the text after the first measurement, which left the
    // header offset stale (bar overlapping header until a refresh).
    const layoutBar = () => {
      const barH = bar.isConnected ? (bar.offsetHeight || 36) : 0;
      if (headerEl) headerEl.style.top = barH + "px";
      const hdrH = headerEl ? headerEl.offsetHeight : (window.innerWidth <= 768 ? 68 : 78);
      document.body.style.paddingTop = (barH + hdrH) + "px";
    };
    requestAnimationFrame(() => {
      layoutBar();
      document.dispatchEvent(new CustomEvent("zahroun-bc-appeared"));
    });
    if (window.ResizeObserver) new ResizeObserver(layoutBar).observe(bar);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => layoutBar());
    window.addEventListener("resize", layoutBar);

  } catch {
    // Broadcast is optional — fail silently
  }
})();

/* ── Promo notification bar (free shipping / tiered discount progress) ── */
(function initPromoNotifBar() {
  const BAR_ID = '_zahroun-promo-notif';

  function getOrCreateBar() {
    let bar = document.getElementById(BAR_ID);
    if (!bar) {
      bar = document.createElement('div');
      bar.id = BAR_ID;
      bar.style.cssText = [
        'position:fixed;bottom:0;left:0;right:0;z-index:99990',
        'display:flex;flex-direction:column;gap:0;pointer-events:none',
        'font-family:var(--font-sans,"Inter",sans-serif)'
      ].join(';');
      document.body.appendChild(bar);
    }
    return bar;
  }

  function buildRows(fsInfo, tierInfo) {
    const rows = [];
    if (fsInfo && !fsInfo.achieved) {
      const pct = Math.min(100, Math.round(((fsInfo.threshold - fsInfo.remaining) / fsInfo.threshold) * 100));
      rows.push(`<div style="background:#163E34;color:#fff;padding:.45rem 1rem;font-size:.8rem;font-weight:600;display:flex;align-items:center;gap:.5rem;">
        <span style="flex:1;">🚚 Spend Tk ${fsInfo.remaining} more for FREE delivery!</span>
        <div style="width:120px;background:rgba(255,255,255,.25);border-radius:4px;height:5px;overflow:hidden;flex-shrink:0;">
          <div style="background:#fff;height:5px;width:${pct}%;border-radius:4px;transition:width .5s;"></div>
        </div>
      </div>`);
    } else if (fsInfo?.achieved) {
      rows.push(`<div style="background:#1e7e34;color:#fff;padding:.4rem 1rem;font-size:.8rem;font-weight:600;">✅ You qualify for FREE delivery!</div>`);
    }
    if (tierInfo?.next && !tierInfo.current) {
      rows.push(`<div style="background:#e65100;color:#fff;padding:.4rem 1rem;font-size:.8rem;font-weight:600;">🏷️ Spend Tk ${tierInfo.remaining} more to get ${tierInfo.next.pct}% off!</div>`);
    } else if (tierInfo?.current) {
      const extra = tierInfo.next ? ` — spend Tk ${tierInfo.remaining} more for ${tierInfo.next.pct}%` : '';
      rows.push(`<div style="background:#1a56b8;color:#fff;padding:.4rem 1rem;font-size:.8rem;font-weight:600;">🎉 ${tierInfo.current.pct}% discount applied!${extra}</div>`);
    }
    return rows.join('');
  }

  window.addEventListener('zahroun-cart-promo', async (e) => {
    const P = window.ZahrounPromos;
    const bar = getOrCreateBar();
    const { fsInfo, subtotal } = e.detail || {};
    let tierInfo = null;
    if (P) tierInfo = await P.getTierProgress(subtotal || 0).catch(() => null);
    const html = buildRows(fsInfo, tierInfo);
    bar.innerHTML = html;
    bar.style.display = html ? '' : 'none';
    // Auto-hide after 8 seconds
    clearTimeout(bar._hideTimer);
    if (html) bar._hideTimer = setTimeout(() => { bar.innerHTML = ''; bar.style.display = 'none'; }, 8000);
  });
})();
