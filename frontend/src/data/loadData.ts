// The ONLY place the UI talks to a data source.
// - VITE_API_URL unset -> static files in /public/data (always works, used for the demo).
// - VITE_API_URL set   -> GET {API}/changes (GeoJSON FeatureCollection) and GET {API}/layers (layers.json shape).
// Swapping the backend (e.g. FastAPI + PostGIS) means serving the same two shapes; no component changes.
import type { Feature, FeatureCollection } from 'geojson'
import type { ChangeStory, Layer } from '../types'

const API = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '')
const url = (apiPath: string, staticPath: string) => (API ? `${API}${apiPath}` : staticPath)

async function getJson<T>(u: string): Promise<T> {
  const res = await fetch(u, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`${u} -> ${res.status}`)
  return res.json() as Promise<T>
}

export async function loadStories(): Promise<ChangeStory[]> {
  const fc = await getJson<FeatureCollection>(url('/changes', '/data/changes.geojson'))
  if (fc?.type !== 'FeatureCollection' || !Array.isArray(fc.features)) throw new Error('changes: not a FeatureCollection')
  return fc.features
    .filter((f: Feature) => f.geometry && f.properties?.id && f.properties?.headline)
    .map((f: Feature) => ({ ...(f.properties as Omit<ChangeStory, 'geometry'>), geometry: f.geometry }))
}

/** Layers are optional: if missing, the app runs without the Time Machine. */
export async function loadLayers(): Promise<Layer[]> {
  try {
    const data = await getJson<{ layers: Layer[] }>(url('/layers', '/data/layers.json'))
    return (data.layers ?? []).filter((l) => l.frames?.length)
  } catch {
    return []
  }
}
