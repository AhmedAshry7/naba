import { useStore } from '../store'
import StoryIntro from './StoryIntro'

/** Full-screen cinematic intro that plays before the map. Fades out when the visitor continues. */
export default function IntroScreen() {
  const open = useStore((s) => s.introOpen)
  const set = useStore((s) => s.set)
  return (
    <div
      className={`fixed inset-0 z-50 overflow-hidden bg-bg transition-opacity duration-700 ${open ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
      aria-hidden={!open}
      inert={!open ? '' : undefined}
    >
      <StoryIntro open={open} onDone={() => set({ introOpen: false })} />
    </div>
  )
}
