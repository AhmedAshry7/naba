"""Command line: `python -m naba_data <command>`.

    search    what NISAR data exists over the AOI            (metadata only, no login needed)
    estimate  what one AOI window read would cost            (metadata only, login needed)
    export    stream, classify, vectorize and write the app's dataset

Presets have a theme: "wetlands" (monthly HH/HV classes) or "fires" (HV drop before/after an
event). Each export replaces only its own preset's part of the dataset.
"""
from __future__ import annotations

import argparse
import logging
import sys

from .config import (FREQUENCY, GCOV_RES_DEG, MAJORITY_FILTER, MATURITY, MIN_AREA_KM2, PRESETS,
                     PUBLIC_DATA, SIMPLIFY_M, get_preset)


def _common(p: argparse.ArgumentParser) -> None:
    p.add_argument("--preset", default="manzala", choices=sorted(PRESETS),
                   help="area of interest (default: manzala)")
    p.add_argument("--max-dates", type=int, default=10,
                   help="wetlands: most acquisitions to use, spread evenly through the period "
                        "(default: 10); fires use every pass from the before date on")
    p.add_argument("--maturity", default=MATURITY,
                   choices=["PROVISIONAL", "BETA", "VALIDATED"])
    p.add_argument("--frequency", default=FREQUENCY, choices=["A", "B"],
                   help="A = 10-20 m main band, B = 80 m auxiliary (default: A)")
    p.add_argument("-v", "--verbose", action="store_true")


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="python -m naba_data", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="command", required=True)

    s = sub.add_parser("search", help="list the NISAR acquisitions over the AOI (metadata only)")
    _common(s)
    s.add_argument("--all", action="store_true",
                   help="show every granule, not just the selected dual-pol single-geometry set")

    e = sub.add_parser("estimate", help="megabytes one AOI window read would move (metadata only)")
    _common(e)

    x = sub.add_parser("export", help="write the app's dataset into frontend/public/data")
    _common(x)
    x.add_argument("--out", default=str(PUBLIC_DATA), help="output directory")
    x.add_argument("--estimate-only", action="store_true",
                   help="print the cost estimate and stop before streaming any pixels")
    x.add_argument("--offline", action="store_true",
                   help="use cached subsets only; fail instead of touching the network")
    x.add_argument("--no-samples", action="store_true",
                   help="write only the real stories (drops the sample stories from the feed)")
    x.add_argument("--samples-only", action="store_true",
                   help="rebuild changes.geojson from sample-stories.json plus the real stories "
                        "already exported; no network, no credentials")
    x.add_argument("--no-frames", action="store_true",
                   help="skip the Compare-dates images (class maps / false colour / burn masks)")
    x.add_argument("--res-deg", type=float, default=GCOV_RES_DEG,
                   help=f"output grid in degrees (default: {GCOV_RES_DEG}, about 20 m)")
    x.add_argument("--min-area-km2", type=float, default=MIN_AREA_KM2,
                   help=f"drop polygon parts smaller than this (default: {MIN_AREA_KM2})")
    x.add_argument("--simplify-m", type=float, default=SIMPLIFY_M,
                   help=f"simplify tolerance in metres (default: {SIMPLIFY_M})")
    x.add_argument("--majority", type=int, default=MAJORITY_FILTER,
                   help=f"majority filter size, 0 to disable (default: {MAJORITY_FILTER})")
    return ap


def _select(preset, args):
    """The acquisitions an export of this preset would use: (df, pre_row, post_row)."""
    if preset.theme == "fires":
        from .fires import select_fire_acquisitions

        return select_fire_acquisitions(preset, maturity=args.maturity)
    from .search import select_acquisitions

    return select_acquisitions(preset, max_dates=args.max_dates, maturity=args.maturity), None, None


def _cmd_search(args) -> int:
    from .search import search_nisar, summarize

    preset = get_preset(args.preset)
    print(f"{preset.name}  [{preset.theme}]\n  bbox {list(preset.bbox)}  "
          f"{preset.search_start} -> {preset.search_end}  {preset.product} {args.maturity}")
    if preset.event_start:
        print(f"  event {preset.event_start} -> {preset.event_end}")
    print()
    pre = post = None
    if args.all:
        df = search_nisar(preset.product, preset.bbox, preset.search_start, preset.search_end,
                          args.maturity)
    else:
        df, pre, post = _select(preset, args)
    if df.empty:
        print("No granules found.")
        return 1
    print(summarize(df), "\n")
    if pre is not None:
        print(f"Before: {pre['date'].date()}  {pre['name']}\nAfter : {post['date'].date()}  "
              f"{post['name']}\n")
    cols = [c for c in ("date", "track", "direction", "frame", "pol_code", "size_MB_catalog",
                        "name") if c in df]
    print(df[cols].to_string(index=False))
    return 0


def _cmd_estimate(args) -> int:
    from .remote import close_all, estimate_read_mb
    from .search import pol_vars

    preset = get_preset(args.preset)
    acq, _pre, _post = _select(preset, args)
    if acq.empty:
        print("No usable dual-pol acquisitions.")
        return 1
    row = acq.iloc[0]
    co, _cx = pol_vars(row)
    mb = estimate_read_mb(row, co, preset.bbox, args.frequency)
    print(f"\nEstimated <= {mb:.0f} MB per layer (uncompressed chunks; the compressed transfer is "
          f"usually smaller)\n  -> <= {mb * 2 * len(acq):.0f} MB for {len(acq)} dates x 2 "
          f"polarizations. Cached subsets cost nothing on a re-run.")
    close_all()
    return 0


def _cmd_export(args) -> int:
    from pathlib import Path

    from .export import run_export, run_samples_only

    preset = get_preset(args.preset)
    out = Path(args.out)
    if args.samples_only:
        run_samples_only(preset, out)
        return 0
    if args.estimate_only:
        return _cmd_estimate(args)
    result = run_export(
        preset, max_dates=args.max_dates, maturity=args.maturity, frequency=args.frequency,
        res_deg=args.res_deg, min_area_km2=args.min_area_km2, simplify_m=args.simplify_m,
        majority=args.majority, public_data=out, with_samples=not args.no_samples,
        offline=args.offline, write_frames=not args.no_frames,
    )
    print(f"\n{preset.key} -> {out}")
    for line in result["lines"]:
        print(f"  {line}")
    for name, size in result["sizes"].items():
        print(f"  {name:<22} {size / 1e3:>8.1f} kB")
    print(f"  network moved          {result['provenance']['network_MB']:>8.3f} MB")
    return 0


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(message)s", stream=sys.stdout)
    handler = {"search": _cmd_search, "estimate": _cmd_estimate, "export": _cmd_export}[args.command]
    return handler(args)


if __name__ == "__main__":
    raise SystemExit(main())
