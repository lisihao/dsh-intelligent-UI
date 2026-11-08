export const modelCenterViewCss = `
.iexp-model-center {
  --iexp-model-center-control-height: 32px;
  --iexp-model-center-gap: 16px;
  color: var(--iexp-text);
  background: var(--iexp-bg);
  font-family: var(--iexp-font);
  font-size: 14px;
  line-height: 1.6;
  min-width: 0;
  overflow-x: clip;
}
.iexp-model-center,
.iexp-model-center * { box-sizing: border-box; }
.iexp-model-center h2,
.iexp-model-center h3,
.iexp-model-center p,
.iexp-model-center dl,
.iexp-model-center dd { margin: 0; }
.iexp-model-center button,
.iexp-model-center input { font: inherit; }
.iexp-model-center button { color: inherit; cursor: pointer; }
.iexp-model-center button:disabled { cursor: default; opacity: .62; }
.iexp-model-center :is(button, input):focus-visible {
  outline: 2px solid var(--iexp-accent);
  outline-offset: 3px;
}
.iexp-model-center .iec-shell {
  display: grid;
  gap: 18px;
  max-width: 1180px;
  margin-inline: auto;
  padding: 20px;
  background: var(--iexp-card);
  border: 1px solid var(--iexp-line);
  border-radius: 18px;
  box-shadow: var(--iexp-shadow-card);
}
.iexp-model-center .iec-titlebar,
.iexp-model-center .iec-panel-heading,
.iexp-model-center .iec-section-heading,
.iexp-model-center .iec-definition-heading,
.iexp-model-center .iec-usage-heading,
.iexp-model-center .iec-form-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.iexp-model-center .iec-titlebar { align-items: flex-start; }
.iexp-model-center .iec-titlebar h2 {
  color: var(--iexp-text);
  font-size: 20px;
  font-weight: 600;
  line-height: 1.35;
  overflow-wrap: break-word;
}
.iexp-model-center .iec-titlebar p,
.iexp-model-center .iec-panel-heading p,
.iexp-model-center .iec-section-heading p,
.iexp-model-center .iec-detail-copy,
.iexp-model-center .iec-subline,
.iexp-model-center .iec-definition-grid dt,
.iexp-model-center .iec-quota-meta,
.iexp-model-center .iec-budget-note,
.iexp-model-center .iec-value-note {
  color: var(--iexp-muted);
  font-size: 12px;
}
.iexp-model-center .iec-titlebar p { margin-top: 3px; font-size: 13px; }
.iexp-model-center .iec-subline { display: block; margin-top: 3px; color: var(--iexp-muted); font-size: 12px; line-height: 1.5; }
.iexp-model-center .iec-refresh,
.iexp-model-center .iec-secondary,
.iexp-model-center .iec-primary,
.iexp-model-center .iec-link-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: var(--iexp-model-center-control-height);
  padding: 4px 10px;
  border: 1px solid var(--iexp-line);
  border-radius: var(--iexp-control-radius);
  background: transparent;
  color: var(--iexp-text);
  font-size: 13px;
  line-height: 1.25;
  white-space: nowrap;
}
.iexp-model-center .iec-primary {
  border-color: var(--iexp-accent);
  background: var(--iexp-accent);
  color: var(--iexp-bg);
  font-weight: 600;
}
.iexp-model-center .iec-link-button {
  min-height: 28px;
  padding-inline: 4px;
  border-color: transparent;
  color: var(--iexp-accent);
}
.iexp-model-center .iec-tabs {
  display: flex;
  gap: 18px;
  min-width: 0;
  overflow-x: auto;
  border-bottom: 1px solid var(--iexp-line);
}
.iexp-model-center .iec-tab {
  position: relative;
  flex: 0 0 auto;
  min-height: 40px;
  padding: 0 2px 10px;
  border: 0;
  background: transparent;
  color: var(--iexp-muted);
  font-size: 14px;
}
.iexp-model-center .iec-tab[aria-selected='true'] { color: var(--iexp-text); font-weight: 600; }
.iexp-model-center .iec-tab[aria-selected='true']::after {
  position: absolute;
  right: 0;
  bottom: -1px;
  left: 0;
  height: 2px;
  background: var(--iexp-accent);
  content: '';
}
.iexp-model-center .iec-panel { min-width: 0; }
.iexp-model-center .iec-panel-heading { margin-bottom: 14px; align-items: flex-start; }
.iexp-model-center .iec-panel-heading h3,
.iexp-model-center .iec-section-heading h3,
.iexp-model-center .iec-definition-heading h3 {
  color: var(--iexp-text);
  font-size: 15px;
  font-weight: 600;
  line-height: 1.5;
}
.iexp-model-center .iec-notices { display: grid; gap: 8px; margin-bottom: 14px; }
.iexp-model-center .iec-notice {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 9px 11px;
  border: 1px solid var(--iexp-line);
  border-radius: var(--iexp-control-radius);
  background: var(--iexp-soft);
  color: var(--iexp-text);
  font-size: 13px;
}
.iexp-model-center .iec-notice[role='alert'] { border-color: var(--iexp-accent); }
.iexp-model-center .iec-notice p { min-width: 0; }
.iexp-model-center .iec-empty {
  display: grid;
  gap: 10px;
  min-height: 94px;
  padding: 16px;
  border: 1px dashed var(--iexp-line);
  border-radius: 12px;
  background: var(--iexp-soft);
  color: var(--iexp-muted);
  align-content: center;
}
.iexp-model-center .iec-empty p { color: inherit; }
.iexp-model-center .iec-account-layout {
  display: grid;
  grid-template-columns: minmax(220px, .82fr) minmax(0, 1.8fr);
  gap: 20px;
}
.iexp-model-center .iec-account-list {
  display: grid;
  gap: 5px;
  align-content: start;
  max-height: 420px;
  overflow-y: auto;
  padding-right: 16px;
  border-right: 1px solid var(--iexp-line);
}
.iexp-model-center .iec-account-row {
  width: 100%;
  min-height: 86px;
  padding: 11px 12px;
  border: 1px solid transparent;
  border-radius: 10px;
  background: transparent;
  color: var(--iexp-text);
  text-align: start;
}
.iexp-model-center .iec-account-row[aria-pressed='true'] {
  border-color: var(--iexp-line);
  background: var(--iexp-soft);
}
.iexp-model-center .iec-account-row-title,
.iexp-model-center .iec-row-source,
.iexp-model-center .iec-model-title,
.iexp-model-center .iec-model-source,
.iexp-model-center .iec-quota-title,
.iexp-model-center .iec-money-title,
.iexp-model-center .iec-budget-value { min-width: 0; }
.iexp-model-center .iec-account-row-title,
.iexp-model-center .iec-model-title,
.iexp-model-center .iec-quota-title,
.iexp-model-center .iec-money-title {
  color: var(--iexp-text);
  font-weight: 600;
  overflow-wrap: anywhere;
}
.iexp-model-center .iec-source-tag {
  display: inline-flex;
  align-items: center;
  min-height: 20px;
  padding: 1px 6px;
  border: 1px solid var(--iexp-line);
  border-radius: var(--iexp-control-radius);
  color: var(--iexp-muted);
  font-size: 11px;
  font-weight: 500;
  line-height: 1.35;
  white-space: nowrap;
}
.iexp-model-center .iec-account-row .iec-source-tag { margin-top: 7px; }
.iexp-model-center .iec-account-status { display: block; margin-top: 6px; color: var(--iexp-muted); font-size: 12px; }
.iexp-model-center .iec-account-detail { min-width: 0; padding: 4px 0 4px 2px; }
.iexp-model-center .iec-detail-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.iexp-model-center .iec-detail-copy { margin-top: 3px; }
.iexp-model-center .iec-account-fields { display: grid; margin-top: 16px; }
.iexp-model-center .iec-account-fields > div {
  display: grid;
  grid-template-columns: minmax(96px, .42fr) minmax(0, 1fr);
  gap: 12px;
  padding: 11px 0;
  border-bottom: 1px solid var(--iexp-line);
}
.iexp-model-center .iec-account-fields dt { color: var(--iexp-muted); font-size: 12px; }
.iexp-model-center .iec-account-fields dd { color: var(--iexp-text); overflow-wrap: anywhere; }
.iexp-model-center .iec-model-search { width: min(340px, 100%); margin: 0 0 12px; }
.iexp-model-center .iec-model-search input,
.iexp-model-center .iec-form-field input {
  width: 100%;
  min-height: var(--iexp-model-center-control-height);
  padding: 4px 9px;
  border: 1px solid var(--iexp-line);
  border-radius: var(--iexp-control-radius);
  background: var(--iexp-solid-bg);
  color: var(--iexp-text);
}
.iexp-model-center .iec-model-search input::placeholder,
.iexp-model-center .iec-form-field input::placeholder { color: var(--iexp-muted); opacity: 1; }
.iexp-model-center .iec-table-wrap { max-width: 100%; max-height: 320px; overflow: auto; }
.iexp-model-center .iec-table { width: 100%; min-width: 660px; border-collapse: collapse; color: var(--iexp-text); font-size: 13px; }
.iexp-model-center .iec-table :is(th, td) { padding: 10px 12px; border-bottom: 1px solid var(--iexp-line); text-align: start; vertical-align: top; }
.iexp-model-center .iec-table :is(th, td):first-child { padding-left: 0; }
.iexp-model-center .iec-table :is(th, td):last-child { padding-right: 0; }
.iexp-model-center .iec-table th { position: sticky; top: 0; z-index: 1; background: var(--iexp-card); color: var(--iexp-muted); font-size: 12px; font-weight: 500; white-space: nowrap; }
.iexp-model-center .iec-model-select {
  display: grid;
  width: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  text-align: start;
}
.iexp-model-center .iec-model-select[aria-pressed='true'] .iec-model-title { color: var(--iexp-accent); }
.iexp-model-center .iec-abilities { color: var(--iexp-muted); font-size: 12px; overflow-wrap: anywhere; }
.iexp-model-center .iec-definition {
  margin-top: 18px;
  padding-top: 16px;
  border-top: 1px solid var(--iexp-line);
}
.iexp-model-center .iec-definition-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin-top: 14px;
}
.iexp-model-center .iec-definition-grid dd { margin-top: 4px; color: var(--iexp-text); font-size: 13px; overflow-wrap: anywhere; }
.iexp-model-center .iec-definition-form { display: grid; gap: 14px; margin-top: 16px; }
.iexp-model-center .iec-form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.iexp-model-center .iec-form-field { display: grid; gap: 6px; color: var(--iexp-text); font-size: 13px; font-weight: 500; }
.iexp-model-center .iec-form-help { color: var(--iexp-muted); font-size: 12px; font-weight: 400; }
.iexp-model-center .iec-form-error { margin: 0; color: var(--iexp-text); font-size: 13px; }
.iexp-model-center .iec-save-status { color: var(--iexp-muted); font-size: 12px; }
.iexp-model-center .iec-usage-stack { display: grid; gap: 22px; }
.iexp-model-center .iec-usage-section { min-width: 0; }
.iexp-model-center .iec-usage-heading { margin-bottom: 9px; }
.iexp-model-center .iec-usage-heading h3 { color: var(--iexp-text); font-size: 15px; font-weight: 600; }
.iexp-model-center .iec-money-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr)); gap: 10px; }
.iexp-model-center .iec-money-item,
.iexp-model-center .iec-budget-card {
  display: grid;
  gap: 6px;
  padding: 13px;
  border: 1px solid var(--iexp-line);
  border-radius: 12px;
  background: var(--iexp-soft);
  min-width: 0;
}
.iexp-model-center .iec-money-value,
.iexp-model-center .iec-budget-value { color: var(--iexp-text); font-size: 20px; font-weight: 600; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.iexp-model-center .iec-quota-list { display: grid; }
.iexp-model-center .iec-quota-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(160px, .7fr) minmax(0, .6fr);
  gap: 16px;
  align-items: center;
  padding: 12px 0;
  border-bottom: 1px solid var(--iexp-line);
}
.iexp-model-center .iec-meter { height: 5px; overflow: clip; border-radius: 4px; background: var(--iexp-card-hover); }
.iexp-model-center .iec-meter > span { display: block; width: var(--iec-progress, 0%); height: 100%; border-radius: inherit; background: var(--iexp-accent); }
.iexp-model-center .iec-quota-value { color: var(--iexp-text); font-size: 13px; font-variant-numeric: tabular-nums; }
.iexp-model-center .iec-budget-card { grid-template-columns: minmax(0, 1fr) auto; align-items: center; }
.iexp-model-center .iec-budget-card .iec-definition-form { grid-column: 1 / -1; }
.iexp-model-center .iec-num { font-variant-numeric: tabular-nums; }
@media (pointer: fine) {
  .iexp-model-center .iec-account-row,
  .iexp-model-center .iec-money-item,
  .iexp-model-center .iec-budget-card { transition: background-color 160ms ease-out, border-color 160ms ease-out, transform 160ms ease-out, box-shadow 160ms ease-out; }
  .iexp-model-center .iec-account-row:hover,
  .iexp-model-center .iec-money-item:hover,
  .iexp-model-center .iec-budget-card:hover { background: var(--iexp-card-hover); border-color: var(--iexp-accent); transform: translateY(-1px); box-shadow: var(--iexp-shadow-focus); }
  .iexp-model-center :is(.iec-refresh, .iec-secondary, .iec-link-button):not(:disabled):hover { background: var(--iexp-card-hover); }
}
@media (max-width: 760px) {
  .iexp-model-center .iec-shell { padding: 16px; border-radius: 14px; }
  .iexp-model-center .iec-account-layout { grid-template-columns: 1fr; gap: 14px; }
  .iexp-model-center .iec-account-list { grid-template-columns: repeat(2, minmax(0, 1fr)); padding: 0 0 14px; border-right: 0; border-bottom: 1px solid var(--iexp-line); }
  .iexp-model-center .iec-definition-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .iexp-model-center .iec-quota-row { grid-template-columns: 1fr 1fr; }
  .iexp-model-center .iec-quota-meta { grid-column: 1 / -1; }
}
@media (max-width: 480px) {
  .iexp-model-center .iec-shell { gap: 14px; padding: 14px; }
  .iexp-model-center .iec-titlebar,
  .iexp-model-center .iec-panel-heading,
  .iexp-model-center .iec-definition-heading,
  .iexp-model-center .iec-form-actions { align-items: flex-start; flex-direction: column; }
  .iexp-model-center .iec-tabs { gap: 13px; }
  .iexp-model-center .iec-tab { font-size: 13px; }
  .iexp-model-center .iec-account-list { grid-template-columns: 1fr; }
  .iexp-model-center .iec-definition-grid,
  .iexp-model-center .iec-form-grid { grid-template-columns: 1fr; }
  .iexp-model-center .iec-budget-card { grid-template-columns: 1fr; }
}
@media (prefers-reduced-motion: reduce) {
  .iexp-model-center * { scroll-behavior: auto; transition-duration: .01ms; }
}
`
