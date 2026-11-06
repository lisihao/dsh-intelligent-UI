import { describe,it,expect } from 'vitest'
import { createSourceBlockComponentRegistry } from '../src/adaptive-ui/source-block-components.js'
import { DIL_INTRINSIC_TAGS } from '../src/dil/protocol.js'
const capabilities={webgl:false,reducedMotion:true}
describe('production source block component adapters',()=>{
  it('registers all native IDs while rejecting components whose actual input contracts are missing',()=>{
    const registry=createSourceBlockComponentRegistry()
    const context={source:{value:'# Plan\n\nKeep `$x$` and **conditions**.',recipes:[]},capabilities}
    const audit=registry.audit(context)
    for(const tag of DIL_INTRINSIC_TAGS)expect(audit.entries.some(x=>x.id===`dil:${tag}`)).toBe(true)
    expect(audit.eligibleIds).toEqual(expect.arrayContaining(['dil:markdown','dil:card','dil:column','dil:grid']))
    expect(audit.excluded.find(x=>x.id==='dil:button')?.reasons).toBeDefined()
    const selected=registry.dispatch('dil:grid',context)
    expect(selected.id).toBe('dil:grid')
    expect(JSON.stringify(selected.input)).toContain('Keep `$x$` and **conditions**.')
  })
  it('keeps code as a semantic candidate without fixing it to a single renderer in advance',()=>{
    const registry=createSourceBlockComponentRegistry()
    const context={source:{value:'```rust\nlet count = 2;\n```',recipes:[]},capabilities}
    expect(registry.audit(context).eligibleIds).toEqual(expect.arrayContaining(['dil:code','dil:markdown','dil:column','dil:card']))
    expect(registry.dispatch('dil:code',context).input).toMatchObject({source:{kind:'code',value:'let count = 2;',language:'rust'}})
  })
  it('requires actual typed chart data instead of inventing a chart from arbitrary prose',()=>{
    const registry=createSourceBlockComponentRegistry()
    const source={type:'ui-component-content',content:{kind:'chart',data:[{year:'2025',value:12},{year:'2026',value:18}],categoryKey:'year',dataKey:'value'}}
    const selected=registry.dispatch('dil:chart',{source:{value:source},capabilities})
    expect(selected.input).toMatchObject({source:{data:source.content.data}})
    expect(registry.audit({source:{value:'The service became faster.'},capabilities}).eligibleIds).not.toContain('dil:chart')
  })
  it('offers semantic tables and charts from validated numeric source without requiring a model-authored typed wrapper',()=>{
    const registry=createSourceBlockComponentRegistry()
    const value='| Year | Revenue (USD) |\n| --- | ---: |\n| 2024 | 10 |\n| 2025 | 15 |'
    const context={source:{value,recipes:[]},capabilities}
    expect(registry.audit(context).eligibleIds).toEqual(expect.arrayContaining(['dil:table','dil:chart']))
    expect(registry.dispatch('dil:chart',context).input).toMatchObject({source:{kind:'chart',data:[{__source_label:'2024','Revenue (USD)':10},{__source_label:'2025','Revenue (USD)':15}]}})
    const table=registry.dispatch('dil:table',context)
    expect(JSON.stringify(table.input)).toContain('markdown')
    expect(JSON.stringify(table.input)).toContain('header')
  })
  it('retains inline Markdown in source lists and excludes numbering or task states the native route cannot preserve',()=>{
    const registry=createSourceBlockComponentRegistry()
    const context={source:{value:'- Keep **conditions** and `$x$`.\n- Preserve `code`.',recipes:[]},capabilities}
    const selected=registry.dispatch('dil:list',context)
    expect(JSON.stringify(selected.input)).toContain('Keep **conditions** and `$x$`.')
    for(const value of ['3. Third step\n4. Fourth step','- [x] Verified\n- [ ] Waiting'])expect(registry.audit({source:{value,recipes:[]},capabilities}).eligibleIds).not.toContain('dil:list')
  })

})
