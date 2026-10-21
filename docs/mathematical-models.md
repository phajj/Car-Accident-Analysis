# Mathematical models

This page lists every mathematical model used in the project: what each formula
is, what it says about how injury risk changes with speed, and how it is fitted.
The code is in `analysis/fit_models.py` (fitting) and `app/app.js` / `app/stats.js`
(plotting, scoring and the survey tools). For the reasoning behind the methods,
see [Statistical methods](statistical-methods.md).

## Notation

| Symbol | Meaning |
|---|---|
| `x` | The predictor in km/h: EDR pre-crash speed, or total delta-v (`DVTOTAL`) |
| `P(x)` | Pr[injury], the probability an occupant is injured or killed in a crash at `x` |
| `yᵢ` | Occupant *i*'s outcome: 1 = injured or killed, 0 = known uninjured (unknowns are dropped) |
| `wᵢ` | Occupant *i*'s survey case weight (`case_weight`: CISS `CASEWGT`, NASS-CDS `RATWGT`) |
| `a`, `b` | The two parameters every model has: `a` sets the level, `b` sets how fast risk changes |
| `ln` | Natural logarithm |
| `logit P` | `ln(P / (1 − P))`, the log of the odds of injury |

Every model below has the same structure: after transforming the axes, it is a
straight line

```
yt(P) = a + b · xt(x)
```

where `xt` is either `x` or `ln x`, and `yt` is `P`, `ln P` or `logit P`. That is
why the app's **model fits** tabs plot the data on transformed axes: if the form
is right, the points lie along a straight line.

| Model | `yt(P)` | `xt(x)` | Fit ids |
|---|---|---|---|
| [Logistic](#logistic-model) | `logit P` | `x` | `logit_lin` |
| [Semi-log y (exponential)](#semi-log-y-model-exponential-risk) | `ln P` | `x` | `semilogy_ls`, `semilogy_ml` |
| [Semi-log x (logarithmic)](#semi-log-x-model-logarithmic-risk) | `P` | `ln x` | `semilogx_ls`, `semilogx_ml` |
| [Log-log (power)](#log-log-model-power-law) | `ln P` | `ln x` | `loglog_ls`, `loglog_ml` |
| [Logistic on ln x (log-logistic)](#logistic-on-ln-x-model-log-logistic) | `logit P` | `ln x` | `logit_logx` |

The `_ls` and `_ml` suffixes name the fitting method: least squares on binned
rates, or maximum likelihood on individual occupants. Both are described under
[Fitting methods](#fitting-methods).

---

## Binned observed rate

Not a model, but the data every chart and every least-squares fit is built on.
Occupants are grouped into bins of width `h` (5 km/h for delta-v, 10 km/h for
speed). Bin `k` holds every occupant with `floor(x / h) = k`, and its rate is

```
r_k = Σ wᵢ yᵢ / Σ wᵢ          (sums over occupants in bin k)
m_k = k·h + h/2               (bin midpoint, where the rate is plotted)
W_k = Σ wᵢ                    (bin's total weight, used by least squares)
```

With weighting off, every `wᵢ = 1` and `r_k` is the plain share of occupants
injured. Bins with fewer than 20 occupants are not plotted or fitted.

**What it does:** gives a model-free estimate of risk at each speed, which the
models are compared against.

---

## Logistic model

```
P(x) = 1 / (1 + e^−(a + b·x))

equivalently   logit P = ln(P / (1 − P)) = a + b·x
```

**What it does:** describes an S-shaped curve. Risk starts near 0 at low speed,
rises fastest in the middle, and levels off toward 100% at high speed. It is the
standard model for a yes/no outcome, and it can never predict a risk below 0% or
above 100%.

**Reading the parameters:**

- The **odds** of injury, `P / (1 − P) = e^(a + b·x)`, are multiplied by `e^(10·b)`
  for every extra 10 km/h. The app shows this as the "odds multiplier per +10 km/h".
- Risk reaches **50%** at `x = −a / b` (when `b > 0`).
- The slope of the curve is `dP/dx = b · P · (1 − P)`, steepest at 50%.

**Fitted by:** maximum likelihood (binomial GLM, logit link). This is the curve on
the **Delta-v: best fit** tab, and the curve whose `a` and `b` you set by hand on
**Delta-v: try a & b**.

*Example:* on NASS-CDS delta-v, `a = −1.176`, `b = 0.0541`. The odds of injury
grow 1.72× per +10 km/h, and risk reaches 50% at about 21.7 km/h.

---

## Semi-log y model (exponential risk)

```
ln P(x) = a + b·x

equivalently   P(x) = e^(a + b·x) = e^a · (e^b)^x
```

**What it does:** risk grows by a fixed *percentage* for every km/h. Plotting
`ln P` against `x` straightens it into a line.

**Reading the parameters:**

- `e^a` is the risk the curve gives at `x = 0`.
- Risk itself (not the odds) is multiplied by `e^(10·b)` for every extra 10 km/h.
- Risk reaches 50% at `x = (ln 0.5 − a) / b`.
- Nothing stops it growing past 100%: `P > 1` once `x > −a / b`. This is why some
  fits are flagged `out_of_range`.

**Fitted by:**

- `semilogy_ls`: weighted least squares of `ln r_k` on `m_k`. Bins with a 0% rate
  have no logarithm and are dropped.
- `semilogy_ml`: maximum likelihood (binomial GLM, log link).

---

## Semi-log x model (logarithmic risk)

```
P(x) = a + b · ln x
```

**What it does:** risk rises quickly at low speed and more slowly at high speed.
Each *doubling* of speed adds the same number of percentage points. Plotting `P`
against `ln x` straightens it into a line.

**Reading the parameters:**

- Doubling `x` adds `b · ln 2` (about `0.693·b`) to the risk. The app shows this in
  percentage points.
- Risk reaches 50% at `x = e^((0.5 − a) / b)`.
- The curve is unbounded both ways: it falls below 0% for `x < e^(−a / b)` and
  passes 100% at `x = e^((1 − a) / b)`.
- `ln x` needs `x > 0`, so occupants at 0 km/h are left out.

**Fitted by:**

- `semilogx_ls`: weighted least squares of `r_k` on `ln m_k`.
- `semilogx_ml`: maximum likelihood (binomial GLM, identity link).

---

## Log-log model (power law)

```
ln P(x) = a + b · ln x

equivalently   P(x) = e^a · x^b
```

**What it does:** risk is a power of speed. This is the form of the classic
"power model" in road-safety research, where crash outcomes scale with speed
raised to a fixed exponent. Plotting `ln P` against `ln x` straightens it into a
line.

**Reading the parameters:**

- `b` is the exponent: a 1% increase in `x` raises risk by about `b`%.
- Doubling `x` multiplies risk by `2^b`.
- `e^a` is the risk the curve gives at `x = 1 km/h`.
- Risk reaches 50% at `x = e^((ln 0.5 − a) / b)`, and passes 100% at
  `x = e^(−a / b)`.
- Occupants at 0 km/h are left out (no `ln x`).

**Fitted by:**

- `loglog_ls`: weighted least squares of `ln r_k` on `ln m_k`, dropping 0% bins.
- `loglog_ml`: maximum likelihood (binomial GLM, log link, predictor `ln x`).

---

## Logistic on ln x model (log-logistic)

```
logit P(x) = a + b · ln x

equivalently   P(x) = 1 / (1 + e^−(a + b·ln x)) = x^b / (x^b + e^−a)
```

**What it does:** an S-curve like the logistic model, but in `ln x` instead of
`x`. It is 0 at `x = 0`, stays inside 0–100% everywhere, and with `b > 1` rises
slowly at first and then steeply. It combines the power law's behaviour at low
speed with the logistic model's leveling off at high speed.

**Reading the parameters:**

- The odds of injury are `e^a · x^b`, a power law, so doubling `x` multiplies the
  odds by `2^b`.
- Risk reaches 50% at `x = e^(−a / b)`.
- Occupants at 0 km/h are left out (no `ln x`).

**Fitted by:** maximum likelihood (binomial GLM, logit link, predictor `ln x`).

---

## Fitting methods

### Weighted least squares on bins (`_ls` fits)

The "straighten the curve, then fit a line" approach. Each bin's observed rate
and midpoint are transformed with the model's `yt` and `xt`, then a line is
fitted:

```
choose a, b to minimise   Σ_k W_k · ( yt(r_k) − a − b · xt(m_k) )²
```

Each bin counts in proportion to its total weight `W_k`. Bins with `r_k = 0` are
dropped wherever `ln P` is taken. The fit also reports `R²` on the transformed
scale. It is quick and easy to see on a chart, but it ignores how many occupants
are in each bin beyond `W_k`, depends on the bin width, and has to throw away
0% bins.

### Weighted maximum likelihood on occupants (`_ml` fits and both logistic fits)

Every occupant is used directly. Each outcome is a coin flip with probability
`P(xᵢ)`, and the parameters are the ones that make the observed outcomes most
likely:

```
choose a, b to maximise   ℓ(a, b) = Σᵢ wᵢ · [ yᵢ · ln P(xᵢ) + (1 − yᵢ) · ln(1 − P(xᵢ)) ]
```

This is solved as a statsmodels binomial GLM with `freq_weights = case_weight`
and the link that matches the model (logit, log or identity). The log- and
identity-link fits start from their least-squares line.

### Constrained maximum likelihood (fallback)

The log and identity links don't keep `P` inside 0–1. If the GLM's iterations
step outside it (it errors, or doesn't converge), the same `ℓ(a, b)` is
maximised directly with SLSQP, subject to

```
ε ≤ P(x_min) ≤ 1 − ε    and    ε ≤ P(x_max) ≤ 1 − ε        (ε = 10⁻⁹)
```

where `x_min` and `x_max` are the smallest and largest observed predictor values.
Every form is monotone in `a + b · xt(x)`, so bounding `P` at the two ends bounds
it at every occupant. The constraints are applied to the linear predictor
(`ln ε ≤ a + b·xt ≤ ln(1 − ε)` for the log link). The fit's message says when this
was used. On NASS-CDS delta-v it applies to `semilogy_ml`, `semilogx_ml` and
`loglog_ml`.

### Fit status

Each fitted curve is checked on 400 evenly spaced points from 1 km/h to the
chart's right edge:

- `ok`: `0 ≤ P ≤ 1` at every point.
- `out_of_range`: the curve leaves 0–100% somewhere on that range.
- `failed`: no convergence, or an error.

---

## Fit score

The single number the app uses to compare curves on the same data:

```
S = exp( Σᵢ wᵢ · ln cᵢ / Σᵢ wᵢ )

cᵢ = P(xᵢ)        if occupant i was injured or killed
cᵢ = 1 − P(xᵢ)    if not
```

`cᵢ` is the "credit" the curve earns for occupant *i*: the chance it gave what
actually happened. `S` is their weighted geometric mean, so it is
`exp(ℓ / Σ w)`, the likelihood maximised above, scaled per occupant. Higher is
better. The maximum-likelihood fit has the highest possible score for its form.

Predictions are clipped to `[10⁻⁹, 1 − 10⁻⁹]` so that curves leaving 0–100% can
still be scored. For the two logistic forms the app computes `ln cᵢ` from the
linear predictor `z = a + b · xt(x)` without clipping, using

```
ln P = −softplus(−z),    ln(1 − P) = −softplus(z),    softplus(t) = ln(1 + e^t)
```

which avoids rounding errors at extreme `z`. Fits on `ln x` are scored only on
occupants with `x > 0`.

---

## Survey variance (not used by the app yet)

`app/stats.js` keeps the tools to add confidence intervals later. They are the
standard design-based (Taylor linearization) method for complex surveys like
CISS and NASS-CDS.

**Stratified with-replacement variance.** Linearized values `zᵢ` are summed per
primary sampling unit (PSU) `c` in stratum `h`, then

```
z_hc = Σ_{i in PSU c of stratum h} zᵢ
V    = Σ_h  n_h / (n_h − 1) · Σ_c (z_hc − z̄_h)²
```

where `n_h` is the number of PSUs in stratum `h` and `z̄_h` their mean. Strata
with one PSU contribute nothing.

**t quantile.** Intervals would use the t distribution with
`df = #PSUs − #strata`. The quantile is computed with a Cornish–Fisher expansion
around the normal quantile `z = Φ⁻¹(p)` (from Acklam's algorithm):

```
t ≈ z + (z³ + z)/(4·df)
      + (5z⁵ + 16z³ + 3z)/(96·df²)
      + (3z⁷ + 19z⁵ + 17z³ − 15z)/(384·df³)
      + (79z⁹ + 776z⁷ + 1482z⁵ − 1920z³ − 945z)/(92160·df⁴)
```

---

## Current fitted values

From `app/model_fits.json` (survey-weighted). Re-running
`analysis/fit_models.py` after rebuilding the data will change these.

| Fit | NASS-CDS delta-v (a, b) | CISS speed (a, b) | NASS-CDS EDR speed (a, b) | Pooled speed (a, b) |
|---|---|---|---|---|
| `logit_lin` | −1.176, 0.0541 | −1.256, 0.00545 | −0.411, 0.00625 | −1.082, 0.00369 |
| `semilogy_ls` | −1.258, 0.0235 ⚠ | −1.490, 0.00350 | −0.929, 0.00342 | −1.366, 0.00232 |
| `semilogy_ml` | −0.858, 0.00517 | −1.501, 0.00392 | −0.910, 0.00322 | −1.371, 0.00260 |
| `semilogx_ls` | −0.250, 0.248 ⚠ | 0.160, 0.0305 | 0.309, 0.0446 | 0.211, 0.0211 |
| `semilogx_ml` | 0.000, 0.166 | 0.157, 0.0310 | 0.283, 0.0505 | 0.204, 0.0228 |
| `loglog_ls` | −2.324, 0.531 ⚠ | −1.697, 0.103 | −1.101, 0.0911 | −1.495, 0.0661 |
| `loglog_ml` | −1.761, 0.344 | −1.817, 0.138 | −1.220, 0.125 | −1.584, 0.0918 |
| `logit_logx` | −3.254, 1.089 | −1.652, 0.180 | −0.908, 0.213 | −1.359, 0.123 |

⚠ = `out_of_range`: the curve leaves 0–100% within the chart.
