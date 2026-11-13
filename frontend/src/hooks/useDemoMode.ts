import { useCallback, useEffect, useRef } from 'react'
import { isDemo, useStore } from '../store'

const DEMO_STORY = 'manzala-flooded-vegetation'

/**
 * Scripted golden path for screen recording:
 * Globe (2 s) -> fly to the Delta (2 s) -> open the coast story (1 s) -> scroll the panel slowly -> open Explain.
 * Open /?demo=1 to autoplay, press D to restart at any time.
 */
export function useDemoMode() {
  const status = useStore((s) => s.status)
  const run = useRef(0)

  const start = useCallback(async () => {
    const id = ++run.current
    const alive = () => run.current === id
    const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
    const st = useStore.getState()
    if (st.status !== 'ready') return

    st.set({ introOpen: false, aboutOpen: false, compareOpen: false, explainOpen: false, isPlaying: false, filter: 'all', feedOpenMobile: false })
    st.select(null)
    st.moveCamera('globe')
    await wait(2000)
    if (!alive()) return
    st.moveCamera('delta')
    await wait(2000)
    if (!alive()) return
    const target = useStore.getState().stories.find((s) => s.id === DEMO_STORY) ?? useStore.getState().stories[0]
    if (!target) return
    useStore.getState().select(target.id)
    await wait(1000 + 600) // let the camera settle and the panel slide in
    if (!alive()) return

    const el = document.getElementById('story-scroll')
    if (el) {
      const max = el.scrollHeight - el.clientHeight
      const dur = 5500
      const t0 = performance.now()
      await new Promise<void>((resolve) => {
        const tick = (now: number) => {
          if (!alive()) return resolve()
          const p = Math.min(1, (now - t0) / dur)
          const ease = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2
          el.scrollTop = max * ease
          p < 1 ? requestAnimationFrame(tick) : resolve()
        }
        requestAnimationFrame(tick)
      })
    }
    if (!alive()) return
    await wait(500)
    if (!alive()) return
    useStore.getState().set({ explainOpen: true })
  }, [])

  // autoplay with ?demo=1
  useEffect(() => {
    if (!isDemo || status !== 'ready') return
    const t = setTimeout(start, 600)
    return () => clearTimeout(t)
  }, [status, start])

  // D restarts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable) return
      if (e.key === 'd' || e.key === 'D') start()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [start])
}
