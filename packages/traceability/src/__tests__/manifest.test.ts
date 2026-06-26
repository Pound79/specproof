import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadManifest } from '../manifest.js';

const VALID_MANIFEST = `
version: 1
links:
  - id: login
    label: Login
    spec:
      - path: docs/spec.md
        heading: 1. Login
        hash: abc
    impl:
      - path: src/login.ts
        hash: abc
    features:
      - path: features/login.feature
        hash: abc
`;

describe('loadManifest validation', () => {
  let dir: string;
  let manifestPath: string;

  const writeManifest = async (content: string): Promise<void> => {
    await writeFile(manifestPath, content, 'utf8');
  };

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'traceability-manifest-'));
    manifestPath = path.join(dir, 'traceability.yaml');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('loads a valid manifest', async () => {
    await writeManifest(VALID_MANIFEST);

    const manifest = await loadManifest(manifestPath);

    expect(manifest.links).toHaveLength(1);
    expect(manifest.links[0].id).toBe('login');
  });

  it('rejects a manifest with the wrong version', async () => {
    await writeManifest('version: 2\nlinks: []\n');

    await expect(loadManifest(manifestPath)).rejects.toThrow(/version: 1/);
  });

  it('rejects a null link entry without throwing a TypeError', async () => {
    await writeManifest('version: 1\nlinks:\n  - null\n');

    await expect(loadManifest(manifestPath)).rejects.toThrow(/links\[0\]/);
  });

  it('rejects a link whose id or label is missing', async () => {
    await writeManifest(
      'version: 1\nlinks:\n  - id: login\n    spec: []\n    impl: []\n    features: []\n'
    );

    await expect(loadManifest(manifestPath)).rejects.toThrow(/label/);
  });

  it('rejects a spec ref without a heading', async () => {
    await writeManifest(`
version: 1
links:
  - id: login
    label: Login
    spec:
      - path: docs/spec.md
        hash: abc
    impl: []
    features: []
`);

    await expect(loadManifest(manifestPath)).rejects.toThrow(/spec\[0\]/);
  });

  it('rejects an impl ref whose path or hash is not a string', async () => {
    await writeManifest(`
version: 1
links:
  - id: login
    label: Login
    spec: []
    impl:
      - path: src/login.ts
        hash: 123
    features: []
`);

    await expect(loadManifest(manifestPath)).rejects.toThrow(/impl\[0\]/);
  });

  it('rejects a manifest with duplicate link ids', async () => {
    await writeManifest(`
version: 1
links:
  - id: login
    label: Login A
    spec: []
    impl: []
    features: []
  - id: login
    label: Login B
    spec: []
    impl: []
    features: []
`);

    await expect(loadManifest(manifestPath)).rejects.toThrow(
      /duplicate.*login/i
    );
  });
});
