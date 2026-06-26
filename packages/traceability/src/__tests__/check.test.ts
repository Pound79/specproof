import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkDrift } from '../check.js';
import { isCheckFailure } from '../cli-check-format.js';
import {
  DRAFT_MARKER,
  computeFileHash,
  computeHeadingSectionHash,
} from '../hash.js';
import { saveManifest, type TraceabilityManifest } from '../manifest.js';
import { updateManifestHashes } from '../update.js';

const SPEC_DOC = [
  '# Spec',
  '',
  '## 1. Login',
  '',
  'login spec body',
  '',
  '## 2. History',
  '',
  'history spec body',
  '',
].join('\n');

const buildRepo = async (root: string): Promise<void> => {
  await mkdir(path.join(root, 'docs'), { recursive: true });
  await mkdir(path.join(root, 'src'), { recursive: true });
  await mkdir(path.join(root, 'features'), { recursive: true });
  await writeFile(path.join(root, 'docs/spec.md'), SPEC_DOC, 'utf8');
  await writeFile(
    path.join(root, 'src/login.ts'),
    'export const login = 1;\n',
    'utf8'
  );
  await writeFile(
    path.join(root, 'features/login.feature'),
    '機能: ログイン\n',
    'utf8'
  );
};

const buildManifest = async (root: string): Promise<TraceabilityManifest> => ({
  version: 1,
  links: [
    {
      id: 'login',
      label: 'ログイン',
      spec: [
        {
          path: 'docs/spec.md',
          heading: '1. Login',
          hash: await computeHeadingSectionHash(
            path.join(root, 'docs/spec.md'),
            '1. Login'
          ),
        },
      ],
      impl: [
        {
          path: 'src/login.ts',
          hash: await computeFileHash(path.join(root, 'src/login.ts')),
        },
      ],
      features: [
        {
          path: 'features/login.feature',
          hash: await computeFileHash(
            path.join(root, 'features/login.feature')
          ),
        },
      ],
    },
  ],
});

describe('checkDrift', () => {
  let root: string;
  let manifestPath: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'traceability-check-'));
    manifestPath = path.join(root, 'traceability.yaml');
    await buildRepo(root);
    await saveManifest(manifestPath, await buildManifest(root));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('reports clean when all hashes match', async () => {
    const report = await checkDrift(manifestPath, root);

    expect(report.clean).toBe(true);
    expect(report.driftCount).toBe(0);
    expect(report.driftLinkCount).toBe(0);
    expect(report.entries).toEqual([]);
    expect(report.warnings).toEqual([]);
  });

  it('warns about a link that tracks nothing, without affecting clean/drift', async () => {
    const manifest = await buildManifest(root);
    const withOrphan = {
      ...manifest,
      links: [
        ...manifest.links,
        { id: 'orphan', label: 'Orphan', spec: [], impl: [], features: [] },
      ],
    };
    await saveManifest(manifestPath, withOrphan);

    const report = await checkDrift(manifestPath, root);

    expect(report.clean).toBe(true);
    expect(report.driftCount).toBe(0);
    expect(report.warnings).toHaveLength(1);
    expect(report.warnings[0]).toMatchObject({
      linkId: 'orphan',
      kind: 'empty-link',
    });
  });

  it('flags a feature that still carries the bdd-kit draft marker', async () => {
    await writeFile(
      path.join(root, 'features/login.feature'),
      `# language: ja\n${DRAFT_MARKER}\n機能: ログイン\n`,
      'utf8'
    );
    // Re-bless so the hash matches the marker content: this isolates the draft
    // warning from drift (clean stays true; the marker is a separate concern).
    await saveManifest(manifestPath, await buildManifest(root));

    const report = await checkDrift(manifestPath, root);

    expect(report.clean).toBe(true);
    expect(report.warnings).toContainEqual(
      expect.objectContaining({ linkId: 'login', kind: 'unreviewed-draft' })
    );
  });

  it('flags an unregistered featuresDir draft and fails only under --strict', async () => {
    await writeFile(
      path.join(root, 'features/copied-draft.feature'),
      `# language: ja\n${DRAFT_MARKER}\n機能: コピーされた草案\n`,
      'utf8'
    );

    const report = await checkDrift(manifestPath, root, {
      featuresDir: 'features',
    });

    const draft = report.warnings.find(
      (warning) => warning.path === 'features/copied-draft.feature'
    );
    expect(draft).toMatchObject({ kind: 'unreviewed-draft' });
    expect(draft?.linkId).toBeUndefined(); // unregistered file: not tied to a link
    expect(isCheckFailure(report, true)).toBe(true);
    expect(isCheckFailure(report, false)).toBe(false);
  });

  it('does not double-warn a registered feature that also lives under featuresDir', async () => {
    await writeFile(
      path.join(root, 'features/login.feature'),
      `# language: ja\n${DRAFT_MARKER}\n機能: ログイン\n`,
      'utf8'
    );
    await saveManifest(manifestPath, await buildManifest(root));

    const report = await checkDrift(manifestPath, root, {
      featuresDir: 'features',
    });

    const loginDraftWarnings = report.warnings.filter(
      (warning) =>
        warning.kind === 'unreviewed-draft' &&
        warning.path === 'features/login.feature'
    );
    expect(loginDraftWarnings).toHaveLength(1);
    expect(loginDraftWarnings[0]?.linkId).toBe('login'); // registered side wins
  });

  it('flags a @skip scenario that has no reason comment', async () => {
    await writeFile(
      path.join(root, 'features/login.feature'),
      [
        '# language: ja',
        '機能: ログイン',
        '',
        '@skip',
        'シナリオ: 理由なしスキップ',
        '  前提 未ログイン状態である',
      ].join('\n'),
      'utf8'
    );
    await saveManifest(manifestPath, await buildManifest(root));

    const report = await checkDrift(manifestPath, root, {
      featuresDir: 'features',
    });

    expect(report.warnings).toContainEqual(
      expect.objectContaining({
        kind: 'missing-skip-reason',
        path: 'features/login.feature',
        linkId: 'login',
      })
    );
  });

  it('does not flag a @skip scenario that has a reason comment', async () => {
    await writeFile(
      path.join(root, 'features/login.feature'),
      [
        '# language: ja',
        '機能: ログイン',
        '',
        '# メール確認コードが要るため当面自動化しない',
        '@skip',
        'シナリオ: リセット完了',
        '  前提 未ログイン状態である',
      ].join('\n'),
      'utf8'
    );
    await saveManifest(manifestPath, await buildManifest(root));

    const report = await checkDrift(manifestPath, root, {
      featuresDir: 'features',
    });

    expect(
      report.warnings.filter((warning) => warning.kind === 'missing-skip-reason')
    ).toEqual([]);
  });

  it('names @fixme (not @skip) when a reason-less scenario carries both', async () => {
    await writeFile(
      path.join(root, 'features/login.feature'),
      [
        '# language: ja',
        '機能: ログイン',
        '',
        '@fixme @skip',
        'シナリオ: 両方タグだが理由なし',
        '  前提 未ログイン状態である',
      ].join('\n'),
      'utf8'
    );
    await saveManifest(manifestPath, await buildManifest(root));

    const report = await checkDrift(manifestPath, root, {
      featuresDir: 'features',
    });

    const warning = report.warnings.find(
      (w) => w.kind === 'missing-skip-reason'
    );
    expect(warning?.message).toContain('@fixme');
  });

  it('flags a reason-less custom skip tag when the taxonomy is renamed', async () => {
    await writeFile(
      path.join(root, 'features/login.feature'),
      [
        '# language: ja',
        '機能: ログイン',
        '',
        '@manual',
        'シナリオ: 理由なし手動',
        '  前提 未ログイン状態である',
      ].join('\n'),
      'utf8'
    );
    await saveManifest(manifestPath, await buildManifest(root));

    const report = await checkDrift(manifestPath, root, {
      featuresDir: 'features',
      reasonRequiredTags: ['@todo', '@manual'],
    });

    expect(report.warnings).toContainEqual(
      expect.objectContaining({
        kind: 'missing-skip-reason',
        path: 'features/login.feature',
        linkId: 'login',
      })
    );
  });

  it('does not flag the default @skip once the taxonomy is renamed away from it', async () => {
    await writeFile(
      path.join(root, 'features/login.feature'),
      [
        '# language: ja',
        '機能: ログイン',
        '',
        '@skip',
        'シナリオ: 旧タグだが理由なし',
        '  前提 未ログイン状態である',
      ].join('\n'),
      'utf8'
    );
    await saveManifest(manifestPath, await buildManifest(root));

    const report = await checkDrift(manifestPath, root, {
      featuresDir: 'features',
      reasonRequiredTags: ['@todo', '@manual'],
    });

    expect(
      report.warnings.filter((w) => w.kind === 'missing-skip-reason')
    ).toEqual([]);
  });

  it('names the custom fixme tag (first in priority) over the skip tag', async () => {
    await writeFile(
      path.join(root, 'features/login.feature'),
      [
        '# language: ja',
        '機能: ログイン',
        '',
        '@todo @manual',
        'シナリオ: 両方タグだが理由なし',
        '  前提 未ログイン状態である',
      ].join('\n'),
      'utf8'
    );
    await saveManifest(manifestPath, await buildManifest(root));

    const report = await checkDrift(manifestPath, root, {
      featuresDir: 'features',
      reasonRequiredTags: ['@todo', '@manual'],
    });

    const warning = report.warnings.find(
      (w) => w.kind === 'missing-skip-reason'
    );
    expect(warning?.message).toContain('@todo');
  });

  it('reports impl drift when an implementation file changes', async () => {
    await writeFile(
      path.join(root, 'src/login.ts'),
      'export const login = 2;\n',
      'utf8'
    );

    const report = await checkDrift(manifestPath, root);

    expect(report.clean).toBe(false);
    expect(report.driftCount).toBe(1);
    expect(report.driftLinkCount).toBe(1);
    expect(report.entries[0]).toMatchObject({
      linkId: 'login',
      side: 'impl',
      path: 'src/login.ts',
      status: 'changed',
    });
  });

  it('counts distinct links separately from drifted ref entries', async () => {
    await writeFile(
      path.join(root, 'src/login.ts'),
      'export const login = 9;\n',
      'utf8'
    );
    await writeFile(
      path.join(root, 'features/login.feature'),
      '機能: ログイン v2\n',
      'utf8'
    );

    const report = await checkDrift(manifestPath, root);

    // One link, but two of its refs (impl + feature) drifted.
    expect(report.driftCount).toBe(2);
    expect(report.driftLinkCount).toBe(1);
  });

  it('reports spec drift only for the linked heading section', async () => {
    const edited = SPEC_DOC.replace(
      'history spec body',
      'history spec body v2'
    );
    await writeFile(path.join(root, 'docs/spec.md'), edited, 'utf8');

    const untouched = await checkDrift(manifestPath, root);
    expect(untouched.clean).toBe(true);

    const editedLinked = SPEC_DOC.replace(
      'login spec body',
      'login spec body v2'
    );
    await writeFile(path.join(root, 'docs/spec.md'), editedLinked, 'utf8');

    const report = await checkDrift(manifestPath, root);
    expect(report.entries[0]).toMatchObject({
      linkId: 'login',
      side: 'spec',
      path: 'docs/spec.md',
      heading: '1. Login',
      status: 'changed',
    });
  });

  it('reports missing when a linked file is deleted', async () => {
    await rm(path.join(root, 'features/login.feature'));

    const report = await checkDrift(manifestPath, root);

    expect(report.entries[0]).toMatchObject({
      linkId: 'login',
      side: 'feature',
      path: 'features/login.feature',
      status: 'missing',
    });
  });

  it('reports missing even when the stored hash is already a FILE_MISSING sentinel', async () => {
    const manifest = await buildManifest(root);
    const tampered = {
      ...manifest,
      links: manifest.links.map((link) => ({
        ...link,
        impl: link.impl.map((ref) => ({ ...ref, hash: 'FILE_MISSING' })),
      })),
    };
    await saveManifest(manifestPath, tampered);
    await rm(path.join(root, 'src/login.ts'));

    const report = await checkDrift(manifestPath, root);

    expect(report.entries).toContainEqual(
      expect.objectContaining({
        linkId: 'login',
        side: 'impl',
        path: 'src/login.ts',
        status: 'missing',
      })
    );
  });

  it('reports missing even when the stored hash is already a SECTION_MISSING sentinel', async () => {
    const manifest = await buildManifest(root);
    const tampered = {
      ...manifest,
      links: manifest.links.map((link) => ({
        ...link,
        spec: link.spec.map((ref) => ({ ...ref, hash: 'SECTION_MISSING' })),
      })),
    };
    await saveManifest(manifestPath, tampered);
    const renamed = SPEC_DOC.replace('## 1. Login', '## 1. Sign in');
    await writeFile(path.join(root, 'docs/spec.md'), renamed, 'utf8');

    const report = await checkDrift(manifestPath, root);

    expect(report.entries).toContainEqual(
      expect.objectContaining({
        linkId: 'login',
        side: 'spec',
        heading: '1. Login',
        status: 'missing',
      })
    );
  });

  it('reports missing when a linked heading is renamed', async () => {
    const renamed = SPEC_DOC.replace('## 1. Login', '## 1. Sign in');
    await writeFile(path.join(root, 'docs/spec.md'), renamed, 'utf8');

    const report = await checkDrift(manifestPath, root);

    expect(report.entries[0]).toMatchObject({
      linkId: 'login',
      side: 'spec',
      heading: '1. Login',
      status: 'missing',
    });
  });
});

describe('updateManifestHashes', () => {
  let root: string;
  let manifestPath: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'traceability-update-'));
    manifestPath = path.join(root, 'traceability.yaml');
    await buildRepo(root);
    await saveManifest(manifestPath, await buildManifest(root));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('refreshes hashes so a subsequent check is clean', async () => {
    await writeFile(
      path.join(root, 'src/login.ts'),
      'export const login = 3;\n',
      'utf8'
    );

    await updateManifestHashes(manifestPath, root);
    const report = await checkDrift(manifestPath, root);

    expect(report.clean).toBe(true);
  });

  it('throws when a linked file is missing instead of blessing it', async () => {
    await rm(path.join(root, 'src/login.ts'));

    await expect(updateManifestHashes(manifestPath, root)).rejects.toThrow(
      /src\/login\.ts/
    );
  });

  it('with linkId refreshes only the named link', async () => {
    await writeFile(
      path.join(root, 'src/history.ts'),
      'export const h = 1;\n',
      'utf8'
    );
    const base = await buildManifest(root);
    const twoLink = {
      ...base,
      links: [
        ...base.links,
        {
          id: 'history',
          label: '履歴',
          spec: [],
          impl: [
            {
              path: 'src/history.ts',
              hash: await computeFileHash(path.join(root, 'src/history.ts')),
            },
          ],
          features: [],
        },
      ],
    };
    await saveManifest(manifestPath, twoLink);

    // Both impl files change, so both links would drift.
    await writeFile(
      path.join(root, 'src/login.ts'),
      'export const login = 7;\n',
      'utf8'
    );
    await writeFile(
      path.join(root, 'src/history.ts'),
      'export const h = 2;\n',
      'utf8'
    );

    await updateManifestHashes(manifestPath, root, { linkId: 'login' });
    const report = await checkDrift(manifestPath, root);

    // Only 'login' was re-blessed; 'history' is still drifted.
    expect(report.entries.map((entry) => entry.linkId)).toEqual(['history']);
  });

  it('with an unknown linkId throws instead of writing', async () => {
    await expect(
      updateManifestHashes(manifestPath, root, { linkId: 'nope' })
    ).rejects.toThrow(/no link with id "nope"/);
  });
});
