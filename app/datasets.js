"use strict";
// Analysis datasets. Each source is one CSV plus the column used as the
// predictor; `study` prefixes strata/PSUs so independently sampled surveys stay
// separate strata when pooled (NHTSA DOT HS 812 801, Example 3).
// Paths are relative to app/; Node callers resolve them against that folder.

(function (root) {
  const CISS = "../data/ciss_combined_speed_injury.csv";
  const CDS = "../data/NASS_CDS/nass_cds_occupant_injury.csv";

  const DATASETS = {
    ciss_speed: {
      label: "CISS 2017–2024",
      sources: [{ file: CISS, xCol: "accident_speed_kmph", study: "CISS:" }],
    },
    cds_speed: {
      label: "NASS-CDS 2000–2015 (EDR speed parsed from report PDFs)",
      sources: [{ file: CDS, xCol: "edr_speed_kmph", study: "CDS:" }],
    },
    pooled_speed: {
      label: "Pooled: NASS-CDS + CISS 2019–2024 (CDS scope)",
      // CISS rows restricted to the CDS target population (towed due to damage);
      // 2017-2018 CISS cannot be classified (no TOWED variable) and is excluded.
      sources: [
        { file: CDS, xCol: "edr_speed_kmph", study: "CDS:" },
        { file: CISS, xCol: "accident_speed_kmph", study: "CISS:", filter: get => get("cds_in_scope") === "1" },
      ],
    },
    cds_dv: {
      label: "NASS-CDS 2000–2015",
      sources: [{ file: CDS, xCol: "delta_v_total_kmph", study: "CDS:" }],
    },
  };

  if (typeof module !== "undefined" && module.exports) module.exports = DATASETS;
  else root.DATASETS = DATASETS;
})(typeof window !== "undefined" ? window : globalThis);
