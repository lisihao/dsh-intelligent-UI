import { RPC_REMOTE } from './remote.js'
import { RPC_REMOTE as UIVERSE_REMOTE, SERVICE_ID as UIVERSE_SERVICE } from './uiverse/remote.js'
import { RPC_REMOTE as RESEARCH_REMOTE, SERVICE_ID as RESEARCH_SERVICE } from './research-remote.js'
import { PACKAGE, SERVICE } from './contracts.js'
export const TYPERT = {
  package: PACKAGE, face: 'host', schemas: [],
  model: { services: [{ key: SERVICE, exportName: 'ExperienceControl', tags: [],
    description: 'Owner-controlled optional output presentation', summary: 'Intelligent Experience Platform', jsDoc: 'Settings and source-preserving content.',
    members: RPC_REMOTE.descriptors.map(d => ({ name: d.method, kind: 'method', signature: '(input?: unknown): Promise<unknown>' })), types: [],
  }, { key: UIVERSE_SERVICE, exportName: 'UiComponentsControl', tags: [], description: 'Built-in read-only Uiverse component capability', summary: 'Offline frontend component discovery', jsDoc: 'Silent model skill and source-backed component tools.', members: UIVERSE_REMOTE.descriptors.map(d => ({ name: d.method, kind: 'method', signature: '(input?: unknown): Promise<unknown>' })), types: [] }, { key: RESEARCH_SERVICE, exportName: 'ResearchControl', tags: [], description: 'Report-bound research organization and human review', summary: 'Research evidence workspace', jsDoc: 'Source-bound analysis and local annotations.', members: RESEARCH_REMOTE.descriptors.map(d => ({ name: d.method, kind: 'method', signature: '(input: unknown): Promise<unknown>' })), types: [] }], events: [], objects: [] }, invocations: [...RPC_REMOTE.descriptors, ...UIVERSE_REMOTE.descriptors, ...RESEARCH_REMOTE.descriptors],
}
