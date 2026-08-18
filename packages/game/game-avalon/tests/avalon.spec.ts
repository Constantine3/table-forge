import { Context } from '@deepseek-ai/cordis'
import GameDefinitions, {
  ActionWindowId, GameCommandId, GameControllerRegistry, SeatId, type GameJson, type MatchSeatSpec,
} from '@deepseek-ai/dsh-game'
import GameEngine, { MemoryGamePersistence } from '@deepseek-ai/dsh-game-engine'
import { describe, expect, it } from 'vitest'
import * as Avalon from '../src/index.ts'
import { createAvalonDefinition, type AvalonRole } from '../src/index.ts'

const seats = [
  { id: SeatId('you'), displayName: 'You', controller: { type: 'human' as const } },
  { id: SeatId('ai-1'), displayName: 'AI 1', controller: { type: 'agent' as const, provider: 'p1', model: 'm1' } },
  { id: SeatId('ai-2'), displayName: 'AI 2', controller: { type: 'agent' as const, provider: 'p2', model: 'm2' } },
  { id: SeatId('ai-3'), displayName: 'AI 3', controller: { type: 'agent' as const, provider: 'p3', model: 'm3' } },
  { id: SeatId('ai-4'), displayName: 'AI 4', controller: { type: 'agent' as const, provider: 'p4', model: 'm4' } },
] as const satisfies readonly MatchSeatSpec[]

const sixSeats = [
  ...seats,
  { id: SeatId('ai-5'), displayName: 'AI 5', controller: { type: 'agent' as const, provider: 'p5', model: 'm5' } },
] as const satisfies readonly MatchSeatSpec[]

const sevenSeats = [
  ...sixSeats,
  { id: SeatId('ai-6'), displayName: 'AI 6', controller: { type: 'agent' as const, provider: 'p6', model: 'm6' } },
] as const satisfies readonly MatchSeatSpec[]

const eightSeats = [
  ...sevenSeats,
  { id: SeatId('ai-7'), displayName: 'AI 7', controller: { type: 'agent' as const, provider: 'p7', model: 'm7' } },
] as const satisfies readonly MatchSeatSpec[]

const allAiSeats = [1, 2, 3, 4, 5, 6, 7, 8].map(index => ({
  id: SeatId(`ai-${index}`), displayName: `AI ${index}`,
  controller: { type: 'agent' as const, provider: `p${index}`, model: `m${index}` },
})) satisfies readonly MatchSeatSpec[]

const isGameRecord = (value: GameJson): value is Readonly<Record<string, GameJson>> => (
  value !== null && !Array.isArray(value) && typeof value === 'object'
)

const seatWithRole = (roles: Readonly<Record<string, AvalonRole>>, role: AvalonRole): SeatId => SeatId(
  Object.entries(roles).find(([, candidate]) => candidate === role)![0],
)

const startedState = (
  matchConfig: GameJson = {},
  matchSeats: readonly MatchSeatSpec[] = seats,
) => {
  const definition = createAvalonDefinition({ maxStatementChars: 20 })
  const config = definition.validateConfig(
    isGameRecord(matchConfig)
      ? { rolePreset: 'basic', ...matchConfig }
      : matchConfig,
  )
  const events = definition.initial({ config, seats: matchSeats, randomSeed: 'fixed-seed' })
  return { definition, event: events[0]!, state: definition.reduce(undefined, events[0]!) }
}

type AvalonDefinition = ReturnType<typeof createAvalonDefinition>
type AvalonTestState = Parameters<AvalonDefinition['pending']>[0]

const completeDiscussion = (
  definition: AvalonDefinition,
  initial: AvalonTestState,
  matchSeats: readonly MatchSeatSpec[] = seats,
): AvalonTestState => {
  let state = initial
  while ((definition.view(state) as { phase: string }).phase === 'discussion') {
    const window = definition.pending(state)!
    const seat = matchSeats.find(candidate => candidate.id === window.requiredSeats[0])!
    const game = definition.view(state) as { leader: SeatId; proposal: { team: readonly SeatId[] } }
    const action = definition.action({ state, window, seat }).validate(seat.id === game.leader
      ? { type: 'make-statement', statement: '我会根据现有信息判断。', team: game.proposal.team }
      : { type: 'make-statement', statement: '我会根据现有信息判断。' })
    state = definition.reduce(state, definition.resolve({
      state, window, actions: new Map([[seat.id, action]]),
    })[0]!)
  }
  return state
}

const completeEvilDiscussion = (
  definition: AvalonDefinition,
  initial: AvalonTestState,
  matchSeats: readonly MatchSeatSpec[] = seats,
): AvalonTestState => {
  let state = initial
  while ((definition.view(state) as { phase: string }).phase === 'evil-discussion') {
    const window = definition.pending(state)!
    const seat = matchSeats.find(candidate => candidate.id === window.requiredSeats[0])!
    const action = definition.action({ state, window, seat }).validate({
      type: 'make-evil-statement', statement: '我建议刺杀最像梅林的玩家。',
    })
    state = definition.reduce(state, definition.resolve({
      state, window, actions: new Map([[seat.id, action]]),
    })[0]!)
  }
  return state
}

describe('Avalon definition', () => {
  it('assigns the fixed roles and leader deterministically without public leakage', () => {
    const { definition, event, state } = startedState()
    const repeated = definition.initial({ config: { playerCount: 5, rolePreset: 'basic' }, seats, randomSeed: 'fixed-seed' })
    expect(repeated).toEqual([event])
    const roles = (event.data as { roles: Record<string, AvalonRole> }).roles
    expect(Object.values(roles).sort()).toEqual(['assassin', 'loyal-servant', 'loyal-servant', 'merlin', 'minion'])
    expect(definition.view(state)).not.toHaveProperty('roles')
    for (const seat of seats) {
      expect(definition.view(state, seat.id)).toMatchObject({ private: { role: roles[seat.id] } })
    }
    const merlin = Object.entries(roles).find(([, role]) => role === 'merlin')![0]
    expect(definition.view(state, SeatId(merlin))).toMatchObject({
      private: { knowledge: [{ kind: 'evil' }, { kind: 'evil' }] },
    })

    for (const humanRole of ['merlin', 'loyal-servant', 'assassin', 'minion'] as const) {
      const config = definition.validateConfig({ rolePreset: 'basic', humanRole })
      const selected = definition.initial({ config, seats, randomSeed: 'fixed-seed' })[0]!
      const selectedRoles = (selected.data as { roles: Record<string, AvalonRole> }).roles
      expect(selectedRoles['you']).toBe(humanRole)
      expect(Object.values(selectedRoles).sort()).toEqual([
        'assassin', 'loyal-servant', 'loyal-servant', 'merlin', 'minion',
      ])
    }
  })

  it('assigns every role privately for every supported all-AI table size', () => {
    const definition = createAvalonDefinition({ maxStatementChars: 20 })
    for (const [playerCount, matchSeats, loyalCount, minionCount] of [
      [5, allAiSeats.slice(0, 5), 2, 1],
      [6, allAiSeats.slice(0, 6), 3, 1],
      [7, allAiSeats.slice(0, 7), 3, 2],
      [8, allAiSeats, 4, 2],
    ] as const) {
      const config = definition.validateConfig({ playerCount, rolePreset: 'basic' })
      const event = definition.initial({ config, seats: matchSeats, randomSeed: `all-ai-${playerCount}` })[0]!
      const state = definition.reduce(undefined, event)
      const roles = (event.data as { roles: Record<string, AvalonRole> }).roles
      expect(Object.values(roles).filter(role => role === 'loyal-servant')).toHaveLength(loyalCount)
      expect(Object.values(roles).filter(role => role === 'minion')).toHaveLength(minionCount)
      expect(Object.keys(roles)).toHaveLength(playerCount)
      expect(definition.view(state)).not.toHaveProperty('private')
      for (const seat of matchSeats) {
        expect(definition.view(state, seat.id)).toMatchObject({ private: { role: roles[seat.id] } })
      }
      expect(definition.pending(state)?.requiredSeats).toHaveLength(1)
    }
  })

  it('rejects persisted state that omits an owned role assignment', () => {
    const definition = createAvalonDefinition({ maxStatementChars: 80 })
    const state = definition.reduce(undefined, {
      type: 'avalon/started',
      data: { seats: seats.map(seat => seat.id), roles: { you: 'merlin' }, rolePreset: 'basic', leaderIndex: 0 },
    })
    expect(() => definition.view(state, seats[0].id)).toThrow(/missing role/)
    const invalidTable = definition.reduce(undefined, {
      type: 'avalon/started',
      data: {
        seats: seats.slice(0, 4).map(seat => seat.id),
        roles: { you: 'merlin', 'ai-1': 'assassin', 'ai-2': 'loyal-servant', 'ai-3': 'minion' },
        rolePreset: 'basic',
        leaderIndex: 0,
      },
    })
    expect(() => definition.view(invalidTable)).toThrow(/requires exactly five, six, seven, or eight seats/)
    const wrongDeck = definition.reduce(undefined, {
      type: 'avalon/started',
      data: {
        seats: seats.map(seat => seat.id), rolePreset: 'basic', leaderIndex: 0,
        roles: {
          you: 'merlin', 'ai-1': 'assassin', 'ai-2': 'assassin',
          'ai-3': 'loyal-servant', 'ai-4': 'loyal-servant',
        },
      },
    })
    expect(() => definition.view(wrongDeck)).toThrow(/do not match the selected role preset/)
    expect(() => definition.reduce(undefined, {
      type: 'avalon/started',
      data: { seats: seats.map(seat => seat.id), roles: {}, rolePreset: 'custom', leaderIndex: 0 },
    })).toThrow(/invalid role preset/)
  })

  it('validates setup, structured statements, teams, and role-scoped quest actions', () => {
    const { definition, state } = startedState()
    expect(definition.validateConfig(null)).toEqual({ playerCount: 5, rolePreset: 'percival-morgana' })
    expect(definition.validateConfig({ humanRole: 'assassin' })).toEqual({
      playerCount: 5, rolePreset: 'percival-morgana', humanRole: 'assassin',
    })
    expect(definition.validateConfig({ playerCount: 6 })).toEqual({ playerCount: 6, rolePreset: 'percival-morgana' })
    expect(definition.validateConfig({ playerCount: 7 })).toEqual({ playerCount: 7, rolePreset: 'percival-morgana' })
    expect(definition.validateConfig({ playerCount: 8 })).toEqual({ playerCount: 8, rolePreset: 'percival-morgana' })
    expect(() => definition.validateConfig({ variant: 'custom' })).toThrow(/unexpected fields/)
    expect(() => definition.validateConfig({ playerCount: 4 })).toThrow(/must be 5, 6, 7, or 8/)
    expect(() => definition.validateConfig({ playerCount: 5.5 })).toThrow(/must be 5, 6, 7, or 8/)
    expect(() => definition.validateConfig({ rolePreset: 'custom' })).toThrow(/role preset is invalid/)
    expect(() => definition.validateConfig({
      playerCount: 5, rolePreset: 'mordred-oberon',
    })).toThrow(/does not support 5 players/)
    expect(definition.validateConfig({ humanRole: 'percival' })).toEqual({
      playerCount: 5, rolePreset: 'percival-morgana', humanRole: 'percival',
    })
    expect(() => definition.validateConfig({ humanRole: 'mordred' })).toThrow(/human role is invalid/)
    expect(() => definition.validateConfig({ humanRole: 1 })).toThrow(/human role is invalid/)
    expect(() => definition.initial({
      config: { playerCount: 5, rolePreset: 'basic' }, seats: seats.slice(0, 4), randomSeed: 'short',
    })).toThrow(/5-player setup requires exactly 5 seats/)
    expect(() => definition.initial({
      config: { playerCount: 5, rolePreset: 'basic' }, randomSeed: 'humans',
      seats: seats.map(seat => ({ ...seat, controller: { type: 'human' as const } })),
    })).toThrow(/either 5 AI seats or one human seat and 4 AI seats/)
    expect(() => definition.initial({
      config: { playerCount: 5, rolePreset: 'basic', humanRole: 'merlin' }, randomSeed: 'all-ai-role',
      seats: allAiSeats.slice(0, 5),
    })).toThrow(/humanRole requires exactly one human seat/)

    const proposalWindow = definition.pending(state)!
    const leader = seats.find(seat => seat.id === proposalWindow.requiredSeats[0])!
    const proposalSpec = definition.action({ state, window: proposalWindow, seat: leader })
    expect(() => proposalSpec.validate({ type: 'propose-team', team: ['you', 'you'], direction: 'clockwise' })).toThrow(/unique/)
    const proposal = proposalSpec.validate({ type: 'propose-team', team: ['you', 'ai-1'], direction: 'clockwise' })
    const proposed = definition.reduce(state, definition.resolve({
      state, window: proposalWindow, actions: new Map([[leader.id, proposal]]),
    })[0]!)
    expect(definition.view(proposed)).toMatchObject({
      phase: 'discussion', proposal: { leader: leader.id, direction: 'clockwise' }, statements: [],
    })
    const discussionWindow = definition.pending(proposed)!
    const aiStatement = definition.action({ state: proposed, window: discussionWindow, seat: seats[1] })
    expect(() => aiStatement.validate({ type: 'make-statement', statement: 'English only' })).toThrow(/Chinese text/)
    const discussed = completeDiscussion(definition, proposed)
    const voteWindow = definition.pending(discussed)!
    const voteActions = new Map(seats.map(seat => [
      seat.id,
      definition.action({ state: discussed, window: voteWindow, seat }).validate({ type: 'vote-team', approve: true }),
    ]))
    const quest = definition.reduce(discussed, definition.resolve({ state: discussed, window: voteWindow, actions: voteActions })[0]!)
    const questWindow = definition.pending(quest)!
    const roles = (definition.view(quest, seats[0].id) as { private: { role: AvalonRole } }).private
    const humanSpec = definition.action({ state: quest, window: questWindow, seat: seats[0] })
    if (roles.role === 'assassin' || roles.role === 'minion') {
      expect(humanSpec.validate({ type: 'quest', outcome: 'fail' })).toEqual({ type: 'quest', outcome: 'fail' })
    } else {
      expect(() => humanSpec.validate({ type: 'quest', outcome: 'fail' })).toThrow(/not permitted/)
    }
  })

  it('applies the six-player role deck, mission sizes, discussion length, and vote threshold', () => {
    const { definition, event, state } = startedState({ playerCount: 6, humanRole: 'loyal-servant' }, sixSeats)
    const roles = (event.data as { roles: Record<string, AvalonRole> }).roles
    expect(roles['you']).toBe('loyal-servant')
    expect(Object.values(roles).sort()).toEqual([
      'assassin', 'loyal-servant', 'loyal-servant', 'loyal-servant', 'merlin', 'minion',
    ])
    expect(definition.view(state)).toMatchObject({
      playerCount: 6, missionNumber: 1, teamSize: 2, missionSizes: [2, 3, 4, 3, 4],
    })

    let missionState = state
    const outcomes = [false, false, true, true] as const
    const expectedSizes = [2, 3, 4, 3, 4] as const
    for (const [index, expectedSize] of expectedSizes.entries()) {
      expect(definition.view(missionState)).toMatchObject({ missionNumber: index + 1, teamSize: expectedSize })
      if (index < outcomes.length) {
        const success = outcomes[index]!
        missionState = definition.reduce(missionState, {
          type: 'avalon/quest-resolved',
          data: {
            number: index + 1,
            team: sixSeats.slice(0, expectedSize).map(seat => seat.id),
            failCount: success ? 0 : 1,
            success,
          },
        })
      }
    }

    const leader = (definition.view(state) as { leader: SeatId }).leader
    const proposed = definition.reduce(state, {
      type: 'avalon/team-proposed', data: { leader, team: ['you', 'ai-1'], direction: 'clockwise' },
    })
    const discussed = completeDiscussion(definition, proposed, sixSeats)
    expect((definition.view(discussed) as { statements: unknown[] }).statements).toHaveLength(6)
    const voteWindow = definition.pending(discussed)!
    const tiedVote = definition.resolve({
      state: discussed, window: voteWindow,
      actions: new Map(sixSeats.map((seat, index) => [seat.id, { type: 'vote-team', approve: index < 3 }])),
    })[0]!
    expect(tiedVote).toMatchObject({ data: { approveCount: 3, rejectCount: 3, approved: false } })
    const approvedVote = definition.resolve({
      state: discussed, window: voteWindow,
      actions: new Map(sixSeats.map((seat, index) => [seat.id, { type: 'vote-team', approve: index < 4 }])),
    })[0]!
    expect(approvedVote).toMatchObject({ data: { approveCount: 4, rejectCount: 2, approved: true } })
    expect(definition.modelPrompt(state, sixSeats[0].id)).toContain('你是 6 人阿瓦隆')
    expect(definition.modelPrompt(state, sixSeats[0].id)).toContain('2、3、4、3、4，任务失败所需的失败票数依次为 1、1、1、1、1')
    expect(definition.modelPrompt(state, sixSeats[0].id)).toContain('至少 4 票赞成')
    expect(definition.modelPrompt(state, sixSeats[0].id)).toContain('5 名非队长依次公开发言')
  })

  it('applies the seven-player role deck, mission rules, discussion length, and vote threshold', () => {
    const { definition, event, state } = startedState({ playerCount: 7, humanRole: 'loyal-servant' }, sevenSeats)
    const roles = (event.data as { roles: Record<string, AvalonRole> }).roles
    expect(roles['you']).toBe('loyal-servant')
    expect(Object.values(roles).sort()).toEqual([
      'assassin', 'loyal-servant', 'loyal-servant', 'loyal-servant', 'merlin', 'minion', 'minion',
    ])
    expect(definition.view(state)).toMatchObject({
      playerCount: 7,
      missionNumber: 1,
      teamSize: 2,
      failThreshold: 1,
      missionSizes: [2, 3, 3, 4, 4],
      missionFailThresholds: [1, 1, 1, 2, 1],
    })

    const leader = (definition.view(state) as { leader: SeatId }).leader
    const proposed = definition.reduce(state, {
      type: 'avalon/team-proposed', data: { leader, team: ['you', 'ai-1'], direction: 'clockwise' },
    })
    const discussed = completeDiscussion(definition, proposed, sevenSeats)
    expect((definition.view(discussed) as { statements: unknown[] }).statements).toHaveLength(7)
    const voteWindow = definition.pending(discussed)!
    const rejectedVote = definition.resolve({
      state: discussed, window: voteWindow,
      actions: new Map(sevenSeats.map((seat, index) => [seat.id, { type: 'vote-team', approve: index < 3 }])),
    })[0]!
    expect(rejectedVote).toMatchObject({ data: { approveCount: 3, rejectCount: 4, approved: false } })
    const approvedVote = definition.resolve({
      state: discussed, window: voteWindow,
      actions: new Map(sevenSeats.map((seat, index) => [seat.id, { type: 'vote-team', approve: index < 4 }])),
    })[0]!
    expect(approvedVote).toMatchObject({ data: { approveCount: 4, rejectCount: 3, approved: true } })

    let fourthMission = state
    for (const [index, success] of [true, false, true].entries()) {
      fourthMission = definition.reduce(fourthMission, {
        type: 'avalon/quest-resolved',
        data: {
          number: index + 1,
          team: sevenSeats.slice(0, [2, 3, 3][index]).map(seat => seat.id),
          failCount: success ? 0 : 1,
          success,
        },
      })
    }
    expect(definition.view(fourthMission)).toMatchObject({ missionNumber: 4, teamSize: 4, failThreshold: 2 })
    const evilSeats = sevenSeats.filter(seat => roles[seat.id] === 'assassin' || roles[seat.id] === 'minion')
    const goodSeats = sevenSeats.filter(seat => roles[seat.id] === 'merlin' || roles[seat.id] === 'loyal-servant')
    const fourthTeam = [...evilSeats.slice(0, 2), ...goodSeats.slice(0, 2)].map(seat => seat.id)
    const fourthLeader = (definition.view(fourthMission) as { leader: SeatId }).leader
    const fourthProposed = definition.reduce(fourthMission, {
      type: 'avalon/team-proposed', data: { leader: fourthLeader, team: fourthTeam, direction: 'clockwise' },
    })
    const fourthDiscussed = completeDiscussion(definition, fourthProposed, sevenSeats)
    const fourthQuest = definition.reduce(fourthDiscussed, definition.resolve({
      state: fourthDiscussed,
      window: definition.pending(fourthDiscussed)!,
      actions: new Map(sevenSeats.map(seat => [seat.id, { type: 'vote-team', approve: true }])),
    })[0]!)
    const fourthWindow = definition.pending(fourthQuest)!
    const resolveFourthMission = (failCount: number) => definition.resolve({
      state: fourthQuest,
      window: fourthWindow,
      actions: new Map(fourthTeam.map((seatId, index) => [
        seatId, { type: 'quest', outcome: index < failCount ? 'fail' : 'success' },
      ])),
    })[0]!
    expect(resolveFourthMission(1)).toMatchObject({ data: { number: 4, failCount: 1, success: true } })
    expect(resolveFourthMission(2)).toMatchObject({ data: { number: 4, failCount: 2, success: false } })

    let evilDiscussion = state
    for (let number = 1; number <= 3; number += 1) evilDiscussion = definition.reduce(evilDiscussion, {
      type: 'avalon/quest-resolved', data: { number, team: ['you', 'ai-1'], failCount: 0, success: true },
    })
    const evilSpeakers: SeatId[] = []
    while ((definition.view(evilDiscussion) as { phase: string }).phase === 'evil-discussion') {
      const speaker = definition.pending(evilDiscussion)!.requiredSeats[0]!
      evilSpeakers.push(speaker)
      evilDiscussion = definition.reduce(evilDiscussion, {
        type: 'avalon/evil-statement-made', data: { seatId: speaker, statement: '私下讨论刺杀目标。' },
      })
    }
    expect(evilSpeakers).toHaveLength(3)
    expect(roles[evilSpeakers.at(-1)!]).toBe('assassin')

    const prompt = definition.modelPrompt(state, sevenSeats[0].id)
    expect(prompt).toContain('你是 7 人阿瓦隆')
    expect(prompt).toContain('1 名梅林、3 名亚瑟的忠臣、1 名刺客、2 名莫德雷德的爪牙')
    expect(prompt).toContain('2、3、3、4、4，任务失败所需的失败票数依次为 1、1、1、2、1')
    expect(prompt).toContain('至少 4 票赞成')
    expect(prompt).toContain('6 名非队长依次公开发言')
  })

  it('applies the eight-player advanced deck, mission rules, discussion length, and vote threshold', () => {
    const { definition, event, state } = startedState({
      playerCount: 8, rolePreset: 'mordred-oberon', humanRole: 'oberon',
    }, eightSeats)
    const roles = (event.data as { roles: Record<string, AvalonRole> }).roles
    expect(roles['you']).toBe('oberon')
    expect(Object.values(roles).sort()).toEqual([
      'assassin', 'loyal-servant', 'loyal-servant', 'loyal-servant', 'loyal-servant', 'merlin', 'mordred', 'oberon',
    ])
    expect(definition.view(state)).toMatchObject({
      playerCount: 8,
      missionNumber: 1,
      teamSize: 3,
      failThreshold: 1,
      missionSizes: [3, 4, 4, 5, 5],
      missionFailThresholds: [1, 1, 1, 2, 1],
    })

    const leader = (definition.view(state) as { leader: SeatId }).leader
    const proposed = definition.reduce(state, {
      type: 'avalon/team-proposed',
      data: { leader, team: eightSeats.slice(0, 3).map(seat => seat.id), direction: 'clockwise' },
    })
    const discussed = completeDiscussion(definition, proposed, eightSeats)
    expect((definition.view(discussed) as { statements: unknown[] }).statements).toHaveLength(8)
    const voteWindow = definition.pending(discussed)!
    expect(definition.resolve({
      state: discussed, window: voteWindow,
      actions: new Map(eightSeats.map((seat, index) => [seat.id, { type: 'vote-team', approve: index < 4 }])),
    })[0]).toMatchObject({ data: { approveCount: 4, rejectCount: 4, approved: false } })
    expect(definition.resolve({
      state: discussed, window: voteWindow,
      actions: new Map(eightSeats.map((seat, index) => [seat.id, { type: 'vote-team', approve: index < 5 }])),
    })[0]).toMatchObject({ data: { approveCount: 5, rejectCount: 3, approved: true } })

    let fourthMission = state
    for (const [index, success] of [true, false, true].entries()) {
      fourthMission = definition.reduce(fourthMission, {
        type: 'avalon/quest-resolved',
        data: {
          number: index + 1,
          team: eightSeats.slice(0, [3, 4, 4][index]).map(seat => seat.id),
          failCount: success ? 0 : 1,
          success,
        },
      })
    }
    expect(definition.view(fourthMission)).toMatchObject({ missionNumber: 4, teamSize: 5, failThreshold: 2 })

    const prompt = definition.modelPrompt(state, eightSeats[0].id)
    expect(prompt).toContain('你是 8 人阿瓦隆')
    expect(prompt).toContain('1 名梅林、4 名亚瑟的忠臣、1 名刺客、1 名莫德雷德、1 名奥伯伦')
    expect(prompt).toContain('3、4、4、5、5，任务失败所需的失败票数依次为 1、1、1、2、1')
    expect(prompt).toContain('至少 5 票赞成')
    expect(prompt).toContain('7 名非队长依次公开发言')
  })

  it('projects Percival and Morgana as an indistinguishable candidate pair', () => {
    const { definition, event, state } = startedState({
      playerCount: 5, rolePreset: 'percival-morgana',
    })
    const roles = (event.data as { roles: Record<string, AvalonRole> }).roles
    const percival = seatWithRole(roles, 'percival')
    const merlin = seatWithRole(roles, 'merlin')
    const morgana = seatWithRole(roles, 'morgana')
    const assassin = seatWithRole(roles, 'assassin')

    expect(definition.view(state)).toMatchObject({
      rolePreset: 'percival-morgana',
      roleDeck: ['merlin', 'percival', 'loyal-servant', 'assassin', 'morgana'],
    })
    const percivalPrivate = (definition.view(state, percival) as {
      private: { role: AvalonRole; knowledge: Array<{ kind: string; seatId: SeatId }> }
    }).private
    expect(percivalPrivate.role).toBe('percival')
    expect(percivalPrivate.knowledge).toHaveLength(2)
    expect(percivalPrivate.knowledge).toEqual(expect.arrayContaining([
      { kind: 'merlin-candidate', seatId: merlin },
      { kind: 'merlin-candidate', seatId: morgana },
    ]))
    expect(definition.view(state, morgana)).toMatchObject({
      private: { knowledge: [{ kind: 'evil-ally', seatId: assassin, role: 'assassin' }] },
    })
    expect(definition.modelPrompt(state, percival)).toContain('不能直接分辨')
    expect(definition.modelPrompt(state, morgana)).toContain('作为假梅林')
  })

  it('keeps Mordred hidden from Merlin and Oberon outside evil coordination', () => {
    const { definition, event, state } = startedState({
      playerCount: 7, rolePreset: 'mordred-oberon',
    }, sevenSeats)
    const roles = (event.data as { roles: Record<string, AvalonRole> }).roles
    const merlin = seatWithRole(roles, 'merlin')
    const assassin = seatWithRole(roles, 'assassin')
    const mordred = seatWithRole(roles, 'mordred')
    const oberon = seatWithRole(roles, 'oberon')
    const merlinKnowledge = (definition.view(state, merlin) as {
      private: { knowledge: Array<{ kind: string; seatId: SeatId }> }
    }).private.knowledge
    expect(merlinKnowledge).toEqual(expect.arrayContaining([
      { kind: 'evil', seatId: assassin },
      { kind: 'evil', seatId: oberon },
    ]))
    expect(merlinKnowledge).not.toContainEqual({ kind: 'evil', seatId: mordred })
    expect(definition.view(state, assassin)).toMatchObject({
      private: { knowledge: [{ kind: 'evil-ally', seatId: mordred, role: 'mordred' }] },
    })
    expect(definition.view(state, oberon)).toMatchObject({ private: { knowledge: [] } })
    expect(definition.modelPrompt(state, merlin)).toContain('莫德雷德，他不会出现在你的邪方视野中')
    expect(definition.modelPrompt(state, mordred)).toContain('梅林看不到你')
    expect(definition.modelPrompt(state, oberon)).toContain('不认识其他邪方')

    const enterOberonQuest = (initial: AvalonTestState): AvalonTestState => {
      const view = definition.view(initial) as { leader: SeatId; teamSize: number }
      const team = [assassin, oberon, ...sevenSeats.map(seat => seat.id)
        .filter(seatId => seatId !== assassin && seatId !== oberon)].slice(0, view.teamSize)
      const proposed = definition.reduce(initial, {
        type: 'avalon/team-proposed',
        data: { leader: view.leader, team, direction: 'clockwise' },
      })
      const discussed = completeDiscussion(definition, proposed, sevenSeats)
      return definition.reduce(discussed, definition.resolve({
        state: discussed,
        window: definition.pending(discussed)!,
        actions: new Map(sevenSeats.map(seat => [seat.id, { type: 'vote-team', approve: true }])),
      })[0]!)
    }
    const quest = enterOberonQuest(state)
    expect(definition.modelPrompt(quest, oberon)).toContain('不会收到他们的失败票分工')
    expect(definition.modelPrompt(quest, assassin)).toContain(`由 ${assassin} 提交失败`)
    expect(definition.modelPrompt(quest, assassin)).not.toContain(`由 ${oberon} 提交失败`)
    const oberonSeat = sevenSeats.find(seat => seat.id === oberon)!
    expect(definition.action({ state: quest, window: definition.pending(quest)!, seat: oberonSeat })
      .validate({ type: 'quest', outcome: 'fail' })).toEqual({ type: 'quest', outcome: 'fail' })
    const scoredQuest = (success: boolean): AvalonTestState => {
      let scored = state
      for (let number = 1; number <= 2; number += 1) scored = definition.reduce(scored, {
        type: 'avalon/quest-resolved',
        data: { number, team: [merlin, assassin], failCount: success ? 0 : 1, success },
      })
      return enterOberonQuest(scored)
    }
    expect(definition.modelPrompt(scoredQuest(false), oberon)).toContain('邪方已经取得两次任务失败')
    expect(definition.modelPrompt(scoredQuest(true), oberon)).toContain('善方已经取得两次任务成功')

    let evilDiscussion = state
    for (let number = 1; number <= 3; number += 1) evilDiscussion = definition.reduce(evilDiscussion, {
      type: 'avalon/quest-resolved',
      data: { number, team: [merlin, assassin], failCount: 0, success: true },
    })
    const speakers: SeatId[] = []
    while ((definition.view(evilDiscussion) as { phase: string }).phase === 'evil-discussion') {
      const speaker = definition.pending(evilDiscussion)!.requiredSeats[0]!
      speakers.push(speaker)
      evilDiscussion = definition.reduce(evilDiscussion, {
        type: 'avalon/evil-statement-made', data: { seatId: speaker, statement: '讨论刺杀目标。' },
      })
    }
    expect(speakers).toHaveLength(2)
    expect(speakers).toContain(mordred)
    expect(speakers).not.toContain(oberon)
    expect(speakers.at(-1)).toBe(assassin)
    expect(definition.view(evilDiscussion, oberon)).not.toHaveProperty('evilDiscussion')
  })

  it('gives each faction phase-specific strategy and coordinates evil quest actions', () => {
    const definition = createAvalonDefinition({ maxStatementChars: 80 })
    const roles = {
      you: 'merlin',
      'ai-1': 'assassin',
      'ai-2': 'loyal-servant',
      'ai-3': 'minion',
      'ai-4': 'loyal-servant',
      'ai-5': 'minion',
      'ai-6': 'loyal-servant',
    } as const satisfies Readonly<Record<string, AvalonRole>>
    const started = (): AvalonTestState => definition.reduce(undefined, {
      type: 'avalon/started',
      data: { seats: sevenSeats.map(seat => seat.id), roles, rolePreset: 'basic', leaderIndex: 0 },
    })
    const afterMissions = (results: readonly boolean[]): AvalonTestState => results.reduce((state, success, index) => (
      definition.reduce(state, {
        type: 'avalon/quest-resolved',
        data: {
          number: index + 1,
          team: sevenSeats.slice(0, [2, 3, 3, 4, 4][index]).map(seat => seat.id),
          failCount: success ? 0 : 1,
          success,
        },
      })
    ), started())
    const enterQuest = (state: AvalonTestState, team: readonly SeatId[]): AvalonTestState => {
      const leader = (definition.view(state) as { leader: SeatId }).leader
      const proposed = definition.reduce(state, {
        type: 'avalon/team-proposed', data: { leader, team, direction: 'clockwise' },
      })
      const discussed = completeDiscussion(definition, proposed, sevenSeats)
      return definition.reduce(discussed, definition.resolve({
        state: discussed,
        window: definition.pending(discussed)!,
        actions: new Map(sevenSeats.map(seat => [seat.id, { type: 'vote-team', approve: true }])),
      })[0]!)
    }

    const merlinProposal = definition.modelPrompt(started(), SeatId('you'))
    expect(merlinProposal).toContain('不得只为隐藏梅林而故意放过你明知危险的队伍')
    expect(merlinProposal).toContain('任务成功只说明失败票未达门槛，不证明队内全员属于善方')
    expect(merlinProposal).toContain('不得根据汇总票型断言某个席位投了赞成或否决')
    expect(merlinProposal).toContain('当前是组队阶段')
    expect(definition.modelPrompt(started(), SeatId('ai-2'))).toContain('你没有额外身份知识')
    expect(definition.modelPrompt(started(), SeatId('ai-1'))).toContain('隐藏身份和让任务成功只能是达成胜利的手段')

    const leader = (definition.view(started()) as { leader: SeatId }).leader
    const proposed = definition.reduce(started(), {
      type: 'avalon/team-proposed', data: { leader, team: ['ai-1', 'you'], direction: 'clockwise' },
    })
    expect(definition.modelPrompt(proposed, SeatId('ai-2'))).toContain('公开发言可以诈唬，不是身份事实或任务承诺')
    const discussed = completeDiscussion(definition, proposed, sevenSeats)
    expect(definition.modelPrompt(discussed, SeatId('ai-2'))).toContain('任务失败会直接推进邪方胜利，不能当作低成本试探')

    const openingQuest = enterQuest(started(), [SeatId('ai-1'), SeatId('you')])
    expect(definition.modelPrompt(openingQuest, SeatId('you'))).toContain('你的角色只能提交成功')
    expect(definition.modelPrompt(openingQuest, SeatId('ai-1'))).toContain('由 ai-1 提交失败')

    const goodAtTwo = enterQuest(afterMissions([true, true]), [SeatId('ai-1'), SeatId('ai-3'), SeatId('you')])
    const designatedPrompt = definition.modelPrompt(goodAtTwo, SeatId('ai-1'))
    expect(designatedPrompt).toContain('不得只为维持伪装而放行第三次成功')
    expect(designatedPrompt).toContain('本轮在队邪方按队长下一席起的顺时针顺序为 ai-1、ai-3')
    expect(designatedPrompt).toContain('按此协调约定，你应提交失败')
    expect(definition.modelPrompt(goodAtTwo, SeatId('ai-3'))).toContain('按此协调约定，你应提交成功')

    const evilAtTwo = enterQuest(afterMissions([false, false]), [SeatId('ai-1'), SeatId('ai-3'), SeatId('you')])
    expect(definition.modelPrompt(evilAtTwo, SeatId('ai-1'))).toContain('本轮达到失败门槛会立即获胜，应确保所需失败票全部提交')

    const fourthMission = afterMissions([true, false, true])
    const insufficientQuest = enterQuest(fourthMission, [
      SeatId('ai-1'), SeatId('you'), SeatId('ai-2'), SeatId('ai-4'),
    ])
    expect(definition.modelPrompt(insufficientQuest, SeatId('ai-1'))).toContain('少于 2 票失败门槛')
    expect(definition.modelPrompt(insufficientQuest, SeatId('ai-1'))).toContain('单独提交失败不能阻止任务成功')
    const coordinatedQuest = enterQuest(fourthMission, [
      SeatId('ai-1'), SeatId('ai-3'), SeatId('ai-5'), SeatId('you'),
    ])
    expect(definition.modelPrompt(coordinatedQuest, SeatId('ai-3'))).toContain('由 ai-1、ai-3 提交失败')
    expect(definition.modelPrompt(coordinatedQuest, SeatId('ai-5'))).toContain('按此协调约定，你应提交成功')

    let fourRejected = started()
    for (let count = 0; count < 4; count += 1) {
      const roundLeader = (definition.view(fourRejected) as { leader: SeatId }).leader
      const roundProposed = definition.reduce(fourRejected, {
        type: 'avalon/team-proposed', data: { leader: roundLeader, team: ['you', 'ai-2'], direction: 'clockwise' },
      })
      const roundDiscussed = completeDiscussion(definition, roundProposed, sevenSeats)
      const rejected = definition.resolve({
        state: roundDiscussed,
        window: definition.pending(roundDiscussed)!,
        actions: new Map(sevenSeats.map((seat, index) => [seat.id, { type: 'vote-team', approve: index < 3 }])),
      })[0]!
      fourRejected = definition.reduce(roundDiscussed, rejected)
    }
    const fifthLeader = (definition.view(fourRejected) as { leader: SeatId }).leader
    const fifthProposed = definition.reduce(fourRejected, {
      type: 'avalon/team-proposed', data: { leader: fifthLeader, team: ['you', 'ai-2'], direction: 'clockwise' },
    })
    const fifthVote = completeDiscussion(definition, fifthProposed, sevenSeats)
    expect(definition.modelPrompt(fifthVote, SeatId('ai-2'))).toContain('本轮否决会让邪方立即获胜')

    let evilDiscussion = afterMissions([true, true, true])
    const evilSpeaker = definition.pending(evilDiscussion)!.requiredSeats[0]!
    expect(definition.modelPrompt(evilDiscussion, evilSpeaker)).toContain('区分公开事实与推断')
    evilDiscussion = completeEvilDiscussion(definition, evilDiscussion, sevenSeats)
    expect(definition.modelPrompt(evilDiscussion, SeatId('ai-1'))).toContain('不要只选择最受信任、最活跃或最后发言的人')
    const finished = definition.reduce(evilDiscussion, {
      type: 'avalon/assassination-resolved', data: { target: 'you', hitMerlin: true },
    })
    expect(definition.modelPrompt(finished, SeatId('ai-1'))).toContain('对局已经结束，无需提交新动作')

    const invalidProposal = definition.reduce(started(), {
      type: 'avalon/team-proposed', data: { leader: 'outsider', team: ['ai-1', 'you'], direction: 'clockwise' },
    })
    const invalidQuest = definition.reduce(invalidProposal, {
      type: 'avalon/team-vote-resolved',
      data: {
        proposal: { leader: 'outsider', team: ['ai-1', 'you'], direction: 'clockwise' },
        statements: [], approveCount: 7, rejectCount: 0, approved: true,
      },
    })
    expect(() => definition.modelPrompt(invalidQuest, SeatId('ai-1'))).toThrow(/proposal leader 'outsider' is not seated/)
  })

  it('rejects every malformed phase action and exposes only role-permitted choices', () => {
    const { definition, event, state } = startedState()
    const roles = (event.data as { roles: Record<string, AvalonRole> }).roles
    expect(() => definition.validateConfig(false)).toThrow(/must be an object/)

    const proposalWindow = definition.pending(state)!
    const leader = seats.find(seat => seat.id === proposalWindow.requiredSeats[0])!
    const proposal = definition.action({ state, window: proposalWindow, seat: leader })
    expect(() => proposal.validate(null)).toThrow(/must be an object/)
    expect(() => proposal.validate({ type: 'propose-team', team: ['you', 'ai-1'], direction: 'clockwise', extra: true })).toThrow(/unexpected fields/)
    expect(() => proposal.validate({ type: 'propose-team', team: ['you', 'ai-1'] })).toThrow(/unexpected fields/)
    expect(() => proposal.validate({ type: 'other', team: ['you', 'ai-1'], direction: 'clockwise' })).toThrow(/proposal is invalid/)
    expect(() => proposal.validate({ type: 'propose-team', team: 'you', direction: 'clockwise' })).toThrow(/proposal is invalid/)
    expect(() => proposal.validate({ type: 'propose-team', team: ['you'], direction: 'clockwise' })).toThrow(/2 unique/)
    expect(() => proposal.validate({ type: 'propose-team', team: ['you', 1], direction: 'clockwise' })).toThrow(/2 unique/)
    expect(() => proposal.validate({ type: 'propose-team', team: ['you', 'outsider'], direction: 'clockwise' })).toThrow(/2 unique/)
    expect(() => proposal.validate({ type: 'propose-team', team: ['you', 'ai-1'], direction: 'sideways' })).toThrow(/clockwise or counterclockwise/)

    const proposalAction = proposal.validate({ type: 'propose-team', team: ['you', 'ai-1'], direction: 'clockwise' })
    const proposed = definition.reduce(state, definition.resolve({
      state, window: proposalWindow, actions: new Map([[leader.id, proposalAction]]),
    })[0]!)
    const discussionWindow = definition.pending(proposed)!
    const speaker = seats.find(seat => seat.id === discussionWindow.requiredSeats[0])!
    const discussion = definition.action({ state: proposed, window: discussionWindow, seat: speaker })
    expect(() => discussion.validate({ type: 'make-statement', statement: '发言', extra: true })).toThrow(/unexpected fields/)
    expect(() => discussion.validate({ type: 'other', statement: '发言' })).toThrow(/discussion statement is invalid/)
    expect(() => discussion.validate({ type: 'make-statement', statement: '' })).toThrow(/1 through 20/)
    expect(() => discussion.validate({ type: 'make-statement', statement: 'x'.repeat(21) })).toThrow(/1 through 20/)

    let leaderTurn = proposed
    while (definition.pending(leaderTurn)!.requiredSeats[0] !== leader.id) {
      const seatId = definition.pending(leaderTurn)!.requiredSeats[0]!
      leaderTurn = definition.reduce(leaderTurn, {
        type: 'avalon/statement-made', data: { seatId, statement: '依次发言。' },
      })
    }
    const leaderSpec = definition.action({ state: leaderTurn, window: definition.pending(leaderTurn)!, seat: leader })
    expect(() => leaderSpec.validate({ type: 'make-statement', statement: '归票。' })).toThrow(/unexpected fields/)
    expect(() => leaderSpec.validate({
      type: 'make-statement', statement: '归票。', team: ['you'],
    })).toThrow(/final team requires 2 unique/)
    expect(() => definition.resolve({
      state: leaderTurn, window: definition.pending(leaderTurn)!,
      actions: new Map([[leader.id, { type: 'make-statement', statement: '归票。' }]]),
    })).toThrow(/requires the final team/)
    expect(() => definition.reduce(leaderTurn, {
      type: 'avalon/statement-made', data: { seatId: leader.id, statement: '遗漏最终队伍。' },
    })).toThrow(/must finalize the team/)
    expect(() => definition.reduce(proposed, {
      type: 'avalon/team-finalized', data: { seatId: leader.id, statement: '抢先归票。', team: ['you', 'ai-1'] },
    })).toThrow(/expected leader/)
    expect(() => definition.reduce(leaderTurn, {
      type: 'avalon/team-finalized', data: { seatId: leader.id, statement: '归票。', team: ['you'] },
    })).toThrow(/final team requires 2 unique/)
    const discussed = completeDiscussion(definition, proposed)
    const voteWindow = definition.pending(discussed)!
    const vote = definition.action({ state: discussed, window: voteWindow, seat: seats[0] })
    expect(() => vote.validate({ type: 'vote-team', approve: true, statement: '多余' })).toThrow(/unexpected fields/)
    expect(() => vote.validate({ type: 'other', approve: true })).toThrow(/team vote is invalid/)
    expect(() => vote.validate({ type: 'vote-team', approve: 'yes' })).toThrow(/team vote is invalid/)

    const voteActions = new Map(seats.map(seat => [
      seat.id, vote.validate({ type: 'vote-team', approve: true }),
    ]))
    const quest = definition.reduce(discussed, definition.resolve({ state: discussed, window: voteWindow, actions: voteActions })[0]!)
    const questWindow = definition.pending(quest)!
    const evilSeat = seats.find(seat => roles[seat.id] === 'assassin' || roles[seat.id] === 'minion')!
    const goodSeat = seats.find(seat => roles[seat.id] === 'merlin' || roles[seat.id] === 'loyal-servant')!
    const evilQuest = definition.action({ state: quest, window: questWindow, seat: evilSeat })
    const goodQuest = definition.action({ state: quest, window: questWindow, seat: goodSeat })
    expect(evilQuest.validate({ type: 'quest', outcome: 'fail' })).toEqual({ type: 'quest', outcome: 'fail' })
    expect(goodQuest.validate({ type: 'quest', outcome: 'success' })).toEqual({ type: 'quest', outcome: 'success' })
    expect(() => goodQuest.validate({ type: 'quest', outcome: 'success', extra: true })).toThrow(/unexpected fields/)
    expect(() => evilQuest.validate({ type: 'other', outcome: 'fail' })).toThrow(/not permitted/)
    expect(() => evilQuest.validate({ type: 'quest', outcome: 'unknown' })).toThrow(/not permitted/)

    let evilDiscussion = quest
    for (let number = 1; number <= 3; number += 1) {
      evilDiscussion = definition.reduce(evilDiscussion, {
        type: 'avalon/quest-resolved', data: { number, team: ['you', 'ai-1'], failCount: 0, success: true },
      })
    }
    const evilWindow = definition.pending(evilDiscussion)!
    const evilSpeaker = seats.find(seat => seat.id === evilWindow.requiredSeats[0])!
    const evilStatement = definition.action({ state: evilDiscussion, window: evilWindow, seat: evilSpeaker })
    expect(() => evilStatement.validate({
      type: 'make-evil-statement', statement: '发言', extra: true,
    })).toThrow(/unexpected fields/)
    expect(() => evilStatement.validate({ type: 'other', statement: '发言' })).toThrow(/statement is invalid/)
    expect(() => evilStatement.validate({
      type: 'make-evil-statement', statement: 'English only',
    })).toThrow(/Chinese text/)
    const assassination = completeEvilDiscussion(definition, evilDiscussion)
    const assassin = seats.find(seat => roles[seat.id] === 'assassin')!
    const assassinWindow = definition.pending(assassination)!
    const assassinationAction = definition.action({ state: assassination, window: assassinWindow, seat: assassin })
    expect(() => assassinationAction.validate({ type: 'assassinate', target: assassin.id, extra: true })).toThrow(/unexpected fields/)
    expect(() => assassinationAction.validate({ type: 'other', target: 'you' })).toThrow(/another match seat/)
    expect(() => assassinationAction.validate({ type: 'assassinate', target: 1 })).toThrow(/another match seat/)
    expect(() => assassinationAction.validate({ type: 'assassinate', target: assassin.id })).toThrow(/another match seat/)
    const survivor = seats.find(seat => seat.id !== assassin.id)!
    expect(assassinationAction.validate({ type: 'assassinate', target: survivor.id })).toEqual({ type: 'assassinate', target: survivor.id })

    const finished = definition.reduce(assassination, {
      type: 'avalon/assassination-resolved', data: { target: survivor.id, hitMerlin: false },
    })
    expect(() => definition.action({ state: finished, window: assassinWindow, seat: assassin })).toThrow(/accept no actions/)
    expect(definition.modelPrompt(state, seats[0].id)).toContain('所有思考、分析、自然语言输出、公开发言和邪方私密发言必须使用简体中文')
    expect(definition.modelPrompt(state, seats[0].id)).toContain('任一队伍通过时，该计数立即清零')
    expect(definition.modelPrompt(state, seats[0].id)).toContain('结算只公开赞成票数和否决票数')
    expect(definition.modelPrompt(state, seats[0].id)).toContain('队长最后归票发言，并在同一个动作中提交最终队伍')
    expect(definition.modelPrompt(state, seats[0].id)).toContain('刺客最后总结')
    expect(definition.modelPrompt(state, seats[0].id)).toContain('当前观察：')
  })

  it('follows the selected direction from the adjacent seat and gives the leader the final statement', () => {
    const { definition, state } = startedState()
    const leader = (definition.view(state) as { leader: SeatId }).leader
    const leaderIndex = seats.findIndex(seat => seat.id === leader)
    for (const direction of ['clockwise', 'counterclockwise'] as const) {
      let discussion = definition.reduce(state, {
        type: 'avalon/team-proposed', data: { leader, team: ['you', 'ai-1'], direction },
      })
      const actual: SeatId[] = []
      while ((definition.view(discussion) as { phase: string }).phase === 'discussion') {
        const speaker = definition.pending(discussion)!.requiredSeats[0]!
        actual.push(speaker)
        discussion = definition.reduce(discussion, speaker === leader
          ? {
            type: 'avalon/team-finalized',
            data: { seatId: speaker, statement: '按顺序归票。', team: ['ai-2', 'ai-3'] },
          }
          : { type: 'avalon/statement-made', data: { seatId: speaker, statement: '按顺序发言。' } })
      }
      const step = direction === 'clockwise' ? 1 : -1
      const expected = seats.map((_, offset) => seats[(leaderIndex + step * (offset + 1) + seats.length) % seats.length]!.id)
      expect(actual).toEqual(expected)
      expect(actual.at(-1)).toBe(leader)
      expect(definition.view(discussion)).toMatchObject({
        phase: 'team-vote', proposal: { team: ['ai-2', 'ai-3'] }, statements: expected.map(seatId => ({ seatId })),
      })
    }
  })

  it('lets evil players speak clockwise after the Assassin and gives the Assassin the final summary', () => {
    const { definition, event, state } = startedState()
    const roles = (event.data as { roles: Record<string, AvalonRole> }).roles
    let evilDiscussion = state
    for (let number = 1; number <= 3; number += 1) evilDiscussion = definition.reduce(evilDiscussion, {
      type: 'avalon/quest-resolved', data: { number, team: ['you', 'ai-1'], failCount: 0, success: true },
    })
    expect(definition.view(evilDiscussion)).toMatchObject({ phase: 'evil-discussion' })
    expect(definition.view(evilDiscussion)).not.toHaveProperty('evilSpeaker')
    expect(definition.view(evilDiscussion)).not.toHaveProperty('evilDiscussion')

    const assassin = seats.find(seat => roles[seat.id] === 'assassin')!
    const minion = seats.find(seat => roles[seat.id] === 'minion')!
    const actual: SeatId[] = []
    while ((definition.view(evilDiscussion) as { phase: string }).phase === 'evil-discussion') {
      const window = definition.pending(evilDiscussion)!
      const speaker = window.requiredSeats[0]!
      actual.push(speaker)
      expect(definition.view(evilDiscussion, speaker)).toMatchObject({ evilSpeaker: speaker })
      evilDiscussion = definition.reduce(evilDiscussion, {
        type: 'avalon/evil-statement-made', data: { seatId: speaker, statement: '私下讨论刺杀目标。' },
      })
    }
    expect(actual).toEqual([minion.id, assassin.id])
    expect(definition.view(evilDiscussion, assassin.id)).toMatchObject({
      phase: 'assassination',
      evilDiscussion: [{ seatId: minion.id }, { seatId: assassin.id }],
    })
    expect(() => definition.reduce(state, {
      type: 'avalon/evil-statement-made', data: { seatId: minion.id, statement: '错误阶段。' },
    })).toThrow(/not active/)
  })

  it('covers rejection, failure, assassination, and incomplete-resolution outcomes', () => {
    const { definition, event, state } = startedState()
    const roles = (event.data as { roles: Record<string, AvalonRole> }).roles
    const proposalWindow = definition.pending(state)!
    expect(() => definition.reduce(undefined, { type: 'unknown', data: {} })).toThrow(/precedes start/)
    expect(() => definition.resolve({ state, window: proposalWindow, actions: new Map() })).toThrow(/leader action/)

    const leader = seats.find(seat => seat.id === proposalWindow.requiredSeats[0])!
    const proposed = definition.reduce(state, {
      type: 'avalon/team-proposed', data: { leader: leader.id, team: ['you', 'ai-1'], direction: 'clockwise' },
    })
    const wrongSpeaker = definition.pending(proposed)!.requiredSeats[0] === seats[0].id ? seats[1].id : seats[0].id
    expect(() => definition.reduce(proposed, {
      type: 'avalon/statement-made', data: { seatId: wrongSpeaker, statement: '抢先发言' },
    })).toThrow(/expected seat/)
    expect(() => definition.resolve({
      state: proposed, window: definition.pending(proposed)!, actions: new Map(),
    })).toThrow(/current speaker/)
    const discussed = completeDiscussion(definition, proposed)
    const voteWindow = definition.pending(discussed)!
    expect(() => definition.resolve({ state: discussed, window: voteWindow, actions: new Map() })).toThrow(/every seat/)
    const rejectedEvent = definition.resolve({
      state: discussed, window: voteWindow,
      actions: new Map(seats.map((seat, index) => [seat.id, { type: 'vote-team', approve: index < 2 }])),
    })[0]!
    expect(rejectedEvent).toMatchObject({
      type: 'avalon/team-vote-resolved',
      data: { approveCount: 2, rejectCount: 3, approved: false },
    })
    expect(rejectedEvent.data).not.toHaveProperty('votes')
    const rejected = definition.reduce(discussed, rejectedEvent)
    expect(rejected).toMatchObject({ phase: 'proposal', rejectedTeams: 1 })
    expect(definition.view(rejected)).toMatchObject({
      teamVotes: [{ approveCount: 2, rejectCount: 3, approved: false }],
    })
    expect(definition.view(rejected, seats[0].id)).toMatchObject({
      teamVotes: [{ approveCount: 2, rejectCount: 3, approved: false }],
    })
    let fiveRejected = discussed
    for (let count = 0; count < 5; count += 1) fiveRejected = definition.reduce(fiveRejected, rejectedEvent)
    expect(fiveRejected).toMatchObject({ phase: 'finished', winner: 'evil', finishReason: 'five-rejected-teams' })
    expect(definition.pending(fiveRejected)).toBeUndefined()
    expect(definition.view(fiveRejected)).toMatchObject({ assassinationTarget: null, winner: 'evil' })

    const approvedEvent = definition.resolve({
      state: discussed, window: voteWindow,
      actions: new Map(seats.map(seat => [seat.id, { type: 'vote-team', approve: true }])),
    })[0]!
    const quest = definition.reduce(discussed, approvedEvent)
    const questWindow = definition.pending(quest)!
    expect(() => definition.resolve({ state: quest, window: questWindow, actions: new Map() })).toThrow(/every team member/)
    const failedQuestEvent = definition.resolve({
      state: quest, window: questWindow,
      actions: new Map((questWindow.requiredSeats).map((seatId, index) => [seatId, { type: 'quest', outcome: index === 0 ? 'fail' : 'success' }])),
    })[0]!
    let threeFailures = quest
    for (let count = 0; count < 3; count += 1) threeFailures = definition.reduce(threeFailures, failedQuestEvent)
    expect(threeFailures).toMatchObject({ phase: 'finished', winner: 'evil', finishReason: 'three-failed-quests' })

    let evilDiscussion = quest
    for (let number = 1; number <= 3; number += 1) evilDiscussion = definition.reduce(evilDiscussion, {
      type: 'avalon/quest-resolved', data: { number, team: ['you', 'ai-1'], failCount: 0, success: true },
    })
    const evilWindow = definition.pending(evilDiscussion)!
    expect(() => definition.resolve({ state: evilDiscussion, window: evilWindow, actions: new Map() })).toThrow(/current speaker/)
    const expectedEvil = evilWindow.requiredSeats[0]!
    const wrongEvil = seats.find(seat => seat.id !== expectedEvil)!.id
    expect(() => definition.reduce(evilDiscussion, {
      type: 'avalon/evil-statement-made', data: { seatId: wrongEvil, statement: '抢先发言。' },
    })).toThrow(/expected seat/)
    const assassination = completeEvilDiscussion(definition, evilDiscussion)
    const assassinationWindow = definition.pending(assassination)!
    expect(() => definition.resolve({ state: assassination, window: assassinationWindow, actions: new Map() })).toThrow(/assassin action/)
    const assassin = SeatId(Object.entries(roles).find(([, role]) => role === 'assassin')![0])
    const nonMerlin = SeatId(Object.entries(roles).find(([seatId, role]) => seatId !== assassin && role !== 'merlin')![0])
    const assassinationEvent = definition.resolve({
      state: assassination, window: assassinationWindow,
      actions: new Map([[assassin, { type: 'assassinate', target: nonMerlin }]]),
    })[0]!
    expect(assassinationEvent).toMatchObject({ data: { hitMerlin: false } })
    const survived = definition.reduce(assassination, assassinationEvent)
    expect(survived).toMatchObject({ winner: 'good', finishReason: 'merlin-survived' })
    expect(() => definition.resolve({ state: survived, window: assassinationWindow, actions: new Map() })).toThrow(/cannot resolve/)
    expect(() => definition.reduce(state, { type: 'unknown', data: {} })).toThrow(/unknown Avalon event/)
  })

  it('registers and disposes the definition', async () => {
    const ctx = new Context()
    await ctx.plugin(GameDefinitions)
    const fiber = await ctx.plugin(Avalon, { maxStatementChars: 64 })
    expect(ctx.gameDefinitions.require('avalon').configSchema).toMatchObject({
      type: 'object', additionalProperties: false,
      properties: {
        playerCount: { enum: [5, 6, 7, 8], default: 5 },
        rolePreset: { enum: ['basic', 'percival-morgana', 'mordred-oberon'], default: 'percival-morgana' },
        humanRole: {
          enum: ['merlin', 'percival', 'loyal-servant', 'assassin', 'morgana', 'mordred', 'oberon', 'minion'],
        },
      },
    })
    expect(ctx.gameDefinitions.require('avalon').rulesVersion).toBe(12)
    await fiber.dispose()
    expect(() => ctx.gameDefinitions.require('avalon')).toThrow(/unknown game definition/)
    await ctx.fiber.dispose()
  })
})

describe('Avalon match', () => {
  it('plays three successful missions, conceals assassination ownership, and reveals roles only at normal finish', async () => {
    const ctx = new Context()
    const persistence = new MemoryGamePersistence()
    await ctx.plugin(GameDefinitions)
    await ctx.plugin(GameControllerRegistry)
    await ctx.plugin(inner => inner.provide('gamePersistence', persistence))
    await ctx.plugin(GameEngine)
    ctx.gameDefinitions.register(createAvalonDefinition({ maxStatementChars: 80 }))

    let view = await ctx.matches.create({
      gameId: 'avalon', config: { rolePreset: 'basic', humanRole: 'merlin' }, seats,
    })
    const record = await persistence.load(view.id)
    const roles = ((record!.events[0]!.data as { ruleData: { roles: Record<string, AvalonRole> } }).ruleData.roles)
    let command = 0
    const submit = async (
      seatId: SeatId,
      action: GameJson,
    ): Promise<{ readonly commandId: GameCommandId; readonly windowId: ActionWindowId }> => {
      const current = await ctx.matches.get(view.id, seatId)
      const commandId = GameCommandId(`command-${command++}`)
      const windowId = current!.window!.id
      view = await ctx.matches.submit({
        matchId: view.id, windowId, commandId, seatId, action,
      })
      return { commandId, windowId }
    }

    for (let mission = 0; mission < 3; mission += 1) {
      const publicView = await ctx.matches.get(view.id)
      const game = publicView!.game as { teamSize: number }
      const leader = publicView!.window!.requiredSeats[0]!
      const team = seats.slice(0, game.teamSize).map(seat => seat.id)
      const proposal = await submit(leader, { type: 'propose-team', team, direction: 'clockwise' })
      if (mission === 0) {
        await expect(ctx.matches.submit({
          matchId: view.id, windowId: proposal.windowId, commandId: proposal.commandId, seatId: leader,
          action: { direction: 'clockwise', team, type: 'propose-team' },
        })).resolves.toEqual(view)
      }
      while (((await ctx.matches.get(view.id))!.game as { phase: string }).phase === 'discussion') {
        const discussion = await ctx.matches.get(view.id)
        const speaker = discussion!.window!.requiredSeats[0]!
        const discussionGame = discussion!.game as { leader: SeatId; proposal: { team: readonly SeatId[] } }
        await submit(speaker, speaker === discussionGame.leader
          ? { type: 'make-statement', statement: '我完成归票并确认队伍。', team: discussionGame.proposal.team }
          : { type: 'make-statement', statement: '我赞成这支队伍。' })
      }
      for (const seat of seats) await submit(seat.id, { type: 'vote-team', approve: true })
      for (const seatId of team) await submit(seatId, { type: 'quest', outcome: 'success' })
    }

    expect(roles['you']).toBe('merlin')
    const assassin = SeatId(Object.entries(roles).find(([, role]) => role === 'assassin')![0])
    const minion = SeatId(Object.entries(roles).find(([, role]) => role === 'minion')![0])
    const merlin = SeatId(Object.entries(roles).find(([, role]) => role === 'merlin')![0])

    const concealedDiscussion = await ctx.matches.get(view.id)
    expect(concealedDiscussion).toMatchObject({
      status: 'active', window: { requiredSeats: [], submittedSeats: [], canAct: false }, blockedSeats: [],
      game: { phase: 'evil-discussion' },
    })
    expect(concealedDiscussion!.window).not.toHaveProperty('actionSchema')
    expect(concealedDiscussion!.game).not.toHaveProperty('roles')
    expect(concealedDiscussion!.game).not.toHaveProperty('evilDiscussion')

    const minionView = await ctx.matches.get(view.id, minion)
    expect(minionView).toMatchObject({
      window: { requiredSeats: [minion], canAct: true },
      game: { evilSpeaker: minion },
    })
    await submit(minion, { type: 'make-evil-statement', statement: '我认为 AI 3 最像梅林。' })
    const assassinDiscussionView = await ctx.matches.get(view.id, assassin)
    expect(assassinDiscussionView).toMatchObject({
      window: { requiredSeats: [assassin], canAct: true },
      game: { evilSpeaker: assassin, evilDiscussion: [{ seatId: minion }] },
    })
    await submit(assassin, { type: 'make-evil-statement', statement: '我会综合判断后选择目标。' })

    const concealed = await ctx.matches.get(view.id)
    expect(concealed).toMatchObject({
      status: 'active', window: { requiredSeats: [], submittedSeats: [], canAct: false },
      game: { phase: 'assassination' },
    })
    expect(concealed!.game).not.toHaveProperty('evilDiscussion')
    const assassinView = await ctx.matches.get(view.id, assassin)
    expect(assassinView!.window).toMatchObject({ requiredSeats: [assassin], canAct: true })
    expect(assassinView!.window).toHaveProperty('actionSchema')
    await submit(assassin, { type: 'assassinate', target: merlin })

    const finished = await ctx.matches.get(view.id)
    expect(finished).toMatchObject({ status: 'finished', game: { winner: 'evil', finishReason: 'merlin-assassinated', roles } })
    await ctx.fiber.dispose()
  })
})
