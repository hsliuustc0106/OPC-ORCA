import { accessSync, constants } from 'node:fs'
import path from 'node:path'

export interface ResolveOptions {
  env?: { PATH?: string | undefined }
  platform?: string
}

/**
 * Prefer an executable named `orca` on PATH.
 * On Linux only, fall back to `orca-ide` when `orca` is absent.
 * Does not spawn anything.
 */
export function resolveOrcaExecutable(options: ResolveOptions = {}): string | null {
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform
  const names = platform === 'linux' ? ['orca', 'orca-ide'] : ['orca']
  const dirs = (env.PATH ?? '').split(path.delimiter).filter((dir) => dir.length > 0)

  for (const name of names) {
    for (const dir of dirs) {
      const candidate = path.join(dir, name)
      try {
        accessSync(candidate, constants.X_OK)
        return candidate
      } catch {
        continue
      }
    }
  }
  return null
}
