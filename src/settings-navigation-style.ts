import { appearanceTokens } from './appearance.js'
import type { ExperienceSettings } from './contracts.js'
import { resolveTheme } from './theme-contracts.js'
import { themeStyleTokens } from './theme-runtime.js'
import { settingsSectionIconMask } from './settings-navigation-icons.js'

/** Baseline action styling stays owned even while the native flat layout is active. */
export const settingsNavigationControlCss = `
.solar-settings-navigation-trigger:focus-visible { outline:2px solid var(--dsw-alias-label-primary,currentColor);outline-offset:3px; }
.solar-settings-navigation-trigger:hover { background:color-mix(in srgb,currentColor 8%,transparent)!important; }
.solar-settings-navigation-trigger:disabled { opacity:.55;cursor:not-allowed!important; }
.solar-settings-navigation-error { max-width:240px;overflow-wrap:anywhere; }
`

/** All selectors are bounded by a validated dialog with this occurrence's owned marker. */
export function buildSettingsNavigationCss(scope: string, hiddenButtonIndices: readonly number[], settings?: Pick<ExperienceSettings, 'appearance' | 'theme'>, rows: readonly { id: string, position: number }[] = []): string {
  const theme = resolveTheme(settings?.theme)
  const appearance = appearanceTokens(settings?.appearance, theme)
  const variables = { ...appearance.variables, ...themeStyleTokens(theme, appearance) }
  const declarations = Object.entries(variables).map(([key, value]) => `${key}:${value};`).join('')
  const hide = hiddenButtonIndices.map(index => `${scope}>nav>div:last-child>button:nth-child(${index}){display:none;}`).join('\n')
  // Move only the requested block; all other entries keep their relative order.
  const cluster = ['models', 'model-subscriptions', 'cost-meter', 'deepseek-web-login']
  const first = rows.findIndex(row => cluster.includes(row.id))
  const ordered = [...rows]
  if (first >= 0) {
    const block = cluster.flatMap(id => rows.filter(row => row.id === id))
    const remaining = rows.filter(row => !cluster.includes(row.id))
    const insertion = rows.slice(0, first).filter(row => !cluster.includes(row.id)).length
    remaining.splice(insertion, 0, ...block)
    ordered.splice(0, ordered.length, ...remaining)
  }
  const ordering = ordered.map((row, index) => `${scope}>nav>div:last-child>button:nth-child(${row.position}){order:${index};}`).join('\n')
  const icons = rows.map(row => `${scope}>nav>div:last-child>button:nth-child(${row.position})::before{mask-image:url("${settingsSectionIconMask(row.id)}");}`).join('\n')
  return `
${scope} {
 ${declarations}
 --dsw-alias-bg-layer-1:var(--iexp-solid-bg);--dsw-alias-bg-layer-2:var(--iexp-solid-card);--dsw-alias-bg-layer-3:color-mix(in srgb,var(--iexp-text) 6%,var(--iexp-solid-bg));
 --dsw-alias-label-primary:var(--iexp-text);--dsw-alias-label-secondary:var(--iexp-muted);--dsw-alias-border-l2:var(--iexp-line);
 display:grid!important;grid-template-columns:208px minmax(0,1fr);grid-template-rows:60px 44px minmax(0,1fr);
 background:var(--iexp-solid-bg)!important;color:var(--iexp-text);font:400 14px/1.6 system-ui,sans-serif;border-radius:20px;box-sizing:border-box;
}
${scope}>nav,${scope}>nav+div { display:contents!important; }
${scope}>nav>div:first-child { grid-row:1;grid-column:1;align-self:center;margin:0 0 0 20px;padding:0;height:auto;font:600 20px/1.4 system-ui,sans-serif; }
${scope}>nav>div:last-child {
 grid-row:3;grid-column:1;min-height:0;min-width:0;width:188px;box-sizing:border-box;margin:8px 0 16px 12px;padding:4px;
 display:flex;flex-direction:column;gap:2px;overflow:auto;scrollbar-width:thin;
}
${scope}>nav>div:last-child>button {
 display:flex;align-items:center;flex:none;box-sizing:border-box;width:100%;height:32px;min-height:32px;max-width:100%;margin:0;padding:4px 8px;gap:8px;
 border:0;border-radius:10px;background:transparent;color:var(--iexp-muted);font:400 14px/24px system-ui,sans-serif;text-align:left;
}
${scope}>nav>div:last-child>button[aria-current=true],${scope}>nav>div:last-child>button[aria-current=page] {
 background:color-mix(in srgb,var(--iexp-accent) 18%,var(--iexp-solid-bg));color:var(--iexp-text);font-weight:500;
}
${scope}>nav>div:last-child>button>:not(:last-child) { display:none; }
${scope}>nav>div:last-child>button::before {
 content:'';display:block;flex:0 0 16px;width:16px;height:16px;background:currentColor;mask-image:url("${settingsSectionIconMask('general')}");mask-size:16px 16px;mask-position:center;mask-repeat:no-repeat;
}
${scope}>nav>div:last-child>button>:last-child { min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
${scope}>nav>div:last-child>button:hover { background:var(--iexp-solid-card);color:var(--iexp-text); }
${scope}>nav>div:last-child>button:focus-visible { outline:2px solid var(--iexp-accent);outline-offset:1px; }
${scope}>nav+div>div:first-child {
 grid-row:1;grid-column:2;min-width:0;height:auto;box-sizing:border-box;padding:12px 20px 12px 0;display:flex;align-items:center;justify-content:flex-end;gap:8px;
}
${scope}>nav+div>div:first-child>div:first-child { min-width:0;display:flex;align-items:center;justify-content:flex-end;gap:8px;margin-left:auto; }
${scope}>nav+div>div:first-child>div:first-child button { height:32px;min-height:32px;border-radius:10px;font:400 13px/20px system-ui,sans-serif; }
${scope}>nav+div>div:first-child>button { flex:none;box-sizing:border-box;width:32px;height:32px;min-height:32px;padding:6px;border-radius:10px;color:var(--iexp-muted); }
${scope}>nav+div>div:last-child { grid-row:3;grid-column:2;min-width:0;min-height:0;box-sizing:border-box;padding:12px 20px 20px 12px;overflow:auto; }
${scope}>nav+div>div:last-child .dsh-experience.iexp-settings { padding:0;max-width:none;border-radius:0; }
${scope} .solar-settings-navigation-control { flex:none;white-space:nowrap; }
${scope} .solar-settings-navigation-trigger { height:32px;color:var(--iexp-text)!important;font:400 13px/20px system-ui,sans-serif!important; }
${scope} .solar-settings-navigation-trigger:focus-visible { outline-color:var(--iexp-accent); }
${scope}>[data-solar-settings-categories] { grid-row:2;grid-column:1/-1;min-width:0;box-sizing:border-box;padding:0 20px; }
${scope} .solar-settings-categories { display:flex;align-items:center;gap:4px;min-width:0;height:100%;box-sizing:border-box;padding:0 0 8px;border-bottom:1px solid var(--iexp-line); }
${scope} .solar-settings-category {
 position:relative;display:flex;align-items:center;justify-content:center;gap:8px;flex:1;min-width:0;min-height:32px;box-sizing:border-box;padding:4px 8px;white-space:nowrap;border:0;border-radius:10px;
 background:transparent;color:var(--iexp-muted);font:400 14px/24px system-ui,sans-serif;cursor:pointer;
}
${scope} .solar-settings-category svg { flex:none; }
${scope} .solar-settings-category[aria-pressed=true] { color:var(--iexp-text);background:var(--iexp-solid-card);font-weight:500; }
${scope} .solar-settings-category[aria-pressed=true]::after { content:'';position:absolute;left:16px;right:16px;bottom:-9px;height:2px;border-radius:2px;background:var(--iexp-accent); }
${scope} .solar-settings-category:hover { color:var(--iexp-text);background:var(--iexp-solid-card); }
${scope} .solar-settings-category:focus-visible { outline:2px solid var(--iexp-accent);outline-offset:2px; }
${icons}
@supports(reading-flow:flex-visual) {
 ${scope}>nav>div:last-child { reading-flow:flex-visual; }
 ${ordering}
}
${hide}
@media(max-width:600px) {
 ${scope} { grid-template-columns:minmax(0,1fr);grid-template-rows:56px auto auto minmax(0,1fr); }
 ${scope}>nav>div:first-child { grid-row:1;grid-column:1;margin-left:16px;font-size:18px;justify-self:start; }
 ${scope}>nav+div>div:first-child { grid-row:1;grid-column:1;padding:12px 16px 12px 76px;justify-self:stretch; }
 ${scope}>nav+div>div:first-child>div:first-child { gap:4px; }
 ${scope} .solar-settings-navigation-trigger { font-size:12px!important;padding:2px 4px!important; }
 ${scope}>[data-solar-settings-categories] { padding:0 12px; }
 ${scope} .solar-settings-categories { display:grid;grid-template-columns:repeat(2,minmax(0,1fr));grid-auto-rows:32px;gap:4px;height:auto;padding-bottom:8px; }
 ${scope} .solar-settings-category { padding:4px 8px;min-height:32px; }
 ${scope} .solar-settings-category[aria-pressed=true]::after { bottom:0; }
 ${scope}>nav>div:last-child { grid-row:3;grid-column:1;width:auto;max-height:136px;margin:12px 12px 0;padding:4px;flex-direction:row;flex-wrap:wrap;overflow:auto; }
 ${scope}>nav>div:last-child>button { width:auto;min-height:32px;padding:4px 8px;font-size:13px; }
 ${scope}>nav+div>div:last-child { grid-row:4;grid-column:1;padding:16px; }
}
@media(prefers-reduced-motion:reduce) { ${scope} .solar-settings-category { transition:none; } }
`
}
