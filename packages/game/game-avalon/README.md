# `@deepseek-ai/dsh-game-avalon`

English | [中文](README.zh.md)

`dsh-game-avalon` registers five-, six-, and seven-player Avalon with either one human and the remaining AI seats or an entirely AI-controlled table. Setup selects one validated role preset rather than assembling arbitrary roles. `percival-morgana` is the default at every supported size: five players use Merlin, Percival, one Loyal Servant, the Assassin, and Morgana; six add one Loyal Servant; seven add one Loyal Servant and one Minion. `basic` uses Merlin, the Assassin, two or three Loyal Servants, and one or two Minions. Seven-player tables may instead select `mordred-oberon`, which uses Merlin, three Loyal Servants, the Assassin, Mordred, and Oberon. The complete assignment, preset, and initial leader are durable rule events, so replay is deterministic.

Five-player mission sizes are 2, 3, 2, 3, and 3; six-player mission sizes are 2, 3, 4, 3, and 4; seven-player mission sizes are 2, 3, 3, 4, and 4. A leader publishes an initial team and chooses clockwise or counterclockwise discussion. The adjacent seat in that direction starts, every non-leader speaks in order, and the leader's final summary action submits the team that will be voted on; the leader may retain the initial team or replace members after hearing the discussion. Only after every seat's statement commits does every seat receive a sealed approval vote without an attached statement. A strict majority is required: three approvals at a five-player table or four at a six- or seven-player table. Resolution records and reveals only the approval and rejection counts, never the choice made by a named seat. Approved final-team members submit sealed quest actions. Good roles can only submit success, while evil roles may submit success or failure. One failure action fails every mission except the fourth seven-player mission, which requires two; the browser and model projection publish all five thresholds. A rejection increments the consecutive-rejection count, while any approved team resets it to zero; three failed missions or five consecutive rejected teams give evil an immediate victory. After three successful missions, cooperative evil players speak privately in clockwise seat order after the Assassin, with the Assassin speaking last; Oberon neither participates in nor sees this discussion. Only then does the Assassin receive the private target action. All roles and the evil discussion are revealed after normal resolution.

Active public views omit assignments but publish the selected preset and role counts. A seat projection contains only that seat's role and permitted knowledge. Merlin sees evil players except Mordred, including Oberon. Percival receives two indistinguishable Merlin candidates: Merlin and Morgana. The Assassin, Morgana, Mordred, and Minions recognize the other cooperative evil roles exactly, but they do not see Oberon; Oberon recognizes nobody. During the private endgame discussion, only cooperative evil projections contain its speaker and committed statements. Team-vote history exposes only aggregate approval and rejection counts, and mission history reveals only the failure count rather than individual actions.

The browser-safe `@deepseek-ai/dsh-game-avalon-rules` package owns role ids, labels, ability descriptions, faction membership, valid preset decks, and mission rules. The deterministic definition and browser setup both consume that pure package, while assignment, action legality, durable events, and private projection remain server-owned.

## Match setup

- `playerCount` selects `5`, `6`, or `7` seats and defaults to `5` for API callers; the browser setup defaults to a six-player table.
- `rolePreset` selects `basic`, `percival-morgana`, or, for seven players only, `mordred-oberon`; it defaults to `percival-morgana`.
- Seats must be either entirely AI-controlled or contain exactly one human with every remaining seat AI-controlled.
- `humanRole` optionally fixes the single human seat to a role contained by the resolved preset; it is invalid for an AI-only table, and omission keeps random assignment.

## Configuration

- `maxStatementChars` limits each public pre-vote or private evil statement and defaults to `280`.

## Model Experience

### Avalon action

#### What the model sees

The AI receives the selected table's exact preset deck, mission sizes, mission-failure thresholds, majority threshold, its current seat projection, and a JSON schema for only its current legal action, such as `propose-team`, `make-statement`, `make-evil-statement`, or `quest`. The rules prompt states that team votes are anonymous, only their aggregate counts are revealed, only consecutive rejections count toward the evil victory, and approval resets the count. It distinguishes statements from evidence, forbids assigning an aggregate vote to another named seat, explains that mission success does not prove every team member good, and treats a failed mission as evil progress rather than a cost-free probe. Role guidance tells Percival to compare and protect candidates without exposing them, Morgana to imitate hidden knowledge, Mordred to exploit Merlin's blind spot, the Assassin to track Merlin, and Merlin that an unobserved Mordred is not proven good. Cooperative evil quest guidance names only cooperative allies and gives them one deterministic clockwise convention for contributing the required failures. Oberon instead receives independent quest guidance with no ally list, failure assignment, or private discussion. The leader's final `make-statement` schema requires both its summary and final team, while other speakers submit only their statement. Reasoning, natural-language output, and statements are instructed to use Simplified Chinese. The prompt forbids disclosing or quoting private role knowledge in public statements, permits cooperative evil knowledge in the private evil discussion, and rejects an AI statement without Chinese text.

#### Token effect

One rules-and-observation prompt is added for every AI proposal, pre-vote statement, team vote, quest action, evil discussion statement, or assassination choice. A team proposal opens one sequential statement action per seat after the proposal. One-human tables use four, five, or six AI statement turns for five-, six-, or seven-player tables; AI-only tables use five, six, or seven. The endgame adds two or three sequential cooperative-evil statements according to the selected deck; the seven-player `mordred-oberon` preset still adds only two because Oberon is excluded.

#### KV Cache effect

The rules and faction prefix is stable per seat; phase guidance, mission history, public statements, private observation, and action schema change as events commit.

## Known Limitations and Deferred Work

- The role catalog currently stops at Merlin, Percival, Loyal Servant, Assassin, Morgana, Mordred, Oberon, and Minion. Tables of eight or more players, Lancelot variants, the Lady of the Lake, free-form chat, spectator policy, and social moderation remain deferred.
