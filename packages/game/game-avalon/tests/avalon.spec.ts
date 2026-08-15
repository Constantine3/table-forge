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

const startedState = (matchConfig: GameJson = {}) => {
  const definition = createAvalonDefinition({ maxStatementChars: 20 })
  const events = definition.initial({ config: matchConfig, seats, randomSeed: 'fixed-seed' })
  return { definition, event: events[0]!, state: definition.reduce(undefined, events[0]!) }
}

type AvalonDefinition = ReturnType<typeof createAvalonDefinition>
type AvalonTestState = Parameters<AvalonDefinition['pending']>[0]

const completeDiscussion = (definition: AvalonDefinition, initial: AvalonTestState): AvalonTestState => {
  let state = initial
  while ((definition.view(state) as { phase: string }).phase === 'discussion') {
    const window = definition.pending(state)!
    const seat = seats.find(candidate => candidate.id === window.requiredSeats[0])!
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

const completeEvilDiscussion = (definition: AvalonDefinition, initial: AvalonTestState): AvalonTestState => {
  let state = initial
  while ((definition.view(state) as { phase: string }).phase === 'evil-discussion') {
    const window = definition.pending(state)!
    const seat = seats.find(candidate => candidate.id === window.requiredSeats[0])!
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
    const repeated = definition.initial({ config: {}, seats, randomSeed: 'fixed-seed' })
    expect(repeated).toEqual([event])
    const roles = (event.data as { roles: Record<string, AvalonRole> }).roles
    expect(Object.values(roles).sort()).toEqual(['assassin', 'loyal-servant', 'loyal-servant', 'merlin', 'minion'])
    expect(definition.view(state)).not.toHaveProperty('roles')
    for (const seat of seats) {
      expect(definition.view(state, seat.id)).toMatchObject({ private: { role: roles[seat.id] } })
    }
    const merlin = Object.entries(roles).find(([, role]) => role === 'merlin')![0]
    expect(definition.view(state, SeatId(merlin))).toMatchObject({ private: { knownPlayers: [{ alignment: 'evil' }, { alignment: 'evil' }] } })

    for (const humanRole of ['merlin', 'loyal-servant', 'assassin', 'minion'] as const) {
      const config = definition.validateConfig({ humanRole })
      const selected = definition.initial({ config, seats, randomSeed: 'fixed-seed' })[0]!
      const selectedRoles = (selected.data as { roles: Record<string, AvalonRole> }).roles
      expect(selectedRoles['you']).toBe(humanRole)
      expect(Object.values(selectedRoles).sort()).toEqual([
        'assassin', 'loyal-servant', 'loyal-servant', 'merlin', 'minion',
      ])
    }
  })

  it('rejects persisted state that omits an owned role assignment', () => {
    const definition = createAvalonDefinition({ maxStatementChars: 80 })
    const state = definition.reduce(undefined, {
      type: 'avalon/started',
      data: { seats: seats.map(seat => seat.id), roles: { you: 'merlin' }, leaderIndex: 0 },
    })
    expect(() => definition.view(state, seats[0].id)).toThrow(/missing role/)
  })

  it('validates setup, structured statements, teams, and role-scoped quest actions', () => {
    const { definition, state } = startedState()
    expect(definition.validateConfig(null)).toEqual({})
    expect(definition.validateConfig({ humanRole: 'assassin' })).toEqual({ humanRole: 'assassin' })
    expect(() => definition.validateConfig({ variant: 'custom' })).toThrow(/unexpected fields/)
    expect(() => definition.validateConfig({ humanRole: 'percival' })).toThrow(/human role is invalid/)
    expect(() => definition.validateConfig({ humanRole: 1 })).toThrow(/human role is invalid/)
    expect(() => definition.initial({ config: {}, seats: seats.slice(0, 4), randomSeed: 'short' })).toThrow(/five seats/)
    expect(() => definition.initial({
      config: {}, randomSeed: 'humans',
      seats: seats.map(seat => ({ ...seat, controller: { type: 'human' as const } })),
    })).toThrow(/one human seat and four AI seats/)

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
      properties: { humanRole: { enum: ['merlin', 'loyal-servant', 'assassin', 'minion'] } },
    })
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

    let view = await ctx.matches.create({ gameId: 'avalon', config: { humanRole: 'merlin' }, seats })
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
