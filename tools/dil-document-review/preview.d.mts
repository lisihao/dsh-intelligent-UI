export interface DilDocumentReviewServer {
  readonly origin: string
  readonly state: 'pending' | 'ready' | 'failed'
  readonly parentCsp: string
  close(): Promise<void>
}

export interface DilDocumentReviewOptions {
  readonly rootDir?: string
  readonly manifest?: string
  readonly port?: number
}

export function startDilDocumentReview(options?: DilDocumentReviewOptions): Promise<DilDocumentReviewServer>
