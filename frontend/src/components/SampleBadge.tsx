import { FlaskConical } from 'lucide-react'
import { useStore } from '../store'

/** Honesty rule: visible whenever any loaded story is sample data. */
export default function SampleBadge() {
  const any = useStore((s) => s.stories.some((st) => st.is_sample))
  if (!any) return null
  return (
    <span
      role="status"
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-gold/60 bg-gold/10 px-3 py-1 text-[12px] font-semibold text-gold"
    >
      <FlaskConical size={14} aria-hidden />
      <span className="hidden sm:inline">Sample data · concept preview</span>
      <span className="sm:hidden">Sample data</span>
    </span>
  )
}
