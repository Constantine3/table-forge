# `@deepseek-ai/dsh-client-ui-game-avalon`

English | [中文](README.zh.md)

This browser plugin contributes the `avalon` catalog card, five-, six-, or seven-seat setup, and round-table board to `dsh-client-ui-game`. Setup defaults to a six-player human-and-AI table and the balanced Percival-and-Morgana preset, lets the user switch to five or seven players or an AI-only table, and selects a provider independently for every AI seat. Role setup is limited to the presets resolved by `@deepseek-ai/dsh-game-avalon-rules`; the Mordred-and-Oberon preset appears only for seven players, and changing to an unsupported size returns to the default preset. Setup and the active board display the actual role deck and counts. Each public role-count label reveals its faction and rule description on pointer hover or keyboard or touch focus; it never identifies a seat's hidden role. Human participation offers random assignment or a role that exists in the selected deck; AI-only setup removes that control and creates five, six, or seven Agent seats.

During play, every seat is positioned dynamically around a circular table whose center shows the selected speaking direction and current speaker. The identity panel explains the human role and renders private knowledge by kind: Merlin's visible evil seats, Percival's unresolved candidate pair, or exact cooperative-evil allies. Oberon receives no ally list. The five projected mission sizes and results form a vertical rail beside the table at desktop widths and a horizontal row on narrow screens; a mission whose failure threshold exceeds one is labeled before play. A clockwise leader-rotation label relies on the circular seat order and current-leader styling instead of duplicating every seat in another list. Controls come from the human seat's current action schema when one exists: a human leader selects the initial team and direction, each human speaker receives a statement editor, and the leader's final turn re-enables the seat controls so the summary action can retain or revise the team. AI-only tables render the public observation without action controls. The board labels the initial and final teams separately and shows ordered pre-vote statements, mission failure counts, and only permitted identity knowledge. Each collapsed history summary includes the anonymous approval and rejection counts; expanding it reveals that round's public statements. Approval controls appear only after every player has spoken and the leader commits the final team.

After three successful missions, cooperative evil players receive private statement controls in clockwise order and the Assassin receives the final summary turn before target selection. Their projections show committed private statements and the current speaker; good players and Oberon see only that private discussion is in progress. The assassination wait state does not identify the acting seat. A normal finish reveals all roles and evil statements and enables explicit AI audit loading. The shared audit timeline labels private evil statements as assassination discussion and the Assassin's accepted target as an assassination decision. Abandonment keeps undisclosed identities hidden and never offers audit loading.

## Model Experience

### Avalon presentation

#### What the model sees

Nothing. The contribution renders the public or human-seat `avalon` Remote projection and never creates a model request.

#### Token effect

Zero tokens.

#### KV Cache effect

No effect.

## Known Limitations and Deferred Work

- Provider selection does not expose per-seat persona editing. Custom role assembly remains unavailable because setup accepts only server-validated presets.
