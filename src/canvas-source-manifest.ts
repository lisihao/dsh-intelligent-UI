/** Paths and SHA-256 metadata only; upstream Canvas UI source is not redistributed. */
import { findCanvasComponent } from './canvas-catalog.js'

export interface CanvasSourceMetadata {
  readonly size: number
  readonly sha256: string
}

/** Fixed upstream commit a04a99b235299ee79a123a16ccb2e6cf9da74b6b. */
export const CANVAS_SOURCE_MANIFEST: Readonly<Record<string, CanvasSourceMetadata>> = Object.freeze({
  'src/lib/AsciiObject/AsciiObjectVanilla.ts': { size: 43982, sha256: '77ed695e83910f993320b2aad51a66b603d4672071f9c64e038556172230b571' },
  'src/lib/AsciiSweep/AsciiSweepVanilla.ts': { size: 54732, sha256: '689762d1b370a88614d1c75dea2f02a3a45777c7f46ac524992bca40aac7cadc' },
  'src/lib/Asciify/AsciifyVanilla.ts': { size: 42645, sha256: '71911119f429fcec82e53c3935e7604af6931a64b05ddfd32b73c8001da8c1d2' },
  'src/lib/Bend/BendVanilla.ts': { size: 31331, sha256: '9f48993dc1ccfd419b833791136ca6004076c815abbd6a63e16f1b9c27c29d85' },
  'src/lib/Blaze/BlazeVanilla.ts': { size: 20117, sha256: '3fa084c469ed1089b9a5a65cda3b3c00133408ea9a9bb91ced81a04effc15c9f' },
  'src/lib/Bubble/BubbleVanilla.ts': { size: 19059, sha256: '13599050bc3c45e96901ab3f8a91bc10a50ddadae17725a8ffa170f5a477a588' },
  'src/lib/Canvas/CanvasVanilla.ts': { size: 29177, sha256: '534a3efc9fad872c2f3312a1706846daa9bfc0f19ef4ab479f31ad7541bd4bb8' },
  'src/lib/Cloth/ClothVanilla.ts': { size: 27884, sha256: '931f283b5861fdd362372a29ef0ffe38b84034400f58fd03988868bd31f371c1' },
  'src/lib/Clouds/CloudsVanilla.ts': { size: 22811, sha256: 'd90b95f6db20fb4612cbfa5fc77e36384b7a1cf6db922c04101829b79d8bf36e' },
  'src/lib/DecryptReveal/DecryptRevealVanilla.ts': { size: 32567, sha256: '321939115f3ddfbe86d0d87764286437b6835d765e10530e31cab9ddaa905a9e' },
  'src/lib/Displacement/DisplacementVanilla.ts': { size: 17375, sha256: '71252faa6e51f94d9c74b28937f9e4304630859578d048d81429f4ee3c6a2cfc' },
  'src/lib/DitheredObject/DitheredObjectVanilla.ts': { size: 39041, sha256: '66e187592334cd7bdaa56e2d0b95505cdda1bd479008adcdbb43f33ee040a53e' },
  'src/lib/Droplets/DropletsVanilla.ts': { size: 23006, sha256: 'a480a1c02bc56adab8fcc7b9a4207d66f247a4aba0ad56bbc0c8a4957360effa' },
  'src/lib/FlameWrap/FlameWrapVanilla.ts': { size: 22788, sha256: '84930e4f1335fb6d66cad1d59dab4720e71ec3e5a10b03a8d6f13fc272bef29a' },
  'src/lib/ForceField/ForceFieldVanilla.ts': { size: 40815, sha256: '5953633f26c6abeff238009cfe483d7750c2a3661f62c8df930303378eb5949d' },
  'src/lib/Frost/FrostVanilla.ts': { size: 37969, sha256: 'f15abade81f23cdbe58c7a89d50f6ea14e47e723709b392eaba7e7f66b1778f5' },
  'src/lib/Glass/GlassVanilla.ts': { size: 19429, sha256: '3642cf1fcf87e6b4857ebbba50520fe2597b3e88d07507955085dc1b0f0c8138' },
  'src/lib/GlassObject/GlassObjectVanilla.ts': { size: 36517, sha256: '2b815d41e7a51409c76cd86c8c6adc4fa5db72674eb8340861829386cee17911' },
  'src/lib/Glitch/GlitchVanilla.ts': { size: 12719, sha256: 'c0ad87378cb561a0832483e43c5bb8302a8430d4c958453ce90c125a42b6c260' },
  'src/lib/GlyphRain/GlyphRainVanilla.ts': { size: 26551, sha256: '0299b3de6b909a00bb093f2fa6dbe8dd22aacced739409e971f264d8d2e2b267' },
  'src/lib/Grid/GridVanilla.ts': { size: 24078, sha256: '498341fe755e6febd79e43ed10faccad6f72a157fd0b85e472e23e6dbf5d7342' },
  'src/lib/HexFloat/HexFloatVanilla.ts': { size: 48565, sha256: '9e0a347b92940592284c1cfcdd204dc5bf4be4ec3dd9489277e8e755b024871f' },
  'src/lib/InkObject/InkObjectVanilla.ts': { size: 43954, sha256: '626b242ae7908c5698166802e0412bc4d87479f10857b2477fb00371e39daaf1' },
  'src/lib/Laser/LaserVanilla.ts': { size: 19240, sha256: '9b92524804a8fb2c722d97622d4656d677dccdd2cd202779c9fb38ff8da86a44' },
  'src/lib/Liquid/LiquidVanilla.ts': { size: 30698, sha256: 'd35368f1bc5b262b5c2692168c05e8d43a10dc3df0665142b14909786089fd37' },
  'src/lib/LiquidObject/LiquidObjectVanilla.ts': { size: 61269, sha256: '7feb9476c20ba52fe6e2aa5cd0fa6b1d743ae114f3164d7b7d3774b1f621d466' },
  'src/lib/Magnify/MagnifyVanilla.ts': { size: 24453, sha256: '4964e806003d0c0d26d1380670db613ea81edd6de703951334a7b1a4c0ba3da6' },
  'src/lib/ParticleObject/ParticleObjectVanilla.ts': { size: 32761, sha256: 'df43e3d58ab84ffda85b1d71b13f14836696d0d0ef04d3a225c8335af887b9c3' },
  'src/lib/ParticleReveal/ParticleRevealVanilla.ts': { size: 16064, sha256: '98fbcdb87ee171189b3f743419a1361ff48d761de8b5435cdb59d7b4f1e514c3' },
  'src/lib/ParticleScroll/ParticleScrollVanilla.ts': { size: 21982, sha256: '8c8dc7a48a3108be68daf2ad37c513e4c8144aa1195f9100d73229560c0e6d99' },
  'src/lib/Peel/PeelVanilla.ts': { size: 19977, sha256: 'be9ff8060b5ff19a71688624e51cbdb94aee1d1cffa7d9def6561051a266acb5' },
  'src/lib/RetroDither/RetroDitherVanilla.ts': { size: 23474, sha256: 'ca237acc023dda658213155714adc2e54a290fed359021e6ae0ce4d9818d9a51' },
  'src/lib/Ripple/RippleVanilla.ts': { size: 15225, sha256: '60ef5fdc2aa284c717009feaf4e3031ca5f4df24c9717908c785d0bc0d8c92ea' },
  'src/lib/Shatter/ShatterVanilla.ts': { size: 22227, sha256: '648ad8ed3fd94192f74d6e6f9ed1ef2a246bc6c96ed89e58681fb2fea9472d20' },
  'src/lib/VHS/VHSVanilla.ts': { size: 16425, sha256: 'b438a1c3af3d2f43f38b7308ceef0ee103e28bccc609ab22d2c3dce69a3083bd' },
  'src/lib/canvas-viewport.ts': { size: 2212, sha256: 'd88c8a55a656f81e6386570058f1bc0f7ad98b4f857da11457a862e10f4218bd' },
  'src/lib/html-in-canvas.ts': { size: 1455, sha256: '8fd3adf59ba3b54a32c8552f614321e123047e107f94e6272c64658e71501e9a' },
  'src/lib/rect-cache.ts': { size: 646, sha256: '4f743f99a3cf0830f567d01143bd820776589dea1172f2eb0ccfa002d0a08382' },
})

/** Resolve only a known catalog slug to its original WebGL/Vanilla entry. */
export function canvasSourceEntry(slug: string): string | undefined {
  if (!findCanvasComponent(slug)) return undefined
  const name = slug === 'vhs' ? 'VHS' : slug.split('-').map(part => part[0]!.toUpperCase() + part.slice(1)).join('')
  const path = `src/lib/${name}/${name}Vanilla.ts`
  return Object.hasOwn(CANVAS_SOURCE_MANIFEST, path) ? path : undefined
}
