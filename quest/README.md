# NABA for Meta Quest 3S

A mixed-reality version of NABA: a dark-style Earth globe floats in your room, showing the same NISAR stories as the web
map. Tap a story and the globe flattens into a detailed map of the area with the radar image on it, and a side panel
with everything about the incident.

This folder is self-contained. It does not change the web app, `naba-data`, or anything else in the repo.

```
quest/
  unity/      Unity 6 project (open this folder in Unity Hub)
  pipeline/   Python scripts that turn the web app's data into assets for the headset
```

## What it does

1. **Intro**: the NABA logo sweeps in, the satellite flies in and lands on the last letter, then press **Let's start**.
2. **Globe**: rotate it, zoom it, point at pins. Pins are the stories in `frontend/public/data/changes.geojson`, at their
   exact coordinates, coloured like the web map's guide: green earthquake, turquoise flooding (water rising),
   blue water shrinking, red forest fire. A **GUIDE** legend floats next to the globe.
3. **Story**: tap a pin and the globe unrolls into a flat map of that area (a detailed OpenStreetMap basemap in the
   web map's colours) with the story's area highlighted. A panel opens on the right, laid out like the web panel:
   the badge, headline, the web app's plain-language paragraphs, the metric line, Observed / Radar passes / Area,
   and a **time slider** at the bottom. Moving the slider (or pressing play) changes what the map shows:
   - fires: the likely / possibly burned areas of each radar pass (`fires.geojson`)
   - floods and wetlands: open water and flooded vegetation for each month (`wetlands.geojson`)
   - the earthquake: first pass, M7.7 mainshock, aftershocks, second pass (`provenance-earthquake-panama.json`)
   Steps where the event is not happening yet (before the fire or the earthquake) are shown in grey.

## Controls (Quest controllers)

| Input | Action |
|---|---|
| Right trigger on a pin | Open its story (flatten + zoom) |
| Right trigger hold + move | Rotate the globe / pan the map |
| Right thumbstick left/right | Spin the globe / pan the map |
| Right thumbstick up/down, left thumbstick, or both grips pulled apart | Zoom |
| Point at the panel + trigger | Press its buttons or drag the time slider; thumbstick up/down scrolls, left/right steps the slider |
| A | Map: back to the globe. Globe: bring it in front of you |
| B | Switch between the starfield and passthrough (your room) |

In the Unity Editor without a headset, the mouse works too (click, drag, scroll).

## Open and run

1. Unity Hub, **Add project from disk**, choose `quest/unity`. Editor **6000.4.0f1** (Unity 6).
   Packages (Meta XR SDK 85, OpenXR, URP) install on first open.
2. Open `Assets/Scenes/SampleScene` and press Play.
3. For the headset: **File > Build Profiles > Android**, Meta's **Project Setup Tool > Fix All**,
   connect the Quest (Developer Mode on) and **Build And Run**.

The **NISAR** menu in Unity can rebuild the scene objects (globe, intro, space background) if needed.

## Updating the data

The headset copy of the stories lives in `unity/Assets/Globe/Resources/Stories/`. It is built from
`frontend/public/data/`: `changes.geojson` (stories and panel text), plus `fires.geojson`, `wetlands.geojson` and
`provenance-earthquake-panama.json` (the time sliders). When those change, regenerate it:

```bash
cd quest/pipeline
pip install -r requirements.txt
python make_story_data.py          # stories, panel text, detailed basemaps and per-step highlights
```

Other scripts (only needed to restyle):

- `make_globe_texture.py`: the globe texture and country labels (Natural Earth).
- `make_intro_assets.py`: the intro logo, satellite, tagline and button images (uses Windows fonts Oswald and Segoe UI).

## Credits

NASA-ISRO NISAR data as processed by `naba-data`. Basemaps: (c) OpenStreetMap contributors, (c) CARTO.
Oswald font (`unity/Assets/Globe/Resources/Fonts`): SIL Open Font License 1.1.
Globe: Natural Earth (public domain).
