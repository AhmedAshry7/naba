import { useState } from 'react'
import { THEME_META, type Theme } from '../lib'

// A small guide to the outline and pin colours: what kind of story each one is.
const ORDER: Theme[] = ['earthquake', 'flood', 'water', 'fire']

export default function Legend() {
  const [open, setOpen] = useState(() => window.innerWidth >= 640)
  return (
    <div className="absolute bottom-8 left-3 z-10 w-[220px] rounded-card border border-line bg-bg/90 shadow-card backdrop-blur">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
        aria-expanded={open}
        aria-controls="legend-body"
      >
        <span className="section-label">Guide</span>
      </button>
      {open && (
        <ul id="legend-body" className="space-y-2 border-t border-line px-3 pb-3 pt-2.5">
          {ORDER.map((t) => (
            <li key={t} className="flex items-center gap-2.5 text-[13px]">
              <span
                className="h-3.5 w-3.5 shrink-0 rounded-[4px] border border-white/90"
                style={{ background: THEME_META[t].color, boxShadow: `0 0 0 2px ${THEME_META[t].color}88` }}
                aria-hidden
              />
              {THEME_META[t].label}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
