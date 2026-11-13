import { create } from 'zustand'
import type { ChangeStory, FireData, Filter, Layer, MonthStep, TimeStep, WetlandData } from './types'
import { loadFires, loadLayers, loadStories, loadWetlands } from './data/loadData'
import { formatDateShort } from './lib'

export type CameraTarget = 'globe' | 'egypt' | 'delta'

interface State {
  status: 'loading' | 'ready' | 'error'
  stories: ChangeStory[]
  layers: Layer[]
  /** Monthly wetland extents drawn on the globe; null when the dataset has none. */
  wetlands: WetlandData | null
  /** Burn-scar extents (likely / possible) drawn on the globe; null when the dataset has none. */
  fires: FireData | null
  /** The months the wetland layer can show, oldest first. */
  months: MonthStep[]
  selectedId: string | null
  filter: Filter
  /** Index into `months`: which month the globe is showing. */
  monthIndex: number
  /** Per fire story: the radar passes its burn layer can show (oldest first) and the one shown.
   *  Selecting one of these stories turns the slider into that story's burn-pass slider. */
  fireTimelines: Record<string, FireTimeline>
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
  setFireIndex: (storyId: string, i: number) => void
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

export interface FireTimeline {
  steps: TimeStep[]
  index: number
}

/** One burn timeline per fire story: every pass in that story's series (the baseline included,
 *  where nothing is burned yet), opening on the pass its headline comes from. */
function fireTimelinesOf(fires: FireData | null, stories: ChangeStory[]): Record<string, FireTimeline> {
  const out: Record<string, FireTimeline> = {}
  if (!fires) return out
  const byStory = new Map<string, typeof fires.features>()
  for (const f of fires.features) byStory.set(f.properties.story_id, [...(byStory.get(f.properties.story_id) ?? []), f])
  for (const [id, features] of byStory) {
    const dates = new Set(features.map((f) => f.properties.date))
    stories.find((s) => s.id === id)?.series.forEach((p) => dates.add(p.date))
    const steps = [...dates].sort().map((key) => ({ key, label: formatDateShort(key) }))
    const i = steps.findIndex((s) => s.key === features.find((f) => f.properties.headline)?.properties.date)
    out[id] = { steps, index: i >= 0 ? i : Math.max(0, steps.length - 1) }
  }
  return out
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
  fires: null,
  months: [],
  selectedId: null,
  filter: 'all',
  monthIndex: 0,
  fireTimelines: {},
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
      const [stories, layers, wetlands, fires] = await Promise.all([loadStories(), loadLayers(), loadWetlands(), loadFires()])
      const sorted = [...stories].sort((a, b) => b.published.localeCompare(a.published))
      const months = monthsOf(wetlands)
      // open on the most recent month, the way a news site opens on today; the burn layer opens on
      // the pass its story's headline quotes, so the map and the headline agree
      set({ stories: sorted, layers, wetlands, fires, months, monthIndex: Math.max(0, months.length - 1), fireTimelines: fireTimelinesOf(fires, sorted), status: 'ready' })
      if (initialStory && sorted.some((s) => s.id === initialStory)) set({ selectedId: initialStory })
    } catch (e) {
      console.error('Failed to load Naba data', e)
      set({ status: 'error' })
    }
  },
  select: (id) => {
    // the slider may switch between wetland months and burn passes, so stop any playback
    set({ selectedId: id, explainOpen: false, feedOpenMobile: false, ...(id !== get().selectedId ? { isPlaying: false } : {}) })
    syncUrl(id)
  },
  setFilter: (filter) => {
    const { selectedId, stories } = get()
    const sel = stories.find((s) => s.id === selectedId)
    set({ filter })
    if (sel && filter !== 'all' && sel.change_class !== filter) get().select(null)
  },
  setMonth: (monthIndex) => set({ monthIndex }),
  setFireIndex: (storyId, index) =>
    set((s) => (s.fireTimelines[storyId] ? { fireTimelines: { ...s.fireTimelines, [storyId]: { ...s.fireTimelines[storyId], index } } } : {})),
  setPlaying: (isPlaying) => set({ isPlaying }),
  set: (p) => set(p),
  moveCamera: (target) => set((s) => ({ camera: { target, n: (s.camera?.n ?? 0) + 1 } })),
}))
