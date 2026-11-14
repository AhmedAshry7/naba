import { useEffect } from 'react'
import { Clock, Flame, Pause, Play } from 'lucide-react'
import { useStore } from '../store'
import { formatDate, formatDateShort, prefersReducedMotion } from '../lib'
import type { TimeStep } from '../types'

const STEP_MS = 1200
const STEP_MS_REDUCED = 2200   // the user asked for motion, so still play - just slower

interface SliderProps {
  id: string
  title: string
  icon: 'clock' | 'flame'
  steps: TimeStep[]
  index: number
  onChange: (i: number) => void
  ariaLabel: string
  playLabel: string
  footnote: string
  className: string
  /** Drop the footnote on phones, to keep the card short. */
  compactOnPhone?: boolean
  /** Extra controls shown above the slider (the earthquake's before/after). */
  extra?: React.ReactNode
}

/** The slider card itself: play/pause, the active step, the range input and a footnote. */
function SliderCard({ id, title, icon, steps, index, onChange, ariaLabel, playLabel, footnote, className, compactOnPhone, extra }: SliderProps) {
  const selected = useStore((s) => !!s.selectedId)
  const isPlaying = useStore((s) => s.isPlaying)
  const setPlaying = useStore((s) => s.setPlaying)
  const last = steps.length - 1
  const i = Math.min(index, last)
  const active = steps[i]
  const Icon = icon === 'flame' ? Flame : Clock

  return (
    // centred on the globe; shifts left only while the story panel (right side) is open
    <div className={`absolute left-3 right-3 z-10 flex justify-center lg:bottom-8 lg:left-[252px] ${selected ? 'lg:right-[470px]' : 'lg:right-[252px]'} ${className}`}>
      <div className="w-full max-w-[560px] rounded-card border border-line bg-bg/90 px-4 py-3 shadow-card backdrop-blur">
        {extra}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setPlaying(!isPlaying)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-blue text-white transition-colors hover:bg-[#0A3F8F]"
            aria-label={isPlaying ? 'Pause' : playLabel}
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? <Pause size={16} aria-hidden /> : <Play size={16} aria-hidden />}
          </button>

          <div className="min-w-0 flex-1">
            <div className="mb-1 flex items-baseline gap-2">
              <Icon size={13} className="shrink-0 text-sub" aria-hidden />
              <span className="section-label !text-[11px]">{title}</span>
              <span className="ml-auto font-display text-[17px] font-semibold tabular-nums text-gold">{active.label}</span>
            </div>
            <input
              id={id}
              type="range"
              min={0}
              max={last}
              step={1}
              value={i}
              onChange={(e) => {
                setPlaying(false)
                onChange(Number(e.target.value))
              }}
              className="naba-months w-full"
              aria-label={ariaLabel}
              aria-valuetext={active.label}
            />
            <div className="mt-0.5 flex justify-between text-[11px] text-sub">
              <span>{steps[0].label}</span>
              <span>{steps[last].label}</span>
            </div>
          </div>
        </div>
        <p className={`mt-2 border-t border-line pt-2 text-[11px] leading-snug text-sub ${compactOnPhone ? 'max-lg:hidden' : ''}`}>{footnote}</p>
      </div>
    </div>
  )
}

/**
 * The time control for the measured layers on the globe. By default it steps the wetland layer
 * month by month (NISAR passes about every 12 days; each step is one month composited). While a
 * story with a burn layer is selected, the same control steps that burn scar pass by pass instead.
 * Each layer keeps its own position. Hidden when there is nothing to step through.
 */
export default function TimeSlider() {
  const months = useStore((s) => s.months)
  const monthIndex = useStore((s) => s.monthIndex)
  const setMonth = useStore((s) => s.setMonth)
  const setFireIndex = useStore((s) => s.setFireIndex)
  // the selected story's burn timeline, if it has one worth stepping through
  const fire = useStore((s) => (s.selectedId ? s.fireTimelines[s.selectedId] : undefined))
  const fireMode = !!fire && fire.steps.length > 1
  const isPlaying = useStore((s) => s.isPlaying)
  const setPlaying = useStore((s) => s.setPlaying)
  const selectedId = useStore((s) => s.selectedId)
  // a one-off event (earthquake): its own before / after control sits above the month slider
  const quake = useStore((s) => s.stories.find((x) => x.id === s.selectedId && x.change_type === 'earthquake'))
  const quakeStep = useStore((s) => s.quakeStep)
  const setQuakeStep = useStore((s) => s.setQuakeStep)

  const count = fireMode ? fire.steps.length : months.length

  // advance the active slider while playing, wrapping back to the first step
  useEffect(() => {
    if (!isPlaying || count < 2) return
    const id = setInterval(
      () => {
        const st = useStore.getState()
        const tl = st.selectedId ? st.fireTimelines[st.selectedId] : undefined
        if (fireMode && st.selectedId && tl) st.setFireIndex(st.selectedId, (tl.index + 1) % tl.steps.length)
        else st.setMonth((st.monthIndex + 1) % st.months.length)
      },
      prefersReducedMotion() ? STEP_MS_REDUCED : STEP_MS,
    )
    return () => clearInterval(id)
  }, [isPlaying, count, fireMode])

  useEffect(() => {
    if (count < 2 && isPlaying) setPlaying(false)
  }, [count, isPlaying, setPlaying])

  if (fireMode && selectedId) {
    const before = fire.steps[0]
    return (
      <SliderCard
        id="fire-slider"
        title="Burn scar · radar pass"
        icon="flame"
        steps={fire.steps}
        index={fire.index}
        onChange={(i) => setFireIndex(selectedId, i)}
        ariaLabel="Radar pass shown on the globe"
        playLabel="Play through the radar passes"
        footnote={`Each step is one NISAR pass, compared with ${formatDateShort(before.key)}, before the fire. Data: NASA–ISRO NISAR.`}
        // phones: the story sheet covers the bottom of the map, so the burn slider moves to the top,
        // below the globe / flat-map toggle
        className="max-lg:top-[68px] lg:bottom-8"
        compactOnPhone
      />
    )
  }

  if (months.length < 2) return null
  const quakePanel = quake && (
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
  )
  return (
    <SliderCard
      id="month-slider"
      title="Month shown on the map"
      icon="clock"
      steps={months.map((m) => ({ key: m.month, label: m.label }))}
      index={monthIndex}
      onChange={setMonth}
      ariaLabel="Month shown on the globe"
      playLabel="Play through the months"
      footnote={
        quake
          ? 'The month slider does not change the earthquake. It only steps through the wetlands (Lake Manzala, the Okavango Delta, the Everglades). The earthquake happened in one moment, so use the before / after slider above.'
          : 'The filled areas show what NISAR measured in that month (several radar passes combined). Data: NASA–ISRO NISAR.'
      }
      extra={quakePanel}
      className={`bottom-3 ${selectedId ? 'max-lg:hidden' : ''}`}
    />
  )
}
