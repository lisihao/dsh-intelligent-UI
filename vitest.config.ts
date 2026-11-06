import { defineConfig } from 'vitest/config'
import { dilReferenceAliases } from './tools/dil-reference.mjs'
export default defineConfig({resolve:{alias:dilReferenceAliases()},test:{include:['tests/**/*.test.ts'],testTimeout:15000}})
