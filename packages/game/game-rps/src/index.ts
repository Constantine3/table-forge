/** Rock-paper-scissors rules as a deterministic game plugin. @module @deepseek-ai/dsh-game-rps */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { GameDefinition, GameJson, GameRuleEvent, SeatId } from '@deepseek-ai/dsh-game'

/** Rock-paper-scissors choice. */
export type RpsChoice = 'rock' | 'paper' | 'scissors'

/** Plugin configuration controls product defaults and deployment cost limits. */
export interface Config {
  /** Round count used when match creation omits an explicit value. */
  defaultRounds?: number
  /** Largest round count accepted during match creation. */
  maxRounds?: number
}

/** Schemastery validator for {@link Config}. */
export const Config: z<Config> = z.object({
  defaultRounds: z.number().min(1).step(1).default(3),
  maxRounds: z.number().min(1).step(1).default(20),
})

interface RpsRound {
  readonly number: number
  readonly choices: Readonly<Record<string, RpsChoice>>
  readonly winner: SeatId | null
}

interface RpsState {
  readonly roundCount: number
  readonly seats: readonly [SeatId, SeatId]
  readonly rounds: readonly RpsRound[]
  readonly scores: Readonly<Record<string, number>>
}

const isChoice = (value: unknown): value is RpsChoice => value === 'rock' || value === 'paper' || value === 'scissors'

const winnerOf = (left: RpsChoice, right: RpsChoice): 0 | 1 | null => {
  if (left === right) return null
  return (left === 'rock' && right === 'scissors')
    || (left === 'paper' && right === 'rock')
    || (left === 'scissors' && right === 'paper') ? 0 : 1
}

/** Create one RPS definition.
 * @param config - resolved round limits.
 * @returns configured rules.
 */
export function createRpsDefinition(config: Required<Config>): GameDefinition<RpsState> {
  if (config.defaultRounds > config.maxRounds) throw new Error('RPS defaultRounds must not exceed maxRounds')
  return {
    id: 'rps',
    rulesVersion: 1,
    configSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['roundCount'],
      properties: { roundCount: { type: 'integer', minimum: 1, maximum: config.maxRounds, default: config.defaultRounds } },
    },
    validateConfig(value): GameJson {
      const candidate = value === undefined || value === null ? { roundCount: config.defaultRounds } : value
      if (typeof candidate !== 'object' || Array.isArray(candidate)) throw new Error('RPS config must be an object')
      const roundCount = (candidate as { roundCount?: unknown }).roundCount
      if (!Number.isInteger(roundCount) || (roundCount as number) < 1 || (roundCount as number) > config.maxRounds) {
        throw new Error(`RPS roundCount must be an integer from 1 through ${config.maxRounds}`)
      }
      return { roundCount: roundCount as number }
    },
    initial({ config: gameConfig, seats }): readonly GameRuleEvent[] {
      if (seats.length !== 2) throw new Error('RPS requires exactly two seats')
      return [{ type: 'rps/started', data: { roundCount: (gameConfig as { roundCount: number }).roundCount, seats: seats.map(seat => seat.id) } }]
    },
    reduce(state, event): RpsState {
      if (event.type === 'rps/started') {
        const data = event.data as { roundCount: number; seats: readonly [SeatId, SeatId] }
        return { roundCount: data.roundCount, seats: data.seats, rounds: [], scores: { [data.seats[0]]: 0, [data.seats[1]]: 0 } }
      }
      if (state === undefined) throw new Error('RPS round event precedes start')
      if (event.type !== 'rps/round-resolved') throw new Error(`unknown RPS event '${event.type}'`)
      const round = event.data as unknown as RpsRound
      const scores = { ...state.scores }
      if (round.winner !== null) scores[round.winner] = (scores[round.winner] ?? 0) + 1
      return { ...state, rounds: [...state.rounds, round], scores }
    },
    pending(state) {
      return state.rounds.length === state.roundCount
        ? undefined
        : { key: `round-${state.rounds.length + 1}`, requiredSeats: state.seats, audience: 'public' }
    },
    action() {
      return {
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['choice'],
          properties: { choice: { type: 'string', enum: ['rock', 'paper', 'scissors'] } },
        },
        validate(value): GameJson {
          if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('RPS action must be an object')
          if (Object.keys(value).length !== 1 || !Object.hasOwn(value, 'choice')) throw new Error('RPS action has unexpected fields')
          const choice = (value as { choice?: unknown }).choice
          if (!isChoice(choice)) throw new Error("RPS choice must be 'rock', 'paper', or 'scissors'")
          return { choice }
        },
      }
    },
    resolve({ state, actions }): readonly GameRuleEvent[] {
      const left = (actions.get(state.seats[0]) as { choice: RpsChoice } | undefined)?.choice
      const right = (actions.get(state.seats[1]) as { choice: RpsChoice } | undefined)?.choice
      if (!isChoice(left) || !isChoice(right)) throw new Error('RPS resolution requires both choices')
      const winnerIndex = winnerOf(left, right)
      return [{
        type: 'rps/round-resolved',
        data: {
          number: state.rounds.length + 1,
          choices: { [state.seats[0]]: left, [state.seats[1]]: right },
          winner: winnerIndex === null ? null : state.seats[winnerIndex],
        },
      }]
    },
    view(state): GameJson {
      const complete = state.rounds.length === state.roundCount
      const [left, right] = state.seats
      const leftScore = state.scores[left] ?? 0
      const rightScore = state.scores[right] ?? 0
      const winner = !complete || leftScore === rightScore
        ? null
        : leftScore > rightScore ? left : right
      return { roundCount: state.roundCount, rounds: state.rounds as unknown as GameJson, scores: state.scores, winner }
    },
    modelPrompt(state, seat): string {
      const view = this.view(state, seat)
      return `你是剪刀石头布对局中的席位 ${seat}。每局必须在 rock、paper、scissors 中选择一个动作。你的所有思考、分析和自然语言输出必须使用简体中文；JSON 属性名和枚举值必须严格遵循动作 schema。规则引擎拥有最终裁决权。当前观察：${JSON.stringify(view)}`
    },
  }
}

/** Cordis plugin name. */
export const name = 'game-rps'
/** The plugin registers on the game definition service. */
export const inject = ['gameDefinitions']

/** Register the RPS definition for this plugin lifetime. */
export function apply(ctx: Context, config: Config): void {
  const resolved = config as Required<Config>
  ctx.effect(() => ctx.gameDefinitions.register(createRpsDefinition(resolved)), 'game-rps.registerDefinition')
}
