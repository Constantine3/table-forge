/**
 * User-facing diagnostics for recognized profile startup failures. Unknown
 * failures stay unformatted so the command entry can preserve their stacks.
 * @module @deepseek-ai/dsh/startup-diagnostic
 */

interface ListenConflict {
  address?: string
  port?: number | string
}

function inspectable(value: unknown): Record<PropertyKey, unknown> | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  return value as Record<PropertyKey, unknown>
}

function findListenConflict(error: unknown): ListenConflict | undefined {
  const visited = new Set<object>()
  let current: unknown = error
  while (true) {
    const candidate = inspectable(current)
    if (candidate === undefined || visited.has(candidate)) return undefined
    visited.add(candidate)
    if (candidate.code === 'EADDRINUSE' && candidate.syscall === 'listen') {
      return {
        ...typeof candidate.address === 'string' ? { address: candidate.address } : {},
        ...typeof candidate.port === 'number' || typeof candidate.port === 'string'
          ? { port: candidate.port }
          : {},
      }
    }
    current = candidate.cause
  }
}

function renderListenAddress(conflict: ListenConflict): string {
  if (conflict.address !== undefined && conflict.port !== undefined) {
    const address = conflict.address.includes(':') ? `[${conflict.address}]` : conflict.address
    return `${address}:${String(conflict.port)}`
  }
  if (conflict.address !== undefined) return conflict.address
  if (conflict.port !== undefined) return `port ${String(conflict.port)}`
  return 'the requested listen address'
}

/**
 * Format a recognized profile startup failure for stderr.
 * @param profile - profile whose plugin tree was being started.
 * @param error - rejected startup value.
 * @returns an actionable diagnostic for a listen-address conflict, otherwise `undefined`.
 */
export function formatProfileStartupDiagnostic(profile: string, error: unknown): string | undefined {
  const conflict = findListenConflict(error)
  if (conflict === undefined) return undefined
  const address = renderListenAddress(conflict)
  const retry = profile === 'game' || profile === 'web'
    ? `Stop the process using that address, or choose another port: dsh ${profile} --port <port>`
    : 'Stop the process using that address, or configure a different listen address for this profile.'
  return `dsh: cannot start profile ${JSON.stringify(profile)}: ${address} is already in use.\n${retry}`
}
