import { useEffect, useState } from 'react'
import { ArrowDown, ArrowRight, ArrowUp, Check, Columns2, Link2, Sparkles, X } from 'lucide-react'
import { useStore } from '../store'
import { CLASS_META, formatCoords, formatDate, formatDateShort, formatValue } from '../lib'
import type { ChangeStory } from '../types'
import ConfidenceBar from './ConfidenceBar'
import SeriesChart from './SeriesChart'
import TypeIcon from './TypeIcon'

const ARROWS = { upward: ArrowUp, downward: ArrowDown, steady: ArrowRight }

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-card border border-line bg-card px-3 py-2.5">
      <div className="section-label !text-[11px]">{label}</div>
      <div className="mt-1 text-[15px] font-semibold leading-tight tabular-nums">{value}</div>
    </div>
  )
}

function Body({ s }: { s: ChangeStory }) {
  const meta = CLASS_META[s.change_class]
  const Arrow = ARROWS[s.metric.direction] ?? ArrowRight
  const hasFrames = useStore((st) => st.layers.length > 0)
  const set = useStore((st) => st.set)
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    const u = new URL(window.location.href)
    u.searchParams.set('story', s.id)
    u.searchParams.delete('demo')
    try {
      await navigator.clipboard.writeText(u.toString())
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      /* clipboard unavailable: ignore */
    }
  }

  return (
    <>
      <header className="shrink-0 px-5 pb-3 pt-5">
        <div className="mb-3 flex items-center gap-2">
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-bold uppercase tracking-wider"
            style={{ background: `${meta.color}22`, color: meta.color, border: `1px solid ${meta.color}66` }}
          >
            <TypeIcon type={s.change_type} size={14} /> {meta.chip}
          </span>
          <button onClick={copy} className="ml-auto rounded-card p-2 text-sub hover:bg-card hover:text-text" aria-label="Copy link to this story" title="Copy link">
            {copied ? <Check size={18} className="text-stable" aria-hidden /> : <Link2 size={18} aria-hidden />}
          </button>
          <button
            onClick={() => useStore.getState().select(null)}
            className="rounded-card p-2 text-sub hover:bg-card hover:text-text"
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

      <div id="story-scroll" className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 pb-6 pt-2">
        {/* metric */}
        <section
          className="relative overflow-hidden rounded-panel border p-5"
          style={{ borderColor: `${meta.color}55`, background: `linear-gradient(135deg, ${meta.color}1f, #0D1628 70%)` }}
        >
          <div className="section-label">{s.metric.label}</div>
          <div className="mt-2 flex items-end gap-3">
            <Arrow size={40} strokeWidth={2.6} style={{ color: meta.color }} aria-hidden className="mb-2" />
            <span className="font-display text-[64px] font-bold leading-none tabular-nums">{formatValue(s.metric.value)}</span>
            <span className="mb-1.5 text-[16px] font-medium text-text/90">{s.metric.unit}</span>
          </div>
          <div className="mt-3 text-[13px] text-sub">
            Direction: <span className="font-semibold text-text">{s.metric.direction}</span> · {formatDateShort(s.period.start)} – {formatDate(s.period.end)} ·{' '}
            <span className="capitalize">{s.confidence}</span> confidence
          </div>
        </section>

        <div className="grid grid-cols-3 gap-2.5">
          <Stat label="Observed" value={`${formatDateShort(s.period.start)} – ${formatDateShort(s.period.end)}`} />
          <Stat label="Radar passes" value={String(s.passes)} />
          <Stat label="Area" value={`${s.area_km2} km²`} />
        </div>

        <section className="rounded-card border border-line bg-card p-4">
          <SeriesChart series={s.series} color={meta.color} label={s.metric.label} unit={s.metric.unit} />
        </section>

        <section>
          <h3 className="section-label mb-2">What's happening</h3>
          <p className="text-[15px] leading-relaxed">{s.summary}</p>
        </section>

        <section>
          <h3 className="section-label mb-2">Possible causes</h3>
          <ul className="space-y-1.5 text-[15px] leading-relaxed">
            {s.causes.map((c) => (
              <li key={c} className="flex gap-2.5">
                <span className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: meta.color }} aria-hidden />
                {c}
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h3 className="section-label mb-2">Why it matters</h3>
          <p className="text-[15px] leading-relaxed">{s.why_it_matters}</p>
          {s.next_step && (
            <p className="mt-3 rounded-card border border-line bg-card px-3.5 py-2.5 text-[14px] text-sub">
              <span className="font-semibold text-text">What to check next: </span>
              {s.next_step}
            </p>
          )}
        </section>

        <ConfidenceBar level={s.confidence} note={s.confidence_note} />

        <div className="flex flex-col gap-2.5 sm:flex-row">
          <button onClick={() => set({ explainOpen: true })} className="btn flex-1 bg-brand-blue text-white hover:bg-[#0A3F8F]">
            <Sparkles size={16} aria-hidden /> Explain this change
          </button>
          <button
            onClick={() => set({ compareOpen: true })}
            disabled={!hasFrames}
            className="btn flex-1 border border-line bg-card hover:bg-line disabled:cursor-not-allowed disabled:opacity-40"
            title={hasFrames ? undefined : 'No change images available yet'}
          >
            <Columns2 size={16} aria-hidden /> Compare dates
          </button>
        </div>

        <footer className="border-t border-line pt-4 text-[12px] leading-relaxed text-sub">
          Data: NASA–ISRO NISAR radar{s.is_sample && <span className="text-gold"> · sample values for preview</span>}
        </footer>
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
