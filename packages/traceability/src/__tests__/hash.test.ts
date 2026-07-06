import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DRAFT_MARKER,
  LEGACY_DRAFT_MARKER,
  FILE_MISSING,
  SECTION_MISSING,
  computeFileHash,
  computeHeadingSectionHash,
  hasDraftMarker,
  listHeadings,
} from '../hash.js';

const sha256 = (content: string): string =>
  createHash('sha256').update(content, 'utf8').digest('hex');

describe('hasDraftMarker', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'traceability-draft-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns true when the draft marker is present on its own line', async () => {
    const file = path.join(dir, 'draft.feature');
    await writeFile(file, `# language: ja\n${DRAFT_MARKER}\n機能: 例\n`, 'utf8');

    expect(await hasDraftMarker(file)).toBe(true);
  });

  it('returns false when the marker is absent', async () => {
    const file = path.join(dir, 'clean.feature');
    await writeFile(file, '# language: ja\n機能: 例\n', 'utf8');

    expect(await hasDraftMarker(file)).toBe(false);
  });

  it('returns false when the file does not exist', async () => {
    expect(await hasDraftMarker(path.join(dir, 'nope.feature'))).toBe(false);
  });

  it('does not match a longer comment that merely starts with the marker', async () => {
    const file = path.join(dir, 'longer.feature');
    await writeFile(file, `${DRAFT_MARKER} (remove me)\n機能: 例\n`, 'utf8');

    expect(await hasDraftMarker(file)).toBe(false);
  });

  it('detects the marker despite surrounding whitespace and CRLF endings', async () => {
    const file = path.join(dir, 'whitespace.feature');
    await writeFile(file, `機能: 例\r\n  ${DRAFT_MARKER}  \r\n`, 'utf8');

    expect(await hasDraftMarker(file)).toBe(true);
  });

  // Back-compat (RENAME-DESIGN §3-2): drafts written before the bdd-kit ->
  // specproof rename still carry the old marker and must still be flagged as
  // unreviewed; only generation (specproof-bootstrap) switched to the new one.
  it('also detects the legacy bdd-kit draft marker', async () => {
    const file = path.join(dir, 'legacy-draft.feature');
    await writeFile(
      file,
      `# language: ja\n${LEGACY_DRAFT_MARKER}\n機能: 例\n`,
      'utf8',
    );

    expect(await hasDraftMarker(file)).toBe(true);
  });
});

describe('computeFileHash', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'traceability-hash-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns the sha256 hex digest of the file content', async () => {
    const filePath = path.join(dir, 'sample.ts');
    await writeFile(filePath, 'export const a = 1;\n', 'utf8');

    const hash = await computeFileHash(filePath);

    expect(hash).toBe(sha256('export const a = 1;\n'));
  });

  it('returns FILE_MISSING when the file does not exist', async () => {
    const hash = await computeFileHash(path.join(dir, 'nope.ts'));

    expect(hash).toBe(FILE_MISSING);
  });
});

describe('computeHeadingSectionHash', () => {
  let dir: string;
  let docPath: string;

  const doc = [
    '# Title',
    '',
    'intro text',
    '',
    '## 1. First section',
    '',
    'first body',
    '',
    '## 2. Second section',
    '',
    'second body',
    '',
  ].join('\n');

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'traceability-section-'));
    docPath = path.join(dir, 'spec.md');
    await writeFile(docPath, doc, 'utf8');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('hashes the block from the heading to the next level-2 heading (exclusive)', async () => {
    const expected = sha256(
      ['## 1. First section', '', 'first body', ''].join('\n')
    );

    const hash = await computeHeadingSectionHash(docPath, '1. First section');

    expect(hash).toBe(expected);
  });

  it('hashes from the last heading to end of file', async () => {
    const expected = sha256(
      ['## 2. Second section', '', 'second body', ''].join('\n')
    );

    const hash = await computeHeadingSectionHash(docPath, '2. Second section');

    expect(hash).toBe(expected);
  });

  it('hashes a level-3 (###) section up to the next heading of level <= 3', async () => {
    const md = [
      '# Title',
      '',
      '## Parent',
      '',
      '### Target',
      '',
      'target body',
      '',
      '#### Deeper',
      'deeper body',
      '',
      '## Next parent',
      'next',
      '',
    ].join('\n');
    await writeFile(docPath, md, 'utf8');

    const expected = sha256(
      [
        '### Target',
        '',
        'target body',
        '',
        '#### Deeper', // deeper subsection is included (level 4 > 3)
        'deeper body',
        '',
      ].join('\n')
    );

    // Default level (2) cannot find a `###` heading.
    expect(await computeHeadingSectionHash(docPath, 'Target')).toBe(
      SECTION_MISSING
    );
    // With level 3 it is found and bounded by the next level-<=3 heading.
    expect(await computeHeadingSectionHash(docPath, 'Target', 3)).toBe(expected);
  });

  it('returns SECTION_MISSING when the heading is not found', async () => {
    const hash = await computeHeadingSectionHash(docPath, 'No such heading');

    expect(hash).toBe(SECTION_MISSING);
  });

  it('rejects an out-of-range or non-integer level with a clear error', async () => {
    for (const bad of [0, 7, -1, 2.5, Number.NaN]) {
      await expect(
        computeHeadingSectionHash(docPath, '1. First section', bad)
      ).rejects.toThrow(/level must be an integer in 1-6/);
    }
  });

  it('accepts the boundary levels 1 and 6', async () => {
    const md = ['# Target', '', 'body', ''].join('\n');
    await writeFile(docPath, md, 'utf8');

    expect(await computeHeadingSectionHash(docPath, 'Target', 1)).toBe(
      sha256(md)
    );
    // Level 6 simply finds no `######` heading here — no throw, just MISSING.
    expect(await computeHeadingSectionHash(docPath, 'Target', 6)).toBe(
      SECTION_MISSING
    );
  });

  it('returns FILE_MISSING when the document does not exist', async () => {
    const hash = await computeHeadingSectionHash(
      path.join(dir, 'nope.md'),
      '1. First section'
    );

    expect(hash).toBe(FILE_MISSING);
  });

  it('does not let a ## line inside a fenced code block end the section early', async () => {
    const fenced = [
      '# Title',
      '',
      '## 1. First section',
      '',
      'first body',
      '',
      '```md',
      '## 2. Second section',
      '```',
      '',
      'still first body',
      '',
      '## 2. Second section',
      '',
      'second body',
      '',
    ].join('\n');
    await writeFile(docPath, fenced, 'utf8');

    const expected = sha256(
      [
        '## 1. First section',
        '',
        'first body',
        '',
        '```md',
        '## 2. Second section',
        '```',
        '',
        'still first body',
        '',
      ].join('\n')
    );

    const hash = await computeHeadingSectionHash(docPath, '1. First section');

    expect(hash).toBe(expected);
  });

  it('does not match a heading that only appears inside a fenced code block', async () => {
    const fenced = [
      '# Title',
      '',
      '```md',
      '## 1. First section',
      '```',
      '',
      'body that is not a section',
      '',
    ].join('\n');
    await writeFile(docPath, fenced, 'utf8');

    const hash = await computeHeadingSectionHash(docPath, '1. First section');

    expect(hash).toBe(SECTION_MISSING);
  });

  it('treats ~~~ inside a ``` block as content, not a fence toggle', async () => {
    const md = [
      '# Title',
      '',
      '## 1. First section',
      '',
      '```',
      '~~~',
      '## 2. Second section',
      '```',
      '',
      'still first body',
      '',
      '## 2. Second section',
      '',
      'second body',
      '',
    ].join('\n');
    await writeFile(docPath, md, 'utf8');

    const expected = sha256(
      [
        '## 1. First section',
        '',
        '```',
        '~~~',
        '## 2. Second section',
        '```',
        '',
        'still first body',
        '',
      ].join('\n')
    );

    const hash = await computeHeadingSectionHash(docPath, '1. First section');

    expect(hash).toBe(expected);
  });

  it('treats ``` inside a ~~~ block as content, not a fence toggle', async () => {
    const md = [
      '# Title',
      '',
      '## 1. First section',
      '',
      '~~~',
      '```',
      '## 2. Second section',
      '~~~',
      '',
      'still first body',
      '',
      '## 2. Second section',
      '',
      'second body',
      '',
    ].join('\n');
    await writeFile(docPath, md, 'utf8');

    const expected = sha256(
      [
        '## 1. First section',
        '',
        '~~~',
        '```',
        '## 2. Second section',
        '~~~',
        '',
        'still first body',
        '',
      ].join('\n')
    );

    const hash = await computeHeadingSectionHash(docPath, '1. First section');

    expect(hash).toBe(expected);
  });

  it('does not close a 4-backtick fence with a shorter 3-backtick run', async () => {
    const md = [
      '# Title',
      '',
      '## 1. First section',
      '',
      '````',
      '```',
      '## 2. Second section',
      '````',
      '',
      'still first body',
      '',
      '## 2. Second section',
      '',
      'second body',
      '',
    ].join('\n');
    await writeFile(docPath, md, 'utf8');

    const expected = sha256(
      [
        '## 1. First section',
        '',
        '````',
        '```',
        '## 2. Second section',
        '````',
        '',
        'still first body',
        '',
      ].join('\n')
    );

    const hash = await computeHeadingSectionHash(docPath, '1. First section');

    expect(hash).toBe(expected);
  });
});

describe('CRLF / BOM normalization', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'traceability-normalize-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('hashes a CRLF file identically to its LF equivalent', async () => {
    const content = ['export const a = 1;', 'export const b = 2;', ''].join(
      '\n'
    );
    const lfPath = path.join(dir, 'lf.ts');
    const crlfPath = path.join(dir, 'crlf.ts');
    await writeFile(lfPath, content, 'utf8');
    await writeFile(crlfPath, content.replace(/\n/g, '\r\n'), 'utf8');

    const lfHash = await computeFileHash(lfPath);
    const crlfHash = await computeFileHash(crlfPath);

    expect(crlfHash).toBe(lfHash);
    expect(crlfHash).toBe(sha256(content));
  });

  it('finds a heading behind a leading UTF-8 BOM instead of SECTION_MISSING', async () => {
    const body = ['## 1. First section', '', 'first body', ''].join('\n');
    const filePath = path.join(dir, 'bom.md');
    await writeFile(filePath, `﻿${body}`, 'utf8');

    const hash = await computeHeadingSectionHash(filePath, '1. First section');

    expect(hash).not.toBe(SECTION_MISSING);
    expect(hash).toBe(sha256(body));
  });
});

describe('listHeadings', () => {
  it('lists every heading at the given level in document order', () => {
    const md = [
      '# Title',
      '',
      '## 1. First section',
      '',
      'body',
      '',
      '## 2. Second section',
      '',
      'body',
      '',
    ].join('\n');

    expect(listHeadings(md, 2)).toEqual([
      { line: 3, text: '1. First section' },
      { line: 7, text: '2. Second section' },
    ]);
  });

  it('skips headings that only appear inside a fenced code block', () => {
    const md = [
      '## 1. Real section',
      '',
      '```md',
      '## Not a real heading',
      '```',
      '',
      '## 2. Also real',
      '',
    ].join('\n');

    expect(listHeadings(md, 2)).toEqual([
      { line: 1, text: '1. Real section' },
      { line: 7, text: '2. Also real' },
    ]);
  });

  it('returns an empty array when the level has no matches', () => {
    expect(listHeadings('# Title\n\nbody\n', 2)).toEqual([]);
  });

  it('rejects an out-of-range or non-integer level with a clear error', () => {
    for (const bad of [0, 7, -1, 2.5, Number.NaN]) {
      expect(() => listHeadings('# Title\n', bad)).toThrow(
        /level must be an integer in 1-6/
      );
    }
  });
});
