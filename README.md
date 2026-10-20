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

To rebuild everything from the raw NHTSA files, see [Rebuilding the data](docs/rebuilding-the-data.md).

---

## Documentation

| Doc | Covers |
|---|---|
| [Data sources](docs/data-sources.md) | CISS and NASS-CDS surveys, weights, design variables, EDR availability |
| [Outcome definition](docs/outcome-definition.md) | How injured / not injured / unknown is coded for each survey |
| [Analysis datasets](docs/analysis-datasets.md) | The four datasets in `app/datasets.js`, eligibility rules, pooling NASS-CDS with CISS |
| [Statistical methods](docs/statistical-methods.md) | Taylor linearization variance, binned observed rates |
| [EDR speed extraction](docs/edr-speed-extraction.md) | How `parse_nass_edr.py` reads NASS-CDS EDR PDFs; coverage and validation |
| [Rebuilding the data](docs/rebuilding-the-data.md) | Steps to regenerate the CSVs from the raw NHTSA files |
| [Data dictionaries](docs/data-dictionaries.md) | Column definitions for the output CSVs |
| [Limitations](docs/limitations.md) | Caveats on populations, EDR coverage, predictors and outcomes |
| [References](docs/references.md) | NHTSA manuals and publications |

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
docs/                   project documentation (see table above)
requirements.txt        Python packages for the data pipeline
```
