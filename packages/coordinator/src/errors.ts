import type { DigState } from './states.ts'

export class IllegalTransitionError extends Error {
  readonly code = 'illegal-transition' as const
  readonly from: DigState
  readonly action: string

  constructor(from: DigState, action: string) {
    super(`cannot ${action} from ${from}`)
    this.name = 'IllegalTransitionError'
    this.from = from
    this.action = action
  }
}

export class InvalidVerdictError extends Error {
  readonly code = 'invalid-verdict' as const

  constructor(message: string) {
    super(message)
    this.name = 'InvalidVerdictError'
  }
}

/** A tip SHA already has a Verdict. A new commit must use a new SHA. */
export class DuplicateVerdictError extends Error {
  readonly code = 'duplicate-verdict' as const
  readonly sha: string

  constructor(sha: string) {
    super(`one Verdict per tip; ${sha} already has one`)
    this.name = 'DuplicateVerdictError'
    this.sha = sha
  }
}
