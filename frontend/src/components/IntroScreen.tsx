import { useState } from 'react'
import { useStore } from '../store'
import Landing from './Landing'
import Starfield from './Starfield'
import StoryIntro from './StoryIntro'

/** Full-screen cinematic intro that plays before the map. Fades out when the visitor continues. */
export default function IntroScreen() {
  const open = useStore((s) => s.introOpen)
  const set = useStore((s) => s.set)
  const [storyStarted, setStoryStarted] = useState(false)
  return (
    <div
      className={`fixed inset-0 z-50 overflow-hidden bg-bg transition-opacity duration-700 ${open ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
      aria-hidden={!open}
      inert={!open ? '' : undefined}
    >
      {!storyStarted ? (
        <>
          <Starfield />
          <div aria-hidden>
            <span className="intro-ring" />
            <span className="intro-ring" style={{ animationDelay: '1.6s' }} />
            <span className="intro-ring" style={{ animationDelay: '3.2s' }} />
          </div>
          <Landing active={open} onStart={() => setStoryStarted(true)} />
        </>
      ) : (
        <StoryIntro open={open} onDone={() => {
          useStore.getState().select(null)
          set({ introOpen: false, tourStep: 0 })
        }} />
      )}
    </div>
  )
}
