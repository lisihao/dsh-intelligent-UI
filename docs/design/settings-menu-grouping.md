# Settings menu grouping seam

## Status and scope

**Blocked — design record only.** The requested automatic settings-menu grouping feature is **not implemented, not installed, and not runtime-tested**. The intelligent UI plugin itself already exists; this status applies only to grouping. This document records the missing official seam needed to regroup the real DSH Settings dialog after installation. It does not provide a standalone settings index or claim an application change.

The requested result is a live Settings navigation projection with groups such as Model, Account, Appearance & display, Solar, and Plugins. It must keep every existing section and every future section, including sections whose ids are unknown when this plugin is built. The official Desktop application remains unmodified.

The following approaches are out of scope and are not substitutes for the missing seam:

- patching or monkeypatching an `@deepseek-ai/*` package;
- reordering rendered DOM nodes after the official shell renders them;
- directly invoking a foreign slot component obtained from the slot ledger;
- replacing the `sidebar.settings` shell or copying the official Settings pages into a new shell;
- installing a package, changing a lockfile, calling a model, or changing the native application.

## Evidence boundary

The evidence below is source and type inspection of the sibling worktree's installed published packages. It is L0 evidence only. It proves the published contract that is available to a plugin; it does not prove native application installation or runtime behavior.

Evidence root:

`/Users/sihaoli/Projects/DSH-Development-20261103/additional/intelligent-ui/user-message-smart-ui`

All package versions observed below are `0.2.1-rc.2`. The pnpm directory names also show the resolved Cordis peer `4.0.5`.

| Published package | Observed path and lines | Bounded finding |
| --- | --- | --- |
| `@deepseek-ai/dsh-client-ui-settings` | `node_modules/.pnpm/@deepseek-ai+dsh-client-ui-settings@0.2.1-rc.2_@deepseek-ai+cordis@4.0.5/node_modules/@deepseek-ai/dsh-client-ui-settings/lib/types/client/contract/slots.d.ts:62-77` | `settings.section` is a root-scoped list. Its registered navigation metadata is `id`, `order`, and `label`; its owner share is only `close()` at lines 147-157. |
| `@deepseek-ai/dsh-client-ui-settings` | Same package, `lib/types/client/contract/slots.d.ts:13-18,158-183` | `settings.launcher` can call `openSettings()` and `openOnboarding(id)`. `openSection(id)` is not a launcher capability; it appears only in the `settings.onboarding` owner share. |
| `@deepseek-ai/dsh-client-ui-settings-general` | `node_modules/.pnpm/@deepseek-ai+dsh-client-ui-settings-general@0.2.1-rc.2_@deepseek-ai+cordis@4.0.5/node_modules/@deepseek-ai/dsh-client-ui-settings-general/lib/types/client/shell-contract.d.ts:15-20,43-55` | The shell projects each section to `{ id, order, label }`; the public shell props expose the section and child-slot render faces, not a grouping or collapse controller. |
| `@deepseek-ai/dsh-client-ui-settings-general` | Same package, `lib/client.js:1138-1150,1180-1268,1293-1303` | The package owns `sidebar.settings`, reads `ctx.slots.entries("settings.section")`, sorts the root rows by `order`, and renders the active page through `renderSlot("settings.section", { close: onClose }, { only: active })`. |
| `@deepseek-ai/dsh-client-ui-settings-general` | Same package, `lib/client.js:1321-1324` | The built client entry exports only `SettingsDocumentStore`, `apply`, and `inject`. `SettingsRoot` is not an exported replacement-shell API. |
| `@deepseek-ai/dsh-client-ui-slots` | `node_modules/@deepseek-ai/dsh-client-ui-slots/package.json` and `lib/index.js:163-219,244-292,312-345` | `entries()` and `entriesOfSlot()` expose ledger records/winners. The topology snapshot deliberately omits components and executable hooks. The runtime raises `SlotOwnershipError` for a render call outside the declaring entry's child table at `lib/index.js:10-17`. |
| `@deepseek-ai/dsh-client-ui-slots` | Same package, `lib/types/index.d.ts:309-338,589-600,760-838` | Child-slot rendering is an owner-authorized `renderSlot` face. Declaring a child slot claims its render authority; a ledger reader does not receive a safe page-rendering capability. |

The package README states the same ownership boundary: the `sidebar.settings` shell and chrome live in `ui-settings-general`, while feature packages contribute `settings.section` pages (`@deepseek-ai/dsh-client-ui-settings/README.md:42-45`).

## Verified current section registrations

The bounded rc.2 package inventory confirms these live `settings.section` registrations. The registration paths are included so this table does not turn an icon fallback or an assumed future package into a verified section.

| Section id | Current order | Published owner package and registration path |
| --- | ---: | --- |
| `general` | `0` | `@deepseek-ai/dsh-client-ui-settings-general`, `lib/client.js:1293-1303` |
| `account` | `-10` | `@deepseek-ai/dsh-client-ui-settings-account`, `lib/client.js:4777-4783` |
| `models` | `10` | `@deepseek-ai/dsh-client-ui-settings-models`, `lib/client.js:4486-4495` |
| `plugins` | `15` | `@deepseek-ai/dsh-client-ui-settings-plugins`, `lib/client.js:202-212` |
| `agent-presets` | `20` | `@deepseek-ai/dsh-client-ui-agent-preset`, `lib/client.js:2456-2462` |

`archived-sessions` appears in `ui-settings-general`'s icon switch, but no corresponding `settings.section` registration was found in this bounded package inventory. It is therefore not listed as a verified live page. The grouping design must still preserve it, or any other entry, if a later composition registers it.

## Required official seam

The missing capability is a **host-owned navigation projection seam**. It must be added to the published settings contract and implemented by the official settings shell. A plugin may register a grouping policy through that seam, but it must not become the owner of `sidebar.settings` or of another plugin's page.

The host must expose a disposable policy over all live section metadata, and render its result inside the existing settings shell. The policy needs group labels/order, section membership and optional collapse state. These are required capabilities, not APIs claimed to exist in rc.2.

The shell must keep ownership of selection and `renderSlot("settings.section", { close }, { only: activeId })`. It must retain every section, place unmatched entries under **Other**, expand the active section's group and treat collapse as presentation state rather than section disposal.

Merely adding optional group metadata to future pages would not regroup current unmodified registrations. A host-owned projection of the existing ledger is needed. This project does not patch official packages or submit an official-upstream change to obtain it; implementation remains deferred until a supported seam is available.

## Desired grouping policy

The following target groups cover the 20 labels observed in the owner's native Settings dialog on 2026-11-04. Labels describe the desired result; they are not a proposal to identify pages by translated strings. A future implementation must map stable section metadata through a supported host API. Existing page labels, controls and ownership stay intact.

| Group | Observed pages to keep together |
| --- | --- |
| Models & accounts / 模型与账号 | 账号与余额; 模型; 模型订阅; 生图配置; 费用; DeepSeek 网页登录; 模型雷达 |
| Appearance & display / 界面与显示 | 通用设置; Theme / 外观; 智能体验; 会话前缀 |
| Solar & workflows / Solar 与工作流 | Agent 预设; Agent 人设; RLM 算子; 智能协同; 网页与洞察; 量化研究; bili设置 |
| Plugins / 插件管理 | 内置插件; 插件市场 |
| Other / 其他 | Every new or unmatched page; never hide an unknown entry. |

Within each group, preserve the host's order and stable registration order for ties. The policy must cover the complete live ledger exactly once. A failed or disposed policy falls back to the official flat navigation with all live rows still present.

## Preservation and disable behavior

Grouping is a navigation projection only. It must not rewrite the settings document, change a section's owner, alter a section's `close()` capability, or dispose a section that the grouping plugin does not own.

When the grouping plugin is disabled:

- its policy registration and only its group-collapse state are disposed;
- the official `ui-settings-general` shell remains active;
- all official and third-party `settings.section` registrations remain in the ledger;
- the active page remains selected while its id is live, subject to the existing shell fallback if the host itself removes that page;
- no foreign component is remounted through a copied or direct invocation path;
- no settings value, account credential, model configuration, plugin configuration, or Solar data is changed; and
- the native flat navigation is the fallback when no grouping policy is active.

Collapse hides navigation children only. It must not unregister entries, disable their plugins, or make the active page unreachable. Opening a collapsed group's page expands that group first. Group-collapse state is UI state unless the official host later provides a versioned persistence contract; this design does not invent one.

## Unblocking and acceptance boundary

This design is unblocked only after a published DSH package exposes and documents the host-owned seam above, and a source-only scratch check proves that it is usable without shell replacement. The follow-up implementation would need to verify, separately:

- all five verified rc.2 sections remain visible in their assigned groups;
- an injected future/unknown section appears under **Other** with its original id-backed page selection and label;
- locale changes update group and section labels without losing rows;
- an active page opens its group and still receives only the existing `close()` owner prop;
- disabling the policy returns to the official flat list with no section or settings data disposal; and
- the installed native app renders the real grouped dialog at default and narrow widths.

None of these runtime or install checks has been run for this task. There is no model-call requirement for the grouping policy itself.
