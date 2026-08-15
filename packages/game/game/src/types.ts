/** Client-safe JSON types used by the game Remote namespace. @module @deepseek-ai/dsh-game/types */

/** Lossless JSON accepted on the game wire. */
export type GameWireJson = null | boolean | number | string | readonly GameWireJson[] | { readonly [key: string]: GameWireJson }

/** Controller fields persisted for a wire-created seat. */
export type GameRemoteControllerSpec =
  | { readonly type: 'human' }
  | { readonly type: 'agent'; readonly provider: string; readonly model: string }

/** Seat fields accepted and returned across the wire. */
export interface GameRemoteSeatSpec {
  readonly id: string
  readonly displayName: string
  readonly controller: GameRemoteControllerSpec
}

/** Match view returned across the Host/Client wire. */
export interface GameRemoteMatchView {
  readonly id: string
  readonly gameId: string
  readonly revision: number
  readonly status: 'active' | 'blocked' | 'abandoned' | 'finished'
  readonly seats: readonly GameRemoteSeatSpec[]
  readonly window?: {
    readonly id: string
    readonly requiredSeats: readonly string[]
    readonly submittedSeats: readonly string[]
    readonly canAct: boolean
    readonly actionSchema?: GameWireJson
  }
  readonly blockedSeats: readonly { readonly seatId: string; readonly message: string }[]
  readonly game: GameWireJson
}

/** Current host-side reachability of one configured AI route. */
export interface GameRemoteProviderAvailability {
  readonly provider: string
  readonly model: string
  readonly available: boolean
  readonly message?: string
}

/** Registered game metadata exposed to setup clients. */
export interface GameRemoteGameInfo {
  readonly id: string
  readonly configSchema: GameWireJson
}

/** JSON-safe create request accepted across the Host/Client wire. */
export interface GameRemoteCreateRequest {
  readonly gameId: string
  readonly config: GameWireJson
  readonly seats: readonly GameRemoteSeatSpec[]
}

/** JSON-safe action request accepted across the Host/Client wire. */
export interface GameRemoteSubmitRequest {
  readonly matchId: string
  readonly windowId: string
  readonly commandId: string
  readonly action: GameWireJson
}
