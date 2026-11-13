import { Info } from 'lucide-react'
import { useStore } from '../store'
import SampleBadge from './SampleBadge'

/**
 * public/logo.png is the original logo (cropped). Its deep-blue/navy artwork disappears on black, so the UI uses
 * public/logo-dark.png: the same artwork with lightened blues and a transparent background.
 */
export function Logo({ width = 132, arabic = true }: { width?: number; arabic?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <img src="/logo-dark.png" alt="Naba" draggable={false} style={{ width, height: 'auto', display: 'block' }} />
      {arabic && (
        <span className="font-arabic text-[24px] font-extrabold leading-none text-gold" lang="ar" dir="rtl">
          نبأ
        </span>
      )}
    </div>
  )
}

export default function TopBar() {
  const set = useStore((s) => s.set)
  return (
    <header className="relative z-20 flex h-[68px] shrink-0 items-center gap-3 border-b border-line bg-bg px-3 sm:px-5">
      <div className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-brand-blue via-sky to-gold" aria-hidden />
      <Logo width={128} />
      <span className="ml-1 hidden border-l border-line pl-4 text-[14px] text-sub md:block">Earth's news, before it breaks</span>
      <div className="ml-auto flex items-center gap-2 sm:gap-3">
        <SampleBadge />
        <button onClick={() => set({ aboutOpen: true })} className="btn border border-line bg-card px-3 py-1.5 hover:bg-line">
          <Info size={16} aria-hidden /> About
        </button>
      </div>
    </header>
  )
}
