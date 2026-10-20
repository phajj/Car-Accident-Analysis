# Future enhancements

## 95% error bars on the bin dots (simple standard error)

**Goal:** draw a vertical 95% error bar through every observed-rate dot, so
bins with few occupants (or a few very large survey weights) visibly carry
less certainty. Example: the 90–95 km/h delta-v bin looks low (78% weighted)
only because one uninjured occupant carries about 21% of the bin's weight. An
error bar would show that this dot is still consistent with the model curve.

This plan uses the simple standard error with an effective sample size. It
does **not** account for the survey's PSU/stratum design. See
[Not in scope](#not-in-scope).

### The math

For each bin, with `p` the bin's injury rate (weighted or unweighted, as the
app already computes it):

| Quantity | Formula | Meaning |
|---|---|---|
| Effective sample size | `n_eff = (Σw)² / Σw²` | how many equally weighted people the bin is "worth"; equals `n` when unweighted (all `w = 1`) |
| Standard error | `SE = √( p(1 − p) / n_eff )` | typical size of the error that comes from who happened to be sampled |
| 95% error bar | `p ± 1.96 × SE`, clipped to 0–100% | range the true rate is likely in |

Clipping is needed because the formula can go past 100% (or below 0%) for
small bins near the edges. For example, the 90–95 km/h bin gives 52%–104%.

### Implementation steps

1. **`app/stats.js` → `binRates`:** also accumulate `sw2 += w * w` per bin,
   using the same `w` the bin already uses (1 when unweighted). Return
   `nEff`, `se`, `lo95`, `hi95` on each bin. Name the bounds so they don't
   clash with the existing `lo`/`hi`, which are the bin's km/h edges. Guard
   against `sw2 = 0`, which happens when every weight in the bin is 0.
2. **`app/app.js` → `renderChart`:** before drawing the dots, draw one
   vertical `<line>` per bin from `y(lo95)` to `y(hi95)` at `x(mid)`, plus
   short horizontal caps. Draw the bars first so the dots sit on top.
3. **`app/style.css`:** add a `.bin-err` style that uses `var(--series-2)` at
   reduced opacity, so it works in both light and dark themes.
4. **Tooltip (`onMove` in `renderChart`):** add a row under the observed rate,
   e.g. `95% range 47%–94% · n_eff 9.7`.
5. **Table (`app/index.html` + `renderTable`):** add a "95% range" column
   after "Observed rate". Optionally add an "Effective n" column.
6. **Legend (`app/index.html`):** change the bins key to
   "Observed rate per bin (± 95% range)".
7. **Notes (`renderNotes`):** add a short "Error bars" entry with the formula
   and a line for each variable, matching the fit score entry. State that the
   bars ignore the survey's cluster design and so are somewhat too narrow.

This applies to every tab, because all tabs share `binRates`.

### How to check it

- Unweighted: `n_eff` should equal the bin's occupant count.
- Weighted delta-v (NASS-CDS 2000–2015), 5 km/h bins:

  | Bin | n | Weighted rate | n_eff | SE | Expected bar |
  |---|---|---|---|---|---|
  | 20–25 km/h | 11,693 | 52.4% | ≈1,504 | ≈1.3% | ≈49.9%–54.9% |
  | 90–95 km/h | 80 | 78.3% | ≈9.7 | ≈13.3% | ≈52.3%–100% (clipped from 104.3%) |

- Bars should be visibly wider at high delta-v, where bins are small.

### Not in scope

- **Wilson interval:** a better formula near 0% and 100% that never needs
  clipping. It would give 47%–94% for the 90–95 km/h bin. It's a small,
  self-contained change to step 1 if the clipped bars look misleading.
- **Survey-design (Taylor linearization) error bars:** the correct method for
  NASS-CDS, using `psu` and `psu_stratum` with a t-quantile. The tools already
  exist in `app/stats.js` (`buildDesign`, `stratifiedVariance`, `qt`). Expect
  these bars to be somewhat wider than the simple version.
- **Error band around the model curve:** needs the uncertainty in `a` and `b`,
  which the current fit script doesn't export (see
  `analysis/fit_models.py`).
