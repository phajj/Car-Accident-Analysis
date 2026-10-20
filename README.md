# Car-Accident-Analysis
Modeling and Simulation project analyzing car accidents. 
## Team:
- Peter Hajj
- Jackson Higgins
## Project Statement:
This project will develop a model and simulation examining the relationship between vehicle speed and the severity of car accidents. Rather than predicting whether a crash will
occur, the model will use crash outcome data to estimate the likelihood of injury or fatality given that an accident happens at a particular speed, producing a clear relationship between impact speed and the probability of serious harm. Building on this, the simulation will let a user enter a trip distance, a baseline speed, and a proposed increase in speed. It will then calculate the time saved by driving faster over that distance and set it against the corresponding increase in the risk of injury or death should a crash occur, illustrating the real tradeoff between saving a few minutes and the potential consequences on everyday trips.

Potential future enhancements include incorporating vehicle size and weight as factors in crash outcomes, and applying the simulation to specific local highways, such as Route 114 or I-495, to compare risk and time savings across real-world routes. We will incorporate these enhancements based on the publicly available data we find.

# Crash severity vs. injury risk

A small HTML/CSS/JavaScript web app and data pipeline that plot the observed
rate at which vehicle occupants are injured (deaths included) against crash
severity, using NHTSA's crash investigation surveys:

| Tab | Predictor | Data |
|---|---|---|
| **Pre-crash speed** | EDR (event data recorder) pre-crash vehicle speed | CISS 2017–2024, NASS-CDS 2000–2015 (EDR PDFs), or both pooled |
| **Delta-v** | Reconstructed total delta-v (`DVTOTAL`) | NASS-CDS 2000–2015 |
| **Delta-v: try a & b** | Same, with a logistic curve whose a and b you set with sliders (survey weights only) | NASS-CDS 2000–2015 |
| **Delta-v: best fit** | Same, with the best-fit logistic curve from statsmodels (survey weights only) | NASS-CDS 2000–2015 |

Every estimate can be shown unweighted or with survey weights. Confidence
intervals are not shown at this stage.

The two **Delta-v: …** tabs draw a logistic model,
`P(injury) = 1 / (1 + e^-(a + b × delta-v))`, weighted by `case_weight`. On
**try a & b** you pick a and b; a *fit score* (the weighted geometric mean of
the probability the curve gave each occupant's actual outcome) shows how close
you are to the best curve. **Best fit** loads a and b from
`app/dv_logistic_fit.json`, written by `analysis/fit_dv_logistic.py`
(statsmodels binomial GLM). Re-run it after rebuilding the data:

```bash
.venv/bin/python analysis/fit_dv_logistic.py
```

The other tabs plot binned observed rates only (no confidence intervals); their
model tiles, legend entry, table column and tooltip row are placeholders
(shown as "—").

---

## Quick start

```bash
# from the repo root
python3 -m http.server
# open http://localhost:8000/app/
```

The page must be served over HTTP (browsers block `fetch` from `file://`).
Views are linkable: the URL hash records the tab, data source and weighting,
e.g. `http://localhost:8000/app/#dv/cds_dv/weighted`.

To rebuild everything from the raw NHTSA files, see [Rebuilding the data](#rebuilding-the-data).

---

## Repository layout

```
analysis/
  fit_dv_logistic.py    weighted logistic fit of injury on delta-v -> app/dv_logistic_fit.json
app/
  dv_logistic_fit.json  best-fit a and b loaded by the "Delta-v: best fit" tab
  index.html            page shell: tabs, controls, chart, table view, notes
  style.css             light/dark theme tokens, layout
  stats.js              CSV parsing, binned rates, survey-variance tools (browser + Node)
  datasets.js           the analysis datasets (which CSV, which column, which filter)
  app.js                UI: tabs, controls, tiles, SVG chart, tooltip, table
data/
  build_ciss_combined.py              CISS 2017-2024 -> ciss_combined_speed_injury.csv
  ciss_combined_speed_injury.csv      one row per CISS occupant with EDR speed
  ciss_combined_speed_injury_NOTES.md original notes on the CISS extract
  CISS_<year>_CSV_files/              raw CISS CSV exports (downloaded separately)
  NASS_CDS/
    download_nass_cds.sh              fetches NASS-CDS 2000-2015 tables + EDR archives
    parse_nass_edr.py                 EDR report PDFs -> nass_cds_edr_speed.csv
    build_nass_cds.py                 SAS tables + EDR speeds -> nass_cds_occupant_injury.csv
    nass_cds_edr_speed.csv            one row per EDR report (speed if parsable)
    nass_cds_occupant_injury.csv      one row per NASS-CDS occupant with known outcome
    <year>/                           accident, gv, oa, ve SAS tables
    EDR_Reports/nass<year>.zip        EDR report archives
requirements.txt        Python packages for the data pipeline
```

---

## Data sources

### CISS (Crash Investigation Sampling System), 2017–2024

NHTSA's current in-depth crash survey. A probability sample of police-reported
crashes in which a passenger vehicle was **towed from the scene for any
reason**. Investigators inspect the vehicles, download EDRs, and code injuries
from medical records. Sampling deliberately oversamples fatal crashes, injury
crashes in newer vehicles, and severe injuries; the case weight `CASEWGT`
(inverse selection probability) undoes that.

Design for variance estimation: 12 PSU strata (`PSUSTRAT`, the same 12 in every
year, as NHTSA requires for multi-year analysis) and 24–40 PSUs (`PSU`).

### NASS-CDS (Crashworthiness Data System), 2000–2015

CISS's predecessor. Same type of investigation, but the target population is
crashes in which a passenger vehicle was **towed due to damage**. Weight
`RATWGT`; design variables `PSUSTRAT` (12 strata) and `PSU` (24–27 PSUs).
Downloaded from NHTSA's public bucket
(`https://static.nhtsa.gov/nhtsa/downloads/NASS/<year>/...`).

**EDR data in NASS-CDS is not in the data tables.** NHTSA published it only as
Bosch CDR report printouts:

| Years | Format | Usable here |
|---|---|---|
| 2000–2013 | PDF reports | yes – parsed by `parse_nass_edr.py` |
| 2014 | 1,249 `.CDRx` files | no |
| 2015 | 1,045 `.CDRx` files + 13 third-party PDFs | PDFs only (1 vehicle with speed) |

`.CDRx` files are a short text header followed by the raw binary memory image of
the airbag module; decoding them needs Bosch's manufacturer-specific
translation software, so 2014–2015 have essentially no EDR speed.

---

## Outcome definition

An occupant is **injured = 1** if they had any injury **or died**; **0** if
known uninjured and alive; **excluded** if injury status is unknown and they did
not die.

| | CISS | NASS-CDS |
|---|---|---|
| Death | `MORTALITY` in {1, 2} | `TREATMNT` in {1 fatal, 2 fatal–ruled disease} or `INJSEV` = 4 (K) |
| Injured | `INJSTATUS` = 1; if unknown, `MAIS` > 0 | `MAIS` 1–7 (7 = injured, severity unknown) |
| Not injured | `INJSTATUS` = 2 / `MAIS` = 0 | `MAIS` = 0 |
| Unknown (dropped) | `INJSTATUS` 7/9 and `MAIS` unknown | `MAIS` 8 (not collected) or 9 (unknown) |

NASS-CDS only collects occupant injury data for some vehicles, so 39% of its
occupant rows are `MAIS` = 8 and are dropped. Only passenger vehicles
(`BODYTYPE` 1–49) are kept.

---

## The analysis datasets

Defined once in `app/datasets.js`.

| Key | Rows (occupants) | Predictor | Notes |
|---|---|---|---|
| `ciss_speed` | 19,048 | `accident_speed_kmph` | CISS 2017–2024, vehicles with a usable EDR speed (≈41% of vehicles) |
| `cds_speed` | 7,101 | `edr_speed_kmph` | NASS-CDS vehicles whose EDR PDF had a readable pre-crash speed |
| `pooled_speed` | 22,660 | both of the above | NASS-CDS + CISS 2019–2024 restricted to `cds_in_scope = 1` |
| `cds_dv` | 66,825 | `delta_v_total_kmph` | NASS-CDS 2000–2015 passenger-vehicle occupants with a reconstructed delta-v |

### Who's eligible for each speed graph

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

### Pooling NASS-CDS with CISS

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

---

## Statistical methods

All of this lives in `app/stats.js`.

### Design-based (Taylor linearization) variance

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

### Binned observed rates

Each bin's rate is the (weighted) ratio `r = Σwy / Σw`, plotted at the bin
midpoint. No confidence interval is computed or shown. Bins with fewer than 20
occupants are not plotted.

## EDR speed extraction from NASS-CDS PDFs (`parse_nass_edr.py`)

Each report is converted with `pdftotext -layout`, and the **first** pre-crash
table in the document is parsed. The speed taken is the valid sample (0–250
km/h, time between −10 s and 0 s) **closest to time zero** — the same rule
`build_ciss_combined.py` applies to CISS (`PCODE` 1010). Where a report prints
`MPH [km/h]`, the km/h value is used; MPH-only values are converted.

Report layouts handled:

| Layout | Typical source | Example |
|---|---|---|
| Row: `Time (sec)` header row, speed row beneath | Ford, Chrysler, newer GM | `Vehicle Speed (MPH [km/h])  33.4 [53.8]  31.3 [50.4] …` |
| Row, wrapped label: `Parameter -2.5 sec …`, values on the line under `Vehicle Speed` | GM (2009+) | |
| Column: time in the first column, multi-line column headers | older GM (`Seconds Before AE`), Toyota, Chrysler (`Speed, Vehicle Indicated`), Ford (`- 5.0` time stamps) | |

Column headers are rebuilt by assigning each header word to the nearest data
column, which handles headers wrapped over 4–8 lines. Engine/wheel speed
columns are excluded.

**Coverage**

| Year | Reports | With speed | | Year | Reports | With speed |
|---|---|---|---|---|---|---|
| 2000 | 22 | 11 | | 2008 | 496 | 321 |
| 2001 | 195 | 76 | | 2009 | 627 | 434 |
| 2002 | 372 | 201 | | 2010 | 597 | 413 |
| 2003 | 490 | 311 | | 2011 | 1,241 | 818 |
| 2004 | 696 | 462 | | 2012 | 1,142 | 765 |
| 2005 | 605 | 371 | | 2013 | 1,227 | 853 |
| 2006 | 521 | 368 | | 2014 | 1 | 0 |
| 2007 | 425 | 306 | | 2015 | 13 | 1 |

Total: 8,670 reports, 5,711 with a speed. 4,741 of those vehicles have at least
one occupant with a known outcome (others are non-passenger vehicles or have
only `MAIS` 8/9 occupants), giving 7,101 occupant rows.

Most reports without a speed appear to genuinely have none. Reviewing the 220
unparsed 2012 reports that mention pre-crash data: 52 are Chrysler reports with
only `SNA` ("signal not available") values, 39 flag the speed as invalid / N/A,
and the sampled remainder were modules that don't record pre-crash speed (older
Toyota ECUs) or blank GM records containing only hexadecimal data. Some real
speeds may still be missed in layouts not covered above.

**Validation**

- Spot checks of individual reports against the PDF text match exactly (e.g.
  `2002-43-139-v3`: 4 mph at −1 s → 6.44 km/h; `2013-08-082-v1`: 72 [116] at
  −0.5 s → 116 km/h).
- Against police-estimated travel speed (`TRAVELSP`, where reported), correlation
  is 0.52 (n = 1,480 vehicles) — consistent with published
  findings that police speed estimates are poor; the spot-checked
  disagreements were police errors, not parse errors.
- **Manufacturer mix** (from the VIN prefix in each parsed report): GM is
  100% of 2002, 98% of 2005, 95% of 2008, 75% of 2011 and 57% of 2013 EDR-speed
  vehicles. NASS-CDS speed results are therefore mostly about GM vehicles.

---

## Rebuilding the data

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt   # also needs pdftotext (poppler)

# 1. CISS (raw CSV exports must already be in data/CISS_<year>_CSV_files/)
python3 data/build_ciss_combined.py

# 2. NASS-CDS raw files (~870 MB: SAS tables + EDR archives)
data/NASS_CDS/download_nass_cds.sh

# 3. EDR speeds from the report PDFs (~1 minute with 12 workers)
python3 data/NASS_CDS/parse_nass_edr.py --jobs 12

# 4. NASS-CDS occupant file (needs pandas + pyreadstat)
.venv/bin/python data/NASS_CDS/build_nass_cds.py
```

`build_ciss_combined.py` and `parse_nass_edr.py` use only the Python standard
library (plus `pdftotext`).

---

## Data dictionaries

### `data/ciss_combined_speed_injury.csv`

See `data/ciss_combined_speed_injury_NOTES.md` for the original columns. Added:

| Column | Meaning |
|---|---|
| `psu` | CISS primary sampling unit (`PSU`) |
| `psu_stratum` | CISS PSU stratum (`PSUSTRAT`, 12 strata, consistent across years) |
| `cds_in_scope` | 1 if the crash is in the NASS-CDS target population (passenger vehicle towed due to damage / unknown reason); 0 if not; blank for 2017–2018 (`TOWED` not collected) |

### `data/NASS_CDS/nass_cds_occupant_injury.csv`

| Column | Source | Meaning |
|---|---|---|
| `crash_year` | | NASS-CDS case year |
| `psu`, `psu_stratum` | ACCIDENT `PSU`, `PSUSTRAT` | survey design |
| `case_no`, `vehicle_no`, `occupant_no` | `CASENO`, `VEHNO`, `OCCNO` | identifiers (unique within year + PSU) |
| `delta_v_total_kmph` | GV `DVTOTAL` | total delta-v of the highest-severity impact, km/h (blank = unknown/not reconstructable) |
| `delta_v_long_kmph`, `delta_v_lat_kmph` | GV `DVLONG`, `DVLAT` | longitudinal / lateral components |
| `edr_speed_kmph`, `edr_ptime_sec` | EDR PDF | pre-crash speed closest to t = 0, and its time stamp |
| `police_travel_speed_kmph` | GV `TRAVELSP` | police-reported travel speed, km/h (0 = stopped; 777 not reported / 999 unknown → blank) |
| `speed_limit_kmph` | GV `SPLIMIT` | posted limit |
| `injury_occurred`, `death_occurred` | OA | see outcome definition |
| `injury_severity_mais` | OA `MAIS` | 0–6, 7 = injured unknown severity |
| `occupant_age`, `occupant_sex`, `occupant_seat_pos`, `occupant_belt_use` | OA `AGE`, `SEX`, `SEATPOS`, `MANUSE` | raw NASS codes |
| `vehicle_body_type`, `vehicle_model_year` | GV `BODYTYPE`, `MODELYR` | raw NASS codes |
| `case_weight` | ACCIDENT `RATWGT` | survey weight |

---

## Limitations

- **Tow-away populations only.** "Not injured" means uninjured in a tow-away
  crash, not in all crashes. Weighted estimates describe tow-away crashes
  nationally.
- **EDR availability is not random.** CISS keeps ≈41% of vehicles (those with a
  readable EDR); NASS-CDS EDR speeds come mostly from GM vehicles. Survey
  weights do not correct for which vehicles had a readable EDR.
- **Delta-v is missing for about half of NASS-CDS vehicles** (reconstruction is
  not possible for many rollovers, side-swipes, and impacts with narrow objects
  or heavy vehicles), so the delta-v data describe reconstructable crashes.
- **Single-predictor view.** Rates are not adjusted for belt use, age, seat
  position, impact direction, or vehicle type, all of which strongly affect
  injury risk. The CSVs include belt use, age, sex and seat position for
  future models.
- **"Injury" is broad.** Any AIS 1+ injury counts, so minor injuries dominate.
- **Different eras.** NASS-CDS spans 2000–2015 vehicles; CISS 2017–2024.
  Pooling assumes the speed–injury relationship is stable across that period.
- **EDR speed at the moment closest to impact** can be 0 or very low for
  vehicles that were stopped or braking hard, and occasionally a recorder drop-
  out (e.g. a Ford record that falls to 0.0 at −1 s after 27 mph). The same rule
  is used for CISS and NASS-CDS so they stay comparable.

---

## References

- NHTSA, *Crash Investigation Sampling System: Design Overview, Analytic
  Guidance, and FAQs*, DOT HS 812 801 (rev. Oct 2024) —
  https://crashstats.nhtsa.dot.gov/Api/Public/ViewPublication/812801
- NHTSA, *Overview of the 2019 Crash Investigation Sampling System*, DOT HS
  813 038 — https://crashstats.nhtsa.dot.gov/Api/Public/ViewPublication/813038
- NHTSA, *NASS CDS 2015 Analytical User's Manual*, DOT HS 812 321
- NHTSA, *NASS CDS 2010 Coding and Editing Manual / Code Book*
- NHTSA NASS download change log —
  https://static.nhtsa.gov/nhtsa/downloads/NASS/Change_log.html
