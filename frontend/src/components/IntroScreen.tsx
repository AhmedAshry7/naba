import { ArrowRight } from 'lucide-react'
import { useStore } from '../store'
import { Logo } from './TopBar'

export default function IntroScreen() {
  const open = useStore((s) => s.introOpen)
  const set = useStore((s) => s.set)
  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center overflow-hidden bg-bg px-6 text-center transition-opacity duration-700 ${
        open ? 'opacity-100' : 'pointer-events-none opacity-0'
      }`}
      aria-hidden={!open}
      inert={!open ? '' : undefined}
    >
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-brand-blue via-sky to-gold" aria-hidden />
      <div aria-hidden>
        <span className="intro-ring" />
        <span className="intro-ring" style={{ animationDelay: '1.6s' }} />
        <span className="intro-ring" style={{ animationDelay: '3.2s' }} />
      </div>
      <div className="relative z-10 flex flex-col items-center">
        <Logo width={320} />
        <p className="mt-7 font-display text-[22px] uppercase tracking-[0.18em] text-text/90 sm:text-[26px]">Earth's news, before it breaks</p>
        <p className="mt-3 max-w-md text-[15px] text-sub">Radar from the NASA–ISRO NISAR satellite, turned into clear stories about how the ground beneath us is changing.</p>
        <button
          onClick={() => set({ introOpen: false })}
          className="btn mt-9 bg-brand-blue px-7 py-3.5 text-[16px] text-white hover:bg-[#0A3F8F]"
          tabIndex={open ? 0 : -1}
          autoFocus
        >
          Open the newsroom <ArrowRight size={18} aria-hidden />
        </button>
      </div>
    </div>
  )
}
