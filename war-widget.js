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
.ww-wrap{
font-family:var(--font-body, Inter, system-ui, sans-serif);
background:var(--surface, #111520);
border:1px solid var(--border, #252b47);
border-radius:var(--radius, 10px);
padding:16px;
color:var(--text, #e8eaf6);
}
.ww-head{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap}
.ww-title{font-size:1rem;font-weight:700;letter-spacing:.3px;text-transform:uppercase;color:var(--dim,#4a5270);font-family:var(--font-mono,monospace)}
.ww-chip{
font-size:.72rem;
background:var(--surface2,#1a1f33);
border:1px solid var(--border2,#2e3557);
border-radius:999px;
padding:4px 10px;
color:var(--subtext,#8892b0);
font-family:var(--font-mono,monospace);
}
.ww-cost{
font-size:2rem;
font-weight:800;
margin-top:10px;
color:#ff4d4d;
letter-spacing:.5px;
}
.ww-sub{
color:var(--subtext,#8892b0);
font-size:.8rem;
margin-top:4px;
font-family:var(--font-mono,monospace);
}
.ww-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:12px}
@media (max-width:760px){.ww-grid{grid-template-columns:1fr}}
.ww-card{
background:var(--surface2,#1a1f33);
border:1px solid var(--border,#252b47);
border-radius:8px;
padding:12px;
}
.ww-label{
font-size:.72rem;
color:var(--dim,#4a5270);
margin-bottom:6px;
text-transform:uppercase;
letter-spacing:.8px;
font-family:var(--font-mono,monospace);
}
.ww-val{font-size:1rem;font-weight:700}
.ww-muted{font-size:.78rem;color:var(--subtext,#8892b0);margin-top:4px}
.ww-sources{
margin-top:12px;
font-size:.82rem;
border-top:1px solid var(--border,#252b47);
padding-top:10px;
}
.ww-sources strong{
font-size:.72rem;
text-transform:uppercase;
color:var(--dim,#4a5270);
letter-spacing:.8px;
font-family:var(--font-mono,monospace);
}
.ww-sources ul{margin:8px 0 0 18px}
.ww-sources a{color:#ff6b6b;text-decoration:none}
.ww-sources a:hover{text-decoration:underline}
.ww-trend-up{color:#ff6b6b;font-weight:700}
.ww-trend-down{color:#4dcc88;font-weight:700}
.ww-trend-flat{color:#8892b0;font-weight:700}
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
      const brent = m.energy?.brentUsdPerBbl;
      const bd = m.energy?.brentChangePct24h;

      const gasTrendClass = Number.isFinite(gd) ? (gd > 0 ? "ww-trend-up" : gd < 0 ? "ww-trend-down" : "ww-trend-flat") : "";
      const gasArrow = Number.isFinite(gd) ? (gd > 0 ? "▲" : gd < 0 ? "▼" : "→") : "";
      $("#ww-gas").textContent = Number.isFinite(gas) ? `${fmtMoney2(gas)}/gal` : "—";
      $("#ww-gasd").innerHTML = Number.isFinite(gd)
      ? `<span class="${gasTrendClass}">${gasArrow}</span> Since start: ${gd >= 0 ? "+" : ""}${fmtMoney2(gd)}`
      : "—";
      
      const brentTrendClass = Number.isFinite(bd) ? (bd > 0 ? "ww-trend-up" : bd < 0 ? "ww-trend-down" : "ww-trend-flat") : "";
      const brentArrow = Number.isFinite(bd) ? (bd > 0 ? "▲" : bd < 0 ? "▼" : "→") : "";
      $("#ww-brent").textContent = Number.isFinite(brent) ? `${fmtMoney2(brent)}/bbl` : "—";
      $("#ww-brentd").innerHTML = Number.isFinite(bd)
      ? `<span class="${brentTrendClass}">${brentArrow}</span> 24h: ${bd >= 0 ? "+" : ""}${Number(bd).toFixed(1)}%`
      : "—";
      
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
