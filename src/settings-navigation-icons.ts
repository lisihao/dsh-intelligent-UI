/** Owned outline icons; native labels and handlers remain untouched. */
const paths: Readonly<Record<string, string>> = {
  account: '<circle cx="12" cy="8" r="3"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/>',
  general: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>',
  models: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0"/>',
  'model-subscriptions': '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 10h18M7 15h4"/>',
  'dsh-imagegen': '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 6-6 4 4 3-3 5 5"/>',
  'agent-presets': '<circle cx="12" cy="5" r="3"/><circle cx="5" cy="18" r="3"/><circle cx="19" cy="18" r="3"/><path d="m10 8-4 7m8-7 4 7M8 18h8"/>',
  'agent-persona': '<rect x="4" y="3" width="16" height="18" rx="3"/><circle cx="12" cy="9" r="3"/><path d="M7 18c0-5 10-5 10 0"/>',
  'cost-meter': '<circle cx="12" cy="12" r="9"/><path d="M15 8H10a2 2 0 0 0 0 4h4a2 2 0 0 1 0 4H9m3-10v12"/>',
  'deepseek-web-login': '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M3 9h18m-9 3v5m-3-2 3 3 3-3"/>',
  'solar-model-radar': '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><path d="m12 12 7-7M12 3v2M3 12h2m14 0h2m-9 7v2"/>',
  'dream-skin': '<path d="M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 0-4h-1a2 2 0 0 1 0-4h4a5 5 0 0 0 5-5c0-3-4-5-9-5Z"/><path d="M7 8h.01M12 6h.01M6 13h.01M17 8h.01"/>',
  'solar-intelligent-experience': '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z"/>',
  'session-prefix': '<path d="M5 5h14M12 5v14m-4 0h8"/>',
  'solar-rlm': '<path d="M8 4H4v16h4m8-16h4v16h-4m-2-10-4 4m0-4 4 4"/>',
  'solar-native-collaboration': '<rect x="3" y="3" width="6" height="6" rx="1.5"/><rect x="15" y="15" width="6" height="6" rx="1.5"/><path d="M9 6h6a3 3 0 0 1 3 3v6M6 9v6a3 3 0 0 0 3 3h6"/>',
  'solar-chatgpt-web': '<path d="M21 11a8 8 0 0 1-8 8H7l-4 3V11a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8Z"/><path d="M7 9h10M7 13h7"/>',
  'solar-quant-research': '<path d="M3 3v18h18M6 16l5-6 4 3 6-8"/>',
  bili: '<rect x="3" y="6" width="18" height="15" rx="3"/><path d="m8 2 4 4 4-4M8 11v4m8-4v4"/>',
  plugins: '<path d="M8 3v5m8-5v5M6 8h12v4a6 6 0 0 1-12 0V8Zm6 10v4"/>',
  market: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
}
export function settingsSectionIconMask(id: string): string {
  const drawing = Object.hasOwn(paths, id) ? paths[id]! : paths.general!
  return 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${drawing}</svg>`)
}
