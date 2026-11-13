// React 18 has no typing for the `inert` attribute; it must be passed as an empty string.
import 'react'
declare module 'react' {
  interface HTMLAttributes<T> {
    inert?: '' | undefined
  }
}
