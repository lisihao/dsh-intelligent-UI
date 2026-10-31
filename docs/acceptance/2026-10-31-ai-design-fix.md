# Settings and control design refinement

This existing-surface polish follows the user's request to apply ai-design-fix while keeping the selected Empryo direction. It changes only the independent UI plugin. Report/chart/flow data, foreign plugin implementations and the official application remain outside the edit scope.

## Observed defects and changes

- Underlying report text bled through settings. The form now uses an opaque backing in the user's selected background color; report transparency stays adjustable.
- Theme source actions and local files had equal visual weight and accidental wrapping. Current theme, saved source and local files now have distinct compact groups, with one emphasized catalog action.
- Buttons, inputs and selectors had several padding/radius/font systems. Settings now use shared 14px/36px controls, 10px corners, explicit focus/disabled states and 8/12/16px grouping. Export/repository actions are text links. The native file input has a Chinese label and keyboard focus treatment.
- Help text uses the existing solved contrast color. At background #777777 its computed black foreground has approximately 4.69:1 contrast.
- Case-insensitive board search names its locale explicitly; data and grouping remain unchanged.

## Run evidence

- Complete independent check: build, TypeScript, 201 tests and actual built-package scratch installation/owner RPC/restart/disposal passed without model calls.
- After the final contrast and accessible-preview refinement, the package was rebuilt and the actual built-package scratch check passed again. The affected theme/appearance client tests also passed.
- ai-design-check on the same baseline file set plus the new settings stylesheet: 0 errors / 2 warnings to 0 errors / 0 warnings. The baseline warnings concerned unspecified case-folding locale. The checker has limited coverage of React createElement markup; the visual findings above came from rendered inspection, not the count.
- Impeccable's new settings size/radius advisories were resolved by documenting the intentional settings scale in DESIGN.md; the targeted settings detector returned no findings. No suppressions, hooks or baselines were added.
- Desktop, 400px and 320px browser output was inspected. At 320px document width was 305px within the 320px viewport; settings were 265px wide. Controls remained 14px/36px and labels wrapped. Theme switching, color validation and restoration worked. Synthetic output remained explicitly labeled synthetic.
- Independent finish review: ship after the help-text contrast fix. This verdict covers browser presentation.

## Delivery boundary

The immutable development archive has SHA-256 `02c9a5e10aaa5013606b4476c610a5550383f73dbc012a25d2927f92d448c210`.

Official Desktop installation and runtime acceptance are pending the coordinated handoff from the other DSH chat, which is still using the shared application for its own acceptance. No installation or restart was attempted during that window. Source/preview verification is not a claim of formal Desktop acceptance. This is neither an npm nor a plugin-market release. Private captures, reports, account data, logs and backups remain outside Git.
