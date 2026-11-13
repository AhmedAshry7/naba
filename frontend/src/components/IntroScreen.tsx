import { useStore } from '../store'
import Landing from './Landing'
import Starfield from './Starfield'

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
      <Starfield />
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-brand-blue via-sky to-gold" aria-hidden />
      <div aria-hidden>
        <span className="intro-ring" />
        <span className="intro-ring" style={{ animationDelay: '1.6s' }} />
        <span className="intro-ring" style={{ animationDelay: '3.2s' }} />
      </div>
      <Landing active={open} onStart={() => set({ introOpen: false })} />
    </div>
  )
}
