#!/usr/bin/env python3
"""Build one combined CSV relating accident speed to injury/death outcomes
from NHTSA CISS yearly CSV exports (2017-2024) in this directory.

See ciss_combined_speed_injury_NOTES.md for column definitions and coding.
"""

import csv
from pathlib import Path

BASE = Path(__file__).resolve().parent
YEARS = range(2017, 2025)
OUTPUT = BASE / "ciss_combined_speed_injury.csv"
ENCODING = "latin-1"

MAIS_UNKNOWN = {9, 95, 99}
INJSTATUS_UNKNOWN = {7, 9}
MORTALITY_FATAL = {1, 2}
EDR_SENTINEL_PVALUES = {99996, 99997}
EDR_LEGACY_SENTINEL_2017 = -99.981

FIELDNAMES = [
    "crash_year", "case_id", "case_number", "vehicle_no", "occupant_no",
    "accident_speed_kmph", "edr_ptime_sec",
    "delta_v_total_kmph", "speed_limit_kmph",
    "injury_occurred", "injury_severity_mais", "death_occurred",
    "vehicle_vin", "vehicle_vin_length", "vehicle_make", "vehicle_model",
    "vehicle_model_year", "vehicle_body_class", "vehicle_curb_weight_lb",
    "case_weight", "psu", "psu_stratum", "cds_in_scope",
]


def find_file(year_dir, *names):
    lower_names = {n.lower() for n in names}
    for p in year_dir.iterdir():
        if p.is_file() and p.name.lower() in lower_names:
            return p
    return None


def norm_key(s):
    s = (s or "").strip()
    return s or None


def to_float(s):
    s = (s or "").strip()
    if not s:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def to_int(s):
    f = to_float(s)
    return int(f) if f is not None else None


def read_csv(path):
    with open(path, newline="", encoding=ENCODING) as f:
        yield from csv.DictReader(f)


def extract_edr_speeds(edr_path):
    """Return {(case_id, veh_no): {"accident_speed_kmph": ..., "edr_ptime_sec": ...}}
    using PCODE=1010 (Vehicle Speed, km/h), reading closest to PTIME=0 (impact),
    preferring the smallest EDREVENTNO when a vehicle has multiple recorded events.
    """
    best_by_event = {}  # (case_id, veh_no, event_no) -> (ptime, pvalue)
    for row in read_csv(edr_path):
        if to_int(row.get("PCODE")) != 1010:
            continue
        case_id = norm_key(row.get("CASEID"))
        veh_no = norm_key(row.get("VEHNO"))
        event_no = norm_key(row.get("EDREVENTNO"))
        if not case_id or not veh_no or not event_no:
            continue
        ptime = to_float(row.get("PTIME"))
        pvalue = to_float(row.get("PVALUE"))
        if ptime is None or pvalue is None:
            continue
        if pvalue in EDR_SENTINEL_PVALUES:
            continue
        if abs(pvalue - EDR_LEGACY_SENTINEL_2017) < 0.001:
            continue
        if not (0 <= pvalue <= 250):
            continue
        if not (-10 <= ptime <= 0):
            continue
        key = (case_id, veh_no, event_no)
        cur = best_by_event.get(key)
        if cur is None or ptime > cur[0]:
            best_by_event[key] = (ptime, pvalue)

    per_vehicle = {}  # (case_id, veh_no) -> (event_no_int, ptime, pvalue)
    for (case_id, veh_no, event_no), (ptime, pvalue) in best_by_event.items():
        event_int = to_int(event_no)
        vkey = (case_id, veh_no)
        cur = per_vehicle.get(vkey)
        if cur is None or (event_int is not None and (cur[0] is None or event_int < cur[0])):
            per_vehicle[vkey] = (event_int, ptime, pvalue)

    return {
        vkey: {"accident_speed_kmph": pvalue, "edr_ptime_sec": ptime}
        for vkey, (_event_int, ptime, pvalue) in per_vehicle.items()
    }


def extract_vehicle_info(gv_path):
    info = {}
    for row in read_csv(gv_path):
        case_id = norm_key(row.get("CASEID"))
        veh_no = norm_key(row.get("VEHNO"))
        if not case_id or not veh_no:
            continue

        speedlimit = to_float(row.get("SPEEDLIMIT"))
        if speedlimit == 999:
            speedlimit = None

        dvtotal = to_float(row.get("DVTOTAL"))
        if dvtotal in (998, 999):
            dvtotal = None

        info[(case_id, veh_no)] = {
            "towed": to_int(row.get("TOWED")),  # 2019+ only
            "body_type": to_int(row.get("BODYTYPE")),
            "case_number": row.get("CASENUMBER"),
            "speed_limit_kmph": speedlimit,
            "delta_v_total_kmph": dvtotal,
            "vehicle_vin": norm_key(row.get("VIN")),
            "vehicle_vin_length": to_int(row.get("VINLENGTH")),
            "case_weight": row.get("CASEWGT"),
            "psu": norm_key(row.get("PSU")),
            "psu_stratum": norm_key(row.get("PSUSTRAT")),
        }
    return info


def extract_vin_decode(path):
    info = {}
    for row in read_csv(path):
        case_id = norm_key(row.get("CASEID"))
        veh_no = norm_key(row.get("VEHNO"))
        if not case_id or not veh_no:
            continue
        info[(case_id, veh_no)] = {
            "vehicle_make": row.get("Make"),
            "vehicle_model": row.get("Model"),
            "vehicle_model_year": row.get("ModelYear"),
            "vehicle_body_class": row.get("BodyClass"),
            "vehicle_curb_weight_lb": row.get("CurbWeightLB"),
        }
    return info


def process_year(year):
    year_dir = BASE / f"CISS_{year}_CSV_files"
    if not year_dir.is_dir():
        print(f"{year}: directory not found, skipping")
        return [], 0, 0

    gv_path = find_file(year_dir, "GV.csv")
    occ_path = find_file(year_dir, "OCC.csv")
    edr_path = find_file(year_dir, "EDRPRECRASH.csv")
    vin_path = find_file(year_dir, "VPICDECODE.csv", "VINDERIVED.csv")

    missing = [n for n, p in
               [("GV", gv_path), ("OCC", occ_path), ("EDRPRECRASH", edr_path), ("VIN-decode", vin_path)]
               if p is None]
    if missing:
        print(f"{year}: missing table(s) {missing}, skipping")
        return [], 0, 0

    edr_speeds = extract_edr_speeds(edr_path)
    vehicle_info = extract_vehicle_info(gv_path)
    vin_decode = extract_vin_decode(vin_path)

    # NASS-CDS in-scope flag (NHTSA DOT HS 812 801, Example 3): the crash has at
    # least one passenger vehicle (BODYTYPE 1-49) towed due to damage (TOWED=2)
    # or for an unknown reason (TOWED=7). TOWED does not exist before 2019.
    has_towed = any(v["towed"] is not None for v in vehicle_info.values())
    cds_scope = {}
    for (case_id, _veh), v in vehicle_info.items():
        hit = v["towed"] in (2, 7) and v["body_type"] is not None and 1 <= v["body_type"] <= 49
        cds_scope[case_id] = cds_scope.get(case_id, False) or hit

    rows = []
    vehicles_seen = set()
    vehicles_with_speed = set()

    for occ in read_csv(occ_path):
        case_id = norm_key(occ.get("CASEID"))
        veh_no = norm_key(occ.get("VEHNO"))
        occ_no = norm_key(occ.get("OCCNO"))
        if not case_id or not veh_no:
            continue

        vkey = (case_id, veh_no)
        vehicles_seen.add(vkey)

        edr = edr_speeds.get(vkey)
        if edr is None:
            continue  # quality-over-quantity: EDR speed required
        vehicles_with_speed.add(vkey)

        vinfo = vehicle_info.get(vkey, {})
        vdecode = vin_decode.get(vkey, {})

        mais = to_int(occ.get("MAIS"))
        if mais in MAIS_UNKNOWN:
            mais = None

        injstatus = to_int(occ.get("INJSTATUS"))
        if injstatus is None or injstatus in INJSTATUS_UNKNOWN:
            injury_occurred = (mais > 0) if mais is not None else None
        else:
            injury_occurred = (injstatus == 1)

        mortality = to_int(occ.get("MORTALITY"))
        death_occurred = None if mortality is None else (mortality in MORTALITY_FATAL)

        rows.append({
            "crash_year": year,
            "case_id": case_id,
            "case_number": vinfo.get("case_number") or occ.get("CASENUMBER"),
            "vehicle_no": veh_no,
            "occupant_no": occ_no,
            "accident_speed_kmph": edr["accident_speed_kmph"],
            "edr_ptime_sec": edr["edr_ptime_sec"],
            "delta_v_total_kmph": vinfo.get("delta_v_total_kmph"),
            "speed_limit_kmph": vinfo.get("speed_limit_kmph"),
            "injury_occurred": injury_occurred,
            "injury_severity_mais": mais,
            "death_occurred": death_occurred,
            "vehicle_vin": vinfo.get("vehicle_vin"),
            "vehicle_vin_length": vinfo.get("vehicle_vin_length"),
            "vehicle_make": vdecode.get("vehicle_make"),
            "vehicle_model": vdecode.get("vehicle_model"),
            "vehicle_model_year": vdecode.get("vehicle_model_year"),
            "vehicle_body_class": vdecode.get("vehicle_body_class"),
            "vehicle_curb_weight_lb": vdecode.get("vehicle_curb_weight_lb"),
            "case_weight": vinfo.get("case_weight") or occ.get("CASEWGT"),
            # Survey design variables for Taylor-series variance estimation.
            # PSUSTRAT is NHTSA's 12-stratum variable for multi-year analysis.
            "psu": vinfo.get("psu") or norm_key(occ.get("PSU")),
            "psu_stratum": vinfo.get("psu_stratum") or norm_key(occ.get("PSUSTRAT")),
            "cds_in_scope": (int(cds_scope.get(case_id, False)) if has_towed else None),
        })

    return rows, len(vehicles_seen), len(vehicles_with_speed)


def main():
    print("NHTSA CISS combined speed/injury CSV builder")
    print("=" * 60)

    all_rows = []
    total_vehicles = 0
    total_vehicles_with_speed = 0

    for year in YEARS:
        rows, n_veh, n_veh_speed = process_year(year)
        all_rows.extend(rows)
        total_vehicles += n_veh
        total_vehicles_with_speed += n_veh_speed
        if n_veh:
            pct = 100 * n_veh_speed / n_veh
            print(f"{year}: {len(rows):>6} occupant rows  "
                  f"({n_veh_speed}/{n_veh} vehicles = {pct:.1f}% had usable EDR speed)")

    with open(OUTPUT, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDNAMES, extrasaction="ignore")
        writer.writeheader()
        for row in all_rows:
            writer.writerow({k: ("" if row.get(k) is None else row.get(k)) for k in FIELDNAMES})

    print("=" * 60)
    print(f"Total occupant rows written: {len(all_rows)}")
    if total_vehicles:
        pct = 100 * total_vehicles_with_speed / total_vehicles
        print(f"Vehicles with usable EDR speed: {total_vehicles_with_speed}/{total_vehicles} ({pct:.1f}%)")
    print(f"Output: {OUTPUT}")
    print()
    print("Notes:")
    print("- accident_speed_kmph = vehicle's EDR-recorded pre-crash speed (PCODE=1010),")
    print("  read at the PTIME sample closest to the moment of impact (PTIME near 0).")
    print("  Only occupants of vehicles with a usable EDR speed reading are included.")
    print("- vehicle_vin is NHTSA's privacy-truncated VIN (first 12 of the original")
    print("  vehicle_vin_length characters), not a full VIN.")
    print("- Unknown/not-applicable coded values (e.g. MAIS 9/95/99, INJSTATUS 7/9,")
    print("  SPEEDLIMIT 999, DVTOTAL 998/999) have been recoded to blank.")
    print("- case_weight (CASEWGT) is CISS's survey weight; apply it for any")
    print("  nationally-representative estimate, since raw row counts are not.")
    print("- psu / psu_stratum (PSU, PSUSTRAT) are the survey design variables; use")
    print("  them as cluster / strata for Taylor-series standard errors.")
    print("- cds_in_scope = 1 if the crash is inside the NASS-CDS target population")
    print("  (a passenger vehicle towed due to damage); blank for 2017-2018 (no TOWED).")


if __name__ == "__main__":
    main()
