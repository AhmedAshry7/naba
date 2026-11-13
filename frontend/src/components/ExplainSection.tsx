import { useEffect, useRef, useState } from 'react'
import { SkipForward, Sparkles, X } from 'lucide-react'
import { useStore } from '../store'
import { CLASS_META, prefersReducedMotion } from '../lib'

const TOTAL_MS = 1600
const TICK_MS = 25

export default function ExplainSection() {
  const open = useStore((s) => s.explainOpen)
  const story = useStore((s) => s.stories.find((x) => x.id === s.selectedId))
  const set = useStore((s) => s.set)
  const text = story?.explanation ?? ''
  const [n, setN] = useState(0)
  const closeRef = useRef<HTMLButtonElement>(null)

  // typewriter: whole text in ~1.6 s regardless of length
  useEffect(() => {
    if (!open || !text) return
    if (prefersReducedMotion()) {
      setN(text.length)
      return
    }
    setN(0)
    const step = Math.max(1, Math.ceil(text.length / (TOTAL_MS / TICK_MS)))
    const id = setInterval(() => {
      setN((v) => {
        if (v + step >= text.length) {
          clearInterval(id)
          return text.length
        }
        return v + step
      })
    }, TICK_MS)
    return () => clearInterval(id)
  }, [open, text])

  useEffect(() => {
    if (open) closeRef.current?.focus()
  }, [open])

  if (!open || !story) return null
  const done = n >= text.length
  const meta = CLASS_META[story.change_class]

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/55 p-4 animate-fadeIn" onClick={() => set({ explainOpen: false })}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="explain-title"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[88vh] w-full max-w-[640px] flex-col rounded-panel border border-line bg-bg shadow-panel animate-rise"
      >
        <div className="flex items-start gap-3 border-b border-line px-6 py-4">
          <div className="min-w-0">
            <div className="section-label flex items-center gap-1.5" style={{ color: meta.color }}>
              <Sparkles size={14} aria-hidden /> Explain this change
            </div>
            <h2 id="explain-title" className="mt-1 font-display text-[22px] font-semibold leading-tight">
              {story.headline}
            </h2>
          </div>
          <button ref={closeRef} onClick={() => set({ explainOpen: false })} className="ml-auto rounded-card p-2 text-sub hover:bg-card hover:text-text" aria-label="Close explanation">
            <X size={20} aria-hidden />
          </button>
        </div>

        <div className="relative min-h-[200px] overflow-y-auto px-6 py-5">
          {/* invisible full text reserves the height so the dialog doesn't jump while typing */}
          <p className="invisible whitespace-pre-line text-[16px] leading-[1.7]" aria-hidden>
            {text}
          </p>
          <p className="absolute inset-x-6 top-5 whitespace-pre-line text-[16px] leading-[1.7]" aria-live="polite">
            {text.slice(0, n)}
            {!done && <span className="ml-0.5 inline-block h-[1.1em] w-[2px] translate-y-[3px] animate-pulse bg-gold" aria-hidden />}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-line px-6 py-3.5">
          {story.explanation_ai_generated && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-card px-3 py-1 text-[12px] text-sub">
              <Sparkles size={13} className="text-gold" aria-hidden />
              AI-assisted explanation, based only on the measured data
            </span>
          )}
          {story.is_sample && <span className="text-[12px] text-gold">Sample values for preview</span>}
          {!done ? (
            <button onClick={() => setN(text.length)} className="btn ml-auto border border-line bg-card px-3 py-1.5 hover:bg-line">
              <SkipForward size={15} aria-hidden /> Skip
            </button>
          ) : (
            <button onClick={() => set({ explainOpen: false })} className="btn ml-auto border border-line bg-card px-4 py-1.5 hover:bg-line">
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
