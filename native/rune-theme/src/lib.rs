#![cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]

//! A bounded Rust/WASM material layer for DSH Intelligent UI.
//!
//! This crate deliberately knows only rectangles and finite visual state. It never receives
//! Markdown, source text, links, DOM nodes, host actions, or credentials. Rune owns the GPU
//! material rendering; the surrounding DSH frame owns the accessible DOM above this canvas.

use std::{collections::HashSet, fmt};

use rune::render::{EffectPhase, KIND_EFFECT};
use rune::{Color, Compositor, Cx, El, Frame, Spring, effect, el};
use rune_fx::{
    FillAnchor, FlutedGlassParams, Fx, FxFrame, FxOptions, FxRenderer, FxSlot, LiquidMetalParams,
    Shape, rgb,
};
use serde::Deserialize;

pub const RUNE_THEME_CONTRACT_VERSION: u32 = 1;
pub const MAX_SURFACES: usize = 64;
pub const OPAQUE_OWNED_REGION_SUPPORTED: bool = true;
pub const TRANSPARENT_OVERLAY_SUPPORTED: bool = false;
pub const TRANSPARENCY_STATUS: &str = "TRANSPARENT_COMPOSITING_UNSUPPORTED";
pub const FLUTED_GLASS_SUPPORTED: bool = true;
const MAX_EXTENT: f32 = 32_768.0;
const MAX_ORIGIN: f32 = 65_536.0;
const EFFECT_MATERIAL_LIQUID_METAL: f32 = 1.0;
const EFFECT_MATERIAL_FLUTED_GLASS: f32 = 2.0;
const BACKDROP_COPY_UNSUPPORTED: &str = "RUNE_THEME_BACKDROP_COPY_UNSUPPORTED";

// Rune runs the web app and compositor on the browser's main thread. This is
// deliberately only a status bridge: rendering remains in the upstream Rust
// compositor, and the frame never supplies DOM pixels as a backdrop.
#[cfg(target_arch = "wasm32")]
thread_local! {
    static RUNTIME_CAPABILITY_ERROR: std::cell::RefCell<Option<&'static str>> = const {
        std::cell::RefCell::new(None)
    };
}

#[cfg(target_arch = "wasm32")]
fn clear_runtime_capability_error() {
    RUNTIME_CAPABILITY_ERROR.with(|error| *error.borrow_mut() = None);
}

#[cfg(not(target_arch = "wasm32"))]
fn clear_runtime_capability_error() {}

#[cfg(target_arch = "wasm32")]
fn set_runtime_capability_error(code: &'static str) {
    RUNTIME_CAPABILITY_ERROR.with(|error| {
        let mut error = error.borrow_mut();
        if error.is_none() {
            *error = Some(code);
        }
    });
}

#[cfg(not(target_arch = "wasm32"))]
fn set_runtime_capability_error(_: &'static str) {}

#[cfg(target_arch = "wasm32")]
fn runtime_capability_error() -> Option<&'static str> {
    RUNTIME_CAPABILITY_ERROR.with(|error| *error.borrow())
}

/// A named validation failure that browser glue can display without guessing or silently
/// replacing Rune with a CSS imitation.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ThemeError {
    pub code: String,
}

impl ThemeError {
    fn new(code: impl Into<String>) -> Self {
        Self { code: code.into() }
    }
}

impl fmt::Display for ThemeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.code)
    }
}

impl std::error::Error for ThemeError {}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ThemeInput {
    pub version: u32,
    pub width: f32,
    pub height: f32,
    pub reduced_motion: bool,
    pub surfaces: Vec<Surface>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Surface {
    pub id: String,
    pub role: SurfaceRole,
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
    pub state: SurfaceState,
    pub material: SurfaceMaterial,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum SurfaceRole {
    Reading,
    Card,
    Button,
    Input,
    Toggle,
    Chart,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum SurfaceState {
    Idle,
    Hover,
    Focus,
    Pressed,
    Disabled,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum SurfaceMaterial {
    Native,
    LiquidMetal,
    FlutedGlass,
}

impl ThemeInput {
    pub fn parse_json(input: &str) -> Result<Self, ThemeError> {
        let value: ThemeInput = serde_json::from_str(input)
            .map_err(|_| ThemeError::new("RUNE_THEME_PAYLOAD_INVALID"))?;
        value.validate()?;
        Ok(value)
    }

    pub fn validate(&self) -> Result<(), ThemeError> {
        if self.version != RUNE_THEME_CONTRACT_VERSION {
            return Err(ThemeError::new("RUNE_THEME_CONTRACT_VERSION_UNSUPPORTED"));
        }
        finite_extent(self.width, "RUNE_THEME_WIDTH_INVALID")?;
        finite_extent(self.height, "RUNE_THEME_HEIGHT_INVALID")?;
        if self.surfaces.len() > MAX_SURFACES {
            return Err(ThemeError::new("RUNE_THEME_SURFACE_LIMIT_EXCEEDED"));
        }
        let mut ids = HashSet::with_capacity(self.surfaces.len());
        for surface in &self.surfaces {
            if surface.id.is_empty()
                || surface.id.len() > 160
                || surface.id.chars().any(char::is_control)
            {
                return Err(ThemeError::new("RUNE_THEME_SURFACE_ID_INVALID"));
            }
            if !ids.insert(&surface.id) {
                return Err(ThemeError::new("RUNE_THEME_SURFACE_ID_DUPLICATE"));
            }
            finite_origin(surface.x, "RUNE_THEME_SURFACE_X_INVALID")?;
            finite_origin(surface.y, "RUNE_THEME_SURFACE_Y_INVALID")?;
            finite_extent(surface.width, "RUNE_THEME_SURFACE_WIDTH_INVALID")?;
            finite_extent(surface.height, "RUNE_THEME_SURFACE_HEIGHT_INVALID")?;
        }
        Ok(())
    }
}

fn finite_extent(value: f32, code: &str) -> Result<(), ThemeError> {
    if !value.is_finite() || !(0.0 < value && value <= MAX_EXTENT) {
        return Err(ThemeError::new(code));
    }
    Ok(())
}

fn finite_origin(value: f32, code: &str) -> Result<(), ThemeError> {
    if !value.is_finite() || value.abs() > MAX_ORIGIN {
        return Err(ThemeError::new(code));
    }
    Ok(())
}

/// This is an adapter mapping, not a claimed upstream global radius token. It makes the roles
/// explicit while preserving the actual Rune renderer/material implementation.
fn radius(role: SurfaceRole) -> f32 {
    match role {
        SurfaceRole::Reading => 18.0,
        SurfaceRole::Card => 20.0,
        SurfaceRole::Button => 14.0,
        SurfaceRole::Input => 12.0,
        SurfaceRole::Toggle => 999.0,
        SurfaceRole::Chart => 18.0,
    }
}

fn showreel(hex: &str) -> Color {
    // Constants are copied from Rune's `examples/showreel/src/kit.rs`; fallback is unreachable
    // for the static values below and avoids an unchecked panic in a renderer boundary.
    rune::color::hex(hex).unwrap_or(Color::BLACK)
}

fn surface_fill(surface: &Surface) -> Color {
    let raised = showreel("#1b1b1f");
    let panel = showreel("#141417");
    match surface.state {
        SurfaceState::Idle => match surface.role {
            SurfaceRole::Button | SurfaceRole::Toggle => raised,
            _ => panel,
        },
        SurfaceState::Hover | SurfaceState::Focus => raised,
        SurfaceState::Pressed => panel,
        SurfaceState::Disabled => panel.alpha(0.52),
    }
}

fn surface_border(surface: &Surface) -> Color {
    match surface.state {
        SurfaceState::Focus => showreel("#ededef").alpha(0.42),
        SurfaceState::Hover => Color::WHITE.alpha(0.16),
        SurfaceState::Disabled => Color::WHITE.alpha(0.035),
        _ => Color::WHITE.alpha(0.08),
    }
}

fn surface_shadow(surface: &Surface) -> Color {
    if surface.state == SurfaceState::Disabled {
        Color::BLACK.alpha(0.18)
    } else if surface.state == SurfaceState::Pressed {
        Color::BLACK.alpha(0.20)
    } else {
        Color::BLACK.alpha(0.45)
    }
}

fn state_code(state: SurfaceState) -> f32 {
    match state {
        SurfaceState::Idle => 0.0,
        SurfaceState::Hover => 1.0,
        SurfaceState::Focus => 2.0,
        SurfaceState::Pressed => 3.0,
        SurfaceState::Disabled => 4.0,
    }
}

fn state_from_code(value: f32) -> SurfaceState {
    match value as u32 {
        1 => SurfaceState::Hover,
        2 => SurfaceState::Focus,
        3 => SurfaceState::Pressed,
        4 => SurfaceState::Disabled,
        _ => SurfaceState::Idle,
    }
}

fn hash_id(id: &str) -> u32 {
    let mut value = 0x811c9dc5u32;
    for byte in id.bytes() {
        value ^= u32::from(byte);
        value = value.wrapping_mul(0x01000193);
    }
    value
}

fn metal_params(state: SurfaceState) -> LiquidMetalParams {
    // Rune's upstream chrome starts at `rune-fx/src/fill.rs:171-184`. State changes only tune
    // the documented physical controls; no JS shader or CSS imitation is introduced.
    let mut params = LiquidMetalParams::chrome().anchor(FillAnchor::Element);
    match state {
        SurfaceState::Idle => {}
        SurfaceState::Hover => {
            params.flow = 0.78;
            params.dome = 0.68;
            params.contrast = 1.10;
        }
        SurfaceState::Focus => {
            params.light = rgb(0xd8e6ff);
            params.iridescence = 0.14;
            params.contrast = 1.16;
        }
        SurfaceState::Pressed => {
            params.flow = 0.25;
            params.bevel = 9.0;
            params.dome = 0.36;
        }
        SurfaceState::Disabled => {
            params.flow = 0.0;
            params.speed = 0.0;
            params.contrast = 0.72;
        }
    }
    params
}

fn fluted_glass_params(state: SurfaceState) -> FlutedGlassParams {
    // These are the actual Showreel glass controls at
    // `examples/showreel/src/scenes/glass.rs:67`: rib 18, refraction 16,
    // frost .12, dispersion .3, highlight .55. State is an adapter-owned
    // adjustment of those real Rust parameters, never a CSS approximation.
    let mut params = FlutedGlassParams {
        rib: 18.0,
        refraction: 16.0,
        frost: 0.12,
        dispersion: 0.30,
        highlight: 0.55,
        ..FlutedGlassParams::reeded()
    };
    match state {
        SurfaceState::Idle => {}
        SurfaceState::Hover => {
            params.refraction = 18.0;
            params.highlight = 0.65;
        }
        SurfaceState::Focus => {
            params.frost = 0.20;
            params.highlight = 0.72;
        }
        SurfaceState::Pressed => {
            params.refraction = 10.0;
            params.frost = 0.08;
        }
        SurfaceState::Disabled => {
            params.refraction = 5.0;
            params.frost = 0.04;
            params.highlight = 0.20;
        }
    }
    params
}

fn native_surface(surface: &Surface) -> El {
    let spring = if surface.state == SurfaceState::Pressed {
        Spring::new(0.18, 0.0)
    } else {
        Spring::new(0.42, 0.12)
    };
    el().key(format!("native:{}", surface.id))
        .absolute(surface.x, surface.y)
        .size(surface.width, surface.height)
        .radius(radius(surface.role))
        .fill(surface_fill(surface))
        .border(1.0, surface_border(surface))
        .shadow(
            if surface.state == SurfaceState::Pressed {
                2.0
            } else {
                8.0
            },
            if surface.state == SurfaceState::Pressed {
                8.0
            } else {
                24.0
            },
            surface_shadow(surface),
        )
        .motion(spring)
}

fn metal_surface(surface: &Surface, index: usize, reduced_motion: bool) -> El {
    let spring = if surface.state == SurfaceState::Pressed {
        Spring::new(0.18, 0.0)
    } else {
        Spring::new(0.42, 0.12)
    };
    let r = radius(surface.role).min(surface.width.min(surface.height) * 0.5);
    el().key(format!("metal:{}", surface.id))
        .absolute(surface.x, surface.y)
        .size(surface.width, surface.height)
        .radius(r)
        .fill(Color::TRANSPARENT)
        .shadow(
            if surface.state == SurfaceState::Pressed {
                2.0
            } else {
                10.0
            },
            if surface.state == SurfaceState::Pressed {
                8.0
            } else {
                30.0
            },
            surface_shadow(surface),
        )
        .motion(spring)
        .child(
            effect((index + 1) as u32)
                .effect_data([
                    EFFECT_MATERIAL_LIQUID_METAL,
                    state_code(surface.state),
                    if reduced_motion { 1.0 } else { 0.0 },
                    f32::from_bits(hash_id(&surface.id)),
                ])
                .size(surface.width, surface.height)
                .radius(r),
        )
}

fn fluted_glass_surface(surface: &Surface, index: usize, reduced_motion: bool) -> El {
    let spring = if surface.state == SurfaceState::Pressed {
        Spring::new(0.18, 0.0)
    } else {
        Spring::new(0.42, 0.12)
    };
    let r = radius(surface.role).min(surface.width.min(surface.height) * 0.5);
    el().key(format!("fluted-glass:{}", surface.id))
        .absolute(surface.x, surface.y)
        .size(surface.width, surface.height)
        .radius(r)
        .fill(Color::TRANSPARENT)
        .shadow(
            if surface.state == SurfaceState::Pressed {
                2.0
            } else {
                10.0
            },
            if surface.state == SurfaceState::Pressed {
                8.0
            } else {
                30.0
            },
            surface_shadow(surface),
        )
        .motion(spring)
        .child(
            effect((index + 1) as u32)
                // This asks Rune to copy the already-painted part of this
                // owned canvas. It deliberately cannot and does not sample
                // the DOM source content composited above the frame.
                .effect_backdrop(true)
                .effect_data([
                    EFFECT_MATERIAL_FLUTED_GLASS,
                    state_code(surface.state),
                    if reduced_motion { 1.0 } else { 0.0 },
                    f32::from_bits(hash_id(&surface.id)),
                ])
                .size(surface.width, surface.height)
                .radius(r),
        )
}

fn view(state: &ThemeInput, cx: &mut Cx<ThemeInput>) -> El {
    // The user or host setting is authoritative over Rune's OS preference for this commit.
    cx.reduced_motion(state.reduced_motion);
    let mut root = el()
        .key("rune-theme-stage")
        .size(state.width, state.height)
        // Exact original showreel background (`examples/showreel/src/kit.rs:19`). This is an
        // opaque owned-frame theme, not a claim of transparent canvas composition.
        .fill(showreel("#0b0b0d"));
    for (index, surface) in state.surfaces.iter().enumerate() {
        root = root.child(match surface.material {
            SurfaceMaterial::Native => native_surface(surface),
            SurfaceMaterial::LiquidMetal => metal_surface(surface, index, state.reduced_motion),
            SurfaceMaterial::FlutedGlass => {
                fluted_glass_surface(surface, index, state.reduced_motion)
            }
        });
    }
    root
}

fn unused_initial_state() -> ThemeInput {
    ThemeInput {
        version: RUNE_THEME_CONTRACT_VERSION,
        width: 1.0,
        height: 1.0,
        reduced_motion: true,
        surfaces: Vec::new(),
    }
}

struct FxDevice {
    key: rune::compose::DeviceKey,
    format: wgpu::TextureFormat,
    renderer: FxRenderer,
    /// A Rune-owned intermediate target. WebGPU canvas surfaces do not have to
    /// expose `COPY_SRC`, whereas Rune's real backdrop pipeline does. The
    /// adapter therefore renders the entire opaque owned region here first,
    /// then uses wgpu's official TextureBlitter solely to present those pixels
    /// to the carrier surface.
    stage: Option<MaterialStage>,
    blitter: wgpu::util::TextureBlitter,
}

struct MaterialStage {
    size: (u32, u32),
    // The texture must stay alive for `view`. It intentionally has no CPU
    // readback path and never contains host DOM pixels.
    _texture: wgpu::Texture,
    view: wgpu::TextureView,
}

fn material_stage_usage() -> wgpu::TextureUsages {
    wgpu::TextureUsages::RENDER_ATTACHMENT
        | wgpu::TextureUsages::COPY_SRC
        | wgpu::TextureUsages::TEXTURE_BINDING
}

impl FxDevice {
    fn ensure_stage(&mut self, device: &wgpu::Device, size: (u32, u32)) {
        let needs_new = self.stage.as_ref().is_none_or(|stage| stage.size != size);
        if !needs_new {
            return;
        }
        let texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("dsh-rune-theme-material-stage"),
            size: wgpu::Extent3d {
                width: size.0,
                height: size.1,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: self.format,
            // `draw_with_backdrop` needs COPY_SRC for its upstream
            // EffectSite backdrop copy. TextureBlitter needs TEXTURE_BINDING
            // to present the real Rune result into `frame.target`.
            usage: material_stage_usage(),
            view_formats: &[],
        });
        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
        self.stage = Some(MaterialStage {
            size,
            _texture: texture,
            view,
        });
    }
}

#[derive(Default)]
struct MaterialCompositor {
    fx: Option<FxDevice>,
    animating: bool,
}

impl MaterialCompositor {
    fn resources<'a>(&'a mut self, frame: &Frame<'_, ThemeInput>) -> &'a mut FxDevice {
        let needs_new = self.fx.as_ref().is_none_or(|existing| {
            existing.key != frame.device_key() || existing.format != frame.format
        });
        if needs_new {
            self.fx = Some(FxDevice {
                key: frame.device_key(),
                format: frame.format,
                renderer: FxRenderer::new(frame.device, frame.format, FxOptions { dither: false }),
                stage: None,
                // `TextureBlitter` is the upstream wgpu transport intended
                // for presenting into surfaces that cannot expose COPY_DST.
                // It is not a visual substitute for Rune or rune-fx.
                blitter: wgpu::util::TextureBlitter::new(frame.device, frame.format),
            });
        }
        self.fx
            .as_mut()
            .expect("Rune FX resources were constructed")
    }
}

impl Compositor<ThemeInput> for MaterialCompositor {
    fn render(&mut self, frame: &mut Frame<'_, ThemeInput>) {
        // WebGPU textures cannot have a zero extent. Rune normally skips an
        // unavailable canvas, but keep the adapter boundary explicit.
        if frame.size.0 == 0 || frame.size.1 == 0 {
            self.animating = false;
            return;
        }
        let mut instance_indices = Vec::new();
        let mut layers = Vec::new();
        let mut slots = Vec::new();
        let mut material_kinds = Vec::new();
        let time = frame.rt.t as f32;
        for (index, instance) in frame.rt.instances.iter().enumerate() {
            if instance.params[1] != KIND_EFFECT {
                continue;
            }
            let scale = instance.params[3];
            if !(scale.is_finite() && scale > 0.0) {
                continue;
            }
            let [x, y, width, height] = instance.rect.map(|value| value / scale);
            let r = instance.radii[0] / scale;
            let state = state_from_code(instance.uv[1]);
            let reduced = instance.uv[2] != 0.0;
            let shape = Shape::rounded(x, y, width, height, r);
            let (layer, material_kind) = if instance.uv[0] == EFFECT_MATERIAL_LIQUID_METAL {
                (
                    Fx::fill(metal_params(state))
                        .on(shape)
                        .at(time)
                        .seed(instance.uv[3].to_bits())
                        .reduced(reduced),
                    SurfaceMaterial::LiquidMetal,
                )
            } else if instance.uv[0] == EFFECT_MATERIAL_FLUTED_GLASS {
                (
                    Fx::fill(fluted_glass_params(state))
                        .on(shape)
                        .at(time)
                        .seed(instance.uv[3].to_bits())
                        .reduced(reduced),
                    SurfaceMaterial::FlutedGlass,
                )
            } else {
                continue;
            };
            instance_indices.push(index as u32);
            material_kinds.push(material_kind);
            slots.push(
                FxSlot::default()
                    .scale(scale)
                    .clip(instance.clip, instance.fade),
            );
            layers.push(layer);
        }
        self.animating = layers.iter().any(rune_fx::FxLayer::is_animating);
        let srgb = frame.srgb_blend();
        let resources = self.resources(frame);
        resources.ensure_stage(frame.device, frame.size);
        let FxDevice {
            renderer: fx,
            stage,
            blitter,
            ..
        } = resources;
        let stage_view = &stage
            .as_ref()
            .expect("Rune material stage was allocated")
            .view;
        fx.set_srgb_blend(srgb);
        // A backdrop effect may live inside Rune's isolated Rgba16Float layer
        // during opacity/transition composition. This is the upstream Showreel
        // requirement before `draw_layer_in` receives that EffectSite format.
        fx.add_format(frame.device, wgpu::TextureFormat::Rgba16Float);
        fx.prepare_with_slots(
            frame.device,
            frame.queue,
            &FxFrame {
                viewport: [frame.size.0, frame.size.1],
                scale: 1.0,
                layers: &layers,
                backdrop: None,
                sources: &[],
            },
            &slots,
        );
        frame.ui.prepare(
            frame.device,
            frame.queue,
            &mut frame.rt.text.atlas,
            &frame.rt.instances,
            frame.size,
        );
        frame.ui.draw_with_backdrop(
            frame.encoder,
            stage_view,
            frame.rt.clear_color(),
            &mut |phase, site| {
                let Some(layer) = instance_indices
                    .iter()
                    .position(|index| *index == site.index)
                else {
                    return;
                };
                let is_fluted_glass = material_kinds[layer] == SurfaceMaterial::FlutedGlass;
                match phase {
                    EffectPhase::Backdrop(encoder) => {
                        if is_fluted_glass {
                            if let Some(backdrop) = site.backdrop {
                                // Rune's own renderer copied the adapter-owned
                                // target up to this slot. `blur_backdrop` is the
                                // real rune-fx pipeline for FlutedGlass
                                // frost/refraction; it never samples host DOM.
                                fx.blur_backdrop(
                                    frame.device,
                                    frame.queue,
                                    encoder,
                                    backdrop,
                                    layer,
                                );
                            } else {
                                // The adapter-owned stage has COPY_SRC. Retain a
                                // named failure rather than draw a dummy material
                                // if an upstream renderer ever cannot supply it.
                                set_runtime_capability_error(BACKDROP_COPY_UNSUPPORTED);
                            }
                        }
                    }
                    EffectPhase::Draw(pass) => {
                        if !is_fluted_glass || site.backdrop.is_some() {
                            fx.draw_layer_in(pass, site.format, site.origin, layer);
                        } else {
                            // This should be unreachable because `stage_view`
                            // is adapter-owned with COPY_SRC; keep the failure
                            // named if the public Rune renderer reports otherwise.
                            set_runtime_capability_error(BACKDROP_COPY_UNSUPPORTED);
                        }
                    }
                }
            },
        );
        // `TextureBlitter` records a full opaque presentation pass into the
        // WebGPU canvas. The source is the true Rust/Rune result; JavaScript
        // passes only bounded geometry and never approximates this material.
        blitter.copy(frame.device, frame.encoder, stage_view, frame.target);
    }

    fn animating(&self) -> bool {
        self.animating
    }
}

#[cfg(target_arch = "wasm32")]
mod web {
    use std::cell::RefCell;

    use js_sys::JSON;
    use rune::{App, AppHandle, AppSpec, Spring};
    use wasm_bindgen::prelude::*;

    use super::{
        FLUTED_GLASS_SUPPORTED, MaterialCompositor, OPAQUE_OWNED_REGION_SUPPORTED,
        RUNE_THEME_CONTRACT_VERSION, TRANSPARENCY_STATUS, TRANSPARENT_OVERLAY_SUPPORTED,
        ThemeInput, clear_runtime_capability_error,
        runtime_capability_error as native_runtime_capability_error, unused_initial_state, view,
    };

    thread_local! {
        static RUNNING: RefCell<Option<AppHandle<ThemeInput>>> = const { RefCell::new(None) };
    }

    fn js_error(error: impl ToString) -> JsValue {
        JsValue::from_str(&error.to_string())
    }

    fn parse(value: JsValue) -> Result<ThemeInput, JsValue> {
        let text = JSON::stringify(&value)
            .map_err(|_| js_error("RUNE_THEME_PAYLOAD_INVALID"))?
            .as_string()
            .ok_or_else(|| js_error("RUNE_THEME_PAYLOAD_INVALID"))?;
        ThemeInput::parse_json(&text).map_err(js_error)
    }

    #[wasm_bindgen]
    pub fn contract_version() -> u32 {
        RUNE_THEME_CONTRACT_VERSION
    }

    /// The pinned public Rune Web builder has no alpha-mode selection. This remains false until
    /// browser evidence proves an upstream public API that can preserve DOM-underlay alpha.
    #[wasm_bindgen]
    pub fn transparent_overlay_supported() -> bool {
        TRANSPARENT_OVERLAY_SUPPORTED
    }

    /// The supported presentation mode: Rune owns an opaque showreel-background canvas below
    /// the DSH DOM for this content region. It avoids claiming unavailable alpha composition.
    #[wasm_bindgen]
    pub fn opaque_owned_region_supported() -> bool {
        OPAQUE_OWNED_REGION_SUPPORTED
    }

    /// The adapter builds real rune-fx FlutedGlass layers into a Rust-owned
    /// COPY_SRC stage, then presents that output to the browser canvas. A
    /// named capability error remains available if the pinned public Rune
    /// renderer cannot provide a backdrop for that owned stage.
    #[wasm_bindgen]
    pub fn fluted_glass_supported() -> bool {
        FLUTED_GLASS_SUPPORTED
    }

    #[wasm_bindgen]
    pub fn transparency_status() -> String {
        TRANSPARENCY_STATUS.to_owned()
    }

    #[wasm_bindgen]
    pub fn mount(canvas_id: String, payload: JsValue) -> Result<(), JsValue> {
        if canvas_id.is_empty() || canvas_id.len() > 160 || canvas_id.chars().any(char::is_control)
        {
            return Err(js_error("RUNE_THEME_CANVAS_ID_INVALID"));
        }
        let state = parse(payload)?;
        clear_runtime_capability_error();
        RUNNING.with(|running| {
            if let Some(previous) = running.borrow_mut().take() {
                previous.quit();
            }
            let spec = AppSpec::new(
                "DSH Rune material",
                (state.width, state.height),
                unused_initial_state,
                view,
            );
            let app = App::new(spec)
                .init(move || state.clone())
                .canvas_id(canvas_id)
                .compositor(MaterialCompositor::default());
            let handle = app.handle();
            app.try_run().map_err(js_error)?;
            *running.borrow_mut() = Some(handle);
            Ok(())
        })
    }

    #[wasm_bindgen]
    pub fn update(payload: JsValue) -> Result<(), JsValue> {
        let next = parse(payload)?;
        let handle = RUNNING
            .with(|running| running.borrow().clone())
            .ok_or_else(|| js_error("RUNE_THEME_NOT_MOUNTED"))?;
        handle.update(move |state, tx| {
            let reduce = state.reduced_motion || next.reduced_motion;
            *state = next;
            if reduce {
                tx.instant();
            } else {
                tx.motion(Spring::new(0.42, 0.12));
            }
        });
        Ok(())
    }

    #[wasm_bindgen]
    pub fn mounted() -> bool {
        RUNNING.with(|running| running.borrow().as_ref().is_some_and(AppHandle::is_visible))
    }

    #[wasm_bindgen]
    pub fn runtime_capability_error() -> Option<String> {
        native_runtime_capability_error().map(str::to_owned)
    }

    #[wasm_bindgen]
    pub fn dispose() {
        RUNNING.with(|running| {
            if let Some(handle) = running.borrow_mut().take() {
                handle.quit();
            }
        });
        clear_runtime_capability_error();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(material: &str) -> String {
        format!(
            r#"{{"version":1,"width":390,"height":720,"reducedMotion":false,"surfaces":[{{"id":"card-1","role":"card","x":16,"y":20,"width":358,"height":160,"state":"hover","material":"{material}"}}]}}"#,
        )
    }

    #[test]
    fn accepts_finite_bounded_native_and_metal_surfaces() {
        let native =
            ThemeInput::parse_json(&input("native")).expect("native contract should be accepted");
        let metal = ThemeInput::parse_json(&input("liquid-metal"))
            .expect("metal contract should be accepted");
        assert_eq!(native.surfaces.len(), 1);
        assert_eq!(metal.surfaces[0].material, SurfaceMaterial::LiquidMetal);
    }

    #[test]
    fn accepts_a_fluted_glass_request_for_rune_owned_backdrop_rendering() {
        let glass = ThemeInput::parse_json(&input("fluted-glass"))
            .expect("fluted glass uses Rune's owned-canvas backdrop, not DOM pixels");
        assert_eq!(glass.surfaces[0].material, SurfaceMaterial::FlutedGlass);
        assert!(FLUTED_GLASS_SUPPORTED);
    }

    #[test]
    fn fluted_glass_starts_from_the_actual_showreel_parameters() {
        let params = fluted_glass_params(SurfaceState::Idle);
        assert_eq!(params.rib, 18.0);
        assert_eq!(params.refraction, 16.0);
        assert_eq!(params.frost, 0.12);
        assert_eq!(params.dispersion, 0.30);
        assert_eq!(params.highlight, 0.55);
    }

    #[test]
    fn rejects_unknown_fields_and_versions_at_the_json_boundary() {
        assert_eq!(
            ThemeInput::parse_json(
                r#"{"version":2,"width":390,"height":720,"reducedMotion":false,"surfaces":[]}"#
            )
            .unwrap_err()
            .code,
            "RUNE_THEME_CONTRACT_VERSION_UNSUPPORTED"
        );
        assert_eq!(ThemeInput::parse_json(r#"{"version":1,"width":390,"height":720,"reducedMotion":false,"surfaces":[],"extra":true}"#).unwrap_err().code, "RUNE_THEME_PAYLOAD_INVALID");
    }

    #[test]
    fn rejects_duplicate_ids_and_nonfinite_geometry() {
        let duplicate = r#"{"version":1,"width":390,"height":720,"reducedMotion":false,"surfaces":[{"id":"same","role":"card","x":0,"y":0,"width":1,"height":1,"state":"idle","material":"native"},{"id":"same","role":"card","x":1,"y":1,"width":1,"height":1,"state":"idle","material":"native"}]}"#;
        assert_eq!(
            ThemeInput::parse_json(duplicate).unwrap_err().code,
            "RUNE_THEME_SURFACE_ID_DUPLICATE"
        );
        let invalid = r#"{"version":1,"width":0,"height":720,"reducedMotion":false,"surfaces":[]}"#;
        assert_eq!(
            ThemeInput::parse_json(invalid).unwrap_err().code,
            "RUNE_THEME_WIDTH_INVALID"
        );
    }

    #[test]
    fn exposes_only_the_opaque_owned_region_presentation_capability() {
        assert!(OPAQUE_OWNED_REGION_SUPPORTED);
        assert!(!TRANSPARENT_OVERLAY_SUPPORTED);
        assert_eq!(TRANSPARENCY_STATUS, "TRANSPARENT_COMPOSITING_UNSUPPORTED");
    }

    #[test]
    fn owned_stage_has_the_real_backdrop_and_presentation_usages() {
        let usage = material_stage_usage();
        assert!(usage.contains(wgpu::TextureUsages::RENDER_ATTACHMENT));
        assert!(usage.contains(wgpu::TextureUsages::COPY_SRC));
        assert!(usage.contains(wgpu::TextureUsages::TEXTURE_BINDING));
    }
}
