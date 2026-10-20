# The analysis datasets

Defined once in `app/datasets.js`.

| Key | Rows (occupants) | Predictor | Notes |
|---|---|---|---|
| `ciss_speed` | 19,048 | `accident_speed_kmph` | CISS 2017–2024, vehicles with a usable EDR speed (≈41% of vehicles) |
| `cds_speed` | 7,101 | `edr_speed_kmph` | NASS-CDS vehicles whose EDR PDF had a readable pre-crash speed |
| `pooled_speed` | 22,660 | both of the above | NASS-CDS + CISS 2019–2024 restricted to `cds_in_scope = 1` |
| `cds_dv` | 66,825 | `delta_v_total_kmph` | NASS-CDS 2000–2015 passenger-vehicle occupants with a reconstructed delta-v |

## Who's eligible for each speed graph

Each graph has its own eligibility rule, so a row can appear in one graph but
not another:

| Graph | Who's eligible |
|---|---|
| **CISS only** | Any CISS occupant in a crash where a vehicle was **towed for any reason** (CISS's own definition) |
| **NASS-CDS only** | Any NASS-CDS occupant in a crash where a vehicle was **towed due to damage** (NASS-CDS's own definition) |
| **Pooled** | Only crashes that fit **both** definitions — in practice the narrower one, **towed due to damage** (or towed, reason unknown) |

The extra filter exists only for pooling. A crash where a car was towed
because, say, the driver was arrested is a valid CISS crash and belongs in the
CISS-only graph, but NASS-CDS would never have sampled it, so mixing it into
the pooled data would combine two different crash populations. CISS 2017–2018
rows meet CISS's own rule but cannot be checked against the pooled rule (the
tow-reason variable `TOWED` starts in 2019), so they are left out of the pooled
data.

Where the CISS rows go (every NASS-CDS row is kept):

| | Rows |
|---|---|
| CISS only (`ciss_speed`) | 19,048 |
| − CISS 2017–2018 (tow reason not recorded) | −3,332 |
| − CISS 2019–2024 not towed due to damage | −157 |
| = CISS rows in the pooled data | 15,559 |
| + NASS-CDS (`cds_speed`) | 7,101 |
| **= Pooled (`pooled_speed`)** | **22,660** |

## Pooling NASS-CDS with CISS

Follows NHTSA's documented procedure (DOT HS 812 801, §5.3, Example 3):

1. **Match target populations.** CISS includes vehicles towed for any reason;
   NASS-CDS only towed-due-to-damage. A CISS crash is "CDS in scope" when at
   least one passenger vehicle (`BODYTYPE` 1–49) has `TOWED` = 2 (towed due to
   damage) or 7 (towed, reason unknown). `build_ciss_combined.py` writes this as
   `cds_in_scope`. `TOWED` only exists from 2019, so **CISS 2017–2018 cannot be
   classified and is excluded from the pooled data** (blank `cds_in_scope`).
   98–99% of CISS 2019–2024 EDR rows are in scope.
2. **Keep the surveys as separate strata.** The two samples were drawn
   independently, so the survey (`STUDY`) is added as an extra stratification
   level: strata are `CDS:<PSUSTRAT>` and `CISS:<PSUSTRAT>` (24 strata, 67 PSUs).
3. **Taylor-series variance** (the adjusted jackknife replicate weights NHTSA
   ships are valid for single-year CISS only).

With survey weights on, the pooled estimate represents the combined crash
populations of all included years (each year's weights sum to that year's
population).
