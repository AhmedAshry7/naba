# Naba · نبأ — frontend

*Earth's news, before it breaks.* A newsroom for the Earth: NISAR radar changes shown as news stories on an interactive 3D globe.
React 18 + Vite + TypeScript, Tailwind, MapLibre GL v5 (globe projection, CARTO Dark Matter basemap), Zustand, lucide-react. Theme: blue / black / gold (from the logo in `public/logo.png`).

> The headlines sidebar and Time Machine were removed from the UI for now (the Compare-dates view still uses `layers.json`).

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build into dist/
npm run preview    # serve the production build
npm run sample-data   # regenerate the sample files in public/data
```

Useful URLs: `/?demo=1` autoplays the golden path for screen recording (press **D** any time to restart) ·
`/?story=delta-north-coast` opens a story directly (the URL updates as you select stories; the copy-link button in the panel shares it).
**Esc** closes the top-most panel/modal.

## Deploy (Vercel or Netlify, static)

- Root directory: `frontend` · Build command: `npm run build` · Output directory: `dist`
- No env vars, backend, or API keys needed. Optional: `VITE_API_URL` (see below).

## Where data comes from

All data access lives in **`src/data/loadData.ts`**. Nothing else in the UI knows how data is stored.

| `VITE_API_URL` | Source |
|---|---|
| unset | static files `public/data/changes.geojson`, `public/data/layers.json`, `public/data/frames/*.png` |
| set (e.g. `https://api.example.com`) | `GET {VITE_API_URL}/changes` and `GET {VITE_API_URL}/layers`, same JSON shapes as the files |

So the Postgres/PostGIS backend only has to **serve two JSON shapes** (below); the DB schema is free to be anything.
A natural mapping: one `changes` table (one row per story, `geometry` as PostGIS geometry) → `ST_AsGeoJSON` into a FeatureCollection;
one `layers` + `frames` table pair → `layers.json`. Frame image URLs may be absolute.

### `changes.geojson`
A GeoJSON FeatureCollection; each feature is a Polygon/MultiPolygon with these `properties` (TypeScript: `src/types.ts`):

```jsonc
{
  "id": "delta-north-coast",            // unique, URL-safe
  "headline": "...", "region": "...", "subtitle": "...",
  "lat": 31.35, "lon": 31.70,            // focus point (map flies here)
  "change_class": "significant",         // significant | moderate | stable | water
  "change_type": "subsidence",           // subsidence | uplift | moisture | water | vegetation | construction
  "metric": { "label": "Ground movement", "value": -8, "unit": "mm per year", "direction": "downward" }, // upward | downward | steady
  "period": { "start": "2026-01-05", "end": "2026-10-20" },
  "passes": 25, "area_km2": 46,
  "confidence": "moderate",              // low | moderate | high
  "confidence_note": "Cause not confirmed",
  "summary": "...", "causes": ["..."], "why_it_matters": "...", "next_step": "...",
  "series": [{ "date": "2026-01-05", "value": 0.0 }],   // value in the first word of metric.unit (mm, %, dB, m)
  "explanation": "Long text (blank line = new paragraph)",
  "explanation_ai_generated": true,      // shows the "AI-assisted" label
  "published": "2026-10-22",             // feed order, newest first
  "is_sample": true                      // shows the "Sample data · concept preview" badge
}
```

### `layers.json` (used by Compare dates, optional)
```jsonc
{ "layers": [{ "id": "surface-change", "label": "Surface change",
    "bounds": [[29.5, 32.0], [32.6, 32.0], [32.6, 29.8], [29.5, 29.8]],   // [lon, lat]: TL, TR, BR, BL
    "frames": [{ "date": "2026-01-05", "url": "/data/frames/change_2026-01-05.png" }] }] }
```
Frames are transparent PNGs. If `layers.json` is missing, the Time Machine shows an empty state and the rest of the app still works.
Only the first layer is used for now.

## Honesty and credits

- `is_sample: true` on any loaded story → permanent "Sample data · concept preview" badge, plus "sample values for preview" in the panel footer and explain dialog. All data currently in `public/data` is generated sample data (`scripts/generate-sample-data.mjs`), not real measurements.
- AI-written text (`explanation_ai_generated`) is labelled "AI-assisted explanation, based only on the measured data". Never put an LLM key in the browser; generate explanations server-side.
- Credit: "Data: NASA–ISRO NISAR". Basemap attribution (© CARTO, © OpenStreetMap) stays visible. No NASA logos or mission patches are used.

## Structure

```
src/
  data/loadData.ts     the only data source adapter
  store.ts             Zustand: stories, selection, filter, time machine, modals
  components/          TopBar, MapView, HeadlinesFeed, StoryCard, StoryPanel, SeriesChart,
                       ExplainSection, ConfidenceBar, Legend, TimeMachine, SampleBadge,
                       CompareModal, AboutModal, IntroScreen
  hooks/useDemoMode.ts scripted golden path (?demo=1, key D)
```
