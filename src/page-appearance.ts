/**
 * Reversible appearance for the published conversation-view outlet. The host
 * still assembles each original entry, including its inject/store/locale/slots.
 * The appearance sheet supplies --iexp-* on this addressable, display:contents
 * ancestor; no foreign registration, DOM node or business state is replaced.
 */
export function pageAppearanceCss(enabled: boolean): string {
  if (!enabled) return ''
  const outlet = '[data-slot="conversation.view"]'
  // The installed Mnemon 0.5.32 uses CSS modules. Match a complete semantic
  // class token, never its generated hash or similarly named descendants.
  const mnemonCardNames = ['healthStrip', 'providerHealth', 'storageDomains', 'runtimeSummaryCard', 'runtimeEntry', 'bodyCard', 'readSourceCard', 'insightCard']
  const moduleClass = (name: string) => `:is([class$="_${name}"],[class*="_${name} "])`
  const mnemonCardClasses = [
    ...mnemonCardNames.map(moduleClass),
    `${moduleClass('storageAreaGrid')} > article[data-status]`,
    `${moduleClass('documentSummary')} > article`,
  ]
  const mnemon = '[data-dsh-plugin="dsh-mnemon"][data-dsh-part="mnemon-view"]'
  const benchmarkCard = ':is(section,article)[style*="--dsw-alias-settings-card-fill"]'
  const cards = [
    `${outlet} .wsp-card`,
    `${outlet} .wsp-card-panel`,
    `${outlet} .wsp-empty-card`,
    `${outlet} .lc-card`,
    `${outlet} .lc-fa-card`,
    `${outlet} .lc-gate-card`,
    `${outlet} .lc-ov-heat-card`,
    `${outlet} .solar-workflow-studio__panel`,
    `${outlet} .solar-workflow-studio__inspector`,
    `${outlet} .solar-workflow-studio__flow-picker`,
    `${outlet} .solar-workflow-studio__run-list`,
    `${outlet} .solar-workflow-studio__draft-summary`,
    `${outlet} .solar-workflow-studio__empty-state`,
    // Keep the original statistics sections and cover the newer catalog/run
    // cards, which use the same public surface token without aria-label.
    `${outlet} section[aria-label][style*="--dsw-alias-settings-card-fill"]`,
    `${outlet} #bench-top-panel ${benchmarkCard}`,
    ...mnemonCardClasses.map(selector => `${outlet} ${mnemon} ${selector}`),
  ].join(',\n')
  const cardDescendants = [
    '.wsp-card', '.wsp-card-panel', '.wsp-empty-card', '.lc-card', '.lc-fa-card', '.lc-gate-card', '.lc-ov-heat-card',
    '.solar-workflow-studio__panel', '.solar-workflow-studio__inspector', '.solar-workflow-studio__flow-picker', '.solar-workflow-studio__run-list', '.solar-workflow-studio__draft-summary', '.solar-workflow-studio__empty-state',
    benchmarkCard, ...mnemonCardClasses,
  ].join(',')
  const hoveredCards = cards.split(',\n').map(selector => `${selector}:hover:not(:has(:is(${cardDescendants}):hover))`).join(',\n')
  return `
/* The native shared scrollport already follows the tail. Give its active Chat
   outlet the unused vertical space so short exchanges sit by the composer.
   No row order, scroll ownership, viewport height or foreign page is changed. */
[data-conversation-scroll] [data-slot="conversation.view"]:has([data-chat-flow]) {
  display: flex !important;
  flex: 1 0 auto;
  flex-direction: column;
  justify-content: flex-end;
}
[data-dsh-thoughtdag] .dsh-td-overlay { background: transparent; }
[data-dsh-thoughtdag] :is(.dsh-td-bar,.dsh-td-switch) { background: var(--iexp-card); color: var(--iexp-text); border-color: var(--iexp-line); font-family: var(--iexp-font); border-radius: var(--iexp-control-radius); }
[data-dsh-thoughtdag] .dsh-td-brand { color: var(--iexp-text); }
[data-dsh-thoughtdag] .dsh-td-title { color: var(--iexp-muted); }
${outlet} {
  --dsw-alias-bg-base: var(--iexp-bg);
  --dsw-alias-bg-layer-1: var(--iexp-card);
  --dsw-alias-bg-layer-2: var(--iexp-soft);
  --dsw-alias-bg-layer-3: var(--iexp-card-hover);
  --dsw-alias-bg-module-platform: var(--iexp-soft);
  --dsw-alias-settings-card-fill: var(--iexp-card);
  --dsw-alias-settings-card-stroke: var(--iexp-line);
  --dsw-alias-border-l1: var(--iexp-line);
  --dsw-alias-border-l2: var(--iexp-line);
  --dsw-alias-border-l3: var(--iexp-line);
  --dsw-alias-border-l4: var(--iexp-line);
  --dsw-alias-brand-primary: var(--iexp-accent);
  --dsw-alias-link: var(--iexp-accent);
  --dsw-focus-ring-color: var(--iexp-accent);
  --dsw-alias-button-primary-fill: var(--iexp-accent);
  --dsw-alias-button-primary-hover: var(--iexp-accent);
  --dsw-alias-label-primary-foreground: var(--iexp-button-text);
  --dsw-alias-label-primary-inverted: var(--iexp-button-text);
  --dsw-alias-state-success-primary: var(--iexp-success);
  --dsw-alias-state-success-tertiary: var(--iexp-soft);
  --dsw-alias-state-warn-primary: var(--iexp-warning);
  --dsw-alias-state-warn-label: var(--iexp-warning);
  --dsw-alias-state-warning-primary: var(--iexp-warning);
  --dsw-alias-state-warn-tertiary: var(--iexp-soft);
  --dsw-alias-state-error-primary: var(--iexp-error);
  --dsw-alias-state-error-secondary: var(--iexp-soft);
  --dsw-alias-state-business-primary: var(--iexp-accent);
  --dsw-alias-label-primary: var(--iexp-text);
  --dsw-alias-label-secondary: var(--iexp-muted);
  --dsw-alias-label-tertiary: var(--iexp-muted);
  --dsw-alias-label-caption: var(--iexp-muted);
  --dsw-alias-label-dimmed: var(--iexp-muted);
  --dsw-alias-interactive-bg-hover: var(--iexp-card-hover);
  --dsw-alias-interactive-bg-active: var(--iexp-card-hover);
  --dsw-font-family: var(--iexp-font);
  --dsw-radius-xs: min(4px,var(--iexp-control-radius));
  --dsw-radius-sm: max(0px,calc(var(--iexp-control-radius) - 4px));
  --dsw-radius-md: var(--iexp-control-radius);
  --dsw-radius-lg: var(--iexp-list-radius);
  --dsw-radius-xl: var(--iexp-card-radius);
  --dsw-radius-panel: var(--iexp-canvas-radius);
  --dsw-shadow-lv1: var(--iexp-shadow-card);
  --dsw-shadow-lv3: var(--iexp-shadow-focus);
  --dsw-elevation-soft: var(--iexp-shadow-card);
  --dsw-elevation-prominent: var(--iexp-shadow-focus);
  font-family: var(--iexp-font); font-variation-settings:'MONO' var(--iexp-font-mono,0),'CASL' 0; color-scheme: var(--iexp-color-scheme);
}
${outlet} > :is(div,section,main,article):not(.dsh-experience):not([data-slot]) {
  color: var(--iexp-text);
  background-color: var(--iexp-bg);
  border-radius: var(--iexp-panel-radius);
  font-family: var(--iexp-font);
}
${outlet} :is(.wsp-root,.wsp-view,[data-plugin="dsh-agent-persona"],[data-plugin="agent-persona"]) {
  --wsp-radius: var(--iexp-node-radius);
  --wsp-radius-sm: var(--iexp-field-radius);
  --wsp-card-shadow: var(--iexp-shadow-card);
  font-family: var(--iexp-font);
}
${outlet} [data-dsh-plugin="dsh-mnemon"][data-dsh-part="mnemon-view"] {
  /* Mnemon otherwise stacks three translucent surface layers into opacity. */
  --mn-surface: var(--iexp-bg);
  --mn-bg: var(--iexp-bg); --mn-layer-1: var(--iexp-card); --mn-layer-2: var(--iexp-soft);
  --mn-fill: var(--iexp-soft); --mn-input: var(--iexp-card); --mn-text: var(--iexp-text);
  --mn-muted: var(--iexp-muted); --mn-faint: var(--iexp-muted); --mn-caption: var(--iexp-muted);
  --mn-line: var(--iexp-line); --mn-line-strong: var(--iexp-line); --mn-card-line: var(--iexp-line);
  --mn-accent: var(--iexp-accent); --mn-hover: var(--iexp-card-hover); --mn-pressed: var(--iexp-card-hover);
  --mn-danger: var(--iexp-error); --mn-success: var(--iexp-success); --mn-warn: var(--iexp-warning);
  --mn-focus: var(--iexp-accent); --mn-sans: var(--iexp-font);
}
${outlet} .solar-workflow-studio {
  --solar-studio-primary-fill: var(--iexp-accent);
}
${outlet} .solar-workflow-studio button[data-variant="primary"],
${outlet} .solar-workflow-studio button[data-variant="primary"]:hover:not(:disabled) {
  background: var(--iexp-accent) !important;
  color: var(--iexp-button-text) !important;
}
${outlet} :is(.wsp-view,.lc-root,.solar-workflow-studio) { font-family: var(--iexp-font); }
${outlet} .lc-root {
  --color-blue-500: var(--iexp-series-1); --color-indigo-500: var(--iexp-series-1);
  --color-purple-500: var(--iexp-series-2); --color-violet-500: var(--iexp-series-2);
  --color-pink-500: var(--iexp-series-3); --color-teal-500: var(--iexp-series-4);
  --color-green-500: var(--iexp-success); --color-red-500: var(--iexp-error);
  --color-orange-500: var(--iexp-warning); --color-amber-500: var(--iexp-warning);
}
${outlet} :is(button,input,select,textarea) { border-radius: var(--iexp-control-radius); }
${outlet} :is(button,input,select,textarea,a,[tabindex]):focus-visible { outline: 2px solid var(--iexp-accent); outline-offset: 2px; }
${outlet} :is(.wsp-card-panel,.lc-card) { padding: calc(14px * var(--iexp-density)); }
${outlet} section[aria-label][style*="--dsw-alias-settings-card-fill"] {
  padding: calc(14px * var(--iexp-density)) !important;
  gap: calc(10px * var(--iexp-density)) !important;
  font-family: var(--iexp-font);
}
${cards} {
  border-radius: var(--iexp-page-card-radius) !important;
  box-shadow: var(--iexp-shadow-node);
  transition: background-color 180ms ease-out,border-color 180ms ease-out,box-shadow 180ms ease-out,transform 180ms ease-out;
}
@media (hover:hover) and (pointer:fine) {
${hoveredCards} {
  background-color: var(--iexp-card-hover) !important;
  border-color: var(--iexp-accent) !important;
  box-shadow: var(--iexp-shadow-focus);
}
}
@media (hover:hover) and (pointer:fine) and (prefers-reduced-motion:no-preference) {
${hoveredCards} { transform: translateY(var(--iexp-hover-lift)); }
}
@media (prefers-reduced-motion:reduce) {
${cards} { transition: none; transform: none; }
}
`
}
