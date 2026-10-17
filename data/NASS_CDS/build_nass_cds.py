#!/usr/bin/env python3
"""Build one occupant-level CSV from NASS-CDS 2000-2015 relating crash
severity (delta-v, and EDR pre-crash speed where available) to injury.

Inputs (downloaded by download_nass_cds.sh):
  <year>/accident.sas7bdat  case weight (RATWGT) and design (PSU, PSUSTRAT)
  <year>/gv.sas7bdat        vehicle: DVTOTAL, BODYTYPE, MODELYR, TRAVELSP, ...
  <year>/oa.sas7bdat        occupant: MAIS, TREATMNT, INJSEV, DEATH
  nass_cds_edr_speed.csv    EDR pre-crash speed parsed by parse_nass_edr.py

Output: nass_cds_occupant_injury.csv, one row per occupant of a passenger
vehicle (BODYTYPE 1-49) whose injury outcome is known.

Outcome coding (baseline model: deaths count as injuries)
  death_occurred  = TREATMNT in {1 fatal, 2 fatal-ruled disease} or INJSEV == 4 (K)
  injury_occurred = MAIS in 1-7 (7 = injured, severity unknown) or death_occurred
                    False if MAIS == 0 and not a death
  Occupants with MAIS 8 (not collected) / 9 (unknown) who did not die are dropped.

Requires: pandas, pyreadstat (see requirements.txt at the repo root).
"""

import csv
from pathlib import Path

import pandas as pd
import pyreadstat

BASE = Path(__file__).resolve().parent
YEARS = range(2000, 2016)
OUTPUT = BASE / "nass_cds_occupant_injury.csv"
EDR_CSV = BASE / "nass_cds_edr_speed.csv"

MPH_TO_KMPH = 1.609344

FIELDNAMES = [
    "crash_year", "psu", "psu_stratum", "case_no", "vehicle_no", "occupant_no",
    "delta_v_total_kmph", "delta_v_long_kmph", "delta_v_lat_kmph",
    "edr_speed_kmph", "edr_ptime_sec", "police_travel_speed_kmph", "speed_limit_kmph",
    "injury_occurred", "injury_severity_mais", "death_occurred",
    "occupant_age", "occupant_sex", "occupant_seat_pos", "occupant_belt_use",
    "vehicle_body_type", "vehicle_model_year", "case_weight",
]


def read(year, table, cols):
    df, _ = pyreadstat.read_sas7bdat(str(BASE / str(year) / f"{table}.sas7bdat"))
    df.columns = [c.upper() for c in df.columns]
    return df[[c for c in cols if c in df.columns]].copy()


def num(v):
    return None if pd.isna(v) else v


def load_edr():
    if not EDR_CSV.exists():
        print("note: nass_cds_edr_speed.csv not found; run parse_nass_edr.py for EDR speeds")
        return {}
    out = {}
    with open(EDR_CSV, newline="") as f:
        for r in csv.DictReader(f):
            if r["edr_speed_kmph"] != "":
                out[(int(r["year"]), int(r["psu"]), int(r["caseno"]), int(r["vehno"]))] = (
                    float(r["edr_speed_kmph"]), float(r["edr_ptime_sec"]))
    return out


def process_year(year, edr):
    acc = read(year, "accident", ["PSU", "PSUSTRAT", "CASENO", "RATWGT"])
    gv = read(year, "gv", ["PSU", "CASENO", "VEHNO", "BODYTYPE", "MODELYR", "DVTOTAL",
                           "DVLONG", "DVLAT", "TRAVELSP", "SPLIMIT"])
    oa = read(year, "oa", ["PSU", "CASENO", "VEHNO", "OCCNO", "MAIS", "TREATMNT", "INJSEV",
                           "AGE", "SEX", "SEATPOS", "MANUSE"])

    df = oa.merge(gv, on=["PSU", "CASENO", "VEHNO"], how="left").merge(
        acc, on=["PSU", "CASENO"], how="left")
    df = df[(df.BODYTYPE >= 1) & (df.BODYTYPE <= 49)]  # passenger vehicles only

    rows = []
    for r in df.itertuples(index=False):
        mais = num(r.MAIS)
        death = (num(r.TREATMNT) in (1, 2)) or (num(r.INJSEV) == 4)
        if death:
            injury = True
        elif mais is None or mais in (8, 9):
            continue  # injury outcome unknown / not collected
        else:
            injury = 1 <= mais <= 7
        key = (year, int(r.PSU), int(r.CASENO), int(r.VEHNO))
        speed, ptime = edr.get(key, (None, None))
        travel = num(r.TRAVELSP)
        if travel == 777:  # "Not reported" (999 "Unknown" is already SAS-missing)
            travel = None
        rows.append({
            "crash_year": year,
            "psu": int(r.PSU),
            "psu_stratum": int(r.PSUSTRAT) if num(r.PSUSTRAT) is not None else None,
            "case_no": int(r.CASENO),
            "vehicle_no": int(r.VEHNO),
            "occupant_no": int(r.OCCNO),
            "delta_v_total_kmph": num(r.DVTOTAL),
            "delta_v_long_kmph": num(r.DVLONG),
            "delta_v_lat_kmph": num(r.DVLAT),
            "edr_speed_kmph": speed,
            "edr_ptime_sec": ptime,
            # TRAVELSP is already km/h in the SAS files (codebook: "mph x 1.6093 = kmph");
            # 0 means stopped (< 0.5 km/h).
            "police_travel_speed_kmph": travel,
            "speed_limit_kmph": num(r.SPLIMIT),
            "injury_occurred": injury,
            "injury_severity_mais": int(mais) if mais is not None and mais <= 7 else None,
            "death_occurred": death,
            "occupant_age": num(r.AGE),
            "occupant_sex": num(r.SEX),
            "occupant_seat_pos": num(r.SEATPOS),
            "occupant_belt_use": num(r.MANUSE),
            "vehicle_body_type": int(r.BODYTYPE),
            "vehicle_model_year": num(r.MODELYR),
            "case_weight": num(r.RATWGT),
        })
    return rows


def fmt(v):
    if v is None:
        return ""
    if isinstance(v, float) and v.is_integer():
        return int(v)
    return v


def main():
    print("NASS-CDS 2000-2015 occupant injury CSV builder")
    print("=" * 60)
    edr = load_edr()
    all_rows = []
    for year in YEARS:
        if not (BASE / str(year) / "oa.sas7bdat").exists():
            print(f"{year}: data missing, skipping")
            continue
        rows = process_year(year, edr)
        n_dv = sum(1 for r in rows if r["delta_v_total_kmph"] is not None)
        n_edr = sum(1 for r in rows if r["edr_speed_kmph"] is not None)
        print(f"{year}: {len(rows):>6} occupants  {n_dv:>6} with delta-v  {n_edr:>5} with EDR speed")
        all_rows.extend(rows)

    with open(OUTPUT, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=FIELDNAMES)
        w.writeheader()
        for r in all_rows:
            w.writerow({k: fmt(r[k]) for k in FIELDNAMES})

    print("=" * 60)
    print(f"Total occupants: {len(all_rows)}")
    print(f"  with delta-v:   {sum(1 for r in all_rows if r['delta_v_total_kmph'] is not None)}")
    print(f"  with EDR speed: {sum(1 for r in all_rows if r['edr_speed_kmph'] is not None)}")
    print(f"Output: {OUTPUT}")


if __name__ == "__main__":
    main()
