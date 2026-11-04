/** Theme-owned execution grammar; actual status, quantities and events remain native text. */
export const executionFlowCss = `
.dsh-experience .iexp-flow[data-execution] .iexp-flow-viewport{position:relative;min-height:420px}
.dsh-experience .iexp-flow[data-execution] .iexp-flow-node{border-color:var(--iexp-flow-role,var(--iexp-accent));border-radius:4px;background:var(--iexp-solid-bg);font-family:var(--iexp-code-font);font-size:14px;line-height:1.5}
.dsh-experience .iexp-flow [data-execution-role=lead]{--iexp-flow-role:var(--iexp-series-3)}
.dsh-experience .iexp-flow [data-execution-role=advisor]{--iexp-flow-role:var(--iexp-series-4)}
.dsh-experience .iexp-flow [data-execution-role=worker]{--iexp-flow-role:var(--iexp-series-2)}
.dsh-experience .iexp-flow [data-execution-role=tool]{--iexp-flow-role:var(--iexp-series-1)}
.dsh-experience .iexp-flow[data-execution] .iexp-flow-node>strong{color:var(--iexp-flow-role,var(--iexp-accent));font-weight:550}
.dsh-experience .iexp-execution-node-data{display:grid;gap:8px;margin-top:8px;font-size:12px;font-variant-numeric:tabular-nums}
.dsh-experience .iexp-execution-node-meta{display:flex;gap:8px;justify-content:space-between;color:var(--iexp-muted);min-width:0}
.dsh-experience .iexp-execution-node-meta>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.dsh-experience .iexp-execution-node-status{color:var(--iexp-muted)}
.dsh-experience [data-execution-status=running] .iexp-execution-node-status{color:var(--iexp-flow-role,var(--iexp-accent))}
.dsh-experience [data-execution-status=succeeded] .iexp-execution-node-status{color:var(--iexp-success)}
.dsh-experience [data-execution-status=failed] .iexp-execution-node-status{color:var(--iexp-error)}
.dsh-experience [data-execution-status=blocked] .iexp-execution-node-status{color:var(--iexp-warning)}
.dsh-experience .iexp-execution-progress-label{min-width:0;white-space:nowrap;display:flex;align-items:baseline;justify-content:space-between;gap:8px}
.dsh-experience .iexp-execution-progress-label>span{overflow:hidden;text-overflow:ellipsis;min-width:0}
.dsh-experience .iexp-execution-progress-label strong{flex-shrink:0;font-size:12px;color:var(--iexp-flow-role,var(--iexp-accent))}
.dsh-experience .iexp-execution-progress-track{height:8px;margin-top:4px;background:var(--iexp-line);overflow:hidden;border-radius:1px}
.dsh-experience .iexp-execution-progress-track>span{display:block;inline-size:100%;block-size:100%;background:var(--iexp-flow-role,var(--iexp-accent));transform-origin:left center;transition:transform 200ms ease-out}
.dsh-experience .iexp-flow[data-motion=still] .iexp-execution-progress-track>span{transition:none}
.dsh-experience .iexp-execution-progress-unknown{color:var(--iexp-muted)}
.dsh-experience .iexp-execution-metrics{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:4px 8px;margin:0}
.dsh-experience .iexp-execution-metrics dt,.dsh-experience .iexp-execution-metrics dd{overflow:hidden;white-space:nowrap;text-overflow:ellipsis;margin:0;font-size:12px}
.dsh-experience .iexp-execution-metrics dt{color:var(--iexp-muted)}
.dsh-experience .iexp-execution-metrics dd{text-align:right}
.dsh-experience .iexp-flow-execution-edge-idle path{stroke-opacity:.75}
.dsh-experience .iexp-flow-execution-edge-done path{stroke:var(--iexp-success)}
.dsh-experience .iexp-flow-execution-edge-error path{stroke:var(--iexp-error)}
.dsh-experience .iexp-execution-compact-status{display:block;color:var(--iexp-muted);font-size:11px;line-height:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
@media(prefers-reduced-motion:reduce){.dsh-experience .iexp-execution-progress-track>span{transition:none}}
`
