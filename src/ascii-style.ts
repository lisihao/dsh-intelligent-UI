/** Compiled visual grammar. Downloaded themes select it; they never execute CSS. */
export const asciiThemeCss = `
.dsh-experience {
 font-family:var(--iexp-font)!important;
 font-variation-settings:'CASL' 0,'MONO' 1,'slnt' 0,'CRSV' 0;
 font-variant-numeric:tabular-nums slashed-zero; font-variant-ligatures:none;
 font-kerning:none; letter-spacing:0;
}
/* Owned text roles include OpenUI labels and top-layer native popovers.
   Do not force the host shell, icon fonts, SVG paths or third-party frames. */
.dsh-experience :is(h1,h2,h3,h4,h5,h6,p,span,strong,em,b,i,small,label,summary,button,input,select,option,textarea,output,pre,code,kbd,samp,th,td,dt,dd,li,a,text,tspan) {
 font-family:var(--iexp-font)!important;
 font-variant-ligatures:none; font-kerning:none; letter-spacing:0;
}
.dsh-experience.iexp-content { font-weight:400; line-height:1.65; }
.dsh-experience.iexp-content .openui-markdown-renderer { font-family:var(--iexp-font); font-weight:400; line-height:1.65; }
.dsh-experience.iexp-content :is(pre,code,kbd,samp) { tab-size:4; }
.dsh-experience.iexp-content :is(strong,b) { font-weight:600; }
.dsh-experience.iexp-content .openui-markdown-renderer :is(p,li,blockquote) { text-wrap:pretty; }
.dsh-experience.iexp-content .openui-markdown-renderer :is(h1,h2,h3,h4,h5,h6) {
 font-weight:600; letter-spacing:0; line-height:1.5; text-wrap:balance;
}
.dsh-experience.iexp-content .openui-markdown-renderer h1 { font-size:22px; max-width:48ch; }
.dsh-experience.iexp-content .openui-markdown-renderer h2 { font-size:20px; border-top-style:dashed; }
.dsh-experience.iexp-content .openui-markdown-renderer h3 { font-size:18px; }
.dsh-experience.iexp-content .openui-markdown-renderer :is(h4,h5,h6) { font-size:16px; }
.dsh-experience.iexp-content .openui-markdown-renderer :is(p,ul,ol,blockquote) { max-width:74ch; }
.dsh-experience.iexp-content :is(.iexp-card-title,.iexp-card-basis,.iexp-flow-node,.iexp-task,.iexp-object-detail,table) { font-variation-settings:'MONO' 1,'CASL' 0; }
.dsh-experience.iexp-content :is(.iexp-chart-card,.iexp-source-table,.iexp-task,.iexp-object-detail,.iexp-heading-index,.iexp-flow-viewport) { box-shadow:none; }
.dsh-experience.iexp-content :is(.iexp-card-head,.iexp-disclosure,.iexp-full-table) { border-style:dashed; border-width:0; border-top-width:1px; border-color:var(--iexp-line); }
.dsh-experience.iexp-content .iexp-card-head { border-top:0; border-bottom:1px dashed var(--iexp-line); }
.dsh-experience.iexp-content .iexp-card-title { font-weight:600; }
.dsh-experience.iexp-content .iexp-card-title strong { font-weight:600; }
.dsh-experience.iexp-content :is(th,td) { border-bottom-style:dashed; }
.dsh-experience.iexp-content th { font-weight:600; }
.dsh-experience.iexp-content code { color:var(--iexp-accent); }
.dsh-experience.iexp-content pre code { color:inherit; }
.dsh-experience.iexp-content a { text-underline-offset:4px; text-decoration-thickness:1px; }
.dsh-experience :is(button,input,select,textarea) { caret-color:var(--iexp-accent); accent-color:var(--iexp-accent); }
.dsh-experience ::selection { color:var(--iexp-button-text); background:var(--iexp-accent); }
.dsh-experience.iexp-content :is(button,select,input,textarea):focus-visible { outline:2px solid var(--iexp-accent); outline-offset:3px; }
.dsh-experience.iexp-content * { scrollbar-color:var(--iexp-line) transparent; scrollbar-width:thin; }
@media(hover:hover) and (pointer:fine) {
 .dsh-experience.iexp-content :is(.iexp-chart-card,.iexp-task,.iexp-object-detail):hover { box-shadow:var(--iexp-shadow-card); }
}
@media(max-width:560px) {
 .dsh-experience.iexp-content .openui-markdown-renderer h1 { font-size:20px; }
 .dsh-experience.iexp-content .openui-markdown-renderer h2 { font-size:18px; }
 .dsh-experience.iexp-content .openui-markdown-renderer h3 { font-size:16px; }
}
`


/** Exclude the final matched element, so an outer ASCII ancestor cannot cross an output scope. */
export const globalAsciiThemeCss = asciiThemeCss.replace(/([^{}]+)\{/g,(whole,selector:string)=>{
 if(!selector.includes('.dsh-experience')||selector.trim().startsWith('@'))return whole
 const excluded=':not([data-iexp-composition-scope] *)'
 return selector.includes('::selection')?selector.replace('::selection',`*${excluded}::selection`)+'{':selector.trimEnd()+excluded+' {'
})
