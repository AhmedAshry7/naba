import { Activity, Building2, Droplets, Sprout, TrendingDown, TrendingUp, Waves, type LucideProps } from 'lucide-react'
import type { ChangeType } from '../types'

const ICONS: Record<ChangeType, React.ComponentType<LucideProps>> = {
  subsidence: TrendingDown,
  uplift: TrendingUp,
  moisture: Droplets,
  water: Waves,
  vegetation: Sprout,
  construction: Building2,
  earthquake: Activity,
}

export default function TypeIcon({ type, ...p }: { type: ChangeType } & LucideProps) {
  const Icon = ICONS[type] ?? Waves
  return <Icon aria-hidden {...p} />
}
