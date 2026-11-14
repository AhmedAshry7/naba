import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, Pause, Play, RotateCcw, SkipForward, Volume2, VolumeX } from 'lucide-react'
import { draw } from '../intro/scene'
import { pickKidVoice } from '../intro/voice'
import { CHAPTERS, CUES, DURATION, cueIndexAt } from '../intro/script'

const fmt = (s: number) => {
  const v = Math.max(0, Math.min(DURATION, s))
  return `${Math.floor(v / 60)}:${String(Math.floor(v % 60)).padStart(2, '0')}`
}

const startAt = (() => {
  if (typeof window === 'undefined') return 0
  const v = parseFloat(new URLSearchParams(window.location.search).get('t') ?? '')
  return Number.isFinite(v) ? v : 0
})()
const reducedMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export default function StoryIntro({ open, onDone }: { open: boolean; onDone: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const tRef = useRef(reducedMotion ? DURATION : startAt)
  const playingRef = useRef(!reducedMotion)
  const voiceRef = useRef(true)
  const lastCue = useRef(-2)
  const dragging = useRef<{ wasPlaying: boolean } | null>(null)

  const [t, setT] = useState(tRef.current)
  const [playing, setPlaying] = useState(playingRef.current)
  const [voice, setVoice] = useState(true)
  const [soundBlocked, setSoundBlocked] = useState(false) // browser refused autoplay audio until the visitor interacts
  const [hover, setHover] = useState<number | null>(null)

  // Narration: recorded clips in /public/intro/voice/cue-<n>.mp3 win if present; otherwise the
  // most child-like voice the browser has, pitched up and pushed for excitement.
  const clips = useRef<(string | null)[] | null>(null)
  const audio = useRef<HTMLAudioElement | null>(null)
  const stopVoice = useCallback(() => {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel()
    audio.current?.pause()
  }, [])
  const speak = useCallback(async (index: number) => {
    stopVoice()
    if (!clips.current) {
      clips.current = await Promise.all(
        CUES.map(async (_, i) => {
          const url = `/intro/voice/cue-${i}.mp3`
          try {
            const r = await fetch(url, { method: 'HEAD' })
            return r.ok && (r.headers.get('content-type') ?? '').startsWith('audio') ? url : null
          } catch { return null }
        }),
      )
    }
    if (!voiceRef.current || !playingRef.current || lastCue.current !== index) return // user moved on while probing
    const url = clips.current[index]
    if (url) {
      const a = (audio.current ??= new Audio())
      a.src = url
      a.play().catch((e: unknown) => { if ((e as DOMException)?.name === 'NotAllowedError') setSoundBlocked(true) })
      return
    }
    if (!('speechSynthesis' in window)) return
    const v = pickKidVoice()
    const u = new SpeechSynthesisUtterance(CUES[index].text.replace('…', '...'))
    if (v) u.voice = v
    const natural = !!v && /ana|natural|online/i.test(v.name)
    u.pitch = natural ? 1.25 : 1.75 // small-kid register
    u.rate = natural ? 1.08 : 1.12 // bouncy, eager pace
    u.volume = 1
    window.speechSynthesis.speak(u)
  }, [stopVoice])

  const setPlay = useCallback((p: boolean) => {
    playingRef.current = p
    setPlaying(p)
    if (!p) stopVoice()
    lastCue.current = -2 // re-speak the current line on resume
  }, [stopVoice])

  const seek = useCallback((s: number) => {
    tRef.current = Math.max(0, Math.min(DURATION, s))
    lastCue.current = -2
    stopVoice()
    setT(tRef.current)
  }, [stopVoice])

  // restart whenever the intro is (re)opened
  useEffect(() => {
    if (open) {
      tRef.current = reducedMotion ? DURATION : startAt
      setT(tRef.current)
      setPlay(!reducedMotion)
    } else stopVoice()
  }, [open, setPlay, stopVoice])

  // main loop: advances the master clock and paints the canvas
  useEffect(() => {
    if (!open) return
    const cnv = canvasRef.current!
    const wrap = wrapRef.current!
    const ctx = cnv.getContext('2d')!
    let w = 0, h = 0, dpr = 1
    const resize = () => {
      const r = wrap.getBoundingClientRect()
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      w = r.width; h = r.height
      cnv.width = Math.round(w * dpr); cnv.height = Math.round(h * dpr)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(wrap)
    let raf = 0, last = performance.now(), lastUi = -1
    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      if (playingRef.current) tRef.current += dt
      const t = tRef.current
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      draw(ctx, w, h, t)
      if (Math.abs(t - lastUi) > 0.04) { lastUi = t; setT(t) }
      if (voiceRef.current && playingRef.current) {
        const ci = cueIndexAt(t)
        if (ci !== lastCue.current) {
          lastCue.current = ci
          if (ci >= 0) void speak(ci)
        }
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => { cancelAnimationFrame(raf); ro.disconnect() }
  }, [open, speak])

  const ended = t >= DURATION - 0.8
  const finish = useCallback(() => {
    stopVoice()
    onDone()
  }, [onDone, stopVoice])

  // Browsers block sound until the visitor interacts once. If that happened, any click/key switches it on.
  useEffect(() => {
    if (!open || !soundBlocked) return
    const unlock = () => { setSoundBlocked(false); lastCue.current = -2 }
    window.addEventListener('pointerdown', unlock, { once: true })
    window.addEventListener('keydown', unlock, { once: true })
    return () => { window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock) }
  }, [open, soundBlocked])

  // keyboard: space = play/pause, arrows = scrub
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (e.key === 'ArrowLeft') { e.preventDefault(); seek(tRef.current - 5) }
      else if (e.key === 'ArrowRight') { e.preventDefault(); seek(tRef.current + 5) }
      else if (e.key === ' ' && tag !== 'BUTTON') { e.preventDefault(); setPlay(!playingRef.current) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, seek, setPlay])

  // ----- scrubbing -----
  const ratioAt = (clientX: number) => {
    const r = trackRef.current!.getBoundingClientRect()
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width))
  }
  const onPointerDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    dragging.current = { wasPlaying: playingRef.current }
    playingRef.current = false
    seek(ratioAt(e.clientX) * DURATION)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    setHover(ratioAt(e.clientX) * DURATION)
    if (dragging.current) seek(ratioAt(e.clientX) * DURATION)
  }
  const onPointerUp = () => {
    if (!dragging.current) return
    const was = dragging.current.wasPlaying
    dragging.current = null
    setPlay(was)
  }

  const togglePlay = () => {
    if (ended) { seek(0); setPlay(true) } else setPlay(!playingRef.current)
  }
  const toggleVoice = () => {
    if ('speechSynthesis' in window) window.speechSynthesis.getVoices() // warm the voice list
    const v = !voiceRef.current
    voiceRef.current = v
    setVoice(v)
    lastCue.current = -2
    if (!v) stopVoice()
  }

  const progress = Math.min(1, t / DURATION)
  const chapter = useMemo(() => {
    let c = CHAPTERS[0]
    for (const ch of CHAPTERS) if (t >= ch.t) c = ch
    return c
  }, [t])
  const hoverChapter = hover == null ? null : [...CHAPTERS].reverse().find((c) => hover >= c.t)

  return (
    <div className="absolute inset-0 select-none" ref={wrapRef}>
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-label="Animated story: why radar sees what optical satellites cannot" role="img" />

      {/* ---------- mini player (top) ---------- */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-center px-3 pt-3">
        <div className="pointer-events-auto flex w-full max-w-[680px] items-center gap-2 rounded-full border border-line bg-card/85 py-1.5 pl-1.5 pr-2 shadow-panel backdrop-blur-md">
          <button
            onClick={togglePlay}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gold text-bg transition hover:brightness-110"
            aria-label={ended ? 'Replay story' : playing ? 'Pause story' : 'Play story'}
          >
            {ended ? <RotateCcw size={16} /> : playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" className="translate-x-px" />}
          </button>
          <span className="w-[74px] shrink-0 text-center text-[12px] tabular-nums text-sub">
            {fmt(t)} / {fmt(DURATION)}
          </span>

          <div
            ref={trackRef}
            role="slider"
            tabIndex={0}
            aria-label="Story timeline"
            aria-valuemin={0}
            aria-valuemax={DURATION}
            aria-valuenow={Math.round(t)}
            aria-valuetext={`${fmt(t)}, ${chapter.label}`}
            className="group relative h-9 min-w-0 flex-1 cursor-pointer touch-none"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onPointerLeave={() => setHover(null)}
          >
            <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-line" />
            <div className="absolute left-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-gold" style={{ width: `${progress * 100}%` }} />
            {CHAPTERS.slice(1).map((c) => (
              <span key={c.t} className="absolute top-1/2 h-3 w-0.5 -translate-y-1/2 rounded bg-text/40" style={{ left: `${(c.t / DURATION) * 100}%` }} aria-hidden />
            ))}
            <span
              className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-gold bg-bg shadow transition-transform group-hover:scale-125"
              style={{ left: `${progress * 100}%` }}
              aria-hidden
            />
            {hover != null && (
              <span
                className="pointer-events-none absolute -bottom-7 -translate-x-1/2 whitespace-nowrap rounded-md border border-line bg-card px-2 py-0.5 text-[11px] text-text"
                style={{ left: `${(hover / DURATION) * 100}%` }}
              >
                {fmt(hover)} · {hoverChapter?.label}
              </span>
            )}
          </div>

          <span className="hidden w-[132px] shrink-0 truncate text-[11px] font-semibold uppercase tracking-[0.1em] text-gold sm:block">{chapter.label}</span>
          <button
            onClick={toggleVoice}
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition hover:bg-line ${voice ? 'text-gold' : 'text-sub'}`}
            aria-label={voice ? 'Turn narration off' : 'Turn narration on'}
            aria-pressed={voice}
            title="Read the script aloud"
          >
            {voice ? <Volume2 size={17} /> : <VolumeX size={17} />}
          </button>
          {!ended && (
            <button onClick={finish} className="flex h-8 shrink-0 items-center gap-1 rounded-full px-2.5 text-[12px] font-semibold text-sub transition hover:bg-line hover:text-text">
              Skip <SkipForward size={14} />
            </button>
          )}
        </div>
      </div>

      {soundBlocked && voice && !ended && (
        <div className="pointer-events-none absolute inset-x-0 top-[68px] z-20 flex justify-center">
          <span className="animate-fadeIn flex items-center gap-2 rounded-full border border-gold/60 bg-card/90 px-3.5 py-1.5 text-[12px] font-semibold text-gold shadow-panel backdrop-blur-md">
            <Volume2 size={14} aria-hidden /> Click anywhere to turn on sound
          </span>
        </div>
      )}

      {/* ---------- script captions ---------- */}
      <Caption t={t} />

      {/* ---------- logo + CTA ---------- */}
      <div
        className={`absolute inset-x-0 bottom-0 z-10 flex flex-col items-center gap-3 px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] transition-all duration-700 ${
          ended ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-3 opacity-0'
        }`}
      >
        <button
          onClick={finish}
          tabIndex={ended ? 0 : -1}
          className="btn group relative overflow-hidden bg-gold px-7 py-3 text-[16px] font-bold text-bg shadow-[0_0_34px_rgba(232,184,74,.55)] hover:brightness-110"
        >
          <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/50 to-transparent [animation:shimmer_2.4s_infinite]" aria-hidden />
          <span className="relative flex items-center gap-2">
            See the map <ArrowRight size={18} className="transition-transform group-hover:translate-x-1" aria-hidden />
          </span>
        </button>
        <button onClick={() => { seek(0); setPlay(true) }} tabIndex={ended ? 0 : -1} className="text-[12px] text-sub underline-offset-4 hover:text-text hover:underline">
          Replay introduction
        </button>
      </div>

    </div>
  )
}

function Caption({ t }: { t: number }) {
  const idx = cueIndexAt(t)
  const cue = idx >= 0 ? CUES[idx] : null
  const ended = t >= DURATION - 0.8
  const words = useMemo(() => (cue ? cue.text.split(' ') : []), [cue])
  if (!cue || ended) return <div className="absolute inset-x-0 bottom-[14%]" role="status" aria-live="polite" />
  const dur = cue.end - cue.start
  const revealT = Math.min(dur * 0.78, words.length * 0.3)
  const shown = Math.ceil(Math.min(1, (t - cue.start) / revealT) * words.length)
  const fadeOut = Math.max(0, Math.min(1, (cue.end - t) / 0.45))
  const hl = new Set(cue.hl ?? [])
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-[5%] z-10 flex justify-center px-5" role="status" aria-live="polite">
      <span className="sr-only">{cue.text}</span>
      <p
        aria-hidden
        className="max-w-[860px] rounded-2xl bg-bg/55 px-6 py-4 text-center font-display text-[clamp(18px,2.5vw,32px)] font-medium leading-[1.3] tracking-wide text-text backdrop-blur-sm"
        style={{ opacity: fadeOut }}
      >
        {words.map((wd, i) => {
          const key = wd.toLowerCase().replace(/[^a-z-]/g, '')
          return (
            <span
              key={i}
              className={`inline-block pr-[0.28em] transition-all duration-300 ${i < shown ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'} ${hl.has(key) ? 'text-gold' : ''}`}
            >
              {wd}
            </span>
          )
        })}
      </p>
    </div>
  )
}
