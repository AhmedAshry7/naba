/**
 * Canvas renderer for the intro story. `draw(ctx, w, h, t)` is a pure function of the master clock `t`,
 * so the player can scrub to any moment (forwards or backwards) and the picture is always correct.
 */
import { T } from './script'
import { drawReporter } from './reporter'

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v))
const seg = (t: number, a: number, b: number) => clamp((t - a) / (b - a))
const ease = (x: number) => x * x * (3 - 2 * x)
const easeOut = (x: number) => 1 - Math.pow(1 - x, 3)
const lerp = (a: number, b: number, x: number) => a + (b - a) * x
const smooth = (a: number, b: number, v: number) => ease(clamp((v - a) / (b - a)))

// ---------- deterministic noise ----------
function hash3(x: number, y: number, z: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483629)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295
}
function noise3(x: number, y: number, z: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z)
  const fx = x - xi, fy = y - yi, fz = z - zi
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz)
  const l = (a: number, b: number, k: number) => a + (b - a) * k
  return l(
    l(l(hash3(xi, yi, zi), hash3(xi + 1, yi, zi), u), l(hash3(xi, yi + 1, zi), hash3(xi + 1, yi + 1, zi), u), v),
    l(l(hash3(xi, yi, zi + 1), hash3(xi + 1, yi, zi + 1), u), l(hash3(xi, yi + 1, zi + 1), hash3(xi + 1, yi + 1, zi + 1), u), v),
    w,
  )
}
function fbm(x: number, y: number, z: number, oct: number): number {
  let a = 0.5, f = 1, s = 0, tot = 0
  for (let i = 0; i < oct; i++) {
    s += a * noise3(x * f, y * f, z * f)
    tot += a
    a *= 0.5
    f *= 2.03
  }
  return s / tot
}
function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

// ---------- globe textures (built once) ----------
const TW = 768, TH = 384
let baseTex: Uint8ClampedArray | null = null // RGB + land flag in alpha
let cloudTex: Uint8Array | null = null

function buildTextures() {
  baseTex = new Uint8ClampedArray(TW * TH * 4)
  cloudTex = new Uint8Array(TW * TH)
  for (let j = 0; j < TH; j++) {
    const lat = Math.PI / 2 - ((j + 0.5) / TH) * Math.PI
    const cl = Math.cos(lat), sl = Math.sin(lat)
    for (let i = 0; i < TW; i++) {
      const lon = ((i + 0.5) / TW) * Math.PI * 2 - Math.PI
      const px = cl * Math.cos(lon), py = sl, pz = cl * Math.sin(lon)
      const warp = noise3(px * 2 + 5, py * 2, pz * 2) - 0.5
      const h = fbm(px * 1.5 + warp * 0.5 + 3.1, py * 1.5 + warp * 0.5, pz * 1.5 + 7.7, 5)
      const o = (j * TW + i) * 4
      const land = h > 0.545
      let r: number, g: number, b: number
      if (land) {
        const e = clamp((h - 0.545) / 0.16)
        const dry = fbm(px * 2.2 + 11, py * 2.2 + 4, pz * 2.2, 3)
        // green lowlands -> tan/desert -> rocky highlands
        const gr: [number, number, number] = [52, 116, 62]
        const sand: [number, number, number] = [192, 164, 104]
        const rock: [number, number, number] = [128, 112, 92]
        const d = smooth(0.46, 0.62, dry) * (1 - Math.abs(sl) * 0.8)
        r = lerp(gr[0], sand[0], d); g = lerp(gr[1], sand[1], d); b = lerp(gr[2], sand[2], d)
        r = lerp(r, rock[0], smooth(0.5, 1, e)); g = lerp(g, rock[1], smooth(0.5, 1, e)); b = lerp(b, rock[2], smooth(0.5, 1, e))
      } else {
        const d = clamp((0.545 - h) / 0.22)
        r = lerp(34, 6, d); g = lerp(118, 38, d); b = lerp(176, 102, d)
      }
      const ice = smooth(1.12, 1.32, Math.abs(lat) + (noise3(px * 6, py * 6, pz * 6) - 0.5) * 0.25)
      if (ice > 0) {
        r = lerp(r, 226, ice); g = lerp(g, 238, ice); b = lerp(b, 250, ice)
      }
      baseTex[o] = r; baseTex[o + 1] = g; baseTex[o + 2] = b
      baseTex[o + 3] = land || ice > 0.4 ? 255 : 0
      cloudTex[j * TW + i] = clamp(fbm(px * 2.3 + 9.1, py * 3.1 + 3.3, pz * 2.3 + 5.7, 5)) * 255
    }
  }
}

// ---------- globe sampler (static per-pixel geometry precomputed) ----------
const N = 300
const TILT = 0.38
const TARGET_U = { x: -0.12, y: 0.1 } // where the satellites look, in unit-disc coordinates
interface Sampler {
  cnv: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  img: ImageData
  X: Float32Array; Z: Float32Array; row: Uint16Array
  shade: Float32Array; spec: Float32Array; fres: Float32Array; edge: Float32Array; blob: Float32Array
  inside: Uint8Array
}
let sampler: Sampler | null = null

function buildSampler(): Sampler {
  const cnv = document.createElement('canvas')
  cnv.width = cnv.height = N
  const ctx = cnv.getContext('2d')!
  const img = ctx.createImageData(N, N)
  const n = N * N
  const s: Sampler = {
    cnv, ctx, img,
    X: new Float32Array(n), Z: new Float32Array(n), row: new Uint16Array(n),
    shade: new Float32Array(n), spec: new Float32Array(n), fres: new Float32Array(n), edge: new Float32Array(n), blob: new Float32Array(n),
    inside: new Uint8Array(n),
  }
  const ct = Math.cos(TILT), st = Math.sin(TILT)
  let lx = -0.55, ly = 0.42, lz = 0.72
  const ll = Math.hypot(lx, ly, lz); lx /= ll; ly /= ll; lz /= ll
  let hx = lx, hy = ly, hz = lz + 1
  const hl = Math.hypot(hx, hy, hz); hx /= hl; hy /= hl; hz /= hl
  for (let py = 0; py < N; py++) {
    for (let px = 0; px < N; px++) {
      const k = py * N + px
      const x = ((px + 0.5) / N) * 2 - 1
      const y = 1 - ((py + 0.5) / N) * 2
      const r2 = x * x + y * y
      const r = Math.sqrt(r2)
      s.edge[k] = clamp((1 - r) * N * 0.5)
      if (r2 >= 1) continue
      s.inside[k] = 1
      const z = Math.sqrt(1 - r2)
      const dot = x * lx + y * ly + z * lz
      s.shade[k] = 0.14 + 0.95 * Math.pow(Math.max(0, dot), 0.85)
      s.spec[k] = Math.pow(Math.max(0, x * hx + y * hy + z * hz), 42)
      s.fres[k] = Math.pow(1 - z, 3)
      // tilt about X
      const y1 = y * ct + z * st
      const z1 = -y * st + z * ct
      s.X[k] = x
      s.Z[k] = z1
      s.row[k] = clamp(0.5 - Math.asin(clamp(y1, -1, 1)) / Math.PI, 0, 0.9999) * TH | 0
      const dd = Math.hypot(x - TARGET_U.x, y - TARGET_U.y)
      s.blob[k] = smooth(0.34, 0.1, dd) // 1 near the target, fades out
    }
  }
  return s
}

function drawGlobe(
  ctx: CanvasRenderingContext2D, cx: number, cy: number, R: number,
  spin: number, drift: number, cloudAmt: number, alpha: number,
) {
  if (!baseTex || !cloudTex) buildTextures()
  if (!sampler) sampler = buildSampler()
  const s = sampler, d = s.img.data, base = baseTex!, cloud = cloudTex!
  const cs = Math.cos(spin), sn = Math.sin(spin)
  const thr = 0.92 - 0.46 * cloudAmt
  const inv2pi = 1 / (Math.PI * 2)
  for (let k = 0; k < N * N; k++) {
    const o = k * 4
    if (!s.inside[k] && s.edge[k] <= 0) { d[o + 3] = 0; continue }
    const x = s.X[k], z1 = s.Z[k]
    const xr = x * cs + z1 * sn
    const zr = -x * sn + z1 * cs
    const lon = Math.atan2(zr, xr)
    let u = ((lon * inv2pi + 0.5) * TW) | 0
    if (u < 0) u += TW; else if (u >= TW) u -= TW
    const ti = s.row[k] * TW + u
    const bo = ti * 4
    const shade = s.shade[k]
    let r = base[bo] * shade, g = base[bo + 1] * shade, b = base[bo + 2] * shade
    if (base[bo + 3] === 0) {
      const sp = s.spec[k] * 120
      r += sp; g += sp; b += sp * 1.1
    }
    // clouds drift separately from the ground
    let uc = (u - drift) | 0
    uc %= TW; if (uc < 0) uc += TW
    const n = cloud[s.row[k] * TW + uc] / 255
    let a = clamp((n - thr) / 0.2)
    a = Math.max(a, s.blob[k] * cloudAmt * (0.75 + 0.25 * n))
    if (a > 0) {
      const cshade = 0.3 + 0.78 * (shade - 0.14) / 0.95
      const cr = 244 * cshade, cg = 247 * cshade, cb = 255 * cshade
      const ka = a * 0.94
      r = r + (cr - r) * ka; g = g + (cg - g) * ka; b = b + (cb - b) * ka
    }
    const f = s.fres[k] * 0.9
    r += 40 * f; g += 110 * f; b += 255 * f * 0.9
    d[o] = r; d[o + 1] = g; d[o + 2] = b
    d[o + 3] = 255 * s.edge[k]
  }
  s.ctx.putImageData(s.img, 0, 0)

  // atmosphere glow
  const gl = ctx.createRadialGradient(cx, cy, R * 0.96, cx, cy, R * 1.3)
  gl.addColorStop(0, `rgba(90,160,255,${0.55 * alpha})`)
  gl.addColorStop(0.35, `rgba(60,120,255,${0.18 * alpha})`)
  gl.addColorStop(1, 'rgba(40,90,255,0)')
  ctx.fillStyle = gl
  ctx.beginPath(); ctx.arc(cx, cy, R * 1.3, 0, Math.PI * 2); ctx.fill()

  ctx.save()
  ctx.globalAlpha = alpha
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(s.cnv, cx - R, cy - R, R * 2, R * 2)
  ctx.restore()
}

// ---------- stars ----------
const stars = (() => {
  const r = rng(7)
  return Array.from({ length: 240 }, () => ({ x: r(), y: r(), s: 0.4 + r() * 1.4, p: r() * 6.28, sp: 0.4 + r() * 1.6, depth: 0.2 + r() * 0.8 }))
})()

function drawBackground(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
  const g = ctx.createRadialGradient(w * 0.5, h * 0.48, 0, w * 0.5, h * 0.48, Math.max(w, h) * 0.75)
  g.addColorStop(0, '#0C1A38')
  g.addColorStop(0.55, '#060D1F')
  g.addColorStop(1, '#02040A')
  ctx.fillStyle = g
  ctx.fillRect(-20, -20, w + 40, h + 40)
  // faint nebula washes (blue / gold, matching the brand)
  const n1 = ctx.createRadialGradient(w * 0.15, h * 0.2, 0, w * 0.15, h * 0.2, w * 0.45)
  n1.addColorStop(0, 'rgba(11,75,170,0.22)'); n1.addColorStop(1, 'rgba(11,75,170,0)')
  ctx.fillStyle = n1; ctx.fillRect(0, 0, w, h)
  const n2 = ctx.createRadialGradient(w * 0.88, h * 0.75, 0, w * 0.88, h * 0.75, w * 0.4)
  n2.addColorStop(0, 'rgba(232,184,74,0.09)'); n2.addColorStop(1, 'rgba(232,184,74,0)')
  ctx.fillStyle = n2; ctx.fillRect(0, 0, w, h)
  for (const st of stars) {
    const tw = 0.55 + 0.45 * Math.sin(t * st.sp + st.p)
    const x = ((st.x * w + t * 2.2 * st.depth) % w + w) % w
    ctx.globalAlpha = tw * (0.35 + 0.6 * st.depth)
    ctx.fillStyle = '#EAF1FF'
    ctx.fillRect(x, st.y * h, st.s, st.s)
  }
  ctx.globalAlpha = 1
}

// ---------- satellites ----------
interface P { x: number; y: number }

function drawOptical(ctx: CanvasRenderingContext2D, x: number, y: number, rot: number, q: number, alpha: number, mood: 'ok' | 'blocked' | 'hit', t: number) {
  ctx.save()
  ctx.translate(x, y); ctx.rotate(rot); ctx.globalAlpha = alpha
  for (const sign of [-1, 1]) {
    ctx.save(); ctx.scale(sign, 1)
    ctx.fillStyle = '#8B95A8'; ctx.fillRect(1.5 * q, -0.14 * q, 0.9 * q, 0.28 * q)
    const g = ctx.createLinearGradient(2.4 * q, 0, 6.4 * q, 0)
    g.addColorStop(0, '#2563C9'); g.addColorStop(1, '#0F3A8A')
    ctx.fillStyle = g; ctx.fillRect(2.4 * q, -1.25 * q, 4 * q, 2.5 * q)
    ctx.strokeStyle = 'rgba(190,215,255,.35)'; ctx.lineWidth = 1
    ctx.beginPath()
    for (let i = 1; i < 4; i++) { ctx.moveTo((2.4 + i) * q, -1.25 * q); ctx.lineTo((2.4 + i) * q, 1.25 * q) }
    ctx.moveTo(2.4 * q, 0); ctx.lineTo(6.4 * q, 0)
    ctx.stroke()
    ctx.strokeStyle = '#C9D3E6'; ctx.strokeRect(2.4 * q, -1.25 * q, 4 * q, 2.5 * q)
    ctx.restore()
  }
  const bg = ctx.createLinearGradient(-1.5 * q, 0, 1.5 * q, 0)
  bg.addColorStop(0, '#9AA6BC'); bg.addColorStop(0.5, '#E4E9F2'); bg.addColorStop(1, '#8794AB')
  ctx.fillStyle = bg
  ctx.beginPath(); ctx.roundRect(-1.5 * q, -1.8 * q, 3 * q, 3.6 * q, 0.4 * q); ctx.fill()
  ctx.fillStyle = '#E8B84A'; ctx.fillRect(-1.5 * q, -0.55 * q, 3 * q, 0.5 * q)
  // lens barrel (points at the Earth)
  ctx.fillStyle = '#1A2336'
  ctx.beginPath(); ctx.roundRect(-0.85 * q, 1.7 * q, 1.7 * q, 1.5 * q, 0.2 * q); ctx.fill()
  ctx.strokeStyle = '#E8B84A'; ctx.lineWidth = Math.max(1.5, q * 0.14)
  ctx.beginPath(); ctx.ellipse(0, 3.2 * q, 0.85 * q, 0.28 * q, 0, 0, Math.PI * 2); ctx.stroke()
  const lens = ctx.createRadialGradient(0, 3.2 * q, 0, 0, 3.2 * q, 0.7 * q)
  const pulse = 0.6 + 0.4 * Math.sin(t * 6)
  lens.addColorStop(0, mood === 'blocked' ? 'rgba(255,110,110,.95)' : `rgba(255,236,160,${0.5 + 0.5 * pulse})`)
  lens.addColorStop(1, 'rgba(255,200,80,0)')
  ctx.fillStyle = lens; ctx.beginPath(); ctx.arc(0, 3.2 * q, 0.7 * q, 0, Math.PI * 2); ctx.fill()
  // back antenna
  ctx.strokeStyle = '#B7C0D2'; ctx.lineWidth = Math.max(1, q * 0.12)
  ctx.beginPath(); ctx.moveTo(0, -1.8 * q); ctx.lineTo(0, -2.9 * q); ctx.stroke()
  ctx.fillStyle = '#E8B84A'; ctx.beginPath(); ctx.arc(0, -3 * q, 0.22 * q, 0, Math.PI * 2); ctx.fill()
  // little face on the body so it can react
  ctx.fillStyle = '#1A2336'
  const ey = -1.15 * q
  if (mood === 'hit') {
    ctx.strokeStyle = '#1A2336'; ctx.lineWidth = Math.max(1.5, q * 0.14)
    for (const ex of [-0.6 * q, 0.6 * q]) {
      ctx.beginPath(); ctx.moveTo(ex - 0.25 * q, ey - 0.25 * q); ctx.lineTo(ex + 0.25 * q, ey + 0.25 * q)
      ctx.moveTo(ex + 0.25 * q, ey - 0.25 * q); ctx.lineTo(ex - 0.25 * q, ey + 0.25 * q); ctx.stroke()
    }
  } else {
    ctx.beginPath(); ctx.arc(-0.6 * q, ey, 0.24 * q, 0, 6.3); ctx.arc(0.6 * q, ey, 0.24 * q, 0, 6.3); ctx.fill()
  }
  ctx.restore()
}

interface NisarPose { x: number; y: number; rot: number; q: number; arm: number; leg: number; mood: 'calm' | 'angry' | 'happy' }

function drawNisar(ctx: CanvasRenderingContext2D, p: NisarPose, t: number) {
  const { q } = p
  ctx.save()
  ctx.translate(p.x, p.y); ctx.rotate(p.rot)
  const lw = Math.max(1, q * 0.1)
  // --- solar wing (one side) ---
  ctx.save()
  ctx.fillStyle = '#9AA3B5'; ctx.fillRect(1.7 * q, -0.12 * q, 0.9 * q, 0.24 * q)
  const sg = ctx.createLinearGradient(2.6 * q, 0, 7 * q, 0)
  sg.addColorStop(0, '#1E4FB0'); sg.addColorStop(1, '#0B2F7A')
  ctx.fillStyle = sg; ctx.fillRect(2.6 * q, -1.35 * q, 4.4 * q, 2.7 * q)
  ctx.strokeStyle = 'rgba(190,215,255,.3)'; ctx.lineWidth = 1
  ctx.beginPath()
  for (let i = 1; i < 5; i++) { ctx.moveTo((2.6 + i * 0.88) * q, -1.35 * q); ctx.lineTo((2.6 + i * 0.88) * q, 1.35 * q) }
  ctx.moveTo(2.6 * q, 0); ctx.lineTo(7 * q, 0); ctx.stroke()
  ctx.strokeStyle = '#C9D3E6'; ctx.strokeRect(2.6 * q, -1.35 * q, 4.4 * q, 2.7 * q)
  ctx.restore()
  // --- boom + mesh dish (points at the Earth, +y) ---
  ctx.strokeStyle = '#B8C0D0'; ctx.lineWidth = Math.max(2, q * 0.22)
  ctx.beginPath(); ctx.moveTo(0, 1.4 * q); ctx.lineTo(0, 4.6 * q); ctx.stroke()
  const dishY = 5 * q
  const dg = ctx.createRadialGradient(0, dishY, 0, 0, dishY, 4.6 * q)
  dg.addColorStop(0, 'rgba(255,225,150,.55)'); dg.addColorStop(1, 'rgba(232,184,74,.22)')
  ctx.fillStyle = dg
  ctx.beginPath(); ctx.ellipse(0, dishY, 4.6 * q, 1.45 * q, 0, 0, Math.PI * 2); ctx.fill()
  ctx.strokeStyle = '#E8B84A'; ctx.lineWidth = Math.max(1.5, q * 0.12)
  ctx.stroke()
  ctx.strokeStyle = 'rgba(232,184,74,.55)'; ctx.lineWidth = 1
  ctx.beginPath()
  for (let i = -3; i <= 3; i++) { ctx.moveTo(i * 1.4 * q * 0.5, dishY - 1.45 * q * Math.sqrt(Math.max(0, 1 - (i / 3.4) ** 2))); ctx.lineTo(i * 1.4 * q * 0.5, dishY + 1.45 * q * Math.sqrt(Math.max(0, 1 - (i / 3.4) ** 2))) }
  ctx.moveTo(-4.6 * q, dishY); ctx.lineTo(4.6 * q, dishY)
  ctx.stroke()
  ctx.beginPath(); ctx.ellipse(0, dishY, 2.4 * q, 0.76 * q, 0, 0, Math.PI * 2); ctx.stroke()
  ctx.fillStyle = '#5CE1FF'; ctx.beginPath(); ctx.arc(0, dishY, 0.3 * q, 0, 6.3); ctx.fill()
  // --- body: gold foil ---
  const bgd = ctx.createLinearGradient(-1.8 * q, -1.5 * q, 1.8 * q, 1.5 * q)
  bgd.addColorStop(0, '#F6D989'); bgd.addColorStop(0.5, '#D9A93E'); bgd.addColorStop(1, '#A67820')
  ctx.fillStyle = bgd
  ctx.beginPath(); ctx.roundRect(-1.8 * q, -1.5 * q, 3.6 * q, 3 * q, 0.5 * q); ctx.fill()
  ctx.strokeStyle = 'rgba(255,245,210,.55)'; ctx.lineWidth = lw
  ctx.beginPath(); ctx.moveTo(-1.8 * q, -0.5 * q); ctx.lineTo(1.8 * q, -0.2 * q); ctx.moveTo(-1.8 * q, 0.6 * q); ctx.lineTo(1.8 * q, 0.9 * q); ctx.stroke()
  // NASA-ish blue band
  ctx.fillStyle = '#0B4BAA'; ctx.fillRect(-1.8 * q, 1.05 * q, 3.6 * q, 0.45 * q)
  // --- visor face ---
  ctx.fillStyle = '#0B1426'
  ctx.beginPath(); ctx.roundRect(-1.35 * q, -1.1 * q, 2.7 * q, 1.35 * q, 0.5 * q); ctx.fill()
  ctx.fillStyle = '#5CE1FF'
  const blink = (Math.sin(t * 2.3) > 0.97) ? 0.35 : 1
  const eyeH = (p.mood === 'happy' ? 0.28 : 0.34) * q * blink
  for (const ex of [-0.6 * q, 0.6 * q]) {
    ctx.beginPath(); ctx.ellipse(ex, -0.5 * q, 0.26 * q, eyeH, 0, 0, Math.PI * 2); ctx.fill()
  }
  if (p.mood === 'angry') {
    ctx.strokeStyle = '#5CE1FF'; ctx.lineWidth = Math.max(1.5, q * 0.16)
    ctx.beginPath(); ctx.moveTo(-1 * q, -0.98 * q); ctx.lineTo(-0.2 * q, -0.75 * q); ctx.moveTo(1 * q, -0.98 * q); ctx.lineTo(0.2 * q, -0.75 * q); ctx.stroke()
  } else if (p.mood === 'happy') {
    ctx.strokeStyle = '#5CE1FF'; ctx.lineWidth = Math.max(1.5, q * 0.14)
    ctx.beginPath(); ctx.arc(0, -0.15 * q, 0.45 * q, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke()
  }
  // --- arm + glove (punch), drawn in body space ---
  if (p.arm > 0.001) {
    const a = p.arm
    const sx = -1.8 * q, sy = 0.1 * q
    const fx = sx - (0.6 + 5.4 * a) * q, fy = sy - 0.15 * q * a
    ctx.strokeStyle = '#6F7A91'; ctx.lineWidth = q * 0.75; ctx.lineCap = 'round'
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(fx, fy); ctx.stroke()
    ctx.strokeStyle = '#A9B3C7'; ctx.lineWidth = q * 0.4
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(fx, fy); ctx.stroke()
    ctx.fillStyle = '#E8B84A'; ctx.strokeStyle = '#7A5410'; ctx.lineWidth = lw * 1.5
    ctx.beginPath(); ctx.arc(fx, fy, q * 0.95, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
    ctx.strokeStyle = 'rgba(122,84,16,.6)'
    ctx.beginPath(); ctx.moveTo(fx - q * 0.9, fy - q * 0.3); ctx.lineTo(fx - q * 0.3, fy - q * 0.3); ctx.moveTo(fx - q * 0.9, fy + q * 0.25); ctx.lineTo(fx - q * 0.3, fy + q * 0.25); ctx.stroke()
    ctx.lineCap = 'butt'
  }
  // --- leg + boot (kick) ---
  if (p.leg > 0.001) {
    const a = p.leg
    const hx = -1 * q, hy = 1.4 * q
    const fx = hx - (0.8 + 6.4 * a) * q, fy = hy - 3.3 * q * a
    ctx.strokeStyle = '#6F7A91'; ctx.lineWidth = q * 0.8; ctx.lineCap = 'round'
    ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(fx, fy); ctx.stroke()
    ctx.strokeStyle = '#A9B3C7'; ctx.lineWidth = q * 0.42
    ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(fx, fy); ctx.stroke()
    ctx.save(); ctx.translate(fx, fy); ctx.rotate(Math.atan2(fy - hy, fx - hx))
    ctx.fillStyle = '#0B4BAA'; ctx.strokeStyle = '#06265F'; ctx.lineWidth = lw * 1.5
    ctx.beginPath(); ctx.roundRect(-0.4 * q, -0.75 * q, 1.7 * q, 1.5 * q, 0.5 * q); ctx.fill(); ctx.stroke()
    ctx.restore(); ctx.lineCap = 'butt'
  }
  ctx.restore()
}

// ---------- effects ----------
function burst(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, rot: number) {
  const n = 11
  ctx.beginPath()
  for (let i = 0; i < n * 2; i++) {
    const rad = i % 2 ? r * 0.58 : r
    const a = rot + (i * Math.PI) / n
    const px = x + Math.cos(a) * rad, py = y + Math.sin(a) * rad
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py)
  }
  ctx.closePath()
}
function drawImpact(ctx: CanvasRenderingContext2D, x: number, y: number, dt: number, word: string, size: number) {
  if (dt < 0 || dt > 1) return
  const pop = dt < 0.12 ? easeOut(dt / 0.12) : 1 + 0.05 * Math.sin(dt * 22)
  const a = 1 - seg(dt, 0.62, 1)
  ctx.save()
  ctx.globalAlpha = a
  ctx.translate(x, y); ctx.scale(pop, pop); ctx.translate(-x, -y)
  // shock rings
  ctx.strokeStyle = `rgba(255,245,200,${0.9 * (1 - dt)})`; ctx.lineWidth = 3
  ctx.beginPath(); ctx.arc(x, y, size * (0.3 + dt * 2.2), 0, Math.PI * 2); ctx.stroke()
  burst(ctx, x, y, size * 1.15, -0.2)
  ctx.fillStyle = '#E8B84A'; ctx.fill()
  ctx.lineWidth = size * 0.07; ctx.strokeStyle = '#0B1426'; ctx.stroke()
  burst(ctx, x, y, size * 0.8, -0.2)
  ctx.fillStyle = '#FFF4C9'; ctx.fill()
  ctx.font = `700 ${size * 0.62}px Oswald, Impact, sans-serif`
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.translate(x, y); ctx.rotate(-0.16)
  ctx.lineWidth = size * 0.1; ctx.strokeStyle = '#0B1426'; ctx.lineJoin = 'round'
  ctx.strokeText(word, 0, size * 0.02)
  ctx.fillStyle = '#F0484D'; ctx.fillText(word, 0, size * 0.02)
  ctx.restore()
}

// ---------- beams & waves ----------
function drawOpticalBeam(ctx: CanvasRenderingContext2D, O: P, Tg: P, R: number, t: number, alpha: number, blocked: number) {
  if (alpha <= 0.01) return
  const dx = Tg.x - O.x, dy = Tg.y - O.y
  const len = Math.hypot(dx, dy)
  const ux = dx / len, uy = dy / len, nx = -uy, ny = ux
  const wT = R * 0.2
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  // faint cone
  const g = ctx.createLinearGradient(O.x, O.y, Tg.x, Tg.y)
  const col = blocked > 0.5 ? '255,170,120' : '255,226,140'
  g.addColorStop(0, `rgba(${col},${0.05 * alpha})`); g.addColorStop(1, `rgba(${col},${0.26 * alpha})`)
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.moveTo(O.x + nx * 2, O.y + ny * 2); ctx.lineTo(Tg.x + nx * wT, Tg.y + ny * wT * 0.8)
  ctx.lineTo(Tg.x - nx * wT, Tg.y - ny * wT * 0.8); ctx.lineTo(O.x - nx * 2, O.y - ny * 2)
  ctx.closePath(); ctx.fill()
  // footprint on the ground
  ctx.strokeStyle = `rgba(${col},${0.7 * alpha})`; ctx.lineWidth = 2
  ctx.beginPath(); ctx.ellipse(Tg.x, Tg.y, wT, wT * 0.78, Math.atan2(ny, nx) + Math.PI / 2, 0, Math.PI * 2); ctx.stroke()
  // pulse cycle: down, then back up (only if the ground answered)
  const period = 1.6
  const u = (((t - T.beamOn) % period) + period) % period / period
  const down = seg(u, 0, 0.38)
  const upS = 1 - seg(u, 0.4, 0.78)
  const drawPulse = (s: number, c: string, r: number) => {
    const px = O.x + dx * s, py = O.y + dy * s
    const pg = ctx.createRadialGradient(px, py, 0, px, py, r)
    pg.addColorStop(0, c); pg.addColorStop(1, 'rgba(255,220,120,0)')
    ctx.fillStyle = pg; ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill()
  }
  if (u < 0.38) {
    drawPulse(down, `rgba(255,244,200,${alpha})`, R * 0.07)
    drawPulse(Math.max(0, down - 0.05), `rgba(255,220,120,${0.6 * alpha})`, R * 0.05)
  } else if (u < 0.78) {
    if (blocked < 0.5) {
      drawPulse(upS, `rgba(190,235,255,${alpha})`, R * 0.06)
      drawPulse(Math.min(1, upS + 0.05), `rgba(160,220,255,${0.5 * alpha})`, R * 0.04)
    } else {
      // splat: the light hits cloud and scatters, nothing returns
      const k = seg(u, 0.38, 0.62)
      ctx.strokeStyle = `rgba(255,120,110,${(1 - k) * alpha})`; ctx.lineWidth = 2.5
      ctx.beginPath(); ctx.ellipse(Tg.x, Tg.y, wT * (0.3 + k * 1.1), wT * (0.3 + k * 1.1) * 0.78, 0, 0, Math.PI * 2); ctx.stroke()
    }
  }
  ctx.restore()
}

function zigzagLine(
  ctx: CanvasRenderingContext2D, O: P, D: P, len: number, amp: number, wl: number, shift: number, front: number, phase: number,
) {
  const nx = -D.y, ny = D.x
  const half = wl / 2
  const end = len * front
  if (end <= 1) return
  const at = (s: number, v: number) => {
    const grow = 0.3 + 0.7 * (s / len)
    return { x: O.x + D.x * s + nx * v * amp * grow, y: O.y + D.y * s + ny * v * amp * grow }
  }
  const tri = (s: number) => {
    const ph = (s - shift - phase * wl) / half
    const m = ((ph % 2) + 2) % 2
    return Math.abs(m - 1) * 2 - 1
  }
  ctx.beginPath()
  let p = at(0, tri(0)); ctx.moveTo(p.x, p.y)
  const kStart = Math.ceil((0 - shift - phase * wl) / half)
  for (let k = kStart; ; k++) {
    const s = shift + phase * wl + k * half
    if (s >= end) break
    if (s <= 0) continue
    p = at(s, tri(s)); ctx.lineTo(p.x, p.y)
  }
  p = at(end, tri(end)); ctx.lineTo(p.x, p.y)
  ctx.stroke()
}

function drawRadarWaves(ctx: CanvasRenderingContext2D, O: P, Tg: P, R: number, t: number, front: number, alpha: number) {
  if (front <= 0 || alpha <= 0.01) return
  const dx = Tg.x - O.x, dy = Tg.y - O.y
  const len = Math.hypot(dx, dy)
  const D = { x: dx / len, y: dy / len }
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.lineJoin = 'miter'; ctx.lineCap = 'round'
  const cols = ['rgba(92,225,255,', 'rgba(122,167,255,', 'rgba(190,140,255,']
  for (let i = 0; i < 3; i++) {
    ctx.shadowColor = cols[i] + '0.9)'; ctx.shadowBlur = 14
    ctx.strokeStyle = cols[i] + (0.95 * alpha) + ')'
    ctx.lineWidth = i === 0 ? 3 : 2.2
    zigzagLine(ctx, O, D, len, R * 0.085, R * 0.15, t * R * 0.9, front, i / 3)
  }
  ctx.shadowBlur = 0
  if (front >= 1) {
    // echoes coming back to the satellite
    for (let k = 0; k < 4; k++) {
      const s = 1 - ((t * 0.5 + k / 4) % 1)
      const px = O.x + dx * s, py = O.y + dy * s
      ctx.fillStyle = `rgba(200,245,255,${0.9 * alpha})`
      ctx.beginPath(); ctx.arc(px, py, R * 0.02, 0, Math.PI * 2); ctx.fill()
    }
    // ripples on the ground
    for (let k = 0; k < 3; k++) {
      const r = ((t * 0.55 + k / 3) % 1)
      ctx.strokeStyle = `rgba(92,225,255,${(1 - r) * 0.8 * alpha})`; ctx.lineWidth = 2
      ctx.beginPath(); ctx.ellipse(Tg.x, Tg.y, R * (0.05 + 0.24 * r), R * (0.05 + 0.24 * r) * 0.78, 0.5, 0, Math.PI * 2); ctx.stroke()
    }
  }
  ctx.restore()
}

// ---------- HUD panels ----------
function panelBase(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, accent: string, title: string, alpha: number) {
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.fillStyle = 'rgba(8,15,32,.86)'
  ctx.beginPath(); ctx.roundRect(x, y, w, h, 12); ctx.fill()
  ctx.strokeStyle = accent; ctx.lineWidth = 1.5; ctx.stroke()
  ctx.fillStyle = accent
  ctx.font = '600 11px Inter, system-ui, sans-serif'
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle'
  ctx.fillText(title, x + 12, y + 16)
  ctx.restore()
}

const tilePalette = ['#3C7A45', '#4A8A4F', '#2E6B8C', '#7E8C52', '#B49B62', '#5E8C48', '#2D5F86', '#6E7E45', '#9B8A5A', '#3F7D4B', '#31719A', '#8A9A55']

function drawOpticalPanel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, t: number, alpha: number) {
  panelBase(ctx, x, y, w, h, 'rgba(232,184,74,.75)', 'OPTICAL SENSOR', alpha)
  ctx.save(); ctx.globalAlpha = alpha
  const gx = x + 12, gy = y + 30, gw = w - 24, gh = h - 30 - 34
  const cols = 4, rows = 3, cw = gw / cols, ch = gh / rows
  const order = [3, 8, 1, 10, 5, 0, 7, 11, 2, 9, 4, 6]
  for (let i = 0; i < cols * rows; i++) {
    const cx = gx + (i % cols) * cw, cy = gy + Math.floor(i / cols) * ch
    ctx.fillStyle = 'rgba(30,45,74,.7)'; ctx.fillRect(cx + 1, cy + 1, cw - 2, ch - 2)
    const fill = ease(seg(t, T.beamOn + 0.8 + i * 0.17, T.beamOn + 1.1 + i * 0.17))
    if (fill > 0) {
      ctx.globalAlpha = alpha * fill
      ctx.fillStyle = tilePalette[i]; ctx.fillRect(cx + 1, cy + 1, cw - 2, ch - 2)
      ctx.globalAlpha = alpha
    }
    const c0 = T.blockStart + order.indexOf(i) * 0.12
    const cl = ease(seg(t, c0, c0 + 0.4))
    if (cl > 0) {
      ctx.globalAlpha = alpha * cl
      ctx.fillStyle = '#C9D3E6'; ctx.fillRect(cx + 1, cy + 1, cw - 2, ch - 2)
      ctx.fillStyle = '#4B5B7A'; ctx.font = `700 ${Math.min(cw, ch) * 0.55}px Oswald, sans-serif`
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('?', cx + cw / 2, cy + ch / 2 + 1)
      ctx.globalAlpha = alpha
    }
  }
  // status
  const blocked = seg(t, T.blockStart + 0.8, T.blockStart + 1.8)
  const receiving = t > T.beamOn
  ctx.font = '700 11px Inter, system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'
  const sy = y + h - 17
  if (blocked > 0) {
    const blink = 0.7 + 0.3 * Math.sin(t * 8)
    ctx.fillStyle = `rgba(240,72,77,${blink})`
    ctx.beginPath(); ctx.arc(x + 18, sy, 4, 0, Math.PI * 2); ctx.fill()
    ctx.fillText('NO DATA · SKY BLOCKED', x + 28, sy)
  } else if (receiving) {
    ctx.fillStyle = '#E8B84A'; ctx.beginPath(); ctx.arc(x + 18, sy, 4, 0, Math.PI * 2); ctx.fill()
    ctx.fillText('RECEIVING IMAGE…', x + 28, sy)
  } else {
    ctx.fillStyle = '#93A3C0'; ctx.beginPath(); ctx.arc(x + 18, sy, 4, 0, Math.PI * 2); ctx.fill()
    ctx.fillText('STANDBY', x + 28, sy)
  }
  ctx.restore()
}

// radar interferogram: a rainbow "fringe" image of ground motion, the signature of InSAR
const RS = 112
let radarCnv: HTMLCanvasElement | null = null
let radarImg: ImageData | null = null
let radarPhase: Float32Array | null = null
let hueLut: Uint8Array | null = null

function hsv(h: number): [number, number, number] {
  const k = (n: number) => (n + h * 6) % 6
  const f = (n: number) => 0.92 - 0.92 * 0.78 * Math.max(0, Math.min(k(n), 4 - k(n), 1))
  return [f(5) * 255, f(3) * 255, f(1) * 255]
}

function drawRadarImage(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, t: number, reveal: number) {
  if (!radarCnv) {
    radarCnv = document.createElement('canvas'); radarCnv.width = radarCnv.height = RS
    radarImg = radarCnv.getContext('2d')!.createImageData(RS, RS)
    radarPhase = new Float32Array(RS * RS)
    hueLut = new Uint8Array(256 * 3)
    for (let i = 0; i < 256; i++) { const c = hsv(i / 256); hueLut[i * 3] = c[0]; hueLut[i * 3 + 1] = c[1]; hueLut[i * 3 + 2] = c[2] }
    for (let j = 0; j < RS; j++) for (let i = 0; i < RS; i++) {
      const u = (i / RS) * 2 - 1, v = (j / RS) * 2 - 1
      const b1 = Math.exp(-((u - 0.12) ** 2 + (v + 0.08) ** 2) / 0.3) * 5.2
      const b2 = Math.exp(-((u + 0.5) ** 2 + (v - 0.42) ** 2) / 0.05) * 2.2
      radarPhase[j * RS + i] = b1 + b2 + 0.3 * Math.sin(3 * u + 2 * v) + (noise3(i * 0.13, j * 0.13, 4) - 0.5) * 0.5
    }
  }
  const d = radarImg!.data, ph = radarPhase!, lut = hueLut!
  for (let j = 0; j < RS; j++) {
    const vis = j / RS < reveal
    for (let i = 0; i < RS; i++) {
      const k = j * RS + i, o = k * 4
      if (!vis) { d[o] = 8; d[o + 1] = 16 + (hash3(i, j, 2) * 14); d[o + 2] = 34; d[o + 3] = 255; continue }
      const f = (((ph[k] - t * 0.16) % 1) + 1) % 1
      const li = (f * 255) | 0
      const sp = 0.8 + 0.2 * hash3(i, j, 9)
      d[o] = lut[li * 3] * sp; d[o + 1] = lut[li * 3 + 1] * sp; d[o + 2] = lut[li * 3 + 2] * sp; d[o + 3] = 255
    }
  }
  radarCnv.getContext('2d')!.putImageData(radarImg!, 0, 0)
  ctx.save()
  ctx.beginPath(); ctx.roundRect(x, y, w, h, 8); ctx.clip()
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(radarCnv, x, y, w, h)
  if (reveal < 1) {
    const ly = y + h * reveal
    const g = ctx.createLinearGradient(0, ly - 14, 0, ly + 2)
    g.addColorStop(0, 'rgba(92,225,255,0)'); g.addColorStop(1, 'rgba(92,225,255,.9)')
    ctx.fillStyle = g; ctx.fillRect(x, ly - 14, w, 16)
  }
  ctx.restore()
}

function drawRadarPanel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, t: number, alpha: number) {
  panelBase(ctx, x, y, w, h, 'rgba(92,225,255,.85)', 'NISAR RADAR · L + S BAND', alpha)
  ctx.save(); ctx.globalAlpha = alpha
  const reveal = ease(seg(t, T.radarReveal, T.radarReveal + 2))
  const ix = x + 12, iy = y + 30, iw = w - 24, ih = h - 30 - 48
  drawRadarImage(ctx, ix, iy, iw, ih, t, reveal)
  ctx.strokeStyle = 'rgba(92,225,255,.35)'; ctx.lineWidth = 1; ctx.strokeRect(ix, iy, iw, ih)
  ctx.font = '700 11px Inter, system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'
  ctx.fillStyle = '#5CE1FF'
  ctx.beginPath(); ctx.arc(x + 18, y + h - 33, 4, 0, Math.PI * 2); ctx.fill()
  ctx.fillText(reveal < 1 ? 'SCANNING THROUGH CLOUDS…' : 'CLOUDS: NO PROBLEM', x + 28, y + h - 33)
  const ro = ease(seg(t, T.readout, T.readout + 1))
  ctx.globalAlpha = alpha * ro
  ctx.fillStyle = '#EEF2FA'
  const note = 'Ground moved −4.2 cm · 1 band = 1.2 cm'
  let fs = 11
  ctx.font = `600 ${fs}px Inter, system-ui, sans-serif`
  while (fs > 8 && ctx.measureText(note).width > w - 28) { fs -= 0.5; ctx.font = `600 ${fs}px Inter, system-ui, sans-serif` } // always stays inside the box
  ctx.fillText(note, x + 14, y + h - 12)
  ctx.restore()
}

// ---------- main ----------
export interface Layout { w: number; h: number; cx: number; cy: number; R: number; portrait: boolean }

export function layout(w: number, h: number): Layout {
  const portrait = h > w * 1.1
  const R = portrait ? Math.min(w * 0.27, h * 0.2) : Math.min(w * 0.25, h * 0.25)
  return { w, h, cx: w / 2, cy: portrait ? h * 0.38 : h * 0.53, R, portrait }
}

export function draw(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
  const L = layout(w, h)
  const { cx, cy, R } = L
  const q = R * 0.075
  const Tg: P = { x: cx + TARGET_U.x * R, y: cy - TARGET_U.y * R } // canvas y is down
  // satellite station (upper left of the globe)
  const S: P = { x: cx - R * 1.3, y: cy - R * 1.12 }
  const angleToT = Math.atan2(Tg.y - S.y, Tg.x - S.x)
  const restRot = angleToT - Math.PI / 2

  // screen shake on each hit
  let shake = 0
  for (const hit of [T.punch, T.kick]) {
    const dt = t - hit
    if (dt > 0 && dt < 1) shake += 9 * Math.exp(-dt * 6) * Math.sin(dt * 70)
  }
  ctx.save()
  ctx.translate(shake * 0.7, shake * 0.4)

  drawBackground(ctx, w, h, t)

  // globe
  const gIn = ease(seg(t, 0, 1.5))
  const cloudAmt = ease(seg(t, T.cloudStart, T.cloudEnd))
  const spin = 0.7 + t * 0.045
  drawGlobe(ctx, cx, cy, R * (0.88 + 0.12 * gIn), spin, t * 3.2, cloudAmt, gIn)

  // ---------- optical satellite ----------
  const kickDt = t - T.kick
  const punchDt = t - T.punch
  let opt: { x: number; y: number; rot: number; q: number; alpha: number; mood: 'ok' | 'blocked' | 'hit' } | null = null
  const enter = easeOut(seg(t, T.satIn, T.satIn + 1.6))
  if (t >= T.satIn && kickDt < 1.9) {
    const bob = Math.sin(t * 1.3) * q * 0.25
    let x = lerp(S.x - R * 0.9, S.x, enter), y = lerp(S.y - R * 0.7, S.y, enter) + bob
    let rot = lerp(restRot - 0.9, restRot, enter)
    let sc = 1
    let mood: 'ok' | 'blocked' | 'hit' = cloudAmt > 0.6 ? 'blocked' : 'ok'
    if (punchDt > 0) {
      const k = easeOut(seg(punchDt, 0, 0.5))
      x += -R * 0.22 * k; y += -R * 0.14 * k
      rot += 0.7 * k + Math.sin(punchDt * 9) * 0.08 * (1 - k)
      mood = 'hit'
    }
    if (kickDt > 0) {
      const tau = kickDt
      const sx = x, sy = y
      x = sx - R * 2.9 * Math.pow(tau, 1.7); y = sy - R * 1.5 * Math.pow(tau, 1.7)
      rot += 10 * tau * tau
      sc = 1 - 0.55 * seg(tau, 0, 1.9)
    }
    opt = { x, y, rot, q: q * sc, alpha: 1, mood }
  }

  // beam from the optical satellite
  if (opt && t >= T.beamOn && punchDt < 0.3) {
    const O: P = { x: S.x + Math.cos(restRot + Math.PI / 2) * 3.3 * q, y: S.y + Math.sin(restRot + Math.PI / 2) * 3.3 * q + Math.sin(t * 1.3) * q * 0.25 }
    const a = ease(seg(t, T.beamOn, T.beamOn + 0.6)) * (1 - seg(punchDt, -0.05, 0.3))
    drawOpticalBeam(ctx, O, Tg, R, t, a, cloudAmt > 0.55 ? 1 : 0)
  }
  if (opt) drawOptical(ctx, opt.x, opt.y, opt.rot, opt.q, opt.alpha, opt.mood, t)

  // ---------- NISAR ----------
  if (t >= T.nisarIn) {
    // positions relative to the optical satellite's rest spot
    const P1: P = { x: S.x + 9 * q, y: S.y + 0.4 * q }
    const P2: P = { x: S.x + 5 * q, y: S.y - 0.8 * q }
    const start: P = { x: w + R * 1.2, y: S.y - R * 0.5 }
    const arrive = easeOut(seg(t, T.nisarIn, T.punch - 1.0))
    let pos: P = { x: lerp(start.x, P1.x, arrive), y: lerp(start.y, P1.y, arrive) }
    let rot = (1 - arrive) * 0.35
    const lunge = ease(seg(t, T.punch + 0.35, T.punch + 0.85))
    pos = { x: lerp(pos.x, P2.x, lunge), y: lerp(pos.y, P2.y, lunge) }
    const take = ease(seg(t, T.takeover, T.takeover + 1.5))
    pos = { x: lerp(pos.x, S.x, take), y: lerp(pos.y, S.y, take) }
    rot = lerp(rot, restRot, take)
    pos.y += Math.sin(t * 1.4) * q * 0.25 * (0.4 + take)
    // arm / leg animation
    const armIn = ease(seg(t, T.punch - 0.45, T.punch - 0.05))
    const armOut = ease(seg(t, T.punch + 0.25, T.punch + 0.9))
    const arm = 0.12 * seg(t, T.nisarIn + 1, T.punch - 0.6) * (1 - seg(t, T.kick + 0.9, T.takeover + 0.3)) + armIn * 0.88 * (1 - armOut)
    const legIn = ease(seg(t, T.kick - 0.4, T.kick - 0.04))
    const legOut = ease(seg(t, T.kick + 0.2, T.kick + 0.9))
    const leg = legIn * (1 - legOut)
    const mood = t < T.takeover ? 'angry' : 'happy'
    const trail = 1 - arrive
    if (trail > 0.02) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter'
      const tg = ctx.createLinearGradient(pos.x, pos.y, pos.x + R * 1.6, pos.y - R * 0.3)
      tg.addColorStop(0, `rgba(92,225,255,${0.5 * trail})`); tg.addColorStop(1, 'rgba(92,225,255,0)')
      ctx.strokeStyle = tg; ctx.lineWidth = q * 1.4; ctx.lineCap = 'round'
      ctx.beginPath(); ctx.moveTo(pos.x, pos.y); ctx.lineTo(pos.x + R * 1.6, pos.y - R * 0.3); ctx.stroke()
      ctx.restore()
    }
    // radar waves
    const front = ease(seg(t, T.waveStart, T.waveHit))
    if (front > 0) {
      const dishLocal = 5 * q
      const O: P = { x: pos.x + Math.cos(rot + Math.PI / 2) * dishLocal, y: pos.y + Math.sin(rot + Math.PI / 2) * dishLocal }
      drawRadarWaves(ctx, O, Tg, R, t, front, 1)
    }
    drawNisar(ctx, { x: pos.x, y: pos.y, rot, q, arm, leg, mood }, t)

    // comic impacts
    const fist = { x: P1.x - (1.8 + 0.6 + 5.4) * q, y: P1.y + 0.1 * q }
    drawImpact(ctx, fist.x - q * 0.8, fist.y - q * 0.4, t - (T.punch + 0.04), 'POW!', R * 0.34)
    const foot = { x: P2.x - 8.2 * q, y: P2.y - 1.9 * q }
    drawImpact(ctx, foot.x - q * 0.8, foot.y - q * 0.5, t - (T.kick + 0.04), 'BAM!', R * 0.4)
  }

  // ---------- HUD panels ----------
  const pw = L.portrait ? Math.min(w - 28, 270) : Math.min(R * 1.5, 300)
  const optH = pw * 0.78
  const radH = pw * 0.98
  let ox: number, oy: number, rx: number, ry: number
  if (L.portrait) {
    ox = rx = cx - pw / 2
    oy = ry = cy + R + 26
  } else {
    ox = Math.max(14, cx - R * 1.3 - pw * 1.05)
    oy = cy - optH * 0.15
    rx = Math.min(w - 14 - pw, cx + R * 1.2)
    ry = cy - radH * 0.35
  }
  const optPanelA = ease(seg(t, T.beamOn - 1, T.beamOn - 0.2)) * (1 - ease(seg(t, T.kick + 0.1, T.kick + 1.0)))
  if (optPanelA > 0.01) {
    const jitter = punchDt > 0 && punchDt < 0.6 ? Math.sin(punchDt * 90) * 3 : 0
    drawOpticalPanel(ctx, ox + jitter, oy, pw, optH, t, optPanelA)
  }
  const radA = ease(seg(t, T.radarShow, T.radarShow + 0.8))
  if (radA > 0.01) {
    // leader line from the ground footprint to the radar panel
    if (!L.portrait) {
      ctx.save(); ctx.globalAlpha = radA * 0.8
      ctx.strokeStyle = 'rgba(92,225,255,.7)'; ctx.setLineDash([4, 5]); ctx.lineWidth = 1.5
      ctx.beginPath(); ctx.moveTo(Tg.x + R * 0.1, Tg.y); ctx.lineTo(rx, ry + radH * 0.3); ctx.stroke()
      ctx.restore()
    }
    drawRadarPanel(ctx, rx, ry, pw, radH, t, radA)
  }

  drawReporter(ctx, L, t)

  ctx.restore()

  // vignette
  const vg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.45, w / 2, h / 2, Math.max(w, h) * 0.8)
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.55)')
  ctx.fillStyle = vg; ctx.fillRect(0, 0, w, h)
  // fade in from black
  const fade = 1 - seg(t, 0, 0.8)
  if (fade > 0) { ctx.fillStyle = `rgba(2,4,10,${fade})`; ctx.fillRect(0, 0, w, h) }
}
