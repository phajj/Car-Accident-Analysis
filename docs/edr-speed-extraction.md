# EDR speed extraction from NASS-CDS PDFs (`parse_nass_edr.py`)

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

## Coverage

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

## Validation

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
