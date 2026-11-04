// The one error class behind the frozen `CaptionFailure` structural contract
// (tests/unit/captions/unit07-api-contract.d.ts). SECURITY-03 / FR-07.6:
// callers may pass ONLY codes, numbers and line numbers into `message` and
// `detail` — never caption text. `Error` subclass per conventions § Errors
// (unit-03 ModelFailure precedent); tests assert the shape structurally.

import type { CaptionErrorCode, CaptionFailure } from './types'

export interface CaptionFailureOptions {
  line?: number
  detail?: string
}

export class CaptionFailureError extends Error implements CaptionFailure {
  public override readonly name = 'CaptionFailure'
  public readonly code: CaptionErrorCode
  public readonly line?: number
  public readonly detail?: string

  public constructor(code: CaptionErrorCode, message: string, options: CaptionFailureOptions = {}) {
    super(message)
    this.code = code
    if (options.line !== undefined) this.line = options.line
    if (options.detail !== undefined) this.detail = options.detail
  }
}
