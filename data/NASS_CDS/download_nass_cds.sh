#!/usr/bin/env bash
# Download NASS-CDS 2000-2015 SAS tables (accident, gv, oa, ve) and EDR report
# archives from NHTSA's public S3 bucket. Re-runnable: skips files already present.
set -euo pipefail
cd "$(dirname "$0")"
BASE="https://static.nhtsa.gov/nhtsa/downloads/NASS"
get() { [ -s "$2" ] || curl -sfL -A "Mozilla/5.0" -o "$2" "$1" || { echo "FAILED $1"; rm -f "$2"; }; }

mkdir -p EDR_Reports
for y in $(seq 2000 2015); do
  mkdir -p "$y"
  if [ "$y" = 2000 ]; then
    get "$BASE/2000/PCSAS/PCSAS.zip" "2000/PCSAS.zip"
    (cd 2000 && unzip -oqj PCSAS.zip '*.sas7bdat' 2>/dev/null || unzip -oqj PCSAS.zip)
  else
    if [ "$y" -le 2008 ]; then dir="PCSAS"; else dir="Unformatted%20Data"; fi
    for t in accident gv oa ve; do get "$BASE/$y/$dir/$t.sas7bdat" "$y/$t.sas7bdat"; done
  fi
  get "$BASE/EDR_Reports/nass$y.zip" "EDR_Reports/nass$y.zip"
  echo "$y done"
done
