/** Agent-backed game controller with one isolated Session per AI seat. @module @deepseek-ai/dsh-game-controller-agent */

import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import { GameCommandId, type GameControllerProvider, type GameControllerRequest, type MatchId, type SeatControllerSpec } from '@deepseek-ai/dsh-game'
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type { JsonValue, ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'
import { connect } from 'node:net'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    game: { kind: 'game'; matchId: string; seatId: string; actionWindowId: string }
  }
}

const probeEndpoint = (endpoint: string, timeoutMs: number): Promise<void> => {
  const url = new URL(endpoint)
  const port = url.port === '' ? url.protocol === 'https:' ? 443 : 80 : Number(url.port)
  return new Promise<void>((resolve, reject) => {
    const socket = connect({ host: url.hostname, port })
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error(`connection timed out after ${timeoutMs} ms`))
    }, timeoutMs)
    const settle = (operation: () => void): void => {
      clearTimeout(timer)
      socket.destroy()
      operation()
    }
    socket.once('connect', () => { settle(resolve) })
    socket.once('error', (error) => { settle(() => { reject(error) }) })
  })
}

/** Host-side reachability probe for one provider route. */
export interface ProviderProbeConfig {
  /** HTTP endpoint whose host and port must accept a TCP connection. */
  endpoint: string
  /** Maximum connection time before the route is unavailable. */
  timeoutMs?: number
}

/** Retry, instruction, and Host reachability policy for AI seats. */
export interface Config {
  /** Maximum model turns allowed for one action window before the seat remains pending. */
  maxAttemptsPerAction?: number
  /** Complete system instruction used by every isolated AI player. */
  playerInstruction: string
  /** Host-side TCP probes keyed by provider route; omitted routes rely on model resolution only. */
  providerProbes?: Record<string, ProviderProbeConfig>
}

/** Schemastery validator for {@link Config}. */
export const Config: z<Config> = z.object({
  maxAttemptsPerAction: z.number().min(1).step(1).default(2),
  playerInstruction: z.string().required(),
  providerProbes: z.dict(z.object({
    endpoint: z.string().required(),
    timeoutMs: z.number().min(100).step(1).default(2000),
  })).default({}),
})

/** Provider that owns live AI-seat agents and submits their accepted tool calls. */
export class AgentGameController implements GameControllerProvider {
  private readonly handles = new Map<string, Promise<AgentHandle>>()
  private readonly tails = new Map<string, Promise<void>>()
  private readonly scheduled = new Set<string>()
  private readonly activeRequests = new Map<string, GameControllerRequest>()
  private readonly cancelledMatches = new Set<MatchId>()
  private closed = false

  constructor(
    private readonly ctx: Context,
    private readonly config: Required<Pick<Config, 'maxAttemptsPerAction' | 'playerInstruction'>> & Pick<Config, 'providerProbes'>,
  ) {}

  /** Confirm that a configured AI seat resolves to a live provider and model.
   * @param controller - proposed controller specification.
   * @returns completion after exact model resolution.
   */
  async validate(controller: SeatControllerSpec): Promise<void> {
    if (controller.type !== 'agent') throw new Error('the agent controller requires an agent seat')
    await this.ctx.llm.resolveModelInfo(controller.provider, controller.model)
  }

  /** Resolve a model and, when configured, probe its route from the game Host.
   * @param controller - proposed controller specification.
   * @returns whether the Host can start this AI seat, with an operator-facing failure message.
   */
  async availability(controller: SeatControllerSpec): Promise<{ readonly available: boolean; readonly message?: string }> {
    try {
      await this.validate(controller)
    } catch (error) {
      return { available: false, message: error instanceof Error ? error.message : String(error) }
    }
    if (controller.type !== 'agent') return { available: false, message: 'the agent controller requires an agent seat' }
    const probe = this.config.providerProbes?.[controller.provider]
    if (probe === undefined) return { available: true }
    try {
      await probeEndpoint(probe.endpoint, probe.timeoutMs ?? 2000)
      return { available: true }
    } catch (error) {
      return {
        available: false,
        message: `Provider ${controller.provider} is unreachable from this game host: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  }

  async drive(request: GameControllerRequest): Promise<void> {
    if (this.closed) throw new Error('the agent game controller is closed')
    if (this.cancelledMatches.has(request.matchId)) return
    const seatKey = `${request.matchId}:${request.seat.id}`
    const windowKey = `${seatKey}:${request.windowId}`
    if (this.scheduled.has(windowKey)) return
    this.scheduled.add(windowKey)
    const previous = this.tails.get(seatKey) ?? Promise.resolve()
    const run = previous.catch(() => undefined).then(() => this.driveWindow(request))
    this.tails.set(seatKey, run)
    try {
      await run
    } finally {
      this.scheduled.delete(windowKey)
      if (this.tails.get(seatKey) === run) this.tails.delete(seatKey)
    }
  }

  private async driveWindow(request: GameControllerRequest): Promise<void> {
    if (this.cancelledMatches.has(request.matchId)) return
    const seatKey = `${request.matchId}:${request.seat.id}`
    this.activeRequests.set(seatKey, request)
    try {
      const handle = await this.agentFor(request)
      for (let attempt = 1; attempt <= this.config.maxAttemptsPerAction; attempt += 1) {
        await handle.agent.whenIdle()
        if (this.cancelledMatches.has(request.matchId)) return
        const current = await this.ctx.matches.get(request.matchId)
        if (current?.window?.id !== request.windowId || current.window.submittedSeats.includes(request.seat.id)) return
        const message = createUserMessage({
          content: [{ type: 'text', text: `${request.prompt}\n\nSubmit an action with submit_game_action. This request is bound to window ${request.windowId}. This is attempt ${attempt} of ${this.config.maxAttemptsPerAction}.` }],
          source: { kind: 'game', matchId: request.matchId, seatId: request.seat.id, actionWindowId: request.windowId },
        })
        await this.runAttempt(handle, message)
      }
      const current = await this.ctx.matches.get(request.matchId)
      if (current?.window?.id === request.windowId && !current.window.submittedSeats.includes(request.seat.id)) {
        throw new Error(`AI seat '${request.seat.id}' did not submit an action for '${request.windowId}'`)
      }
    } finally {
      /* v8 ignore else -- per-seat serialization prevents another request from replacing the active entry before cleanup. */
      if (this.activeRequests.get(seatKey) === request) this.activeRequests.delete(seatKey)
    }
  }

  private async runAttempt(handle: AgentHandle, message: UserMessage): Promise<void> {
    const receipt = { received: false }
    const dispose = this.ctx.on('session/event', (session, event) => {
      if (session !== handle.agent.session || event.type !== 'agent/inbox/spliced') return
      if (event.data.inserted.some(inserted => inserted.id === message.id)) receipt.received = true
    })
    try {
      handle.agent.followup(message)
      if (!receipt.received) throw new Error(`agent '${handle.agent.id}' did not durably receive game request '${message.id}'`)
      await handle.agent.whenIdle()
    } finally {
      dispose()
    }
  }

  /** Dispose every AI agent owned by this provider. */
  async close(): Promise<void> {
    this.closed = true
    const handles = await Promise.all([...this.handles.values()].map(handle => handle.catch(() => undefined)))
    await Promise.all(handles.flatMap(handle => handle === undefined ? [] : [handle.dispose()]))
    await Promise.allSettled([...this.tails.values()])
    this.handles.clear()
    this.tails.clear()
    this.scheduled.clear()
    this.activeRequests.clear()
    this.cancelledMatches.clear()
  }

  /** Stop and drain every AI seat owned by one match. */
  async cancel(matchId: MatchId): Promise<void> {
    this.cancelledMatches.add(matchId)
    const prefix = `${matchId}:`
    const keys = [...this.handles.keys()].filter(key => key.startsWith(prefix))
    const pendingHandles = keys.flatMap((key) => {
      const handle = this.handles.get(key)
      /* v8 ignore next -- keys is a synchronous snapshot of this same Map. */
      return handle === undefined ? [] : [handle]
    })
    const handles = await Promise.all(pendingHandles.map(handle => handle.catch(() => undefined)))
    await Promise.all(handles.flatMap(handle => handle === undefined ? [] : [handle.dispose()]))
    await Promise.allSettled(keys.flatMap((key) => {
      const tail = this.tails.get(key)
      return tail === undefined ? [] : [tail]
    }))
    for (const key of keys) {
      this.handles.delete(key)
      this.tails.delete(key)
      this.activeRequests.delete(key)
    }
    for (const key of this.scheduled) if (key.startsWith(prefix)) this.scheduled.delete(key)
  }

  private agentFor(request: GameControllerRequest): Promise<AgentHandle> {
    /* v8 ignore next -- drive and driveWindow both reject cancellation before agentFor is reached. */
    if (this.cancelledMatches.has(request.matchId)) return Promise.reject(new Error(`match '${request.matchId}' is cancelled`))
    const key = `${request.matchId}:${request.seat.id}`
    const existing = this.handles.get(key)
    if (existing !== undefined) return existing
    if (request.seat.controller.type !== 'agent') return Promise.reject(new Error(`seat '${request.seat.id}' is not agent-controlled`))
    const pending = this.openAgent(request)
    this.handles.set(key, pending)
    pending.catch(() => this.handles.delete(key))
    return pending
  }

  private async openAgent(request: GameControllerRequest): Promise<AgentHandle> {
    /* v8 ignore next -- agentFor rejects human seats before calling openAgent. */
    if (request.seat.controller.type !== 'agent') throw new Error(`seat '${request.seat.id}' is not agent-controlled`)
    const spec = request.seat.controller
    const seatKey = `${request.matchId}:${request.seat.id}`
    const sessionId = SessionId(`game:${request.matchId}:${request.seat.id}`)
    const setup = (agentCtx: Context): void => {
      agentCtx.systemPrompt.suppressRuntimeContext()
      agentCtx.systemPrompt.section({
        name: 'game:player',
        order: -50,
        text: `You are ${request.seat.displayName}, an AI player in a deterministic game.\n${this.config.playerInstruction}`,
        complete: true,
      })
      const tool: ToolDefinition = {
        name: 'submit_game_action',
        description: 'Submit your private action for the active game window.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          required: ['action'],
          properties: {
            action: request.actionSchema,
          },
        },
        output: {
          schema: {
            type: 'object', additionalProperties: false, required: ['accepted', 'revision'],
            properties: { accepted: { type: 'boolean' }, revision: { type: 'integer' } },
          },
          render: (_args: unknown, value: JsonValue) => [{ type: 'text', text: `Action accepted at match revision ${(value as { revision: number }).revision}.` }],
        },
        execute: async (args: unknown, exec: ToolRunContext) => {
          if (exec.signal.aborted) throw exec.signal.reason
          const active = this.activeRequests.get(seatKey)
          if (active === undefined) throw new Error(`seat '${request.seat.id}' has no active action window`)
          const input = args as { action: unknown }
          const view = await this.ctx.matches.submit({
            matchId: active.matchId,
            windowId: active.windowId,
            commandId: GameCommandId(`${active.windowId}:${active.seat.id}:${exec.callId}`),
            seatId: active.seat.id,
            action: input.action,
          })
          return { accepted: true, revision: view.revision }
        },
      }
      agentCtx.effect(() => agentCtx.tools.register(tool), 'game-controller-agent.submit-tool')
    }
    const persisted = (await this.ctx.sessionPersistence.list()).some(header => header.id === sessionId)
    return persisted
      ? this.ctx.agents.resume({ resumeSessionId: sessionId, agentOptions: { provider: spec.provider, model: spec.model }, setup })
      : this.ctx.agents.create({ sessionId, agentOptions: { provider: spec.provider, model: spec.model }, setup })
  }
}

/** Cordis plugin name. */
export const name = 'game-controller-agent'
/** Services required to create isolated AI players. */
export const inject = ['agents', 'gameControllers', 'llm', 'matches', 'sessionPersistence', 'systemPrompt', 'tools']

/** Register the `agent` controller provider and bind its agents to plugin teardown. */
export function apply(ctx: Context, config: Config): void {
  const controller = new AgentGameController(ctx, config as Required<Config>)
  ctx.effect(() => {
    const dispose = ctx.gameControllers.register('agent', controller)
    return async () => {
      dispose()
      await controller.close()
    }
  }, 'game-controller-agent.register')
}
