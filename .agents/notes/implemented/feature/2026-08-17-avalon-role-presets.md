# Agent Note: Avalon roles use validated presets and one shared rules module

Status: implemented

English | [中文](2026-08-17-avalon-role-presets.zh.md)

## Problem

Avalon's fixed basic deck cannot express the information relationships that distinguish Percival, Morgana, Mordred, and Oberon. Allowing a browser to assemble arbitrary roles would create unsupported or unbalanced tables, while maintaining separate backend and browser catalogs would let setup choices, displayed counts, and enforced assignments drift.

## Decision

Match configuration accepts a `rolePreset` and never accepts an arbitrary role list. `percival-morgana` is the default for five through eight players. `basic` remains available at every supported size. `mordred-oberon` is available for seven and eight players. The definition validates the preset against `playerCount`, resolves the complete deck, and permits `humanRole` only when that role occurs in the resolved deck. The `avalon/started` event stores the preset and complete assignment, and Avalon rules version `12` rejects earlier pre-release matches.

The pure `@deepseek-ai/dsh-game-avalon-rules` package owns role ids, labels, ability descriptions, faction membership, cooperative-evil membership, preset availability, decks, mission sizes, and mission failure thresholds. The deterministic definition and Avalon browser contribution import its main rule module, which has no Cordis, Node, React, or plugin-runtime import. The client-bundle purity gate admits this exact package while continuing to reject nested paths and the game plugin package root. Assignment, action validation, event reduction, and projection remain definition responsibilities.

## Information projections

Private knowledge uses discriminated entries instead of optional alignment and role fields. Merlin receives `evil` entries for every evil player except Mordred, including Oberon. Percival receives `merlin-candidate` entries for Merlin and Morgana without a distinguishing role. Cooperative evil roles receive exact `evil-ally` entries for one another, excluding Oberon. Oberon receives no ally knowledge. Active public projections publish the selected preset and role deck but never the assignment.

The Assassin, Morgana, Mordred, and Minions form the cooperative evil network. Only that network participates in the ordered assassination discussion and sees its active statements. Oberon may submit a mission failure but neither participates in nor observes the discussion. Cooperative quest guidance names and coordinates only known network members; Oberon receives independent guidance without ally identities or failure assignments. Role-specific Chinese prompts cover Percival's unresolved candidates, Morgana's false-Merlin behavior, Mordred's Merlin blind spot, Oberon's isolation, the Assassin's target tracking, and Merlin's incomplete evil view.

## Alternatives considered

**Allow custom role assembly.** Rejected because role counts alone do not prove a supported information balance, and the browser cannot be the authority for fairness.

**Keep role rules in the definition and copy display metadata into the UI.** Rejected because preset availability, labels, and deck counts must change together.

**Create one game definition per preset.** Rejected because presets share events, phases, mission rules, and presentation; a validated match choice belongs to the existing definition.

**Exempt the Avalon game plugin from client-bundle purity.** Rejected because the plugin root imports Node and Cordis runtime code. The independent rules package exposes no shared runtime identity.

## Consequences

Setup offers only fair complete combinations and automatically returns to the default when a selected preset does not support a new table size. The active board renders counts from the projected deck instead of deriving them from player count. Human role selection cannot request an absent role. Adding another preset requires one catalog entry plus projection, prompt, UI, and snapshot evidence for its information relationships. This decision specializes the Avalon realization described by the [event-sourced game architecture](../architecture/2026-08-14-event-sourced-llm-game-engine.md) without changing the engine, controller, privacy, or UI contribution boundaries.
