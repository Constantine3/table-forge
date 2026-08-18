/** Browser-safe Avalon role, preset, and mission rules. @module @deepseek-ai/dsh-game-avalon-rules */

/** Rules version shared by the Avalon definition and its browser setup. */
export const AVALON_RULES_VERSION = 12

/** Roles used by the supported Avalon presets. */
export type AvalonRole =
  | 'merlin'
  | 'percival'
  | 'loyal-servant'
  | 'assassin'
  | 'morgana'
  | 'mordred'
  | 'oberon'
  | 'minion'

/** Public faction of an Avalon role. */
export type AvalonAlignment = 'good' | 'evil'

/** Supported Avalon table sizes. */
export type AvalonPlayerCount = 5 | 6 | 7 | 8

/** Fair role combinations offered during match setup. */
export type AvalonRolePreset = 'basic' | 'percival-morgana' | 'mordred-oberon'

/** Complete deterministic rules selected by table size and role preset. */
export interface AvalonRules {
  /** Roles assigned at this table. */
  readonly roleDeck: readonly AvalonRole[]
  /** Required team size for each of the five missions. */
  readonly missionSizes: readonly [number, number, number, number, number]
  /** Failure actions required to fail each mission. */
  readonly missionFailThresholds: readonly [number, number, number, number, number]
}

/** Setup metadata for one selectable role preset. */
export interface AvalonRolePresetInfo {
  /** Stable setup identifier. */
  readonly id: AvalonRolePreset
  /** Chinese display name. */
  readonly label: string
  /** Concise explanation of the preset's information pattern. */
  readonly description: string
}

/** Default role preset for a new Avalon setup. */
export const DEFAULT_AVALON_ROLE_PRESET: AvalonRolePreset = 'percival-morgana'

/** Every role accepted by Avalon configuration and durable state. */
export const AVALON_ROLES: readonly AvalonRole[] = [
  'merlin',
  'percival',
  'loyal-servant',
  'assassin',
  'morgana',
  'mordred',
  'oberon',
  'minion',
]

const PRESETS: Readonly<Record<AvalonRolePreset, AvalonRolePresetInfo>> = {
  basic: {
    id: 'basic',
    label: '基础身份',
    description: '信息关系最直接，适合熟悉任务、组队和匿名投票。',
  },
  'percival-morgana': {
    id: 'percival-morgana',
    label: '派西维尔与莫甘娜',
    description: '派西维尔看到两名梅林候选，莫甘娜负责伪装。',
  },
  'mordred-oberon': {
    id: 'mordred-oberon',
    label: '莫德雷德与奥伯伦',
    description: '七至八人进阶组合：梅林看不到莫德雷德，奥伯伦脱离邪方协作。',
  },
}

const MISSION_RULES: Readonly<Record<AvalonPlayerCount, Omit<AvalonRules, 'roleDeck'>>> = {
  5: { missionSizes: [2, 3, 2, 3, 3], missionFailThresholds: [1, 1, 1, 1, 1] },
  6: { missionSizes: [2, 3, 4, 3, 4], missionFailThresholds: [1, 1, 1, 1, 1] },
  7: { missionSizes: [2, 3, 3, 4, 4], missionFailThresholds: [1, 1, 1, 2, 1] },
  8: { missionSizes: [3, 4, 4, 5, 5], missionFailThresholds: [1, 1, 1, 2, 1] },
}

const ROLE_DECKS: Readonly<Record<AvalonRolePreset, Partial<Record<AvalonPlayerCount, readonly AvalonRole[]>>>> = {
  basic: {
    5: ['merlin', 'loyal-servant', 'loyal-servant', 'assassin', 'minion'],
    6: ['merlin', 'loyal-servant', 'loyal-servant', 'loyal-servant', 'assassin', 'minion'],
    7: ['merlin', 'loyal-servant', 'loyal-servant', 'loyal-servant', 'assassin', 'minion', 'minion'],
    8: ['merlin', 'loyal-servant', 'loyal-servant', 'loyal-servant', 'loyal-servant', 'assassin', 'minion', 'minion'],
  },
  'percival-morgana': {
    5: ['merlin', 'percival', 'loyal-servant', 'assassin', 'morgana'],
    6: ['merlin', 'percival', 'loyal-servant', 'loyal-servant', 'assassin', 'morgana'],
    7: ['merlin', 'percival', 'loyal-servant', 'loyal-servant', 'assassin', 'morgana', 'minion'],
    8: ['merlin', 'percival', 'loyal-servant', 'loyal-servant', 'loyal-servant', 'assassin', 'morgana', 'minion'],
  },
  'mordred-oberon': {
    7: ['merlin', 'loyal-servant', 'loyal-servant', 'loyal-servant', 'assassin', 'mordred', 'oberon'],
    8: ['merlin', 'loyal-servant', 'loyal-servant', 'loyal-servant', 'loyal-servant', 'assassin', 'mordred', 'oberon'],
  },
}

/** Test whether a string is a supported Avalon role.
 * @param value - Candidate role id.
 * @returns Whether the id is supported.
 */
export function isAvalonRole(value: string): value is AvalonRole {
  return (AVALON_ROLES as readonly string[]).includes(value)
}

/** Test whether a string is a supported preset id.
 * @param value - Candidate preset id.
 * @returns Whether the id is supported.
 */
export function isAvalonRolePreset(value: string): value is AvalonRolePreset {
  return Object.hasOwn(PRESETS, value)
}

/** Return a role's faction.
 * @param role - Avalon role.
 * @returns Good or evil.
 */
export function avalonRoleAlignment(role: AvalonRole): AvalonAlignment {
  return role === 'merlin' || role === 'percival' || role === 'loyal-servant' ? 'good' : 'evil'
}

/** Test whether a role may submit a mission failure.
 * @param role - Avalon role.
 * @returns Whether the role is evil.
 */
export function isAvalonEvilRole(role: AvalonRole): boolean {
  return avalonRoleAlignment(role) === 'evil'
}

/** Test whether an evil role participates in shared evil knowledge and discussion.
 * @param role - Avalon role.
 * @returns Whether the role belongs to the cooperative evil network.
 */
export function participatesInAvalonEvilNetwork(role: AvalonRole): boolean {
  return isAvalonEvilRole(role) && role !== 'oberon'
}

/** Return the Chinese role name.
 * @param role - Avalon role.
 * @returns Display name.
 */
export function avalonRoleLabel(role: AvalonRole): string {
  switch (role) {
    case 'merlin': return '梅林'
    case 'percival': return '派西维尔'
    case 'loyal-servant': return '亚瑟的忠臣'
    case 'assassin': return '刺客'
    case 'morgana': return '莫甘娜'
    case 'mordred': return '莫德雷德'
    case 'oberon': return '奥伯伦'
    case 'minion': return '莫德雷德的爪牙'
  }
}

/** Return a concise Chinese ability explanation.
 * @param role - Avalon role.
 * @returns Ability text.
 */
export function avalonRoleDescription(role: AvalonRole): string {
  switch (role) {
    case 'merlin': return '知道除莫德雷德外的邪方，但必须隐藏自己。'
    case 'percival': return '看到梅林与莫甘娜两名候选，但无法分辨。'
    case 'loyal-servant': return '没有额外身份信息，依靠公开记录推理。'
    case 'assassin': return '属于邪方协作阵营；善方三次成功后负责刺杀梅林。'
    case 'morgana': return '属于邪方协作阵营；会作为假梅林出现在派西维尔视野中。'
    case 'mordred': return '属于邪方协作阵营；不会出现在梅林的邪方视野中。'
    case 'oberon': return '属于邪方但不参与邪方互认与刺杀密谈，需独立判断。'
    case 'minion': return '属于邪方协作阵营，认识其他协作邪方。'
  }
}

/** Return one preset's setup metadata.
 * @param preset - Preset id.
 * @returns Display metadata.
 */
export function avalonRolePresetInfo(preset: AvalonRolePreset): AvalonRolePresetInfo {
  return PRESETS[preset]
}

/** List presets valid for one table size.
 * @param playerCount - Table size.
 * @returns Selectable presets in stable UI order.
 */
export function avalonRolePresetsForPlayerCount(playerCount: AvalonPlayerCount): readonly AvalonRolePresetInfo[] {
  return (Object.keys(PRESETS) as AvalonRolePreset[])
    .filter(preset => ROLE_DECKS[preset][playerCount] !== undefined)
    .map(preset => PRESETS[preset])
}

/** Resolve the complete rules for a valid setup.
 * @param playerCount - Table size.
 * @param preset - Role preset.
 * @returns Role deck and mission rules.
 */
export function resolveAvalonRules(playerCount: AvalonPlayerCount, preset: AvalonRolePreset): AvalonRules {
  const roleDeck = ROLE_DECKS[preset][playerCount]
  if (roleDeck === undefined) {
    throw new Error(`Avalon role preset '${preset}' does not support ${playerCount} players`)
  }
  return { roleDeck, ...MISSION_RULES[playerCount] }
}
