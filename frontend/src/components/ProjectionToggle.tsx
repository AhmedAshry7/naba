import { Globe2, Map as MapIcon } from 'lucide-react'
import { useStore } from '../store'

/** Switch between the 3D globe and the flat (Mercator) map. */
export default function ProjectionToggle() {
  const projection = useStore((s) => s.projection)
  const set = useStore((s) => s.set)
  const item = (value: 'globe' | 'mercator', label: string, Icon: typeof Globe2) => {
    const active = projection === value
    return (
      <button
        onClick={() => set({ projection: value })}
        aria-pressed={active}
        className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-[14px] font-semibold transition-colors duration-150 ${
          active ? 'bg-brand-blue text-white shadow-card' : 'text-sub hover:text-text'
        }`}
      >
        <Icon size={16} aria-hidden /> {label}
      </button>
    )
  }
  return (
    <div
      role="group"
      aria-label="Map view"
      className="absolute left-1/2 top-3 z-10 flex -translate-x-1/2 gap-1 rounded-full border border-line bg-bg/90 p-1 shadow-card backdrop-blur"
    >
      {item('globe', 'Globe', Globe2)}
      {item('mercator', 'Flat map', MapIcon)}
    </div>
  )
}
