import { CONFIDENCE_LEVEL } from '../lib'
import type { Confidence } from '../types'

export default function ConfidenceBar({ level, note }: { level: Confidence; note: string }) {
  const n = CONFIDENCE_LEVEL[level]
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <span className="section-label">Confidence</span>
        <span className="text-[14px] font-semibold capitalize">
          {level} <span className="font-normal text-sub">({n}/5)</span>
        </span>
      </div>
      <div className="flex gap-1.5" role="img" aria-label={`Confidence ${level}, ${n} out of 5`}>
        {[1, 2, 3, 4, 5].map((i) => (
          <span key={i} className={`h-2 flex-1 rounded-full ${i <= n ? 'bg-gold' : 'bg-line'}`} />
        ))}
      </div>
      <p className="mt-2 text-[14px] text-sub">{note}</p>
    </div>
  )
}
