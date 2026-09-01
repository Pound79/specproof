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

  it('rejects an empty reference path', async () => {
    await writeManifest(`
version: 1
links:
  - id: login
    label: Login
    spec: []
    impl:
      - path: ""
        hash: abc
    features: []
`);

    await expect(loadManifest(manifestPath)).rejects.toThrow(/impl\[0\].*path/i);
  });

  it('rejects an excessively long reference path', async () => {
    await writeManifest(
      JSON.stringify({
        version: 1,
        links: [
          {
            id: 'login',
            label: 'Login',
            spec: [],
            impl: [{ path: 'a'.repeat(4097), hash: 'abc' }],
            features: [],
          },
        ],
      })
    );

    await expect(loadManifest(manifestPath)).rejects.toThrow(/impl\[0\].*path/i);
  });

  it('rejects an excessively long spec heading', async () => {
    await writeManifest(
      JSON.stringify({
        version: 1,
        links: [
          {
            id: 'login',
            label: 'Login',
            spec: [
              { path: 'docs/spec.md', heading: 'a'.repeat(1025), hash: 'abc' },
            ],
            impl: [],
            features: [],
          },
        ],
      })
    );

    await expect(loadManifest(manifestPath)).rejects.toThrow(/spec\[0\].*heading/i);
  });

  it('rejects an excessively long hash', async () => {
    await writeManifest(
      JSON.stringify({
        version: 1,
        links: [
          {
            id: 'login',
            label: 'Login',
            spec: [],
            impl: [{ path: 'src/login.ts', hash: 'a'.repeat(257) }],
            features: [],
          },
        ],
      })
    );

    await expect(loadManifest(manifestPath)).rejects.toThrow(/impl\[0\].*hash/i);
  });

  it('rejects a manifest with too many links', async () => {
    await writeManifest(
      JSON.stringify({
        version: 1,
        links: Array.from({ length: 10_001 }, (_, index) => ({
          id: `link-${index}`,
          label: `Link ${index}`,
          spec: [],
          impl: [],
          features: [],
        })),
      })
    );

    await expect(loadManifest(manifestPath)).rejects.toThrow(/10,?000 links/i);
  });

  it('rejects a link with too many references', async () => {
    await writeManifest(
      JSON.stringify({
        version: 1,
        links: [
          {
            id: 'large-link',
            label: 'Large link',
            spec: [],
            impl: Array.from({ length: 1_001 }, (_, index) => ({
              path: `src/file-${index}.ts`,
              hash: 'PENDING',
            })),
            features: [],
          },
        ],
      })
    );

    await expect(loadManifest(manifestPath)).rejects.toThrow(
      /links\[0\].*1,?000 references/i
    );
  });

  it('rejects a manifest with too many total references', async () => {
    let refIndex = 0;
    const links = Array.from({ length: 21 }, (_, linkIndex) => {
      const count = linkIndex === 20 ? 1 : 1_000;
      return {
        id: `link-${linkIndex}`,
        label: `Link ${linkIndex}`,
        spec: [],
        impl: Array.from({ length: count }, () => ({
          path: `src/file-${refIndex++}.ts`,
          hash: 'PENDING',
        })),
        features: [],
      };
    });
    await writeManifest(JSON.stringify({ version: 1, links }));

    await expect(loadManifest(manifestPath)).rejects.toThrow(
      /20,?000 total references/i
    );
  });

  it('rejects a manifest file larger than 8 MiB before parsing it', async () => {
    await writeManifest(
      `#${'x'.repeat(8 * 1024 * 1024)}\nversion: 1\nlinks: []\n`
    );

    await expect(loadManifest(manifestPath)).rejects.toThrow(/8 MiB/i);
  });

  it('rejects a reference path containing a NUL byte', async () => {
    await writeManifest(
      JSON.stringify({
        version: 1,
        links: [
          {
            id: 'login',
            label: 'Login',
            spec: [],
            impl: [{ path: 'src/\0login.ts', hash: 'PENDING' }],
            features: [],
          },
        ],
      })
    );

    await expect(loadManifest(manifestPath)).rejects.toThrow(/impl\[0\].*path/i);
  });

  it('rejects an excessively long link id', async () => {
    await writeManifest(
      JSON.stringify({
        version: 1,
        links: [
          {
            id: 'a'.repeat(257),
            label: 'Login',
            spec: [],
            impl: [],
            features: [],
          },
        ],
      })
    );

    await expect(loadManifest(manifestPath)).rejects.toThrow(/links\[0\].*id/i);
  });

  it('rejects an excessively long link label', async () => {
    await writeManifest(
      JSON.stringify({
        version: 1,
        links: [
          {
            id: 'login',
            label: 'a'.repeat(1025),
            spec: [],
            impl: [],
            features: [],
          },
        ],
      })
    );

    await expect(loadManifest(manifestPath)).rejects.toThrow(/links\[0\].*label/i);
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
