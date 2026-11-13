import { create } from 'zustand'
import type { ChangeStory, Filter, Layer, MonthStep, WetlandData } from './types'
import { loadLayers, loadStories, loadWetlands } from './data/loadData'

export type CameraTarget = 'globe' | 'egypt' | 'delta'

interface State {
  status: 'loading' | 'ready' | 'error'
  stories: ChangeStory[]
  layers: Layer[]
  /** Monthly wetland extents drawn on the globe; null when the dataset has none. */
  wetlands: WetlandData | null
  /** The months the wetland layer can show, oldest first. */
  months: MonthStep[]
  selectedId: string | null
  filter: Filter
  /** Index into `months`: which month the globe is showing. */
  monthIndex: number
  /** One-off events: 0 = the 'before' date (nothing yet), 1 = the 'after' date (the change). */
  quakeStep: number
  isPlaying: boolean
  explainOpen: boolean
  compareOpen: boolean
  aboutOpen: boolean
  introOpen: boolean
  feedOpenMobile: boolean
  sidebarCollapsed: boolean
  camera: { target: CameraTarget; n: number } | null
  projection: 'globe' | 'mercator'
  load: () => Promise<void>
  select: (id: string | null) => void
  setFilter: (f: Filter) => void
  setMonth: (i: number) => void
  setQuakeStep: (n: number) => void
  setPlaying: (p: boolean) => void
  set: (p: Partial<State>) => void
  moveCamera: (target: CameraTarget) => void
}

const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams()
export const isDemo = params.get('demo') === '1'
const initialStory = params.get('story')

/** The distinct months present in the wetland features, oldest first. */
function monthsOf(wetlands: WetlandData | null): MonthStep[] {
  if (!wetlands) return []
  const byMonth = new Map<string, string>()
  for (const f of wetlands.features) byMonth.set(f.properties.month, f.properties.month_label)
  return [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, label]) => ({ month, label }))
}

function syncUrl(id: string | null) {
  const u = new URL(window.location.href)
  if (id) u.searchParams.set('story', id)
  else u.searchParams.delete('story')
  window.history.replaceState(null, '', u)
}

export const useStore = create<State>((set, get) => ({
  status: 'loading',
  stories: [],
  layers: [],
  wetlands: null,
  months: [],
  selectedId: null,
  filter: 'all',
  monthIndex: 0,
  quakeStep: 0,
  isPlaying: false,
  explainOpen: false,
  compareOpen: false,
  aboutOpen: false,
  introOpen: !isDemo && !initialStory,
  feedOpenMobile: false,
  sidebarCollapsed: typeof window !== 'undefined' && window.innerWidth >= 1024 && window.innerWidth < 1440,
  camera: null,
  projection: 'globe',

  load: async () => {
    set({ status: 'loading' })
    try {
      const [stories, layers, wetlands] = await Promise.all([loadStories(), loadLayers(), loadWetlands()])
      const sorted = [...stories].sort((a, b) => b.published.localeCompare(a.published))
      const months = monthsOf(wetlands)
      // open on the most recent month, the way a news site opens on today
      set({ stories: sorted, layers, wetlands, months, monthIndex: Math.max(0, months.length - 1), status: 'ready' })
      if (initialStory && sorted.some((s) => s.id === initialStory)) set({ selectedId: initialStory })
    } catch (e) {
      console.error('Failed to load Naba data', e)
      set({ status: 'error' })
    }
  },
  select: (id) => {
    set({ selectedId: id, explainOpen: false, feedOpenMobile: false, quakeStep: 0 })
    syncUrl(id)
  },
  setFilter: (filter) => {
    const { selectedId, stories } = get()
    const sel = stories.find((s) => s.id === selectedId)
    set({ filter })
    if (sel && filter !== 'all' && sel.change_class !== filter) get().select(null)
  },
  setMonth: (monthIndex) => set({ monthIndex }),
  setQuakeStep: (quakeStep) => set({ quakeStep }),
  setPlaying: (isPlaying) => set({ isPlaying }),
  set: (p) => set(p),
  moveCamera: (target) => set((s) => ({ camera: { target, n: (s.camera?.n ?? 0) + 1 } })),
}))
