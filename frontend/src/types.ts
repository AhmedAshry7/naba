// Data contract between the UI and any backend (static files today, FastAPI/Postgres later).
// The UI only depends on these shapes; how they are stored is the backend's business.
import type { Geometry } from 'geojson'

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
