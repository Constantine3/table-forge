import { describe, expect, it } from 'vitest'
import { formatProfileStartupDiagnostic } from '../src/startup-diagnostic.ts'

describe('formatProfileStartupDiagnostic', () => {
  it('finds a Node listen conflict through Loader wrappers and gives shipped Web profiles a retry', () => {
    const conflict = Object.assign(new Error('address already in use'), {
      code: 'EADDRINUSE',
      syscall: 'listen',
      address: '127.0.0.1',
      port: 3080,
    })
    const failure = new Error('plugin tree failed to load', {
      cause: new Error('failed to apply loader entry', { cause: conflict }),
    })

    expect(formatProfileStartupDiagnostic('game', failure)).toBe([
      'dsh: cannot start profile "game": 127.0.0.1:3080 is already in use.',
      'Stop the process using that address, or choose another port: dsh game --port <port>',
    ].join('\n'))
  })

  it('renders IPv6 authorities and gives custom profiles configuration guidance', () => {
    const conflict = {
      code: 'EADDRINUSE',
      syscall: 'listen',
      address: '::1',
      port: '4100',
    }
    expect(formatProfileStartupDiagnostic('custom', conflict)).toBe([
      'dsh: cannot start profile "custom": [::1]:4100 is already in use.',
      'Stop the process using that address, or configure a different listen address for this profile.',
    ].join('\n'))
  })

  it('leaves unknown failures and non-listen address collisions unchanged', () => {
    expect(formatProfileStartupDiagnostic('game', new Error('activation failed'))).toBeUndefined()
    expect(formatProfileStartupDiagnostic('game', {
      code: 'EADDRINUSE',
      syscall: 'bind',
      address: '127.0.0.1',
      port: 3080,
    })).toBeUndefined()
  })

  it('stops at a cyclic cause chain', () => {
    const cyclic: { cause?: unknown } = {}
    cyclic.cause = cyclic
    expect(formatProfileStartupDiagnostic('game', cyclic)).toBeUndefined()
  })
})
