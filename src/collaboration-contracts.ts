/** Presentation contract; keys and session addresses never become display text. */
export type CollaborationStatus = 'running' | 'completed' | 'failed' | 'stopped' | 'unknown' | 'inactive' | 'preparing'
export type CollaborationTarget = { sessionId: string } | { parentSessionId: string; childSessionId: string; mode: 'one-shot' | 'continuable' | 'unknown' }
export interface CollaborationMember { key: string; label: string; role?: string; status: CollaborationStatus; statusLabel: string; current?: boolean; target?: CollaborationTarget }
export interface CollaborationTask { key: string; label: string; description?: string; status: CollaborationStatus; statusLabel: string; owner?: string; /** Already resolved display labels, never task ids. */ dependencies?: string[] }
export interface CollaborationChild { key: string; label: string; description?: string; status: CollaborationStatus; statusLabel: string; target?: CollaborationTarget }
export interface CollaborationCall { key: string; label: string; description?: string; status: CollaborationStatus; statusLabel: string; prompt?: string; result?: string; resultTitle: string; previous?: boolean; target?: CollaborationTarget }
export type CollaborationSourceState = 'loading' | 'ready' | 'unavailable' | 'failed'
export interface CollaborationSnapshot {
 sessionId: string
 loading: boolean
 stale?: string
 running: boolean
 team: { state: CollaborationSourceState; notice?: string; members: CollaborationMember[]; tasks: CollaborationTask[] }
 children: { state: CollaborationSourceState; notice?: string; rows: CollaborationChild[] }
 pstack: { state: CollaborationSourceState; summary: string; context?: string; calls: CollaborationCall[]; history: CollaborationCall[] }
}
