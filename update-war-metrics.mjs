#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "data");
const METRICS_PATH = path.join(DATA_DIR, "war-metrics.json");
const SOURCES_PATH = path.join(DATA_DIR, "sources.json");
const OVERRIDES_PATH = path.join(DATA_DIR, "manual-overrides.json");

const DEFAULTS = {
  operation: { name: "Operation Epic Fury", start: "2026-02-28T00:00:00Z" },
  cost: {
    baselineUsd: 11300000000,
    baselineWindowDays: 6,
    ongoingPerDayUsd: 1000000000,
    method: "baseline_plus_daily_burn"
  },
  casualties: {
    us: { killed: 7, wounded: 140 },
    iranMilitary: { killedMin: 2094, killedMax: 2300 },
    iranCivilians: { killedMin: 1255, woundedMin: 12000 }
  }
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const nowIso = () => new Date().toISOString();

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, "utf8")); }
  catch { return fallback; }
}
async function writeJson(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(data, null, 2) + "\n", "utf8");
}
function daysSince(iso) {
  return Math.max(0, (Date.now() - new Date(iso).getTime()) / 86400000);
}
function estimateCost(cost, startIso) {
  const ongoingDays = Math.max(0, daysSince(startIso) - cost.baselineWindowDays);
  return Math.round(cost.baselineUsd + ongoingDays * cost.ongoingPerDayUsd);
}
function mergeDeep(base, patch) {
  if (!patch || typeof patch !== "object") return base;
  const out = { ...base };
  for (const k of Object.keys(patch)) {
    out[k] =
      patch[k] && typeof patch[k] === "object" && !Array.isArray(patch[k])
        ? mergeDeep(base[k] || {}, patch[k])
        : patch[k];
  }
  return out;
}

async function fetchJson(url, retries = 3) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": "clearview-updater" } });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
      await sleep(700 * (i + 1));
    }
  }
  throw lastErr;
}

// Brent: Yahoo quote endpoint
async function getBrentPatch() {
  const url = "https://query1.finance.yahoo.com/v7/finance/quote?symbols=BZ=F";
  const json = await fetchJson(url);
  const q = json?.quoteResponse?.result?.[0];
  if (!q) throw new Error("No Brent quote");
  return {
    brentUsdPerBbl: Number(q.regularMarketPrice),
    brentChangePct24h: Number(q.regularMarketChangePercent),
    asOf: nowIso()
  };
}

// Gas: FRED weekly US regular gas
async function getGasPatch() {
  const res = await fetch("https://fred.stlouisfed.org/graph/fredgraph.csv?id=GASREGW");
  if (!res.ok) throw new Error(`FRED ${res.status}`);
  const text = await res.text();
  const rows = text.trim().split("\n").slice(1).filter(Boolean);
  const last = rows[rows.length - 1]?.split(",");
  const prev = rows[rows.length - 2]?.split(",");
  const val = Number(last?.[1]);
  const prevVal = Number(prev?.[1]);
  return {
    usGasNationalAvgUsd: val,
    usGasChangeSinceStartUsd: Number.isFinite(prevVal) ? +(val - prevVal).toFixed(2) : 0,
    gasSeriesDate: last?.[0],
    asOf: nowIso()
  };
}

async function main() {
  const existing = await readJson(METRICS_PATH, {});
  const overrides = await readJson(OVERRIDES_PATH, {});

  const operation = mergeDeep(DEFAULTS.operation, existing.operation || {});
  const cost = mergeDeep(DEFAULTS.cost, existing.cost || {});
  const casualties = mergeDeep(DEFAULTS.casualties, existing.casualties || {});
  let energy = existing.energy || {};

  try { energy = { ...energy, ...(await getGasPatch()) }; }
  catch (e) { console.warn("gas fetch failed:", e.message); }

  try { energy = { ...energy, ...(await getBrentPatch()) }; }
  catch (e) { console.warn("brent fetch failed:", e.message); }

  let metrics = {
    lastUpdated: nowIso(),
    operation,
    cost: { ...cost, estimatedTotalUsd: estimateCost(cost, operation.start) },
    casualties,
    energy,
    ui: { showRanges: true, currency: "USD" }
  };

  // manual overrides win
  metrics = mergeDeep(metrics, overrides);

  const sources = await readJson(SOURCES_PATH, {
    lastUpdated: nowIso(),
    sources: [
      {
        id: "pentagon-congress-briefing",
        label: "Pentagon briefing to Congress (reported by NYT)",
        url: "https://www.nytimes.com/2026/03/11/world/middleeast/iran-war-costs-pentagon.html",
        category: "cost",
        priority: "primary"
      },
      {
        id: "dod-centcom",
        label: "DoD / CENTCOM official releases",
        url: "https://www.centcom.mil/MEDIA/PRESS-RELEASES/",
        category: "us_casualties",
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
        id: "yahoo-brent",
        label: "Yahoo Finance Brent (BZ=F)",
        url: "https://finance.yahoo.com/quote/BZ=F/",
        category: "oil",
        priority: "primary"
      }
    ]
  });

  sources.lastUpdated = nowIso();

  await writeJson(METRICS_PATH, metrics);
  await writeJson(SOURCES_PATH, sources);

  console.log("Updated war-metrics.json + sources.json");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
