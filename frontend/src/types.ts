// Data contract between the UI and any backend (static files today, FastAPI/Postgres later).
// The UI only depends on these shapes; how they are stored is the backend's business.
import type { FeatureCollection, Geometry, MultiPolygon, Polygon } from 'geojson'

export type ChangeClass = 'significant' | 'moderate' | 'stable' | 'water'
export type ChangeType = 'subsidence' | 'uplift' | 'moisture' | 'water' | 'vegetation' | 'construction'
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

/** A month on the time slider, derived from the wetland features. */
export interface MonthStep {
  month: string
  label: string
}
