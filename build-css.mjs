import { readFile } from 'node:fs/promises'
import postcss from 'postcss'
import prefixer from 'postcss-prefix-selector'

// OpenUI's component classes are already vendor-namespaced. Scope only its
// default token roots and the four generic text-content utility selectors;
// retain vendor portal styles so upstream dialogs/dropdowns remain usable.
export const openuiCssPlugin = {
  name: 'openui-owned-styles',
  setup(build) {
    build.onLoad({ filter: /@xyflow[\\/]react[\\/].*\.css$/ }, async ({ path }) => {
      const result = await postcss([prefixer({ prefix: '.dsh-experience .iexp-flow' })]).process(await readFile(path, 'utf8'), { from: path, map: false })
      return { contents: result.css, loader: 'text' }
    })
    build.onLoad({ filter: /@openuidev[\\/]react-ui[\\/].*\.css$/ }, async ({ path }) => {
      const result = await postcss([{
        postcssPlugin: 'openui-explicit-host-theme', Once(root) {
          // ThemeProvider follows the host's explicit scheme. The upstream OS
          // fallback has higher specificity and otherwise turns light content
          // white on white when macOS itself happens to use dark mode.
          root.walkAtRules('media', rule => {
            if (/prefers-color-scheme/.test(rule.params)) rule.walkRules(child => { if (child.selector.includes(':root')) child.remove() })
          })
        },
      }, prefixer({ prefix: '.dsh-experience', transform(prefix, selector, prefixed) {
        if (selector.includes(':root')) return selector.replaceAll(':root', prefix)
        if (/^\.text-content(?:-|$)/.test(selector)) return prefixed
        return selector
      } })]).process(await readFile(path, 'utf8'), { from: path, map: false })
      return { contents: result.css, loader: 'text' }
    })
  },
}
