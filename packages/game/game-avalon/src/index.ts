/** Five- through eight-player Avalon rules as a deterministic game plugin. @module @deepseek-ai/dsh-game-avalon */

import type { Context } from '@deepseek-ai/cordis'
import type {
  GameActionSpec, GameDefinition, GameJson, GameRuleEvent, MatchSeatSpec, SeatId,
} from '@deepseek-ai/dsh-game'
import {
  AVALON_RULES_VERSION,
  AVALON_ROLES,
  DEFAULT_AVALON_ROLE_PRESET,
  avalonRoleAlignment,
  avalonRoleLabel,
  avalonRolePresetInfo,
  isAvalonEvilRole,
  isAvalonRole,
  isAvalonRolePreset,
  participatesInAvalonEvilNetwork,
  resolveAvalonRules,
  type AvalonPlayerCount,
  type AvalonRole,
  type AvalonRolePreset,
  type AvalonRules,
} from '@deepseek-ai/dsh-game-avalon-rules'
import z from '@deepseek-ai/schemastery'
import { createHash } from 'node:crypto'

export type { AvalonPlayerCount, AvalonRole, AvalonRolePreset } from '@deepseek-ai/dsh-game-avalon-rules'

/** Per-match choices accepted by the Avalon rulesets. */
export interface AvalonMatchConfig {
  /** Number of seats at the table. */
  readonly playerCount: AvalonPlayerCount
  /** Validated role combination used by this table. */
  readonly rolePreset: AvalonRolePreset
  /** Role pinned to the single human seat; omission keeps deterministic private random assignment. */
  readonly humanRole?: AvalonRole
}

/** One piece of role-specific private identity knowledge. */
export type AvalonKnowledge =
  | { readonly kind: 'evil'; readonly seatId: SeatId }
  | { readonly kind: 'merlin-candidate'; readonly seatId: SeatId }
  | { readonly kind: 'evil-ally'; readonly seatId: SeatId; readonly role: AvalonRole }

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
  readonly rolePreset: AvalonRolePreset
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

const digest = (value: string): string => createHash('sha256').update(value).digest('hex')

const required = <T>(value: T | undefined, label: string): T => {
  if (value === undefined) throw new Error(`Avalon state is missing ${label}`)
  return value
}

const roleFor = (state: AvalonState, seat: SeatId): AvalonRole => required(state.roles[seat], `role for '${seat}'`)

const proposalFor = (state: AvalonState): Proposal => required(state.proposal, 'the active proposal')

const playerCountFor = (seats: readonly unknown[]): AvalonPlayerCount => {
  if (seats.length !== 5 && seats.length !== 6 && seats.length !== 7 && seats.length !== 8) {
    throw new Error('Avalon requires exactly five, six, seven, or eight seats')
  }
  return seats.length
}

const rulesFor = (state: AvalonState): AvalonRules => {
  const rules = resolveAvalonRules(playerCountFor(state.seats), state.rolePreset)
  const assigned = state.seats.map(seat => roleFor(state, seat)).sort()
  const expected = [...rules.roleDeck].sort()
  if (Object.keys(state.roles).length !== state.seats.length
    || assigned.some((role, index) => role !== expected[index])) {
    throw new Error('Avalon role assignments do not match the selected role preset')
  }
  return rules
}

const missionTeamSize = (state: AvalonState): number => required(
  rulesFor(state).missionSizes[state.missionIndex],
  `mission ${state.missionIndex + 1}`,
)

const missionFailThreshold = (state: AvalonState): number => required(
  rulesFor(state).missionFailThresholds[state.missionIndex],
  `mission ${state.missionIndex + 1} fail threshold`,
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
  return [...clockwise.filter(seat => participatesInAvalonEvilNetwork(roleFor(state, seat))), assassin]
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
    const outcomes = isAvalonEvilRole(roleFor(state, seat.id)) ? ['success', 'fail'] : ['success']
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
  const knowledge: readonly AvalonKnowledge[] = ownRole === 'merlin'
    ? state.seats
      .filter((candidate) => {
        const role = roleFor(state, candidate)
        return isAvalonEvilRole(role) && role !== 'mordred'
      })
      .map(seatId => ({ kind: 'evil' as const, seatId }))
    : ownRole === 'percival'
      ? state.seats
        .filter(candidate => roleFor(state, candidate) === 'merlin' || roleFor(state, candidate) === 'morgana')
        .map(seatId => ({ kind: 'merlin-candidate' as const, seatId }))
      : ownRole !== undefined && participatesInAvalonEvilNetwork(ownRole)
        ? state.seats
          .filter(candidate => candidate !== seat && participatesInAvalonEvilNetwork(roleFor(state, candidate)))
          .map(seatId => ({ kind: 'evil-ally' as const, seatId, role: roleFor(state, seatId) }))
        : []
  const missionSize = required(
    rules.missionSizes[Math.min(state.missionIndex, rules.missionSizes.length - 1)],
    `mission ${state.missionIndex + 1}`,
  )
  const failThreshold = required(
    rules.missionFailThresholds[Math.min(state.missionIndex, rules.missionFailThresholds.length - 1)],
    `mission ${state.missionIndex + 1} fail threshold`,
  )
  const evilDiscussionVisible = state.phase === 'finished'
    || (ownRole !== undefined && participatesInAvalonEvilNetwork(ownRole))
  return {
    phase: state.phase,
    playerCount: state.seats.length,
    rolePreset: state.rolePreset,
    roleDeck: rules.roleDeck,
    missionSizes: rules.missionSizes,
    missionFailThresholds: rules.missionFailThresholds,
    leader: required(state.seats[state.leaderIndex], 'the current leader'),
    missionNumber: Math.min(state.missionIndex + 1, rules.missionSizes.length),
    teamSize: missionSize,
    failThreshold,
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
      private: { role: ownRole, alignment: avalonRoleAlignment(ownRole), knowledge },
    }),
    ...(state.phase !== 'finished' ? {} : {
      winner: required(state.winner, 'the winner'),
      finishReason: required(state.finishReason, 'the finish reason'),
      roles: state.roles,
      assassinationTarget: state.assassinationTarget ?? null,
    }),
  }
}

const factionStrategyPrompt = (state: AvalonState, seat: SeatId): string => {
  const role = roleFor(state, seat)
  if (role === 'merlin') {
    const mordredWarning = rulesFor(state).roleDeck.includes('mordred')
      ? '本局存在莫德雷德，他不会出现在你的邪方视野中；未被你看见不能证明属于善方。'
      : ''
    return `你的善方目标是完成三次任务并让梅林躲过刺杀。利用已知邪方身份引导安全队伍，但不得只为隐藏梅林而故意放过你明知危险的队伍；公开表达必须能由公开信息合理支撑。${mordredWarning}`
  }
  if (role === 'percival') {
    return '你的善方目标是完成三次任务并帮助真正的梅林隐藏身份。你看到的两名梅林候选中，一名是梅林、一名是莫甘娜，但不能直接分辨；比较两人的长期判断，同时不要公开候选范围。'
  }
  if (role === 'loyal-servant') {
    return '你的善方目标是完成三次任务并帮助梅林隐藏身份。你没有额外身份知识，应根据组队、发言、匿名票型和任务结果持续比较多种身份假设。'
  }
  const common = '你的邪方目标是取得三次任务失败、促成连续五次队伍否决，或在善方三次任务成功后刺中梅林。隐藏身份和让任务成功只能是达成胜利的手段，不能替代胜利目标。'
  if (role === 'assassin') {
    return `${common}你负责最终刺杀，应持续记录谁的判断像掌握了隐藏身份，同时避免为了过早追问梅林而暴露邪方。`
  }
  if (role === 'morgana') {
    return `${common}你会作为假梅林出现在派西维尔视野中；用公开信息能够解释的准确判断模仿隐藏知识，误导派西维尔保护你，但不要机械地替所有邪方辩护。`
  }
  if (role === 'mordred') {
    return `${common}梅林看不到你；利用这一信息盲区建立可信度并进入关键队伍，但不要因自认为安全而忽略任务胜负。`
  }
  if (role === 'oberon') {
    return `${common}你是奥伯伦，不认识其他邪方，其他邪方也不知道你；只能从公开时间线独立推断，绝不能声称掌握邪方同伴名单或私密讨论。`
  }
  return common
}

const evilQuestStrategyPrompt = (state: AvalonState, seat: SeatId): string => {
  if (roleFor(state, seat) === 'oberon') {
    const successes = state.missions.filter(mission => mission.success).length
    const failures = state.missions.length - successes
    const urgency = failures === 2
      ? '邪方已经取得两次任务失败，本轮若达到失败门槛即可获胜。'
      : successes === 2
        ? '善方已经取得两次任务成功，本轮若再次成功就会进入刺杀。'
        : ''
    return `${urgency}你是奥伯伦，无法确认或协调队内其他邪方，也不会收到他们的失败票分工。根据公开任务记录、失败门槛和自身暴露风险独立选择；失败票直接推进邪方胜利，成功票必须有明确后续收益。`
  }
  const proposal = proposalFor(state)
  const leaderIndex = state.seats.indexOf(proposal.leader)
  if (leaderIndex === -1) throw new Error(`Avalon proposal leader '${proposal.leader}' is not seated`)
  const clockwiseAfterLeader = [
    ...state.seats.slice(leaderIndex + 1),
    ...state.seats.slice(0, leaderIndex + 1),
  ]
  const evilTeam = clockwiseAfterLeader.filter(candidate => (
    proposal.team.includes(candidate) && participatesInAvalonEvilNetwork(roleFor(state, candidate))
  ))
  const threshold = missionFailThreshold(state)
  const successes = state.missions.filter(mission => mission.success).length
  const failures = state.missions.length - successes
  const scoreGuidance = failures === 2 && evilTeam.length >= threshold
    ? '邪方已经取得两次任务失败；本轮达到失败门槛会立即获胜，应确保所需失败票全部提交。'
    : successes === 2 && evilTeam.length >= threshold
      ? '善方已经取得两次任务成功；若本轮失败票未达门槛，对局会立即进入刺杀。不得只为维持伪装而放行第三次成功；只有根据公开时间线判断立即刺杀梅林的胜率明确更高时，才选择成功。'
      : ''
  if (evilTeam.length < threshold) {
    return `${scoreGuidance}本轮有 ${evilTeam.length} 名邪方在队，少于 ${threshold} 票失败门槛；单独提交失败不能阻止任务成功，却会公开增加匿名失败票数。除非有明确的误导收益，否则应提交成功。`
  }
  const designated = evilTeam.slice(0, threshold)
  const ownAssignment = designated.includes(seat) ? '失败' : '成功'
  return `${scoreGuidance}失败票直接推进邪方胜利，成功票只用于有明确后续收益的伪装。若决定破坏，本轮在队邪方按队长下一席起的顺时针顺序为 ${evilTeam.join('、')}；由 ${designated.join('、')} 提交失败，其余在队邪方提交成功，避免少票或多余失败票。按此协调约定，你应提交${ownAssignment}。`
}

const phaseStrategyPrompt = (state: AvalonState, seat: SeatId): string => {
  switch (state.phase) {
    case 'proposal':
      return '当前是组队阶段。根据阵营目标、历史队伍与失败票数选择初选队伍；任务成功不等于队内全员善方，队长是否把自己选入也不能单独证明身份。'
    case 'discussion':
      return '当前是投票前发言阶段。公开发言可以诈唬，不是身份事实或任务承诺；评价初选队伍并回应已有发言。队长最后发言时必须重新判断并提交最终队伍。'
    case 'team-vote':
      return state.rejectedTeams === 4
        ? '当前是匿名队伍投票，且此前已有四次连续否决；本轮否决会让邪方立即获胜。只根据最终队伍是否推进你的阵营目标投票，不得把任务失败当作低成本试探。'
        : '当前是匿名队伍投票。只根据最终队伍是否推进你的阵营目标投票；任务失败会直接推进邪方胜利，不能当作低成本试探。'
    case 'quest':
      return isAvalonEvilRole(roleFor(state, seat))
        ? evilQuestStrategyPrompt(state, seat)
        : '当前是任务执行阶段。你的角色只能提交成功；记住任务结果不会公开个人动作。'
    case 'evil-discussion':
      return '当前是刺杀前邪方私密讨论。区分公开事实与推断，结合每名善方玩家判断队伍的准确度、引导方向和隐藏信息的克制程度提出梅林候选；匿名票型不能用来断言具名玩家的选择。'
    case 'assassination':
      return '当前是刺杀阶段。综合全部公开时间线与邪方密谈选择最可能的梅林；重点比较谁持续避开邪方或准确引导安全队伍但又刻意隐藏依据，不要只选择最受信任、最活跃或最后发言的人。'
    case 'finished':
      return '对局已经结束，无需提交新动作。'
  }
}

const roleDeckSummary = (roleDeck: readonly AvalonRole[]): string => AVALON_ROLES
  .map(role => ({ role, count: roleDeck.filter(candidate => candidate === role).length }))
  .filter(entry => entry.count > 0)
  .map(entry => `${entry.count} 名${avalonRoleLabel(entry.role)}`)
  .join('、')

/** Create one five- through eight-player Avalon definition.
 * @param config - resolved statement limit.
 * @returns configured rules.
 */
export function createAvalonDefinition(config: Required<Config>): GameDefinition<AvalonState> {
  return {
    id: 'avalon',
    rulesVersion: AVALON_RULES_VERSION,
    configSchema: {
      type: 'object', additionalProperties: false,
      properties: {
        playerCount: {
          type: 'integer', enum: [5, 6, 7, 8], default: 5,
          description: '圆桌席位数；五至八人局都支持一名人类参与或全 AI 对局。',
        },
        rolePreset: {
          type: 'string', enum: ['basic', 'percival-morgana', 'mordred-oberon'],
          default: DEFAULT_AVALON_ROLE_PRESET,
          description: '经过平衡约束的角色组合；莫德雷德与奥伯伦组合支持七人局和八人局。',
        },
        humanRole: {
          type: 'string', enum: AVALON_ROLES,
          description: '人类玩家指定身份；只有一名人类席位时可用，省略时由私有随机种子分配。',
        },
      },
    },
    validateConfig(value): GameJson {
      const candidate = value ?? {}
      const record = asRecord(candidate, 'Avalon config')
      if (Object.keys(record).some(key => key !== 'playerCount' && key !== 'rolePreset' && key !== 'humanRole')) {
        throw new Error('Avalon config has unexpected fields')
      }
      const playerCount = record.playerCount ?? 5
      if (playerCount !== 5 && playerCount !== 6 && playerCount !== 7 && playerCount !== 8) {
        throw new Error('Avalon player count must be 5, 6, 7, or 8')
      }
      const rolePreset = record.rolePreset ?? DEFAULT_AVALON_ROLE_PRESET
      if (typeof rolePreset !== 'string' || !isAvalonRolePreset(rolePreset)) {
        throw new Error('Avalon role preset is invalid')
      }
      const rules = resolveAvalonRules(playerCount, rolePreset)
      if (record.humanRole === undefined) return { playerCount, rolePreset }
      if (typeof record.humanRole !== 'string' || !isAvalonRole(record.humanRole)
        || !rules.roleDeck.includes(record.humanRole)) {
        throw new Error('Avalon human role is invalid')
      }
      return { playerCount, rolePreset, humanRole: record.humanRole }
    },
    initial({ config: matchConfig, seats, randomSeed }): readonly GameRuleEvent[] {
      const resolvedMatchConfig = matchConfig as unknown as AvalonMatchConfig
      const requestedPlayerCount = resolvedMatchConfig.playerCount
      const rolePreset = resolvedMatchConfig.rolePreset
      const rules = resolveAvalonRules(requestedPlayerCount, rolePreset)
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
      const roles = assignment(seats, rules.roleDeck, randomSeed, requestedRole)
      const leaderIndex = Number.parseInt(digest(`avalon:leader:${randomSeed}`).slice(0, 8), 16) % seats.length
      return [{ type: 'avalon/started', data: { seats: seats.map(seat => seat.id), roles, rolePreset, leaderIndex } }]
    },
    reduce(state, event): AvalonState {
      if (event.type === 'avalon/started') {
        const data = event.data as unknown as {
          seats: AvalonState['seats']
          roles: AvalonState['roles']
          rolePreset: AvalonState['rolePreset']
          leaderIndex: number
        }
        if (!isAvalonRolePreset(data.rolePreset)) throw new Error('Avalon start event has an invalid role preset')
        return {
          seats: data.seats, roles: data.roles, rolePreset: data.rolePreset,
          phase: 'proposal', leaderIndex: data.leaderIndex,
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
          data: {
            number: state.missionIndex + 1,
            team: proposal.team,
            failCount,
            success: failCount < missionFailThreshold(state),
          },
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
      const approvalVotes = Math.floor(state.seats.length / 2) + 1
      return [
        `你是 ${state.seats.length} 人阿瓦隆中的席位 ${seat}。本局采用“${avalonRolePresetInfo(state.rolePreset).label}”组合：${roleDeckSummary(rules.roleDeck)}。`,
        `五次任务的队伍人数依次为 ${rules.missionSizes.join('、')}，任务失败所需的失败票数依次为 ${rules.missionFailThresholds.join('、')}；一支队伍获得至少 ${approvalVotes} 票赞成才会通过。`,
        '任务失败票匿名提交，达到当轮门槛时任务失败，未达到时任务成功。任务记录中的失败票数是匿名失败动作的准确总数；只有邪方能提交失败，因此正数证明队内至少有同等数量的邪方，但不公开是谁。任务成功只说明失败票未达门槛，不证明队内全员属于善方。',
        '队伍投票匿名提交，结算只公开赞成票数和否决票数，不公开任何席位的选择。除你自己的已提交选择外，不得根据汇总票型断言某个席位投了赞成或否决。',
        '每次队伍投票结束后，队长顺时针交给下一席。队伍被否决时，连续否决计数增加一；任一队伍通过时，该计数立即清零，因此早先的否决不会永久占用五次机会。只有连续五支队伍都被否决或累计三次任务失败时，邪方才立即获胜。',
        '三次任务成功后，除奥伯伦外的邪方协作成员沿圆桌顺时针依次私密发言，刺客最后总结，再由刺客选择梅林目标；奥伯伦既不参与也看不到密谈。所有善方角色执行任务时只能选择成功。',
        `队长先提交初选队伍并指定顺时针或逆时针发言方向，此时队长不发言；与队长相邻的席位沿指定方向开始，${state.seats.length - 1} 名非队长依次公开发言。听完其他玩家发言后，队长最后归票发言，并在同一个动作中提交最终队伍；最终队伍可以与初选相同，也可以更换成员，随后所有玩家只对这支最终队伍投票。`,
        factionStrategyPrompt(state, seat),
        phaseStrategyPrompt(state, seat),
        '你的所有思考、分析、自然语言输出、公开发言和邪方私密发言必须使用简体中文；JSON 属性名、动作类型和席位 id 必须严格遵循动作 schema。公开发言不得泄露或引用私有身份知识；邪方私密发言可以使用规则投影提供的身份知识。规则引擎拥有最终裁决权。',
        `当前观察：${JSON.stringify(project(state, seat))}`,
      ].join('')
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
