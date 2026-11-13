import { useEffect } from 'react'
import { Clock, Pause, Play } from 'lucide-react'
import { useStore } from '../store'
import { formatDate, formatDateShort, prefersReducedMotion } from '../lib'

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
  // The slider only drives the wetland layer; a single event such as an earthquake has no months.
  const quake = useStore((s) => s.stories.find((x) => x.id === s.selectedId && x.change_type === 'earthquake'))
  const quakeStep = useStore((s) => s.quakeStep)
  const setQuakeStep = useStore((s) => s.setQuakeStep)
  const isOneOff = !!quake

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
        {quake && (
          <div className="mb-3 border-b border-line pb-3">
            <div className="mb-1 flex items-baseline gap-2">
              <span className="section-label !text-[11px]">Earthquake · before and after</span>
              <span className="ml-auto font-display text-[17px] font-semibold tabular-nums text-gold">
                {formatDate(quakeStep >= 1 ? quake.period.end : quake.period.start)}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={1}
              value={quakeStep}
              onChange={(e) => setQuakeStep(Number(e.target.value))}
              className="naba-months w-full"
              aria-label="Radar pass date: before or after the earthquake"
              aria-valuetext={quakeStep >= 1 ? 'After the earthquake' : 'Before the earthquake'}
            />
            <div className="mt-0.5 flex justify-between text-[11px] text-sub">
              <span>{formatDateShort(quake.period.start)} · before</span>
              {quake.event_date && <span className="font-semibold text-text">{formatDateShort(quake.event_date)} · earthquake</span>}
              <span>{formatDateShort(quake.period.end)} · after</span>
            </div>
            <p className="mt-1.5 text-[12px] leading-snug text-sub">
              {quakeStep >= 1
                ? 'The ground moved suddenly during the earthquake. Blue and red show how far, in opposite directions.'
                : 'First radar pass: nothing has moved yet. Slide right to the second pass.'}
            </p>
          </div>
        )}
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
          {isOneOff ? (
            <>
              <span className="font-semibold text-text">The month slider does not change the earthquake.</span> It only
              steps through the Lake Manzala wetlands. The earthquake happened in one moment, so use the
              before / after slider above.
            </>
          ) : (
            'The filled areas show what NISAR measured in that month (several radar passes combined). Data: NASA–ISRO NISAR.'
          )}
        </p>
      </div>
    </div>
  )
}
