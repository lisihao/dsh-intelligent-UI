// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { compileDilSource } from '../src/dil/compiler.js'
import { createDilRunner } from '../src/dil/runtime.js'

const reference = vi.hoisted(() => ({ requestState: vi.fn(), trigger: vi.fn(), options: undefined as any }))
vi.mock('@solar-ui/dil-reference/sandbox', () => ({
  DilSandbox: class {
    frame: HTMLIFrameElement
    constructor(options: any) {
      reference.options = options
      this.frame = document.createElement('iframe')
      options.container.appendChild(this.frame)
    }
    async connect() { return this }
    createRunner() {}
    setCompiledDil() {}
    trigger(...args: unknown[]) { reference.trigger(...args) }
    requestState() { reference.requestState() }
    dispose() { this.frame.remove() }
  },
}))
const compiled = compileDilSource('<text>Example</text>')
const runners: ReturnType<typeof createDilRunner>[] = []
afterEach(() => {
  runners.splice(0).forEach(runner => runner.dispose())
  document.body.replaceChildren()
  vi.useRealTimers()
  vi.clearAllMocks()
})
async function setup() {
  const container = document.createElement('div'); document.body.append(container)
  const runner = createDilRunner({container,frameUrl:'http://127.0.0.1:12345/runner.html',onSnapshot:vi.fn(),onStateChange:vi.fn(),onFailure:vi.fn()})
  runners.push(runner)
  await runner.start(compiled)
  const send = (state: unknown, overrides: Record<string, unknown> = {}) => {
    window.dispatchEvent(new MessageEvent('message', {source:container.querySelector('iframe')!.contentWindow,origin:'null',data:{__dilFrame:true,protocolVersion:1,kind:'stateSnapshot',state},...overrides}))
  }
  return {runner,send}
}

describe('DIL explicit state capture boundary',()=>{
  it('requests state after posted controls, ignores unrelated messages and accepts only its owned opaque frame',async()=>{
    const {runner,send}=await setup()
    runner.trigger('setSeats',[7])
    const capture=runner.captureState()
    expect(reference.trigger).toHaveBeenCalledWith('setSeats',[7])
    expect(reference.requestState).toHaveBeenCalledOnce()
    let settled=false;void capture.then(()=>{settled=true})
    send({seats:99},{source:window})
    send({seats:99},{origin:'http://untrusted.test'})
    await Promise.resolve();expect(settled).toBe(false)
    send({seats:7})
    await expect(capture).resolves.toEqual({seats:7})
  })
  it('rejects malformed captured state rather than submitting it',async()=>{
    const {runner,send}=await setup();const capture=runner.captureState()
    send({seats:Number.NaN})
    await expect(capture).rejects.toMatchObject({code:'DIL_RUNNER_STATE_INVALID'})
  })
  it('rejects a missing response after the bounded wait',async()=>{
    vi.useFakeTimers();const {runner}=await setup();const capture=runner.captureState()
    const check=expect(capture).rejects.toMatchObject({code:'DIL_RUNNER_STATE_TIMEOUT'})
    await vi.advanceTimersByTimeAsync(2001);await check
  })
  it('rejects capture on failure or disposal and releases the frame',async()=>{
    const {runner}=await setup();const capture=runner.captureState()
    const check=expect(capture).rejects.toMatchObject({code:'DIL_RUNNER_DISPOSED'})
    runner.dispose();await check;expect(document.querySelector('iframe')).toBeNull()
    const second=await setup();const pending=second.runner.captureState()
    const failed=expect(pending).rejects.toMatchObject({code:'DIL_RUNNER_REFERENCE_FAILURE'})
    reference.options.onFailure({message:'handler failed'},'event');await failed
  })
})
