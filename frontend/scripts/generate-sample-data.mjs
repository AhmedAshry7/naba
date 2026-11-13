// Generates the SAMPLE half of the Naba feed: public/data/sample-stories.json.
// Every story here is flagged is_sample: true and is illustrative, not measured.
//
// This script does NOT write changes.geojson / layers.json / frames: the `naba-data` exporter owns
// those files and folds this one in, so real measurements can never be clobbered by a sample run.
//   python -m naba_data export --preset manzala      (full rebuild, needs Earthdata credentials)
//   python -m naba_data export --samples-only        (sample half only, no network)
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data')
mkdirSync(root, { recursive: true })

// ---------- helpers ----------
function rng(seed) {
  let s = seed >>> 0
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296)
}
const addDays = (iso, n) => {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const round = (v, p = 2) => Math.round(v * 10 ** p) / 10 ** p

const START = '2026-01-05'
const N = 25
const dates = Array.from({ length: N }, (_, i) => addDays(START, i * 12))
const END = dates[N - 1]

function blob(lon, lat, rx, ry, seed, n = 28, rot = 0) {
  const r = rng(seed)
  const pts = []
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2
    const k = 0.9 + r() * 0.2
    const x = Math.cos(a) * rx * k
    const y = Math.sin(a) * ry * k
    pts.push([round(lon + x * Math.cos(rot) - y * Math.sin(rot), 4), round(lat + x * Math.sin(rot) + y * Math.cos(rot), 4)])
  }
  pts.push(pts[0])
  return { type: 'Polygon', coordinates: [pts] }
}

// progress curves 0..1 over t in 0..1
const smooth = (t) => t * t * (3 - 2 * t)
function series(fn, seed, noise) {
  const r = rng(seed)
  return dates.map((date, i) => {
    const t = i / (N - 1)
    const v = i === 0 ? 0 : fn(t) + (r() - 0.5) * noise
    return { date, value: round(v) }
  })
}

// ---------- stories ----------
const stories = [
  {
    id: 'delta-north-coast',
    headline: 'Ground sinking along the northern Delta coast',
    region: 'Northern Nile Delta',
    subtitle: 'Coastal farmland',
    lat: 31.35, lon: 31.7,
    change_class: 'significant', change_type: 'subsidence',
    metric: { label: 'Ground movement', value: -8, unit: 'mm per year', direction: 'downward' },
    area_km2: 46, confidence: 'moderate', confidence_note: 'Cause not confirmed',
    summary: 'The radar shows this land sinking a little more with every pass. The drop is steady, not sudden, so it isn\'t from a single event.',
    causes: ['Soft delta soil slowly settling', 'Groundwater pumped for farms and towns'],
    why_it_matters: 'Low fields near the coast become more exposed to seawater and flooding.',
    next_step: 'Compare with groundwater and land-use records for this area.',
    explanation: 'Between January and October the radar measured the ground along this stretch of coast dropping by about 6.7 millimetres, which is a rate of roughly 8 millimetres per year.\n\nThe sinking is smooth and continuous. A sudden event such as an earthquake would show up as a sharp step, and there is none here. That pattern is consistent with slow settling of soft delta soil, possibly made faster by groundwater being pumped out.\n\nWhy it matters: the Delta is already very flat. Even small drops can let seawater reach farmland more easily. This is an early signal to check against groundwater and land-use records, not a confirmed cause.',
    series: series((t) => -6.7 * (0.85 * t + 0.15 * smooth(t)), 11, 0.25),
    poly: blob(31.7, 31.35, 0.5, 0.11, 3, 32, -0.08),
  },
  {
    id: 'delta-mid-farmland',
    headline: 'Soil moisture shifting across mid-Delta farmland',
    region: 'Central Nile Delta',
    subtitle: 'Irrigated cropland',
    lat: 30.85, lon: 31.0,
    change_class: 'moderate', change_type: 'moisture',
    metric: { label: 'Soil moisture', value: 12, unit: '% change', direction: 'upward' },
    area_km2: 380, confidence: 'moderate', confidence_note: 'Seasonal irrigation may explain part of this',
    summary: 'Radar signals from these fields rise and fall in rhythm with the season. Overall the soil looks wetter than at the start of the year.',
    causes: ['Irrigation and flooding of fields for crops', 'Seasonal rainfall and rising water tables'],
    why_it_matters: 'Wetter soil can affect crop health and how salty the land becomes over time.',
    next_step: 'Compare with crop calendars and irrigation schedules.',
    explanation: 'Radar is sensitive to water in the soil: wetter ground reflects the signal differently. Across this region the signal grew steadily stronger through the year, with a small seasonal wobble.\n\nThat is consistent with a combination of irrigation and a higher water table. Farmers flood fields on a schedule, so some of the movement is simply the farming calendar.\n\nThis is a trend worth watching rather than a warning. If moisture keeps rising, soil salinity could become a concern.',
    series: series((t) => 12 * smooth(t) + 1.6 * Math.sin(t * Math.PI * 4), 21, 0.6),
    poly: blob(31.0, 30.85, 0.38, 0.24, 7, 30, 0.2),
  },
  {
    id: 'east-cairo-city',
    headline: 'Rapid ground change at new city construction east of Cairo',
    region: 'East of Greater Cairo',
    subtitle: 'New urban development',
    lat: 30.05, lon: 31.75,
    change_class: 'significant', change_type: 'construction',
    metric: { label: 'Radar brightness', value: 3.8, unit: 'dB increase', direction: 'upward' },
    area_km2: 12, confidence: 'high', confidence_note: 'Pattern typical of new buildings',
    summary: 'This patch of desert became much brighter on radar around mid-year. That sudden jump is the signature of buildings and roads appearing.',
    causes: ['New buildings and roads replacing open desert', 'Large earth-moving works'],
    why_it_matters: 'Fast urban growth changes water demand, traffic and how the ground behaves.',
    next_step: 'Confirm with high-resolution optical imagery.',
    explanation: 'Hard, angular surfaces like walls and roofs bounce radar straight back to the satellite, so built-up areas look very bright. Here the signal jumped by about 3.8 decibels over just a few passes.\n\nA sudden step like this is different from slow natural change. It is consistent with construction starting across a large area.\n\nA photo from another satellite could confirm what is being built.',
    series: series((t) => (t < 0.45 ? 0.2 * t : 0.1 + 3.7 * smooth(Math.min(1, (t - 0.45) / 0.2))), 31, 0.18),
    poly: blob(31.75, 30.05, 0.14, 0.09, 5, 24, 0.4),
  },
  {
    id: 'nasser-shoreline',
    headline: 'Lake shoreline shifting with water levels',
    region: 'Lake Nasser',
    subtitle: 'Reservoir shoreline',
    lat: 23.2, lon: 32.7,
    change_class: 'water', change_type: 'water',
    metric: { label: 'Water level change', value: -1.8, unit: 'm', direction: 'downward' },
    area_km2: 320, confidence: 'moderate', confidence_note: 'Level estimated from shoreline position',
    summary: 'The lake edge has pulled back from where it was in January, which suggests the water level has dropped.',
    causes: ['Seasonal release of water downstream', 'Less inflow during the dry months'],
    why_it_matters: 'Lake levels affect water supply, power generation and farming downstream.',
    next_step: 'Compare with dam operation records.',
    explanation: 'The shoreline of this large reservoir is easy to track because water looks dark on radar. Over the year the edge retreated, which means the water level fell by an estimated 1.8 metres.\n\nReservoir levels naturally rise and fall with the seasons and with how much water is released. This pattern is consistent with a normal drawdown, though operation records would be needed to be sure.',
    series: series((t) => -1.8 * (0.5 * t + 0.5 * smooth(t)) + 0.15 * Math.sin(t * Math.PI * 2), 51, 0.05),
    poly: blob(32.7, 23.2, 0.13, 0.55, 13, 34, 0.15),
  },
  {
    id: 'toshka-farms',
    headline: 'New farmland expanding west of the lake',
    region: 'Toshka',
    subtitle: 'Desert reclamation',
    lat: 22.85, lon: 31.25,
    change_class: 'moderate', change_type: 'vegetation',
    metric: { label: 'Vegetated area', value: 9, unit: '% growth', direction: 'upward' },
    area_km2: 85, confidence: 'low', confidence_note: 'Radar sees crops indirectly',
    summary: 'Patches of desert west of the lake are changing in a way that fits new crops being planted and irrigated.',
    causes: ['New irrigated fields being planted', 'Pumped water feeding reclaimed desert land'],
    why_it_matters: 'Large new farms use a lot of water and change the local landscape.',
    next_step: 'Check with optical imagery to confirm the crops.',
    explanation: 'Growing plants and wet soil change how radar bounces back. West of the lake, signals in several round patches shifted in a way consistent with irrigated crops.\n\nRadar only sees plants indirectly, so confidence is lower here. An optical satellite image would show green fields clearly and confirm it.',
    series: series((t) => 9 * smooth(t) + 0.5 * Math.sin(t * Math.PI * 5), 61, 0.4),
    poly: blob(31.25, 22.85, 0.26, 0.16, 17, 28, -0.3),
  },
]

// ---------- more sample stories around the world (all is_sample) ----------
// [id, headline, region, subtitle, lat, lon, class, type, [label, value, unit, direction], area_km2, confidence, note, rx, ry, summary, [cause1, cause2], why, next]
const EXTRA = [
  ['mexico-city', 'Mexico City ground keeps sinking', 'Valley of Mexico', 'Dense urban area', 19.43, -99.13, 'significant', 'subsidence', ['Ground movement', -30, 'mm per year', 'downward'], 220, 'high', 'Pattern seen for decades', 0.55, 0.4, 'The city sits on an old lake bed. The radar shows the ground dropping steadily, fastest in the south-east.', ['Groundwater pumped from the clay beneath the city', 'Soft lake-bed soil compacting'], 'Uneven sinking can crack pipes, roads and buildings.', 'Compare with groundwater pumping records.'],
  ['jakarta', 'Northern Jakarta sinking toward the sea', 'Jakarta Bay', 'Coastal megacity', -6.12, 106.85, 'significant', 'subsidence', ['Ground movement', -60, 'mm per year', 'downward'], 90, 'high', 'Consistent over all passes', 0.4, 0.2, 'Radar shows the northern coast of the city dropping faster than the rest, while sea level keeps rising.', ['Groundwater extraction for homes and industry', 'Weight of buildings on soft coastal soil'], 'Low coastal land floods more easily when it sinks.', 'Compare with well-extraction and tide records.'],
  ['central-valley', 'California farmland sinking as groundwater drops', 'San Joaquin Valley', 'Irrigated farmland', 36.5, -120.2, 'significant', 'subsidence', ['Ground movement', -100, 'mm per year', 'downward'], 1400, 'high', 'Typical of heavy pumping', 1.3, 0.8, 'A wide strip of farmland is dropping, with the fastest sinking in the middle of the valley.', ['Heavy groundwater pumping during dry spells', 'Compaction of clay layers underground'], 'Sinking can damage canals and permanently reduce water storage.', 'Compare with well-level and canal data.'],
  ['venice-lagoon', 'Ground slowly settling around the Venice lagoon', 'Veneto', 'Historic lagoon city', 45.44, 12.33, 'moderate', 'subsidence', ['Ground movement', -2, 'mm per year', 'downward'], 160, 'high', 'Small but steady', 0.5, 0.3, 'The ground here is sinking only slightly, but it adds up in a place that already floods.', ['Natural settling of lagoon sediments', 'Past groundwater use'], 'Even millimetres matter where streets are close to sea level.', 'Compare with tide-gauge records.'],
  ['mekong-delta', 'Mekong Delta coast sinking', 'Southern Vietnam', 'River delta farmland', 9.8, 106.2, 'moderate', 'subsidence', ['Ground movement', -18, 'mm per year', 'downward'], 600, 'moderate', 'Cause not confirmed', 0.9, 0.5, 'Much of the delta is dropping a little each year, more than the sea is rising.', ['Groundwater pumping for rice and shrimp farms', 'Less river sediment reaching the delta'], 'A sinking delta lets salt water reach farmland and drinking water.', 'Compare with groundwater and sediment records.'],
  ['reykjanes', 'Ground rising near an Iceland volcano', 'Reykjanes Peninsula', 'Volcanic area', 63.9, -22.4, 'significant', 'uplift', ['Ground movement', 35, 'mm per year', 'upward'], 70, 'high', 'Typical before eruptions', 0.4, 0.25, 'The ground is swelling slowly upward, a sign that something is moving underneath.', ['Magma collecting underground', 'Pressure changes in hot underground water'], 'Ground swelling is one of the signs scientists watch before an eruption.', 'Share with the local geology and monitoring office.'],
  ['lake-mead', 'Reservoir shoreline retreating at Lake Mead', 'Nevada and Arizona', 'Desert reservoir', 36.2, -114.4, 'water', 'water', ['Water level change', -3.4, 'm', 'downward'], 250, 'moderate', 'Level estimated from shoreline', 0.5, 0.3, 'The edge of the lake has pulled back, leaving pale bands of dry shoreline.', ['Less river inflow in dry years', 'High demand for water downstream'], 'Lower levels affect drinking water and hydropower.', 'Compare with reservoir operation data.'],
  ['lake-chad', 'Lake Chad water edge shifting', 'Lake Chad basin', 'Seasonal lake', 13.0, 14.4, 'water', 'water', ['Water area', 6, '% growth', 'upward'], 900, 'moderate', 'Strong seasonal swings', 0.9, 0.7, 'The open-water area is larger than at the start of the year, though it changes with the seasons.', ['Seasonal rains and river flow', 'Natural year-to-year swings'], 'Millions of people rely on this shallow lake for fishing and farming.', 'Compare with rainfall and river-flow records.'],
  ['aral-sea', 'Dried seabed expanding around the Aral Sea', 'Central Asia', 'Former inland sea', 45.0, 59.5, 'water', 'water', ['Water area', -4, '% shrink', 'downward'], 1200, 'moderate', 'Long-term trend', 1.1, 0.8, 'The remaining water is shrinking, leaving more dry seabed.', ['River water diverted for crops', 'Low rainfall'], 'Dry seabed can blow dust and salt across nearby farmland.', 'Compare with river diversion records.'],
  ['mato-grosso', 'Forest turning to open land along the Amazon frontier', 'Mato Grosso, Brazil', 'Forest edge', -9.5, -56.0, 'significant', 'vegetation', ['Forest signal', -12, '% change', 'downward'], 1800, 'moderate', 'Radar sees trees indirectly', 1.2, 0.7, 'Radar signals from the forest are dropping in patches, in the pattern of cleared land.', ['Forest cleared for farms and pasture', 'Fire damage in the dry season'], 'Forest loss affects wildlife, rainfall and stored carbon.', 'Confirm with optical imagery.'],
  ['dubai-expansion', 'New districts rising around Dubai', 'Dubai, UAE', 'Coastal urban growth', 25.1, 55.3, 'moderate', 'construction', ['Radar brightness', 2.1, 'dB increase', 'upward'], 140, 'high', 'Pattern typical of new buildings', 0.45, 0.25, 'Patches of open desert are getting brighter on radar, as new buildings and roads appear.', ['New buildings and roads on open desert', 'Land reclaimed along the coast'], 'Fast growth changes water demand and how the ground behaves.', 'Confirm with high-resolution optical imagery.'],
  ['ganges-plain', 'Soil getting wetter across the Ganges plain', 'Uttar Pradesh and Bihar', 'Irrigated cropland', 26.0, 84.5, 'moderate', 'moisture', ['Soil moisture', 8, '% change', 'upward'], 2600, 'moderate', 'Seasonal rhythm included', 1.4, 0.7, 'Soil across a wide area looks wetter than in January, with a clear seasonal rhythm.', ['Monsoon rain and irrigation', 'Rising shallow water tables'], 'Wetter soil affects crop planting and flood risk.', 'Compare with rainfall and crop calendars.'],
  ['libyan-desert', 'Stable ground across the western desert', 'Western Desert', 'Open desert', 27.0, 25.5, 'stable', 'subsidence', ['Ground movement', 0.4, 'mm per year', 'steady'], 4000, 'high', 'No clear trend', 2.0, 1.0, 'The radar sees almost no movement here. That is useful: it shows the method is steady.', ['Hard, dry ground with little water', 'No major human activity'], 'Calm areas help confirm that changes elsewhere are real.', 'Keep as a reference area.'],
  ['canadian-shield', 'Stable ground across the Canadian Shield', 'Northern Ontario and Manitoba', 'Ancient bedrock', 54.5, -95.0, 'stable', 'subsidence', ['Ground movement', 0.6, 'mm per year', 'steady'], 5200, 'high', 'Slow, steady rebound', 2.2, 1.1, 'This old rock is steady. It is rising extremely slowly after the ice age.', ['Slow rebound after ice-age glaciers', 'Very little human activity'], 'A good reference area for measuring change elsewhere.', 'Keep as a reference area.'],
]
const lc = (t) => t.charAt(0).toLowerCase() + t.slice(1)
EXTRA.forEach((e, i) => {
  const [id, headline, region, subtitle, lat, lon, cls, type, [label, value, unit, direction], area, confidence, note, rx, ry, summary, causes, why, next] = e
  const endv = unit.includes('per year') ? round(value * 0.84, 2) : value
  const noise = Math.max(0.02, Math.abs(endv) * 0.04)
  stories.push({
    id, headline, region, subtitle, lat, lon, change_class: cls, change_type: type,
    metric: { label, value, unit, direction }, area_km2: area, confidence, confidence_note: note,
    summary, causes, why_it_matters: why, next_step: next,
    explanation: `Between January and October the radar measured ${label.toLowerCase()} of ${value > 0 ? '+' : ''}${value} ${unit} across about ${area} km².\n\nThis pattern is consistent with ${lc(causes[0])}, and possibly ${lc(causes[1])}. This does not prove a cause.\n\nWhy it matters: ${why}`,
    series: series((t) => endv * (0.85 * t + 0.15 * smooth(t)), 200 + i, noise),
    poly: blob(lon, lat, rx, ry, 100 + i, 28, (i % 5) * 0.25 - 0.4),
    extraIndex: i,
  })
})

const publishedOffsets = [2, 1, 0, -4, -6, -8]
const features = stories.map((s, i) => ({
  type: 'Feature',
  geometry: s.poly,
  properties: {
    id: s.id, headline: s.headline, region: s.region, subtitle: s.subtitle, lat: s.lat, lon: s.lon,
    change_class: s.change_class, change_type: s.change_type, metric: s.metric,
    period: { start: START, end: END }, passes: N, area_km2: s.area_km2,
    confidence: s.confidence, confidence_note: s.confidence_note,
    summary: s.summary, causes: s.causes, why_it_matters: s.why_it_matters, next_step: s.next_step,
    series: s.series, explanation: s.explanation, explanation_ai_generated: true,
    published: addDays(END, 2 + (publishedOffsets[i] ?? -9 - (s.extraIndex ?? 0))), is_sample: true,
  },
}))

writeFileSync(
  join(root, 'sample-stories.json'),
  JSON.stringify({ type: 'FeatureCollection', features }, null, 1),
)
console.log(`Sample stories written: ${features.length} -> ${join(root, 'sample-stories.json')}`)
console.log('Run `python -m naba_data export --samples-only` to fold them into changes.geojson.')
