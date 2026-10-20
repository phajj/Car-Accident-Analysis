# Limitations

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
