import type { BurnTier, ChangeClass, ChangeStory, Confidence, Filter, Layer, WetlandClass } from './types'

export const CLASS_META: Record<ChangeClass, { label: string; chip: string; color: string; tag: 'BREAKING' | 'UPDATE' }> = {
  significant: { label: 'Significant change', chip: 'SIGNIFICANT CHANGE', color: '#F0484D', tag: 'BREAKING' },
  moderate: { label: 'Moderate change', chip: 'MODERATE CHANGE', color: '#F5B83D', tag: 'UPDATE' },
  stable: { label: 'No significant change', chip: 'NO SIGNIFICANT CHANGE', color: '#3DD68C', tag: 'UPDATE' },
  water: { label: 'Water-related story', chip: 'WATER-RELATED STORY', color: '#4AA8FF', tag: 'UPDATE' },
}

/**
 * What a story is about decides its colour everywhere (outline, pin, panel): green earthquake,
 * turquoise flooding (water rising), blue water shrinking, red forest fire. Severity is not colour-coded.
 */
export type Theme = 'earthquake' | 'flood' | 'water' | 'fire'
export const THEME_META: Record<Theme, { label: string; chip: string; color: string }> = {
  earthquake: { label: 'Earthquake', chip: 'EARTHQUAKE', color: '#3DD68C' },
  flood: { label: 'Flooding (water rising)', chip: 'FLOODING', color: '#00ced1' },
  water: { label: 'Water shrinking', chip: 'WATER SHRINKING', color: '#4AA8FF' },
  fire: { label: 'Forest fire', chip: 'FOREST FIRE', color: '#F0484D' },
}
/** Water or flooded vegetation that is increasing is flooding (turquoise); the rest is blue. */
export const themeOf = (s: Pick<ChangeStory, 'change_type'> & { metric?: { direction: string } }): Theme =>
  s.change_type === 'earthquake' ? 'earthquake' : s.change_type === 'fire' ? 'fire' : s.metric?.direction === 'upward' ? 'flood' : 'water'
/** Label, chip text and colour of a story's theme. */
export const storyMeta = (s: Pick<ChangeStory, 'change_type'> & { metric?: { direction: string } }) => THEME_META[themeOf(s)]

/**
 * Wetland classes keep the colours the analysis notebook uses for them, so a map in the app and a
 * figure from the notebook read the same way. They are deliberately not CLASS_META colours: those
 * mean "how big is the change", these mean "what is on the ground".
 */
export const WETLAND_META: Record<WetlandClass, { label: string; color: string; hint: string }> = {
  open_water: { label: 'Open water', color: '#1f4e9c', hint: 'Calm, open water: dark in the radar image' },
  flooded_vegetation: { label: 'Flooded vegetation', color: '#00ced1', hint: 'Water standing under reeds or plants: very bright in the radar image' },
}

/**
 * Burn tiers, in the same two colours the exporter uses for the burn-mask frames
 * (BURN_COLORS in naba-data/naba_data/config.py).
 */
export const FIRE_META: Record<BurnTier, { label: string; color: string; hint: string }> = {
  likely: { label: 'Likely burned', color: '#d7301f', hint: 'HV radar dropped by more than 3 dB' },
  possible: { label: 'Possibly burned', color: '#fc8d59', hint: 'HV radar dropped by 2–3 dB' },
}

/**
 * The Compare-dates layers for a story: the ones that name it, or - for layers written before
 * layers named their stories - the ones whose image covers the story's point.
 */
export function layersForStory(layers: Layer[], story: ChangeStory | undefined): Layer[] {
  if (!story) return []
  const named = layers.filter((l) => l.story_ids?.includes(story.id))
  if (named.length) return named
  return layers.filter((l) => {
    if (l.story_ids?.length) return false
    const [[w, n], [e], [, s]] = l.bounds
    return story.lon >= w && story.lon <= e && story.lat >= s && story.lat <= n
  })
}

export const CONFIDENCE_LEVEL: Record<Confidence, number> = { low: 2, moderate: 3, high: 4 }

export const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'significant', label: 'Significant' },
  { id: 'moderate', label: 'Moderate' },
  { id: 'water', label: 'Water' },
]

export const matchesFilter = (s: ChangeStory, f: Filter) => f === 'all' || s.change_class === f

const fmt = (opts: Intl.DateTimeFormatOptions) => (iso: string) =>
  new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { timeZone: 'UTC', ...opts })
export const formatDate = fmt({ day: 'numeric', month: 'short', year: 'numeric' })
export const formatDateShort = fmt({ day: 'numeric', month: 'short' })

export const formatCoords = (lat: number, lon: number) =>
  `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? 'E' : 'W'}`

export const formatValue = (v: number) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toString()

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export const EGYPT_VIEW = { center: [30.8, 26.8] as [number, number], zoom: 5 }
export const GLOBE_VIEW = { center: [30.8, 26.8] as [number, number], zoom: 2.3 }
export const DELTA_VIEW = { center: [31.1, 30.9] as [number, number], zoom: 7.4 }

/** The first image layer of a story (its own layer if it names one, else one covering it). */
export const layerFor = (layers: Layer[], s: ChangeStory | undefined): Layer | undefined =>
  layersForStory(layers, s)[0]

/** Zoom that frames a layer's image: smaller areas zoom in further. `extra` widens the view. */
export const fitZoom = (l: Layer, extra = 0): number => {
  const [[, n], , [, s]] = l.bounds
  return Math.log2(330 / Math.max(0.05, n - s)) - extra
}

const pct = (v: number) => `${v.toFixed(1)}%`
const kmFmt = (v: number) => `${v >= 100 ? Math.round(v) : v.toFixed(1)} km²`

/**
 * A plain-language account of what happened, in short paragraphs, built only from the story's own
 * numbers: what was measured, how big or sudden it was, and why radar can see it at all.
 */
export function describeStory(s: ChangeStory): string[] {
  const ser = s.series
  const first = ser[0]
  const last = ser[ser.length - 1]

  if (s.change_type === 'earthquake') {
    const mag = /magnitude\s+([\d.]+)/i.exec(s.headline)?.[1]
    const day = s.event_date ? ` on ${formatDate(s.event_date)}` : ''
    const span = /differ by about ([\d.]+) m/.exec(s.summary)?.[1]
    const fringes = /([\d.]+) colour cycles/.exec(s.summary)?.[1]
    const after = /magnitude ([\d., and]+) aftershocks/.exec(s.causes.join(' '))?.[1]
    const out = [
      `${mag ? `A magnitude ${mag} earthquake` : 'An earthquake'} struck here${day}. NISAR flew over twice, on ${formatDateShort(s.period.start)} and ${formatDateShort(s.period.end)}, so the two passes sit either side of the shock.`,
      `Putting them together shows the ground moved by up to ${s.metric.value.toFixed(1)} m along the satellite's line of sight.${span ? ` Across the map the two extremes are about ${span} m apart.` : ''}`,
      `That is a lot. Radar can pick up movements of a few centimetres${fringes ? `: each of the ${fringes} colour cycles on the picture is only about 12 cm` : ''}, so a metre or more is large. The picture covers about ${Math.round(s.area_km2).toLocaleString('en-US')} km² around the earthquake, measured from space.`,
    ]
    if (after) out.push(`Aftershocks of magnitude ${after} fell in the same 12 days, so the map shows all of them together.`)
    return out
  }

  if (s.change_type === 'fire') {
    const possible = /another ([\d.]+) km\S* is possibly burned/.exec(s.summary)?.[1]
    const peak = ser.reduce((m, p) => (p.value > m.value ? p : m), ser[0])
    const out = [
      `A fire burned part of this area. Radar picked up about ${s.metric.value} km² of ground that is likely burned${possible ? `, and another ${possible} km² that is possibly burned` : ''}, compared with ${formatDateShort(s.period.start)}, before the fire.`,
    ]
    if (peak && peak.value > 3 * s.metric.value) {
      out.push(`Later passes read much higher, up to ${kmFmt(peak.value)} on ${formatDateShort(peak.date)}. Rain and wet soil can also darken the radar signal, so ${s.metric.value} km² is the careful figure.`)
    } else if (last && last.value > 1.1 * s.metric.value) {
      out.push(`The burned area kept growing: ${kmFmt(last.value)} by ${formatDateShort(last.date)}.`)
    }
    out.push('Fire strips the leaves and branches that bounce part of the radar signal back, so burned ground goes dark. Radar sees through smoke and cloud, day or night, which a normal camera from space cannot.')
    return out
  }

  const water = s.change_type !== 'vegetation'
  const what = water ? 'under open water' : 'flooded under the plants'
  const subject = water ? 'this area' : 'the marsh here'
  const how = water
    ? 'Calm water is smooth, so it bounces the radar signal away and shows up dark.'
    : 'Water standing among plants makes a corner that sends the signal straight back, so it shows up very bright. A normal camera from space cannot see water hidden under plants.'
  if (!first || !last || ser.length < 2) return [`${pct(s.metric.value)} of the area is ${what}.`, how]

  const span = `${pct(first.value)} of the area on ${formatDateShort(first.date)} to ${pct(last.value)} on ${formatDateShort(last.date)}`
  const out: string[] = []
  if (s.metric.direction === 'upward') out.push(`More of ${subject} is ${what}. It grew from ${span}.`)
  else if (s.metric.direction === 'downward') out.push(`Less of ${subject} is ${what}. It fell from ${span}.`)
  else out.push(`The part of ${subject} that is ${what} stayed about the same, from ${span}.`)

  const hi = ser.reduce((m, p) => (p.value > m.value ? p : m), ser[0])
  const lo = ser.reduce((m, p) => (p.value < m.value ? p : m), ser[0])
  let jump = { from: ser[0], to: ser[1], d: 0 }
  for (let i = 1; i < ser.length; i++) {
    const d = Math.abs(ser[i].value - ser[i - 1].value)
    if (d > jump.d) jump = { from: ser[i - 1], to: ser[i], d }
  }
  if (Math.abs(last.value - first.value) < 1) {
    out.push(`The readings moved between ${pct(lo.value)} and ${pct(hi.value)} from pass to pass, so this net change is small and easy to mistake for normal wobble.`)
  } else {
    const hiIndex = ser.indexOf(hi)
    if (hiIndex >= 2 && hiIndex <= ser.length - 2) {
      const times = hi.value / Math.max(first.value, 0.1)
      out.push(`It peaked at ${pct(hi.value)} on ${formatDateShort(hi.date)}${times >= 1.5 ? `, about ${Math.round(times)} times the ${formatDateShort(first.date)} level` : ''}, then fell back to ${pct(last.value)}.`)
    }
    if (s.metric.direction === 'downward' && last.value < 0.6 * first.value) {
      out.push(`Only about ${Math.round((last.value / first.value) * 100)}% of the ${formatDateShort(first.date)} amount is left.`)
    }
    out.push(`The biggest single change came between ${formatDateShort(jump.from.date)} and ${formatDateShort(jump.to.date)}, when it went from ${pct(jump.from.value)} to ${pct(jump.to.value)}.`)
  }
  out.push(`NISAR looked ${s.passes} times from the same angle, so the passes can be compared. ${how}`)
  return out
}

/** One line for the headline number, e.g. '31.3 km² likely burned · 16 Aug – 15 Oct 2026'. */
export function metricLine(s: ChangeStory): string {
  const when = `${formatDateShort(s.period.start)} – ${formatDate(s.period.end)}`
  if (s.change_type === 'earthquake') return `Up to ${s.metric.value.toFixed(1)} m of ground motion · ${when}`
  return `${s.metric.value} ${s.metric.unit} · ${when}`
}
