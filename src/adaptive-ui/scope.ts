import { createContext, useContext } from 'react'
import type { CompositionSelection } from './planner.js'

/** Bound to one source output. Never changes global settings or foreign component owners. */
export const CompositionSelectionContext = createContext<CompositionSelection | undefined>(undefined)
export const CompositionDepthContext = createContext(false)
export const useCompositionSelection = () => useContext(CompositionSelectionContext)

/** Internal dispatch marker: preserve legacy routing outside compiler-owned blocks. */
export const ExperimentalBlockDispatchContext = createContext(false)
export const useExperimentalBlockDispatch = () => useContext(ExperimentalBlockDispatchContext)
