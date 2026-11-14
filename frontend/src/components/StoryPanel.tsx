import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { useStore } from '../store'
import { describeStory, formatCoords, formatDateShort, layersForStory, metricLine, storyMeta } from '../lib'
import type { ChangeStory } from '../types'
import StoryTime from './TimeSlider'

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-card border border-line bg-card px-3 py-2.5">
      <div className="section-label !text-[11px]">{label}</div>
      <div className="mt-1 text-[15px] font-semibold leading-tight tabular-nums">{value}</div>
    </div>
  )
}

function Body({ s }: { s: ChangeStory }) {
  const meta = storyMeta(s)
  const layer = useStore((st) => layersForStory(st.layers, s)[0])
  const hasFrames = !!layer
  const isViews = layer?.kind === 'views'
  const set = useStore((st) => st.set)

  return (
    <>
      <header className="shrink-0 px-5 pb-3 pt-5">
        <div className="mb-3 flex items-center gap-2">
          <span
            className="inline-flex items-center rounded-full px-3 py-1 text-[12px] font-bold uppercase tracking-wider"
            style={{ background: `${meta.color}22`, color: meta.color, border: `1px solid ${meta.color}66` }}
          >
            {meta.chip}
          </span>
          <button
            onClick={() => useStore.getState().select(null)}
            className="ml-auto rounded-card p-2 text-sub hover:bg-card hover:text-text"
            aria-label="Close story (Esc)"
            title="Close (Esc)"
          >
            <X size={20} aria-hidden />
          </button>
        </div>
        <h2 className="font-display text-[28px] font-semibold leading-[1.15]">{s.headline}</h2>
        <p className="mt-2 text-[14px] text-sub">
          {s.region} · {s.subtitle} · <span className="tabular-nums">{formatCoords(s.lat, s.lon)}</span>
        </p>
      </header>

      <div id="story-scroll" className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 pb-6 pt-2">
        <section>
          <div className="space-y-2.5 text-[14px] leading-relaxed">
            {describeStory(s).map((para) => (
              <p key={para}>{para}</p>
            ))}
          </div>
          <p className="mt-3 text-[13px] font-medium tabular-nums" style={{ color: meta.color }}>
            {metricLine(s)}
          </p>
        </section>

        <div className="grid grid-cols-3 gap-2.5">
          <Stat label="Observed" value={`${formatDateShort(s.period.start)} – ${formatDateShort(s.period.end)}`} />
          <Stat label="Radar passes" value={String(s.passes)} />
          <Stat label="Area" value={`${s.area_km2} km²`} />
        </div>
      </div>

      <div className="shrink-0 space-y-3 border-t border-line px-5 pb-5 pt-4">
        <StoryTime story={s} />
        <button
          onClick={() => set({ compareOpen: true })}
          disabled={!hasFrames}
          className="btn w-full border border-line bg-card hover:bg-line disabled:cursor-not-allowed disabled:opacity-40"
          title={hasFrames ? undefined : 'No change images available yet'}
        >
          {isViews ? 'See ground motion' : 'Compare dates'}
        </button>
      </div>
    </>
  )
}

export default function StoryPanel() {
  const selectedId = useStore((s) => s.selectedId)
  const story = useStore((s) => s.stories.find((x) => x.id === s.selectedId))
  // keep the last story rendered while the panel slides out
  const [shown, setShown] = useState<ChangeStory | undefined>(story)
  useEffect(() => {
    if (story) {
      setShown(story)
      return
    }
    const t = setTimeout(() => setShown(undefined), 320)
    return () => clearTimeout(t)
  }, [story])

  const open = !!story
  return (
    <aside
      aria-label="Story details"
      aria-hidden={!open}
      inert={!open ? '' : undefined}
      className={`absolute z-20 flex flex-col border border-line bg-bg shadow-panel transition-transform duration-300 ease-out
        inset-x-0 bottom-0 h-[58%] rounded-t-panel
        lg:inset-x-auto lg:bottom-8 lg:right-3 lg:top-3 lg:h-auto lg:w-[440px] lg:rounded-panel
        xl:w-[460px]
        ${open ? 'translate-x-0 translate-y-0' : 'translate-y-full lg:translate-y-0 lg:translate-x-[calc(100%+24px)]'}`}
      data-selected={selectedId ?? ''}
    >
      {shown && <Body key={shown.id} s={shown} />}
    </aside>
  )
}
