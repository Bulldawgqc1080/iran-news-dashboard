#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "data");
const METRICS_PATH = path.join(DATA_DIR, "war-metrics.json");
const SOURCES_PATH = path.join(DATA_DIR, "sources.json");
const OVERRIDES_PATH = path.join(DATA_DIR, "manual-overrides.json");

const nowIso = () => new Date().toISOString();

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJson(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function isStale(asOf, hours = 48) {
  if (!asOf) return true;
  const t = new Date(asOf).getTime();
  if (!Number.isFinite(t)) return true;
  return Date.now() - t > hours * 3600 * 1000;
}

function daysSince(iso) {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, (Date.now() - t) / 86400000);
}

function estimateCost(cost, startIso) {
  const baselineUsd = Number(cost?.baselineUsd || 0);
  const baselineWindowDays = Number(cost?.baselineWindowDays || 0);
  const ongoingPerDayUsd = Number(cost?.ongoingPerDayUsd || 0);
  const ongoingDays = Math.max(0, daysSince(startIso) - baselineWindowDays);
  return Math.round(baselineUsd + ongoingDays * ongoingPerDayUsd);
}

function mergeDeep(base, patch) {
  if (!patch || typeof patch !== "object") return base;
  const out = { ...(base || {}) };
  for (const k of Object.keys(patch)) {
    const pv = patch[k];
    if (pv && typeof pv === "object" && !Array.isArray(pv)) {
      out[k] = mergeDeep(out[k] || {}, pv);
    } else {
      out[k] = pv;
    }
  }
  return out;
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { "user-agent": "clearview-updater" } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function getBrentPatch() {
  const res = await fetch("https://oilprice.com/oil-price-charts/45", {
    headers: { "user-agent": "Mozilla/5.0 clearview-updater" }
  });
  if (!res.ok) throw new Error(`Brent page ${res.status}`);
  const html = await res.text();

  const rowMatch = html.match(/Brent Crude<\/span>[\s\S]{0,500}?<td class='last_price' data-price='([0-9]+(?:\.[0-9]+)?)'>[\s\S]{0,200}?percent_change_cell'>([+-][0-9]+(?:\.[0-9]+)?)%/i);
  if (!rowMatch) throw new Error("No Brent quote found in page");

  const price = Number(rowMatch[1]);
  if (!Number.isFinite(price)) throw new Error("Invalid Brent quote");

  const changePct = Number(rowMatch[2]);

  return {
    brentUsdPerBbl: price,
    brentChangePct24h: Number.isFinite(changePct) ? changePct : null,
    brentSource: "oilprice-brent",
    asOf: nowIso()
  };
}

async function getGasPatch(startIso) {
  const res = await fetch("https://fred.stlouisfed.org/graph/fredgraph.csv?id=GASREGW");
  if (!res.ok) throw new Error(`FRED ${res.status}`);
  const text = await res.text();
  const rows = text.trim().split("\n").slice(1).filter(Boolean)
    .map(line => {
      const [date, value] = line.split(",");
      return { date, value: Number(value) };
    })
    .filter(r => Number.isFinite(r.value));

  const last = rows[rows.length - 1];
  if (!last) throw new Error("No gas rows");

  const startTs = new Date(startIso).getTime();
  let baseline = rows[0];
  if (Number.isFinite(startTs)) {
    baseline = rows.find(r => new Date(r.date).getTime() >= startTs) || rows[rows.length - 1];
  }

  return {
    usGasNationalAvgUsd: last.value,
    usGasChangeSinceStartUsd: +(last.value - baseline.value).toFixed(2),
    gasSeriesDate: last.date,
    gasBaselineDate: baseline.date,
    gasSource: "fred-gasregw",
    asOf: nowIso()
  };
}

function wordToNum(w) {
  const m = {
    zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5,
    six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    eleven: 11, twelve: 12
  };
  return m[String(w || "").toLowerCase()];
}

function toNum(x) {
  if (x == null) return null;
  const n = Number(x);
  if (Number.isFinite(n)) return n;
  const w = wordToNum(x);
  return Number.isFinite(w) ? w : null;
}

async function getCentcomUsCasualtyPatch(existingCasualties) {
  const rssUrl = "https://www.centcom.mil/DesktopModules/ArticleCS/RSS.ashx?ContentType=2&Site=808&isdashboardselected=0&max=20";
  const res = await fetch(rssUrl, { headers: { "user-agent": "clearview-updater" } });
  if (!res.ok) throw new Error(`CENTCOM RSS ${res.status}`);
  const xml = await res.text();

  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => m[1]);

  let bestKilled = Number(existingCasualties?.us?.killed?.value || 0);
  let bestDate = null;

  for (const item of items) {
    const title = (item.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || "").replace(/<!\[CDATA\[|\]\]>/g, "");
    const desc = (item.match(/<description>([\s\S]*?)<\/description>/i)?.[1] || "")
      .replace(/<!\[CDATA\[|\]\]>/g, "")
      .replace(/<[^>]+>/g, " ");
    const pubDate = (item.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1] || "").trim();

    const text = `${title} ${desc}`.replace(/\s+/g, " ").toLowerCase();
    if (!/(u\.s\.|us |service member|crew member|centcom)/i.test(text)) continue;

    const p1 = text.match(/all\s+([a-z0-9]+)\s+(?:crew|service)\s+members?.{0,180}(?:are\s+)?(?:now\s+)?(?:confirmed\s+deceased|killed)/i);
    const p2 = text.match(/([a-z0-9]+)\s+confirmed\s+deceased/i);
    const p3 = text.match(/\b([0-9]+)\s+(?:u\.s\.\s+)?(?:service\s+members?|troops?|personnel|crew)\s+killed\b/i);

    const cands = [p1?.[1], p2?.[1], p3?.[1]].map(toNum).filter(Number.isFinite);
    if (!cands.length) continue;

    const localMax = Math.max(...cands);
    if (bestKilled == null || localMax > bestKilled) {
      bestKilled = localMax;
      bestDate = pubDate ? new Date(pubDate).toISOString() : nowIso();
    }
  }

  if (!Number.isFinite(bestKilled)) throw new Error("No US killed figure found in CENTCOM RSS");

  return {
    us: {
      killed: {
        value: bestKilled,
        asOf: bestDate || nowIso(),
        sourceId: "dod-centcom-rss",
        confidence: "high"
      },
      wounded: {
        ...(existingCasualties?.us?.wounded || {}),
        sourceId: "dod-centcom-rss",
        confidence: "medium",
        asOf: existingCasualties?.us?.wounded?.asOf || nowIso()
      }
    }
  };
}

async function main() {
  const existing = await readJson(METRICS_PATH, {});
  const overrides = await readJson(OVERRIDES_PATH, {});

  const defaults = {
    operation: { name: "Operation Epic Fury", start: "2026-02-28T00:00:00Z" },
    cost: {
      baselineUsd: 11300000000,
      baselineWindowDays: 6,
      ongoingPerDayUsd: 1000000000,
      method: "baseline_plus_daily_burn"
    },
    casualties: {
      us: {
        killed: { value: 13, asOf: "2026-03-13T12:00:00Z", sourceId: "dod-centcom", confidence: "high" },
        wounded: { value: 140, asOf: "2026-03-13T12:00:00Z", sourceId: "dod-centcom", confidence: "high" }
      },
      iranMilitary: {
        killed: {
          minReported: 2094,
          maxReported: 2300,
          asOf: "2026-03-13T12:00:00Z",
          sourceIds: ["acled", "reuters"],
          confidence: "medium"
        }
      },
      iranCivilians: {
        killed: {
          minReported: 1255,
          maxReported: 1800,
          asOf: "2026-03-13T12:00:00Z",
          sourceIds: ["ocha", "icrc", "msf"],
          confidence: "medium"
        },
        wounded: {
          minReported: 12000,
          maxReported: 16500,
          asOf: "2026-03-13T12:00:00Z",
          sourceIds: ["ocha", "unhcr"],
          confidence: "medium"
        }
      }
    }
  };

  const operation = mergeDeep(defaults.operation, existing.operation || {});
  const cost = mergeDeep(defaults.cost, existing.cost || {});
  let casualties = mergeDeep(defaults.casualties, existing.casualties || {});

  casualties.us.killed.value = Math.max(
    Number(defaults.casualties.us.killed.value || 0),
    Number(casualties?.us?.killed?.value || 0)
  );

  let energy = existing.energy || {};
  const lastGoodEnergy = existing.energy || {};

  try {
    energy = { ...energy, ...(await getGasPatch(operation.start)) };
  } catch (e) {
    console.warn("gas fetch failed:", e.message);
    energy = { ...energy, ...lastGoodEnergy };
  }

  try {
    energy = { ...energy, ...(await getBrentPatch()) };
  } catch (e) {
    console.warn("brent fetch failed:", e.message);
    energy = { ...energy, ...lastGoodEnergy };
  }

  try {
    const usPatch = await getCentcomUsCasualtyPatch(casualties);
    casualties = mergeDeep(casualties, usPatch);
  } catch (e) {
    console.warn("CENTCOM casualty fetch failed:", e.message);
  }


  // Normalize legacy casualty fields so UI and data use "reported" semantics.
  for (const path of [
    ["iranMilitary", "killed"],
    ["iranCivilians", "killed"],
    ["iranCivilians", "wounded"]
  ]) {
    const obj = casualties?.[path[0]]?.[path[1]];
    if (!obj) continue;
    if (obj.minReported == null && obj.minConfirmed != null) obj.minReported = obj.minConfirmed;
    delete obj.minConfirmed;
  }

  let metrics = {
    lastUpdated: nowIso(),
    operation,
    cost: {
      ...cost,
      estimatedTotalUsd: estimateCost(cost, operation.start)
    },
    casualties,
    energy,
    quality: {
      generatedAt: nowIso(),
      staleThresholdHours: 48,
      casualties: {
        usStale: isStale(casualties?.us?.killed?.asOf, 48),
        iranMilitaryStale: isStale(casualties?.iranMilitary?.killed?.asOf, 48),
        iranCiviliansStale: isStale(casualties?.iranCivilians?.killed?.asOf, 48)
      },
      energy: { stale: isStale(energy?.asOf, 48) }
    },
    ui: { showRanges: true, currency: "USD" }
  };

  metrics = mergeDeep(metrics, overrides);

  const sources = {
    lastUpdated: nowIso(),
    sources: [
      {
        id: "dod-centcom",
        label: "DoD / CENTCOM official releases",
        url: "https://www.centcom.mil/MEDIA/PRESS-RELEASES/",
        category: "us_casualties",
        priority: "primary"
      },
      {
        id: "ocha",
        label: "UN OCHA situation reports",
        url: "https://www.unocha.org/publications",
        category: "civilian_casualties",
        priority: "primary"
      },
      {
        id: "unhcr",
        label: "UNHCR operational updates",
        url: "https://www.unhcr.org/operational-data-and-statistics",
        category: "displacement_wounded_context",
        priority: "primary"
      },
      {
        id: "fred-gasregw",
        label: "FRED GASREGW",
        url: "https://fred.stlouisfed.org/series/GASREGW",
        category: "gas_price",
        priority: "primary"
      },
      {
        id: "oilprice-brent",
        label: "OilPrice Brent Crude",
        url: "https://oilprice.com/oil-price-charts/45",
        category: "oil",
        priority: "secondary"
      }
    ]
  };

  await writeJson(METRICS_PATH, metrics);
  await writeJson(SOURCES_PATH, sources);

  console.log("Updated war-metrics.json + sources.json");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
