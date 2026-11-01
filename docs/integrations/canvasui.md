# Canvas UI effects integration — phase 1

## Baselines
- Solar Intelligent UI repository: lisihao/dsh-intelligent-UI, main at fc53e505e391d7be06464bcba8c8e3b9a24af0d3.
- Upstream Canvas UI: DavidHDev/canvas-ui, main at a04a99b235299ee79a123a16ccb2e6cf9da74b6b.
- Scope: generated Markdown content rendered through the official DSH plugin outlets. No modification of DSH itself or third-party plugin data.

## Contract and actual capability
- `visualEffectSchema` is a closed, namespaced data contract: `iexp.headline-reveal` or `canvasui.decrypt-reveal`. The source artifact stores the optional `effectId`.
- `solar_present` accepts an optional effect request for protocol `content`. Its presentation metadata retains the requested ID.
- The client registry supports explicit registration and rejects duplicate IDs. Its disposer removes the exact registered entry. Providers may register a direct component or a lazy loader. Lazy GPU loaders start only when the title is visible and the visual effect is eligible; failed loaders retain source content.
- `VisualEffectSlot` is constrained to the first Markdown H1, with at most 120 characters, only for explicitly requested generated artifacts, only outside streaming and only in visual mode.
- Missing providers, reduced-motion settings, hidden tabs and off-screen headings retain native source rendering. React errors fall back to the same source element.
- Built-in `iexp.headline-reveal` supplies a simple, one-shot CSS animation; it uses no upstream component assets.
- `canvasui.decrypt-reveal` is a reserved optional provider integration point; the Canvas UI component and WebGL engine are not copied, bundled, downloaded or registered by this phase.

## Upstream integration path
The original Canvas UI React wrapper is at `src/lib/DecryptReveal/DecryptReveal.tsx`, with the WebGL engine at `src/lib/DecryptReveal/DecryptRevealVanilla.ts`. The wrapper calls the instance's `destroy()` when React unmounts. The full HTML texture effect depends on experimental HTML-in-Canvas; Canvas UI implements a WebGL overlay fallback in environments without it. The DSH embedded Chromium version and real capability must be measured before installing any GPU provider.

Once distribution permission and packaging are confirmed, an authorized build may register a component through:

```ts
visualEffects.register({
  id: 'canvasui.decrypt-reveal',
  version: '<pinned-upstream-version>',
  load: async () => AuthorizedDecryptReveal, // Load only after the requested heading becomes visible.
  gpu: true,
})
```

The component and the imports above intentionally remain unresolved placeholders; the initial public source tree contains no upstream executable content. Register inside plugin lifecycle and retain the disposer. Provider code must not alter global listeners, renderer settings or other plugin resources. Unmounting the slot must dispose renderer resources through the provider.

## License / publication
Canvas UI carries **MIT + Commons Clause**: https://github.com/DavidHDev/canvas-ui/blob/a04a99b235299ee79a123a16ccb2e6cf9da74b6b/LICENSE.md

The grant permits use within applications and products, while restricting redistribution of the components themselves, including bundled/ported versions. Whether distributing source or a compiled plugin is permitted under the specific planned model needs explicit review or upstream written permission. Do not publish redistributed upstream components on the basis of this phase.

## Acceptance status
This PR adds a source-preserving registration, explicit effect metadata and an independently authored fallback. The development/CI test plan covers registration conflict/disposal, source preservation, reduced motion, streaming and raw/compare modes. Full DSH Desktop/Electron GPU visual acceptance, upstream provider packaging, WebGL context-loss and long-running memory benchmarks remain pending. Report only checks actually run.
