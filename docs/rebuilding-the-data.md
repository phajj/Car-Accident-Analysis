# Rebuilding the data

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

After rebuilding, re-run the model fits so the **Delta-v: best fit** and
**model fits** tabs stay in sync:

```bash
.venv/bin/python analysis/fit_models.py
```
