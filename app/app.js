"use strict";

const MIN_BIN_N = 20;      // bins with fewer occupants are not plotted
const KMH_PER_MPH = 1.609344;

// Per-tab configuration. Each tab plots observed injury rates against one
// crash-severity measure; datasets are defined in datasets.js.
// Tabs with a `model` draw a logistic curve P = 1 / (1 + e^-(a + b*x)):
//   "manual" — a and b come from the sliders;
//   "fitted" — a and b come from FIT_FILE (analysis/fit_dv_logistic.py).
// Tabs without one show placeholders (PLACEHOLDER) for model-derived values.
// `weightedOnly` tabs always use survey weights.
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
  speed: {
    datasets: ["ciss_speed", "cds_speed", "pooled_speed"],
    shortLabels: { ciss_speed: "CISS 2017–24", cds_speed: "NASS-CDS 2000–15", pooled_speed: "Pooled" },
    xTitle: "EDR pre-crash speed (km/h)",
    xName: "Speed",
    binWidth: 10,
    minXMax: 100,
    tickStep: 20,
  },
  dv: DV_AXIS,
  dvExplore: { ...DV_AXIS, weightedOnly: true, model: "manual" },
  dvFit: { ...DV_AXIS, weightedOnly: true, model: "fitted" },
};

const FIT_FILE = "dv_logistic_fit.json";
const MANUAL_START = { a: 0, b: 0 };

const state = {
  tab: "speed",
  dataset: { speed: "ciss_speed", dv: "cds_dv", dvExplore: "cds_dv", dvFit: "cds_dv" },
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

// Fit score: the weighted geometric mean of the probability the curve gave each
// occupant's actual outcome, exp(sum w*log p / sum w). This is the likelihood the
// best fit maximizes, so the best-fit a and b have the highest possible score.
function fitScore(records, a, b) {
  let sw = 0, swll = 0;
  for (const r of records) {
    if (!(r.w > 0)) continue;
    const z = a + b * r.x;
    swll += r.w * -(r.y ? softplus(-z) : softplus(z));
    sw += r.w;
  }
  return Math.exp(swll / sw);
}

// The model to draw for the current tab ({a, b, label} or null).
// `fit` is the loaded best-fit file, or null if it isn't available.
function currentModel(tab, fit) {
  if (tab.model === "manual") return { ...state.manual, label: "Your curve" };
  if (tab.model === "fitted" && fit) return { a: fit.a, b: fit.b, label: "Best-fit curve (statsmodels)" };
  return null;
}

// ---------- Formatting ----------

const fmtInt = n => n.toLocaleString("en-US");
const fmtPct = (p, d = 1) => (Number.isFinite(p) ? (p * 100).toFixed(d) + "%" : "–");
const fmtNum = (v, d) => (Number.isFinite(v) ? v.toFixed(d).replace("-", "−") : "–");
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// ---------- Tiles ----------

function renderTiles(res, tab, model, fit) {
  if (model) return renderModelTiles(res, tab, model, fit);
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
      sub: "no model fitted yet",
      placeholder: true,
    },
    {
      label: `${tab.xName} at 50% predicted risk`,
      value: PLACEHOLDER,
      sub: "no model fitted yet",
      placeholder: true,
    },
  ];
  drawTiles(tiles);
}

function renderModelTiles(res, tab, { a, b }, fit) {
  const fifty = -a / b;
  let fiftyValue = PLACEHOLDER, fiftySub = "curve must rise (b > 0)";
  if (b > 0) {
    fiftyValue = fifty < 0 ? "below 0 km/h" : `${fmtNum(fifty, 1)} km/h`;
    fiftySub = "= −a / b";
  }
  const score = fitScore(res.records, a, b);
  const best = fit && tab.model === "manual" ? fitScore(res.records, fit.a, fit.b) : null;
  const tiles = [
    {
      label: "Weighted injury rate",
      value: fmtPct(res.overall.rate),
      sub: `${fmtInt(res.n)} occupants · ${res.yearMin}–${res.yearMax}`,
    },
    {
      label: "Odds multiplier per +10 km/h",
      value: `${fmtNum(Math.exp(10 * b), 2)}×`,
      sub: "e^(10 × b)",
    },
    {
      label: `${tab.xName} at 50% predicted risk`,
      value: fiftyValue,
      sub: fiftySub,
    },
    {
      label: "Fit score (higher is better)",
      value: fmtPct(score, 2),
      sub: best !== null
        ? `best possible: ${fmtPct(best, 2)}`
        : "avg. chance given to what really happened",
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

function renderTable(bins, tab, model) {
  document.getElementById("th-x").textContent = `${tab.xName} (km/h)`;
  document.getElementById("th-model").classList.toggle("placeholder", !model);
  document.querySelector("#bin-table tbody").innerHTML = bins
    .map(b => `<tr>
      <td>${b.lo}–${b.hi}</td>
      <td>${fmtInt(b.n)}</td>
      <td>${fmtInt(b.events)}</td>
      <td>${fmtPct(b.rate)}</td>
      ${model ? `<td>${fmtPct(logistic(model.a, model.b, b.mid))}</td>` : `<td class="placeholder">${PLACEHOLDER}</td>`}
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

function renderChart(bins, tab, model) {
  const container = document.getElementById("chart");
  container.innerHTML = "";
  if (!bins.length) {
    container.innerHTML = `<p class="status">No bins with at least ${MIN_BIN_N} occupants.</p>`;
    return;
  }
  const W = container.clientWidth, H = container.clientHeight;
  const m = { top: 12, right: 16, bottom: 48, left: 52 };
  const iw = W - m.left - m.right, ih = H - m.top - m.bottom;

  const xMax = Math.max(tab.minXMax, Math.ceil(bins[bins.length - 1].hi / tab.tickStep) * tab.tickStep);
  const x = v => m.left + (v / xMax) * iw;
  const y = p => m.top + (1 - p) * ih;
  const xInv = px => ((px - m.left) / iw) * xMax;

  const svg = el("svg", {
    width: W,
    height: H,
    role: "img",
    "aria-label": `Observed injury rate against ${tab.xName.toLowerCase()}, by bin.`,
  }, container);

  const grid = el("g", { class: "grid" }, svg);
  for (let i = 0; i <= 5; i++) {
    const p = i / 5;
    if (p > 0) el("line", { x1: m.left, x2: m.left + iw, y1: y(p), y2: y(p) }, grid);
    el("text", { x: m.left - 8, y: y(p) + 4, "text-anchor": "end" }, svg).textContent = Math.round(p * 100) + "%";
  }
  const step = iw < 420 ? tab.tickStep * 2 : tab.tickStep;
  for (let v = 0; v <= xMax; v += step) {
    el("text", { x: x(v), y: m.top + ih + 18, "text-anchor": "middle" }, svg).textContent = v;
  }
  el("line", { class: "baseline", x1: m.left, x2: m.left + iw, y1: y(0), y2: y(0) }, svg);

  el("text", { class: "axis-title", x: m.left + iw / 2, y: H - 8, "text-anchor": "middle" }, svg)
    .textContent = tab.xTitle;
  el("text", {
    class: "axis-title",
    transform: `translate(14, ${m.top + ih / 2}) rotate(-90)`,
    "text-anchor": "middle",
  }, svg).textContent = "Probability of injury (incl. death)";

  // Model curve
  if (model) {
    const steps = 200, pts = [];
    for (let i = 0; i <= steps; i++) {
      const v = (i / steps) * xMax;
      pts.push(`${x(v).toFixed(1)},${y(logistic(model.a, model.b, v)).toFixed(1)}`);
    }
    el("path", { class: "model-curve", d: `M${pts.join("L")}` }, svg);
  }

  // Observed bins
  const binG = el("g", {}, svg);
  const dots = bins.map(b => el("circle", { class: "bin-dot", cx: x(b.mid), cy: y(b.rate), r: 5 }, binG));

  // Hover layer: crosshair + the bin under the cursor
  const hover = el("g", { visibility: "hidden" }, svg);
  const cross = el("line", { class: "crosshair", y1: m.top, y2: m.top + ih }, hover);
  const hit = el("rect", { x: m.left, y: m.top, width: iw, height: ih, fill: "transparent" }, svg);
  const tip = document.getElementById("tooltip");
  const card = container.parentElement;

  function onMove(evt) {
    const rect = svg.getBoundingClientRect();
    const v = Math.min(xMax, Math.max(0, xInv(evt.clientX - rect.left)));
    hover.setAttribute("visibility", "visible");
    cross.setAttribute("x1", x(v)); cross.setAttribute("x2", x(v));

    const bi = bins.findIndex(b => v >= b.lo && v < b.hi);
    dots.forEach((d, i) => d.classList.toggle("active", i === bi));
    const b = bins[bi];

    tip.innerHTML =
      `<div class="tt-head">${tab.xName} ${v.toFixed(0)} km/h <span class="tt-muted">(${(v / KMH_PER_MPH).toFixed(0)} mph)</span></div>` +
      (model
        ? `<div class="tt-row"><span class="sw sw-1"></span>Model<b>${fmtPct(logistic(model.a, model.b, v))}</b></div>`
        : `<div class="tt-row tt-placeholder"><span class="sw sw-1"></span>Model<b>${PLACEHOLDER}</b></div>`) +
      (b
        ? `<div class="tt-row"><span class="sw sw-2"></span>Observed ${b.lo}–${b.hi}<b>${fmtPct(b.rate)}</b></div>` +
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
}

// ---------- Notes ----------

function renderNotes(res, tab, dsKey, fit) {
  const modelNote = {
    manual: `<li><strong>Model:</strong> a logistic curve P(injury) = 1 / (1 + e<sup>−(a + b × delta-v)</sup>) using the
      a and b from the sliders.</li>`,
    fitted: `<li><strong>Model:</strong> the same logistic curve with the a and b that best fit the weighted data
      (maximum likelihood), found by <code>analysis/fit_dv_logistic.py</code>${fit ? ` with ${esc(fit.method)}` : ""}.
      Re-run that script after rebuilding the data.</li>`,
  }[tab.model] || `<li><strong>Model:</strong> not yet fitted — the chart shows observed rates only.</li>`;
  const scoreNote = tab.model ? `
    <li><strong>Fit score:</strong> how well the curve matches every occupant's actual outcome, as a weighted geometric
      mean of how much credit the curve earns for each occupant. The best-fit curve has the highest possible score.
      <br><code>score = exp( Σ w × log(credit) / Σ w )</code>
      <br><code>credit</code> = the chance the curve gave what really happened (its prediction if injured, 100% minus it if not)
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

function renderControls() {
  const tab = TABS[state.tab];
  document.querySelectorAll(".tabs [role=tab]").forEach(b => b.setAttribute("aria-selected", String(b.dataset.tab === state.tab)));
  document.getElementById("panel").setAttribute("aria-labelledby", `tab-${state.tab}`);
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
  document.getElementById("fit-info").hidden = tab.model !== "fitted";
  syncSliders();
  document.getElementById("legend-bins").textContent = `Observed rate per ${tab.binWidth} km/h bin`;
}

function renderLegend(tab, model) {
  document.getElementById("legend-model").classList.toggle("placeholder", !model);
  document.getElementById("legend-model-text").textContent = model
    ? model.label
    : tab.model === "fitted" ? "Best-fit curve (not available)" : "Model fit (not yet fitted)";
}

function renderFitInfo(fit) {
  document.getElementById("fit-info").innerHTML = fit
    ? `<p class="formula">P(injury) = 1 / (1 + e<sup>−(a + b × delta-v)</sup>)</p>
       <p class="fit-values"><span><b>a</b> = ${fmtNum(fit.a, 4)}</span><span><b>b</b> = ${fmtNum(fit.b, 5)}</span></p>
       <p class="hint">Found by ${esc(fit.method)} (statsmodels ${esc(fit.statsmodels_version)}) using all
         ${fmtInt(fit.occupants_with_positive_weight)} occupants with a positive case weight.</p>`
    : `<p class="status">Best-fit file <code>app/${FIT_FILE}</code> not found. Run
       <code>.venv/bin/python analysis/fit_dv_logistic.py</code> from the repo root, then reload.</p>`;
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
  renderControls();
  const tab = TABS[state.tab];
  const dsKey = state.dataset[state.tab];
  const token = ++renderToken;
  const weighted = isWeighted();
  const key = `${dsKey}|${weighted}`;
  if (!results.has(key)) {
    document.getElementById("chart").innerHTML = `<p class="status">Loading ${esc(DATASETS[dsKey].label)}…</p>`;
  }
  let res, fit = null;
  try {
    res = await analysis(dsKey, weighted);
  } catch (err) {
    console.error(err);
    document.getElementById("chart").innerHTML = `<p class="status">Data not loaded.</p>`;
    document.getElementById("fallback").hidden = false;
    return;
  }
  if (tab.model) {
    try {
      fit = await loadFit();
    } catch (err) {
      console.error(err);
    }
  }
  if (token !== renderToken) return; // a newer render started meanwhile
  const bins = res.bins.filter(b => b.n >= MIN_BIN_N);
  const model = currentModel(tab, fit);
  if (tab.model === "fitted") renderFitInfo(fit);
  renderLegend(tab, model);
  renderTiles(res, tab, model, fit);
  renderTable(bins, tab, model);
  renderChart(bins, tab, model);
  renderNotes(res, tab, dsKey, fit);
}

// URL hash records the view (e.g. #dv/cds_dv/weighted) so a link reopens it.
function readHash() {
  const [tab, ds, w] = location.hash.replace("#", "").split("/");
  if (TABS[tab]) state.tab = tab;
  if (ds && TABS[state.tab].datasets.includes(ds)) state.dataset[state.tab] = ds;
  state.weighted = w === "weighted";
}
function writeHash() {
  const w = state.weighted ? "/weighted" : "";
  history.replaceState(null, "", `#${state.tab}/${state.dataset[state.tab]}${w}`);
}

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

let resizeTimer, lastWidth = 0;
new ResizeObserver(entries => {
  const w = entries[0].contentRect.width;
  if (w === lastWidth) return;
  lastWidth = w;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(render, 100);
}).observe(document.getElementById("chart"));

readHash();
render();
