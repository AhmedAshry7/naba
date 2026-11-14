import { useEffect } from 'react'
import { Pause, Play } from 'lucide-react'
import { useStore } from '../store'
import { formatDate, formatDateShort, prefersReducedMotion } from '../lib'
import type { ChangeStory, TimeStep } from '../types'

const STEP_MS = 1200
const STEP_MS_REDUCED = 2200 // the user asked for motion, so still play - just slower

interface SliderProps {
  id: string
  title: string
  steps: TimeStep[]
  index: number
  onChange: (i: number) => void
  ariaLabel: string
  playLabel: string
}

/** The slider card itself: play/pause, the active step and the range input. */
function SliderCard({ id, title, steps, index, onChange, ariaLabel, playLabel }: SliderProps) {
  const isPlaying = useStore((s) => s.isPlaying)
  const setPlaying = useStore((s) => s.setPlaying)
  const last = steps.length - 1
  const i = Math.min(index, last)
  const active = steps[i]

  return (
    <div className="rounded-card border border-line bg-card px-3.5 py-3">
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
    </div>
  )
}

/**
 * The earthquake's before / after control: one switch, not a slider. A single event has no
 * months or passes to step through, only the ground before and after it moved.
 */
function QuakeSwitch({ story, after, onChange }: { story: ChangeStory; after: boolean; onChange: (after: boolean) => void }) {
  return (
    <div className="rounded-card border border-line bg-card px-3.5 py-3">
      <div className="mb-2 flex items-baseline gap-2">
        <span className="section-label !text-[11px]">Before and after</span>
        <span className="ml-auto font-display text-[17px] font-semibold tabular-nums text-gold">
          {formatDate(after ? story.period.end : story.period.start)}
        </span>
      </div>
      <div className="flex items-center justify-center gap-3">
        <span className={`text-[13px] font-semibold ${after ? 'text-sub' : 'text-text'}`}>Before</span>
        <button
          type="button"
          role="switch"
          aria-checked={after}
          aria-label="Show the ground after the earthquake"
          onClick={() => onChange(!after)}
          className={`relative h-7 w-14 shrink-0 rounded-full border transition-colors ${after ? 'border-[#3DD68C] bg-[#3DD68C]' : 'border-line bg-bg'}`}
        >
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${after ? 'left-[30px]' : 'left-0.5'}`} aria-hidden />
        </button>
        <span className={`text-[13px] font-semibold ${after ? 'text-text' : 'text-sub'}`}>After</span>
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] text-sub">
        <span>{formatDateShort(story.period.start)}</span>
        {story.event_date && <span className="font-semibold text-text">{formatDateShort(story.event_date)} · earthquake</span>}
        <span>{formatDateShort(story.period.end)}</span>
      </div>
    </div>
  )
}

/**
 * The time control for the open story, shown in the right-hand panel above its compare button.
 * An earthquake gets a before / after switch; a fire steps its burn scar pass by pass; every other
 * story steps the wetland layer month by month (NISAR passes about every 12 days; each step is one
 * month composited). Each layer keeps its own position.
 */
export default function StoryTime({ story }: { story: ChangeStory }) {
  const months = useStore((s) => s.months)
  const monthIndex = useStore((s) => s.monthIndex)
  const setMonth = useStore((s) => s.setMonth)
  const setFireIndex = useStore((s) => s.setFireIndex)
  const fire = useStore((s) => s.fireTimelines[story.id])
  const fireMode = !!fire && fire.steps.length > 1
  const isPlaying = useStore((s) => s.isPlaying)
  const setPlaying = useStore((s) => s.setPlaying)
  const quakeStep = useStore((s) => s.quakeStep)
  const setQuakeStep = useStore((s) => s.setQuakeStep)
  const isQuake = story.change_type === 'earthquake'

  const count = isQuake ? 0 : fireMode ? fire.steps.length : months.length

  // advance the active slider while playing, wrapping back to the first step
  useEffect(() => {
    if (!isPlaying || count < 2) return
    const id = setInterval(
      () => {
        const st = useStore.getState()
        const tl = st.fireTimelines[story.id]
        if (fireMode && tl) st.setFireIndex(story.id, (tl.index + 1) % tl.steps.length)
        else st.setMonth((st.monthIndex + 1) % st.months.length)
      },
      prefersReducedMotion() ? STEP_MS_REDUCED : STEP_MS,
    )
    return () => clearInterval(id)
  }, [isPlaying, count, fireMode, story.id])

  useEffect(() => {
    if (count < 2 && isPlaying) setPlaying(false)
  }, [count, isPlaying, setPlaying])

  if (isQuake) return <QuakeSwitch story={story} after={quakeStep >= 1} onChange={(a) => setQuakeStep(a ? 1 : 0)} />

  if (fireMode) {
    return (
      <SliderCard
        id="fire-slider"
        title="Burn scar · radar pass"
        steps={fire.steps}
        index={fire.index}
        onChange={(i) => setFireIndex(story.id, i)}
        ariaLabel="Radar pass shown on the globe"
        playLabel="Play through the radar passes"
      />
    )
  }

  if (months.length < 2) return null
  return (
    <SliderCard
      id="month-slider"
      title="Month shown on the map"
      steps={months.map((m) => ({ key: m.month, label: m.label }))}
      index={monthIndex}
      onChange={setMonth}
      ariaLabel="Month shown on the globe"
      playLabel="Play through the months"
    />
  )
}
