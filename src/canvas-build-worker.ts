import * as esbuild from 'esbuild-wasm'

interface BuildInput { entry: string, dependencyRoot: string, banner: string }
interface SourceFailure { code: string, message: string, status: number }
type SourceMessage = { type: 'start', input: BuildInput } | { type: 'source-result', id: number, source?: string, error?: SourceFailure } | { type: 'cancel' }

if (!process.send) throw new Error('CANVAS_BUILD_WORKER_REQUIRED')
const shared: Readonly<Record<string, string>> = Object.freeze({
  '../canvas-viewport': 'src/lib/canvas-viewport.ts',
  '../html-in-canvas': 'src/lib/html-in-canvas.ts',
  '../rect-cache': 'src/lib/rect-cache.ts',
})
const allowedThree = new Set([
  'three',
  'three/addons/controls/OrbitControls.js',
  'three/addons/loaders/DRACOLoader.js',
  'three/addons/loaders/GLTFLoader.js',
  'three/addons/loaders/SVGLoader.js',
  'three/addons/utils/BufferGeometryUtils.js',
])
const lifetime = new AbortController()
const pending = new Map<number, { resolve: (value: string) => void, reject: (error: Error) => void }>()
let nextRequest = 0
let buildContext: esbuild.BuildContext | undefined
let sourceFailure: SourceFailure | undefined
let started = false

function send(message: unknown) {
  if (process.connected) process.send!(message, () => undefined)
}

function loadSource(path: string): Promise<string> {
  lifetime.signal.throwIfAborted()
  const id = ++nextRequest
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    send({ type: 'source-request', id, path })
  })
}

function cancel() {
  lifetime.abort()
  if (buildContext) void buildContext.cancel().catch(() => undefined)
  for (const item of pending.values()) item.reject(new Error('CANVAS_BUILD_CANCELLED'))
  pending.clear()
}

process.on('disconnect', cancel)
process.on('message', (message: SourceMessage) => {
  if (message.type === 'start') {
    if (!started) { started = true; void run(message.input) }
    return
  }
  if (message.type === 'cancel') {
    cancel()
    return
  }
  if (message.type !== 'source-result') return
  const request = pending.get(message.id)
  if (!request) return
  pending.delete(message.id)
  if (message.error) {
    sourceFailure ??= message.error
    request.reject(new Error(message.error.message))
  } else if (typeof message.source === 'string') {
    request.resolve(message.source)
  } else {
    request.reject(new Error('CANVAS_BUILD_SOURCE_MISSING'))
  }
})

async function run(input: BuildInput) {
  let output: string | undefined
  let failure: SourceFailure | undefined
  try {
    buildContext = await esbuild.context({
      entryPoints: ['canvas-ui-entry'],
      bundle: true,
      platform: 'browser',
      format: 'esm',
      target: 'es2022',
      write: false,
      sourcemap: false,
      logLevel: 'silent',
      legalComments: 'inline',
      banner: { js: input.banner },
      plugins: [{
        name: 'pinned-canvas-ui-source',
        setup(build) {
          build.onResolve({ filter: /^canvas-ui-entry$/ }, () => ({ path: input.entry, namespace: 'canvas-ui-source' }))
          build.onResolve({ filter: /.*/, namespace: 'canvas-ui-source' }, async args => {
            const path = Object.hasOwn(shared, args.path) ? shared[args.path] : undefined
            if (path) return { path, namespace: 'canvas-ui-source' }
            if (allowedThree.has(args.path)) return build.resolve(args.path, { resolveDir: input.dependencyRoot, kind: args.kind })
            return { errors: [{ text: `Unsupported pinned Canvas UI dependency: ${args.path}` }] }
          })
          build.onLoad({ filter: /.*/, namespace: 'canvas-ui-source' }, async args => ({ contents: await loadSource(args.path), loader: 'ts' }))
        },
      }],
    })
    lifetime.signal.throwIfAborted()
    const result = await buildContext.rebuild()
    lifetime.signal.throwIfAborted()
    output = result.outputFiles?.[0]?.text
    if (!output) throw new Error('CANVAS_BUILD_EMPTY')
  } catch {
    failure = sourceFailure ?? { code: 'CANVAS_BUILD_FAILED', message: 'Canvas UI 组件构建失败，请检查本地构建依赖后重试。', status: 502 }
  } finally {
    try { await buildContext?.dispose() } catch { failure ??= { code: 'CANVAS_BUILD_FAILED', message: 'Canvas UI 构建资源无法释放。', status: 502 } }
    // This process owns its esbuild service; never stop the Host's shared service.
    try { await esbuild.stop() } catch { failure ??= { code: 'CANVAS_BUILD_FAILED', message: 'Canvas UI 构建服务无法关闭。', status: 502 } }
    if (process.connected) {
      await new Promise<void>(resolve => process.send!({ type: 'result', output: failure ? undefined : output, error: failure }, () => resolve()))
      process.disconnect()
    }
  }
}
