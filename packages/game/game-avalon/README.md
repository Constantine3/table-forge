# `@deepseek-ai/dsh-game-avalon`

English | [中文](README.zh.md)

`dsh-game-avalon` registers five- and six-player Avalon with either one human and the remaining AI seats or an entirely AI-controlled table. Setup selects the table size and may pin the single human to Merlin, the Assassin, a Loyal Servant, or the Minion; AI-only tables and omitted human choices assign every role from a private random seed. Five-player tables contain two Loyal Servants, while six-player tables contain three. The complete assignment and initial leader are durable rule events, so replay is deterministic.

Five-player mission sizes are 2, 3, 2, 3, and 3; six-player mission sizes are 2, 3, 4, 3, and 4. A leader publishes an initial team and chooses clockwise or counterclockwise discussion. The adjacent seat in that direction starts, every non-leader speaks in order, and the leader's final summary action submits the team that will be voted on; the leader may retain the initial team or replace members after hearing the discussion. Only after all five or six statements commit does every seat receive a sealed approval vote without an attached statement. A strict majority is required: three approvals at a five-player table or four at a six-player table. Resolution records and reveals only the approval and rejection counts, never the choice made by a named seat. Approved final-team members submit sealed quest actions. Loyal roles can only submit success, while evil roles may submit success or failure. A rejection increments the consecutive-rejection count, while any approved team resets it to zero; three failed missions or five consecutive rejected teams give evil an immediate victory. After three successful missions, evil players speak privately in clockwise seat order after the Assassin, with the Assassin speaking last; only then does the Assassin receive the private target action. All roles and the evil discussion are revealed after normal resolution.

Active public views omit roles. A seat projection contains only that seat's role and permitted knowledge: Merlin sees the two evil seats, evil players recognize each other, and Loyal Servants receive no extra identity information. During the private endgame discussion, only evil seat projections contain its speaker and committed statements; non-evil projections expose neither. Team-vote history exposes only aggregate approval and rejection counts, and mission history reveals only the failure count rather than individual actions.

## Match setup

- `playerCount` selects `5` or `6` seats and defaults to `5` for API callers; the browser setup defaults to a six-player table.
- Seats must be either entirely AI-controlled or contain exactly one human with every remaining seat AI-controlled.
- `humanRole` optionally fixes the single human seat to `merlin`, `loyal-servant`, `assassin`, or `minion`; it is invalid for an AI-only table, and omission keeps random assignment.

## Configuration

- `maxStatementChars` limits each public pre-vote or private evil statement and defaults to `280`.

## Model Experience

### Avalon action

#### What the model sees

The AI receives the selected table's role deck, mission sizes, majority threshold, its current seat projection, and a JSON schema for only its current legal action, such as `propose-team`, `make-statement`, `make-evil-statement`, or `quest`. The rules prompt states that team votes are anonymous, only their aggregate counts are revealed, only consecutive rejections count toward the evil victory, and approval resets the count. The leader's final `make-statement` schema requires both its summary and final team, while other speakers submit only their statement. Reasoning, natural-language output, and statements are instructed to use Simplified Chinese. The prompt forbids disclosing or quoting private role knowledge in public statements, permits that knowledge in the private evil discussion, and rejects an AI statement without Chinese text.

#### Token effect

One rules-and-observation prompt is added for every AI proposal, pre-vote statement, team vote, quest action, evil discussion statement, or assassination choice. A team proposal opens one sequential statement action per seat after the proposal. One-human tables use four AI statement turns for five players or five for six; AI-only tables use five or six. The endgame adds two sequential evil statements; both use AI turns on an AI-only table, while one or both do so according to the human's role on a mixed table.

#### KV Cache effect

The rules prefix is stable per seat; mission history, public statements, private observation, and action schema change as events commit.

## Known Limitations and Deferred Work

- The plugin intentionally omits additional Avalon roles, tables of seven or more players, free-form chat, spectator policy, and social moderation.
