"""Fit several injury-risk curves to speed and delta-v, using survey weights.

Every fit has two parameters a and b and one of five forms
(P = probability of injury or death, x = speed or delta-v in km/h):

    logit_lin    logit P = a + b * x          (logistic)
    semilogy     ln P    = a + b * x          (semi-log: log of the risk)
    semilogx     P       = a + b * ln x       (semi-log: log of the predictor)
    loglog       ln P    = a + b * ln x       (log-log / power model P = e^a * x^b)
    logit_logx   logit P = a + b * ln x       (logistic on log x)

The transformed forms are each fitted two ways:

    _ls  least squares on the binned observed rates, after transforming them
         (the classic "straighten the curve, then fit a line" approach).
         Bins match the web app (5 km/h delta-v, 10 km/h speed, >= 20 occupants)
         and are weighted by their sum of case weights. Bins with a 0% rate
         cannot be logged and are dropped for ln P.
    _ml  maximum likelihood on the individual occupants: a statsmodels binomial
         GLM with the matching link (logit, log or identity), freq_weights =
         case_weight. Log and identity links do not keep P inside 0-1, so these
         fits can fail or wander outside it; they are kept and labelled.

Occupants with x <= 0 are dropped from every fit that uses ln x.

Each fit gets a status: "ok", "out_of_range" (the curve leaves 0-1 somewhere
between 1 km/h and the right edge of the app's chart) or "failed" (with the
error). Each also gets the app's fit score: the weighted geometric mean of the
probability the curve gave each occupant's actual outcome, with predictions
clipped to [1e-9, 1 - 1e-9] so out-of-range curves can still be scored.

The outcome follows the web app (app/stats.js, toRecords): injured or killed = 1,
known uninjured = 0, unknown injury status (and not a death) = dropped. The
datasets follow app/datasets.js.

Writes app/model_fits.json, which the model-fit tabs load.

Run from the repo root:
    .venv/bin/python analysis/fit_models.py      (Windows: .venv\\Scripts\\python)
"""

import json
import math
import warnings
from pathlib import Path

import numpy as np
import pandas as pd
import statsmodels
import statsmodels.api as sm

ROOT = Path(__file__).resolve().parent.parent
CISS = ROOT / "data" / "ciss_combined_speed_injury.csv"
CDS = ROOT / "data" / "NASS_CDS" / "nass_cds_occupant_injury.csv"
OUT = ROOT / "app" / "model_fits.json"

MIN_BIN_N = 20  # same as app/app.js
CLIP = 1e-9

# Same sources as app/datasets.js; axis settings as the tabs in app/app.js.
DATASETS = {
    "cds_dv": {
        "sources": [(CDS, "delta_v_total_kmph", None)],
        "bin_width": 5, "min_x_max": 60, "tick_step": 10,
    },
    "ciss_speed": {
        "sources": [(CISS, "accident_speed_kmph", None)],
        "bin_width": 10, "min_x_max": 100, "tick_step": 20,
    },
    "cds_speed": {
        "sources": [(CDS, "edr_speed_kmph", None)],
        "bin_width": 10, "min_x_max": 100, "tick_step": 20,
    },
    "pooled_speed": {
        "sources": [
            (CDS, "edr_speed_kmph", None),
            (CISS, "accident_speed_kmph", lambda df: df["cds_in_scope"] == "1"),
        ],
        "bin_width": 10, "min_x_max": 100, "tick_step": 20,
    },
}


def logistic(t):
    return 1 / (1 + np.exp(-t))


# form -> (prediction P(a, b, x), uses ln x)
FORMS = {
    "logit_lin": (lambda a, b, x: logistic(a + b * x), False),
    "semilogy": (lambda a, b, x: np.exp(a + b * x), False),
    "semilogx": (lambda a, b, x: a + b * np.log(x), True),
    "loglog": (lambda a, b, x: np.exp(a + b * np.log(x)), True),
    "logit_logx": (lambda a, b, x: logistic(a + b * np.log(x)), True),
}

LINKS = {
    "logit_lin": sm.families.links.Logit,
    "semilogy": sm.families.links.Log,
    "semilogx": sm.families.links.Identity,
    "loglog": sm.families.links.Log,
    "logit_logx": sm.families.links.Logit,
}

# fit id -> (form, method)
FITS = {
    "logit_lin": ("logit_lin", "ml"),
    "semilogy_ls": ("semilogy", "ls"),
    "semilogy_ml": ("semilogy", "ml"),
    "semilogx_ls": ("semilogx", "ls"),
    "semilogx_ml": ("semilogx", "ml"),
    "loglog_ls": ("loglog", "ls"),
    "loglog_ml": ("loglog", "ml"),
    "logit_logx": ("logit_logx", "ml"),
}


def load(dataset):
    """Occupant records (x, y, w) with a known outcome and positive weight."""
    parts = []
    for path, xcol, filt in dataset["sources"]:
        df = pd.read_csv(path, dtype=str)
        if filt is not None:
            df = df[filt(df)]
        y = pd.Series(np.nan, index=df.index)
        y[df["injury_occurred"] == "False"] = 0
        y[(df["injury_occurred"] == "True") | (df["death_occurred"] == "True")] = 1
        parts.append(pd.DataFrame({
            "x": pd.to_numeric(df[xcol], errors="coerce"),
            "y": y,
            "w": pd.to_numeric(df["case_weight"], errors="coerce"),
        }))
    d = pd.concat(parts, ignore_index=True)
    d = d[d["x"].notna() & d["y"].notna()]
    return d[d["w"] > 0].reset_index(drop=True)  # weight-0 occupants contribute nothing


def bins(d, width):
    """Weighted observed rate per bin, as Stats.binRates; bins with n < MIN_BIN_N dropped."""
    k = np.floor(d["x"] / width)
    g = d.assign(k=k, wy=d["w"] * d["y"]).groupby("k").agg(n=("y", "size"), sw=("w", "sum"), swy=("wy", "sum"))
    g = g[g["n"] >= MIN_BIN_N]
    return pd.DataFrame({
        "lo": g.index * width,
        "mid": g.index * width + width / 2,
        "rate": g["swy"] / g["sw"],
        "sw": g["sw"],
    }).reset_index(drop=True)


def chart_x_max(b, dataset):
    """The right edge of the app's chart (renderChart's xMax)."""
    step = dataset["tick_step"]
    last_hi = b["lo"].iloc[-1] + dataset["bin_width"]
    return max(dataset["min_x_max"], math.ceil(last_hi / step) * step)


def score(predict, a, b, d):
    p = np.clip(predict(a, b, d["x"].to_numpy()), CLIP, 1 - CLIP)
    y, w = d["y"].to_numpy(), d["w"].to_numpy()
    ll = np.where(y == 1, np.log(p), np.log1p(-p))
    return float(np.exp((w * ll).sum() / w.sum()))


def fit_ls(form, b):
    """Weighted least squares of the transformed bin rate on the (transformed) midpoint."""
    rate, mid = b["rate"].to_numpy(), b["mid"].to_numpy()
    dropped_zero = 0
    if form in ("semilogy", "loglog"):
        keep = rate > 0
        dropped_zero = int((~keep).sum())
        rate, mid, sw = rate[keep], mid[keep], b["sw"].to_numpy()[keep]
        resp = np.log(rate)
    else:
        sw = b["sw"].to_numpy()
        resp = rate
    pred = np.log(mid) if FORMS[form][1] else mid
    res = sm.WLS(resp, sm.add_constant(pred), weights=sw).fit()
    a, bb = (float(v) for v in res.params)
    return a, bb, {"bins_used": int(len(resp)), "dropped_zero_bins": dropped_zero, "r_squared": float(res.rsquared)}


def fit_ml(form, d, start):
    """Binomial GLM on occupants with the form's link."""
    x = d["x"].to_numpy()
    pred = np.log(x) if FORMS[form][1] else x
    fam = sm.families.Binomial(link=LINKS[form]())
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        res = sm.GLM(d["y"].to_numpy(), sm.add_constant(pred), family=fam,
                     freq_weights=d["w"].to_numpy()).fit(start_params=start)
    a, bb = (float(v) for v in res.params)
    msgs = sorted({str(w.message).splitlines()[0] for w in caught})
    return a, bb, {"converged": bool(res.converged), "warnings": msgs}


def run_fit(fit_id, dataset, d_all, b_all):
    form, method = FITS[fit_id]
    predict, uses_logx = FORMS[form]
    d = d_all[d_all["x"] > 0] if uses_logx else d_all
    out = {
        "n_used": int(len(d)),
        "dropped_nonpositive_x": int(len(d_all) - len(d)),
    }
    try:
        if method == "ls":
            a, bb, extra = fit_ls(form, b_all)
        else:
            # Start log/identity-link fits from the least-squares line, which is
            # usually inside the valid region; logit fits start from zero.
            start = None
            if form in ("semilogy", "semilogx", "loglog"):
                start = np.array(fit_ls(form, b_all)[:2])
            a, bb, extra = fit_ml(form, d, start)
        out.update(extra)
        if not (math.isfinite(a) and math.isfinite(bb)):
            raise ValueError("non-finite estimates")
        out.update(a=a, b=bb)
        if method == "ml" and not out["converged"]:
            out.update(status="failed", message="GLM did not converge")
        else:
            grid = np.linspace(1, chart_x_max(b_all, dataset), 400)
            p = predict(a, bb, grid)
            lo, hi = float(np.min(p)), float(np.max(p))
            if lo < 0 or hi > 1:
                cross = grid[(p < 0) | (p > 1)]
                out.update(status="out_of_range",
                           message=f"predicted risk runs from {lo:.1%} to {hi:.1%} on 1–{grid[-1]:.0f} km/h "
                                   f"(outside 0–100% from about {cross[0]:.0f} km/h)" if cross[0] > 1
                                   else f"predicted risk runs from {lo:.1%} to {hi:.1%} on 1–{grid[-1]:.0f} km/h")
            else:
                out["status"] = "ok"
        out["score"] = score(predict, a, bb, d)
    except Exception as err:  # noqa: BLE001 — every failure is recorded, not raised
        out.update(status="failed", message=f"{type(err).__name__}: {err}")
    return out


def main():
    fits = {fid: {} for fid in FITS}
    for ds_key, dataset in DATASETS.items():
        d = load(dataset)
        b = bins(d, dataset["bin_width"])
        for fid in FITS:
            fits[fid][ds_key] = run_fit(fid, dataset, d, b)

    out = {
        "fits": fits,
        "weights": "case_weight (CISS CASEWGT, NASS-CDS RATWGT)",
        "statsmodels_version": statsmodels.__version__,
        "min_bin_n": MIN_BIN_N,
    }
    OUT.write_text(json.dumps(out, indent=2) + "\n", encoding="utf-8")

    print(f"{'fit':<13}{'dataset':<14}{'a':>10}{'b':>11}{'score':>9}  status")
    for fid, by_ds in fits.items():
        for ds_key, f in by_ds.items():
            a = f"{f['a']:.4f}" if "a" in f else "—"
            bb = f"{f['b']:.5f}" if "b" in f else "—"
            s = f"{f['score']:.2%}" if "score" in f else "—"
            print(f"{fid:<13}{ds_key:<14}{a:>10}{bb:>11}{s:>9}  {f['status']}"
                  + (f" ({f['message']})" if f.get("message") else ""))
    print(f"wrote {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
