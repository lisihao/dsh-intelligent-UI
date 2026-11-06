/* tslint:disable */
/* eslint-disable */

export function contract_version(): number;

export function dispose(): void;

/**
 * The adapter builds real rune-fx FlutedGlass layers into a Rust-owned
 * COPY_SRC stage, then presents that output to the browser canvas. A
 * named capability error remains available if the pinned public Rune
 * renderer cannot provide a backdrop for that owned stage.
 */
export function fluted_glass_supported(): boolean;

declare function mount2(canvas_id: string, payload: any): void;
export { mount2 as mount }

export function mounted(): boolean;

/**
 * The supported presentation mode: Rune owns an opaque showreel-background canvas below
 * the DSH DOM for this content region. It avoids claiming unavailable alpha composition.
 */
export function opaque_owned_region_supported(): boolean;

export function runtime_capability_error(): string | undefined;

export function transparency_status(): string;

/**
 * The pinned public Rune Web builder has no alpha-mode selection. This remains false until
 * browser evidence proves an upstream public API that can preserve DOM-underlay alpha.
 */
export function transparent_overlay_supported(): boolean;

export function update(payload: any): void;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly contract_version: () => number;
    readonly dispose: () => void;
    readonly fluted_glass_supported: () => number;
    readonly mount: (a: number, b: number, c: any) => [number, number];
    readonly mounted: () => number;
    readonly opaque_owned_region_supported: () => number;
    readonly runtime_capability_error: () => [number, number];
    readonly transparency_status: () => [number, number];
    readonly transparent_overlay_supported: () => number;
    readonly update: (a: any) => [number, number];
    readonly wasm_bindgen_4ddae55b6e9693fa___convert__closures_____invoke___alloc_42d2b33bd937efdb___string__String______true_: (a: number, b: number, c: number, d: number) => void;
    readonly wasm_bindgen_4ddae55b6e9693fa___convert__closures_____invoke___js_sys_31464c3a5d74e3f4___Array__web_sys_fadb1811a19544cf___features__gen_ResizeObserver__ResizeObserver______true_: (a: number, b: number, c: any, d: any) => void;
    readonly wasm_bindgen_4ddae55b6e9693fa___convert__closures_____invoke___wasm_bindgen_4ddae55b6e9693fa___JsValue__core_37ee0ce0c4cd57d5___result__Result_____wasm_bindgen_4ddae55b6e9693fa___JsError___true_: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen_4ddae55b6e9693fa___convert__closures_____invoke___wasm_bindgen_4ddae55b6e9693fa___sys__JsNullable_wgpu_bb8728665bcbfb11___backend__webgpu__webgpu_sys__gen_GpuError__GpuError___core_37ee0ce0c4cd57d5___result__Result_____wasm_bindgen_4ddae55b6e9693fa___JsError___true_: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen_4ddae55b6e9693fa___convert__closures_____invoke___wasm_bindgen_4ddae55b6e9693fa___sys__JsNullable_wgpu_bb8728665bcbfb11___backend__webgpu__webgpu_sys__gen_GpuError__GpuError___core_37ee0ce0c4cd57d5___result__Result_____wasm_bindgen_4ddae55b6e9693fa___JsError___true__21: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen_4ddae55b6e9693fa___convert__closures_____invoke___wasm_bindgen_4ddae55b6e9693fa___sys__JsNullable_wgpu_bb8728665bcbfb11___backend__webgpu__webgpu_sys__gen_GpuError__GpuError___core_37ee0ce0c4cd57d5___result__Result_____wasm_bindgen_4ddae55b6e9693fa___JsError___true__22: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen_4ddae55b6e9693fa___convert__closures_____invoke___core_37ee0ce0c4cd57d5___option__Option_web_sys_fadb1811a19544cf___features__gen_Blob__Blob_______true_: (a: number, b: number, c: number) => void;
    readonly wasm_bindgen_4ddae55b6e9693fa___convert__closures_____invoke___wasm_bindgen_4ddae55b6e9693fa___JsValue______true_: (a: number, b: number, c: any) => void;
    readonly wasm_bindgen_4ddae55b6e9693fa___convert__closures_____invoke___wasm_bindgen_4ddae55b6e9693fa___JsValue______true__13: (a: number, b: number, c: any) => void;
    readonly wasm_bindgen_4ddae55b6e9693fa___convert__closures_____invoke___wasm_bindgen_4ddae55b6e9693fa___JsValue______true__14: (a: number, b: number, c: any) => void;
    readonly wasm_bindgen_4ddae55b6e9693fa___convert__closures_____invoke___wasm_bindgen_4ddae55b6e9693fa___JsValue______true__15: (a: number, b: number, c: any) => void;
    readonly wasm_bindgen_4ddae55b6e9693fa___convert__closures_____invoke___wasm_bindgen_4ddae55b6e9693fa___JsValue______true__17: (a: number, b: number, c: any) => void;
    readonly wasm_bindgen_4ddae55b6e9693fa___convert__closures_____invoke___wasm_bindgen_4ddae55b6e9693fa___JsValue______true__18: (a: number, b: number, c: any) => void;
    readonly wasm_bindgen_4ddae55b6e9693fa___convert__closures_____invoke___wasm_bindgen_4ddae55b6e9693fa___JsValue______true__19: (a: number, b: number, c: any) => void;
    readonly wasm_bindgen_4ddae55b6e9693fa___convert__closures_____invoke___wasm_bindgen_4ddae55b6e9693fa___JsValue______true__20: (a: number, b: number, c: any) => void;
    readonly wasm_bindgen_4ddae55b6e9693fa___convert__closures_____invoke_______true_: (a: number, b: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_destroy_closure: (a: number, b: number) => void;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
