import React, { useLayoutEffect, useRef, useState } from 'react'
import { AppBridge } from '@modelcontextprotocol/ext-apps/app-bridge'
import { JSONRPCMessageSchema } from '@modelcontextprotocol/core'
import type { CallToolResult, JSONRPCMessage, Transport } from '@modelcontextprotocol/client'

export interface McpAppViewProps {
  proxyUrl: string
  html: string
  input: Record<string, unknown>
  result: CallToolResult
  callTool: (name: string, args: Record<string, unknown>) => Promise<CallToolResult>
  onError?: (error: Error) => void
  onTeardown?: (completed: boolean) => void
}

class OriginTransport implements Transport {
  onmessage?: Transport['onmessage']
  onerror?: Transport['onerror']
  onclose?: Transport['onclose']
  private listener = (event: MessageEvent) => {
    if (event.source !== this.target || event.origin !== this.origin) return
    const parsed = JSONRPCMessageSchema.safeParse(event.data)
    if (parsed.success) this.onmessage?.(parsed.data)
    else if (event.data?.jsonrpc === '2.0') this.onerror?.(new Error('Invalid MCP Apps message'))
  }
  constructor(private target: Window, private origin: string) {}
  async start() { window.addEventListener('message', this.listener) }
  async send(message: JSONRPCMessage) { this.target.postMessage(message, this.origin) }
  async close() { window.removeEventListener('message', this.listener); this.onclose?.() }
}

/** Parent passes a proxy created by the Host, not arbitrary HTML as a frame URL. */
export function McpAppView(props: McpAppViewProps) {
  const frame = useRef<HTMLIFrameElement>(null)
  const [error, setError] = useState<string>()
  useLayoutEffect(() => {
    let disposed = false
    let bridge: AppBridge | undefined
    let initialized = false
    let timeout: ReturnType<typeof setTimeout> | undefined
    const element = frame.current
    if (!element) return
    const fail = (value: unknown) => {
      if (disposed) return
      const e = value instanceof Error ? value : new Error(String(value))
      setError(e.message); props.onError?.(e)
    }
    let origin: string
    try {
      const proxy = new URL(props.proxyUrl)
      if (!['http:', 'https:'].includes(proxy.protocol) || proxy.origin === window.location.origin) throw new Error('MCP Apps proxy must have a separate HTTP(S) origin')
      if (typeof props.callTool !== 'function') throw new Error('MCP Apps action authorization unavailable')
      origin = proxy.origin
    } catch (e) { fail(e); return }
    const ready = (event: MessageEvent) => {
      if (event.source !== element.contentWindow || event.origin !== origin || event.data?.method !== 'ui/notifications/sandbox-proxy-ready') return
      window.removeEventListener('message', ready)
      if (timeout) clearTimeout(timeout)
      const target = element.contentWindow
      if (!target || disposed) return
      bridge = new AppBridge(null, { name: 'DSH Intelligent Experience', version: '0.1.0' }, { serverTools: {} }, { hostContext: { displayMode: 'inline', availableDisplayModes: ['inline'], platform: 'web' } })
      bridge.oncalltool = async ({ name, arguments: args }) => props.callTool(name, args ?? {})
      bridge.oninitialized = () => {
        if (disposed || !bridge) return
        initialized = true
        void bridge.sendToolInput({ arguments: props.input }).then(() => bridge?.sendToolResult(props.result)).catch(fail)
      }
      bridge.onerror = fail
      void bridge.connect(new OriginTransport(target, origin)).then(() => bridge?.sendSandboxResourceReady({ html: props.html })).catch(fail)
    }
    window.addEventListener('message', ready)
    timeout = setTimeout(() => fail(new Error('MCP Apps proxy did not become ready')), 10000)
    element.src = props.proxyUrl
    return () => {
      disposed = true
      window.removeEventListener('message', ready)
      if (timeout) clearTimeout(timeout)
      if (bridge) { const current = bridge; void (initialized ? current.teardownResource({}, { timeout: 1000 }).then(() => props.onTeardown?.(true), () => props.onTeardown?.(false)) : Promise.resolve()).finally(() => current.close()) }
    }
  }, [props.proxyUrl, props.html, props.input, props.result, props.callTool, props.onError, props.onTeardown])
  return React.createElement('div', null,
    error ? React.createElement('p', { role: 'alert' }, `MCP App: ${error}`) : null,
    React.createElement('iframe', { ref: frame, title: 'MCP application', sandbox: 'allow-scripts allow-same-origin', style: { width: '100%', minHeight: 240, border: 0 }, hidden: !!error }))
}
