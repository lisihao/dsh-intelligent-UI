import { RPC_REMOTE } from './remote.js'
import { PACKAGE, SERVICE } from './contracts.js'
export const TYPERT = {
  package: PACKAGE, face: 'host', schemas: [],
  model: { services: [{ key: SERVICE, exportName: 'ExperienceControl', tags: [],
    description: 'Owner-controlled optional output presentation', summary: 'Intelligent Experience Platform', jsDoc: 'Settings and source-preserving content.',
    members: RPC_REMOTE.descriptors.map(d => ({ name: d.method, kind: 'method', signature: '(input?: unknown): Promise<unknown>' })), types: [],
  }], events: [], objects: [] }, invocations: RPC_REMOTE.descriptors,
}
