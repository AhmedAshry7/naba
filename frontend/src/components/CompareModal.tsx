import { useEffect, useRef, useState } from 'react'
import maplibregl, { type ImageSource } from 'maplibre-gl'
import { Columns2, X } from 'lucide-react'
import { useStore } from '../store'
import { CLASS_META, formatDate, layerFor } from '../lib'
import type { Frame, Layer } from '../types'
import { BASEMAP } from './MapView'

/** A static (non-interactive) map showing one change frame, used for the before/after swipe. */
function MiniMap({ center, zoom, layer, url, geometry, color }: { center: [number, number]; zoom: number; layer: Layer; url: string; geometry: GeoJSON.Geometry; color: string }) {
  const el = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const urlRef = useRef(url)
  urlRef.current = url

  useEffect(() => {
    const map = new maplibregl.Map({ container: el.current!, style: BASEMAP, center, zoom, interactive: false, attributionControl: false, fadeDuration: 0 })
    mapRef.current = map
    map.on('load', () => {
      map.addSource('frame', { type: 'image', url: urlRef.current, coordinates: layer.bounds })
      map.addLayer({ id: 'frame', type: 'raster', source: 'frame', paint: { 'raster-opacity': 0.8, 'raster-fade-duration': 0 } })
      map.addSource('zone', { type: 'geojson', data: { type: 'Feature', geometry, properties: {} } })
      map.addLayer({ id: 'zone', type: 'line', source: 'zone', paint: { 'line-color': color, 'line-width': 2.5 } })
    })
    return () => map.remove()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const src = mapRef.current?.getSource('frame') as ImageSource | undefined
    src?.updateImage({ url, coordinates: layer.bounds })
  }, [url, layer])

  return <div ref={el} className="absolute inset-0" />
}

const frameName = (f: Frame) => f.label ?? formatDate(f.date)

function DateSelect({ id, label, value, onChange, layer }: { id: string; label: string; value: number; onChange: (n: number) => void; layer: Layer }) {
  return (
    <label htmlFor={id} className="flex items-center gap-2 text-[13px] text-sub">
      <span className="section-label">{label}</span>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="rounded-card border border-line bg-card px-3 py-1.5 text-[14px] text-text"
      >
        {layer.frames.map((f, i) => (
          <option key={`${f.date}-${i}`} value={i}>
            {frameName(f)}
          </option>
        ))}
      </select>
    </label>
  )
}

export default function CompareModal() {
  const open = useStore((s) => s.compareOpen)
  const story = useStore((s) => s.stories.find((x) => x.id === s.selectedId))
  const layer = useStore((s) => layerFor(s.layers, story))
  const set = useStore((s) => s.set)
  const [a, setA] = useState(0)
  const [b, setB] = useState(0)
  const [pos, setPos] = useState(50)

  useEffect(() => {
    if (open && layer) {
      setA(0)
      setB(layer.frames.length - 1)
      setPos(50)
    }
  }, [open, layer])

  if (!open || !layer || !story) return null
  const [[w, n], [e], [, s]] = layer.bounds
  const covered = story.lon >= w && story.lon <= e && story.lat >= s && story.lat <= n
  const meta = CLASS_META[story.change_class]
  const views = layer.kind === 'views'
  const center: [number, number] = views ? [(w + e) / 2, (n + s) / 2] : [story.lon, story.lat]
  const zoom = views ? 8.9 : 8.4
  const [first, second] = views ? ['Left', 'Right'] : ['Before', 'After']
  const close = () => set({ compareOpen: false })

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-3 animate-fadeIn" onClick={close}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="cmp-title"
        onClick={(ev) => ev.stopPropagation()}
        className="flex max-h-[94vh] w-full max-w-[1000px] flex-col rounded-panel border border-line bg-bg shadow-panel animate-rise"
      >
        <div className="flex items-center gap-3 border-b border-line px-5 py-3.5">
          <Columns2 size={18} className="text-gold" aria-hidden />
          <h2 id="cmp-title" className="font-display text-[20px] font-semibold">
            {views ? 'Ground motion' : 'Compare dates'} · <span className="text-sub">{story.region}</span>
          </h2>
          <button onClick={close} className="ml-auto rounded-card p-2 text-sub hover:bg-card hover:text-text" aria-label="Close comparison">
            <X size={20} aria-hidden />
          </button>
        </div>

        {!covered ? (
          <p className="px-6 py-12 text-center text-[15px] text-sub">The change images don't cover this area yet, so there is nothing to compare here.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
              <DateSelect id="cmp-a" label={first} value={a} onChange={setA} layer={layer} />
              <DateSelect id="cmp-b" label={second} value={b} onChange={setB} layer={layer} />
            </div>
            <div className="relative mx-5 aspect-[16/9] min-h-[240px] overflow-hidden rounded-card border border-line bg-card">
              <MiniMap center={center} zoom={zoom} layer={layer} url={layer.frames[a].url} geometry={story.geometry} color={meta.color} />
              <div className="absolute inset-0" style={{ clipPath: `inset(0 0 0 ${pos}%)` }}>
                <MiniMap center={center} zoom={zoom} layer={layer} url={layer.frames[b].url} geometry={story.geometry} color={meta.color} />
              </div>
              <span className="absolute left-3 top-3 rounded-full bg-bg/85 px-3 py-1 text-[12px] font-semibold">{first} · {frameName(layer.frames[a])}</span>
              <span className="absolute right-3 top-3 rounded-full bg-bg/85 px-3 py-1 text-[12px] font-semibold">{second} · {frameName(layer.frames[b])}</span>
              <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow-[0_0_12px_rgba(0,0,0,.6)]" style={{ left: `${pos}%` }}>
                <span className="absolute left-1/2 top-1/2 flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white bg-bg text-[13px] font-bold">⇆</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={pos}
                onChange={(ev) => setPos(Number(ev.target.value))}
                className="naba-swipe absolute inset-0 h-full w-full opacity-100"
                aria-label={views ? 'Drag to swipe between the two views' : 'Drag to compare before and after'}
              />
            </div>
            <p className="px-5 pb-4 pt-3 text-[12px] text-sub">
              {views
                ? 'Ground motion from a NASA–ISRO NISAR radar interferogram (two passes 12 days apart). Drag the handle to swipe between the motion map and the raw radar fringes. Blue and red are opposite directions of motion along the satellite’s line of sight.'
                : <>Change maps from NASA–ISRO NISAR radar{story.is_sample ? ' · sample images for preview' : ''}. Drag the handle to swipe between the two dates.</>}
            </p>
          </>
        )}
      </div>
    </div>
  )
}
