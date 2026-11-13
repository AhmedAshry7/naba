"""Configuration for the Naba data exporter.

Every value here is a port of the matching setting in the exploration notebook
(`notebooks/NABA_NISAR_Explorer.ipynb`, Section 0 and Section 8), so a number produced by
this package can be reproduced cell-by-cell in Colab.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

# ---------------------------------------------------------------- paths
PKG_DIR = Path(__file__).resolve().parent
DATA_DIR = PKG_DIR.parent                       # naba-data/
REPO_DIR = DATA_DIR.parent                      # naba/
PUBLIC_DATA = REPO_DIR / "frontend" / "public" / "data"
CACHE_DIR = DATA_DIR / "cache"                  # gitignored: GeoTIFF subsets + manifest

# ---------------------------------------------------------------- data selection
MATURITY = "PROVISIONAL"     # PROVISIONAL data starts 17 Jun 2026
FREQUENCY = "A"              # A = 10-20 m main band, B = 80 m auxiliary
MAX_RESULTS = 300            # cap on catalog results per search

# ---------------------------------------------------------------- reading & output grid
GCOV_RES_DEG = 0.0002        # output grid for GCOV, ~20 m
MAX_READ_MB = 400            # refuse any single window read larger than this (uncompressed estimate)
HTTP_BLOCK_MB = 8            # fsspec block size for HTTPS range requests
MIN_COVERAGE = 0.05          # skip an acquisition covering less than this fraction of the AOI

# ---------------------------------------------------------------- wetland classification
# EXPLORATORY dB thresholds, identical to the notebook's WETLAND_THRESHOLDS.
WETLAND_THRESHOLDS = dict(
    water_hh_max=-15.0,      # open water: specular reflection -> dark in HH ...
    water_hv_max=-22.0,      # ... and dark in HV
    flooded_hh_min=-5.0,     # flooded vegetation: double bounce -> very bright HH ...
    flooded_ratio_min=7.0,   # ... and HH much brighter than HV (HH-HV in dB)
)

NO_DATA, OPEN_WATER, FLOODED_VEG, OTHER = 0, 1, 2, 3
CLASS_NAMES = {NO_DATA: "no data", OPEN_WATER: "open water",
               FLOODED_VEG: "flooded vegetation", OTHER: "other land/vegetation"}
# Notebook's CLASS_COLORS; the frontend uses the same two values in WETLAND_META.
CLASS_COLORS = {NO_DATA: "#000000", OPEN_WATER: "#1f4e9c",
                FLOODED_VEG: "#e7298a", OTHER: "#a6d96a"}
# Slugs shared with the frontend (`WetlandClass` in src/types.ts).
CLASS_SLUGS = {OPEN_WATER: "open_water", FLOODED_VEG: "flooded_vegetation"}

# ---------------------------------------------------------------- vectorization defaults
MIN_AREA_KM2 = 0.02         # drop polygon parts smaller than this (speckle)
SIMPLIFY_M = 40.0           # Douglas-Peucker tolerance in metres
COORD_PRECISION = 5         # decimal places kept in exported GeoJSON coordinates
MAJORITY_FILTER = 3         # size of the majority filter applied before polygonizing (0 = off)
PAYLOAD_BUDGET_MB = 1.5     # wetlands.geojson size budget; the exporter warns above it


@dataclass(frozen=True)
class Preset:
    """One area of interest, with the dates to search and the copy the stories are written in."""

    key: str
    name: str                       # human label, as in the notebook presets
    region: str                     # ChangeStory.region
    subtitle: str                   # ChangeStory.subtitle
    bbox: tuple[float, float, float, float]      # [west, south, east, north]
    search_start: str
    search_end: str
    product: str = "GCOV"
    causes_water: tuple[str, ...] = ()
    causes_flooded: tuple[str, ...] = ()
    why_it_matters: str = ""
    next_step: str = ""
    story_ids: dict[str, str] = field(default_factory=dict)
    # Sample stories this preset's real stories replace (same place, invented numbers).
    supersedes: tuple[str, ...] = ()


PRESETS: dict[str, Preset] = {
    # Notebook preset "wetlands_alt": Lake Manzala wetlands, Nile Delta, Egypt.
    "manzala": Preset(
        key="manzala",
        name="Lake Manzala wetlands, Nile Delta, Egypt",
        region="Lake Manzala",
        subtitle="Coastal lagoon and reed beds",
        bbox=(31.95, 31.15, 32.20, 31.40),
        search_start="2026-06-17",
        search_end="2026-11-13",
        causes_water=(
            "Seasonal changes in lagoon water level",
            "Drainage and irrigation water entering the lagoon",
            "Reed beds cut back or cleared, exposing open water",
        ),
        causes_flooded=(
            "Water rising into standing reeds and marsh vegetation",
            "Seasonal flooding of fish farms and marsh margins",
            "Vegetation growing up through shallow standing water",
        ),
        why_it_matters=(
            "Lake Manzala is one of Egypt's largest coastal wetlands. How much of it is open water "
            "and how much is flooded marsh decides what fishing, farming and wildlife it can support."
        ),
        next_step=(
            "Compare with optical imagery and local water-level records before treating the change "
            "as confirmed."
        ),
        story_ids={"open_water": "manzala-open-water",
                   "flooded_vegetation": "manzala-flooded-vegetation"},
        supersedes=("manzala-lagoon",),
    ),
    # Notebook preset "wetlands": Okavango Delta, Botswana. Kept so the exporter is not
    # single-AOI by construction; not part of the shipped dataset.
    "okavango": Preset(
        key="okavango",
        name="Okavango Delta (central delta), Botswana",
        region="Okavango Delta",
        subtitle="Inland delta wetlands",
        bbox=(22.55, -19.55, 22.90, -19.20),
        search_start="2026-06-17",
        search_end="2026-11-13",
        causes_water=(
            "The annual flood pulse arriving from the Angolan highlands",
            "Seasonal evaporation drawing channels down",
        ),
        causes_flooded=(
            "Floodwater spreading into reed and papyrus beds",
            "Seasonal rise and fall of the delta's channels",
        ),
        why_it_matters=(
            "The Okavango's flood pulse decides where wildlife, cattle and people find water "
            "each year."
        ),
        next_step="Compare with river gauge records upstream before treating the change as confirmed.",
        story_ids={"open_water": "okavango-open-water",
                   "flooded_vegetation": "okavango-flooded-vegetation"},
    ),
}


def get_preset(key: str) -> Preset:
    try:
        return PRESETS[key]
    except KeyError:
        raise SystemExit(f"Unknown preset {key!r}. Available: {', '.join(PRESETS)}") from None


# ================================================================ earthquakes (GUNW interferograms)
GUNW_RES_DEG = 0.0008          # GUNW is posted at 80 m, so ~88 m (0.0008 deg) loses nothing
NISAR_CENTER_FREQ_HZ = 1.239e9           # `frequencyA/centerFrequency` in the GUNW files
SPEED_OF_LIGHT = 299_792_458.0
WAVELENGTH_M = SPEED_OF_LIGHT / NISAR_CENTER_FREQ_HZ      # ~0.242 m (L-band)
MIN_COHERENCE = 0.30           # below this the phase is mostly noise; those pixels are not shown
REFERENCE_MIN_KM = 35.0        # the far field (>= this far from the epicentre) is set to 0 motion
EQ_MIN_AREA_KM2 = 2.0          # drop footprint parts smaller than this
EQ_SIMPLIFY_M = 250.0
EQ_PAYLOAD_NOTE = "earthquake footprint"


@dataclass(frozen=True)
class EarthquakePreset:
    """One earthquake: where to look, which interferogram to read and the copy for the story."""

    key: str
    name: str
    region: str
    subtitle: str
    bbox: tuple[float, float, float, float]      # [west, south, east, north]
    search_start: str
    search_end: str
    granule: str                    # exact GUNW granule name (the pair chosen in the demo-sites file)
    alt_granules: tuple[str, ...]
    story_id: str
    magnitude: float
    event_time_utc: str
    lat: float
    lon: float
    depth_km: float
    place: str
    aftershocks: tuple[str, ...]
    causes: tuple[str, ...]
    why_it_matters: str
    next_step: str
    product: str = "GUNW"


EQ_PRESETS: dict[str, EarthquakePreset] = {
    # "NISAR demo sites" file, Earthquakes #1 (tested): best pair = track 40 D, frame 85.
    "panama": EarthquakePreset(
        key="panama",
        name="M7.7 Azuero peninsula earthquake, Panama",
        region="Azuero peninsula, Panama",
        subtitle="Magnitude 7.7 earthquake, 9 October 2026",
        bbox=(-81.10, 7.20, -80.30, 7.90),
        search_start="2026-09-15",
        search_end="2026-10-31",
        granule=("NISAR_L2_PR_GUNW_032_040_D_085_033_4000_SH_20261002T234516_20261002T234533_"
                 "20261014T234516_20261014T234533_P05023_N_P_J_001"),
        alt_granules=(
            "NISAR_L2_PR_GUNW_032_076_A_005_033_4000_SH_20261005T105604_20261005T105616_"
            "20261017T105604_20261017T105616_P05023_N_P_J_001",
            "NISAR_L2_PR_GUNW_031_141_D_085_032_4000_SH_20260927T235335_20260927T235344_"
            "20261009T235335_20261009T235345_P05023_N_P_J_001",
        ),
        story_id="panama-azuero-m77",
        magnitude=7.7,
        event_time_utc="2026-10-09T17:56:05Z",
        lat=7.6069,
        lon=-80.7566,
        depth_km=10.0,
        place="Azuero peninsula, Panama",
        aftershocks=("M6.6 on 9 October (20:25 UTC)", "M6.0 on 10 October", "M6.1 on 12 October"),
        causes=(
            "Sudden slip on the fault that ruptured in the magnitude 7.7 earthquake (USGS: 9 "
            "October 2026, about 10 km deep)",
            "The magnitude 6.6, 6.0 and 6.1 aftershocks, which all fall inside the same 12-day "
            "window and add to the total",
            "A small part of any radar interferogram is atmosphere (water vapour) or ionosphere, "
            "not ground motion",
        ),
        why_it_matters=(
            "Radar fringes show where and how far the ground moved, including places no "
            "seismometer or GPS station reaches. That helps responders and engineers see which "
            "parts of the peninsula were shaken and shifted most."
        ),
        next_step=(
            "Compare with GPS stations, field reports and a second NISAR pair from a different "
            "track before using the numbers for damage or fault models."
        ),
    ),
}


def get_eq_preset(key: str) -> EarthquakePreset:
    try:
        return EQ_PRESETS[key]
    except KeyError:
        raise SystemExit(f"Unknown earthquake preset {key!r}. Available: {', '.join(EQ_PRESETS)}") from None
