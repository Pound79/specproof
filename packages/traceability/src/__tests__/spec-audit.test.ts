import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { auditSpecHeadings } from '../spec-audit.js';
import type { TraceabilityManifest } from '../manifest.js';

const buildManifest = (
  specs: { path: string; heading: string; headingLevel?: number }[]
): TraceabilityManifest => ({
  version: 1,
  links: [
    {
      id: 'login',
      label: 'Login',
      spec: specs.map((spec) => ({ ...spec, hash: 'x' })),
      impl: [],
      features: [],
    },
  ],
});

const writeDoc = async (
  root: string,
  relPath: string,
  content: string
): Promise<void> => {
  const absPath = path.join(root, relPath);
  await mkdir(path.dirname(absPath), { recursive: true });
  await writeFile(absPath, content, 'utf8');
};

describe('auditSpecHeadings', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'traceability-spec-audit-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('returns no warnings when the manifest has no spec refs', async () => {
    const manifest = buildManifest([]);

    expect(await auditSpecHeadings(manifest, root)).toEqual([]);
  });

  it('does not audit a file that has zero registered spec refs (A-2 file-limiting)', async () => {
    await writeDoc(
      root,
      'docs/a.md',
      ['## 1. A', '', 'body', ''].join('\n')
    );
    await writeDoc(
      root,
      'docs/untracked.md',
      ['## Not registered', '', 'body', ''].join('\n')
    );
    const manifest = buildManifest([{ path: 'docs/a.md', heading: '1. A' }]);

    const warnings = await auditSpecHeadings(manifest, root);

    expect(warnings).toEqual([]);
  });

  it('flags a heading in a registered file that is not registered itself', async () => {
    await writeDoc(
      root,
      'docs/a.md',
      ['## 1. A', '', 'body', '', '## 2. B', '', 'body', ''].join('\n')
    );
    const manifest = buildManifest([{ path: 'docs/a.md', heading: '1. A' }]);

    const warnings = await auditSpecHeadings(manifest, root);

    expect(warnings).toEqual([
      expect.objectContaining({
        kind: 'unregistered-spec-heading',
        path: 'docs/a.md',
        message: expect.stringContaining('2. B'),
      }),
    ]);
  });

  it('does not audit a heading level that no ref for that file references', async () => {
    await writeDoc(
      root,
      'docs/a.md',
      ['## 1. A', '', '### 1.1 Nested', '', 'body', ''].join('\n')
    );
    const manifest = buildManifest([{ path: 'docs/a.md', heading: '1. A' }]);

    const warnings = await auditSpecHeadings(manifest, root);

    expect(warnings).toEqual([]);
  });

  it('flags a registered heading that appears more than once as duplicate-heading', async () => {
    await writeDoc(
      root,
      'docs/a.md',
      ['## 1. A', '', 'first', '', '## 1. A', '', 'second', ''].join('\n')
    );
    const manifest = buildManifest([{ path: 'docs/a.md', heading: '1. A' }]);

    const warnings = await auditSpecHeadings(manifest, root);

    expect(warnings).toEqual([
      expect.objectContaining({
        linkId: 'login',
        kind: 'duplicate-heading',
        path: 'docs/a.md',
        message: expect.stringContaining('2 times'),
      }),
    ]);
  });

  it('skips a registered file that has been deleted, without throwing', async () => {
    const manifest = buildManifest([
      { path: 'docs/missing.md', heading: '1. A' },
    ]);

    const warnings = await auditSpecHeadings(manifest, root);

    expect(warnings).toEqual([]);
  });
});
