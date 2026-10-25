/** The `orca` binary (Linux fallback: `orca-ide`) is not on PATH. */
export class OrcaNotConfiguredError extends Error {
  readonly code = 'not-configured' as const

  constructor(message: string) {
    super(message)
    this.name = 'OrcaNotConfiguredError'
  }
}

/**
 * The binary was found, but live spawn is off, so this package refuses to
 * spawn it. A stub must not look like a successful Run, Task, or Dispatch.
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

/**
 * The live CLI was spawned and did not exit 0, or the process could not be
 * started for a reason other than a missing binary. Stdout is not parsed
 * into ids. This error has no run id.
 */
export class OrcaSpawnError extends Error {
  readonly code = 'spawn-failed' as const
  readonly argv: readonly string[]
  readonly exitCode: number | null

  constructor(message: string, argv: readonly string[], exitCode: number | null) {
    super(message)
    this.name = 'OrcaSpawnError'
    this.argv = argv
    this.exitCode = exitCode
  }
}

/**
 * The process exited 0 and stdout was not the line protocol for that command.
 * No id is filled in from the caller or from a partial line.
 */
export class OrcaParseError extends Error {
  readonly code = 'unparseable' as const
  readonly argv: readonly string[]

  constructor(message: string, argv: readonly string[]) {
    super(message)
    this.name = 'OrcaParseError'
    this.argv = argv
  }
}
