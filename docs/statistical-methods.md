# Statistical methods

All of this lives in `app/stats.js`.

## Design-based (Taylor linearization) variance

*Not used by the app at present.* `buildDesign`, `stratifiedVariance` and `qt`
are kept in `stats.js` for computing model standard errors later.

Linearized values `zᵢ` are totalled by PSU and combined with the stratified
with-replacement formula:

```
z_hc = Σ_{i in PSU c of stratum h} zᵢ           (PSU totals)
V   = Σ_h  n_h/(n_h−1) Σ_c (z_hc − z̄_h)²
```

PSUs are treated as sampled with replacement within strata (NHTSA's
recommendation given the low PSU sampling fractions). Strata with a single PSU
contribute nothing (none occur in these data). This is applied in **both**
unweighted and weighted mode: unweighted then means "every sampled occupant
counts equally", but the intervals still account for occupants being clustered
within vehicles, crashes and sites.

Intervals use the t distribution with **design degrees of freedom = #PSUs −
#strata** (28 for CISS, 15 for NASS-CDS, 43 pooled), as R's `survey` package
does. The t quantile is a Cornish–Fisher expansion, which agrees with scipy to
five decimals for these df values.

## Binned observed rates

Each bin's rate is the (weighted) ratio `r = Σwy / Σw`, plotted at the bin
midpoint. No confidence interval is computed or shown. Bins with fewer than 20
occupants are not plotted.

## Model fits

`analysis/fit_models.py` fits eight two-parameter curves for Pr[injury or death]
against x (pre-crash speed or delta-v, km/h) to each dataset in
`app/datasets.js`. It writes `app/model_fits.json`, which the **Delta-v: best fit**
and **model fits** tabs load.

| Fit id | Form | Fitted by |
|---|---|---|
| `logit_lin` | logit P = a + b·x | maximum likelihood (logit link) |
| `semilogy_ls` | ln P = a + b·x (semi-log, log of risk) | least squares on ln(bin rate) |
| `semilogy_ml` | ln P = a + b·x | maximum likelihood (log link) |
| `semilogx_ls` | P = a + b·ln x (semi-log, log of x) | least squares on bin rate vs ln(midpoint) |
| `semilogx_ml` | P = a + b·ln x | maximum likelihood (identity link) |
| `loglog_ls` | ln P = a + b·ln x (power model P = e^a·x^b) | least squares on ln(bin rate) vs ln(midpoint) |
| `loglog_ml` | ln P = a + b·ln x | maximum likelihood (log link on ln x) |
| `logit_logx` | logit P = a + b·ln x | maximum likelihood (logit link on ln x) |

- **Plots:** each form is a straight line yt(P) = a + b·xt(x) for its axis
  transforms (x or ln x; P, ln P or logit P). The app plots the bin rates on
  those transformed axes with the fitted line, so you can judge linearity by
  eye. Bins at 0% (and 100% for logit) cannot be transformed and are not shown.
- **Least squares** uses the app's plotted bins (≥ 20 occupants). Each bin is
  weighted by its total case weight. Bins with a 0% rate are dropped wherever
  ln P is taken.
- **Maximum likelihood** is a statsmodels binomial GLM on the individual
  occupants, with `freq_weights = case_weight`. Log- and identity-link fits
  start from the least-squares line.
- Occupants with x = 0 are dropped from every ln x fit; the count is recorded
  per fit.
- **Status:** `ok`; `out_of_range` (the curve leaves 0–100% between 1 km/h and
  the chart's right edge); or `failed` (no convergence or an error). Failed and
  out-of-range fits are kept and shown with a flag.
- **Fit score:** the same score the app uses everywhere, with predictions
  clipped to [1e-9, 1 − 1e-9] so that curves leaving 0–100% can still be scored.
  Higher is better, and scores are comparable across fits on the same dataset.
  ln x fits are scored only on occupants with x > 0.

As with the original delta-v fit, only point estimates are exported: the GLM
standard errors under `freq_weights` treat the weighted population as
independent observations, so they are not meaningful here.
