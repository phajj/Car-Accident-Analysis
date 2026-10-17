"use strict";
// Statistics for the injury-risk app: CSV parsing, binned injury rates, and
// design-based (Taylor-series linearization) variance tools kept for model fitting.
// Works in the browser (window.Stats) and in Node (require).

(function (root) {
  // ---------- CSV ----------

  // Minimal RFC 4180 parser (handles quoted fields with commas / escaped quotes).
  function parseCSV(text) {
    const out = [];
    let row = [], field = "", inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else field += c;
      } else if (c === '"') inQuotes = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field); out.push(row); row = []; field = "";
      } else field += c;
    }
    if (field !== "" || row.length) { row.push(field); out.push(row); }
    return out;
  }

  // Convert a parsed table to records {x, y, w, stratum, psu}.
  // Baseline outcome: deaths count as injuries; unknown injury (not a death) is dropped.
  // `filter(get)` optionally restricts rows; `study` prefixes strata/PSUs so two
  // independent surveys can be pooled (NHTSA's STUDY stratification variable).
  function toRecords(table, xCol, { study = "", filter = null } = {}) {
    const header = table[0];
    const idx = Object.fromEntries(header.map((h, i) => [h, i]));
    const records = [];
    for (let r = 1; r < table.length; r++) {
      const row = table[r];
      if (row.length < header.length) continue;
      const get = name => row[idx[name]];
      if (filter && !filter(get)) continue;
      const x = parseFloat(get(xCol));
      if (!Number.isFinite(x)) continue;
      const injury = get("injury_occurred"), death = get("death_occurred");
      let y;
      if (injury === "True" || death === "True") y = 1;
      else if (injury === "False") y = 0;
      else continue;
      const w = parseFloat(get("case_weight"));
      const stratum = `${study}${get("psu_stratum")}`;
      records.push({
        x, y,
        w: Number.isFinite(w) && w > 0 ? w : 0,
        stratum,
        psu: `${stratum}/${get("psu")}`,
        year: +get("crash_year"),
      });
    }
    return records;
  }

  // ---------- Distributions ----------

  // Inverse standard normal CDF (Acklam's algorithm, |error| < 1.2e-9).
  function qnorm(p) {
    const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
    const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
    const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
    const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
    const pl = 0.02425;
    if (p < pl) {
      const q = Math.sqrt(-2 * Math.log(p));
      return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
    if (p > 1 - pl) return -qnorm(1 - p);
    const q = p - 0.5, r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }

  // Student-t quantile via the Cornish-Fisher expansion (accurate to ~1e-4 for df >= 3).
  function qt(p, df) {
    const z = qnorm(p);
    if (!Number.isFinite(df) || df > 1e6) return z;
    const z3 = z ** 3, z5 = z ** 5, z7 = z ** 7, z9 = z ** 9;
    return z
      + (z3 + z) / (4 * df)
      + (5 * z5 + 16 * z3 + 3 * z) / (96 * df ** 2)
      + (3 * z7 + 19 * z5 + 17 * z3 - 15 * z) / (384 * df ** 3)
      + (79 * z9 + 776 * z7 + 1482 * z5 - 1920 * z3 - 945 * z) / (92160 * df ** 4);
  }

  // ---------- Survey design ----------

  // Index PSUs within strata once; reused by every variance computation.
  function buildDesign(records) {
    const strata = new Map(); // stratum -> Map(psu -> index)
    let nPsu = 0;
    const psuIndex = new Int32Array(records.length);
    const psuStratum = [];
    const keyToIdx = new Map();
    records.forEach((r, i) => {
      let k = keyToIdx.get(r.psu);
      if (k === undefined) {
        k = nPsu++;
        keyToIdx.set(r.psu, k);
        psuStratum.push(r.stratum);
        if (!strata.has(r.stratum)) strata.set(r.stratum, []);
        strata.get(r.stratum).push(k);
      }
      psuIndex[i] = k;
    });
    return { psuIndex, nPsu, strata, df: nPsu - strata.size };
  }

  // Stratified with-replacement variance of a total, given per-PSU totals
  // z[k] (each a vector of length m). Returns an m x m matrix.
  function stratifiedVariance(z, design, m) {
    const V = Array.from({ length: m }, () => new Float64Array(m));
    for (const psus of design.strata.values()) {
      const nh = psus.length;
      if (nh < 2) continue; // single-PSU stratum contributes nothing (documented)
      const mean = new Float64Array(m);
      for (const k of psus) for (let a = 0; a < m; a++) mean[a] += z[k][a] / nh;
      const f = nh / (nh - 1);
      for (const k of psus) {
        for (let a = 0; a < m; a++) {
          const da = z[k][a] - mean[a];
          for (let b = 0; b < m; b++) V[a][b] += f * da * (z[k][b] - mean[b]);
        }
      }
    }
    return V;
  }

  // ---------- Binned rates ----------

  // Domain (bin) injury rates r = sum(w*y)/sum(w).
  function binRates(records, weighted, width) {
    const bins = new Map();
    for (const r of records) {
      const k = Math.floor(r.x / width);
      let b = bins.get(k);
      if (!b) bins.set(k, (b = { k, n: 0, events: 0, sw: 0, swy: 0 }));
      const w = weighted ? r.w : 1;
      b.n++; b.events += r.y; b.sw += w; b.swy += w * r.y;
    }
    return [...bins.values()].sort((a, b) => a.k - b.k).map(b => {
      const lo = b.k * width;
      return { lo, hi: lo + width, mid: lo + width / 2, n: b.n, events: b.events, rate: b.sw > 0 ? b.swy / b.sw : NaN };
    });
  }

  function overallRate(records, weighted) {
    let sw = 0, swy = 0, events = 0;
    for (const r of records) {
      const w = weighted ? r.w : 1;
      sw += w; swy += w * r.y; events += r.y;
    }
    return { rate: swy / sw, events };
  }

  const api = { parseCSV, toRecords, buildDesign, binRates, overallRate, qt, qnorm };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Stats = api;
})(typeof window !== "undefined" ? window : globalThis);
