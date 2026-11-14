import { ArrowRight } from 'lucide-react'
import { asset } from '../lib'

/**
 * The opening visual inside IntroScreen: the NABA logo sweeps in left-to-right
 * to reveal the letters. Uses the fully transparent artwork in
 * public/naba-logo-transparent.png (see NABA_logo_transparent.png at the repo root).
 */
export default function Landing({ onStart, active }: { onStart: () => void; active: boolean }) {
  return (
    <div className="relative z-10 flex flex-col items-center">
      <div className="logo-reveal">
        <img
          src={asset('naba-logo-transparent.png')}
          alt="NABA"
          draggable={false}
          className="logo-reveal__img"
        />
      </div>

      <p className="intro-fade mt-7 font-display text-[22px] uppercase tracking-[0.18em] text-text/90 sm:text-[26px]">
        Earth's news, before it breaks
      </p>
      <p className="intro-fade intro-fade--2 mt-3 max-w-md text-[15px] text-sub">
        Radar from the NASA&ndash;ISRO NISAR satellite, turned into clear stories about how the ground beneath us is
        changing.
      </p>
      <button
        onClick={onStart}
        className="btn intro-fade intro-fade--3 mt-9 rounded-full bg-gold px-8 py-3.5 text-[16px] font-semibold text-bg hover:bg-[#D9A63F]"
        tabIndex={active ? 0 : -1}
        autoFocus
      >
        Let's start <ArrowRight size={18} aria-hidden />
      </button>
    </div>
  )
}
