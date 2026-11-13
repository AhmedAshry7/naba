import { useEffect, useRef } from 'react'

type Star = { x: number; y: number; z: number; t: number; gold: boolean }

/** Twinkling starfield that fills whatever fixed/absolute container it's placed in. */
export default function Starfield() {
  const ref = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let stars: Star[] = []
    let w = 0
    let h = 0
    let dpr = 1
    let raf = 0

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      w = canvas.width = canvas.clientWidth * dpr
      h = canvas.height = canvas.clientHeight * dpr
      const count = Math.round((canvas.clientWidth * canvas.clientHeight) / 2600)
      stars = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        z: Math.random() * 0.8 + 0.2,
        t: Math.random() * Math.PI * 2,
        gold: Math.random() < 0.12,
      }))
      if (reduce) draw()
    }

    const draw = () => {
      ctx.clearRect(0, 0, w, h)
      for (const s of stars) {
        s.y -= 0.05 * s.z * dpr
        if (s.y < 0) s.y += h
        s.t += 0.02
        const a = 0.25 + 0.55 * s.z * (0.75 + 0.25 * Math.sin(s.t))
        ctx.fillStyle = s.gold ? `rgba(232,184,74,${a})` : `rgba(210,225,255,${a})`
        ctx.beginPath()
        ctx.arc(s.x, s.y, s.z * 1.3 * dpr, 0, Math.PI * 2)
        ctx.fill()
      }
      if (!reduce) raf = requestAnimationFrame(draw)
    }

    resize()
    draw()
    window.addEventListener('resize', resize)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
    }
  }, [])

  return <canvas ref={ref} className="absolute inset-0 h-full w-full" aria-hidden />
}
