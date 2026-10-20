"""Fit the best-fit logistic curve of injury on delta-v, using survey weights.

    P(injury) = 1 / (1 + exp(-(a + b * delta_v_kmph)))

Data: NASS-CDS 2000-2015 occupants with a reconstructed delta-v
(data/NASS_CDS/nass_cds_occupant_injury.csv), weighted by case_weight.
The outcome follows the web app (app/stats.js, toRecords): injured or killed = 1,
known uninjured = 0, unknown injury status (and not a death) = dropped.

a and b are the maximum-likelihood estimates from a statsmodels binomial GLM
(logit link). Only a and b are written out: with case_weight passed as
freq_weights the reported standard errors would treat the ~27 million weighted
crashes as independent observations, so they are not meaningful here.

Writes app/dv_logistic_fit.json, which the "Delta-v: best fit" tab loads.

Run from the repo root:
    .venv/bin/python analysis/fit_dv_logistic.py
"""

import json
from pathlib import Path

import numpy as np
import pandas as pd
import statsmodels
import statsmodels.api as sm

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "NASS_CDS" / "nass_cds_occupant_injury.csv"
OUT = ROOT / "app" / "dv_logistic_fit.json"


def main():
    df = pd.read_csv(
        SRC,
        usecols=["delta_v_total_kmph", "injury_occurred", "death_occurred", "case_weight"],
        dtype=str,
    )
    x = pd.to_numeric(df["delta_v_total_kmph"], errors="coerce")
    w = pd.to_numeric(df["case_weight"], errors="coerce")

    # 1 = injured or killed, 0 = known uninjured, NaN = unknown (dropped).
    y = pd.Series(np.nan, index=df.index)
    y[df["injury_occurred"] == "False"] = 0
    y[(df["injury_occurred"] == "True") | (df["death_occurred"] == "True")] = 1

    usable = x.notna() & y.notna()
    keep = usable & (w > 0)  # weight-0 occupants contribute nothing to the fit

    X = sm.add_constant(x[keep].to_numpy())
    fit = sm.GLM(
        y[keep].to_numpy(),
        X,
        family=sm.families.Binomial(),
        freq_weights=w[keep].to_numpy(),
    ).fit()
    a, b = (float(v) for v in fit.params)

    out = {
        "model": "P(injury) = 1 / (1 + exp(-(a + b * delta_v_kmph)))",
        "a": a,
        "b": b,
        "occupants": int(usable.sum()),
        "occupants_with_positive_weight": int(keep.sum()),
        "sum_of_weights": float(w[keep].sum()),
        "weights": "case_weight (NASS-CDS RATWGT)",
        "method": "statsmodels GLM, Binomial family (logit link), freq_weights = case_weight",
        "statsmodels_version": statsmodels.__version__,
        "converged": bool(fit.converged),
    }
    OUT.write_text(json.dumps(out, indent=2) + "\n")

    print(f"occupants: {out['occupants']:,} ({out['occupants_with_positive_weight']:,} with weight > 0)")
    print(f"a = {a:.4f}   b = {b:.5f}   converged = {out['converged']}")
    print(f"odds multiplier per +10 km/h = {np.exp(10 * b):.3f}")
    print(f"delta-v at 50% risk = {-a / b:.1f} km/h")
    print(f"wrote {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
