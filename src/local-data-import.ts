import { createElement as h, useEffect, useRef, useState, type FormEvent, type ReactElement } from 'react'
import { ThemeButton, ThemeInput } from './theme-components.js'
import type { ExperienceApi, ExperienceArtifact, PublishInput } from './contracts.js'
import { LOCAL_FILE_SCOPE, LOCAL_IMPORT_PROVIDER } from './file-library-contracts.js'

// Published Host configuration permits at most 16 MiB; its actual configured artifact limit remains authoritative.
export const MAX_IMPORT_SOURCE_BYTES = 16 * 1024 * 1024
export function importedContent(name: string, text: string, sessionId: string, sourceNote = ''): PublishInput {
  if (!/\.(json|md|markdown|txt)$/i.test(name)) throw new Error('请选择 JSON、Markdown 或 TXT 文件。')
  if (!text.trim()) throw new Error('文件为空，请选择有内容的数据文件。')
  if (new TextEncoder().encode(text).byteLength > MAX_IMPORT_SOURCE_BYTES) throw new Error('文件超过 16 MiB，请先选择较小的数据文件。')
  let payload: PublishInput['payload'] = text
  if (/\.json$/i.test(name)) {
    try { payload = JSON.parse(text.replace(/^\uFEFF/, '')) as PublishInput['payload'] }
    catch { throw new Error('JSON 文件格式不正确，请修正后重新导入。') }
  }
  const label = sourceNote.trim() ? `本地导入：${Array.from(name).slice(0, 80).join('')} · ${Array.from(sourceNote.trim()).slice(0, 190).join('')}` : `本地导入：${Array.from(name).slice(0, 240).join('')}`
  return { source: { sessionId, kind: 'generated', label }, protocol: 'content', providerId: LOCAL_IMPORT_PROVIDER, raw: text, payload }
}

export function importError(cause: unknown, library = false): string {
  const text = cause instanceof Error ? cause.message : String(cause)
  const size = text.match(/Artifact is (\d+) bytes; limit is (\d+) bytes/)
  if (size) return `内容需 ${new Intl.NumberFormat().format(Number(size[1]))} 字节，当前上限 ${new Intl.NumberFormat().format(Number(size[2]))} 字节，请选择较小的数据文件。`
  if (/already has the maximum of \d+ artifacts/.test(text)) return library ? '文件库保存的内容已达上限，请使用已导入文件，或在插件设置中调整存储上限。' : '当前会话保存的内容已达上限，请选择其他会话。'
  return text
}

export async function readLocalText(file: Pick<File, 'arrayBuffer'>): Promise<string> {
  const bytes = await file.arrayBuffer()
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) }
  catch { throw new Error('文件不是有效的 UTF-8 文本，请另存为 UTF-8 后导入。') }
}

/** An explicit ordinary UI path; never submits a model request or edits a session log. */
export function LocalDataImport({ api, sessionId, onImported }: { api: Pick<ExperienceApi, 'publish'>, sessionId: string, onImported: (artifact: ExperienceArtifact) => void }): ReactElement {
  const [file, setFile] = useState<File>(), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [sourceNote, setSourceNote] = useState('')
  const generation = useRef(0), active = useRef(false), picker = useRef<HTMLInputElement>(null)
  useEffect(() => { generation.current++; active.current = false; setBusy(false); setFile(undefined); setError(''); setNotice(''); setSourceNote(''); if (picker.current) picker.current.value = ''; return () => { generation.current++ } }, [sessionId, api])
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!file || active.current) return
    const token = generation.current; active.current = true; setBusy(true); setError(''); setNotice('')
    try {
      if (file.size > MAX_IMPORT_SOURCE_BYTES) throw new Error('文件超过 16 MiB，请先选择较小的数据文件。')
      const text = await readLocalText(file)
      if (token !== generation.current) return
      const value = importedContent(file.name, text, sessionId, sourceNote), artifact = await api.publish(value)
      if (token !== generation.current) return
      onImported(artifact); setSourceNote(''); setNotice(`已导入 ${file.name}，原始内容保留。`); setFile(undefined); if (picker.current) picker.current.value = ''
    } catch (cause) { if (token === generation.current) setError(`导入失败：${importError(cause, sessionId === LOCAL_FILE_SCOPE)}`) }
    finally { if (token === generation.current) { active.current = false; setBusy(false) } }
  }
  return h('form', { className: 'iexp-local-import', onSubmit: (event: FormEvent<HTMLFormElement>) => void submit(event), 'aria-label': '导入本地数据' },
    h('div', { style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 } },
      h('label', null, '本地数据文件 ', h(ThemeInput, { ref: picker, type: 'file', accept: '.json,.md,.markdown,.txt', disabled: busy, 'aria-label': '本地数据文件', onChange: event => { setFile(event.currentTarget.files?.[0]); setSourceNote(''); setError(''); setNotice('') }, style: { maxWidth: '100%', minWidth: 0 } })),
      h(ThemeButton, { type: 'submit', disabled: busy || !file }, busy ? '正在导入…' : '导入并展示')),
    h('label', { style: { marginBlockStart: 8 } }, '来源与口径（可选） ', h(ThemeInput, { type: 'text', value: sourceNote, maxLength: 190, disabled: busy, placeholder: '来源链接、数据范围或抽样说明', onChange: event => setSourceNote(event.currentTarget.value), style: { flex: 1, minWidth: 0 } })),
    h('p', { className: 'iexp-import-help' }, sessionId === LOCAL_FILE_SCOPE ? '支持 JSON、Markdown 和 TXT。保存到智能 UI 文件库，不发送给模型；文件容量以插件当前限制为准。' : '支持 JSON、Markdown 和 TXT。仅保存到智能 UI 的当前会话内容，不发送给模型；文件容量以插件当前限制为准。'),
    error && h('p', { role: 'alert' }, error), notice && h('p', { role: 'status' }, notice))
}
