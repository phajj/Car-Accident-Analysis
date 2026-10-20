"use strict";

const MIN_BIN_N = 20;      // bins with fewer occupants are not plotted
const KMH_PER_MPH = 1.609344;

// Per-tab configuration. Each tab plots observed injury rates against one
// crash-severity measure; datasets are defined in datasets.js.
// Tabs with a `model` draw a fitted curve:
//   "manual" — logistic curve, a and b come from the sliders;
//   "fitted" — logistic curve, a and b come from FIT_FILE (logit_lin on cds_dv);
//   "fits"   — one sub-tab per entry in FITS, a and b from FIT_FILE
//              (all written by analysis/fit_models.py).
// Tabs without one show placeholders (PLACEHOLDER) for model-derived values.
// `weightedOnly` tabs always use survey weights.
const SPEED_AXIS = {
  datasets: ["ciss_speed", "cds_speed", "pooled_speed"],
  shortLabels: { ciss_speed: "CISS 2017–24", cds_speed: "NASS-CDS 2000–15", pooled_speed: "Pooled" },
  xTitle: "EDR pre-crash speed (km/h)",
  xName: "Speed",
  binWidth: 10,
  minXMax: 100,
  tickStep: 20,
};
const DV_AXIS = {
  datasets: ["cds_dv"],
  shortLabels: { cds_dv: "NASS-CDS 2000–15" },
  xTitle: "Total delta-v (km/h)",
  xName: "Delta-v",
  binWidth: 5,
  minXMax: 60,
  tickStep: 10,
};
const TABS = {
  speed: SPEED_AXIS,
  dv: DV_AXIS,
  dvExplore: { ...DV_AXIS, weightedOnly: true, model: "manual" },
  dvFit: { ...DV_AXIS, weightedOnly: true, model: "fitted" },
  fitsSpeed: { ...SPEED_AXIS, weightedOnly: true, model: "fits" },
  fitsDv: { ...DV_AXIS, weightedOnly: true, model: "fits" },
};

const FIT_FILE = "model_fits.json";
const MANUAL_START = { a: 0, b: 0 };

const state = {
  tab: "speed",
  dataset: { speed: "ciss_speed", dv: "cds_dv", dvExplore: "cds_dv", dvFit: "cds_dv", fitsSpeed: "ciss_speed", fitsDv: "cds_dv" },
  fit: { fitsSpeed: "logit_lin", fitsDv: "logit_lin" },
  view: "transformed",  // "model fits" tabs: plot on the fit's transformed axes or the original scale
  weighted: false,
  manual: { ...MANUAL_START },
};

const isWeighted = () => Boolean(TABS[state.tab].weightedOnly) || state.weighted;

const tables = new Map();   // file -> Promise<parsed table>
const results = new Map();  // `${dataset}|${weighted}` -> analysis
const PLACEHOLDER = "—";    // shown wherever a model estimate will go

// ---------- Data ----------

function loadTable(file) {
  if (!tables.has(file)) {
    tables.set(file, fetch(file)
      .then(r => { if (!r.ok) throw new Error(`${file}: HTTP ${r.status}`); return r.text(); })
      .then(Stats.parseCSV));
  }
  return tables.get(file);
}

async function analysis(datasetKey, weighted) {
  const key = `${datasetKey}|${weighted}`;
  if (results.has(key)) return results.get(key);
  const ds = DATASETS[datasetKey];
  const parts = await Promise.all(ds.sources.map(async s => Stats.toRecords(await loadTable(s.file), s.xCol, s)));
  const records = parts.flat();
  const tab = Object.values(TABS).find(t => t.datasets.includes(datasetKey));
  const bins = Stats.binRates(records, weighted, tab.binWidth);
  const overall = Stats.overallRate(records, weighted);
  const years = records.map(r => r.year);
  const res = {
    records, bins, overall,
    n: records.length,
    yearMin: Math.min(...years), yearMax: Math.max(...years),
  };
  results.set(key, res);
  return res;
}

let fitPromise;
function loadFit() {
  if (!fitPromise) {
    fitPromise = fetch(FIT_FILE)
      .then(r => { if (!r.ok) throw new Error(`${FIT_FILE}: HTTP ${r.status}`); return r.json(); });
  }
  return fitPromise;
}

// ---------- Model ----------

const logistic = (a, b, x) => 1 / (1 + Math.exp(-(a + b * x)));
// log(1 + e^t) without overflow
const softplus = t => (t > 0 ? t + Math.log1p(Math.exp(-t)) : Math.log1p(Math.exp(t)));
const LN2 = Math.log(2);

// Axis transformations. Every form below is a straight line, yt(P) = a + b·xt(x),
// so plotting the transformed bin rates on these axes shows how close to a line
// the data are (the "linearize, then fit a line" approach).
const XT = {
  id: { f: v => v, inv: u => u, title: tab => tab.xTitle, name: v => v },
  ln: { f: Math.log, inv: Math.exp, title: tab => `ln(${tab.xName.toLowerCase()} in km/h)`, name: v => `ln(${v})` },
};
const YT = {
  id: { f: p => p, inv: t => t, title: "P(injury)", name: "P" },
  ln: { f: Math.log, inv: Math.exp, title: "ln P(injury)", name: "ln P" },
  logit: { f: p => Math.log(p / (1 - p)), inv: t => 1 / (1 + Math.exp(-t)), title: "logit P = ln(P / (1 − P))", name: "logit P" },
};

// Model forms, matching analysis/fit_models.py. Each has two parameters a, b.
//   xt, yt   — the axis transformations that make the form a straight line
//   predict  — P(injury) at x
//   z        — logistic forms only: the linear predictor (for a stable fit score)
//   logX     — uses ln x, so occupants with x <= 0 are left out
//   formula  — HTML, given the predictor's name
//   effect   — tile describing how fast risk rises
//   fifty    — x where P = 50% (needs b > 0), and how it is computed
const FORMS = {
  logit_lin: {
    xt: "id", yt: "logit",
    predict: (a, b, x) => logistic(a, b, x),
    z: (a, b, x) => a + b * x,
    formula: v => `P(injury) = 1 / (1 + e<sup>−(a + b × ${v})</sup>)`,
    effect: (a, b) => ({ label: "Odds multiplier per +10 km/h", value: `${fmtNum(Math.exp(10 * b), 2)}×`, sub: "e^(10 × b)" }),
    fifty: (a, b) => [-a / b, "= −a / b"],
  },
  semilogy: {
    xt: "id", yt: "ln",
    predict: (a, b, x) => Math.exp(a + b * x),
    formula: v => `ln P(injury) = a + b × ${v} &nbsp;⇔&nbsp; P = e<sup>a + b × ${v}</sup>`,
    effect: (a, b) => ({ label: "Risk multiplier per +10 km/h", value: `${fmtNum(Math.exp(10 * b), 2)}×`, sub: "e^(10 × b)" }),
    fifty: (a, b) => [(Math.log(0.5) - a) / b, "= (ln 0.5 − a) / b"],
  },
  semilogx: {
    xt: "ln", yt: "id",
    predict: (a, b, x) => a + b * Math.log(x),
    logX: true,
    formula: v => `P(injury) = a + b × ln(${v})`,
    effect: (a, b) => ({ label: "Risk change when x doubles", value: `${b >= 0 ? "+" : ""}${fmtNum(100 * b * LN2, 1)} pts`, sub: "b × ln 2 percentage points" }),
    fifty: (a, b) => [Math.exp((0.5 - a) / b), "= e^((0.5 − a) / b)"],
  },
  loglog: {
    xt: "ln", yt: "ln",
    predict: (a, b, x) => Math.exp(a + b * Math.log(x)),
    logX: true,
    formula: v => `ln P(injury) = a + b × ln(${v}) &nbsp;⇔&nbsp; P = e<sup>a</sup> × ${v}<sup>b</sup>`,
    effect: (a, b) => ({ label: "Risk multiplier when x doubles", value: `${fmtNum(2 ** b, 2)}×`, sub: "2^b (b = power-model exponent)" }),
    fifty: (a, b) => [Math.exp((Math.log(0.5) - a) / b), "= e^((ln 0.5 − a) / b)"],
  },
  logit_logx: {
    xt: "ln", yt: "logit",
    predict: (a, b, x) => logistic(a, b, Math.log(x)),
    z: (a, b, x) => a + b * Math.log(x),
    logX: true,
    formula: v => `P(injury) = 1 / (1 + e<sup>−(a + b × ln ${v})</sup>)`,
    effect: (a, b) => ({ label: "Odds multiplier when x doubles", value: `${fmtNum(2 ** b, 2)}×`, sub: "2^b" }),
    fifty: (a, b) => [Math.exp(-a / b), "= e^(−a / b)"],
  },
};

const METHODS = {
  ls: "least squares on the transformed bin rates",
  ml: "maximum likelihood on every occupant",
};

// The fits on the "model fits" tabs, in sub-tab order. `description` is the
// one-sentence summary shown at the top of each sub-tab ({x} = predictor name).
const FITS = [
  {
    id: "logit_lin", form: "logit_lin", method: "ml", title: "Logistic",
    description: "Plot logit P against {x}: a straight line here means a logistic S-curve, fit by maximum likelihood on every occupant.",
  },
  {
    id: "semilogy_ls", form: "semilogy", method: "ls", title: "Semi-log y (LS)",
    description: "Semi-log: plot ln P against {x} and fit a straight line to the bins by least squares, so risk grows a fixed % per km/h.",
  },
  {
    id: "semilogy_ml", form: "semilogy", method: "ml", title: "Semi-log y (ML)",
    description: "Semi-log: the same ln P = a + b·{x} line, fit by maximum likelihood on every occupant instead of to the bins.",
  },
  {
    id: "semilogx_ls", form: "semilogx", method: "ls", title: "Semi-log x (LS)",
    description: "Semi-log: plot P against ln({x}) and fit a straight line to the bins by least squares, so each doubling adds fixed points.",
  },
  {
    id: "semilogx_ml", form: "semilogx", method: "ml", title: "Semi-log x (ML)",
    description: "Semi-log: the same P = a + b·ln({x}) line, fit by maximum likelihood on every occupant instead of to the bins.",
  },
  {
    id: "loglog_ls", form: "loglog", method: "ls", title: "Log-log (LS)",
    description: "Log-log: plot ln P against ln({x}) and fit a straight line to the bins by least squares, a power model P = e^a·{x}^b.",
  },
  {
    id: "loglog_ml", form: "loglog", method: "ml", title: "Log-log (ML)",
    description: "Log-log: the same ln P = a + b·ln({x}) line (power model), fit by maximum likelihood on every occupant.",
  },
  {
    id: "logit_logx", form: "logit_logx", method: "ml", title: "Logistic on ln x",
    description: "Plot logit P against ln({x}): a straight line here means a logistic curve in ln {x}, fit by maximum likelihood.",
  },
];
const fitDef = id => FITS.find(f => f.id === id);

const makeModel = (form, a, b, label) => ({ form, a, b, label, predict: x => FORMS[form].predict(a, b, x) });

// Fit score: the weighted geometric mean of the probability the curve gave each
// occupant's actual outcome, exp(sum w*log p / sum w). This is the likelihood the
// maximum-likelihood fits maximize. Non-logistic forms can predict outside 0–1,
// so their predictions are clipped to [1e-9, 1 − 1e-9] (as in fit_models.py).
const CLIP = 1e-9;
function fitScore(records, model) {
  const form = FORMS[model.form];
  let sw = 0, swll = 0;
  for (const r of records) {
    if (!(r.w > 0)) continue;
    if (form.logX && !(r.x > 0)) continue;
    let ll;
    if (form.z) {
      const z = form.z(model.a, model.b, r.x);
      ll = -(r.y ? softplus(-z) : softplus(z));
    } else {
      const p = Math.min(1 - CLIP, Math.max(CLIP, model.predict(r.x)));
      ll = r.y ? Math.log(p) : Math.log1p(-p);
    }
    swll += r.w * ll;
    sw += r.w;
  }
  return Math.exp(swll / sw);
}

// The fit-file entry for the current tab (or null): logit_lin on delta-v for
// "fitted", the selected sub-tab's fit on the selected dataset for "fits".
function currentEntry(tab, fits, dsKey) {
  if (!fits) return null;
  if (tab.model === "fitted") return fits.fits.logit_lin.cds_dv;
  if (tab.model === "fits") return fits.fits[state.fit[state.tab]]?.[dsKey] ?? null;
  return null;
}

// The model to draw for the current tab, or null.
function currentModel(tab, entry) {
  if (tab.model === "manual") return makeModel("logit_lin", state.manual.a, state.manual.b, "Your curve");
  if (!entry || !Number.isFinite(entry.a) || !Number.isFinite(entry.b)) return null;
  if (tab.model === "fitted") return makeModel("logit_lin", entry.a, entry.b, "Best-fit curve (statsmodels)");
  const def = fitDef(state.fit[state.tab]);
  return makeModel(def.form, entry.a, entry.b, `${def.title} fit`);
}

// ---------- Formatting ----------

const fmtInt = n => n.toLocaleString("en-US");
const fmtPct = (p, d = 1) => (Number.isFinite(p) ? (p * 100).toFixed(d) + "%" : "–");
const fmtNum = (v, d) => (Number.isFinite(v) ? v.toFixed(d).replace("-", "−") : "–");
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const STATUS_LABEL = { ok: "Fits in 0–100%", out_of_range: "Leaves 0–100%", failed: "Fit failed" };

// ---------- Tiles ----------

function renderTiles(res, tab, model, fits, dsKey) {
  if (model) return renderModelTiles(res, tab, model, fits, dsKey);
  const failed = tab.model === "fits";
  const tiles = [
    {
      label: "Occupants with known outcome",
      value: fmtInt(res.n),
      sub: `${fmtInt(res.overall.events)} injured or killed · ${res.yearMin}–${res.yearMax}`,
    },
    {
      label: isWeighted() ? "Weighted injury rate" : "Injury rate in sample",
      value: fmtPct(res.overall.rate),
      sub: "includes deaths",
    },
    // Model placeholders
    {
      label: "Odds multiplier per +10 km/h",
      value: PLACEHOLDER,
      sub: failed ? "fit failed — no estimates" : "no model fitted yet",
      placeholder: true,
    },
    {
      label: `${tab.xName} at 50% predicted risk`,
      value: PLACEHOLDER,
      sub: failed ? "fit failed — no estimates" : "no model fitted yet",
      placeholder: true,
    },
  ];
  drawTiles(tiles);
}

function renderModelTiles(res, tab, model, fits, dsKey) {
  const form = FORMS[model.form];
  const { a, b } = model;
  let fiftyValue = PLACEHOLDER, fiftySub = "curve must rise (b > 0)";
  if (b > 0) {
    const [fifty, how] = form.fifty(a, b);
    fiftyValue = !Number.isFinite(fifty) ? PLACEHOLDER
      : fifty < 0 ? "below 0 km/h"
      : fifty > 1000 ? "above 1,000 km/h"
      : `${fmtNum(fifty, 1)} km/h`;
    fiftySub = how;
  }
  const score = fitScore(res.records, model);
  let scoreSub = "avg. chance given to what really happened";
  if (tab.model === "manual" && fits) {
    const best = fits.fits.logit_lin.cds_dv;
    scoreSub = `best possible: ${fmtPct(fitScore(res.records, makeModel("logit_lin", best.a, best.b)), 2)}`;
  } else if (tab.model === "fits" && fits) {
    // Highest score among this tab's fits on the same data (scores from fit_models.py)
    const scored = FITS.map(f => ({ f, s: fits.fits[f.id]?.[dsKey]?.score })).filter(o => Number.isFinite(o.s));
    const top = scored.reduce((m, o) => (o.s > m.s ? o : m), scored[0]);
    if (top) scoreSub = top.f.id === state.fit[state.tab] ? "best of the fits on this data" : `best here: ${fmtPct(top.s, 2)} (${top.f.title})`;
  }
  const tiles = [
    {
      label: "Weighted injury rate",
      value: fmtPct(res.overall.rate),
      sub: `${fmtInt(res.n)} occupants · ${res.yearMin}–${res.yearMax}`,
    },
    form.effect(a, b),
    {
      label: `${tab.xName} at 50% predicted risk`,
      value: fiftyValue,
      sub: fiftySub,
    },
    {
      label: "Fit score (higher is better)",
      value: fmtPct(score, 2),
      sub: scoreSub,
    },
  ];
  drawTiles(tiles);
}

function drawTiles(tiles) {
  document.getElementById("tiles").innerHTML = tiles
    .map(t => `<div class="tile${t.placeholder ? " placeholder" : ""}"><div class="label">${t.label}</div><div class="value">${t.value}</div><div class="sub">${t.sub}</div></div>`)
    .join("");
}

// ---------- Table ----------

// `view` is the fit's transformed axes ({xt, yt}) on the "model fits" tabs, else null.
function renderTable(bins, tab, model, view) {
  document.getElementById("th-x").textContent = `${tab.xName} (km/h)`;
  document.getElementById("th-model").classList.toggle("placeholder", !model);
  document.getElementById("th-xt").hidden = !view;
  document.getElementById("th-yt").hidden = !view;
  if (view) {
    document.getElementById("th-xt").textContent = view.xt.name("midpoint");
    document.getElementById("th-yt").textContent = view.yt === YT.id ? "rate" : `${view.yt.name.replace(" P", "")}(rate)`;
  }
  const t = v => (Number.isFinite(v) ? fmtNum(v, 3) : "–");
  document.querySelector("#bin-table tbody").innerHTML = bins
    .map(b => `<tr>
      <td>${b.lo}–${b.hi}</td>
      <td>${fmtInt(b.n)}</td>
      <td>${fmtInt(b.events)}</td>
      <td>${fmtPct(b.rate)}</td>
      ${view ? `<td>${t(view.xt.f(b.mid))}</td><td>${t(view.yt.f(b.rate))}</td>` : ""}
      ${model ? `<td>${fmtPct(model.predict(b.mid))}</td>` : `<td class="placeholder">${PLACEHOLDER}</td>`}
    </tr>`)
    .join("");
}

// ---------- Chart ----------

const SVG_NS = "http://www.w3.org/2000/svg";
function el(name, attrs = {}, parent) {
  const e = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}

// About `count` evenly spaced round numbers covering [lo, hi], and the decimals they need.
function niceTicks(lo, hi, count) {
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map(s => s * mag).find(s => s >= raw);
  const ticks = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) ticks.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return { ticks, decimals: Math.max(0, -Math.floor(Math.log10(step))) };
}

// Axes for the original scale: P (0–100%) against x (km/h), drawing the model curve.
function originalAxes(bins, tab, model, iw) {
  const xMax = Math.max(tab.minXMax, Math.ceil(bins[bins.length - 1].hi / tab.tickStep) * tab.tickStep);
  const step = iw < 420 ? tab.tickStep * 2 : tab.tickStep;
  const xTicks = [];
  for (let v = 0; v <= xMax; v += step) xTicks.push(v);
  const x0 = model && FORMS[model.form].logX ? xMax / 1600 : 0;
  return {
    x0: 0, x1: xMax, y0: 0, y1: 1,
    xTicks, xFmt: v => v,
    yTicks: [0, 0.2, 0.4, 0.6, 0.8, 1], yFmt: p => Math.round(p * 100) + "%",
    xTitle: tab.xTitle, yTitle: "Probability of injury (incl. death)",
    points: bins.map(b => ({ b, u: b.mid, t: b.rate })),
    dropped: 0,
    toX: u => u,
    // Model curve sampled across the axis (ln x forms start just above 0)
    curve: model ? Array.from({ length: 401 }, (_, i) => {
      const v = x0 + (i / 400) * (xMax - x0);
      return [v, model.predict(v)];
    }) : [],
    head: v => `${tab.xName} ${v.toFixed(0)} km/h <span class="tt-muted">(${(v / KMH_PER_MPH).toFixed(0)} mph)</span>`,
    modelText: u => fmtPct(model.predict(u)),
    binText: b => fmtPct(b.rate),
  };
}

// Axes for the fit's transformation: yt(rate) against xt(x). On these axes the
// model is the straight line yt = a + b·xt. Bins whose rate can't be
// transformed (ln 0, logit of 0% or 100%) are left off.
function transformedAxes(bins, tab, model, view, iw, ih) {
  const { xt, yt } = view;
  const points = bins.map(b => ({ b, u: xt.f(b.mid), t: yt.f(b.rate) })).filter(p => Number.isFinite(p.t));
  if (!points.length) return { points, dropped: bins.length };
  const pad = (lo, hi) => { const d = (hi - lo) * 0.06 || 1; return [lo - d, hi + d]; };
  const us = points.map(p => p.u), ts = points.map(p => p.t);
  const [x0, x1] = pad(Math.min(...us), Math.max(...us));
  const [y0, y1] = pad(Math.min(...ts), Math.max(...ts));
  const xs = niceTicks(x0, x1, iw < 420 ? 4 : 8), ys = niceTicks(y0, y1, ih < 300 ? 4 : 6);
  const line = u => model.a + model.b * u;
  return {
    x0, x1, y0, y1,
    xTicks: xs.ticks, xFmt: v => fmtNum(v, xs.decimals),
    yTicks: ys.ticks, yFmt: v => fmtNum(v, ys.decimals),
    xTitle: xt.title(tab), yTitle: yt.title,
    points, dropped: bins.length - points.length,
    toX: xt.inv,
    curve: model ? [[x0, line(x0)], [x1, line(x1)]] : [],
    head: (v, u) => (xt === XT.id ? "" : `${xt.name(tab.xName.toLowerCase())} = ${fmtNum(u, 2)} · `) +
      `${tab.xName} ${v.toFixed(0)} km/h`,
    modelText: u => `${fmtNum(line(u), 2)} <span class="tt-muted">(P = ${fmtPct(yt.inv(line(u)))})</span>`,
    binText: b => {
      const t = yt.f(b.rate);
      return Number.isFinite(t)
        ? `${fmtNum(t, 2)} <span class="tt-muted">(${fmtPct(b.rate)})</span>`
        : `${fmtPct(b.rate)} <span class="tt-muted">(no ${yt.name})</span>`;
    },
  };
}

// Draws the chart; returns the axes used (with `dropped` = bins not plotted), or null.
function renderChart(bins, tab, model, view) {
  const container = document.getElementById("chart");
  container.innerHTML = "";
  if (!bins.length) {
    container.innerHTML = `<p class="status">No bins with at least ${MIN_BIN_N} occupants.</p>`;
    return null;
  }
  const W = container.clientWidth, H = container.clientHeight;
  const m = { top: 12, right: 16, bottom: 48, left: 52 };
  const iw = W - m.left - m.right, ih = H - m.top - m.bottom;

  const ax = view ? transformedAxes(bins, tab, model, view, iw, ih) : originalAxes(bins, tab, model, iw);
  if (!ax.points.length) {
    container.innerHTML = `<p class="status">No bins can be transformed for this plot.</p>`;
    return ax;
  }
  const x = u => m.left + ((u - ax.x0) / (ax.x1 - ax.x0)) * iw;
  const y = t => m.top + (1 - (t - ax.y0) / (ax.y1 - ax.y0)) * ih;
  const xInv = px => ax.x0 + ((px - m.left) / iw) * (ax.x1 - ax.x0);

  const svg = el("svg", {
    width: W,
    height: H,
    role: "img",
    "aria-label": `Observed injury rate against ${tab.xName.toLowerCase()}, by bin${view ? ", on transformed axes" : ""}.`,
  }, container);
  // Curves that leave the plot are cut off at its edges.
  el("rect", { x: m.left, y: m.top, width: iw, height: ih }, el("clipPath", { id: "plot-clip" }, el("defs", {}, svg)));

  const grid = el("g", { class: "grid" }, svg);
  for (const t of ax.yTicks) {
    if (t > ax.y0) el("line", { x1: m.left, x2: m.left + iw, y1: y(t), y2: y(t) }, grid);
    el("text", { x: m.left - 8, y: y(t) + 4, "text-anchor": "end" }, svg).textContent = ax.yFmt(t);
  }
  for (const u of ax.xTicks) {
    el("text", { x: x(u), y: m.top + ih + 18, "text-anchor": "middle" }, svg).textContent = ax.xFmt(u);
  }
  el("line", { class: "baseline", x1: m.left, x2: m.left + iw, y1: m.top + ih, y2: m.top + ih }, svg);

  el("text", { class: "axis-title", x: m.left + iw / 2, y: H - 8, "text-anchor": "middle" }, svg)
    .textContent = ax.xTitle;
  el("text", {
    class: "axis-title",
    transform: `translate(14, ${m.top + ih / 2}) rotate(-90)`,
    "text-anchor": "middle",
  }, svg).textContent = ax.yTitle;

  // Model curve (values are clamped near the plot so the path stays finite, then clipped to it)
  const span = ax.y1 - ax.y0;
  const pts = ax.curve
    .filter(([, t]) => Number.isFinite(t))
    .map(([u, t]) => `${x(u).toFixed(1)},${y(Math.min(ax.y1 + span, Math.max(ax.y0 - span, t))).toFixed(1)}`);
  if (pts.length) el("path", { class: "model-curve", d: `M${pts.join("L")}`, "clip-path": "url(#plot-clip)" }, svg);

  // Observed bins
  const binG = el("g", {}, svg);
  const dots = ax.points.map(p => el("circle", { class: "bin-dot", cx: x(p.u), cy: y(p.t), r: 5 }, binG));

  // Hover layer: crosshair + the bin under the cursor
  const hover = el("g", { visibility: "hidden" }, svg);
  const cross = el("line", { class: "crosshair", y1: m.top, y2: m.top + ih }, hover);
  const hit = el("rect", { x: m.left, y: m.top, width: iw, height: ih, fill: "transparent" }, svg);
  const tip = document.getElementById("tooltip");
  const card = container.parentElement;

  function onMove(evt) {
    const rect = svg.getBoundingClientRect();
    const u = Math.min(ax.x1, Math.max(ax.x0, xInv(evt.clientX - rect.left)));
    const v = ax.toX(u);
    hover.setAttribute("visibility", "visible");
    cross.setAttribute("x1", x(u)); cross.setAttribute("x2", x(u));

    const b = bins.find(b => v >= b.lo && v < b.hi);
    dots.forEach((d, i) => d.classList.toggle("active", ax.points[i].b === b));

    tip.innerHTML =
      `<div class="tt-head">${ax.head(v, u)}</div>` +
      (model
        ? `<div class="tt-row"><span class="sw sw-1"></span>Model<b>${ax.modelText(u)}</b></div>`
        : `<div class="tt-row tt-placeholder"><span class="sw sw-1"></span>Model<b>${PLACEHOLDER}</b></div>`) +
      (b
        ? `<div class="tt-row"><span class="sw sw-2"></span>Observed ${b.lo}–${b.hi}<b>${ax.binText(b)}</b></div>` +
          `<div class="tt-row tt-indent">${fmtInt(b.events)} of ${fmtInt(b.n)} occupants</div>`
        : `<div class="tt-row tt-indent">No plotted bin here</div>`);
    tip.hidden = false;

    const cardRect = card.getBoundingClientRect();
    let left = evt.clientX - cardRect.left + 14;
    if (left + tip.offsetWidth > cardRect.width - 8) left = evt.clientX - cardRect.left - tip.offsetWidth - 14;
    tip.style.left = Math.max(8, left) + "px";
    tip.style.top = Math.max(8, evt.clientY - cardRect.top - tip.offsetHeight / 2) + "px";
  }
  function onLeave() {
    hover.setAttribute("visibility", "hidden");
    dots.forEach(d => d.classList.remove("active"));
    tip.hidden = true;
  }
  hit.addEventListener("pointermove", onMove);
  hit.addEventListener("pointerdown", onMove);
  hit.addEventListener("pointerleave", onLeave);
  return ax;
}

// ---------- Notes ----------

function renderNotes(res, tab, dsKey) {
  const def = tab.model === "fits" ? fitDef(state.fit[state.tab]) : null;
  const modelNote = {
    manual: `<li><strong>Model:</strong> a logistic curve P(injury) = 1 / (1 + e<sup>−(a + b × delta-v)</sup>) using the
      a and b from the sliders.</li>`,
    fitted: `<li><strong>Model:</strong> the same logistic curve with the a and b that best fit the weighted data
      (maximum likelihood), found by <code>analysis/fit_models.py</code> with a statsmodels binomial GLM.
      Re-run that script after rebuilding the data.</li>`,
    fits: def && `<li><strong>Model:</strong> ${FORMS[def.form].formula(tab.xName.toLowerCase())}, fit by ${METHODS[def.method]}
      in <code>analysis/fit_models.py</code> (re-run it after rebuilding the data).</li>
      <li><strong>Least squares vs. maximum likelihood:</strong> “LS” fits transform each plotted bin's observed rate
      (ln P for semi-log and log-log) and fit a straight line, weighting each bin by its total case weight; bins with a
      0% rate can't be logged and are dropped. “ML” fits use every occupant directly (statsmodels binomial GLM with
      the matching link, <code>freq_weights = case_weight</code>). Only the logistic forms are guaranteed to stay
      between 0% and 100%; the others are drawn clipped to the chart.</li>
      <li><strong>Transformed axes:</strong> the chart plots each bin's observed rate as
      ${YT[FORMS[def.form].yt].name} against ${XT[FORMS[def.form].xt] === XT.id ? tab.xName.toLowerCase() : `ln(${tab.xName.toLowerCase()})`}.
      This form is a straight line on those axes, so the points should lie along the line if the form is right.
      ${FORMS[def.form].yt === "id" ? "" : `Bins at ${FORMS[def.form].yt === "logit" ? "0% or 100%" : "0%"} have no
      ${YT[FORMS[def.form].yt].name} and are not plotted.`}
      Switch the plot to “Original” to see the curve as a probability.</li>
      ${FORMS[def.form].logX ? `<li><strong>ln x:</strong> occupants with ${tab.xName.toLowerCase()} = 0 km/h have no logarithm and are
      left out of this fit and its score.</li>` : ""}`,
  }[tab.model] || `<li><strong>Model:</strong> not yet fitted — the chart shows observed rates only.</li>`;
  const scoreNote = tab.model ? `
    <li><strong>Fit score:</strong> how well the curve matches every occupant's actual outcome, as a weighted geometric
      mean of how much credit the curve earns for each occupant. The maximum-likelihood fit has the highest possible score
      for its form.
      <br><code>score = exp( Σ w × log(credit) / Σ w )</code>
      <br><code>credit</code> = the chance the curve gave what really happened (its prediction if injured, 100% minus it if not;
      clipped to 0.0000001%–99.9999999% for curves that leave 0–100%)
      <br><code>w</code> = the occupant's <code>case_weight</code>
      <br><code>Σ</code> = sum over all occupants</li>` : "";
  const common = `
    <li><strong>Outcome:</strong> an occupant counts as injured if they had any injury (CISS <code>INJSTATUS</code>/MAIS;
      NASS-CDS MAIS 1–7) <em>or</em> died. Occupants whose injury status is unknown and who did not die are excluded.</li>
    ${modelNote}
    <li><strong>Weighting:</strong> with survey weights on, each occupant is weighted by the case weight
      (CISS <code>CASEWGT</code>, NASS-CDS <code>RATWGT</code>).</li>
    <li><strong>Bins:</strong> each point is the observed injury rate in a ${tab.binWidth} km/h bin, plotted at the bin midpoint.
      Bins with fewer than ${MIN_BIN_N} occupants are not plotted.</li>`;
  const specific = {
    ciss_speed: `
      <li><strong>Data:</strong> CISS 2017–2024 occupants of vehicles with a usable EDR pre-crash speed (≈41% of vehicles).
        Speed is the EDR sample closest to impact.</li>`,
    cds_speed: `
      <li><strong>Data:</strong> NASS-CDS occupants of vehicles whose EDR report (published only as PDF, 2000–2013) contained a
        readable pre-crash speed table — parsed by <code>data/NASS_CDS/parse_nass_edr.py</code>. 2014–2015 EDR files are
        binary Bosch CDRx images that cannot be decoded without Bosch software, so those years contribute only one vehicle
        (from a third-party PDF).</li>
      <li><strong>Selection:</strong> pre-crash speed recording spread slowly across manufacturers. GM vehicles are 95–100% of
        this sample through 2008, 75% in 2011 and 57% in 2013, so results mostly describe GM vehicles.</li>`,
    pooled_speed: `
      <li><strong>Data:</strong> NASS-CDS EDR speeds (2000–2013 PDFs) pooled with CISS 2019–2024, following NHTSA's guidance
        (DOT HS 812 801): CISS is restricted to crashes in the CDS target population (a passenger vehicle towed due to
        damage, <code>cds_in_scope = 1</code>), and the survey (STUDY) is added as an extra stratum. CISS 2017–2018 cannot be
        classified because <code>TOWED</code> was not collected, so it is left out.</li>`,
    cds_dv: `
      <li><strong>Data:</strong> NASS-CDS 2000–2015, all occupants of passenger vehicles with a reconstructed total delta-v
        (<code>DVTOTAL</code>, the change in velocity during the most severe impact, estimated from vehicle crush by WinSMASH).
        About half of vehicles have no delta-v — typically rollovers, side-swipes and impacts that can't be reconstructed.</li>
      <li><strong>Why delta-v:</strong> it measures the crash pulse the occupant actually experienced, so it is a far stronger
        predictor of injury than pre-crash speed (which ignores braking, what was hit, and the angle of impact).</li>`,
  };
  document.getElementById("notes").innerHTML =
    `<h2>How this is computed</h2><ul>${specific[dsKey]}${common}
      <li><strong>Caveats:</strong> NASS-CDS and CISS cover tow-away crashes, so "not injured" means uninjured in a tow-away
        crash, not in all crashes. EDR-based samples include only vehicles whose EDR could be read.</li>${scoreNote}</ul>`;
}

// ---------- Orchestration ----------

function renderControls(fits) {
  const tab = TABS[state.tab];
  document.querySelectorAll(".tabs [role=tab]").forEach(b => b.setAttribute("aria-selected", String(b.dataset.tab === state.tab)));
  document.getElementById("panel").setAttribute("aria-labelledby", tab.model === "fits" ? `fit-${state.fit[state.tab]}` : `tab-${state.tab}`);
  const src = document.getElementById("source-buttons");
  src.innerHTML = tab.datasets
    .map(k => `<button type="button" data-dataset="${k}" aria-pressed="${k === state.dataset[state.tab]}" title="${esc(DATASETS[k].label)}">${esc(tab.shortLabels[k])}</button>`)
    .join("");
  document.getElementById("source-control").hidden = tab.datasets.length < 2;
  document.querySelectorAll("[data-weighted]").forEach(b =>
    b.setAttribute("aria-pressed", String((b.dataset.weighted === "true") === state.weighted)));
  document.getElementById("weight-control").hidden = Boolean(tab.weightedOnly);
  document.getElementById("weight-fixed").hidden = !tab.weightedOnly;
  document.getElementById("sliders").hidden = tab.model !== "manual";
  document.getElementById("fit-info").hidden = tab.model !== "fitted" && tab.model !== "fits";
  document.getElementById("view-control").hidden = tab.model !== "fits";
  document.querySelectorAll("[data-view]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.view === state.view)));
  // The "model fits" tabs use a compact fit box and a shorter chart so the tabs and chart fit on one screen.
  document.getElementById("fit-info").classList.toggle("compact", tab.model === "fits");
  document.getElementById("chart").classList.toggle("short", tab.model === "fits");
  // ...and the stat tiles go below the chart there.
  document.getElementById("panel").insertAdjacentElement(tab.model === "fits" ? "afterend" : "beforebegin", document.getElementById("tiles"));
  renderFitTabs(tab, fits);
  syncSliders();
  document.getElementById("legend-bins").textContent = `Observed rate per ${tab.binWidth} km/h bin`;
}

// Sub-tabs, one per fit; a flag marks fits that fail or leave 0–100% on this data.
function renderFitTabs(tab, fits) {
  const nav = document.getElementById("fit-tabs");
  nav.hidden = tab.model !== "fits";
  if (nav.hidden) return;
  const dsKey = state.dataset[state.tab];
  nav.innerHTML = FITS.map(f => {
    const status = fits?.fits[f.id]?.[dsKey]?.status;
    const flag = status === "failed" ? " ✕" : status === "out_of_range" ? " !" : "";
    const sel = f.id === state.fit[state.tab];
    return `<button type="button" role="tab" id="fit-${f.id}" data-fit="${f.id}" aria-selected="${sel}" tabindex="${sel ? 0 : -1}"
      title="${esc(STATUS_LABEL[status] || "")}">${esc(f.title)}${flag ? `<span class="flag" aria-label="${esc(STATUS_LABEL[status])}">${flag}</span>` : ""}</button>`;
  }).join("");
}

function renderLegend(tab, model) {
  document.getElementById("legend-model").classList.toggle("placeholder", !model);
  document.getElementById("legend-model-text").textContent = model
    ? model.label
    : tab.model === "fitted" ? "Best-fit curve (not available)"
    : tab.model === "fits" ? "Model fit (fit failed)"
    : "Model fit (not yet fitted)";
}

function renderFitInfo(tab, fits, entry) {
  const box = document.getElementById("fit-info");
  if (!fits) {
    box.innerHTML = `<p class="status">Fit file <code>app/${FIT_FILE}</code> not found. Run
       <code>.venv/bin/python analysis/fit_models.py</code> from the repo root, then reload.</p>`;
    return;
  }
  const v = tab.xName.toLowerCase();
  if (tab.model === "fitted") {
    const values = `<p class="fit-values"><span><b>a</b> = ${fmtNum(entry.a, 4)}</span><span><b>b</b> = ${fmtNum(entry.b, 5)}</span></p>`;
    box.innerHTML = `<p class="formula">${FORMS.logit_lin.formula(v)}</p>${values}
      <p class="hint">Found by a statsmodels ${esc(fits.statsmodels_version)} binomial GLM (logit link, freq_weights =
        case_weight) using all ${fmtInt(entry.n_used)} occupants with a positive case weight.</p>`;
    return;
  }
  const def = fitDef(state.fit[state.tab]);
  const details = [];
  if (entry) {
    details.push(`${fmtInt(entry.n_used)} occupants`);
    if (entry.dropped_nonpositive_x) details.push(`${fmtInt(entry.dropped_nonpositive_x)} at 0 km/h dropped (no ln 0)`);
    if (def.method === "ls" && entry.bins_used) details.push(`${entry.bins_used} bins`);
    if (entry.dropped_zero_bins) details.push(`${entry.dropped_zero_bins} bins at 0% dropped (no ln 0)`);
    if (Number.isFinite(entry.r_squared)) details.push(`R² = ${fmtNum(entry.r_squared, 3)} on the transformed bins`);
  }
  const status = entry?.status || "failed";
  let message = entry ? entry.message || "" : "No fit for this data.";
  if (status === "failed" && entry && Number.isFinite(entry.a)) message += " — the curve shown is where the fit stopped.";
  const ab = entry && Number.isFinite(entry.a)
    ? `<span><b>a</b> = ${fmtNum(entry.a, 4)}</span><span><b>b</b> = ${fmtNum(entry.b, 5)}</span>`
    : "";
  box.innerHTML = `
    <p class="fit-description">${esc(def.description.replaceAll("{x}", v))}</p>
    <p class="fit-line"><span class="formula">${FORMS[def.form].formula(v)}</span>${ab}<span class="badge ${status}">${STATUS_LABEL[status]}</span></p>
    <p class="hint">${[esc(message), ...details].filter(Boolean).join(" · ")}</p>`;
}

// Keep each slider and its number box showing the current a / b.
function syncSliders() {
  for (const param of ["a", "b"]) {
    for (const input of document.querySelectorAll(`[data-param="${param}"]`)) {
      if (document.activeElement === input && input.type === "number") continue; // don't fight typing
      input.value = state.manual[param];
    }
  }
}

let renderToken = 0;
async function render() {
  const tab = TABS[state.tab];
  const dsKey = state.dataset[state.tab];
  let fits = null;
  if (tab.model) {
    try {
      fits = await loadFit();
    } catch (err) {
      console.error(err);
    }
  }
  renderControls(fits);
  const token = ++renderToken;
  const weighted = isWeighted();
  const key = `${dsKey}|${weighted}`;
  if (!results.has(key)) {
    document.getElementById("chart").innerHTML = `<p class="status">Loading ${esc(DATASETS[dsKey].label)}…</p>`;
  }
  let res;
  try {
    res = await analysis(dsKey, weighted);
  } catch (err) {
    console.error(err);
    document.getElementById("chart").innerHTML = `<p class="status">Data not loaded.</p>`;
    document.getElementById("fallback").hidden = false;
    return;
  }
  if (token !== renderToken) return; // a newer render started meanwhile
  const bins = res.bins.filter(b => b.n >= MIN_BIN_N);
  const entry = currentEntry(tab, fits, dsKey);
  const model = currentModel(tab, entry);
  if (tab.model === "fitted" || tab.model === "fits") renderFitInfo(tab, fits, entry);
  renderLegend(tab, model);
  renderTiles(res, tab, model, fits, dsKey);
  // On the "model fits" tabs, plot on the fit's transformed axes unless the original scale is chosen.
  const def = tab.model === "fits" ? fitDef(state.fit[state.tab]) : null;
  const axes = def ? { xt: XT[FORMS[def.form].xt], yt: YT[FORMS[def.form].yt] } : null;
  const view = state.view === "transformed" ? axes : null;
  renderTable(bins, tab, model, axes);
  const ax = renderChart(bins, tab, model, view);
  renderLegendNote(view, ax);
  renderNotes(res, tab, dsKey);
}

// Under the legend on transformed axes: what is plotted, and how many bins could not be.
function renderLegendNote(view, ax) {
  const note = document.getElementById("legend-note");
  note.hidden = !view;
  if (!view) return;
  const what = `Plotted as ${view.yt.name} against ${view.xt === XT.id ? "x" : "ln x"}, where the model is a straight line.`;
  const dropped = ax?.dropped
    ? ` ${ax.dropped} bin${ax.dropped > 1 ? "s" : ""} at ${view.yt === YT.logit ? "0% or 100%" : "0%"} can't be transformed and ${ax.dropped > 1 ? "aren't" : "isn't"} shown.`
    : "";
  note.textContent = what + dropped;
}

// URL hash records the view so a link reopens it: #tab/dataset/weighted, or
// #tab/dataset/fitId[/original] on the "model fits" tabs (e.g. #fitsDv/cds_dv/loglog_ls).
function readHash() {
  const [tab, ds, extra, scale] = location.hash.replace("#", "").split("/");
  if (TABS[tab]) state.tab = tab;
  if (ds && TABS[state.tab].datasets.includes(ds)) state.dataset[state.tab] = ds;
  if (TABS[state.tab].model === "fits" && fitDef(extra)) state.fit[state.tab] = extra;
  state.weighted = extra === "weighted";
  state.view = scale === "original" ? "original" : "transformed";
}
function writeHash() {
  const extra = TABS[state.tab].model === "fits"
    ? `/${state.fit[state.tab]}${state.view === "original" ? "/original" : ""}`
    : state.weighted ? "/weighted" : "";
  history.replaceState(null, "", `#${state.tab}/${state.dataset[state.tab]}${extra}`);
}

document.querySelectorAll("[data-view]").forEach(btn =>
  btn.addEventListener("click", () => {
    state.view = btn.dataset.view;
    writeHash();
    render();
  }));

document.querySelector(".tabs").addEventListener("click", e => {
  const b = e.target.closest("[data-tab]");
  if (!b) return;
  state.tab = b.dataset.tab;
  writeHash();
  render();
});
document.querySelector(".tabs").addEventListener("keydown", e => {
  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
  const keys = Object.keys(TABS);
  state.tab = keys[(keys.indexOf(state.tab) + (e.key === "ArrowRight" ? 1 : keys.length - 1)) % keys.length];
  writeHash();
  render().then(() => document.getElementById(`tab-${state.tab}`).focus());
});
document.getElementById("fit-tabs").addEventListener("click", e => {
  const b = e.target.closest("[data-fit]");
  if (!b) return;
  state.fit[state.tab] = b.dataset.fit;
  writeHash();
  render();
});
document.getElementById("fit-tabs").addEventListener("keydown", e => {
  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
  const i = FITS.findIndex(f => f.id === state.fit[state.tab]);
  state.fit[state.tab] = FITS[(i + (e.key === "ArrowRight" ? 1 : FITS.length - 1)) % FITS.length].id;
  writeHash();
  render().then(() => document.getElementById(`fit-${state.fit[state.tab]}`).focus());
});
document.getElementById("source-buttons").addEventListener("click", e => {
  const b = e.target.closest("[data-dataset]");
  if (!b) return;
  state.dataset[state.tab] = b.dataset.dataset;
  writeHash();
  render();
});
document.querySelectorAll("[data-weighted]").forEach(btn =>
  btn.addEventListener("click", () => {
    state.weighted = btn.dataset.weighted === "true";
    writeHash();
    render();
  }));

document.getElementById("sliders").addEventListener("input", e => {
  const param = e.target.dataset.param;
  if (!param) return;
  const v = parseFloat(e.target.value);
  if (!Number.isFinite(v)) return;
  state.manual[param] = v;
  render();
});
document.getElementById("reset-ab").addEventListener("click", () => {
  state.manual = { ...MANUAL_START };
  render();
});

// Redraw when the chart box changes size (its height follows the window on the "model fits" tabs).
let resizeTimer, lastSize = "";
new ResizeObserver(entries => {
  const { width, height } = entries[0].contentRect;
  const size = `${width}x${height}`;
  if (size === lastSize) return;
  lastSize = size;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(render, 100);
}).observe(document.getElementById("chart"));

readHash();
render();
