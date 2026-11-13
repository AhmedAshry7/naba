import { useEffect } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { useStore } from './store'
import { useDemoMode } from './hooks/useDemoMode'
import TopBar from './components/TopBar'
import MapView from './components/MapView'
import StoryPanel from './components/StoryPanel'
import ExplainSection from './components/ExplainSection'
import Legend from './components/Legend'
import TimeSlider from './components/TimeSlider'
import ProjectionToggle from './components/ProjectionToggle'
import CompareModal from './components/CompareModal'
import AboutModal from './components/AboutModal'
import IntroScreen from './components/IntroScreen'

export default function App() {
  const load = useStore((s) => s.load)
  const status = useStore((s) => s.status)

  useEffect(() => {
    load()
  }, [load])

  useDemoMode()

  // Esc closes the top-most layer: explain / compare / about / story panel
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const s = useStore.getState()
      if (s.explainOpen) s.set({ explainOpen: false })
      else if (s.compareOpen) s.set({ compareOpen: false })
      else if (s.aboutOpen) s.set({ aboutOpen: false })
      else if (s.selectedId) s.select(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="flex h-full flex-col bg-bg text-text">
      <TopBar />

      <main className="relative min-h-0 flex-1 overflow-hidden">
        <MapView />
        <ProjectionToggle />
        <Legend />
        <TimeSlider />
        <StoryPanel />

        {status === 'error' && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-bg/70 p-6 backdrop-blur-sm" role="alert">
            <div className="max-w-sm rounded-panel border border-line bg-card p-6 text-center shadow-panel">
              <AlertTriangle className="mx-auto mb-3 text-gold" size={30} aria-hidden />
              <h2 className="font-display text-[20px] font-semibold">The newsroom is offline</h2>
              <p className="mt-2 text-[14px] text-sub">We couldn't load the change data. The globe is still here, and you can try again.</p>
              <button onClick={load} className="btn mt-4 bg-brand-blue text-white hover:bg-[#0A3F8F]">
                <RefreshCw size={15} aria-hidden /> Try again
              </button>
            </div>
          </div>
        )}
      </main>

      <ExplainSection />
      <CompareModal />
      <AboutModal />
      <IntroScreen />
    </div>
  )
}
