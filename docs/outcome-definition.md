# Outcome definition

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
