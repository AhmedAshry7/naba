import { useEffect, useRef, useState } from 'react'
import maplibregl, { type GeoJSONSource } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { Feature, FeatureCollection } from 'geojson'
import { useStore } from '../store'
import { CLASS_META, DELTA_VIEW, EGYPT_VIEW, GLOBE_VIEW } from '../lib'

export const BASEMAP = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'

const colorExpr: maplibregl.ExpressionSpecification = [
  'match',
  ['get', 'change_class'],
  'significant', CLASS_META.significant.color,
  'moderate', CLASS_META.moderate.color,
  'stable', CLASS_META.stable.color,
  'water', CLASS_META.water.color,
  '#93A3C0',
]

const isDesktop = () => window.innerWidth >= 1024

function cameraPadding(el: HTMLElement): maplibregl.PaddingOptions {
  // keep the focused zone clear of the story panel (right on desktop, bottom sheet on mobile)
  return isDesktop()
    ? { top: 20, bottom: 40, left: 20, right: 480 }
    : { top: 20, bottom: Math.round(el.clientHeight * 0.55), left: 10, right: 10 }
}

export default function MapView() {
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markerRef = useRef<maplibregl.Marker | null>(null)
  const hoverId = useRef<string | null>(null)
  const [ready, setReady] = useState(false)

  const stories = useStore((s) => s.stories)
  const selectedId = useStore((s) => s.selectedId)
  const camera = useStore((s) => s.camera)
  const projection = useStore((s) => s.projection)

  // ---- create the map once ----
  useEffect(() => {
    if (!container.current) return
    const map = new maplibregl.Map({
      container: container.current,
      style: BASEMAP,
      center: GLOBE_VIEW.center,
      zoom: isDesktop() ? GLOBE_VIEW.zoom : GLOBE_VIEW.zoom - 0.7,
      attributionControl: false,
      minZoom: 0.6,
      maxPitch: 60,
    })
    mapRef.current = map
    if (import.meta.env.DEV) (window as unknown as { __map: maplibregl.Map }).__map = map
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left')
    map.addControl(new maplibregl.AttributionControl({ compact: false }), 'bottom-right')

    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12 })

    map.once('style.load', () => {
      // real sphere, with a blue atmosphere; recolour the basemap towards the blue-black theme
      map.setProjection({ type: 'globe' })
      map.setSky({
        'sky-color': '#0B4BAA',
        'horizon-color': '#1B5FD1',
        'fog-color': '#050B18',
        'sky-horizon-blend': 0.6,
        'horizon-fog-blend': 0.6,
        'fog-ground-blend': 0.2,
        'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 5, 1, 7, 0],
      })
      const tint = (id: string, prop: string, color: string) => {
        if (map.getLayer(id)) map.setPaintProperty(id, prop, color)
      }
      tint('background', 'background-color', '#050C1C')
      tint('water', 'fill-color', '#0A2A5E')
      map.addSource('changes', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, promoteId: 'id' })
      map.addLayer({
        id: 'zones-fill',
        type: 'fill',
        source: 'changes',
        paint: {
          'fill-color': colorExpr,
          'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.82, 0.55],
        },
      })
      map.setPaintProperty('zones-fill', 'fill-opacity-transition', { duration: 150 })
      map.addLayer({
        id: 'zones-line',
        type: 'line',
        source: 'changes',
        paint: { 'line-color': colorExpr, 'line-width': 1.2, 'line-opacity': 0.95 },
      })
      map.addLayer({
        id: 'zones-selected',
        type: 'line',
        source: 'changes',
        filter: ['==', ['get', 'id'], ''],
        paint: { 'line-color': '#ffffff', 'line-width': 3 },
      })

      // glowing dots so every story is visible when the whole planet is in view (fade out as polygons grow)
      map.addSource('changes-pts', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      const fade: maplibregl.ExpressionSpecification = ['interpolate', ['linear'], ['zoom'], 3.5, 1, 6.5, 0]
      map.addLayer({
        id: 'zones-glow',
        type: 'circle',
        source: 'changes-pts',
        paint: { 'circle-color': colorExpr, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 0, 9, 5, 22], 'circle-blur': 1, 'circle-opacity': ['interpolate', ['linear'], ['zoom'], 3.5, 0.55, 6.5, 0] },
      })
      map.addLayer({
        id: 'zones-dots',
        type: 'circle',
        source: 'changes-pts',
        paint: {
          'circle-color': colorExpr,
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 0, 3.5, 5, 7],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 1.3,
          'circle-opacity': fade,
          'circle-stroke-opacity': fade,
        },
      })
      map.on('mouseenter', 'zones-dots', (e) => {
        map.getCanvas().style.cursor = 'pointer'
        const f = e.features?.[0]
        if (f) popup.setLngLat((f.geometry as GeoJSON.Point).coordinates as [number, number]).setText(f.properties?.headline as string).addTo(map)
      })
      map.on('mouseleave', 'zones-dots', () => {
        map.getCanvas().style.cursor = ''
        popup.remove()
      })
      map.on('click', 'zones-dots', (e) => {
        const id = e.features?.[0]?.properties?.id as string | undefined
        if (id) useStore.getState().select(id)
      })

      map.on('mousemove', 'zones-fill', (e) => {
        const f = e.features?.[0]
        if (!f) return
        map.getCanvas().style.cursor = 'pointer'
        const id = f.properties?.id as string
        if (hoverId.current !== id) {
          if (hoverId.current) map.setFeatureState({ source: 'changes', id: hoverId.current }, { hover: false })
          hoverId.current = id
          map.setFeatureState({ source: 'changes', id }, { hover: true })
        }
        popup.setLngLat(e.lngLat).setText(f.properties?.headline as string).addTo(map)
      })
      map.on('mouseleave', 'zones-fill', () => {
        map.getCanvas().style.cursor = ''
        if (hoverId.current) map.setFeatureState({ source: 'changes', id: hoverId.current }, { hover: false })
        hoverId.current = null
        popup.remove()
      })
      map.on('click', 'zones-fill', (e) => {
        const id = e.features?.[0]?.properties?.id as string | undefined
        if (id) useStore.getState().select(id)
      })
      setReady(true)
    })

    const ro = new ResizeObserver(() => map.resize())
    ro.observe(container.current)
    return () => {
      ro.disconnect()
      popup.remove()
      markerRef.current?.remove()
      map.remove()
      mapRef.current = null
    }
  }, [])

  // ---- zones data ----
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    const fc: FeatureCollection = {
      type: 'FeatureCollection',
      features: stories.map<Feature>((s) => ({
        type: 'Feature',
        geometry: s.geometry,
        properties: { id: s.id, headline: s.headline, change_class: s.change_class },
      })),
    }
    ;(map.getSource('changes') as GeoJSONSource).setData(fc)
    ;(map.getSource('changes-pts') as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: stories.map<Feature>((s) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
        properties: { id: s.id, headline: s.headline, change_class: s.change_class },
      })),
    })
  }, [ready, stories])

  // ---- globe <-> flat map ----
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    map.setProjection({ type: projection })
    if (projection === 'mercator' && map.getZoom() < 1.8) map.easeTo({ zoom: 1.8, duration: 800 })
  }, [ready, projection])

  // ---- selection: highlight, pulse marker, fly ----
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    map.setFilter('zones-selected', ['==', ['get', 'id'], selectedId ?? ''])
    const story = stories.find((s) => s.id === selectedId)
    markerRef.current?.remove()
    markerRef.current = null
    if (!story) return
    const el = document.createElement('div')
    el.className = 'naba-pulse'
    el.style.setProperty('--pulse', CLASS_META[story.change_class].color)
    markerRef.current = new maplibregl.Marker({ element: el }).setLngLat([story.lon, story.lat]).addTo(map)
    map.flyTo({
      center: [story.lon, story.lat],
      // bigger zones need a wider view
      zoom: story.area_km2 > 2000 ? 4.6 : story.area_km2 > 800 ? 5.6 : story.area_km2 > 200 ? 7.4 : 8.8,
      duration: 1500,
      essential: true,
      padding: cameraPadding(map.getContainer()),
    })
  }, [ready, selectedId, stories])

  // ---- camera commands (demo mode / reset) ----
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || !camera) return
    const v = camera.target === 'delta' ? DELTA_VIEW : camera.target === 'egypt' ? EGYPT_VIEW : GLOBE_VIEW
    const mobileShift = isDesktop() ? 0 : camera.target === 'globe' ? 0.7 : 0.8
    map.flyTo({
      center: v.center,
      zoom: v.zoom - mobileShift,
      duration: 1500,
      essential: true,
      padding: { top: 0, bottom: 0, left: 0, right: 0 },
    })
  }, [ready, camera])

  return <div ref={container} className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,#07122A_0%,#02050C_70%)]" role="application" aria-label="Interactive globe showing detected surface changes" />
}
