/** SQLite provider for append-only match records. @module @deepseek-ai/dsh-game-persistence-sqlite */

import type { Context } from '@deepseek-ai/cordis'
import {
  MATCH_FORMAT_VERSION, MatchId, SeatId,
  UnsupportedMatchFormatError,
  type GameJson, type GamePersistence, type MatchEvent, type MatchRecord, type MatchSeatSpec,
} from '@deepseek-ai/dsh-game'
import z from '@deepseek-ai/schemastery'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

/** Current on-disk format. Pre-release databases with another version are rejected. */
export const GAME_SQLITE_SCHEMA_VERSION = 1

/** Plugin configuration. */
export interface Config {
  /** SQLite database path, or `:memory:` for an ephemeral store. */
  path: string
}

/** Schemastery validator for {@link Config}. */
export const Config: z<Config> = z.object({ path: z.string().required() })

/** SQLite implementation of the game persistence interface. */
export class SqliteGamePersistence implements GamePersistence {
  private readonly db: DatabaseSync

  /** Open and validate one database. */
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    this.db = new DatabaseSync(path)
    try {
      this.db.exec(`
        PRAGMA foreign_keys = ON;
        CREATE TABLE IF NOT EXISTS game_schema (version INTEGER NOT NULL) STRICT;
        CREATE TABLE IF NOT EXISTS matches (
          id TEXT PRIMARY KEY,
          format_version INTEGER NOT NULL,
          game_id TEXT NOT NULL,
          rules_version INTEGER NOT NULL,
          config_json TEXT NOT NULL,
          seats_json TEXT NOT NULL,
          created_at INTEGER NOT NULL
        ) STRICT;
        CREATE TABLE IF NOT EXISTS match_events (
          match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE RESTRICT,
          seq INTEGER NOT NULL,
          time INTEGER NOT NULL,
          type TEXT NOT NULL,
          data_json TEXT NOT NULL,
          PRIMARY KEY (match_id, seq)
        ) STRICT;
      `)
      const rows = this.db.prepare('SELECT version FROM game_schema').all() as unknown as Array<{ version: number }>
      if (rows.length === 0) this.db.prepare('INSERT INTO game_schema (version) VALUES (?)').run(GAME_SQLITE_SCHEMA_VERSION)
      else if (rows.length !== 1 || rows[0]?.version !== GAME_SQLITE_SCHEMA_VERSION) {
        throw new Error(`game database schema is invalid or unsupported; expected exactly version ${GAME_SQLITE_SCHEMA_VERSION}`)
      }
    } catch (error) {
      this.db.close()
      throw error
    }
  }

  create(record: MatchRecord): Promise<void> {
    return Promise.resolve().then(() => {
      this.db.exec('BEGIN IMMEDIATE')
      try {
        this.db.prepare(`INSERT INTO matches
          (id, format_version, game_id, rules_version, config_json, seats_json, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`)
          .run(
            record.id, record.formatVersion, record.gameId, record.rulesVersion,
            JSON.stringify(record.config), JSON.stringify(record.seats), record.createdAt,
          )
        const insert = this.db.prepare('INSERT INTO match_events (match_id, seq, time, type, data_json) VALUES (?, ?, ?, ?, ?)')
        record.events.forEach((event, index) => {
          if (event.seq !== index) throw new Error(`match '${record.id}' initial events are not contiguous`)
          insert.run(record.id, event.seq, event.time, event.type, JSON.stringify(event.data))
        })
        this.db.exec('COMMIT')
      } catch (error) {
        this.db.exec('ROLLBACK')
        throw error
      }
    })
  }

  append(matchId: MatchId, expectedRevision: number, events: readonly MatchEvent[]): Promise<void> {
    return Promise.resolve().then(() => {
      this.db.exec('BEGIN IMMEDIATE')
      try {
        const row = this.db.prepare('SELECT COUNT(*) AS count FROM match_events WHERE match_id = ?').get(matchId) as { count: number }
        if (row.count !== expectedRevision) throw new Error(`match '${matchId}' revision conflict`)
        const insert = this.db.prepare('INSERT INTO match_events (match_id, seq, time, type, data_json) VALUES (?, ?, ?, ?, ?)')
        events.forEach((event, index) => {
          if (event.seq !== expectedRevision + index) throw new Error(`match '${matchId}' append is not contiguous`)
          insert.run(matchId, event.seq, event.time, event.type, JSON.stringify(event.data))
        })
        this.db.exec('COMMIT')
      } catch (error) {
        this.db.exec('ROLLBACK')
        throw error
      }
    })
  }

  load(matchId: MatchId): Promise<MatchRecord | undefined> {
    const header = this.db.prepare(`SELECT id, format_version, game_id, rules_version, config_json, seats_json, created_at
      FROM matches WHERE id = ?`).get(matchId) as HeaderRow | undefined
    if (header === undefined) return Promise.resolve(undefined)
    const events = this.db.prepare(`SELECT seq, time, type, data_json FROM match_events
      WHERE match_id = ? ORDER BY seq`).all(matchId) as unknown as EventRow[]
    return Promise.resolve(decode(header, events))
  }

  list(): Promise<readonly Omit<MatchRecord, 'events'>[]> {
    const headers = this.db.prepare(`SELECT id, format_version, game_id, rules_version, config_json, seats_json, created_at
      FROM matches WHERE format_version = ? ORDER BY created_at DESC`).all(MATCH_FORMAT_VERSION) as unknown as HeaderRow[]
    return Promise.resolve(headers.map((header) => {
      const { events: _events, ...record } = decode(header, [])
      return record
    }))
  }

  /** Close the owned database connection. */
  close(): void {
    this.db.close()
  }
}

interface HeaderRow {
  id: string
  format_version: number
  game_id: string
  rules_version: number
  config_json: string
  seats_json: string
  created_at: number
}

interface EventRow {
  seq: number
  time: number
  type: MatchEvent['type']
  data_json: string
}

const decode = (header: HeaderRow, events: readonly EventRow[]): MatchRecord => {
  if (header.format_version !== MATCH_FORMAT_VERSION) {
    throw new UnsupportedMatchFormatError(MatchId(header.id), header.format_version)
  }
  if (header.id.length === 0 || header.game_id.length === 0
    || !Number.isInteger(header.rules_version) || !Number.isInteger(header.created_at)) {
    throw new Error(`match '${header.id}' has an invalid header`)
  }
  const config = parseJson(header.config_json, `match '${header.id}' config`)
  const seats = parseSeats(header.seats_json, header.id)
  return {
    id: MatchId(header.id),
    formatVersion: MATCH_FORMAT_VERSION,
    gameId: header.game_id,
    rulesVersion: header.rules_version,
    config,
    seats,
    createdAt: header.created_at,
    events: events.map((event, index) => {
      if (event.seq !== index || !Number.isInteger(event.time) || !MATCH_EVENT_TYPES.has(event.type)) {
        throw new Error(`match '${header.id}' has an invalid event at sequence ${index}`)
      }
      return { seq: event.seq, time: event.time, type: event.type, data: parseJson(event.data_json, `match '${header.id}' event ${index}`) }
    }),
  }
}

const MATCH_EVENT_TYPES = new Set<MatchEvent['type']>([
  'match/created', 'match/action-opened', 'match/action-submitted', 'match/action-closed',
  'match/controller-blocked', 'match/controller-retried', 'match/abandoned', 'match/rule',
])

const parseJson = (source: string, label: string): GameJson => {
  let value: unknown
  try {
    value = JSON.parse(source)
  } catch (error) {
    throw new Error(`${label} is not valid JSON`, { cause: error })
  }
  if (!isGameJson(value)) throw new Error(`${label} is not lossless JSON`)
  return value
}

const isGameJson = (value: unknown): value is GameJson => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(isGameJson)
  /* v8 ignore next -- JSON.parse cannot produce undefined, bigint, symbol, or function values. */
  if (typeof value !== 'object') return false
  return Object.values(value).every(isGameJson)
}

const parseSeats = (source: string, matchId: string): MatchSeatSpec[] => {
  const value = parseJson(source, `match '${matchId}' seats`)
  if (!Array.isArray(value)) throw new Error(`match '${matchId}' seats must be an array`)
  const ids = new Set<string>()
  return value.map((entry) => {
    if (entry === null || Array.isArray(entry) || typeof entry !== 'object') throw new Error(`match '${matchId}' has an invalid seat`)
    const object = entry as Readonly<Record<string, GameJson>>
    const id = object.id
    const displayName = object.displayName
    const controller = object.controller
    if (typeof id !== 'string' || id.length === 0 || ids.has(id) || typeof displayName !== 'string' || displayName.length === 0
      || controller === null || Array.isArray(controller) || typeof controller !== 'object') {
      throw new Error(`match '${matchId}' has an invalid seat`)
    }
    ids.add(id)
    const controllerObject = controller as Readonly<Record<string, GameJson>>
    if (controllerObject.type === 'human') return { id: SeatId(id), displayName, controller: { type: 'human' } }
    if (controllerObject.type !== 'agent'
      || typeof controllerObject.provider !== 'string' || controllerObject.provider.length === 0
      || typeof controllerObject.model !== 'string' || controllerObject.model.length === 0) {
      throw new Error(`match '${matchId}' has an invalid seat controller`)
    }
    return {
      id: SeatId(id), displayName,
      controller: { type: 'agent', provider: controllerObject.provider, model: controllerObject.model },
    }
  })
}

/** Cordis plugin name. */
export const name = 'game-persistence-sqlite'

/** Provide SQLite persistence and close it during plugin teardown. */
export function apply(ctx: Context, config: Config): void {
  const persistence = new SqliteGamePersistence(config.path)
  ctx.provide('gamePersistence', persistence)
  ctx.effect(() => () => { persistence.close() }, 'game-persistence-sqlite.close')
}
