import { describe, expect, it, vi } from 'vitest'
import { ActionWindowId, MatchId, SeatId } from '@deepseek-ai/dsh-game'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { createServer } from 'node:net'
import { AgentGameController, Config, apply } from '../src/index.ts'

const request = (overrides: Record<string, unknown> = {}) => ({
  matchId: MatchId('match'),
  windowId: ActionWindowId('match:window:1'),
  seat: {
    id: SeatId('ai'),
    displayName: 'AI',
    controller: { type: 'agent' as const, provider: 'provider', model: 'model' },
  },
  prompt: 'Choose.',
  actionSchema: { type: 'object' },
  ...overrides,
})

const toolContext = (registered?: (tool: ToolDefinition) => void) => ({
  tools: {
    register: (tool: ToolDefinition) => {
      registered?.(tool)
      return () => undefined
    },
  },
})

describe('Agent game action routing', () => {
  it('defaults and validates the per-request model output budget', () => {
    expect(Config({ playerInstruction: 'Play.' }).maxTokensPerRequest).toBe(16_384)
    expect(Config({
      playerInstruction: 'Play.', timeoutRetryReasoningEfforts: { provider: { model: 'high' } },
    }).timeoutRetryReasoningEfforts).toEqual({ provider: { model: 'high' } })
    expect(() => Config({ playerInstruction: 'Play.', maxTokensPerRequest: 0 })).toThrow()
    expect(() => Config({ playerInstruction: 'Play.', maxTokensPerRequest: 1.5 })).toThrow()
    expect(() => Config({ playerInstruction: 'Play.', timeoutRetryReasoningEfforts: { provider: { model: 1 as never } } })).toThrow()
  })

  it('routes a reused agent tool to each requested window instead of trusting model routing text', async () => {
    const matchId = MatchId('match')
    let windowId = ActionWindowId('match:window:1')
    const seatId = SeatId('ai')
    let tool: ToolDefinition | undefined
    const concludeTurn = vi.fn()
    let pending = Promise.resolve()
    const session = {}
    const listeners = new Set<(session: unknown, event: { type: string; data: { inserted: Array<{ id: unknown }> } }) => void>()
    const accepted = new Set<string>()
    const submit = vi.fn((request: { windowId: string; commandId: string }) => {
      accepted.add(request.windowId)
      return Promise.resolve({ revision: 3 })
    })
    const matches = {
      get: vi.fn(() => Promise.resolve({ window: { id: windowId, submittedSeats: accepted.has(windowId) ? [seatId] : [] } })),
      submit,
    }
    const agent = {
      id: 'game:match:ai',
      session,
      ctx: toolContext((definition) => { tool = definition }),
      followup: vi.fn((message: { id: unknown }) => {
        for (const listener of listeners) listener(session, { type: 'agent/inbox/spliced', data: { inserted: [message] } })
        pending = tool!.execute({ action: { choice: 'paper' } }, {
          callId: 'call', signal: new AbortController().signal, concludeTurn,
        } as never).then(() => undefined)
      }),
      whenIdle: vi.fn(() => pending),
    }
    const ctx = {
      matches,
      sessionPersistence: { list: () => Promise.resolve([]) },
      agents: {
        create: vi.fn(({ setup }: { setup: (ctx: unknown) => void }) => {
          setup({
            systemPrompt: { suppressRuntimeContext: vi.fn(), section: vi.fn() },
            tools: { register: (definition: ToolDefinition) => { tool = definition; return () => undefined } },
            effect: (install: () => () => void) => { install() },
            on: vi.fn(() => () => true),
          })
          return Promise.resolve({ agent, dispose: vi.fn() })
        }),
      },
      on: vi.fn((_event: string, listener: (
        session: unknown,
        event: { type: string; data: { inserted: Array<{ id: unknown }> } },
      ) => void) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      }),
    }
    const controller = new AgentGameController(ctx as never, {
      maxAttemptsPerAction: 2, maxTokensPerRequest: 4_096, playerInstruction: 'Play.',
    })

    await controller.drive({
      matchId,
      windowId,
      seat: { id: seatId, displayName: 'AI', controller: { type: 'agent', provider: 'provider', model: 'model' } },
      prompt: 'Choose.',
      actionSchema: { type: 'object' },
    })
    windowId = ActionWindowId('match:window:2')
    await controller.drive({
      matchId,
      windowId,
      seat: { id: seatId, displayName: 'AI', controller: { type: 'agent', provider: 'provider', model: 'model' } },
      prompt: 'Choose again.',
      actionSchema: { type: 'object' },
    })

    expect(tool?.parameters).toMatchObject({ required: ['action'], properties: { action: { type: 'object' } } })
    expect(tool?.parameters).not.toHaveProperty('properties.actionWindowId')
    expect(tool?.description).toBe('Submit your action for the active game window; the game rules determine who can observe it.')
    expect(submit).toHaveBeenNthCalledWith(1, expect.objectContaining({ matchId, windowId: 'match:window:1', seatId, action: { choice: 'paper' } }))
    expect(submit).toHaveBeenNthCalledWith(2, expect.objectContaining({ matchId, windowId: 'match:window:2', seatId, action: { choice: 'paper' } }))
    expect(submit.mock.calls[0]?.[0].commandId).not.toBe(submit.mock.calls[1]?.[0].commandId)
    expect(ctx.agents.create).toHaveBeenCalledOnce()
    expect(ctx.agents.create).toHaveBeenCalledWith(expect.objectContaining({
      agentOptions: { provider: 'provider', model: 'model', maxTokens: 4_096 },
    }))
    expect(concludeTurn).toHaveBeenCalledTimes(2)
    expect(ctx.on).toHaveBeenCalledTimes(2)
    expect(listeners.size).toBe(0)
    expect(agent.whenIdle.mock.invocationCallOrder[0]).toBeLessThan(agent.followup.mock.invocationCallOrder[0]!)
    await controller.close()
  })

  it('does not start new agent work after a match is cancelled', async () => {
    const create = vi.fn()
    const controller = new AgentGameController({ agents: { create } } as never, { maxAttemptsPerAction: 2, playerInstruction: 'Play.' })
    const matchId = MatchId('cancelled')
    await controller.cancel(matchId)
    await controller.drive({
      matchId,
      windowId: ActionWindowId('cancelled:window:1'),
      seat: { id: SeatId('ai'), displayName: 'AI', controller: { type: 'agent', provider: 'provider', model: 'model' } },
      prompt: 'Choose.', actionSchema: { type: 'object' },
    })
    expect(create).not.toHaveBeenCalled()
    await controller.close()
  })

  it('does not treat whole-agent idle as completion before the request is durably received', async () => {
    const agent = {
      id: 'game:match:ai',
      session: {},
      ctx: toolContext(),
      followup: vi.fn(),
      whenIdle: vi.fn(() => Promise.resolve()),
    }
    const controller = new AgentGameController({
      on: vi.fn(() => () => undefined),
      matches: { get: vi.fn(() => Promise.resolve({ window: { id: 'match:window:1', submittedSeats: [] } })) },
      sessionPersistence: { list: () => Promise.resolve([]) },
      agents: { create: vi.fn(() => Promise.resolve({ agent, dispose: vi.fn() })) },
    } as never, { maxAttemptsPerAction: 1, playerInstruction: 'Play.' })

    await expect(controller.drive({
      matchId: MatchId('match'),
      windowId: ActionWindowId('match:window:1'),
      seat: { id: SeatId('ai'), displayName: 'AI', controller: { type: 'agent', provider: 'provider', model: 'model' } },
      prompt: 'Choose.', actionSchema: { type: 'object' },
    })).rejects.toThrow(/did not durably receive game request/)
    expect(agent.whenIdle).toHaveBeenCalledOnce()
    await controller.close()
  })

  it('validates exact agent models and rejects human controller specifications', async () => {
    const resolveModelInfo = vi.fn(() => Promise.resolve({}))
    const controller = new AgentGameController({ llm: { resolveModelInfo } } as never, {
      maxAttemptsPerAction: 1, playerInstruction: 'Play.',
    })
    await expect(controller.validate({ type: 'human' })).rejects.toThrow(/requires an agent seat/)
    await expect(controller.validate({ type: 'agent', provider: 'p', model: 'm' })).resolves.toBeUndefined()
    expect(resolveModelInfo).toHaveBeenCalledWith('p', 'm')

    const reasoning = { efforts: [{ id: ReasoningEffortId('high'), name: 'High' }] }
    const retryController = new AgentGameController({
      llm: { resolveModelInfo: vi.fn(() => Promise.resolve({ reasoning })) },
    } as never, {
      maxAttemptsPerAction: 1, playerInstruction: 'Play.', timeoutRetryReasoningEfforts: { p: { m: 'high' } },
    })
    await expect(retryController.validate({ type: 'agent', provider: 'p', model: 'm' })).resolves.toBeUndefined()

    const unsupported = new AgentGameController({
      llm: { resolveModelInfo: vi.fn(() => Promise.resolve({ reasoning })) },
    } as never, {
      maxAttemptsPerAction: 1, playerInstruction: 'Play.', timeoutRetryReasoningEfforts: { p: { m: 'low' } },
    })
    await expect(unsupported.validate({ type: 'agent', provider: 'p', model: 'm' }))
      .rejects.toThrow(/does not support timeout retry reasoning effort 'low'/)
  })

  it('uses the timeout retry effort configured for the exact provider and model', async () => {
    const listeners = new Map<string, (...args: never[]) => unknown>()
    const dispose = vi.fn(() => Promise.resolve())
    const controller = new AgentGameController({
      matches: { get: vi.fn(() => Promise.resolve(undefined)) },
      sessionPersistence: { list: () => Promise.resolve([]) },
      agents: { create: vi.fn(({ setup }: { setup: (ctx: unknown) => void }) => {
        setup({
          systemPrompt: { suppressRuntimeContext: vi.fn(), section: vi.fn() },
          on: (event: string, listener: (...args: never[]) => unknown) => {
            listeners.set(event, listener)
            return () => true
          },
        })
        return Promise.resolve({
          agent: { id: 'agent', session: {}, ctx: toolContext(), whenIdle: () => Promise.resolve() },
          dispose,
        })
      }) },
    } as never, {
      maxAttemptsPerAction: 1,
      playerInstruction: 'Play.',
      timeoutRetryReasoningEfforts: { provider: { model: 'low' }, other: { model: 'high' } },
    })

    await controller.drive(request())
    await listeners.get('agent/request-error')!({ failure: { code: 'TIMEOUT' } } as never, (() => Promise.resolve()) as never)
    await expect(listeners.get('agent/request')!(undefined as never, (() => Promise.resolve({
      reasoningEffort: ReasoningEffortId('high'),
    })) as never)).resolves.toEqual({ reasoningEffort: ReasoningEffortId('low') })
    await controller.close()
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('reports model and Host route availability before match creation', async () => {
    const resolved = new AgentGameController({ llm: { resolveModelInfo: vi.fn(() => Promise.resolve({})) } } as never, {
      maxAttemptsPerAction: 1,
      playerInstruction: 'Play.',
      providerProbes: { lan: { endpoint: 'http://127.0.0.1:1', timeoutMs: 100 } },
    })
    await expect(resolved.availability({ type: 'agent', provider: 'cloud', model: 'm' }))
      .resolves.toEqual({ available: true })
    const unavailable = await resolved.availability({ type: 'agent', provider: 'lan', model: 'm' })
    expect(unavailable.available).toBe(false)
    expect(unavailable.message).toContain('unreachable from this game host')

    const unresolved = new AgentGameController({
      llm: { resolveModelInfo: vi.fn(() => Promise.reject(new Error('unknown model'))) },
    } as never, { maxAttemptsPerAction: 1, playerInstruction: 'Play.' })
    await expect(unresolved.availability({ type: 'agent', provider: 'missing', model: 'm' }))
      .resolves.toEqual({ available: false, message: 'unknown model' })

    const stringFailure = new AgentGameController({
      // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- provider integrations may reject with unknown values.
      llm: { resolveModelInfo: vi.fn(() => Promise.reject('unknown route')) },
    } as never, { maxAttemptsPerAction: 1, playerInstruction: 'Play.' })
    await expect(stringFailure.availability({ type: 'agent', provider: 'missing', model: 'm' }))
      .resolves.toEqual({ available: false, message: 'unknown route' })
  })

  it('accepts a reachable Host route and applies endpoint defaults', async () => {
    const server = createServer((socket) => { socket.end() })
    await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
    try {
      const address = server.address()
      if (address === null || typeof address === 'string') throw new Error('expected an ephemeral TCP port')
      const controller = new AgentGameController({
        llm: { resolveModelInfo: vi.fn(() => Promise.resolve({})) },
      } as never, {
        maxAttemptsPerAction: 1,
        playerInstruction: 'Play.',
        providerProbes: { local: { endpoint: `http://127.0.0.1:${address.port}` } },
      })
      await expect(controller.availability({ type: 'agent', provider: 'local', model: 'm' }))
        .resolves.toEqual({ available: true })
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => { if (error === undefined) resolve(); else reject(error) })
      })
    }

    for (const endpoint of ['http://127.0.0.1', 'https://127.0.0.1']) {
      const controller = new AgentGameController({
        llm: { resolveModelInfo: vi.fn(() => Promise.resolve({})) },
      } as never, {
        maxAttemptsPerAction: 1,
        playerInstruction: 'Play.',
        providerProbes: { local: { endpoint, timeoutMs: 100 } },
      })
      await expect(controller.availability({ type: 'agent', provider: 'local', model: 'm' }))
        .resolves.toMatchObject({ available: false })
    }
  })

  it('times out a Host route that never settles', async () => {
    vi.useFakeTimers()
    try {
      const controller = new AgentGameController({
        llm: { resolveModelInfo: vi.fn(() => Promise.resolve({})) },
      } as never, {
        maxAttemptsPerAction: 1,
        playerInstruction: 'Play.',
        providerProbes: { local: { endpoint: 'http://192.0.2.1:81', timeoutMs: 100 } },
      })
      const availability = controller.availability({ type: 'agent', provider: 'local', model: 'm' })
      await vi.advanceTimersByTimeAsync(100)
      const result = await availability
      expect(result.available).toBe(false)
      expect(result.message).toContain('timed out after 100 ms')
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects new work after close and rejects a human-controlled drive request', async () => {
    const closed = new AgentGameController({} as never, { maxAttemptsPerAction: 1, playerInstruction: 'Play.' })
    await closed.close()
    await expect(closed.drive(request())).rejects.toThrow(/closed/)

    const human = new AgentGameController({} as never, { maxAttemptsPerAction: 1, playerInstruction: 'Play.' })
    await expect(human.drive(request({
      seat: { id: SeatId('human'), displayName: 'Human', controller: { type: 'human' } },
    }))).rejects.toThrow(/not agent-controlled/)
    await human.close()
  })

  it('retries a received request and fails when no action is submitted', async () => {
    const session = {}
    const listeners = new Set<(seen: unknown, event: { type: string; data: { inserted: Array<{ id: unknown }> } }) => void>()
    const agent = {
      id: 'agent', session, ctx: toolContext(),
      followup: vi.fn((message: { id: unknown }) => {
        for (const listener of listeners) listener({}, { type: 'agent/inbox/spliced', data: { inserted: [message] } })
        for (const listener of listeners) listener(session, { type: 'other', data: { inserted: [message] } })
        for (const listener of listeners) listener(session, {
          type: 'agent/inbox/spliced', data: { inserted: [{ id: 'different' }] },
        })
        for (const listener of listeners) listener(session, { type: 'agent/inbox/spliced', data: { inserted: [message] } })
      }),
      whenIdle: vi.fn(() => Promise.resolve()),
    }
    const controller = new AgentGameController({
      on: vi.fn((_event: string, listener: (seen: unknown, event: never) => void) => {
        listeners.add(listener as never)
        return () => { listeners.delete(listener as never) }
      }),
      matches: { get: () => Promise.resolve({ window: { id: 'match:window:1', submittedSeats: [] } }) },
      sessionPersistence: { list: () => Promise.resolve([]) },
      agents: { create: () => Promise.resolve({ agent, dispose: vi.fn() }) },
    } as never, { maxAttemptsPerAction: 2, playerInstruction: 'Play.' })
    await expect(controller.drive(request())).rejects.toThrow(/did not submit an action/)
    expect(agent.followup).toHaveBeenCalledTimes(2)
    await controller.close()
  })

  it('stops without prompting when the window moved or the seat already submitted', async () => {
    for (const current of [
      { window: { id: 'other', submittedSeats: [] } },
      { window: { id: 'match:window:1', submittedSeats: [SeatId('ai')] } },
      undefined,
    ]) {
      const agent = { id: 'agent', session: {}, ctx: toolContext(), followup: vi.fn(), whenIdle: vi.fn(() => Promise.resolve()) }
      const controller = new AgentGameController({
        matches: { get: () => Promise.resolve(current) },
        sessionPersistence: { list: () => Promise.resolve([]) },
        agents: { create: () => Promise.resolve({ agent, dispose: vi.fn() }) },
      } as never, { maxAttemptsPerAction: 1, playerInstruction: 'Play.' })
      await expect(controller.drive(request())).resolves.toBeUndefined()
      expect(agent.followup).not.toHaveBeenCalled()
      await controller.close()
    }
  })

  it('resumes persisted seat sessions and exposes safe tool failure and rendering paths', async () => {
    let tool: ToolDefinition | undefined
    const session = {}
    const listeners = new Set<(seen: unknown, event: { type: string; data: { inserted: Array<{ id: unknown }> } }) => void>()
    let pending = Promise.resolve()
    const concludeTurn = vi.fn()
    const agent = {
      id: 'agent', session, ctx: toolContext((definition) => { tool = definition }),
      followup: vi.fn((message: { id: unknown }) => {
        for (const listener of listeners) listener(session, { type: 'agent/inbox/spliced', data: { inserted: [message] } })
        pending = tool!.execute({ action: { choice: 'rock' } }, {
          callId: 'call', signal: new AbortController().signal, concludeTurn,
        } as never).then(() => undefined)
      }),
      whenIdle: vi.fn(() => pending),
    }
    const dispose = vi.fn(() => Promise.resolve())
    const resume = vi.fn(({ setup }: { setup: (ctx: unknown) => void }) => {
      setup({
        systemPrompt: { suppressRuntimeContext: vi.fn(), section: vi.fn() },
        tools: { register: (definition: ToolDefinition) => { tool = definition; return () => undefined } },
        effect: (install: () => () => void) => { install() },
        on: vi.fn(() => () => true),
      })
      return Promise.resolve({ agent, dispose })
    })
    let accepted = false
    const matches = {
      get: vi.fn(() => Promise.resolve({
        window: { id: 'match:window:1', submittedSeats: accepted ? [SeatId('ai')] : [] },
      })),
      submit: vi.fn(() => {
        if (accepted) return Promise.reject(new Error('action window is closed'))
        accepted = true
        return Promise.resolve({ revision: 7 })
      }),
    }
    const controller = new AgentGameController({
      on: vi.fn((_event: string, listener: (seen: unknown, event: never) => void) => {
        listeners.add(listener as never)
        return () => { listeners.delete(listener as never) }
      }),
      matches,
      sessionPersistence: { list: () => Promise.resolve([{ id: 'game:match:ai' }]) },
      agents: { resume },
    } as never, { maxAttemptsPerAction: 1, maxTokensPerRequest: 2_048, playerInstruction: 'Play.' })
    await controller.drive(request())
    expect(resume).toHaveBeenCalledOnce()
    expect(resume).toHaveBeenCalledWith(expect.objectContaining({
      agentOptions: { provider: 'provider', model: 'model', maxTokens: 2_048 },
    }))
    expect(concludeTurn).toHaveBeenCalledOnce()
    expect(tool!.output.render({}, { accepted: true, revision: 7 })).toEqual([
      { type: 'text', text: 'Action accepted at match revision 7.' },
    ])
    await expect(tool!.execute({ action: {} }, {
      callId: 'late', signal: new AbortController().signal, concludeTurn: vi.fn(),
    } as never)).rejects.toThrow(/action window is closed/)
    const aborted = new AbortController()
    aborted.abort(new Error('stop'))
    await expect(tool!.execute({ action: {} }, {
      callId: 'abort', signal: aborted.signal, concludeTurn: vi.fn(),
    } as never)).rejects.toThrow('stop')
    await controller.cancel(MatchId('match'))
    expect(dispose).toHaveBeenCalledOnce()
    await controller.close()
  })

  it('registers the provider and closes it during plugin disposal', async () => {
    let cleanup: (() => Promise<void>) | undefined
    const dispose = vi.fn()
    const ctx = {
      gameControllers: { register: vi.fn(() => dispose) },
      effect: (install: () => () => Promise<void>) => { cleanup = install() },
    }
    apply(ctx as never, { maxAttemptsPerAction: 1, playerInstruction: 'Play.' })
    expect(ctx.gameControllers.register).toHaveBeenCalledWith('agent', expect.any(AgentGameController))
    await cleanup!()
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('deduplicates one window and serializes later windows for the same seat', async () => {
    let release!: () => void
    let waits = 0
    const gate = new Promise<void>((resolve) => { release = resolve })
    const agent = {
      id: 'agent', session: {}, ctx: toolContext(), followup: vi.fn(),
      whenIdle: vi.fn(() => waits++ === 0 ? gate : Promise.resolve()),
    }
    const controller = new AgentGameController({
      matches: { get: () => Promise.resolve(undefined) },
      sessionPersistence: { list: () => Promise.resolve([]) },
      agents: { create: () => Promise.resolve({ agent, dispose: vi.fn() }) },
    } as never, { maxAttemptsPerAction: 1, playerInstruction: 'Play.' })
    const first = controller.drive(request())
    await Promise.resolve()
    await expect(controller.drive(request())).resolves.toBeUndefined()
    const second = controller.drive(request({ windowId: ActionWindowId('match:window:2') }))
    release()
    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined])
    expect(agent.whenIdle).toHaveBeenCalledTimes(2)
    await controller.close()
  })

  it('observes cancellation that lands while a seat waits for idle', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const dispose = vi.fn(() => Promise.resolve())
    const controller = new AgentGameController({
      matches: { get: vi.fn() },
      sessionPersistence: { list: () => Promise.resolve([]) },
      agents: { create: () => Promise.resolve({
        agent: { id: 'agent', session: {}, ctx: toolContext(), followup: vi.fn(), whenIdle: () => gate },
        dispose,
      }) },
    } as never, { maxAttemptsPerAction: 1, playerInstruction: 'Play.' })
    const driving = controller.drive(request())
    await Promise.resolve()
    await Promise.resolve()
    const cancelling = controller.cancel(MatchId('match'))
    release()
    await expect(Promise.all([driving, cancelling])).resolves.toEqual([undefined, undefined])
    expect(dispose).toHaveBeenCalledOnce()
    await controller.close()
  })

  it('continues a queued window after the preceding window rejects', async () => {
    let reads = 0
    const agent = { id: 'agent', session: {}, ctx: toolContext(), followup: vi.fn(), whenIdle: vi.fn(() => Promise.resolve()) }
    const controller = new AgentGameController({
      on: vi.fn(() => () => undefined),
      matches: { get: () => Promise.resolve(reads++ === 0
        ? { window: { id: 'match:window:1', submittedSeats: [] } }
        : undefined) },
      sessionPersistence: { list: () => Promise.resolve([]) },
      agents: { create: () => Promise.resolve({ agent, dispose: vi.fn() }) },
    } as never, { maxAttemptsPerAction: 1, playerInstruction: 'Play.' })
    const first = controller.drive(request())
    const second = controller.drive(request({ windowId: ActionWindowId('match:window:2') }))
    await expect(first).rejects.toThrow(/did not durably receive/)
    await expect(second).resolves.toBeUndefined()
    await controller.close()
  })

  it('closes cleanly when agent creation rejects while work is pending', async () => {
    let rejectOpen!: (error: Error) => void
    const opening = new Promise<never>((_resolve, reject) => { rejectOpen = reject })
    const create = vi.fn(() => opening)
    const controller = new AgentGameController({
      sessionPersistence: { list: () => Promise.resolve([]) },
      agents: { create },
    } as never, { maxAttemptsPerAction: 1, playerInstruction: 'Play.' })
    const driving = controller.drive(request())
    while (create.mock.calls.length === 0) await Promise.resolve()
    const closing = controller.close()
    rejectOpen(new Error('open failed'))
    await expect(driving).rejects.toThrow('open failed')
    await expect(closing).resolves.toBeUndefined()
  })

  it('starts no queued window after its match is cancelled', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const agent = { id: 'agent', session: {}, ctx: toolContext(), followup: vi.fn(), whenIdle: () => gate }
    const controller = new AgentGameController({
      sessionPersistence: { list: () => Promise.resolve([]) },
      agents: { create: () => Promise.resolve({ agent, dispose: () => Promise.resolve() }) },
    } as never, { maxAttemptsPerAction: 1, playerInstruction: 'Play.' })
    const first = controller.drive(request())
    const second = controller.drive(request({ windowId: ActionWindowId('match:window:2') }))
    await Promise.resolve()
    await Promise.resolve()
    const cancelling = controller.cancel(MatchId('match'))
    release()
    await expect(Promise.all([first, second, cancelling])).resolves.toEqual([undefined, undefined, undefined])
    await controller.close()
  })

  it('cancels a seat whose agent creation rejects', async () => {
    let rejectOpen!: (error: Error) => void
    const opening = new Promise<never>((_resolve, reject) => { rejectOpen = reject })
    const create = vi.fn(() => opening)
    const controller = new AgentGameController({
      sessionPersistence: { list: () => Promise.resolve([]) },
      agents: { create },
    } as never, { maxAttemptsPerAction: 1, playerInstruction: 'Play.' })
    const driving = controller.drive(request())
    while (create.mock.calls.length === 0) await Promise.resolve()
    const cancelling = controller.cancel(MatchId('match'))
    rejectOpen(new Error('open failed'))
    await expect(driving).rejects.toThrow('open failed')
    await expect(cancelling).resolves.toBeUndefined()
    await controller.close()
  })

  it('removes only immediately scheduled work owned by the cancelled match', async () => {
    const controller = new AgentGameController({} as never, {
      maxAttemptsPerAction: 1, playerInstruction: 'Play.',
    })
    const first = controller.drive(request({ matchId: MatchId('first') }))
    const second = controller.drive(request({ matchId: MatchId('second') }))
    const cancelFirst = controller.cancel(MatchId('first'))
    const cancelSecond = controller.cancel(MatchId('second'))
    await Promise.all([cancelFirst, cancelSecond])
    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined])
    await controller.close()
  })
})
