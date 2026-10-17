# Notes & Concerns — `ciss_combined_speed_injury.csv`

Built by `build_ciss_combined.py` from NHTSA CISS 2017-2024 CSV exports.
22,383 occupant rows, drawn from 15,434 vehicles (out of 37,155 total vehicles
across all 8 years).

## How the data was constructed

- One row per occupant. All occupants of the same vehicle share that
  vehicle's `accident_speed_kmph`, `delta_v_total_kmph`, `speed_limit_kmph`,
  and vehicle-info columns.
- `accident_speed_kmph` is the vehicle's own Event Data Recorder (EDR)
  pre-crash speed (`PCODE=1010`), read at the time sample closest to the
  moment of impact.
- **Only occupants of vehicles with a usable EDR speed reading are
  included** — a deliberate quality-over-quantity filter. This kept
  41.5% of vehicles (15,434 / 37,155); the rest had no EDR, a non-recoverable
  EDR, or only sentinel/invalid values.
- `injury_occurred` / `injury_severity_mais` (AIS 0-6) and `death_occurred`
  come from the occupant table. `death_occurred` is `True` for 326 of
  22,383 rows (~1.5%).
- All NHTSA "unknown/not applicable" sentinel codes (999, 998, 9/95/99,
  7/9, 99996/99997) were recoded to blank rather than left as fake numbers.

## Is this enough data for a reliable model?

**Row count is not the limiting factor for injury modeling.** Injury
outcomes are close to balanced (~9,087 injured vs. ~9,936 not injured,
with ~3,360 unknown/blank), which is plenty for a speed→injury logistic
model with a handful of predictors.

**Death modeling is thinner.** Only 326 fatal cases exist in the combined
file. That's workable but is a rare-event problem — plain logistic
regression can understate uncertainty on rare outcomes, so prefer a
rare-event-aware method (e.g. Firth-penalized logistic regression) and
evaluate with precision/recall or a calibration plot rather than accuracy
alone.

## Bigger concerns than sample size

1. **EDR-availability selection bias.** The 41.5%-of-vehicles filter is not
   random — it likely skews toward newer vehicles and certain
   manufacturers whose EDR modules are more commonly retrievable after a
   crash. Conclusions from this dataset may not generalize to the full
   crash population, only to the "EDR-recoverable" subset of it.

2. **CISS survey weights should be applied.** CISS is itself a stratified
   probability sample of police-reported crashes, not a simple random
   sample. Every row in the output carries `case_weight` (NHTSA's
   `CASEWGT`) — use it when fitting the model or computing summary
   statistics if you want estimates that are representative of crashes
   nationally, rather than of whichever cases CISS happened to sample.

3. **Rows are clustered, not independent.** 22,383 occupant rows come from
   only 15,434 vehicles — occupants riding together share the same speed
   and vehicle-info values. Naive standard errors/confidence intervals
   will look more precise than they really are. Cluster by
   `vehicle_no` + `case_id` (or `vehicle_vin`) when computing uncertainty,
   or consider aggregating to one row per vehicle (worst-injury outcome)
   if per-occupant granularity isn't needed.

4. **`vehicle_vin` is truncated.** NHTSA publishes only the first 12 of the
   original 17 VIN characters (`vehicle_vin_length` records the true
   length) for privacy. It's useful for grouping/matching but cannot be
   decoded into a full VIN or used to look up an individual vehicle.

## Bottom line

Data volume supports a reasonably reliable speed-vs-injury model. Treat
speed-vs-death results more cautiously given the rare-event count, and in
both cases the sample's representativeness (EDR availability + survey
weighting + vehicle clustering) matters more than adding more rows.
