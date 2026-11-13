import { create } from 'zustand'
import type { ChangeStory, Filter, Layer } from './types'
import { loadLayers, loadStories } from './data/loadData'

export type CameraTarget = 'globe' | 'egypt' | 'delta'

interface State {
  status: 'loading' | 'ready' | 'error'
  stories: ChangeStory[]
  layers: Layer[]
  selectedId: string | null
  filter: Filter
  frameIndex: number
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
  setFrame: (i: number) => void
  setPlaying: (p: boolean) => void
  set: (p: Partial<State>) => void
  moveCamera: (target: CameraTarget) => void
}

const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams()
export const isDemo = params.get('demo') === '1'
const initialStory = params.get('story')

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
  selectedId: null,
  filter: 'all',
  frameIndex: 0,
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
      const [stories, layers] = await Promise.all([loadStories(), loadLayers()])
      const sorted = [...stories].sort((a, b) => b.published.localeCompare(a.published))
      set({ stories: sorted, layers, status: 'ready' })
      if (initialStory && sorted.some((s) => s.id === initialStory)) set({ selectedId: initialStory })
    } catch (e) {
      console.error('Failed to load Naba data', e)
      set({ status: 'error' })
    }
  },
  select: (id) => {
    set({ selectedId: id, explainOpen: false, feedOpenMobile: false })
    syncUrl(id)
  },
  setFilter: (filter) => {
    const { selectedId, stories } = get()
    const sel = stories.find((s) => s.id === selectedId)
    set({ filter })
    if (sel && filter !== 'all' && sel.change_class !== filter) get().select(null)
  },
  setFrame: (frameIndex) => set({ frameIndex }),
  setPlaying: (isPlaying) => set({ isPlaying }),
  set: (p) => set(p),
  moveCamera: (target) => set((s) => ({ camera: { target, n: (s.camera?.n ?? 0) + 1 } })),
}))
