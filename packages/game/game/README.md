# `@deepseek-ai/dsh-game`

English | [中文](README.zh.md)

`dsh-game` defines versioned deterministic games and the durable match operations used by controllers and product clients. A game plugin publishes its deployment-resolved configuration schema, validates JSON configuration and seat-specific actions, emits rule events, reduces them to state, declares one pending action window, and projects public or seat-scoped views. An action window also declares whether its participating seat ids and submission status are public or visible only to required seats.

The match log and an AI player's Session log have separate ownership. Match events are the authoritative game result; Session events reconstruct only what that player saw and sent to its model. Definitions must not perform I/O, call a model, or mutate reducer inputs.

Registrations are effects. Registry listeners receive currently available entries before future registrations, so consumers can recover durable work independently of plugin activation order. Duplicate definition ids and unknown rules versions fail instead of selecting an implicit fallback.

## Model Experience

### Rules definition

#### What the model sees

Definitions use `modelPrompt` to render the rules and exact seat-scoped observation consumed by an AI controller. Each active seat also supplies the JSON schema used for its current action; this supports role-dependent choices without exposing another seat's legal actions. The service itself sends no request.

#### Token effect

The rendered prompt contributes tokens once per controller request; its size depends on the game view.

#### KV Cache effect

Stable rules may form a reusable prefix, while the current observation changes after committed events.

## Known Limitations and Deferred Work

- The service definitions do not provide matchmaking, spectators, clocks, or player identity; product plugins must add those capabilities separately.
