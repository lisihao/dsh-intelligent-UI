/** Scoped plot styles. The caller supplies the figure, title and source disclosures. */
export const comparisonCss = `
.iexp-comparison { display: grid; gap: calc(12px * var(--iexp-density)); min-width: 0; padding-block: 4px 8px; color: var(--iexp-text); font-variant-numeric: tabular-nums; }
.iexp-comparison-row { min-width: 0; }
.iexp-comparison-label { display: block; margin-block-end: 5px; color: var(--iexp-text); font-size: 13px; line-height: 1.55; overflow-wrap: anywhere; }
.iexp-comparison-measure { position: relative; width: calc(100% - 11ch); min-height: 24px; }
.iexp-comparison-meter { position: absolute; top: 0; width: 100%; height: 17px; padding-block: 3px; box-sizing: border-box; }
.iexp-comparison-meter::before { content: ''; position: absolute; inset-inline: 0; top: 8px; height: 1px; background: var(--iexp-line); }
.iexp-comparison-stroke { position: relative; display: block; height: 11px; background: var(--iexp-accent); border-radius: 4% 3% 5% 2% / 42% 56% 38% 58%; }
.iexp-comparison-value { position: relative; display: block; top: -3px; margin-inline-start: 9px; width: 10ch; font-size: 13px; line-height: 1.55; color: var(--iexp-text); overflow-wrap: anywhere; }
@media (forced-colors: active) { .iexp-comparison-stroke { background: CanvasText; forced-color-adjust: none; } .iexp-comparison-meter::before { background: GrayText; forced-color-adjust: none; } }
`
