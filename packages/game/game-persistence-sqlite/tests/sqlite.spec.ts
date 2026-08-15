import { Context } from '@deepseek-ai/cordis'
import GamePersistence from '@deepseek-ai/dsh-game'
import { MatchId, SeatId, type MatchRecord } from '@deepseek-ai/dsh-game'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { apply, SqliteGamePersistence } from '../src/index.ts'

const record = (id = 'match'): MatchRecord => ({
  id: MatchId(id), formatVersion: 0, gameId: 'rps', rulesVersion: 1, config: { roundCount: 1 },
  seats: [
    { id: SeatId('a'), displayName: 'A', controller: { type: 'human' } },
    { id: SeatId('b'), displayName: 'B', controller: { type: 'agent', provider: 'p', model: 'm' } },
  ],
  createdAt: 1, events: [{ seq: 0, time: 2, type: 'match/rule', data: { ruleType: 'started' } }],
})

describe('SQLite game persistence', () => {
  it('atomically appends and reloads a match', async () => {
    const persistence = new SqliteGamePersistence(':memory:')
    const id = MatchId('match')
    await persistence.create({
      id, formatVersion: 0, gameId: 'rps', rulesVersion: 1, config: { roundCount: 1 },
      seats: [{ id: SeatId('a'), displayName: 'A', controller: { type: 'human' } }], createdAt: 1,
      events: [{ seq: 0, time: 2, type: 'match/rule', data: { ruleType: 'started' } }],
    })
    expect((await persistence.load(id))?.events).toHaveLength(1)
    await expect(persistence.append(id, 0, [])).rejects.toThrow(/revision conflict/)
    persistence.close()
  })

  it('lists headers and rolls back conflicting writes', async () => {
    const persistence = new SqliteGamePersistence(':memory:')
    await persistence.create(record('one'))
    await persistence.create({ ...record('two'), createdAt: 2 })
    expect((await persistence.list()).map(item => item.id)).toEqual(['two', 'one'])
    await expect(persistence.create(record('one'))).rejects.toThrow()
    await expect(persistence.append(MatchId('one'), 1, [
      { seq: 2, time: 3, type: 'match/abandoned', data: {} },
    ])).rejects.toThrow(/not contiguous/)
    await persistence.append(MatchId('one'), 1, [
      { seq: 1, time: 3, type: 'match/abandoned', data: {} },
    ])
    expect((await persistence.load(MatchId('one')))?.events).toHaveLength(2)
    persistence.close()
  })

  it('creates parent directories and participates in plugin teardown', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-game-plugin-'))
    const path = join(dir, 'nested', 'games.sqlite')
    try {
      const ctx = new Context()
      await ctx.plugin(GamePersistence)
      apply(ctx, { path })
      expect(ctx.gamePersistence).toBeInstanceOf(SqliteGamePersistence)
      await ctx.fiber.dispose()
      const reopened = new SqliteGamePersistence(path)
      reopened.close()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('rolls back the header when initial events are invalid', async () => {
    const persistence = new SqliteGamePersistence(':memory:')
    const id = MatchId('invalid')
    await expect(persistence.create({
      id, formatVersion: 0, gameId: 'rps', rulesVersion: 1, config: {},
      seats: [{ id: SeatId('a'), displayName: 'A', controller: { type: 'human' } }], createdAt: 1,
      events: [{ seq: 1, time: 2, type: 'match/rule', data: {} }],
    })).rejects.toThrow(/not contiguous/)
    await expect(persistence.load(id)).resolves.toBeUndefined()
    persistence.close()
  })

  it('rejects a database with multiple schema rows', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-game-schema-'))
    const path = join(dir, 'games.sqlite')
    try {
      const db = new DatabaseSync(path)
      db.exec('CREATE TABLE game_schema (version INTEGER NOT NULL) STRICT; INSERT INTO game_schema VALUES (1), (1)')
      db.close()
      expect(() => new SqliteGamePersistence(path)).toThrow(/expected exactly version 1/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('rejects unsupported schema versions', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-game-schema-version-'))
    const path = join(dir, 'games.sqlite')
    try {
      const db = new DatabaseSync(path)
      db.exec('CREATE TABLE game_schema (version INTEGER NOT NULL) STRICT; INSERT INTO game_schema VALUES (2)')
      db.close()
      expect(() => new SqliteGamePersistence(path)).toThrow(/expected exactly version 1/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('rejects corrupt durable headers, JSON, seats, and events', async () => {
    const mutations: Array<[string, string, RegExp]> = [
      ['format', 'UPDATE matches SET format_version = 2', /unsupported format/],
      ['empty-id', "UPDATE matches SET game_id = ''", /invalid header/],
      ['config-json', "UPDATE matches SET config_json = '{'", /not valid JSON/],
      ['config-lossy', "UPDATE matches SET config_json = '1e999'", /not lossless JSON/],
      ['seats-array', "UPDATE matches SET seats_json = '{}'", /must be an array/],
      ['seat-scalar', "UPDATE matches SET seats_json = '[null]'", /invalid seat/],
      ['seat-fields', "UPDATE matches SET seats_json = '[{\"id\":\"\",\"displayName\":\"A\",\"controller\":{\"type\":\"human\"}}]'", /invalid seat/],
      ['seat-controller', "UPDATE matches SET seats_json = '[{\"id\":\"a\",\"displayName\":\"A\",\"controller\":{\"type\":\"agent\"}}]'", /invalid seat controller/],
      ['event-seq', 'UPDATE match_events SET seq = 2', /invalid event/],
      ['event-type', "UPDATE match_events SET type = 'unknown'", /invalid event/],
      ['event-json', "UPDATE match_events SET data_json = '{'", /not valid JSON/],
    ]
    for (const [label, sql, error] of mutations) {
      const dir = await mkdtemp(join(tmpdir(), `dsh-game-corrupt-${label}-`))
      const path = join(dir, 'games.sqlite')
      try {
        const persistence = new SqliteGamePersistence(path)
        await persistence.create(record())
        persistence.close()
        const db = new DatabaseSync(path)
        db.exec(sql)
        db.close()
        const corrupted = new SqliteGamePersistence(path)
        expect(() => corrupted.load(MatchId('match'))).toThrow(error)
        corrupted.close()
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    }
  })
})
