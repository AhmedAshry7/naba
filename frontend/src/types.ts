// Data contract between the UI and any backend (static files today, FastAPI/Postgres later).
// The UI only depends on these shapes; how they are stored is the backend's business.
import type { FeatureCollection, Geometry, MultiPolygon, Polygon } from 'geojson'

export type ChangeClass = 'significant' | 'moderate' | 'stable' | 'water'
export type ChangeType = 'subsidence' | 'uplift' | 'moisture' | 'water' | 'vegetation' | 'construction' | 'fire'
export type Confidence = 'low' | 'moderate' | 'high'
export type Direction = 'upward' | 'downward' | 'steady'

export interface Metric {
  label: string
  value: number
  unit: string
  direction: Direction
}

export interface SeriesPoint {
  date: string
  value: number
}

export interface ChangeStory {
  id: string
  headline: string
  region: string
  subtitle: string
  lat: number
  lon: number
  change_class: ChangeClass
  change_type: ChangeType
  metric: Metric
  period: { start: string; end: string }
  passes: number
  area_km2: number
  confidence: Confidence
  confidence_note: string
  summary: string
  causes: string[]
  why_it_matters: string
  next_step: string
  series: SeriesPoint[]
  explanation: string
  explanation_ai_generated: boolean
  published: string
  is_sample: boolean
  /** Added by the loader from the GeoJSON feature. */
  geometry: Geometry
}

export interface Frame {
  date: string
  url: string
}

export interface Layer {
  id: string
  label: string
  /** Short name for the layer picker in Compare dates, e.g. 'False colour'. */
  short_label?: string
  /** The exporter preset that wrote this layer (absent in files written before presets merged). */
  preset?: string
  /** The stories this layer's images illustrate; absent -> matched by bounds instead. */
  story_ids?: string[]
  /** [lon, lat] corners: top-left, top-right, bottom-right, bottom-left */
  bounds: [[number, number], [number, number], [number, number], [number, number]]
  frames: Frame[]
}

export type Filter = 'all' | 'significant' | 'moderate' | 'water'

/** Wetland pixel classes that become vector extents (`naba-data` classes 1 and 2). */
export type WetlandClass = 'open_water' | 'flooded_vegetation'

/** One class's extent in one month, as measured by NISAR.
 *  A type alias (not an interface) so it satisfies GeoJsonProperties in FeatureCollection<G, P>. */
export type WetlandFeatureProps = {
  class: WetlandClass
  /** 'YYYY-MM' - the month whose acquisitions were composited. */
  month: string
  /** 'Jun 2026' - ready to show. */
  month_label: string
  area_km2: number
  /** The acquisition dates that went into this month's composite. */
  dates: string[]
}

export type WetlandData = FeatureCollection<Polygon | MultiPolygon, WetlandFeatureProps>

/** One step on a time slider: a wetland month or a burn-scar radar pass. */
export interface TimeStep {
  /** 'YYYY-MM' for a month, 'YYYY-MM-DD' for a pass: the value features are filtered on. */
  key: string
  label: string
}

/** A month on the time slider, derived from the wetland features. */
export interface MonthStep {
  month: string
  label: string
}

/** Burn tiers from the drop in cross-polarised (HV) radar after a fire (`naba-data` fires). */
export type BurnTier = 'likely' | 'possible'

/** One burn tier's extent at one radar pass, compared with the pass before the fire.
 *  A type alias, as for wetlands. */
export type FireFeatureProps = {
  preset: string
  story_id: string
  tier: BurnTier
  /** 'YYYY-MM-DD' of this radar pass - one step on the burn slider. */
  date: string
  /** '3 Oct' - ready to show. */
  date_label: string
  role: 'before' | 'during' | 'after'
  /** True on the pass the story's headline number comes from. */
  headline: boolean
  /** 'YYYY-MM-DD' of the pre-fire pass every other pass is compared with. */
  before: string
  /** Area of the drawn (vectorized) polygons, km². */
  area_km2: number
  /** Area counted pixel by pixel, km² - the number the story quotes. */
  pixel_km2: number
  /** The dB drop in HV this tier starts at (-3 likely, -2 possible). */
  threshold_db: number
}

export type FireData = FeatureCollection<Polygon | MultiPolygon, FireFeatureProps>
