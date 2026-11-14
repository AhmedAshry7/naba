import { useState } from 'react'
import { ChevronDown, Layers } from 'lucide-react'
import { CLASS_META, FIRE_META, WETLAND_META } from '../lib'
import { useStore } from '../store'
import type { BurnTier, ChangeClass, WetlandClass } from '../types'

const ORDER: ChangeClass[] = ['significant', 'moderate', 'stable', 'water']
const WETLAND_ORDER: WetlandClass[] = ['open_water', 'flooded_vegetation']
const FIRE_ORDER: BurnTier[] = ['likely', 'possible']

export default function Legend() {
  const [open, setOpen] = useState(() => window.innerWidth >= 640)
  const hasWetlands = useStore((s) => s.months.length > 0)
  const wetlands = useStore((s) => s.wetlands)
  const present = new Set<string>(wetlands?.features.map((f) => f.properties.class) ?? [])
  const hasFires = useStore((s) => !!s.fires)
  return (
    <div className="absolute bottom-8 left-3 z-10 w-[230px] rounded-card border border-line bg-bg/90 shadow-card backdrop-blur">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
        aria-expanded={open}
        aria-controls="legend-body"
      >
        <Layers size={14} className="text-sub" aria-hidden />
        <span className="section-label">Legend</span>
        <ChevronDown size={14} className={`ml-auto text-sub transition-transform ${open ? '' : '-rotate-90'}`} aria-hidden />
      </button>
      {open && (
        <div id="legend-body" className="border-t border-line px-3 pb-3 pt-2.5">
          <ul className="space-y-2">
            {ORDER.map((c) => (
              <li key={c} className="flex items-center gap-2.5 text-[13px]">
                <span className="h-3.5 w-3.5 shrink-0 rounded-[4px]" style={{ background: CLASS_META[c].color, opacity: 0.9 }} aria-hidden />
                {CLASS_META[c].label}
              </li>
            ))}
          </ul>
          <p className="mt-3 border-t border-line pt-2 text-[12px] leading-snug text-sub">
            Outline colour = the kind of story (how big the change is). It does not say what is on the ground.
          </p>

          {hasWetlands && (
            <div className="mt-3 border-t border-line pt-2.5">
              <span className="section-label !text-[11px]">What the radar measured (filled areas)</span>
              <ul className="mt-2 space-y-2">
                {WETLAND_ORDER.map((c) => (
                  <li key={c} className="flex items-center gap-2.5 text-[13px]">
                    <span className="h-3.5 w-3.5 shrink-0 rounded-[4px]" style={{ background: WETLAND_META[c].color }} aria-hidden />
                    <span>
                      {WETLAND_META[c].label}
                      <span className="block text-[11px] leading-tight text-sub">
                        {present.has(c) ? WETLAND_META[c].hint : 'None found in this data'}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[12px] leading-snug text-sub">Each pixel is one or the other, never both. Based on radar brightness: an estimate, not a verified flood map.</p>
            </div>
          )}

          {hasFires && (
            <div className="mt-3 border-t border-line pt-2.5">
              <span className="section-label !text-[11px]">Burn scar</span>
              <ul className="mt-2 space-y-2">
                {FIRE_ORDER.map((t) => (
                  <li key={t} className="flex items-center gap-2.5 text-[13px]">
                    <span className="h-3.5 w-3.5 shrink-0 rounded-[4px]" style={{ background: FIRE_META[t].color }} aria-hidden />
                    {FIRE_META[t].label}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[12px] leading-snug text-sub">Drop in HV radar after the fire, exploratory thresholds</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
