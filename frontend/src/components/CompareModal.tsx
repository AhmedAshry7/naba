import { useEffect, useMemo, useRef, useState } from 'react'
import maplibregl, { type ImageSource } from 'maplibre-gl'
import { Columns2, X } from 'lucide-react'
import { useStore } from '../store'
import { CLASS_META, formatDate, layersForStory } from '../lib'
import type { Layer } from '../types'
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
          <option key={f.date} value={i}>
            {formatDate(f.date)}
          </option>
        ))}
      </select>
    </label>
  )
}

export default function CompareModal() {
  const open = useStore((s) => s.compareOpen)
  const layers = useStore((s) => s.layers)
  const story = useStore((s) => s.stories.find((x) => x.id === s.selectedId))
  const set = useStore((s) => s.set)
  // a story can have several image layers (e.g. a fire: false colour and burn mask)
  const storyLayers = useMemo(() => layersForStory(layers, story), [layers, story])
  const [li, setLi] = useState(0)
  const layer = storyLayers[li] ?? storyLayers[0]
  const [a, setA] = useState(0)
  const [b, setB] = useState(0)
  const [pos, setPos] = useState(50)

  useEffect(() => {
    if (open) {
      setLi(0)
      setPos(50)
    }
  }, [open, story?.id])

  useEffect(() => {
    if (open && layer) {
      setA(0)
      setB(layer.frames.length - 1)
    }
  }, [open, layer])

  if (!open || !story) return null
  const covered = !!layer
  const meta = CLASS_META[story.change_class]
  // clamp: for one render after switching layers the indices can still point past the new frames
  const last = layer ? layer.frames.length - 1 : 0
  const ia = Math.min(a, last)
  const ib = Math.min(b, last)
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
            Compare dates · <span className="text-sub">{story.region}</span>
          </h2>
          <button onClick={close} className="ml-auto rounded-card p-2 text-sub hover:bg-card hover:text-text" aria-label="Close comparison">
            <X size={20} aria-hidden />
          </button>
        </div>

        {!covered ? (
          <p className="px-6 py-12 text-center text-[15px] text-sub">The change images don't cover this area yet, so there is nothing to compare here.</p>
        ) : (
          <>
            {storyLayers.length > 1 && (
              <div className="flex px-5 pt-3" role="radiogroup" aria-label="Image type">
                <div className="inline-flex rounded-card border border-line bg-card p-0.5">
                  {storyLayers.map((l, i) => (
                    <button
                      key={l.id}
                      role="radio"
                      aria-checked={i === li}
                      onClick={() => setLi(i)}
                      title={l.label}
                      className={`rounded-[6px] px-3 py-1 text-[13px] font-semibold transition-colors ${i === li ? 'bg-gold text-bg' : 'text-sub hover:text-text'}`}
                    >
                      {l.short_label ?? l.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
              <DateSelect id="cmp-a" label="Before" value={ia} onChange={setA} layer={layer} />
              <DateSelect id="cmp-b" label="After" value={ib} onChange={setB} layer={layer} />
            </div>
            <div className="relative mx-5 aspect-[16/9] min-h-[240px] overflow-hidden rounded-card border border-line bg-card">
              <MiniMap center={[story.lon, story.lat]} zoom={8.4} layer={layer} url={layer.frames[ia].url} geometry={story.geometry} color={meta.color} />
              <div className="absolute inset-0" style={{ clipPath: `inset(0 0 0 ${pos}%)` }}>
                <MiniMap center={[story.lon, story.lat]} zoom={8.4} layer={layer} url={layer.frames[ib].url} geometry={story.geometry} color={meta.color} />
              </div>
              <span className="absolute left-3 top-3 rounded-full bg-bg/85 px-3 py-1 text-[12px] font-semibold">Before · {formatDate(layer.frames[ia].date)}</span>
              <span className="absolute right-3 top-3 rounded-full bg-bg/85 px-3 py-1 text-[12px] font-semibold">After · {formatDate(layer.frames[ib].date)}</span>
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
                aria-label="Drag to compare before and after"
              />
            </div>
            <p className="px-5 pb-4 pt-3 text-[12px] text-sub">
              {layer.label} · from NASA–ISRO NISAR radar{story.is_sample ? ' · sample images for preview' : ''}. Drag the handle to swipe between the two dates.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
