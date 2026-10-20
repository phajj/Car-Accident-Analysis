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
