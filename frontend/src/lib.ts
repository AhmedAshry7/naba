import type { ChangeClass, ChangeStory, Confidence, Filter, Layer, WetlandClass } from './types'

export const CLASS_META: Record<ChangeClass, { label: string; chip: string; color: string; tag: 'BREAKING' | 'UPDATE' }> = {
  significant: { label: 'Significant change', chip: 'SIGNIFICANT CHANGE', color: '#F0484D', tag: 'BREAKING' },
  moderate: { label: 'Moderate change', chip: 'MODERATE CHANGE', color: '#F5B83D', tag: 'UPDATE' },
  stable: { label: 'No significant change', chip: 'NO SIGNIFICANT CHANGE', color: '#3DD68C', tag: 'UPDATE' },
  water: { label: 'Water-related story', chip: 'WATER-RELATED STORY', color: '#4AA8FF', tag: 'UPDATE' },
}

/**
 * Wetland classes keep the colours the analysis notebook uses for them, so a map in the app and a
 * figure from the notebook read the same way. They are deliberately not CLASS_META colours: those
 * mean "how big is the change", these mean "what is on the ground".
 */
export const WETLAND_META: Record<WetlandClass, { label: string; color: string; hint: string }> = {
  open_water: { label: 'Open water', color: '#1f4e9c', hint: 'Calm, open water: dark in the radar image' },
  flooded_vegetation: { label: 'Flooded vegetation', color: '#e7298a', hint: 'Water standing under reeds or plants: very bright in the radar image' },
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

const covers = (l: Layer, s: ChangeStory) => {
  const [[w, n], [e], [, so]] = l.bounds
  return s.lon >= w && s.lon <= e && s.lat >= so && s.lat <= n
}

/** The image layer that belongs to this story: its own layer if it has one, else one covering it. */
export const layerFor = (layers: Layer[], s: ChangeStory | undefined): Layer | undefined =>
  !s ? undefined : layers.find((l) => l.story_id === s.id) ?? layers.find((l) => !l.story_id && covers(l, s))
