import { describe, expect, it } from 'vitest'
import {
  AVALON_ROLES,
  DEFAULT_AVALON_ROLE_PRESET,
  avalonRoleAlignment,
  avalonRoleDescription,
  avalonRoleLabel,
  avalonRolePresetInfo,
  avalonRolePresetsForPlayerCount,
  isAvalonEvilRole,
  isAvalonRole,
  isAvalonRolePreset,
  participatesInAvalonEvilNetwork,
  resolveAvalonRules,
} from '../src/index.ts'

describe('Avalon shared rules', () => {
  it('describes every role and its information network', () => {
    expect(DEFAULT_AVALON_ROLE_PRESET).toBe('percival-morgana')
    expect(AVALON_ROLES.map(avalonRoleLabel)).toEqual([
      '梅林', '派西维尔', '亚瑟的忠臣', '刺客', '莫甘娜', '莫德雷德', '奥伯伦', '莫德雷德的爪牙',
    ])
    expect(AVALON_ROLES.map(avalonRoleDescription).every(description => description.length > 0)).toBe(true)
    expect(AVALON_ROLES.map(avalonRoleAlignment)).toEqual([
      'good', 'good', 'good', 'evil', 'evil', 'evil', 'evil', 'evil',
    ])
    expect(AVALON_ROLES.filter(isAvalonEvilRole)).toEqual([
      'assassin', 'morgana', 'mordred', 'oberon', 'minion',
    ])
    expect(AVALON_ROLES.filter(participatesInAvalonEvilNetwork)).toEqual([
      'assassin', 'morgana', 'mordred', 'minion',
    ])
    expect(isAvalonRole('percival')).toBe(true)
    expect(isAvalonRole('lancelot')).toBe(false)
  })

  it('offers only presets supported by the selected table size', () => {
    expect(avalonRolePresetsForPlayerCount(5).map(preset => preset.id)).toEqual([
      'basic', 'percival-morgana',
    ])
    expect(avalonRolePresetsForPlayerCount(6).map(preset => preset.id)).toEqual([
      'basic', 'percival-morgana',
    ])
    expect(avalonRolePresetsForPlayerCount(7).map(preset => preset.id)).toEqual([
      'basic', 'percival-morgana', 'mordred-oberon',
    ])
    expect(avalonRolePresetInfo('mordred-oberon')).toMatchObject({ label: '莫德雷德与奥伯伦' })
    expect(isAvalonRolePreset('basic')).toBe(true)
    expect(isAvalonRolePreset('custom')).toBe(false)
  })

  it('resolves all fair decks with the table mission rules', () => {
    expect(resolveAvalonRules(5, 'basic')).toMatchObject({
      roleDeck: ['merlin', 'loyal-servant', 'loyal-servant', 'assassin', 'minion'],
      missionSizes: [2, 3, 2, 3, 3],
    })
    expect(resolveAvalonRules(6, 'percival-morgana')).toMatchObject({
      roleDeck: ['merlin', 'percival', 'loyal-servant', 'loyal-servant', 'assassin', 'morgana'],
      missionSizes: [2, 3, 4, 3, 4],
    })
    expect(resolveAvalonRules(7, 'mordred-oberon')).toMatchObject({
      roleDeck: ['merlin', 'loyal-servant', 'loyal-servant', 'loyal-servant', 'assassin', 'mordred', 'oberon'],
      missionFailThresholds: [1, 1, 1, 2, 1],
    })
    expect(() => resolveAvalonRules(5, 'mordred-oberon')).toThrow(/does not support 5 players/)
  })
})
