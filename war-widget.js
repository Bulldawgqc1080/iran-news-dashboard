(function () {
  const CONFIG = {
    mountId: "war-widget",
    metricsUrl: "./war-metrics.json",
    sourcesUrl: "./sources.json",
    refreshMs: 60 * 60 * 1000,
    tickerFps: 4,
    locale: "en-US",
    currency: "USD"
  };

  const $ = (s, r = document) => r.querySelector(s);
  const fmtInt = (n) => new Intl.NumberFormat(CONFIG.locale).format(Math.round(Number(n || 0)));
  const fmtMoney0 = (n) => new Intl.NumberFormat(CONFIG.locale, { style: "currency", currency: CONFIG.currency, maximumFractionDigits: 0 }).format(Number(n || 0));
  const fmtMoney2 = (n) => new Intl.NumberFormat(CONFIG.locale, { style: "currency", currency: CONFIG.currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n || 0));

  function estimate(cost, startIso) {
    const start = new Date(startIso).getTime();
    if (!Number.isFinite(start)) return Number(cost?.estimatedTotalUsd || 0);
    const days = Math.max(0, (Date.now() - start) / 86400000);
    const ongoingDays = Math.max(0, days - Number(cost?.baselineWindowDays || 0));
    return Number(cost?.baselineUsd || 0) + ongoingDays * Number(cost?.ongoingPerDayUsd || 0);
  }

  function range(min, max) {
    const a = Number(min), b = Number(max);
    if (Number.isFinite(a) && Number.isFinite(b) && b > a) return `${fmtInt(a)}–${fmtInt(b)}`;
    if (Number.isFinite(a)) return `${fmtInt(a)}+`;
    if (Number.isFinite(b)) return fmtInt(b);
    return "—";
  }

  async function getJson(url) {
    const r = await fetch(url + (url.includes("?") ? "&" : "?") + "t=" + Date.now(), { cache: "no-store" });
    if (!r.ok) throw new Error(`${url} ${r.status}`);
    return r.json();
  }

  const style = document.createElement("style");
  style.textContent = `
  .ww-wrap{font-family:Inter,system-ui,sans-serif;background:#0d131b;border:1px solid #273142;border-radius:12px;padding:14px;color:#e9edf1}
  .ww-head{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap}
  .ww-title{font-size:1.1rem;font-weight:700}
  .ww-chip{font-size:.78rem;background:#1a2230;border:1px solid #2d3b51;border-radius:999px;padding:4px 10px;color:#b8c7da}
  .ww-cost{font-size:1.8rem;font-weight:800;margin-top:10px}
  .ww-sub{color:#93a8c1;font-size:.85rem;margin-top:2px}
  .ww-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:12px}
  @media (max-width:760px){.ww-grid{grid-template-columns:1fr}}
  .ww-card{background:#111927;border:1px solid #273142;border-radius:10px;padding:10px}
  .ww-label{font-size:.8rem;color:#9bb0c8;margin-bottom:5px}
  .ww-val{font-size:1.05rem;font-weight:700}
  .ww-muted{font-size:.78rem;color:#8ea4be;margin-top:4px}
  .ww-sources{margin-top:12px;font-size:.85rem}
  .ww-sources ul{margin:6px 0 0 18px}
  .ww-sources a{color:#8ec5ff;text-decoration:none}
  .ww-sources a:hover{text-decoration:underline}
  `;
  document.head.appendChild(style);

  const mount = document.getElementById(CONFIG.mountId);
  if (!mount) return;

  mount.innerHTML = `
    <section class="ww-wrap">
      <div class="ww-head">
        <div class="ww-title" id="ww-title">War Cost Tracker</div>
        <div class="ww-chip" id="ww-updated">Loading…</div>
      </div>
      <div class="ww-cost" id="ww-cost">$0</div>
      <div class="ww-sub" id="ww-method"></div>
      <div class="ww-grid">
        <div class="ww-card"><div class="ww-label">U.S. Service Members</div><div class="ww-val">Killed: <span id="ww-us-k">—</span></div><div class="ww-val">Wounded: <span id="ww-us-w">—</span></div></div>
        <div class="ww-card"><div class="ww-label">Iran / Others</div><div class="ww-val">Military killed: <span id="ww-im-k">—</span></div><div class="ww-val">Civilian killed: <span id="ww-ic-k">—</span></div><div class="ww-val">Civilian wounded: <span id="ww-ic-w">—</span></div></div>
        <div class="ww-card"><div class="ww-label">U.S. Gas</div><div class="ww-val" id="ww-gas">—</div><div class="ww-muted" id="ww-gasd">—</div></div>
        <div class="ww-card"><div class="ww-label">Brent</div><div class="ww-val" id="ww-brent">—</div><div class="ww-muted" id="ww-brentd">—</div></div>
      </div>
      <div class="ww-sources"><strong>Sources</strong><ul id="ww-sources"></ul></div>
    </section>
  `;

  let costPerSec = 0;
  setInterval(() => {
    const el = $("#ww-cost");
    const curr = Number(el?.dataset?.v || 0);
    if (!el || !Number.isFinite(curr) || !costPerSec) return;
    const next = curr + costPerSec / CONFIG.tickerFps;
    el.dataset.v = String(next);
    el.textContent = fmtMoney0(next);
  }, 1000 / CONFIG.tickerFps);

  async function refresh() {
    try {
      const [m, s] = await Promise.all([getJson(CONFIG.metricsUrl), getJson(CONFIG.sourcesUrl)]);
      const total = estimate(m.cost || {}, m.operation?.start);
      costPerSec = Number(m.cost?.ongoingPerDayUsd || 0) / 86400;

      $("#ww-title").textContent = (m.operation?.name || "War") + " Cost Tracker";
      $("#ww-updated").textContent = `Updated ${new Date(m.lastUpdated || Date.now()).toLocaleString(CONFIG.locale)}`;
      const c = $("#ww-cost");
      c.dataset.v = String(total);
      c.textContent = fmtMoney0(total);
      $("#ww-method").textContent = `Model: ${fmtMoney0(m.cost?.baselineUsd)} first ${m.cost?.baselineWindowDays || 0} days + ${fmtMoney0(m.cost?.ongoingPerDayUsd)}/day ongoing`;

      $("#ww-us-k").textContent = fmtInt(m.casualties?.us?.killed);
      $("#ww-us-w").textContent = fmtInt(m.casualties?.us?.wounded);
      $("#ww-im-k").textContent = range(m.casualties?.iranMilitary?.killedMin, m.casualties?.iranMilitary?.killedMax);
      $("#ww-ic-k").textContent = range(m.casualties?.iranCivilians?.killedMin, m.casualties?.iranCivilians?.killedMax);
      $("#ww-ic-w").textContent = range(m.casualties?.iranCivilians?.woundedMin, m.casualties?.iranCivilians?.woundedMax);

      const gas = m.energy?.usGasNationalAvgUsd;
      const gd = m.energy?.usGasChangeSinceStartUsd;
      $("#ww-gas").textContent = Number.isFinite(gas) ? `${fmtMoney2(gas)}/gal` : "—";
      $("#ww-gasd").textContent = Number.isFinite(gd) ? `Since start: ${gd >= 0 ? "+" : ""}${fmtMoney2(gd)}` : "—";

      const brent = m.energy?.brentUsdPerBbl;
      const bd = m.energy?.brentChangePct24h;
      $("#ww-brent").textContent = Number.isFinite(brent) ? `${fmtMoney2(brent)}/bbl` : "—";
      $("#ww-brentd").textContent = Number.isFinite(bd) ? `24h: ${bd >= 0 ? "+" : ""}${Number(bd).toFixed(1)}%` : "—";

      const ul = $("#ww-sources");
      ul.innerHTML = "";
      (s.sources || []).forEach(src => {
        const li = document.createElement("li");
        const a = document.createElement("a");
        a.href = src.url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.textContent = src.label || src.url;
        li.appendChild(a);
        ul.appendChild(li);
      });
    } catch (e) {
      const u = $("#ww-updated");
      if (u) u.textContent = "Widget failed to load data";
      console.error("war-widget error", e);
    }
  }

  refresh();
  setInterval(refresh, CONFIG.refreshMs);
})();
