# NISAR demo sites: top 4 per theme

Checked against ASF (search.asf.alaska.edu, NISAR dataset) on 13 Nov 2026.

---

## How to get the data

**Data window**
- PROVISIONAL L-band products cover acquisitions from 17 Jun 2026.
- VALIDATED products cover acquisitions from 21 Oct 2026.
- BETA products exist for a subset of 17 Oct 2025 – 20 Jan 2026. They are not fully calibrated, so don't mix them with PROVISIONAL.
- **Data gap:** there are no acquisitions from 2026-07-27 22:03 UTC to 2026-08-10 00:55 UTC.

**Products**

| Theme | Product | Collection short name | Layers to read (frequency A) |
|---|---|---|---|
| Fires, wetlands | GCOV (backscatter) | `NISAR_L2_GCOV_PROVISIONAL_V1` | `HHHH` (co-pol), `HVHV` (cross-pol) |
| Earthquakes | GUNW (interferogram) | `NISAR_L2_GUNW_PROVISIONAL_V1` | `unwrappedInterferogram/HH/unwrappedPhase`, `.../coherenceMagnitude`, `.../connectedComponents` |

- One fringe in a GUNW is about 12 cm of line-of-sight (LOS) motion.
- GUNW pairs are 12 days apart by default. Pairs that span the data gap are 24–36 days apart.

**Access**
- Downloading or streaming the HDF5 files needs a free NASA Earthdata login (urs.earthdata.nasa.gov).
- Browse PNGs are public.

**Ways to search**

1. **Vertex (web):** go to https://search.asf.alaska.edu/#/?dataset=NISAR. Draw the bounding box (bbox), set the dates, and filter Product Type to GCOV or GUNW. To find a specific file, switch to *List search* and paste the granule names below.
2. **ASF Search API (no login, returns metadata only):**
   ```
   https://api.daac.asf.alaska.edu/services/search/param?dataset=NISAR&processingLevel=GCOV&intersectsWith=POINT(lon%20lat)&start=YYYY-MM-DD&end=YYYY-MM-DD&output=csv
   ```
   Use `processingLevel=GUNW` for earthquakes. `output=geojson` also gives footprints.
3. **Python (asf_search):**
   ```python
   import asf_search as asf
   res = asf.search(dataset="NISAR", processingLevel="GCOV",
                    intersectsWith="POLYGON((W S, E S, E N, W N, W S))",
                    start="2026-08-01", end="2026-10-10")
   # or fetch exact granules by name:
   res = asf.granule_search(["NISAR_L2_PR_GCOV_028_042_D_070_4005_DHDH_A_20260816T025639_20260816T025713_P05023_N_F_J_001"])
   res.download(path=".", session=asf.ASFSession().auth_with_creds(USER, PASS))
   ```
4. **NABA notebook:** put the `bbox`, product and dates below into a `PRESETS` entry in Section 0, then run Sections 9–14. It streams only the bbox, so no full download is needed.

**Reading the granule name.** Example: `NISAR_L2_PR_GCOV_028_042_D_070_4005_DHDH_A_20260816T025639_...`

| Part | Meaning |
|---|---|
| `PR` | Provisional |
| `028` | Cycle |
| `042` | Track (path) |
| `D` | Descending pass (`A` = ascending) |
| `070` | Frame |
| `DHDH` | Dual-pol, HH+HV |
| `20260816T025639` | Acquisition start time (UTC) |

- In GUNW names the first date/time pair is the reference image and the second pair is the secondary image.
- `UR` instead of `PR` marks urgent-response processing, which is not in the PROVISIONAL collection.

**Before/after rule.** Always compare images from the **same track, direction and frame**. Otherwise you are mixing different viewing geometries.

---

## 🔥 Fires (GCOV)

### 1. Plaskett Fire, Big Sur, California ✅ tested

**Status:** tested in the notebook. It shows a clear burn scar: 31–46 km² flagged (ΔHV < −3 / −2 dB), against about 121 km² reported.

**Event**
- Started 26 Aug 2026 on Forest Road 23S10, Los Padres National Forest.
- 29,862 acres, 47% contained on 8 Sep 2026.

**Search parameters**
- bbox `[-121.55, 35.78, -121.25, 36.02]`
- Search 2026-08-01 → 2026-10-15
- Event 2026-08-26 → 2026-09-30

**Granules**

| Role | Date | Track | Granule |
|---|---|---|---|
| Before | 2026-08-16 | 42 D fr 70 | `NISAR_L2_PR_GCOV_028_042_D_070_4005_DHDH_A_20260816T025639_20260816T025713_P05023_N_F_J_001` |
| Before (alt geometry) | 2026-08-22 | 135 A fr 20 | `NISAR_L2_PR_GCOV_028_135_A_020_4005_DHDH_A_20260822T131716_20260822T131751_P05023_N_F_J_001` |
| During (2 days in) | 2026-08-28 | 42 D fr 70 | `NISAR_L2_PR_GCOV_029_042_D_070_4005_DHDH_A_20260828T025638_20260828T025713_P05023_N_F_J_001` |
| **After (used in test)** | 2026-10-03 | 42 D fr 70 | `NISAR_L2_PR_GCOV_032_042_D_070_4005_DHDH_A_20261003T025638_20261003T025713_P05023_N_F_J_001` |
| After (alt geometry) | 2026-10-09 | 135 A fr 20 | `NISAR_L2_PR_GCOV_032_135_A_020_4005_DHDH_A_20261009T131716_20261009T131751_P05023_N_F_J_001` |

**Notes**
- The Timber Fire (Ventana Wilderness, from 8 Aug, bbox `[-121.85, 36.15, -121.50, 36.42]`) is in the same frames but gave only a weak signal in testing.

### 2. Gironde fire near Bordeaux, France

**Status:** coverage is good, including images *during* the fire. Your friend's run flagged only 3.3 km² (ΔHV < −3 dB), so validate before relying on it.

**Event**
- About 22 Jul – 1 Aug 2026, around Le Porge, Lacanau and Lège-Cap-Ferret.
- About 42,000 ha "affected".
- A pyrocumulonimbus (fire-generated thunderstorm) formed, the first recorded in France.

**Search parameters**
- bbox `[-1.25, 44.75, -0.95, 45.00]`
- Search 2026-07-01 → 2026-08-31
- Event 2026-07-22 → 2026-08-01

**Acquisitions**

| Role | Dates (track/direction/frame) |
|---|---|
| Before | 2026-07-14 (95 D fr 66), 2026-07-17 (130 A fr 24), 2026-07-12 (58 A fr 24) |
| During | 2026-07-24 (58 A fr 24), 2026-07-26 (95 D fr 66) |
| After | 2026-08-10 (130 A fr 24), 2026-08-17 (58 A fr 24), 2026-08-19 (95 D fr 66) |

**Same-geometry pairs**
- 130 A: 07-17 → 08-10
- 95 D: 07-14 → 08-19
- 58 A: 07-12 → 08-17

**Notes**
- Granule names weren't captured; ASF was returning server errors when this was written. Query: `...processingLevel=GCOV&intersectsWith=POINT(-1.08%2044.87)&start=2026-07-10&end=2026-08-20&output=csv`

### 3. Pantanal fires, Brazil

**Status:** densest coverage of all the sites, with 2–3 geometries and an image every 2–7 days.

**Event**
- 113,014 ha burned by August 2026.
- Area burned by mid-year was up 770% on the same period of 2025.

**Search parameters**
- Central-Pantanal bbox `[-57.50, -19.00, -56.50, -18.00]`. Narrow it to an actual burn scar using NASA FIRMS hotspots before streaming.
- Search 2026-06-17 → 2026-10-31

**Acquisitions (at −18.5, −57.0)**

| Geometry | Dates |
|---|---|
| 111 D fr 98 | 06-21, 07-03, 07-15, 08-20, 09-01, 09-13, 09-25, 10-07, 10-19, 10-31 |
| 10 D fr 98 | 06-26, 07-08, 07-20, 08-13, 08-25, 09-06, 09-18, 09-30, 10-12, 10-24, 11-05 |
| 132 A fr 168 | 07-05, 07-17, 08-10, 08-22, 09-03, 09-15, 09-27, 10-09, 10-21 |

**Notes**
- Granule names weren't captured (ASF errors). Query: `...processingLevel=GCOV&intersectsWith=POINT(-57.0%20-18.5)&start=2026-06-17&end=2026-10-31&output=csv`

### 4. Everglades fire, Florida

**Status:** covered by two geometries before and after the fire.

**Event**
- August 2026: about 24,000 acres burned in Everglades National Park after extreme drought.
- Peat soil is involved.

**Search parameters**
- bbox `[-80.95, 25.25, -80.55, 25.65]`. Narrow it to the burn using FIRMS or park reports.
- Search 2026-07-01 → 2026-09-30

**Granules**

| Role | Date | Track | Granule |
|---|---|---|---|
| Before | 2026-07-20 | 170 D fr 76 | `NISAR_L2_PR_GCOV_025_170_D_076_4005_DHDH_A_20260720T000515_20260720T000549_P05023_N_F_J_001` |
| Before | 2026-07-23 | 47 A fr 14 | `NISAR_L2_PR_GCOV_026_047_A_014_2005_DHDH_M_20260723T104409_20260723T104440_P05023_N_F_J_001` |
| After | 2026-08-25 | 170 D fr 76 | `NISAR_L2_PR_GCOV_028_170_D_076_4005_DHDH_A_20260825T000513_20260825T000547_P05023_N_F_J_001` |
| After | 2026-08-28 | 47 A fr 14 | `NISAR_L2_PR_GCOV_029_047_A_014_2005_DHDH_M_20260828T104408_20260828T104439_P05023_N_F_J_001` |
| Later | 2026-09-06 | 170 D fr 76 | `NISAR_L2_PR_GCOV_029_170_D_076_4005_DHDH_A_20260906T000513_20260906T000547_P05023_N_F_J_002` |

**Notes**
- Track 47 also has a `4005 ... _P_` (partial-frame) variant on each date. Use the `2005 ... _F_` one shown here.

**Alternate:** Northwestern Ontario fires (mid-July 2026; Armstrong, Lac La Croix, Collins FN).
- Images from point (−89.0, 50.1): 07-11, 07-16, 07-23, then 08-16 onward. Tracks 47 A fr 27 / 41 D fr 63 / 119 A fr 27 / 113 D fr 63.
- Image quality may be lower at this latitude.

---

## 🌊 Wetlands (GCOV time series)

For wetlands, keep **one geometry** through time and use monthly medians of HH and HV. Bright HH with a large HH−HV gap indicates flooded vegetation; dark HH and HV indicate open water.

### 1. Okavango Delta, Botswana

**Status:** the flood peak is covered.

**Event**
- One of the largest floods in decades (reported 13 May 2026).
- Water usually peaks June–July.

**Search parameters**
- bbox `[22.55, -19.55, 22.90, -19.20]` (central delta)
- Search 2026-06-17 → 2026-11-13

**Acquisitions (at −19.4, 22.8)**

| Geometry | Dates |
|---|---|
| 172 A fr 168 | 06-26, 07-08, 07-20, 08-13, 08-25, 09-06, 09-18, 09-30, 10-12, 10-24 |
| 151 D fr 98 | 06-24, 07-06, 07-18, 08-11, 08-23, 09-04, 09-16, 09-28, 10-10 |

**Known granules (172 A fr 168)**
- 2026-06-26: `NISAR_L2_PR_GCOV_023_172_A_168_2005_DHDH_A_20260626T041717_20260626T041752_P05023_N_F_J_001`
- 2026-10-12: `NISAR_L2_PR_GCOV_032_172_A_168_2005_DHDH_A_20261012T041714_20261012T041748_P05023_N_F_J_001`

**Dry-season baseline**
- BETA, 172 A fr 168: 2025-11-22, 12-04, 12-16, 12-28, 2026-01-09.
- Not calibrated the same way as PROVISIONAL, so use it for visuals only.

### 2. Pantanal, Brazil

**Status:** densest coverage; the same images also serve the fire theme.

**Event**
- Record drought, plus fire.
- First time the Pantanal entered Brazil's aridity risk zone (Oct 2026).

**Search parameters**
- bbox `[-57.50, -19.00, -56.50, -18.00]`, or a smaller box on a lagoon or floodplain.
- Search 2026-06-17 → 2026-11-13

**Acquisitions:** same as Fire #3 above. Best single geometry: 10 D fr 98 (11 dates).

### 3. Everglades, Florida

**Status:** covered by two geometries throughout.

**Event**
- Extreme drought in summer 2026, then the August fire (peat soil).

**Search parameters**
- bbox `[-80.95, 25.25, -80.55, 25.65]`
- Search 2026-06-17 → 2026-11-13

**Acquisitions (at 25.45, −80.75)**

| Geometry | Dates |
|---|---|
| 47 A fr 14 | 06-17, 06-29, 07-11, 07-23, 08-16, 08-28, 09-09, 09-21, 10-03, 10-15, 10-27 |
| 170 D fr 76 | 06-26, 07-08, 07-20, 08-13, 08-25, 09-06, 09-18, 09-30, 10-12, 10-24 |

**Granules:** see Fire #4 for names.

### 4. Mesopotamian Marshes, Iraq

**Status:** weakest of the four.

**Event**
- Rains revived the marshes (reported 30 Apr 2026): about 32–36% recovered, against 8% during the drought.
- Fish die-offs were reported 6 Aug 2026.

**Coverage limits**
- **Aug 6 falls inside the data gap.**
- There are no BETA images, so the April revival is not covered.

**Search parameters**
- bbox `[46.80, 30.80, 47.30, 31.20]` (Central and Hammar marshes)
- Search 2026-06-17 → 2026-11-13

**Acquisitions (at 31.0, 47.0)**

| Geometry | Dates |
|---|---|
| 64 D fr 73 | 06-18, 06-30, 07-12, 07-24, 08-17, 08-29, 09-10, 09-22, 10-04, 10-16, 10-28 |
| 13 A fr 17 | 06-27, 07-09, 07-21, 08-14, 08-26, 09-07, 09-19, 10-01, 10-13, 10-25, 11-06 |

**Pair bracketing the die-off:** 64 D 07-24 → 08-17.

---

## 🌍 Earthquakes (GUNW interferograms)

### 1. M7.7 Azuero peninsula, Panama ✅ tested

**Status:** tested. The track 40 pair shows a lobed fringe pattern at the epicentre, about 11.6 fringe cycles (~1.4 m LOS), coherence 0.43.

**Event (USGS)**
- 2026-10-09 17:56:05 UTC, 7.6069°N 80.7566°W, depth 10 km.
- Aftershocks: M6.6 (20:25), M6.0 (10 Oct), M6.1 (12 Oct).

**Search parameters**
- bbox `[-81.10, 7.20, -80.30, 7.90]`
- Search 2026-09-15 → 2026-10-31

**Granules**

| Rank | Pair | Granule |
|---|---|---|
| **Best** | 40 D fr 85, 10-02 → 10-14 | `NISAR_L2_PR_GUNW_032_040_D_085_033_4000_SH_20261002T234516_20261002T234533_20261014T234516_20261014T234533_P05023_N_P_J_001` |
| 2nd | 76 A fr 5, 10-05 → 10-17 | `NISAR_L2_PR_GUNW_032_076_A_005_033_4000_SH_20261005T105604_20261005T105616_20261017T105604_20261017T105616_P05023_N_P_J_001` |
| 3rd (noisier) | 141 D fr 85, 09-27 → 10-09 | `NISAR_L2_PR_GUNW_031_141_D_085_032_4000_SH_20260927T235335_20260927T235344_20261009T235335_20261009T235345_P05023_N_P_J_001` |

**Notes**
- Avoid 141 D **frame 84**: it stops north of the epicentre. This was the notebook's default pick.

### 2. M7.5 + M7.2 doublet, northern Venezuela

**Status:** the best untested pick, with three clean 12-day pairs.

**Event (USGS)**
- M7.5: 2026-06-24 22:05:04 UTC, 10.5955°N 67.2205°W, 10 km (20 km W of Catia La Mar).
- M7.2: 22:04:31 UTC, 10.3713°N 68.5564°W, 10 km (20 km E of San Felipe, inland).

**Search parameters**
- bbox `[-68.90, 10.00, -66.90, 10.95]`. Or split into two boxes, one around each epicentre, to keep reads small.
- Search 2026-06-10 → 2026-07-20

**Granules**

| Pair | Granule |
|---|---|
| 54 D fr 83, 06-17 → 06-29 | `NISAR_L2_PR_GUNW_023_054_D_083_024_4000_SH_20260617T230235_20260617T230310_20260629T230235_20260629T230309_P05023_N_F_J_001` |
| 126 D fr 83, 06-22 → 07-04 | `NISAR_L2_PR_GUNW_023_126_D_083_024_4000_SH_20260622T225416_20260622T225450_20260704T225415_20260704T225450_P05023_N_F_J_001` |
| 162 A fr 7, 06-13 → 06-25 | `NISAR_L2_PR_GUNW_022_162_A_007_023_4000_SH_20260613T100656_20260613T100731_20260625T100655_20260625T100730_P05023_N_F_J_001` |

**Notes**
- Coverage was checked at (10.5, −67.6). Confirm that each frame's footprint reaches the M7.2 epicentre, about 1° further west.

### 3. M5.8 Qinghai, China

**Status:** a small-magnitude test. The dry, bare terrain usually keeps coherence even over 24 days.

**Event (USGS)**
- 2026-07-28 03:34:05 UTC, 35.4257°N 99.5723°E, 10 km (193 km NW of Oula Xiuma).

**Search parameters**
- bbox `[99.30, 35.20, 99.85, 35.65]`
- Search 2026-07-10 → 2026-08-31

**Granules (both 24-day pairs because of the gap)**

| Pair | Granule |
|---|---|
| 62 D fr 71, 07-24 → 08-17 | `NISAR_L2_PR_GUNW_026_062_D_071_028_2000_SH_20260724T121455_20260724T121529_20260817T121454_20260817T121528_P05023_N_F_J_001` |
| 155 A fr 19, 07-18 → 08-11 | `NISAR_L2_PR_GUNW_025_155_A_019_027_2000_SH_20260718T223425_20260718T223500_20260811T223424_20260811T223459_P05023_N_F_J_001` |

### 4. M6.8 Kumamoto (Uto), Japan

**Status:** fallback only. It's covered, but every pair is 24–36 days because of the gap, so expect lower coherence.

**Event (USGS)**
- 2026-07-28 07:27:14 UTC, 32.6177°N 130.6601°E, 8 km.

**Search parameters**
- bbox `[130.40, 32.40, 131.00, 32.95]`
- Search 2026-07-01 → 2026-08-31

**Granules**

| Pair | Granule |
|---|---|
| 24 A fr 18, 07-21 → 08-14 (24 d) | `NISAR_L2_PR_GUNW_026_024_A_018_028_4000_SH_20260721T202900_20260721T202934_20260814T202858_20260814T202933_P05023_N_F_J_001` |
| 125 A fr 18, 07-16 → 08-21 (36 d) | `NISAR_L2_PR_GUNW_025_125_A_018_028_4000_SH_20260716T203720_20260716T203755_20260821T203718_20260821T203753_P05023_N_F_J_001` |
| 3 D fr 72, 07-08 → 08-13 (36 d) | `NISAR_L2_PR_GUNW_025_003_D_072_028_4000_SH_20260708T100219_20260708T100253_20260813T100217_20260813T100251_P05023_N_F_J_001` |

**Not in the top 4**
- **M7.0 Tibet (22 Oct):** only an urgent-response (`UR`) pair exists so far, 112 A fr 18, 10-19 → 10-31.
- **M7.8 Flores Sea, Indonesia (14 Aug):** offshore, so only coastal motion would show. Pairs: 168 A 08-12 → 08-24 and 3 D 08-13 → 08-25.

---

## Sources

- NISAR availability: https://nisar-docs.asf.alaska.edu/availability-overview/
- ASF Search API: https://api.daac.asf.alaska.edu/services/search/param
- USGS earthquake catalog: https://earthquake.usgs.gov/fdsnws/event/1/query
- Big Sur fire updates (8 Sep 2026): https://bigsurkate.blog/2026/09/08/
- Bordeaux fire: https://www.connexionfrance.com/news/massive-wildfire-near-bordeaux-stabilised-220000-evacuated/803916
- Pantanal: https://www.techtimes.com/articles/329724/20261030/pantanal-enters-brazils-aridity-risk-zone-first-time-recorded-history.htm
- Everglades: https://www.wlrn.org/environment/2026-08-26/drought-fire-everglades-peat-national-park
- Okavango: https://africageographic.com/?p=178074
