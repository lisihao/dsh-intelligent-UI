import { createContext, useContext } from 'react'
import type { CompositionSelection } from './planner.js'

/** Bound to one source output. Never changes global settings or foreign component owners. */
export const CompositionSelectionContext = createContext<CompositionSelection | undefined>(undefined)
export const CompositionDepthContext = createContext(false)
export const useCompositionSelection = () => useContext(CompositionSelectionContext)
