/** Five- and six-player Avalon rules as a deterministic game plugin. @module @deepseek-ai/dsh-game-avalon */

import type { Context } from '@deepseek-ai/cordis'
import type {
  GameActionSpec, GameDefinition, GameJson, GameRuleEvent, MatchSeatSpec, SeatId,
} from '@deepseek-ai/dsh-game'
import z from '@deepseek-ai/schemastery'
import { createHash } from 'node:crypto'

/** Roles used by the supported Avalon rulesets. */
export type AvalonRole = 'merlin' | 'loyal-servant' | 'assassin' | 'minion'

/** Supported Avalon table sizes. */
export type AvalonPlayerCount = 5 | 6

/** Per-match choices accepted by the Avalon rulesets. */
export interface AvalonMatchConfig {
  /** Number of seats at the table. */
  readonly playerCount: AvalonPlayerCount
  /** Role pinned to the single human seat; omission keeps deterministic private random assignment. */
  readonly humanRole?: AvalonRole
}

/** Direction selected by the leader for one public discussion round. */
export type AvalonSpeechDirection = 'clockwise' | 'counterclockwise'

/** Deployment limits for public statements. */
export interface Config {
  /** Maximum UTF-16 code units accepted in one public statement. */
  maxStatementChars?: number
}

/** Schemastery validator for {@link Config}. */
export const Config: z<Config> = z.object({ maxStatementChars: z.number().min(1).step(1).default(280) })

interface Proposal {
  readonly leader: SeatId
  readonly team: readonly SeatId[]
  readonly direction: AvalonSpeechDirection
}

interface DiscussionStatement {
  readonly seatId: SeatId
  readonly statement: string
}

interface FinalTeamStatement extends DiscussionStatement {
  readonly team: readonly SeatId[]
}

interface TeamVoteRecord {
  readonly proposal: Proposal
  readonly statements: readonly DiscussionStatement[]
  readonly approveCount: number
  readonly rejectCount: number
  readonly approved: boolean
}

interface MissionRecord {
  readonly number: number
  readonly team: readonly SeatId[]
  readonly failCount: number
  readonly success: boolean
}

interface AvalonState {
  readonly seats: readonly SeatId[]
  readonly roles: Readonly<Record<string, AvalonRole>>
  readonly phase: 'proposal' | 'discussion' | 'team-vote' | 'quest' | 'evil-discussion' | 'assassination' | 'finished'
  readonly leaderIndex: number
  readonly missionIndex: number
  readonly rejectedTeams: number
  readonly proposal: Proposal | undefined
  readonly statements: readonly DiscussionStatement[]
  readonly evilStatements: readonly DiscussionStatement[]
  readonly teamVotes: readonly TeamVoteRecord[]
  readonly missions: readonly MissionRecord[]
  readonly winner?: 'good' | 'evil'
  readonly finishReason?: 'three-failed-quests' | 'five-rejected-teams' | 'merlin-assassinated' | 'merlin-survived'
  readonly assassinationTarget?: SeatId
}

interface AvalonRules {
  readonly roleDeck: readonly AvalonRole[]
  readonly missionSizes: readonly [number, number, number, number, number]
}

const AVALON_RULES: Readonly<Record<AvalonPlayerCount, AvalonRules>> = {
  5: {
    roleDeck: ['merlin', 'assassin', 'loyal-servant', 'loyal-servant', 'minion'],
    missionSizes: [2, 3, 2, 3, 3],
  },
  6: {
    roleDeck: ['merlin', 'assassin', 'loyal-servant', 'loyal-servant', 'loyal-servant', 'minion'],
    missionSizes: [2, 3, 4, 3, 4],
  },
}
const AVALON_ROLES = new Set<string>(['merlin', 'loyal-servant', 'assassin', 'minion'])
const EVIL_ROLES = new Set<AvalonRole>(['assassin', 'minion'])

const digest = (value: string): string => createHash('sha256').update(value).digest('hex')

const required = <T>(value: T | undefined, label: string): T => {
  if (value === undefined) throw new Error(`Avalon state is missing ${label}`)
  return value
}

const roleFor = (state: AvalonState, seat: SeatId): AvalonRole => required(state.roles[seat], `role for '${seat}'`)

const proposalFor = (state: AvalonState): Proposal => required(state.proposal, 'the active proposal')

const playerCountFor = (seats: readonly unknown[]): AvalonPlayerCount => {
  if (seats.length !== 5 && seats.length !== 6) throw new Error('Avalon requires exactly five or six seats')
  return seats.length
}

const rulesFor = (state: AvalonState): AvalonRules => AVALON_RULES[playerCountFor(state.seats)]

const missionTeamSize = (state: AvalonState): number => required(
  rulesFor(state).missionSizes[state.missionIndex],
  `mission ${state.missionIndex + 1}`,
)

const validatedTeam = (
  value: unknown,
  state: AvalonState,
  teamSize: number,
  label: string,
): readonly SeatId[] => {
  if (!Array.isArray(value) || value.length !== teamSize
    || !value.every(candidate => typeof candidate === 'string' && state.seats.includes(candidate as SeatId))
    || new Set(value).size !== value.length) {
    throw new Error(`Avalon ${label} requires ${teamSize} unique match seats`)
  }
  return value as readonly SeatId[]
}

const assassinFor = (state: AvalonState): SeatId => required(
  state.seats.find(seat => roleFor(state, seat) === 'assassin'),
  'the assassin seat',
)

const asRecord = (value: unknown, label: string): Readonly<Record<string, unknown>> => {
  if (value === null || Array.isArray(value) || typeof value !== 'object') throw new Error(`${label} must be an object`)
  return value as Readonly<Record<string, unknown>>
}

const requireExactKeys = (record: Readonly<Record<string, unknown>>, keys: readonly string[], label: string): void => {
  const actual = Object.keys(record).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} has unexpected fields`)
  }
}

const statement = (value: unknown, max: number, chineseRequired: boolean): string => {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > max) {
    throw new Error(`Avalon statement must contain 1 through ${max} characters`)
  }
  if (chineseRequired && !/\p{Script=Han}/u.test(value)) {
    throw new Error('AI Avalon statements must contain Chinese text')
  }
  return value
}

const discussionSeat = (state: AvalonState): SeatId => {
  const step = proposalFor(state).direction === 'clockwise' ? 1 : -1
  const offset = state.statements.length + 1
  const index = (state.leaderIndex + step * offset + state.seats.length) % state.seats.length
  return required(state.seats[index], 'the current speaker')
}

const evilDiscussionSeats = (state: AvalonState): readonly SeatId[] => {
  const assassin = assassinFor(state)
  const assassinIndex = state.seats.indexOf(assassin)
  const clockwise = [...state.seats.slice(assassinIndex + 1), ...state.seats.slice(0, assassinIndex)]
  return [...clockwise.filter(seat => EVIL_ROLES.has(roleFor(state, seat))), assassin]
}

const evilDiscussionSeat = (state: AvalonState): SeatId => required(
  evilDiscussionSeats(state)[state.evilStatements.length],
  'the current evil speaker',
)

const assignment = (
  seats: readonly MatchSeatSpec[],
  roleDeck: readonly AvalonRole[],
  seed: string,
  humanRole?: AvalonRole,
): Readonly<Record<string, AvalonRole>> => {
  const ordered = [...seats].sort((left, right) => {
    const comparison = digest(`avalon:role:${seed}:${left.id}`).localeCompare(digest(`avalon:role:${seed}:${right.id}`))
    /* v8 ignore next -- only a SHA-256 collision reaches the stable seat-id tie breaker. */
    return comparison === 0 ? left.id.localeCompare(right.id) : comparison
  })
  if (humanRole === undefined) {
    return Object.fromEntries(ordered.map((seat, index) => [seat.id, required(roleDeck[index], `role ${index + 1}`)]))
  }
  const human = required(seats.find(seat => seat.controller.type === 'human'), 'the human seat')
  const remainingRoles = [...roleDeck]
  remainingRoles.splice(remainingRoles.indexOf(humanRole), 1)
  const aiSeats = ordered.filter(seat => seat.id !== human.id)
  return Object.fromEntries([
    [human.id, humanRole],
    ...aiSeats.map((seat, index) => [seat.id, required(remainingRoles[index], `AI role ${index + 1}`)] as const),
  ])
}

const actionFor = (state: AvalonState, seat: MatchSeatSpec, maxStatementChars: number): GameActionSpec => {
  if (state.phase === 'proposal') {
    const teamSize = missionTeamSize(state)
    return {
      schema: {
        type: 'object', additionalProperties: false, required: ['type', 'team', 'direction'],
        properties: {
          type: { type: 'string', const: 'propose-team' },
          team: { type: 'array', minItems: teamSize, maxItems: teamSize, uniqueItems: true, items: { type: 'string', enum: state.seats } },
          direction: {
            type: 'string', enum: ['clockwise', 'counterclockwise'],
            description: '队长指定的发言方向；相邻席位先发言，队长最后归票。',
          },
        },
      },
      validate(value): GameJson {
        const record = asRecord(value, 'Avalon proposal')
        requireExactKeys(record, ['type', 'team', 'direction'], 'Avalon proposal')
        if (record.type !== 'propose-team' || !Array.isArray(record.team)) throw new Error('Avalon proposal is invalid')
        const team = validatedTeam(record.team, state, teamSize, 'proposal')
        if (record.direction !== 'clockwise' && record.direction !== 'counterclockwise') {
          throw new Error('Avalon proposal direction must be clockwise or counterclockwise')
        }
        return { type: 'propose-team', team, direction: record.direction }
      },
    }
  }
  if (state.phase === 'discussion') {
    const proposal = proposalFor(state)
    const leaderFinalizesTeam = seat.id === proposal.leader && discussionSeat(state) === proposal.leader
    const teamSize = missionTeamSize(state)
    const actionKeys = leaderFinalizesTeam ? ['type', 'statement', 'team'] : ['type', 'statement']
    return {
      schema: {
        type: 'object', additionalProperties: false, required: actionKeys,
        properties: {
          type: { type: 'string', const: 'make-statement' },
          statement: {
            type: 'string', minLength: 1, maxLength: maxStatementChars,
            description: leaderFinalizesTeam
              ? '队长总结公开讨论并说明最终组队判断；AI 席位必须使用简体中文。'
              : '投票前公开发言；AI 席位必须使用简体中文。',
          },
          ...(leaderFinalizesTeam ? {
            team: {
              type: 'array', minItems: teamSize, maxItems: teamSize, uniqueItems: true,
              items: { type: 'string', enum: state.seats },
              description: `听完其他 ${state.seats.length - 1} 名玩家后确定的最终队伍；可以保留初选，也可以更换成员。`,
            },
          } : {}),
        },
      },
      validate(value): GameJson {
        const record = asRecord(value, 'Avalon discussion statement')
        requireExactKeys(record, actionKeys, 'Avalon discussion statement')
        if (record.type !== 'make-statement') throw new Error('Avalon discussion statement is invalid')
        const result: Record<string, GameJson> = {
          type: 'make-statement',
          statement: statement(record.statement, maxStatementChars, seat.controller.type === 'agent'),
        }
        if (leaderFinalizesTeam) result.team = validatedTeam(record.team, state, teamSize, 'final team')
        return result
      },
    }
  }
  if (state.phase === 'evil-discussion') {
    return {
      schema: {
        type: 'object', additionalProperties: false, required: ['type', 'statement'],
        properties: {
          type: { type: 'string', const: 'make-evil-statement' },
          statement: {
            type: 'string', minLength: 1, maxLength: maxStatementChars,
            description: '刺杀前邪方私密发言；AI 席位必须使用简体中文。',
          },
        },
      },
      validate(value): GameJson {
        const record = asRecord(value, 'Avalon evil discussion statement')
        requireExactKeys(record, ['type', 'statement'], 'Avalon evil discussion statement')
        if (record.type !== 'make-evil-statement') throw new Error('Avalon evil discussion statement is invalid')
        return {
          type: 'make-evil-statement',
          statement: statement(record.statement, maxStatementChars, seat.controller.type === 'agent'),
        }
      },
    }
  }
  if (state.phase === 'team-vote') {
    return {
      schema: {
        type: 'object', additionalProperties: false, required: ['type', 'approve'],
        properties: {
          type: { type: 'string', const: 'vote-team' },
          approve: { type: 'boolean', description: '匿名队伍投票；结算只公开赞成与否决票数。' },
        },
      },
      validate(value): GameJson {
        const record = asRecord(value, 'Avalon team vote')
        requireExactKeys(record, ['type', 'approve'], 'Avalon team vote')
        if (record.type !== 'vote-team' || typeof record.approve !== 'boolean') throw new Error('Avalon team vote is invalid')
        return { type: 'vote-team', approve: record.approve }
      },
    }
  }
  if (state.phase === 'quest') {
    const outcomes = EVIL_ROLES.has(roleFor(state, seat.id)) ? ['success', 'fail'] : ['success']
    return {
      schema: {
        type: 'object', additionalProperties: false, required: ['type', 'outcome'],
        properties: { type: { type: 'string', const: 'quest' }, outcome: { type: 'string', enum: outcomes } },
      },
      validate(value): GameJson {
        const record = asRecord(value, 'Avalon quest action')
        requireExactKeys(record, ['type', 'outcome'], 'Avalon quest action')
        if (record.type !== 'quest' || !outcomes.includes(record.outcome as string)) throw new Error('Avalon quest outcome is not permitted for this role')
        return { type: 'quest', outcome: record.outcome as string }
      },
    }
  }
  if (state.phase === 'assassination') {
    const targets = state.seats.filter(candidate => candidate !== seat.id)
    return {
      schema: {
        type: 'object', additionalProperties: false, required: ['type', 'target'],
        properties: { type: { type: 'string', const: 'assassinate' }, target: { type: 'string', enum: targets } },
      },
      validate(value): GameJson {
        const record = asRecord(value, 'Avalon assassination')
        requireExactKeys(record, ['type', 'target'], 'Avalon assassination')
        if (record.type !== 'assassinate' || typeof record.target !== 'string' || !targets.includes(record.target as SeatId)) {
          throw new Error('Avalon assassination target must be another match seat')
        }
        return { type: 'assassinate', target: record.target }
      },
    }
  }
  throw new Error('finished Avalon matches accept no actions')
}

const project = (state: AvalonState, seat?: SeatId): GameJson => {
  const rules = rulesFor(state)
  const successes = state.missions.filter(mission => mission.success).length
  const failures = state.missions.length - successes
  const ownRole = seat === undefined ? undefined : state.roles[seat]
  const knownPlayers = ownRole === 'merlin'
    ? state.seats.filter(candidate => EVIL_ROLES.has(roleFor(state, candidate)))
      .map(seatId => ({ seatId, alignment: 'evil' as const }))
    : ownRole !== undefined && EVIL_ROLES.has(ownRole)
      ? state.seats.filter(candidate => candidate !== seat && EVIL_ROLES.has(roleFor(state, candidate)))
        .map(seatId => ({ seatId, role: roleFor(state, seatId) }))
      : []
  const missionSize = required(
    rules.missionSizes[Math.min(state.missionIndex, rules.missionSizes.length - 1)],
    `mission ${state.missionIndex + 1}`,
  )
  const evilDiscussionVisible = state.phase === 'finished'
    || (ownRole !== undefined && EVIL_ROLES.has(ownRole))
  return {
    phase: state.phase,
    playerCount: state.seats.length,
    missionSizes: rules.missionSizes,
    leader: required(state.seats[state.leaderIndex], 'the current leader'),
    missionNumber: Math.min(state.missionIndex + 1, rules.missionSizes.length),
    teamSize: missionSize,
    rejectedTeams: state.rejectedTeams,
    score: { good: successes, evil: failures },
    proposal: (state.proposal ?? null) as unknown as GameJson,
    statements: state.statements as unknown as GameJson,
    ...(evilDiscussionVisible && state.evilStatements.length > 0
      ? { evilDiscussion: state.evilStatements as unknown as GameJson }
      : {}),
    ...(evilDiscussionVisible && state.phase === 'evil-discussion'
      ? { evilSpeaker: evilDiscussionSeat(state) }
      : {}),
    teamVotes: state.teamVotes as unknown as GameJson,
    missions: state.missions as unknown as GameJson,
    ...(ownRole === undefined ? {} : {
      private: { role: ownRole, alignment: EVIL_ROLES.has(ownRole) ? 'evil' : 'good', knownPlayers },
    }),
    ...(state.phase !== 'finished' ? {} : {
      winner: required(state.winner, 'the winner'),
      finishReason: required(state.finishReason, 'the finish reason'),
      roles: state.roles,
      assassinationTarget: state.assassinationTarget ?? null,
    }),
  }
}

/** Create one five- and six-player Avalon definition.
 * @param config - resolved statement limit.
 * @returns configured rules.
 */
export function createAvalonDefinition(config: Required<Config>): GameDefinition<AvalonState> {
  return {
    id: 'avalon',
    rulesVersion: 8,
    configSchema: {
      type: 'object', additionalProperties: false,
      properties: {
        playerCount: {
          type: 'integer', enum: [5, 6], default: 5,
          description: '圆桌席位数；五人局和六人局都支持一名人类参与或全 AI 对局。',
        },
        humanRole: {
          type: 'string', enum: ['merlin', 'loyal-servant', 'assassin', 'minion'],
          description: '人类玩家指定身份；只有一名人类席位时可用，省略时由私有随机种子分配。',
        },
      },
    },
    validateConfig(value): GameJson {
      const candidate = value ?? {}
      const record = asRecord(candidate, 'Avalon config')
      if (Object.keys(record).some(key => key !== 'playerCount' && key !== 'humanRole')) {
        throw new Error('Avalon config has unexpected fields')
      }
      const playerCount = record.playerCount ?? 5
      if (playerCount !== 5 && playerCount !== 6) throw new Error('Avalon player count must be 5 or 6')
      if (record.humanRole === undefined) return { playerCount }
      if (typeof record.humanRole !== 'string' || !AVALON_ROLES.has(record.humanRole)) {
        throw new Error('Avalon human role is invalid')
      }
      return { playerCount, humanRole: record.humanRole }
    },
    initial({ config: matchConfig, seats, randomSeed }): readonly GameRuleEvent[] {
      const resolvedMatchConfig = matchConfig as unknown as AvalonMatchConfig
      const requestedPlayerCount = resolvedMatchConfig.playerCount
      if (seats.length !== requestedPlayerCount) {
        throw new Error(`Avalon ${requestedPlayerCount}-player setup requires exactly ${requestedPlayerCount} seats`)
      }
      const humanCount = seats.filter(seat => seat.controller.type === 'human').length
      const agentCount = seats.filter(seat => seat.controller.type === 'agent').length
      if ((humanCount !== 0 && humanCount !== 1) || humanCount + agentCount !== requestedPlayerCount) {
        throw new Error(`Avalon ${requestedPlayerCount}-player setup requires either ${requestedPlayerCount} AI seats or one human seat and ${requestedPlayerCount - 1} AI seats`)
      }
      const requestedRole = resolvedMatchConfig.humanRole
      if (requestedRole !== undefined && humanCount !== 1) {
        throw new Error('Avalon humanRole requires exactly one human seat')
      }
      const roles = assignment(seats, AVALON_RULES[requestedPlayerCount].roleDeck, randomSeed, requestedRole)
      const leaderIndex = Number.parseInt(digest(`avalon:leader:${randomSeed}`).slice(0, 8), 16) % seats.length
      return [{ type: 'avalon/started', data: { seats: seats.map(seat => seat.id), roles, leaderIndex } }]
    },
    reduce(state, event): AvalonState {
      if (event.type === 'avalon/started') {
        const data = event.data as unknown as { seats: AvalonState['seats']; roles: AvalonState['roles']; leaderIndex: number }
        return {
          seats: data.seats, roles: data.roles, phase: 'proposal', leaderIndex: data.leaderIndex,
          missionIndex: 0, rejectedTeams: 0, proposal: undefined, statements: [], evilStatements: [],
          teamVotes: [], missions: [],
        }
      }
      if (state === undefined) throw new Error('Avalon event precedes start')
      if (event.type === 'avalon/team-proposed') {
        const proposal = event.data as unknown as Proposal
        return { ...state, phase: 'discussion', proposal, statements: [] }
      }
      if (event.type === 'avalon/statement-made') {
        const discussion = event.data as unknown as DiscussionStatement
        const expectedSeat = discussionSeat(state)
        if (discussion.seatId !== expectedSeat) throw new Error(`Avalon discussion expected seat '${expectedSeat}'`)
        if (discussion.seatId === proposalFor(state).leader) {
          throw new Error('Avalon leader must finalize the team with the final statement')
        }
        return { ...state, statements: [...state.statements, discussion] }
      }
      if (event.type === 'avalon/team-finalized') {
        const finalStatement = event.data as unknown as FinalTeamStatement
        const proposal = proposalFor(state)
        const expectedSeat = discussionSeat(state)
        if (expectedSeat !== proposal.leader || finalStatement.seatId !== expectedSeat) {
          throw new Error(`Avalon final team expected leader '${proposal.leader}'`)
        }
        const team = validatedTeam(finalStatement.team, state, missionTeamSize(state), 'final team')
        return {
          ...state,
          phase: 'team-vote',
          proposal: { ...proposal, team },
          statements: [...state.statements, { seatId: finalStatement.seatId, statement: finalStatement.statement }],
        }
      }
      if (event.type === 'avalon/evil-statement-made') {
        if (state.phase !== 'evil-discussion') throw new Error('Avalon evil discussion is not active')
        const discussion = event.data as unknown as DiscussionStatement
        const expectedSeat = evilDiscussionSeat(state)
        if (discussion.seatId !== expectedSeat) throw new Error(`Avalon evil discussion expected seat '${expectedSeat}'`)
        const evilStatements = [...state.evilStatements, discussion]
        return {
          ...state,
          phase: evilStatements.length === evilDiscussionSeats(state).length ? 'assassination' : 'evil-discussion',
          evilStatements,
        }
      }
      if (event.type === 'avalon/team-vote-resolved') {
        const record = event.data as unknown as TeamVoteRecord
        const leaderIndex = (state.leaderIndex + 1) % state.seats.length
        if (record.approved) return { ...state, phase: 'quest', leaderIndex, rejectedTeams: 0, teamVotes: [...state.teamVotes, record] }
        const rejectedTeams = state.rejectedTeams + 1
        if (rejectedTeams === 5) {
          return {
            ...state, phase: 'finished', leaderIndex, rejectedTeams, proposal: undefined, statements: [],
            teamVotes: [...state.teamVotes, record], winner: 'evil', finishReason: 'five-rejected-teams',
          }
        }
        return {
          ...state, phase: 'proposal', leaderIndex, rejectedTeams, proposal: undefined, statements: [],
          teamVotes: [...state.teamVotes, record],
        }
      }
      if (event.type === 'avalon/quest-resolved') {
        const mission = event.data as unknown as MissionRecord
        const missions = [...state.missions, mission]
        const successCount = missions.filter(candidate => candidate.success).length
        const failureCount = missions.length - successCount
        if (failureCount === 3) {
          return {
            ...state, phase: 'finished', missionIndex: state.missionIndex + 1, proposal: undefined, statements: [], missions,
            winner: 'evil', finishReason: 'three-failed-quests',
          }
        }
        if (successCount === 3) {
          return {
            ...state, phase: 'evil-discussion', missionIndex: state.missionIndex + 1,
            proposal: undefined, statements: [], evilStatements: [], missions,
          }
        }
        return {
          ...state, phase: 'proposal', missionIndex: state.missionIndex + 1,
          proposal: undefined, statements: [], missions,
        }
      }
      if (event.type === 'avalon/assassination-resolved') {
        const data = event.data as unknown as { target: SeatId; hitMerlin: boolean }
        return {
          ...state, phase: 'finished', assassinationTarget: data.target,
          winner: data.hitMerlin ? 'evil' : 'good',
          finishReason: data.hitMerlin ? 'merlin-assassinated' : 'merlin-survived',
        }
      }
      throw new Error(`unknown Avalon event '${event.type}'`)
    },
    pending(state) {
      if (state.phase === 'finished') return undefined
      if (state.phase === 'proposal') {
        return { key: 'proposal', requiredSeats: [required(state.seats[state.leaderIndex], 'the current leader')], audience: 'public' }
      }
      if (state.phase === 'discussion') {
        return { key: 'discussion', requiredSeats: [discussionSeat(state)], audience: 'public' }
      }
      if (state.phase === 'evil-discussion') {
        return { key: 'evil-discussion', requiredSeats: [evilDiscussionSeat(state)], audience: 'required-seats' }
      }
      if (state.phase === 'team-vote') return { key: 'team-vote', requiredSeats: state.seats, audience: 'public' }
      if (state.phase === 'quest') return { key: 'quest', requiredSeats: proposalFor(state).team, audience: 'public' }
      const assassin = assassinFor(state)
      return { key: 'assassination', requiredSeats: [assassin], audience: 'required-seats' }
    },
    action({ state, seat }) {
      return actionFor(state, seat, config.maxStatementChars)
    },
    resolve({ state, actions }): readonly GameRuleEvent[] {
      if (state.phase === 'proposal') {
        const leader = required(state.seats[state.leaderIndex], 'the current leader')
        const action = actions.get(leader) as { team: readonly SeatId[]; direction: AvalonSpeechDirection } | undefined
        if (action === undefined) throw new Error('Avalon proposal resolution requires the leader action')
        return [{ type: 'avalon/team-proposed', data: { leader, team: action.team, direction: action.direction } }]
      }
      if (state.phase === 'discussion') {
        const seatId = discussionSeat(state)
        const action = actions.get(seatId) as { statement?: string; team?: readonly SeatId[] } | undefined
        if (action?.statement === undefined) throw new Error('Avalon discussion resolution requires the current speaker')
        if (seatId === proposalFor(state).leader) {
          if (action.team === undefined) throw new Error('Avalon leader finalization requires the final team')
          return [{
            type: 'avalon/team-finalized',
            data: { seatId, statement: action.statement, team: action.team },
          }]
        }
        return [{ type: 'avalon/statement-made', data: { seatId, statement: action.statement } }]
      }
      if (state.phase === 'evil-discussion') {
        const seatId = evilDiscussionSeat(state)
        const action = actions.get(seatId) as { statement?: string } | undefined
        if (action?.statement === undefined) throw new Error('Avalon evil discussion resolution requires the current speaker')
        return [{ type: 'avalon/evil-statement-made', data: { seatId, statement: action.statement } }]
      }
      if (state.phase === 'team-vote') {
        const proposal = proposalFor(state)
        const approveCount = state.seats.filter((seatId) => {
          const action = actions.get(seatId) as { approve: boolean } | undefined
          if (action === undefined) throw new Error('Avalon team vote resolution requires every seat')
          return action.approve
        }).length
        return [{
          type: 'avalon/team-vote-resolved',
          data: {
            proposal,
            statements: state.statements,
            approveCount,
            rejectCount: state.seats.length - approveCount,
            approved: approveCount > state.seats.length / 2,
          } as unknown as GameJson,
        }]
      }
      if (state.phase === 'quest') {
        const proposal = proposalFor(state)
        const failCount = proposal.team.filter((seatId) => {
          const action = actions.get(seatId) as { outcome?: string } | undefined
          if (action === undefined) throw new Error('Avalon quest resolution requires every team member')
          return action.outcome === 'fail'
        }).length
        return [{
          type: 'avalon/quest-resolved',
          data: { number: state.missionIndex + 1, team: proposal.team, failCount, success: failCount === 0 },
        }]
      }
      if (state.phase === 'assassination') {
        const assassin = assassinFor(state)
        const action = actions.get(assassin) as { target?: SeatId } | undefined
        if (action?.target === undefined) throw new Error('Avalon assassination resolution requires the assassin action')
        return [{
          type: 'avalon/assassination-resolved',
          data: { target: action.target, hitMerlin: roleFor(state, action.target) === 'merlin' },
        }]
      }
      throw new Error('finished Avalon matches cannot resolve actions')
    },
    view: project,
    modelPrompt(state, seat): string {
      const rules = rulesFor(state)
      const loyalServants = rules.roleDeck.filter(role => role === 'loyal-servant').length
      const approvalVotes = Math.floor(state.seats.length / 2) + 1
      return `你是 ${state.seats.length} 人阿瓦隆中的席位 ${seat}。角色包括梅林、刺客、${loyalServants} 名亚瑟的忠臣和一名莫德雷德的爪牙。五次任务的队伍人数依次为 ${rules.missionSizes.join('、')}；一支队伍获得至少 ${approvalVotes} 票赞成才会通过。队伍投票匿名提交，结算只公开赞成票数和否决票数，不公开任何席位的选择。每次队伍投票结束后，队长顺时针交给下一席。队伍被否决时，连续否决计数增加一；任一队伍通过时，该计数立即清零，因此早先的否决不会永久占用五次机会。只有连续五支队伍都被否决或累计三次任务失败时，邪方才立即获胜。三次任务成功后，邪方沿圆桌顺时针依次私密发言，刺客最后总结，再由刺客选择梅林目标。忠臣和梅林执行任务时只能选择成功。队长先提交初选队伍并指定顺时针或逆时针发言方向，此时队长不发言；与队长相邻的席位沿指定方向开始，${state.seats.length - 1} 名非队长依次公开发言。听完其他玩家发言后，队长最后归票发言，并在同一个动作中提交最终队伍；最终队伍可以与初选相同，也可以更换成员，随后所有玩家只对这支最终队伍投票。你的所有思考、分析、自然语言输出、公开发言和邪方私密发言必须使用简体中文；JSON 属性名、动作类型和席位 id 必须严格遵循动作 schema。公开发言不得泄露或引用私有身份知识；邪方私密发言可以使用规则投影提供的身份知识。规则引擎拥有最终裁决权。当前观察：${JSON.stringify(project(state, seat))}`
    },
  }
}

/** Cordis plugin name. */
export const name = 'game-avalon'
/** The plugin registers on the game definition service. */
export const inject = ['gameDefinitions']

/** Register the Avalon definition for this plugin lifetime. */
export function apply(ctx: Context, config: Config): void {
  ctx.effect(() => ctx.gameDefinitions.register(createAvalonDefinition(config as Required<Config>)), 'game-avalon.registerDefinition')
}
