import { describe, expect, it } from 'vitest';
import { buildStats, formatStats, type FeatureScenarios } from '../stats.js';
import type { ScannedScenario } from '../feature-scan.js';

const scenario = (tags: string[]): ScannedScenario => ({
  line: 1,
  name: 's',
  tags,
  hasReasonComment: true,
});

describe('buildStats', () => {
  it('classifies scenarios into automated / fixme / skip per domain', () => {
    const features: FeatureScenarios[] = [
      {
        domain: 'features/a.feature',
        scenarios: [scenario([]), scenario(['@slow']), scenario(['@fixme'])],
      },
      {
        domain: 'features/b.feature',
        scenarios: [scenario(['@skip']), scenario(['@fixme', '@admin'])],
      },
    ];

    const report = buildStats(features);

    expect(report.domains[0]).toEqual({
      domain: 'features/a.feature',
      total: 3,
      automated: 2, // tagless + @slow both count as automated
      fixme: 1,
      skip: 0,
    });
    expect(report.domains[1]).toEqual({
      domain: 'features/b.feature',
      total: 2,
      automated: 0,
      fixme: 1, // @fixme wins over @skip/@admin
      skip: 1,
    });
    expect(report.totals).toEqual({
      domain: 'TOTAL',
      total: 5,
      automated: 2,
      fixme: 2,
      skip: 1,
    });
    expect(report.fixmeClean).toBe(false);
  });

  it('reports fixmeClean when no @fixme remain', () => {
    const report = buildStats([
      {
        domain: 'features/a.feature',
        scenarios: [scenario([]), scenario(['@skip'])],
      },
    ]);

    expect(report.fixmeClean).toBe(true);
    expect(report.totals).toMatchObject({
      total: 2,
      automated: 1,
      skip: 1,
      fixme: 0,
    });
  });

  it('classifies by custom tags.fixme / tags.skip when supplied', () => {
    const report = buildStats(
      [
        {
          domain: 'features/a.feature',
          // @fixme/@skip must NOT be recognised once tags are renamed —
          // otherwise the false-green this fix targets reappears.
          scenarios: [
            scenario(['@todo']),
            scenario(['@manual']),
            scenario(['@fixme']),
          ],
        },
      ],
      { fixmeTag: '@todo', skipTag: '@manual' }
    );

    expect(report.totals).toMatchObject({
      total: 3,
      fixme: 1, // only @todo counts as fixme now
      skip: 1, // only @manual counts as skip now
      automated: 1, // the old @fixme is no longer reason-required → automated
    });
    expect(report.fixmeClean).toBe(false); // an outstanding @todo blocks done
    expect(report.fixmeTag).toBe('@todo');
    expect(report.skipTag).toBe('@manual');
  });

  it('treats default @fixme as automated under a renamed taxonomy (no false green)', () => {
    const report = buildStats(
      [{ domain: 'features/a.feature', scenarios: [scenario(['@fixme'])] }],
      { fixmeTag: '@todo', skipTag: '@manual' }
    );

    // The whole point: a stray @fixme in a repo that renamed its tags is not a
    // silently-counted "fixme" — it's an unrecognised tag, hence automated, and
    // fixmeClean stays true only because no @todo remain.
    expect(report.totals.fixme).toBe(0);
    expect(report.totals.automated).toBe(1);
    expect(report.fixmeClean).toBe(true);
  });
});

describe('formatStats', () => {
  it('renders the census and a done line, honest that green needs a run', () => {
    const out = formatStats(
      buildStats([
        {
          domain: 'features/a.feature',
          scenarios: [scenario([]), scenario(['@fixme'])],
        },
      ])
    );

    expect(out).toContain(
      'features/a.feature: 2 total / 1 automated / @fixme 1 / @skip 0'
    );
    expect(out).toContain('@fixme remaining: 1');
    expect(out).toContain('GREEN still requires running');
  });

  it('renders the done-met line when no @fixme remain', () => {
    const out = formatStats(
      buildStats([
        {
          domain: 'features/a.feature',
          scenarios: [scenario([]), scenario(['@skip'])],
        },
      ])
    );

    expect(out).toContain('@fixme is 0');
  });

  it('renders the repo\'s actual tag names, not the defaults', () => {
    const out = formatStats(
      buildStats(
        [
          {
            domain: 'features/a.feature',
            scenarios: [scenario(['@todo']), scenario(['@manual'])],
          },
        ],
        { fixmeTag: '@todo', skipTag: '@manual' }
      )
    );

    expect(out).toContain(
      'features/a.feature: 2 total / 0 automated / @todo 1 / @manual 1'
    );
    expect(out).toContain('@todo remaining: 1');
    expect(out).toContain('demote to @manual');
    expect(out).not.toContain('@fixme');
    expect(out).not.toContain('@skip');
  });
});
