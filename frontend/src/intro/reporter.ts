/**
 * The Naba reporter: a full-body cartoon news reporter standing on the bottom edge of the screen.
 * She rises up on the right while the optical sensor is on screen, ducks below the edge during the fight,
 * and rises again on the left when the NISAR radar panel appears. Her mouth is lip-synced to the script.
 */
import { CUES, T } from './script'
import type { Layout } from './scene'

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v))
const seg = (t: number, a: number, b: number) => clamp((t - a) / (b - a))
const ease = (x: number) => x * x * (3 - 2 * x)
const lerp = (a: number, b: number, x: number) => a + (b - a) * x
const backOut = (x: number) => {
  const c1 = 1.70158, c3 = c1 + 1
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2)
}

// ---------- lip-sync: turn each spoken line into timed mouth shapes ----------
interface Viseme { t0: number; t1: number; o: number; w: number }

const VOWEL_OPEN: Record<string, number> = { a: 1, e: 0.6, i: 0.5, o: 0.85, u: 0.7, y: 0.5 }
const VOWEL_WIDE: Record<string, number> = { a: 0.9, e: 1, i: 1, o: 0.1, u: 0, y: 1 }

/** Mouth shapes for one spoken line that starts at `start` and takes `say` seconds. */
export function visemesFor(text: string, start: number, say: number): Viseme[] {
  const out: Viseme[] = []
  {
    const cue = { text, start }
    const tokens = cue.text.replace(/[–—-]/g, ' ').split(/\s+/).filter(Boolean)
    const info = tokens.map((tk) => {
      const letters = tk.replace(/[^a-z]/gi, '').length || 1
      const pause = /[.!?…]$/.test(tk) ? 3.2 : /,$/.test(tk) ? 2.2 : 0.4
      return { tk, letters, pause }
    })
    const total = info.reduce((a, b) => a + b.letters + b.pause, 0)
    let t = cue.start
    for (const { tk, letters, pause } of info) {
      const wordDur = (say * letters) / total
      const groups = [...tk.matchAll(/[aeiouy]+/gi)]
      for (const g of groups) {
        const idx = g.index ?? 0
        const center = t + (wordDur * (idx + g[0].length / 2)) / Math.max(letters, tk.length)
        const half = Math.max(0.07, (wordDur / Math.max(groups.length, 1)) * 0.46)
        const v = g[0][0].toLowerCase()
        out.push({ t0: center - half, t1: center + half, o: VOWEL_OPEN[v] ?? 0.6, w: VOWEL_WIDE[v] ?? 0.6 })
      }
      t += (say * (letters + pause)) / total
    }
  }
  return out
}
export type { Viseme }
const VISEMES: Viseme[] = CUES.flatMap((c) => visemesFor(c.text, c.start, c.say ?? Math.min(c.end - c.start, 3)))

/** Mouth openness (0..1) and width (0 = round "oo", 1 = wide "ee") at time t. */
export function mouthAt(t: number, list: Viseme[] = VISEMES): { o: number; w: number } {
  let o = 0, w = 0.6
  for (const v of list) {
    if (t <= v.t0 || t >= v.t1) continue
    const env = Math.pow(Math.sin((Math.PI * (t - v.t0)) / (v.t1 - v.t0)), 2) * v.o
    if (env > o) { o = env; w = v.w }
  }
  return { o, w }
}

// ---------- presence: where she stands, and whether she is up or ducked below the screen edge ----------
function presence(t: number, portrait: boolean) {
  const exitAt = T.kick + 0.65 // ducks down once the optical panel is leaving
  const backAt = T.kick + 1.2 // rises on the left as the radar panel arrives
  if (t < backAt - 0.1) {
    const up = backOut(seg(t, 0.45, 1.15))
    const down = ease(seg(t, exitAt, exitAt + 0.5))
    return { side: 'right' as const, rise: Math.max(0, 1 - up) + down }
  }
  return { side: portrait ? ('right' as const) : ('left' as const), rise: 1 - backOut(seg(t, backAt, backAt + 0.7)) }
}

// ---------- drawing ----------
export function drawReporter(ctx: CanvasRenderingContext2D, L: Layout, t: number) {
  const { w, h, portrait } = L
  const pr = presence(t, portrait)
  if (pr.rise >= 1.2) return
  const H = portrait ? clamp(h * 0.24, 130, 200) : clamp(h * 0.4, 210, 370) // whole-body height in px
  renderReporter(ctx, w, h, t, { side: pr.side, rise: pr.rise, H, mouth: mouthAt(t), calm: CALM, edge: portrait ? 10 : 40 })
}

/** How much her free hand moves while she talks: small, so she stays calm and the words do the work. */
export const CALM = 0.1

export interface ReporterOpts {
  side: 'left' | 'right'
  /** 0 = standing on the bottom edge, 1 = ducked below it */
  rise: number
  /** whole-body height in px */
  H: number
  mouth: { o: number; w: number }
  /** 1 = the intro's lively gestures, smaller = calmer hands */
  calm: number
  edge: number
  /** the mouth shape a moment ago, to work out how animated she is */
  energyAt?: (dt: number) => number
}

/** Draws the reporter standing on the bottom edge of a w x h canvas. */
export function renderReporter(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, o: ReporterOpts) {
  const pr = { side: o.side, rise: o.rise }
  const H = o.H
  const s = H / 3.2 // 1 unit = 1/3.2 of her height
  const figW = s * 1.4
  const bx = pr.side === 'right' ? w - figW / 2 - o.edge : figW / 2 + o.edge
  const by = h - 6 + pr.rise * (H * 1.12) // feet rest on the bottom edge; rise pushes her below the screen

  const m = o.mouth
  const past = o.energyAt ?? ((dt: number) => mouthAt(t - dt).o)
  const energy = clamp((m.o + past(0.1) + past(0.2) + past(0.3)) / 2) // how animated she is right now
  const pose: Pose = {
    o: m.o, wide: m.w, energy, calm: o.calm,
    blink: (t * 0.33 + 0.1) % 1 < 0.045 ? 0.12 : 1,
    // she stands almost still: a slow, tiny sway and breath, nothing that follows the syllables
    sway: Math.sin(t * 0.7) * 0.006,
    breathe: Math.sin(t * 1.1) * 0.004,
  }

  // soft floor glow (stays on the screen edge even while she ducks)
  ctx.save()
  ctx.translate(bx, h - 4)
  const fade = clamp(1 - pr.rise)
  const gl = ctx.createRadialGradient(0, 0, 0, 0, 0, figW * 1.1)
  gl.addColorStop(0, `rgba(232,184,74,${0.22 * fade})`); gl.addColorStop(1, 'rgba(232,184,74,0)')
  ctx.fillStyle = gl; ctx.beginPath(); ctx.ellipse(0, 0, figW * 1.1, figW * 0.28, 0, 0, Math.PI * 2); ctx.fill()
  ctx.restore()

  ctx.save()
  ctx.translate(bx, by)
  ctx.scale(pr.side === 'right' ? s : -s, s) // she faces the middle of the screen
  ctx.fillStyle = 'rgba(0,0,0,.35)'
  ctx.beginPath(); ctx.ellipse(0, 0.02, 0.75, 0.09, 0, 0, Math.PI * 2); ctx.fill()
  drawBody(ctx, t, pose)
  ctx.restore()
}

interface Pose { o: number; wide: number; energy: number; calm: number; blink: number; sway: number; breathe: number }

const SKIN = '#E9AE83', SKIN_SHADE = '#D2976C', HAIR = '#2A1A17', HAIR_LIGHT = '#4A2E27', BLAZER = '#0B4BAA', TROUSER = '#17264A', GOLD = '#E8B84A'

/** Whole figure. Units: feet at y = 0, top of head at about y = -3.2, y grows downward. */
function drawBody(ctx: CanvasRenderingContext2D, t: number, p: Pose) {
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'

  // ----- legs + shoes -----
  for (const sx of [-1, 1]) {
    ctx.fillStyle = TROUSER
    ctx.beginPath(); ctx.roundRect(sx < 0 ? -0.3 : 0.04, -1.25, 0.26, 1.12, 0.06); ctx.fill()
    ctx.fillStyle = '#F4F7FF'
    ctx.beginPath(); ctx.ellipse(sx * 0.21, -0.08, 0.2, 0.09, 0, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = GOLD
    ctx.beginPath(); ctx.ellipse(sx * 0.21, -0.02, 0.2, 0.025, 0, 0, Math.PI * 2); ctx.fill()
  }

  ctx.save()
  ctx.translate(0, p.breathe) // everything above the hips breathes a little

  // ----- free arm (left of screen), gestures while she talks -----
  const gesture = 0.22 + (0.02 + 0.2 * p.calm * p.energy) * Math.sin(t * 0.8) + 0.03 * p.calm * p.energy
  const shL = { x: -0.5, y: -1.97 }
  const elL = { x: -0.62, y: -1.55 }
  const handL = { x: elL.x - 0.44 * Math.sin(gesture), y: elL.y + 0.44 * Math.cos(gesture) }
  ctx.strokeStyle = BLAZER; ctx.lineWidth = 0.2
  ctx.beginPath(); ctx.moveTo(shL.x, shL.y); ctx.lineTo(elL.x, elL.y); ctx.lineTo(handL.x, handL.y); ctx.stroke()
  ctx.fillStyle = SKIN; ctx.beginPath(); ctx.arc(handL.x, handL.y, 0.085, 0, 6.3); ctx.fill()

  // ----- torso: blazer, blouse, belt -----
  ctx.fillStyle = BLAZER
  ctx.beginPath()
  ctx.moveTo(-0.56, -2.0); ctx.bezierCurveTo(-0.62, -1.7, -0.5, -1.4, -0.44, -1.1)
  ctx.lineTo(0.44, -1.1); ctx.bezierCurveTo(0.5, -1.4, 0.62, -1.7, 0.56, -2.0)
  ctx.bezierCurveTo(0.35, -2.12, -0.35, -2.12, -0.56, -2.0); ctx.closePath(); ctx.fill()
  ctx.fillStyle = '#F4F7FF'
  ctx.beginPath(); ctx.moveTo(-0.19, -2.08); ctx.lineTo(0.19, -2.08); ctx.lineTo(0, -1.62); ctx.closePath(); ctx.fill()
  ctx.strokeStyle = GOLD; ctx.lineWidth = 0.03
  ctx.beginPath(); ctx.moveTo(-0.3, -2.08); ctx.lineTo(-0.02, -1.55); ctx.moveTo(0.3, -2.08); ctx.lineTo(0.02, -1.55); ctx.stroke()
  ctx.fillStyle = '#0B1426'; ctx.fillRect(-0.45, -1.28, 0.9, 0.09)
  ctx.fillStyle = GOLD; ctx.beginPath(); ctx.roundRect(-0.07, -1.3, 0.14, 0.13, 0.02); ctx.fill()
  ctx.beginPath(); ctx.arc(-0.33, -1.8, 0.05, 0, 6.3); ctx.fill() // lapel pin

  // ----- neck + head -----
  ctx.fillStyle = SKIN_SHADE
  ctx.beginPath(); ctx.roundRect(-0.12, -2.28, 0.24, 0.3, 0.05); ctx.fill()
  ctx.save()
  ctx.translate(0, -2.5)
  drawHead(ctx, t, p)
  ctx.restore()

  // ----- mic arm (right of screen), mic held up to her mouth -----
  const wob = 0
  const shR = { x: 0.5, y: -1.97 }
  const elR = { x: 0.74, y: -1.5 }
  const handR = { x: 0.5 + wob, y: -1.98 + wob }
  ctx.strokeStyle = BLAZER; ctx.lineWidth = 0.2
  ctx.beginPath(); ctx.moveTo(shR.x, shR.y); ctx.lineTo(elR.x, elR.y); ctx.lineTo(handR.x, handR.y); ctx.stroke()
  const micHead = { x: 0.29 + wob, y: -2.17 + wob }
  const ang = Math.atan2(micHead.y - handR.y, micHead.x - handR.x)
  ctx.save()
  ctx.translate(handR.x, handR.y); ctx.rotate(ang)
  ctx.fillStyle = '#2B2F3F'; ctx.beginPath(); ctx.roundRect(-0.03, -0.035, 0.27, 0.07, 0.03); ctx.fill() // handle
  ctx.fillStyle = SKIN; ctx.beginPath(); ctx.arc(0.02, 0, 0.085, 0, 6.3); ctx.fill() // hand
  ctx.fillStyle = GOLD; ctx.fillRect(0.2, -0.045, 0.04, 0.09)
  const mg = ctx.createRadialGradient(0.27, -0.03, 0.01, 0.3, 0, 0.1)
  mg.addColorStop(0, '#FFE9A0'); mg.addColorStop(1, '#C8902A')
  ctx.fillStyle = mg; ctx.beginPath(); ctx.arc(0.31, 0, 0.09, 0, Math.PI * 2); ctx.fill() // mic head
  ctx.strokeStyle = 'rgba(80,50,10,.45)'; ctx.lineWidth = 0.012
  ctx.beginPath(); ctx.moveTo(0.31, -0.08); ctx.lineTo(0.31, 0.08); ctx.moveTo(0.23, 0); ctx.lineTo(0.39, 0); ctx.stroke()
  ctx.restore()
  ctx.restore() // breathing
}

/** Head with hair, face and lip-synced mouth. Origin = middle of the head. */
function drawHead(ctx: CanvasRenderingContext2D, t: number, p: Pose) {
  // ponytail + hair behind the head
  ctx.save()
  ctx.translate(0.3, -0.34); ctx.rotate(0.5 + p.sway * 4 + Math.sin(t * 0.9) * 0.02)
  ctx.fillStyle = HAIR
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.bezierCurveTo(0.34, -0.02, 0.5, 0.3, 0.3, 0.55); ctx.bezierCurveTo(0.26, 0.28, 0.12, 0.12, 0, 0.1); ctx.closePath(); ctx.fill()
  ctx.restore()
  ctx.fillStyle = HAIR
  ctx.beginPath(); ctx.ellipse(0, -0.1, 0.5, 0.52, 0, 0, Math.PI * 2); ctx.fill()

  ctx.save()
  ctx.translate(0, 0.12); ctx.rotate(p.sway); ctx.translate(0, -0.12)
  ctx.fillStyle = SKIN
  for (const ex of [-0.37, 0.37]) { ctx.beginPath(); ctx.arc(ex, 0.03, 0.06, 0, 6.3); ctx.fill() }
  ctx.beginPath(); ctx.ellipse(0, -0.06, 0.36, 0.42, 0, 0, Math.PI * 2); ctx.fill()

  // bangs
  ctx.fillStyle = HAIR
  ctx.beginPath()
  ctx.moveTo(-0.39, -0.02); ctx.bezierCurveTo(-0.44, -0.62, 0.44, -0.66, 0.39, -0.02)
  ctx.bezierCurveTo(0.33, -0.27, 0.12, -0.36, -0.08, -0.3); ctx.bezierCurveTo(-0.22, -0.26, -0.32, -0.14, -0.39, -0.02); ctx.closePath(); ctx.fill()
  ctx.strokeStyle = HAIR_LIGHT; ctx.lineWidth = 0.02
  ctx.beginPath(); ctx.moveTo(-0.28, -0.44); ctx.quadraticCurveTo(-0.05, -0.55, 0.2, -0.46); ctx.stroke()
  ctx.fillStyle = GOLD; ctx.beginPath(); ctx.arc(0.33, -0.33, 0.045, 0, 6.3); ctx.fill() // hair tie

  // eyes + brows
  for (const s of [-1, 1]) {
    const ex = s * 0.14, ey = -0.06
    ctx.fillStyle = '#fff'
    ctx.beginPath(); ctx.ellipse(ex, ey, 0.085, 0.1 * p.blink, 0, 0, Math.PI * 2); ctx.fill()
    if (p.blink > 0.5) {
      ctx.fillStyle = '#3B2417'; ctx.beginPath(); ctx.arc(ex - 0.012, ey + 0.005, 0.062, 0, 6.3); ctx.fill()
      ctx.fillStyle = '#120A07'; ctx.beginPath(); ctx.arc(ex - 0.012, ey + 0.005, 0.036, 0, 6.3); ctx.fill()
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(ex + 0.008, ey - 0.025, 0.017, 0, 6.3); ctx.fill()
    }
    ctx.strokeStyle = '#1B0F0C'; ctx.lineWidth = 0.022
    ctx.beginPath(); ctx.moveTo(ex - 0.09, ey - 0.02); ctx.quadraticCurveTo(ex, ey - 0.12 * Math.max(p.blink, 0.3), ex + 0.09, ey - 0.02); ctx.stroke()
    const lift = 0.012 + p.o * 0.02
    ctx.lineWidth = 0.028; ctx.strokeStyle = HAIR
    ctx.beginPath(); ctx.moveTo(ex - 0.09, -0.2 - lift + s * 0.012); ctx.quadraticCurveTo(ex, -0.25 - lift, ex + 0.09, -0.2 - lift - s * 0.012); ctx.stroke()
  }
  // nose + blush
  ctx.strokeStyle = SKIN_SHADE; ctx.lineWidth = 0.02
  ctx.beginPath(); ctx.moveTo(-0.015, 0.03); ctx.quadraticCurveTo(0.025, 0.07, -0.01, 0.085); ctx.stroke()
  ctx.fillStyle = 'rgba(240,110,120,.32)'
  for (const s of [-1, 1]) { ctx.beginPath(); ctx.ellipse(s * 0.23, 0.1, 0.06, 0.035, 0, 0, Math.PI * 2); ctx.fill() }

  // mouth, lip-synced to the script
  const my = 0.19
  if (p.o < 0.07) {
    ctx.strokeStyle = '#B5424C'; ctx.lineWidth = 0.026
    ctx.beginPath(); ctx.moveTo(-0.075, my - 0.005); ctx.quadraticCurveTo(0, my + 0.045, 0.075, my - 0.005); ctx.stroke()
  } else {
    const rx = lerp(0.052, 0.1, p.wide)
    const ry = 0.014 + 0.088 * p.o
    ctx.save()
    ctx.beginPath(); ctx.ellipse(0, my + ry * 0.35, rx, ry, 0, 0, Math.PI * 2)
    ctx.fillStyle = '#5A1620'; ctx.fill()
    ctx.clip()
    ctx.fillStyle = '#fff'; ctx.fillRect(-rx, my + ry * 0.35 - ry, rx * 2, ry * 0.55)
    ctx.fillStyle = '#E5707A'; ctx.beginPath(); ctx.ellipse(0, my + ry * 0.35 + ry * 0.75, rx * 0.65, ry * 0.5, 0, 0, Math.PI * 2); ctx.fill()
    ctx.restore()
    ctx.strokeStyle = '#B5424C'; ctx.lineWidth = 0.022
    ctx.beginPath(); ctx.ellipse(0, my + ry * 0.35, rx, ry, 0, 0, Math.PI * 2); ctx.stroke()
  }
  ctx.restore()
}
