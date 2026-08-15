# Agent Note: Event-sourced LLM game engine

Status: implemented

English | [中文](2026-08-14-event-sourced-llm-game-engine.zh.md)

## Problem

The harness had reusable Agent, Session, Remote, browser, and persistence infrastructure, but no game authority. Implementing each social game directly as an Agent prompt would mix probabilistic decisions with rule enforcement, expose hidden actions through shared context, and make recovery depend on model transcripts.

## Decision

Games use a deterministic definition behind an event-sourced match engine. Definitions publish deployment-resolved setup schemas, validate JSON inputs, emit rule events, reduce state, declare action windows, and project views without I/O. The engine owns command serialization, exact-input idempotency, atomic header-and-initial-event creation, append-before-publish ordering, reconstruction, controller dispatch, durable abandonment, and restart recovery when compatible definitions and controllers register. Registration subscriptions replay currently available entries, and recovery runs after the activation stack, so persisted work does not depend on plugin activation order. Recovery contains each record failure and validates persisted controller configurations before dispatch; unavailable definitions and incompatible open matches remain available for audit without blocking compatible matches. SQLite is the durable provider, requires exactly one supported schema row, and closes a connection whose schema validation fails.

AI participation is a controller provider rather than rule behavior. Every AI seat receives an independent Agent and Session scoped to one game-action tool and a complete deployment-configured game prompt; generic coding-agent and workspace context is excluded. The controller binds that tool to the current action window instead of asking the model to reproduce an opaque routing id. A seat sees only its projected observation, and controller work is serialized per seat from one idle state to the next. Abandonment cancels and drains all seat work before completion, and provider teardown drains every owned controller task before its services disappear. Simultaneous submissions remain sealed in match projections until the complete action window resolves. Remote creation resolves the requested provider/model and checks deployment-configured route availability from the game Host before persistence. This permits a LAN-only provider and a cloud fallback to coexist without browser-side network assumptions. Browser submissions are assigned only to the match's human seat.

The `game` profile composes these roles over existing base and Web bundles. Its browser stores only the selected match id and reconstructs the table from the durable Remote view after reload. It lists durable matches and reads each AI seat's Session as a local audit view. Exhausted controller attempts append a blocked-seat event; restart preserves the block without automatic redispatch, and an operator can explicitly retry the seat or abandon the match. The profile gives its maximum-reasoning local model a ten-minute stream idle allowance because reasoning may produce no transport chunks for longer than the generic interactive timeout. The initial `game-rps` plugin proves human-versus-AI, AI-versus-AI, configurable rounds, all nine outcomes, and hidden simultaneous actions without adding behavior to `agent-loop`.

## Alternatives considered

- **Encode game rules in prompts**: rejected because model output cannot be the authority for legality, scoring, replay, or hidden information.
- **Give a match one shared Agent**: rejected because shared history leaks private observations and prevents independent provider, model, and persona configuration.
- **Store only final state**: rejected because idempotent recovery, audit, replay, and future spectator projections need committed facts rather than overwritten snapshots.
- **Build a game-specific server outside Cordis**: rejected because definitions, controllers, persistence, transport, and UI are replaceable plugin roles and already match the repository's composition model.

## Consequences

New games implement a pure definition and reuse lifecycle, persistence, AI control, Remote transport, and product composition. Match and model transcripts have explicit separate ownership. Browser storage chooses a table but never becomes match authority; clearing it leaves server history intact. Maximum reasoning may keep a table waiting for several minutes, while an exhausted idle allowance blocks the affected seat rather than inventing a move. A game can evolve its rules through a versioned definition, but a running match never silently switches versions. The first browser product is deliberately specialized for rock-paper-scissors; richer spectator workflows remain additions to the same services rather than reasons to alter the Agent loop.
