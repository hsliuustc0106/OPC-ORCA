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
 * Live spawn was about to call a verb that needs a coordinator terminal,
 * and neither `from` nor `ORCA_TERMINAL_HANDLE` supplied a handle.
 * Nothing was spawned. This error has no run id and no invented handle.
 */
export class OrcaNoSenderError extends Error {
  readonly code = 'no-sender' as const

  constructor(message: string) {
    super(message)
    this.name = 'OrcaNoSenderError'
  }
}

/**
 * Live `worker-start` needs a desktop `--agent` id. Neither `OPC_ORCA_AGENT`
 * nor adapter `agent` supplied one that Orca 1.4.240 help lists. Nothing was
 * spawned. This error has no agent id and no dispatch id.
 */
export class OrcaNoAgentError extends Error {
  readonly code = 'no-agent' as const

  constructor(message: string) {
    super(message)
    this.name = 'OrcaNoAgentError'
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
 * The process exited 0 and stdout was not the `--json` envelope for that
 * command. No id is filled in from the caller, from prose, or from the
 * envelope `id`.
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
