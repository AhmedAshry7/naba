import { useEffect } from 'react'
import { Clock, Pause, Play } from 'lucide-react'
import { useStore } from '../store'
import { prefersReducedMotion } from '../lib'

const STEP_MS = 1200
const STEP_MS_REDUCED = 2200   // the user asked for motion, so still play - just slower

/**
 * The month control for the measured wetland layer on the globe: NISAR passes about every 12 days,
 * so each step is one month of acquisitions composited together. Hidden when the dataset has no
 * time-stepped layer (then the globe is just the story polygons).
 */
export default function TimeSlider() {
  const months = useStore((s) => s.months)
  const monthIndex = useStore((s) => s.monthIndex)
  const isPlaying = useStore((s) => s.isPlaying)
  const setMonth = useStore((s) => s.setMonth)
  const setPlaying = useStore((s) => s.setPlaying)
  const selectedId = useStore((s) => s.selectedId)

  // advance while playing, wrapping back to the first month
  useEffect(() => {
    if (!isPlaying || months.length < 2) return
    const id = setInterval(
      () => {
        const { monthIndex: i, months: m } = useStore.getState()
        useStore.getState().setMonth((i + 1) % m.length)
      },
      prefersReducedMotion() ? STEP_MS_REDUCED : STEP_MS,
    )
    return () => clearInterval(id)
  }, [isPlaying, months.length])

  useEffect(() => {
    if (months.length < 2 && isPlaying) setPlaying(false)
  }, [months.length, isPlaying, setPlaying])

  if (months.length < 2) return null
  const active = months[monthIndex] ?? months[months.length - 1]
  const last = months.length - 1

  return (
    <div
      className={`absolute bottom-3 left-3 right-3 z-10 flex justify-center lg:bottom-8 lg:left-[252px] ${
        // centred on the globe; moves left only while the story panel (right side) is open
        selectedId ? 'max-lg:hidden lg:right-[470px]' : 'lg:right-[252px]'
      }`}
    >
      <div className="w-full max-w-[560px] rounded-card border border-line bg-bg/90 px-4 py-3 shadow-card backdrop-blur">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setPlaying(!isPlaying)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-blue text-white transition-colors hover:bg-[#0A3F8F]"
            aria-label={isPlaying ? 'Pause the months' : 'Play through the months'}
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? <Pause size={16} aria-hidden /> : <Play size={16} aria-hidden />}
          </button>

          <div className="min-w-0 flex-1">
            <div className="mb-1 flex items-baseline gap-2">
              <Clock size={13} className="shrink-0 text-sub" aria-hidden />
              <span className="section-label !text-[11px]">Month shown on the map</span>
              <span className="ml-auto font-display text-[17px] font-semibold tabular-nums text-gold">{active.label}</span>
            </div>
            <input
              id="month-slider"
              type="range"
              min={0}
              max={last}
              step={1}
              value={Math.min(monthIndex, last)}
              onChange={(e) => {
                setPlaying(false)
                setMonth(Number(e.target.value))
              }}
              className="naba-months w-full"
              aria-label="Month shown on the globe"
              aria-valuetext={active.label}
            />
            <div className="mt-0.5 flex justify-between text-[11px] text-sub">
              <span>{months[0].label}</span>
              <span>{months[last].label}</span>
            </div>
          </div>
        </div>
        <p className="mt-2 border-t border-line pt-2 text-[11px] leading-snug text-sub">
          The filled areas show what NISAR measured in that month (several radar passes combined). Data: NASA–ISRO NISAR.
        </p>
      </div>
    </div>
  )
}
