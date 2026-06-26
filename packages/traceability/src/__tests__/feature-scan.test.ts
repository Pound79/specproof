import { describe, expect, it } from 'vitest';
import { parseScenarios } from '../feature-scan.js';

describe('parseScenarios', () => {
  it('extracts scenarios with their attached tags (en + ja keywords)', () => {
    const content = [
      '# language: ja',
      '機能: 例',
      '',
      '  @admin',
      '  シナリオ: 管理者が見える',
      '    前提 ログイン済み',
      '',
      '  @slow @generate',
      '  Scenario: english one',
      '    Given a thing',
    ].join('\n');

    const scenarios = parseScenarios(content);

    expect(scenarios).toHaveLength(2);
    expect(scenarios[0]).toMatchObject({
      name: '管理者が見える',
      tags: ['@admin'],
    });
    expect(scenarios[1]).toMatchObject({
      name: 'english one',
      tags: ['@slow', '@generate'],
    });
  });

  it('marks hasReasonComment when a # comment precedes the scenario block', () => {
    const content = [
      '機能: 例',
      '',
      '# メール確認コードが要るため自動化しない',
      '@skip',
      'シナリオ: リセット完了',
      '  前提 未ログイン',
      '',
      '@skip',
      'シナリオ: 理由なし',
      '  前提 未ログイン',
    ].join('\n');

    const scenarios = parseScenarios(content);

    expect(scenarios).toHaveLength(2);
    expect(scenarios[0]).toMatchObject({
      tags: ['@skip'],
      hasReasonComment: true,
    });
    expect(scenarios[1]).toMatchObject({
      tags: ['@skip'],
      hasReasonComment: false,
    });
  });

  it('handles Scenario Outline and matches neither Examples nor steps', () => {
    const content = [
      'Feature: x',
      '  Scenario Outline: param',
      '    Given <a>',
      '    Examples:',
      '      | a |',
      '      | 1 |',
    ].join('\n');

    const scenarios = parseScenarios(content);

    expect(scenarios).toHaveLength(1);
    expect(scenarios[0]).toMatchObject({ name: 'param', tags: [] });
  });

  it('returns an empty list for a feature with no scenarios', () => {
    expect(parseScenarios('# language: ja\n機能: 例\n')).toEqual([]);
  });
});
