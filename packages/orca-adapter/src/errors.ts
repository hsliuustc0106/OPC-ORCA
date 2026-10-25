/** The `orca` binary (Linux fallback: `orca-ide`) is not on PATH. */
export class OrcaNotConfiguredError extends Error {
  readonly code = 'not-configured' as const

  constructor(message: string) {
    super(message)
    this.name = 'OrcaNotConfiguredError'
  }
}

/**
 * The binary was found, but this package still refuses to spawn it.
 * A stub must not look like a successful Run, Task, or Dispatch.
 */
export class OrcaStubError extends Error {
  readonly code = 'not-implemented' as const
  readonly argv: readonly string[]

  constructor(message: string, argv: readonly string[]) {
    super(message)
    this.name = 'OrcaStubError'
    this.argv = argv
  }
}
