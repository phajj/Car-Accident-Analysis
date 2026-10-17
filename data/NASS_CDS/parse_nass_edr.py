#!/usr/bin/env python3
"""Extract EDR pre-crash vehicle speed from NASS-CDS EDR report archives.

NHTSA published NASS-CDS EDR data only as Bosch CDR report printouts (PDF),
not as structured tables. This script text-extracts each report with
`pdftotext -layout` and parses the first pre-crash table it finds, taking the
vehicle-speed sample closest to (and not after) time zero -- the same rule
`build_ciss_combined.py` applies to CISS EDRPRECRASH (PCODE=1010).

Two table layouts cover the CDR report formats:

  Row layout (e.g. Ford, Chrysler, newer GM):
      Time (sec)                    -5      -4      -3      -2      -1
      Vehicle Speed (MPH [km/h])  33.4 [53.8] 31.3 [50.4] ...

  Column layout (e.g. older GM, Toyota):
      Seconds     Vehicle Speed   Engine Speed
      Before AE       (MPH)           (RPM)
         -5            48             2240
         ...

Output: nass_cds_edr_speed.csv with one row per (year, psu, caseno, vehno).

Usage: python parse_nass_edr.py [--years 2000-2015] [--jobs 8]
Requires: pdftotext (poppler). Files 2014-2015 are CDRx binaries (Bosch
format) for most cases and are skipped unless a PDF is present.
"""

import argparse
import csv
import re
import subprocess
import sys
import zipfile
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

BASE = Path(__file__).resolve().parent
ARCHIVE_DIR = BASE / "EDR_Reports"
OUTPUT = BASE / "nass_cds_edr_speed.csv"

MPH_TO_KMPH = 1.609344
FILENAME_RE = re.compile(r"(\d{4})-(\d+)-(\d+)-v(\d+)", re.I)

SPEED_LABEL_RE = re.compile(
    r"(vehicle\s+speed|speed,\s*vehicle\s+indicated|vehicle\s+indicated\s+speed)",
    re.I,
)
# A numeric cell, optionally followed by a bracketed km/h value: "33.4 [53.8]"
CELL_RE = re.compile(r"-?\d+(?:\.\d+)?(?:\s*\[\s*-?\d+(?:\.\d+)?\s*\])?")
TIME_HEADER_RE = re.compile(r"^\s*(time|times|seconds|parameter)\b", re.I)
# A table row starts with its time stamp; Ford prints negatives as "- 5.0".
ROW_START_RE = re.compile(r"^\s*(-\s?\d+(?:\.\d+)?|\d+(?:\.\d+)?)\s")


def row_time(line):
    return float(ROW_START_RE.match(line).group(1).replace(" ", ""))


def cell_value_kmph(cell, unit):
    """Convert a cell like '33.4 [53.8]' or '48' to km/h."""
    m = re.match(r"(-?\d+(?:\.\d+)?)(?:\s*\[\s*(-?\d+(?:\.\d+)?)\s*\])?", cell)
    if not m:
        return None
    if m.group(2) is not None:  # "MPH [km/h]" pair: trust the km/h value
        return float(m.group(2))
    v = float(m.group(1))
    return v * MPH_TO_KMPH if unit == "mph" else v


def detect_unit(text):
    t = text.lower()
    if "km/h" in t or "kph" in t or "kmph" in t:
        # "(MPH [km/h])" headers give bracketed km/h values; a lone km/h header means km/h.
        return "kmph" if "mph" not in t else "pair"
    if "mph" in t:
        return "mph"
    return None


def cells_with_pos(s):
    return [(m.group(0), (m.start() + m.end()) / 2) for m in CELL_RE.finditer(s)]


def nearest(cells, x):
    return min(cells, key=lambda c: abs(c[1] - x)) if cells else None


def pick_sample(samples):
    """samples: [(time_sec, kmph)] -> the valid sample closest to t=0 (t <= 0)."""
    valid = [(t, v) for t, v in samples
             if t is not None and v is not None and -10 <= t <= 0 and 0 <= v <= 250]
    if not valid:
        return None
    return max(valid, key=lambda s: s[0])


def parse_row_layout(lines, i):
    """Speed label at the start of line i, values to the right (or, in GM's
    wrapped layout, on the line below the label); time row above."""
    line = lines[i]
    m = SPEED_LABEL_RE.search(line)
    if not m or line[:m.start()].strip():
        return None
    label_end = line.find(")", m.end())
    label_end = label_end + 1 if label_end != -1 else m.end()
    label = line[:label_end]
    values = cells_with_pos(" " * label_end + line[label_end:])
    if len(values) < 2 and i + 1 < len(lines) and not re.search(r"[a-z]", lines[i + 1], re.I):
        values = cells_with_pos(lines[i + 1])  # wrapped: "Vehicle Speed" / values / "(MPH)"
        label += " " + (lines[i + 2] if i + 2 < len(lines) else "")
    unit = detect_unit(label) or "mph"
    if len(values) < 2:
        return None
    for j in range(i - 1, max(-1, i - 15), -1):
        if TIME_HEADER_RE.match(lines[j]):
            hdr = lines[j]
            # Blank out the label ("Time (sec)") so its characters are not read as cells.
            start = re.match(r"^\s*(time|times|seconds|parameter)\s*(\([^)]*\))?", hdr, re.I).end()
            times = [(float(c), x) for c, x in cells_with_pos(" " * start + hdr[start:])
                     if "[" not in c]
            if len(times) < 2:
                continue
            samples = []
            for t, tx in times:
                cell = nearest(values, tx)
                if cell and abs(cell[1] - tx) < 12:
                    samples.append((t, cell_value_kmph(cell[0], unit)))
            return pick_sample(samples)
    return None


TOKEN_RE = re.compile(r"\S+(?: \S+)*")  # words joined by single spaces
SPEED_COL_RE = re.compile(r"vehicle\s*speed|speed,?\s+vehicle|vehicle\s+indicated", re.I)
NOT_SPEED_COL_RE = re.compile(r"engine|wheel|rpm|\b(lf|rf|lr|rr)\b|steer|yaw|stability", re.I)
PAGE_LINE_RE = re.compile(r"page \d+ of \d+|printed on", re.I)


def parse_column_block(lines, first):
    """Table body starting at `first` (rows begin with a time value); the
    header is the run of non-blank lines directly above it. Header words are
    assigned to the nearest column so multi-line headers stack correctly."""
    rows = []
    for line in lines[first:]:
        rm = ROW_START_RE.match(line)
        if not rm:
            break
        rows.append(line)
    if len(rows) < 2:
        return None
    header = []
    for line in reversed(lines[max(0, first - 10):first]):
        if not line.strip() or PAGE_LINE_RE.search(line):
            break
        header.insert(0, line)
    if not header:
        return None

    cols = [((m.start() + m.end()) / 2) for m in TOKEN_RE.finditer(rows[0])]
    col_text = [[] for _ in cols]
    for h in header:
        for m in TOKEN_RE.finditer(h):
            x = (m.start() + m.end()) / 2
            k = min(range(len(cols)), key=lambda c: abs(cols[c] - x))
            col_text[k].append(m.group(0))
    heads = [" ".join(t) for t in col_text]
    speed_cols = [k for k, h in enumerate(heads)
                  if k > 0 and SPEED_COL_RE.search(h) and not NOT_SPEED_COL_RE.search(h)]
    if not speed_cols:
        return None
    k = speed_cols[0]
    unit = detect_unit(heads[k]) or "mph"
    samples = []
    for line in rows:
        toks = [(m.group(0), (m.start() + m.end()) / 2) for m in TOKEN_RE.finditer(line)]
        t = row_time(line)
        tok = nearest(toks[1:], cols[k])
        v = None
        if tok and abs(tok[1] - cols[k]) < 10 and CELL_RE.fullmatch(tok[0].strip()):
            v = cell_value_kmph(tok[0].strip(), unit)
        samples.append((t, v))
    return pick_sample(samples)


def parse_report_text(text):
    lines = text.splitlines()
    for i, line in enumerate(lines):
        if ROW_START_RE.match(line) and (i == 0 or not ROW_START_RE.match(lines[i - 1])):
            got = parse_column_block(lines, i)
            if got:
                return got
        if SPEED_LABEL_RE.search(line):
            low = line.lower()
            # Skip boilerplate prose ("SDM Recorded Vehicle Speed accuracy can be affected ...").
            if "accuracy" in low or "transmitted" in low or "not the speed" in low:
                continue
            got = parse_row_layout(lines, i)
            if got:
                return got
    return None


def process_member(args):
    zpath, member = args
    m = FILENAME_RE.search(Path(member).name)
    if not m:
        return None
    year, psu, caseno, veh = (int(g) for g in m.groups())
    with zipfile.ZipFile(zpath) as z:
        data = z.read(member)
    try:
        text = subprocess.run(["pdftotext", "-layout", "-", "-"], input=data,
                              capture_output=True, timeout=120).stdout.decode("utf-8", "replace")
    except subprocess.TimeoutExpired:
        text = ""
    got = parse_report_text(text)
    return {
        "year": year, "psu": psu, "caseno": caseno, "vehno": veh,
        "edr_file": Path(member).name,
        "edr_speed_kmph": round(got[1], 2) if got else "",
        "edr_ptime_sec": got[0] if got else "",
        "has_text": bool(text.strip()),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--years", default="2000-2015")
    ap.add_argument("--jobs", type=int, default=8)
    args = ap.parse_args()
    y0, y1 = (int(x) for x in args.years.split("-"))

    tasks = []
    for y in range(y0, y1 + 1):
        zpath = ARCHIVE_DIR / f"nass{y}.zip"
        if not zpath.exists():
            print(f"{y}: archive missing, skipping")
            continue
        with zipfile.ZipFile(zpath) as z:
            pdfs = [n for n in z.namelist() if n.lower().endswith(".pdf")]
            others = [n for n in z.namelist() if not n.endswith("/") and not n.lower().endswith(".pdf")]
        print(f"{y}: {len(pdfs)} PDF reports, {len(others)} non-PDF files (skipped)")
        tasks += [(zpath, n) for n in pdfs]

    rows = []
    with ProcessPoolExecutor(max_workers=args.jobs) as ex:
        for r in ex.map(process_member, tasks, chunksize=8):
            if r:
                rows.append(r)

    # One row per vehicle: if duplicates exist (re-imaged reports), keep a parsed one.
    by_key = {}
    for r in rows:
        k = (r["year"], r["psu"], r["caseno"], r["vehno"])
        if k not in by_key or (by_key[k]["edr_speed_kmph"] == "" and r["edr_speed_kmph"] != ""):
            by_key[k] = r
    out = sorted(by_key.values(), key=lambda r: (r["year"], r["psu"], r["caseno"], r["vehno"]))

    with open(OUTPUT, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["year", "psu", "caseno", "vehno", "edr_file",
                                          "edr_speed_kmph", "edr_ptime_sec", "has_text"])
        w.writeheader()
        w.writerows(out)

    print("year  reports  with_speed")
    for y in sorted({r["year"] for r in out}):
        yr = [r for r in out if r["year"] == y]
        print(f"{y}  {len(yr):7d}  {sum(1 for r in yr if r['edr_speed_kmph'] != ''):10d}")
    print(f"total {len(out)} reports, {sum(1 for r in out if r['edr_speed_kmph'] != '')} with speed")
    print(f"Output: {OUTPUT}")


if __name__ == "__main__":
    sys.exit(main())
