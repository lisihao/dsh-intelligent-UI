export type AdaptiveComponentSourceId = 'skullet' | 'torph' | 'liveline' | 'visx'

export interface AdaptivePackageProvenance {
  readonly name: string
  readonly version: string
  readonly entry: string
  readonly integrity: string
}

/** Immutable package/source facts used by discovery and upgrade documentation. */
export interface AdaptiveComponentProvenance {
  readonly id: AdaptiveComponentSourceId
  readonly title: string
  readonly roles: readonly ('loading' | 'short-text' | 'live-series' | 'historical-chart')[]
  readonly packages: readonly AdaptivePackageProvenance[]
  readonly sourceUrl: string
  readonly sourceCommit: string
  readonly license: 'MIT'
  readonly licenseAsset: string
  readonly updatePolicy: string
  readonly fallback: string
}

export const adaptiveComponentProvenance = Object.freeze([
  {
    id: 'skullet', title: 'Skullet', roles: ['loading'],
    packages: [{ name: 'skullet', version: '0.0.3', entry: 'skullet/react', integrity: 'sha512-YPKHasYQxuZTQ6Tf6ap61lseIjdAklQlScg48HMKJW/AiGg8HaVdbfzg5XW/j6OdRuJbITpwsG5vJ8LAapmMJA==' }],
    sourceUrl: 'https://github.com/lochie/skullet/tree/770cba428e6954977fd97938f0f06a7cade2fc2d/packages/skullet',
    sourceCommit: '770cba428e6954977fd97938f0f06a7cade2fc2d', license: 'MIT', licenseAsset: 'lib/Skullet-MIT.txt',
    updatePolicy: 'Use only the published React entry after reviewing the fixed archive and MIT notice.',
    fallback: 'A neutral static box is shown only for an initial known loading surface; existing content remains visible during refresh.',
  },
  {
    id: 'torph', title: 'Torph', roles: ['short-text'],
    packages: [{ name: 'torph', version: '0.1.3', entry: 'torph/react', integrity: 'sha512-DOirbURFAedEZlK6Mx9jcAc7/gbDBUZNyXQwHUmQRXyUsbB3STYwb2PjiAy9iMc1eOWoQLfhm54DuPhWBPEibg==' }],
    sourceUrl: 'https://github.com/lochie/torph/tree/d79a5aa63226acf97d49c3e34fafb2e85c07b026/packages/torph',
    sourceCommit: 'd79a5aa63226acf97d49c3e34fafb2e85c07b026', license: 'MIT', licenseAsset: 'lib/Torph-MIT.txt',
    updatePolicy: 'Use only the published React entry after reviewing the fixed archive and MIT notice.',
    fallback: 'Plain text is retained for reduced motion and for prose, code, citations, URLs, or other ineligible text.',
  },
  {
    id: 'liveline', title: 'Liveline', roles: ['live-series'],
    packages: [{ name: 'liveline', version: '0.0.7', entry: 'liveline', integrity: 'sha512-S1Weo1kmefiOCNaW/WFXErqJXlV8A/ldIkIthaOeT57I2ZhqhKLKQDJ1wfabtMSK9vJeU8PeMNHd8Sr8TLByWQ==' }],
    sourceUrl: 'https://github.com/benjitaylor/liveline/tree/069899598a11e00094ea1eb6b838404825f828be',
    sourceCommit: '069899598a11e00094ea1eb6b838404825f828be', license: 'MIT', licenseAsset: 'lib/Liveline-MIT.txt',
    updatePolicy: 'Require the explicit live-series schema and review the published archive before an upgrade.',
    fallback: 'Reduced-motion, hidden-document, and one-observation states show the exact source table instead of an animated chart.',
  },
  {
    id: 'visx', title: 'visx', roles: ['historical-chart'],
    packages: [
      { name: '@visx/shape', version: '4.0.0', entry: '@visx/shape', integrity: 'sha512-X0FP3OFjQhc5/6Vj2aY7cK2JwKYI0H0hQM7cdNRWy/ZMMlrh5KpEdqx0HVo0KoTeTlkUvO+kydMLnAuuCRFIFw==' },
      { name: '@visx/scale', version: '4.0.0', entry: '@visx/scale', integrity: 'sha512-Q3VaSLKlsrxxSl9CwS2D3Mvz4/4kIp/6NMKRY8Im0Au1hrQh2egU806p0+JwN0ccuGGDe03jyAxX4BSRAH8Plg==' },
    ],
    sourceUrl: 'https://github.com/airbnb/visx/tree/78839796081beb0370fc928cc922b21908bbabaf',
    sourceCommit: '78839796081beb0370fc928cc922b21908bbabaf', license: 'MIT', licenseAsset: 'lib/visx-MIT.txt',
    updatePolicy: 'Review both exact published archives, their public primitives, and the MIT notice before changing either pin.',
    fallback: 'Invalid plans fail visibly; the caller retains the existing complete ChartDataTable source disclosure.',
  },
] satisfies readonly AdaptiveComponentProvenance[])

const sources: readonly AdaptiveComponentProvenance[] = adaptiveComponentProvenance
export const adaptiveComponentProvenanceById: Readonly<Record<AdaptiveComponentSourceId, AdaptiveComponentProvenance>> = Object.freeze({
  skullet: sources.find(entry => entry.id === 'skullet')!,
  torph: sources.find(entry => entry.id === 'torph')!,
  liveline: sources.find(entry => entry.id === 'liveline')!,
  visx: sources.find(entry => entry.id === 'visx')!,
})

export function adaptiveComponentSource(id: AdaptiveComponentSourceId): AdaptiveComponentProvenance {
  return adaptiveComponentProvenanceById[id]
}
