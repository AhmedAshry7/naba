# Naba · نبأ — project overview

*Earth's news, before it breaks.*

Naba is a newsroom for the Earth. NISAR radar sees the ground, the water and the plants change;
Naba turns each change into a short news story — a headline, a place on an interactive globe, the
measurement, and a plain-language explanation of what it might mean.

Built for the **NASA Space Apps Challenge 2026**, challenge *"Dancing with the SARs"*, by Team Naba.
*Naba* (نبأ) is Arabic for "news".

This document is the map of the repo: what exists, how the pieces fit, the data contract between
them, how to run everything, and what is real versus illustrative. For frontend specifics see
[`frontend/README.md`](frontend/README.md).

---

## 1 · What a "story" is

One story = one place where the radar measured something changing, told the way a news item is told:

| Part | Example |
|---|---|
| Headline | "Open water is spreading across Lake Manzala" |
| Place | Lake Manzala · coastal lagoon · 31.26°N, 32.06°E (the globe flies there) |
| The number | 23.4 % of the analysed area under open water, trending upward |
| Time series | one point per radar pass, about every 12 days |
| What's happening | two or three sentences of plain language |
| Possible causes | listed as possibilities, never as proof |
| Why it matters | the human consequence |
| What to check next | the honest next step for a reader who wants certainty |
| Confidence | low / moderate / high, with the reason stated |

The shape of all this is one TypeScript interface, `ChangeStory` in
[`frontend/src/types.ts`](frontend/src/types.ts) — the contract every part of the system agrees on.

---

## 2 · Architecture

```
  NASA CMR (catalog)              NISAR products on NASA servers (HDF5, GBs each)
         │ JSON, kilobytes                 │ HTTPS range requests: only the AOI's chunks
         ▼                                 ▼
  ┌──────────────────────────────────────────────────────────────────┐
  │  naba-data/  (Python exporter)                                   │
  │  search → stream HH/HV windows → dB → classify → monthly         │
  │  composites → vectorize → stories → write the dataset            │
  │  cache/  every AOI subset kept as GeoTIFF: a re-run moves 0 MB   │
  └──────────────────────────────────────────────────────────────────┘
         │ writes
         ▼
  frontend/public/data/                     ← the dataset: 3 JSON shapes + PNG frames
         │ fetch
         ▼
  frontend/src/data/loadData.ts             ← the ONE place the UI talks to a data source
         │
         ▼
  store.ts (Zustand)  →  MapLibre globe · story panel · month slider · compare-dates
```

Two rules hold this together:

1. **One data boundary.** Only `loadData.ts` knows where data comes from. With `VITE_API_URL`
   unset it reads static files; set, it calls `GET {API}/changes`, `/wetlands`, `/layers`. A backend
   therefore only has to serve the same JSON — no component changes. (See §7.)
2. **One writer per file.** The Python exporter owns `changes.geojson`, `wetlands.geojson`,
   `layers.json` and `frames/`. The sample generator writes only `sample-stories.json`, which the
   exporter folds in. A sample run can never overwrite real measurements.

---

## 3 · Repo layout

```
naba/
├── PROJECT.md                 this file
├── docker-compose.yml         PostGIS 16 container — for the deferred API (§7); nothing uses it yet
├── naba-data/                 the Python pipeline: NISAR in, the app's dataset out
│   ├── naba_data/
│   │   ├── config.py            AOI presets, dB thresholds, grid resolution, read budget
│   │   ├── auth.py              Earthdata Login from .env / environment
│   │   ├── search.py            CMR search, granule-name parsing, dual-pol + one-geometry selection
│   │   ├── remote.py            HDF5 over HTTPS: AOI window reads, reprojection, GeoTIFF cache
│   │   ├── wetlands.py          dB, pixel classes, per-date indicators, monthly composites
│   │   ├── vectorize.py         class rasters → MultiPolygons + geodesic areas
│   │   ├── frames.py            monthly class maps as transparent PNGs
│   │   ├── stories.py           measured numbers → ChangeStory text (templated, no LLM)
│   │   ├── export.py            the single writer of the dataset
│   │   └── cli.py               python -m naba_data search | estimate | export
│   ├── tests/                   thresholds, vectorization areas, story-shape contract
│   ├── requirements.txt
│   └── .env.example             EARTHDATA_USERNAME / EARTHDATA_PASSWORD
└── frontend/                  React 18 + Vite + TypeScript + Tailwind + MapLibre GL v5 + Zustand
    ├── public/data/             the dataset (see §4)
    ├── scripts/generate-sample-data.mjs   writes sample-stories.json only
    └── src/                     see frontend/README.md
```

The exploration notebook that this pipeline is a port of lives next to the repo, at
`../notebooks/NABA_NISAR_Explorer*.ipynb`. It is the **method's source of truth**: it searches NISAR,
previews it, reads it five different ways with a byte ledger, and works through three themes (fires,
earthquakes, wetlands). `naba-data` is the production port of its Section 14 (wetlands), using the
same thresholds and the same dB convention, so any number in the app can be reproduced cell by cell
in Colab.

`token.txt` at the repo root is gitignored and is not read by any code in this repo; credentials for
the exporter come from `naba-data/.env` (see §5).

---

## 4 · The dataset (`frontend/public/data/`)

| File | What it is | Written by |
|---|---|---|
| `changes.geojson` | the feed: one Feature per story, `ChangeStory` in `properties` | exporter |
| `wetlands.geojson` | measured wetland extents, one Feature per class per month | exporter |
| `layers.json` | the monthly class-map frames used by Compare-dates | exporter |
| `frames/wetland_YYYY-MM.png` | those frames: transparent RGBA class maps at the ~20 m grid | exporter |
| `provenance.json` | every granule, threshold, date and byte count behind the above | exporter |
| `sample-stories.json` | the illustrative stories (all `is_sample: true`) | `npm run sample-data` |

`frontend/src/types.ts` is authoritative for the field names and the allowed values;
`frontend/README.md` has an annotated example of each shape. The short version:

- **A story** carries `change_class` (`significant` / `moderate` / `stable` / `water`, which colours
  it on the globe and in the legend), `change_type` (the icon), one headline `metric`, a `series`
  for the chart, free-text `summary` / `causes` / `why_it_matters` / `next_step` / `explanation`,
  and the two honesty flags `is_sample` and `explanation_ai_generated`.
- **A wetland feature** carries `class` (`open_water` / `flooded_vegetation`), `month` (`"2026-06"`),
  `month_label`, `area_km2` and the acquisition `dates` behind that month's composite. The distinct
  months become the steps on the globe's month slider.

### How the wetland data is produced

1. **Search** NISAR GCOV over the AOI and period through NASA CMR (metadata only, kilobytes).
2. **Select** acquisitions that are dual-polarization (HH+HV is required by the method) and keep a
   single track / direction / frame, so the look angle is the same in every date and brightness can
   be compared; then spread the chosen dates evenly through the period.
3. **Stream** the HH and HV layers for the AOI only — HTTP range requests fetch just the HDF5 chunks
   that overlap it, a few MB instead of a multi-GB product — and reproject onto one common lon/lat
   grid (~20 m). Every subset is cached as a GeoTIFF, so re-running moves nothing.
4. **Classify** each pixel from its backscatter in decibels:
   - *open water* — dark in HH **and** HV: a smooth surface mirrors the radar away from the satellite;
   - *flooded vegetation* — bright HH with a large HH−HV gap: water plus stems form a corner that
     bounces the signal straight back, while the cross-polarised return stays weak;
   - *other land / vegetation* — everything else; *no data* where either polarization is missing.
5. **Composite** each month as the per-pixel median of that month's passes, which also reduces speckle.
6. **Vectorize** each monthly class mask into MultiPolygons (majority filter → polygonize →
   drop speckle-sized parts → simplify → union), with areas measured geodesically on WGS84.
7. **Write** two stories (open water, flooded vegetation) whose outline is the "ever this class"
   envelope across all months, plus the monthly extents, the PNG frames and the provenance record.

---

## 5 · Running it

### Frontend (no credentials, no backend)

```bash
cd frontend
npm install
npm run dev          # http://localhost:5173
npm run build        # tsc --noEmit + production build into dist/
npm run preview
```

Deploy as a static site (Vercel/Netlify): root directory `frontend`, build `npm run build`, output
`dist`. No env vars needed; `VITE_API_URL` is optional (§7).

### The exporter (needs a free Earthdata Login)

```bash
cd naba-data
python -m venv ~/.venvs/naba && . ~/.venvs/naba/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements-export.txt        # 11 packages; requirements.txt is the full list
cp .env.example .env          # then fill in EARTHDATA_USERNAME / EARTHDATA_PASSWORD

python -m naba_data search   --preset manzala     # what NISAR data exists (metadata only, no login)
python -m naba_data estimate --preset manzala     # MB one AOI window read would move
python -m naba_data export   --preset manzala     # the real thing: writes frontend/public/data
```

Useful flags: `--max-dates N` (how many acquisitions to stream, default 10), `--offline` (use the
GeoTIFF cache only, never the network), `--samples-only` (rebuild the feed from existing files; no
credentials, no scientific dependencies needed), `--no-samples` (real stories only),
`--min-area-km2` / `--simplify-m` (how much detail the vector extents keep),
`--estimate-only`, `--out DIR`. Run `python -m naba_data export --help` for the full list.

Free Earthdata account: <https://urs.earthdata.nasa.gov>. Credentials are read from `naba-data/.env`
(gitignored) or the environment, used only to authenticate HTTPS reads from NASA, and never written
into the repo or the exported dataset.

```bash
cd naba-data && . ~/.venvs/naba/bin/activate && pytest        # unit tests
```

> **On WSL, keep the virtualenv off `/mnt/*`.** Anything under `/mnt/c`, `/mnt/d`, … is reached
> through the 9p bridge to Windows, where unpacking tens of thousands of small package files is
> 10-50x slower than on the Linux filesystem — a `pip install` that takes two minutes in `~` can
> take an hour in `/mnt/d`. Putting the venv in `~/.venvs/naba` while the code stays on `/mnt/d`
> fixes it. `frontend/node_modules` has the same problem and cannot be relocated, so the first
> `npm install` on a `/mnt` checkout is slow; cloning the repo inside the Linux filesystem
> (`git clone … ~/naba`) avoids both.

### Presets

| Preset | Area | Bounding box | Period |
|---|---|---|---|
| `manzala` | Lake Manzala wetlands, Nile Delta, Egypt | 31.95, 31.15 → 32.20, 31.40 | 2026-06-17 → 2026-11-13 |
| `okavango` | Okavango Delta (central delta), Botswana | 22.55, −19.55 → 22.90, −19.20 | 2026-06-17 → 2026-11-13 |

`manzala` is the shipped dataset. Both come straight from the notebook's wetland presets; add more
in `naba_data/config.py`.

---

## 6 · Provenance and honesty rules

These are product rules, not nice-to-haves. Breaking one is a bug.

- **Sample data is always labelled.** Any loaded story with `is_sample: true` turns on the gold
  "Sample data · concept preview" badge in the top bar, plus "sample values for preview" in the
  story panel and the explain dialog. The feed is deliberately mixed today: the Lake Manzala wetland
  stories are measured, the rest are illustrative.
- **Measurements are traceable.** `provenance.json` lists every granule used (name, date, track,
  frame, polarization, URL), the thresholds and grid resolution applied, the dates that were skipped
  and why, the per-date indicator table, and how many megabytes moved.
- **No overclaiming.** The wetland classes are exploratory dB thresholds on L-band backscatter, not
  a validated flood map: wind on water, wet soil and a different look angle move the same numbers.
  Confidence is never reported as `high` for them, and the limits are stated in the legend, the
  story's confidence note and the explanation itself.
- **Causes are possibilities.** `causes` is phrased as what the pattern is consistent with, with
  `next_step` naming the independent data a reader would need to be sure.
- **Generated text is labelled.** `explanation_ai_generated: true` shows "AI-assisted explanation,
  based only on the measured data". The exporter's own text is templated from the measured numbers,
  so the real stories set it to `false`. No LLM key ever goes in the browser.
- **Credits stay visible.** "Data: NASA–ISRO NISAR"; basemap © CARTO, © OpenStreetMap contributors;
  map by MapLibre. No NASA or ISRO logos or mission patches are used. Naba is not affiliated with,
  or endorsed by, NASA or ISRO.

---

## 7 · Status and roadmap

**Real today**

- Lake Manzala wetlands from NISAR GCOV (Jun–Oct 2026): two stories, monthly vector extents on the
  globe with a month slider, monthly class maps in Compare-dates, full provenance.

**Still illustrative**

- The other 19 stories in the feed (subsidence, moisture, construction, water bodies worldwide) are
  generated samples, flagged `is_sample: true`. They exist to show what the newsroom looks like full.

**Next, in order of what earns its keep**

1. **More AOIs through the same exporter** — each is a `Preset` plus story copy; the globe, slider
   and legend already handle several layers of months.
2. **The notebook's other two themes.** Section 12 (fires: cross-pol drop before/after an event) and
   Section 13 (earthquakes: GUNW interferograms, fringes to centimetres of line-of-sight motion) are
   working analyses waiting for the same treatment — `change_class` and `change_type` already have
   values for them.
3. **FastAPI serving the same shapes.** `GET /changes`, `/wetlands`, `/layers` returning the
   exporter's output verbatim; the frontend needs only `VITE_API_URL`. `requirements.txt` already
   carries FastAPI, Uvicorn and Pydantic.
4. **PostGIS ingest** once there are enough AOIs to want spatial queries (`ST_Intersects`, bbox
   endpoints, newest-first paging) rather than one file per shape. `docker-compose.yml` already
   stands up PostGIS 16, and `geoalchemy2` / `psycopg` are in `requirements.txt`.
5. **Tiled rasters (COG / PMTiles)** so the globe can zoom to the full 20 m detail instead of
   simplified outlines plus one PNG per month. `rio-cogeo`, `rio-tiler` and `pmtiles` are already
   listed.

---

## Credits

Team Naba · NASA Space Apps Challenge 2026 · "Dancing with the SARs".
Data: NASA–ISRO NISAR (NASA CMR, Earthdata Login). Basemap © CARTO, © OpenStreetMap contributors.
Map rendering by MapLibre GL.
