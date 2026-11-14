// The ONLY place the UI talks to a data source.
// - VITE_API_URL unset -> static files in /public/data (always works, used for the demo).
// - VITE_API_URL set   -> GET {API}/changes (GeoJSON FeatureCollection), GET {API}/layers
//                         (layers.json shape), GET {API}/wetlands (wetlands.geojson shape) and
//                         GET {API}/fires (fires.geojson shape).
// Swapping the backend (e.g. FastAPI + PostGIS) means serving the same four shapes; no component changes.
import type { Feature, FeatureCollection } from 'geojson'
import type { ChangeStory, FireData, Layer, WetlandData } from '../types'

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

/** Wetland extents are optional: if missing, the globe simply has no wetland layer or slider. */
export async function loadWetlands(): Promise<WetlandData | null> {
  try {
    const fc = await getJson<WetlandData>(url('/wetlands', '/data/wetlands.geojson'))
    if (fc?.type !== 'FeatureCollection' || !Array.isArray(fc.features)) return null
    const features = fc.features.filter((f) => f.geometry && f.properties?.class && f.properties?.month)
    return features.length ? { ...fc, features } : null
  } catch {
    return null
  }
}

/** Burn-scar extents are optional too: if missing, the globe simply has no burn layer. */
export async function loadFires(): Promise<FireData | null> {
  try {
    const fc = await getJson<FireData>(url('/fires', '/data/fires.geojson'))
    if (fc?.type !== 'FeatureCollection' || !Array.isArray(fc.features)) return null
    const features = fc.features.filter((f) => f.geometry && f.properties?.tier)
    return features.length ? { ...fc, features } : null
  } catch {
    return null
  }
}

/** Layers are optional: if missing, the app runs without the Compare-dates images. */
export async function loadLayers(): Promise<Layer[]> {
  try {
    const data = await getJson<{ layers: Layer[] }>(url('/layers', '/data/layers.json'))
    return (data.layers ?? []).filter((l) => l.frames?.length)
  } catch {
    return []
  }
}
