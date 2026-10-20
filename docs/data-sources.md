# Data sources

## CISS (Crash Investigation Sampling System), 2017–2024

NHTSA's current in-depth crash survey. A probability sample of police-reported
crashes in which a passenger vehicle was **towed from the scene for any
reason**. Investigators inspect the vehicles, download EDRs, and code injuries
from medical records. Sampling deliberately oversamples fatal crashes, injury
crashes in newer vehicles, and severe injuries; the case weight `CASEWGT`
(inverse selection probability) undoes that.

Design for variance estimation: 12 PSU strata (`PSUSTRAT`, the same 12 in every
year, as NHTSA requires for multi-year analysis) and 24–40 PSUs (`PSU`).

## NASS-CDS (Crashworthiness Data System), 2000–2015

CISS's predecessor. Same type of investigation, but the target population is
crashes in which a passenger vehicle was **towed due to damage**. Weight
`RATWGT`; design variables `PSUSTRAT` (12 strata) and `PSU` (24–27 PSUs).
Downloaded from NHTSA's public bucket
(`https://static.nhtsa.gov/nhtsa/downloads/NASS/<year>/...`).

**EDR data in NASS-CDS is not in the data tables.** NHTSA published it only as
Bosch CDR report printouts:

| Years | Format | Usable here |
|---|---|---|
| 2000–2013 | PDF reports | yes – parsed by `parse_nass_edr.py` (see [EDR speed extraction](edr-speed-extraction.md)) |
| 2014 | 1,249 `.CDRx` files | no |
| 2015 | 1,045 `.CDRx` files + 13 third-party PDFs | PDFs only (1 vehicle with speed) |

`.CDRx` files are a short text header followed by the raw binary memory image of
the airbag module; decoding them needs Bosch's manufacturer-specific
translation software, so 2014–2015 have essentially no EDR speed.
