import { spawn } from 'node:child_process'

/**
 * The only `node:child_process` import in this repo.
 * Live spawn calls this with `shell: false` so flag values are not a shell
 * command. Dry-run must not call it. This function does not read stdout for
 * ids and does not invent a run id, task id, worker id, or exit code 0.
 */
export interface SpawnedOrca {
  stdout: string
  stderr: string
  /** `null` when the process ended on a signal. */
  exitCode: number | null
}

export function spawnOrca(bin: string, args: readonly string[]): Promise<SpawnedOrca> {
  return new Promise((resolve, reject) => {
    let settled = false
    const child = spawn(bin, [...args], {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    if (!child.stdout || !child.stderr) {
      child.kill()
      reject(new Error(`spawn did not pipe stdio for ${bin}`))
      return
    }
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => {
      stdout.push(chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr.push(chunk)
    })
    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      fn()
    }
    child.once('error', (error: Error) => {
      finish(() => reject(error))
    })
    child.once('close', (code) => {
      finish(() =>
        resolve({
          stdout: Buffer.concat(stdout).toString('utf8'),
          stderr: Buffer.concat(stderr).toString('utf8'),
          exitCode: code,
        }),
      )
    })
  })
}
