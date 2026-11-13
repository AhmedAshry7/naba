import { useEffect, useRef } from 'react'
import { Database, Lightbulb, LineChart, X } from 'lucide-react'
import { useStore } from '../store'

const STEPS = [
  { icon: Database, title: 'Data', text: 'NISAR radar images of the same place are collected every 12 days.' },
  { icon: LineChart, title: 'Analysis', text: 'We compare the images over time to measure how the surface moves or changes.' },
  { icon: Lightbulb, title: 'Insights', text: 'Each change becomes a short news story with a headline, a place and a plain-language explanation.' },
]

export default function AboutModal() {
  const open = useStore((s) => s.aboutOpen)
  const set = useStore((s) => s.set)
  const ref = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (open) ref.current?.focus()
  }, [open])
  if (!open) return null
  const close = () => set({ aboutOpen: false })

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4 animate-fadeIn" onClick={close}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-title"
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-[680px] overflow-y-auto rounded-panel border border-line bg-bg shadow-panel animate-rise"
      >
        <div className="flex items-center border-b border-line px-6 py-4">
          <h2 id="about-title" className="font-display text-[24px] font-semibold uppercase tracking-wide">
            About Naba <span className="font-arabic text-gold normal-case" lang="ar">نبأ</span>
          </h2>
          <button ref={ref} onClick={close} className="ml-auto rounded-card p-2 text-sub hover:bg-card hover:text-text" aria-label="Close about">
            <X size={20} aria-hidden />
          </button>
        </div>

        <div className="space-y-7 px-6 py-6 text-[15px] leading-relaxed">
          <p>
            <b>Naba</b> means “news” in Arabic. It is a newsroom for the Earth: every surface change that radar detects is told as a short story, with a headline, a place on the map, the
            measurement and a plain explanation. It starts with Egypt's Nile Delta.
          </p>

          <section>
            <h3 className="section-label mb-2">What is NISAR?</h3>
            <p>
              NISAR is a joint NASA–ISRO radar satellite. Its L-band radar sees through clouds, works day and night, and revisits the same place about every 12 days. That makes it very good at
              spotting slow changes in the ground, water and plants.
            </p>
          </section>

          <section>
            <h3 className="section-label mb-3">How Naba works</h3>
            <ol className="grid gap-3 sm:grid-cols-3">
              {STEPS.map(({ icon: Icon, title, text }, i) => (
                <li key={title} className="rounded-card border border-line bg-card p-4">
                  <div className="mb-2 flex items-center gap-2">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-blue/15 text-sky">
                      <Icon size={15} aria-hidden />
                    </span>
                    <span className="font-display text-[16px] font-semibold uppercase">
                      {i + 1}. {title}
                    </span>
                  </div>
                  <p className="text-[14px] text-sub">{text}</p>
                </li>
              ))}
            </ol>
          </section>

          <section>
            <h3 className="section-label mb-2">Team</h3>
            <p className="text-sub">Team Naba · NASA Space Apps Challenge 2026 · “Dancing with the SARs”</p>
          </section>

          <section className="rounded-card border border-line bg-card p-4 text-[13px] text-sub">
            <h3 className="section-label mb-2">Data credits</h3>
            <p>Data: NASA–ISRO NISAR. Basemap © CARTO, © OpenStreetMap contributors. Map by MapLibre.</p>
            <p className="mt-2">
              Values shown with the “Sample data” badge are illustrative examples for a concept preview, not real measurements. Explanations marked AI-assisted are written from the measured data only
              and should be read as possibilities, not proof. This project is not affiliated with or endorsed by NASA or ISRO.
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}
