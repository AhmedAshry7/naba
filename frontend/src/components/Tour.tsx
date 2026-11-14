import { useCallback, useEffect, useRef, useState } from 'react'
import { SkipForward, Volume2, VolumeX } from 'lucide-react'
import { useStore, type FireTimeline } from '../store'
import { fitZoom, layerFor, storyMeta } from '../lib'
import type { ChangeStory, Layer } from '../types'
import { CALM, mouthAt, renderReporter, visemesFor, type Viseme } from '../intro/reporter'
import { pickKidVoice } from '../intro/voice'

/**
 * The guided tour that runs once the intro ends. The camera flies to three places in turn
 * (earthquake, flood, forest fire) and the real map layers switch from "before" to "after" while
 * the reporter explains in a few short sentences. Each scene stops on a Next button; Skip is always there.
 */

type Tone = 'before' | 'later' | 'after'
interface Badge { tone: Tone; text: string }

interface Ctx {
  story: ChangeStory
  fly: (extraZoom: number, ms: number) => void
  badge: (b: Badge | null) => void
  stat: (s: string | null) => void
  later: (ms: number, fn: () => void) => void
}

interface Scene {
  storyId: string
  label: string
  next: string
  end: number
  /** `text` is exactly what scripts/make-tour-voice.py records for this line. */
  cues: { at: number; text: string }[]
  actions: { at: number; run: (c: Ctx) => void }[]
}

const st = () => useStore.getState()
const shortDate = (iso: string) => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })

/** Step a numeric position from `from` to `to`, one step every `every` ms, calling `apply` on each. */
function stepThrough(c: Ctx, from: number, to: number, every: number, apply: (i: number, done: boolean) => void) {
  for (let i = from; i <= to; i++) c.later((i - from) * every, () => apply(i, i === to))
}

const fireLine = (): FireTimeline | undefined => st().fireTimelines['plaskett-burn-scar']

const SCENES: Scene[] = [
  {
    storyId: 'panama-azuero-m77',
    label: 'Earthquake',
    next: 'Next: floods',
    end: 12.4,
    cues: [
      { at: 0.2, text: "Let's start with earthquakes. This is Panama." },
      { at: 3.1, text: 'Here is the ground on 2 October, before.' },
      { at: 6.2, text: 'Then a magnitude 7.7 quake hit. The green shows the ground moved up to 1.2 metres.' },
    ],
    actions: [
      { at: 0, run: (c) => { st().setQuakeStep(0); c.badge(null); c.stat(null); c.fly(0, 3000) } },
      { at: 3.1, run: (c) => { c.badge({ tone: 'before', text: shortDate(c.story.period.start) }); c.fly(0.5, 4000) } },
      { at: 6.2, run: (c) => { st().setQuakeStep(1); c.badge({ tone: 'after', text: shortDate(c.story.period.end) }); c.stat(`Up to ${c.story.metric.value.toFixed(1)} m`) } },
    ],
  },
  {
    storyId: 'okavango-open-water',
    label: 'Floods',
    next: 'Next: forest fires',
    end: 12.4,
    cues: [
      { at: 0.2, text: 'Next, floods. This is the Okavango Delta.' },
      { at: 3.4, text: 'In June, nearly half of it was open water, about 48 percent.' },
      { at: 7.4, text: 'By October, only 14 percent was left. The water is shrinking.' },
    ],
    actions: [
      { at: 0, run: (c) => { st().setMonth(0); st().setPlaying(false); c.badge(null); c.stat(null); c.fly(0.3, 3000) } },
      { at: 3.4, run: (c) => { c.badge({ tone: 'before', text: st().months[0]?.label ?? 'June' }); c.fly(0.8, 4200) } },
      {
        at: 7.4,
        run: (c) => {
          const last = Math.max(0, st().months.length - 1)
          stepThrough(c, 1, last, 650, (i, done) => {
            st().setMonth(i)
            c.badge({ tone: done ? 'after' : 'later', text: st().months[i]?.label ?? '' })
            if (done) {
              const first = c.story.series[0]?.value ?? 48
              const end = c.story.series[c.story.series.length - 1]?.value ?? 14
              c.stat(`${Math.round(first)}% → ${end.toFixed(1)}%`)
            }
          })
        },
      },
    ],
  },
  {
    storyId: 'plaskett-burn-scar',
    label: 'Forest fire',
    next: 'Explore',
    end: 13.2,
    cues: [
      { at: 0.2, text: 'Last, forest fires. This is Big Sur, in California.' },
      { at: 3.8, text: 'Before, the forest is untouched.' },
      { at: 6.3, text: 'Radar sees through smoke, and maps a burn scar of about 31 square kilometres.' },
      { at: 11.1, text: "Now it's your turn to explore!" },
    ],
    actions: [
      { at: 0, run: (c) => { const f = fireLine(); if (f) st().setFireIndex(c.story.id, 0); c.badge(null); c.stat(null); c.fly(0, 3000) } },
      { at: 3.8, run: (c) => { const f = fireLine(); c.badge({ tone: 'before', text: f?.steps[0]?.label ?? 'Before' }); c.fly(0.6, 4500) } },
      {
        at: 6.3,
        run: (c) => {
          const f = fireLine()
          const last = f ? f.steps.length - 1 : 0
          stepThrough(c, 1, last, 620, (i, done) => {
            st().setFireIndex(c.story.id, i)
            c.badge({ tone: done ? 'after' : 'later', text: fireLine()?.steps[i]?.label ?? '' })
            if (done) c.stat(`~${Math.round(c.story.metric.value)} km² burned`)
          })
        },
      },
    ],
  },
]

/** The intro's own size rule for her (see drawReporter in intro/reporter.ts). */
const reporterHeight = (vw: number, vh: number) => (vw < 700 ? clamp(vh * 0.24, 130, 200) : clamp(vh * 0.4, 210, 370))

const TONE_LABEL: Record<Tone, string> = { before: 'Before', later: 'Later', after: 'After' }

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v))
const backOut = (x: number) => {
  const c1 = 1.70158, c3 = c1 + 1
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2)
}

/** A zoom that frames the story's area. */
function zoomFor(story: ChangeStory, layers: Layer[]): number {
  const layer = layerFor(layers, story)
  if (layer) return fitZoom(layer, 0.5)
  return story.area_km2 > 2000 ? 4.6 : story.area_km2 > 800 ? 5.6 : story.area_km2 > 200 ? 7.4 : 8.8
}

export default function Tour() {
  const step = useStore((s) => s.tourStep)
  const stories = useStore((s) => s.stories)
  const status = useStore((s) => s.status)
  const active = step !== null && status === 'ready'
  const scene = step !== null ? SCENES[step] : undefined
  const story = scene ? stories.find((s) => s.id === scene.storyId) : undefined

  const [cue, setCue] = useState<{ n: number; text: string } | null>(null)
  const [badge, setBadge] = useState<Badge | null>(null)
  const [stat, setStat] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [muted, setMuted] = useState(false)
  const [vp, setVp] = useState({ w: window.innerWidth, h: window.innerHeight })
  useEffect(() => {
    const on = () => setVp({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  const [run, setRun] = useState(0) // bumped by Repeat to replay the scene
  const mutedRef = useRef(false)
  const visemes = useRef<Viseme[]>([])
  const audio = useRef<HTMLAudioElement | null>(null)
  const saved = useRef<{ month: number; fire: Record<string, number> } | null>(null)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  // ---------- the narrator's voice (the mouth moves even when sound is off) ----------
  const stopVoice = useCallback(() => {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel()
    audio.current?.pause()
    visemes.current = []
  }, [])
  const clips = useRef<Map<string, boolean>>(new Map())
  const speak = useCallback(async (text: string, scene: number, n: number) => {
    stopVoice()
    const nowS = () => performance.now() / 1000
    const est = Math.max(1.4, text.split(/\s+/).length * 0.34)
    visemes.current = visemesFor(text, nowS(), est) // the mouth moves even with sound off
    if (mutedRef.current) return
    // the recorded clip (scripts/make-tour-voice.py) wins; the browser voice is only the fallback
    const url = `/intro/tour/tour-${scene}-${n}.mp3`
    if (!clips.current.has(url)) {
      try {
        const r = await fetch(url, { method: 'HEAD' })
        clips.current.set(url, r.ok && (r.headers.get('content-type') ?? '').startsWith('audio'))
      } catch { clips.current.set(url, false) }
    }
    if (clips.current.get(url)) {
      const a = (audio.current ??= new Audio())
      a.src = url
      a.onloadedmetadata = () => { if (Number.isFinite(a.duration)) visemes.current = visemesFor(text, nowS(), a.duration) }
      a.onended = () => { visemes.current = [] }
      a.play().catch(() => {})
      return
    }
    if (!('speechSynthesis' in window)) return
    const v = pickKidVoice()
    const u = new SpeechSynthesisUtterance(text)
    if (v) u.voice = v
    const natural = !!v && /ana|natural|online/i.test(v.name)
    u.pitch = natural ? 1.2 : 1.6
    u.rate = 1.08
    u.onstart = () => { visemes.current = visemesFor(text, nowS(), est) }
    u.onend = () => { visemes.current = [] }
    window.speechSynthesis.speak(u)
  }, [stopVoice])

  // ---------- leaving the tour: put the map back the way an explorer expects ----------
  const finish = useCallback(() => {
    stopVoice()
    const s = st()
    s.select(null) // closes an open story panel (and resets the earthquake to 'before')
    const keep = saved.current
    s.set({ tourStep: null, tourStory: null, tourReady: false, quakeStep: 0, isPlaying: false })
    if (keep) {
      s.setMonth(Math.min(keep.month, Math.max(0, s.months.length - 1)))
      for (const [id, i] of Object.entries(keep.fire)) s.setFireIndex(id, i)
    }
    s.moveCamera('globe')
    saved.current = null
  }, [stopVoice])

  // remember what the slider and burn layers were showing before the tour moved them
  useEffect(() => {
    if (step === null || saved.current) return
    const s = st()
    saved.current = { month: s.monthIndex, fire: Object.fromEntries(Object.entries(s.fireTimelines).map(([id, t]) => [id, t.index])) }
  }, [step])

  // ---------- run one scene on a clock ----------
  useEffect(() => {
    if (!active || !scene || !story) return
    const timers: number[] = []
    const later = (ms: number, fn: () => void) => { timers.push(window.setTimeout(fn, ms)) }
    const layers = st().layers
    const ctx: Ctx = {
      story,
      later,
      badge: setBadge,
      stat: setStat,
      fly: (extra, ms) => {
        const cam = st().tourCam
        st().set({ tourCam: { center: [story.lon, story.lat], zoom: zoomFor(story, layers) + extra, duration: ms, n: (cam?.n ?? 0) + 1 } })
      },
    }
    st().select(null)
    st().set({ tourStory: story.id })
    setReady(false)
    st().set({ tourReady: false })
    setCue(null)
    setBadge(null)
    setStat(null)
    scene.actions.forEach((a) => later(a.at * 1000, () => a.run(ctx)))
    scene.cues.forEach((c, n) => later(c.at * 1000, () => { setCue({ n, text: c.text }); void speak(c.text, step!, n) }))
    later(scene.end * 1000, () => {
      // the scene is over: hand the map back and open the story panel (with its slider / switch)
      setReady(true)
      const keepQuake = story.change_type === 'earthquake' ? 1 : null
      st().select(story.id)
      if (keepQuake !== null) st().setQuakeStep(keepQuake) // select() starts an earthquake on 'before'
      st().set({ tourReady: true })
    })
    return () => { timers.forEach(clearTimeout); stopVoice() }
  }, [active, scene, story, step, run, speak, stopVoice])

  // ---------- draw the reporter ----------
  useEffect(() => {
    if (!active) return
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
    const born = performance.now()
    let raf = 0
    const frame = (now: number) => {
      const t = now / 1000
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
      const H = reporterHeight(window.innerWidth, window.innerHeight)
      const rise = 1 - backOut(clamp(((now - born) / 1000 - 0.15) / 0.9)) // pops up from the bottom edge
      const list = visemes.current
      renderReporter(ctx, w, h, t, {
        side: 'left',
        rise: clamp(rise, 0, 1.2),
        H,
        mouth: mouthAt(t, list),
        calm: CALM, // the same calm hands as the intro
        edge: window.innerWidth < 700 ? 10 : 40,
        energyAt: (dt) => mouthAt(t - dt, list).o,
      })
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => { cancelAnimationFrame(raf); ro.disconnect() }
  }, [active])

  // keyboard: Enter / right arrow = Next once it is showing
  const goNext = useCallback(() => {
    if (step === null) return
    if (step >= SCENES.length - 1) finish()
    else st().set({ tourStep: step + 1 })
  }, [step, finish])
  const goPrev = useCallback(() => {
    if (step !== null && step > 0) st().set({ tourStep: step - 1 })
  }, [step])
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') { e.preventDefault(); goPrev() }
      else if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); goNext() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, goNext, goPrev])

  if (!active || !scene || !story) return null
  const accent = storyMeta(story).color
  const rh = reporterHeight(vp.w, vp.h)
  const rw = (rh / 3.2) * 1.4 * 0.5 + (vp.w < 700 ? 10 : 40) + (rh / 3.2) * 1.15 // the reporter's strip, same as the intro's spot
  const words = cue ? cue.text.split(' ') : []

  return (
    <div className="pointer-events-none absolute inset-0 z-30" role="dialog" aria-label="Guided tour">
      {/* keeps the map still while it is driven for the visitor; once the scene stops, the map is theirs */}
      {!ready && <div className="pointer-events-auto absolute inset-0" aria-hidden />}

      {/* progress + sound */}
      <div className="pointer-events-none absolute left-0 top-0 flex items-center gap-2 p-3 pl-[56px] pt-[72px] sm:pt-[76px]">
        <div className="pointer-events-auto flex items-center gap-2.5 rounded-full border border-line bg-bg/85 px-3.5 py-2 shadow-card backdrop-blur">
          <span className="flex gap-1.5" aria-hidden>
            {SCENES.map((s, i) => (
              <span key={s.storyId} className="h-1.5 rounded-full transition-all duration-500" style={{ width: i === step ? 22 : 8, background: i <= (step ?? 0) ? accent : 'rgba(255,255,255,.22)' }} />
            ))}
          </span>
          <span className="text-[12px] font-semibold uppercase tracking-[0.1em] text-sub">
            {(step ?? 0) + 1} of {SCENES.length} · {scene.label}
          </span>
        </div>
      </div>

      {/* before / after badge + the headline number */}
      <div className={`pointer-events-none absolute inset-x-0 top-[132px] flex flex-col items-center gap-2 px-3 sm:top-[136px] ${ready ? 'max-lg:hidden' : ''}`}>
        {badge && (
          <div key={`${badge.tone}-${badge.text}`} className="animate-rise flex items-center gap-3 rounded-full border bg-bg/90 py-2 pl-2 pr-5 shadow-panel backdrop-blur"
            style={{ borderColor: `${accent}88` }}>
            <span className="rounded-full px-3 py-1 text-[12px] font-extrabold uppercase tracking-[0.12em] text-bg" style={{ background: accent }}>
              {TONE_LABEL[badge.tone]}
            </span>
            <span className="font-display text-[20px] font-semibold tabular-nums">{badge.text}</span>
          </div>
        )}
        {stat && (
          <div key={stat} className="animate-rise rounded-2xl border bg-bg/90 px-5 py-2 font-display text-[clamp(26px,4vw,40px)] font-semibold shadow-panel backdrop-blur"
            style={{ borderColor: `${accent}88`, color: accent }}>
            {stat}
          </div>
        )}
      </div>

      {/* the reporter (same size and place as in the intro) with the caption in the intro's style;
          every control sits under the caption. On phones the story sheet takes the bottom once the
          scene stops, so the caption moves to the top. */}
      <div ref={wrapRef} className={`pointer-events-none absolute bottom-0 left-0 ${ready ? 'max-lg:hidden' : ''}`} style={{ height: rh + 14, width: rw }}>
        <canvas ref={canvasRef} className="h-full w-full" aria-hidden />
      </div>
      <div
        className={`pointer-events-none absolute inset-x-0 flex flex-col items-center gap-3 pb-[max(1.25rem,3%)] ${ready ? 'max-lg:top-[116px] max-lg:bottom-auto lg:bottom-0' : 'bottom-0'}`}
        style={{ paddingLeft: ready && vp.w < 1024 ? 12 : rw, paddingRight: ready && vp.w >= 1024 ? (vp.w >= 1280 ? 490 : 470) : ready ? 12 : rw }}
      >
        <div className="flex w-full min-w-0 flex-col items-center gap-3">
          <p
            className="pointer-events-none max-w-[860px] rounded-2xl bg-bg/55 px-6 py-4 text-center font-display text-[clamp(18px,2.5vw,32px)] font-medium leading-[1.3] tracking-wide text-text backdrop-blur-sm"
            aria-live="polite"
            key={cue?.n ?? -1}
          >
            {words.map((w, i) => (
              <span key={i} className={`inline-block pr-[0.28em] animate-fadeIn ${/\d|earthquake|flood|forest|radar/i.test(w) ? 'text-gold' : ''}`} style={{ animationDelay: `${i * 0.16}s` }}>
                {w}
              </span>
            ))}
          </p>
          <div className="pointer-events-auto flex flex-wrap items-center justify-center gap-1 rounded-full border border-line bg-card/85 p-1.5 shadow-panel backdrop-blur-md">
            <button onClick={() => setRun((n) => n + 1)} className="flex h-8 shrink-0 items-center gap-1 rounded-full px-2.5 text-[12px] font-semibold text-sub transition hover:bg-line hover:text-text">
              Repeat
            </button>
            <button
              onClick={goPrev}
              disabled={(step ?? 0) === 0}
              className="flex h-8 shrink-0 items-center gap-1 rounded-full px-2.5 text-[12px] font-semibold text-sub transition hover:bg-line hover:text-text disabled:pointer-events-none disabled:opacity-35"
            >
              Previous
            </button>
            <button onClick={finish} className="flex h-8 shrink-0 items-center gap-1 rounded-full px-2.5 text-[12px] font-semibold text-sub transition hover:bg-line hover:text-text">
              Skip <SkipForward size={14} />
            </button>
            <button
              onClick={() => { mutedRef.current = !muted; setMuted(!muted); if (!muted) stopVoice() }}
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition hover:bg-line ${muted ? 'text-sub' : 'text-gold'}`}
              aria-label={muted ? 'Turn narration on' : 'Turn narration off'}
              aria-pressed={!muted}
              title="Read the script aloud"
            >
              {muted ? <VolumeX size={17} /> : <Volume2 size={17} />}
            </button>
            <button
              onClick={goNext}
              className={`btn !h-8 rounded-full bg-gold !px-4 !py-0 text-[12px] font-semibold text-bg transition-opacity duration-500 hover:bg-[#D9A63F] `}
            >
              {scene.next}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
