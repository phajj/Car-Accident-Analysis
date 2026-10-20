# Data dictionaries

## `data/ciss_combined_speed_injury.csv`

See `data/ciss_combined_speed_injury_NOTES.md` for the original columns. Added:

| Column | Meaning |
|---|---|
| `psu` | CISS primary sampling unit (`PSU`) |
| `psu_stratum` | CISS PSU stratum (`PSUSTRAT`, 12 strata, consistent across years) |
| `cds_in_scope` | 1 if the crash is in the NASS-CDS target population (passenger vehicle towed due to damage / unknown reason); 0 if not; blank for 2017–2018 (`TOWED` not collected) |

## `data/NASS_CDS/nass_cds_occupant_injury.csv`

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
| `injury_occurred`, `death_occurred` | OA | see [outcome definition](outcome-definition.md) |
| `injury_severity_mais` | OA `MAIS` | 0–6, 7 = injured unknown severity |
| `occupant_age`, `occupant_sex`, `occupant_seat_pos`, `occupant_belt_use` | OA `AGE`, `SEX`, `SEATPOS`, `MANUSE` | raw NASS codes |
| `vehicle_body_type`, `vehicle_model_year` | GV `BODYTYPE`, `MODELYR` | raw NASS codes |
| `case_weight` | ACCIDENT `RATWGT` | survey weight |
