import { useMemo, useRef, useState } from 'react'
import type { SeriesPoint } from '../types'
import { formatDate, formatDateShort, formatValue } from '../lib'

const W = 400
const H = 160
const P = { l: 38, r: 10, t: 10, b: 24 }

export default function SeriesChart({ series, color, label, unit }: { series: SeriesPoint[]; color: string; label: string; unit: string }) {
  const ref = useRef<SVGSVGElement>(null)
  const [hover, setHover] = useState<number | null>(null)

  const g = useMemo(() => {
    const t = series.map((p) => new Date(p.date).getTime())
    const vals = series.map((p) => p.value)
    const lo = Math.min(0, ...vals)
    const hi = Math.max(0, ...vals)
    const pad = (hi - lo || 1) * 0.12
    const y0 = lo - (lo < 0 ? pad : 0)
    const y1 = hi + (hi > 0 ? pad : 0)
    const x = (i: number) => P.l + ((t[i] - t[0]) / (t[t.length - 1] - t[0] || 1)) * (W - P.l - P.r)
    const y = (v: number) => P.t + (1 - (v - y0) / (y1 - y0 || 1)) * (H - P.t - P.b)
    const pts = series.map((p, i) => [x(i), y(p.value)] as const)
    const line = pts.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)} ${py.toFixed(1)}`).join(' ')
    const zero = y(0)
    const area = `${line} L${pts[pts.length - 1][0].toFixed(1)} ${zero.toFixed(1)} L${pts[0][0].toFixed(1)} ${zero.toFixed(1)} Z`
    const ticks = Array.from(new Set([lo, 0, hi])).map((v) => ({ v, y: y(v) }))
    return { pts, line, area, zero, ticks }
  }, [series])

  if (series.length < 2) return <p className="text-[14px] text-sub">Not enough observations yet to draw a chart.</p>

  const onMove = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect()
    const px = ((e.clientX - r.left) / r.width) * W
    let best = 0
    g.pts.forEach(([x], i) => {
      if (Math.abs(x - px) < Math.abs(g.pts[best][0] - px)) best = i
    })
    setHover(best)
  }

  const cur = hover ?? series.length - 1
  const first = series[0]
  const last = series[series.length - 1]
  const gid = `grad-${color.slice(1)}`

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="section-label">{label} over time</span>
        <span className="text-[13px] tabular-nums text-sub" aria-live="off">
          {formatDateShort(series[cur].date)} ·{' '}
          <b className="text-text">
            {formatValue(series[cur].value)} {unit.split(' ')[0]}
          </b>
        </span>
      </div>
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full touch-none"
        role="img"
        aria-label={`${label} from ${formatValue(first.value)} on ${formatDate(first.date)} to ${formatValue(last.value)} on ${formatDate(last.date)}`}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity=".28" />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {g.ticks.map((t) => (
          <g key={t.v}>
            <line x1={P.l} x2={W - P.r} y1={t.y} y2={t.y} stroke="#1E2D4A" strokeWidth="1" strokeDasharray={t.v === 0 ? '0' : '3 4'} />
            <text x={P.l - 6} y={t.y + 4} textAnchor="end" fontSize="10.5" fill="#93A3C0">
              {t.v === 0 ? '0' : formatValue(Math.round(t.v * 10) / 10)}
            </text>
          </g>
        ))}
        <line x1={P.l} x2={W - P.r} y1={g.zero} y2={g.zero} stroke="#93A3C0" strokeWidth="1.2" opacity=".6" />
        <path d={g.area} fill={`url(#${gid})`} />
        <path d={g.line} fill="none" stroke={color} strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" pathLength={1} className="draw-line" />
        <text x={P.l} y={H - 6} fontSize="10.5" fill="#93A3C0">
          {formatDateShort(first.date)}
        </text>
        <text x={W - P.r} y={H - 6} fontSize="10.5" fill="#93A3C0" textAnchor="end">
          {formatDateShort(last.date)}
        </text>
        {hover !== null && <line x1={g.pts[hover][0]} x2={g.pts[hover][0]} y1={P.t} y2={H - P.b} stroke="#EEF2FA" strokeOpacity=".35" />}
        <circle cx={g.pts[cur][0]} cy={g.pts[cur][1]} r="4.5" fill="#060B16" stroke={color} strokeWidth="2.5" />
      </svg>
    </div>
  )
}
