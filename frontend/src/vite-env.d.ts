/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional. If set, data is fetched from {VITE_API_URL}/changes and /layers instead of static files. */
  readonly VITE_API_URL?: string
}
