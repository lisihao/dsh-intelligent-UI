import { spawn } from 'node:child_process'

import { describe, expect, it } from 'vitest'

const browserIt = process.env.DIL_BROWSER_E2E === '1' ? it : it.skip

function runBrowserAcceptance(): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['tools/browser-dil/acceptance.mjs'], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    child.stdout.on('data', chunk => { output += chunk.toString() })
    child.stderr.on('data', chunk => { output += chunk.toString() })
    child.once('error', reject)
    child.once('exit', code => code === 0 ? resolve(output) : reject(new Error(`DIL_BROWSER_ACCEPTANCE_EXIT_${String(code)}\n${output}`)))
  })
}

describe('DIL real browser acceptance', () => {
  browserIt('runs the Host compiler, opaque frame/Worker, native view, watchdog, and narrow viewport fixture', async () => {
    const output = await runBrowserAcceptance()
    expect(output).toMatch(/DIL_BROWSER_RECEIPT=\{.*"viewports":3.*"modelCalls":0/s)
  }, 90_000)
})
