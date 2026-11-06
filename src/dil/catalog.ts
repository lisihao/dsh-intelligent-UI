/**
 * Native DIL vocabulary exposed to compiler guidance. This is deliberately a
 * finite adapter catalog: a program may describe only tags and props that the
 * local view can render without arbitrary DOM, CSS, or resource loading.
 */
export const DIL_PROTOCOL_VERSION = 1 as const

export type DilCatalogEntry = Readonly<{
  tag: string
  props: readonly string[]
  handlers?: readonly string[]
  note?: string
}>

const entry = (tag: string, props: readonly string[], handlers?: readonly string[], note?: string): DilCatalogEntry => ({
  tag,
  props,
  ...(handlers?.length ? { handlers } : {}),
  ...(note ? { note } : {}),
})

export const DIL_COMPONENT_CATALOG: readonly DilCatalogEntry[] = [
  entry('box', ['gap', 'padding', 'align', 'justify', 'wrap', 'hidden']),
  entry('row', ['gap', 'padding', 'align', 'justify', 'wrap', 'hidden']),
  entry('column', ['gap', 'padding', 'align', 'justify', 'wrap', 'hidden']),
  entry('grid', ['columns', 'gap', 'hidden']),
  entry('grid-item', ['span', 'hidden']),
  entry('card', ['gap', 'padding', 'title', 'hidden']),
  entry('divider', ['hidden']),
  entry('spacer', ['size', 'hidden'], undefined, 'size is a bounded number.'),
  entry('text', ['size', 'tone', 'weight', 'align', 'tabularNums', 'hidden'], undefined, 'size is xs, sm, md, or lg.'),
  entry('title', ['size', 'tone', 'level', 'hidden'], undefined, 'size is sm, md, lg, or xl.'),
  entry('caption', ['tone', 'hidden']),
  entry('bold', ['hidden']),
  entry('label', ['hidden']),
  entry('code', ['language', 'hidden'], undefined, 'Renders through the host MarkdownCodeBlock adapter.'),
  entry('icon', ['name', 'label', 'size', 'tone', 'hidden'], undefined, 'size is a bounded number.'),
  entry('badge', ['tone', 'hidden']),
  entry('button', ['label', 'disabled', 'variant', 'type', 'hidden'], ['onClick']),
  entry('input', ['name', 'value', 'type', 'placeholder', 'disabled', 'required', 'hidden'], ['onChange', 'onInput', 'onBlur']),
  entry('textarea', ['name', 'value', 'placeholder', 'rows', 'disabled', 'required', 'hidden'], ['onChange', 'onInput', 'onBlur']),
  entry('checkbox', ['name', 'checked', 'disabled', 'hidden'], ['onChange']),
  entry('switch', ['name', 'checked', 'disabled', 'hidden'], ['onChange']),
  entry('radio', ['name', 'value', 'checked', 'disabled', 'hidden'], ['onChange']),
  entry('radio-group', ['name', 'value', 'options', 'disabled', 'hidden'], ['onChange']),
  entry('select', ['name', 'value', 'options', 'disabled', 'required', 'hidden'], ['onChange']),
  entry('slider', ['name', 'value', 'min', 'max', 'step', 'disabled', 'hidden'], ['onChange', 'onInput']),
  entry('segmented-control', ['name', 'value', 'options', 'disabled', 'hidden'], ['onChange']),
  entry('table', ['label', 'hidden']),
  entry('table-row', ['hidden'], ['onClick']),
  entry('table-cell', ['header', 'align', 'hidden']),
  entry('list', ['ordered', 'hidden']),
  entry('list-item', ['hidden']),
  entry('progress', ['value', 'max', 'label', 'showValue', 'hidden']),
  entry('chart', ['data', 'categoryKey', 'dataKey', 'series', 'height', 'title', 'hidden'], undefined, 'Declare exactly one of dataKey (one bar) or series. series entries are {dataKey,type:"line"|"bar"}, all with one shared type; only declared fields are rendered.'),
  entry('pie-chart', ['data', 'categoryKey', 'dataKey', 'height', 'title', 'hidden'], undefined, 'dataKey is required; only that finite numeric field is rendered.'),
  entry('image', ['src', 'alt', 'width', 'height', 'hidden'], undefined, 'Only bounded base64 png/jpeg/gif/webp/avif data URLs are accepted.'),
  entry('link', ['href', 'label', 'hidden'], undefined, 'Only https/http links are accepted.'),
  entry('form', ['action', 'hidden'], undefined, 'action is required. Submission is host-owned after an explicit DOM submit; submit-time handlers and async calculations are unsupported.'),
  entry('tabs', ['hidden']),
  entry('tab', ['value', 'selected', 'disabled', 'hidden'], ['onClick', 'onChange']),
  entry('tab-panel', ['active', 'hidden']),
]

export const supportedDILTags = new Set(DIL_COMPONENT_CATALOG.map(item => item.tag))
export const DIL_EVENT_PROPS = new Set(['onClick', 'onChange', 'onInput', 'onBlur'] as const)
export const DIL_ALLOWED_PROPS = new Map(DIL_COMPONENT_CATALOG.map(item => [item.tag, new Set([...item.props, ...(item.handlers ?? [])])]))
export const DIL_ALLOWED_HANDLERS = new Map(DIL_COMPONENT_CATALOG.map(item => [item.tag, new Set(item.handlers ?? [])]))
export const DIL_HANDLER_REFERENCE = '{"__dilFn":"handler-id"}'

/** A compact interactive example that compiles without an undeclared submit handler. */
export const DIL_AUTHORING_EXAMPLE = `{@body const [seats,setSeats] = DIL.useState(3,{key:"seats"})}
{@body const monthly = seats * 200}
<form action="submit-quote">
  <card gap={3}>
    <title size="md">报价条件</title>
    <label>席位数<slider name="seats" min={1} max={50} value={seats} onChange={setSeats}/></label>
    <text>当前月度费用：¥{monthly.toLocaleString()}</text>
    <button type="submit">提交当前条件</button>
  </card>
</form>`

export const dilAuthoringGuide = JSON.stringify({
  protocolVersion: DIL_PROTOCOL_VERSION,
  handlerReference: DIL_HANDLER_REFERENCE,
  components: DIL_COMPONENT_CATALOG,
  example: DIL_AUTHORING_EXAMPLE,
  boundaries: [
    'Use only listed lowercase tags and listed props.',
    'Event props compile to handler references; never send JavaScript or HTML as a prop.',
    'form requires action and never accepts onSubmit. Submission occurs only after an explicit DOM submit; finish local calculations through preceding control updates, never at submit time.',
    'Unknown tags, props, unsafe URLs, and invalid chart data render a visible fallback.',
  ],
})
