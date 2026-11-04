import { createContext } from 'react'
import { loadCanvasEffect } from './canvas-runtime-client.js'

/** A consumer-owned DocumentView may outlive the plugin that created it. */
export const CanvasRuntimeContext = createContext(loadCanvasEffect)
