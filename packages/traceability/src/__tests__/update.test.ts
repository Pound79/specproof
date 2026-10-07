import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { computeFileHash, computeHeadingSectionHash } from "../hash.js";
import { saveManifest, loadManifest, type TraceabilityManifest } from "../manifest.js";
import { updateManifestHashes } from "../update.js";

const SPEC_DOC = [
  "# Spec",
  "",
  "## 1. Login",
  "",
  "login spec body",
  "",
  "## 2. History",
  "",
  "history spec body",
  "",
].join("\n");

const buildRepo = async (root: string): Promise<void> => {
  await mkdir(path.join(root, "docs"), { recursive: true });
  await mkdir(path.join(root, "src"), { recursive: true });
  await mkdir(path.join(root, "features"), { recursive: true });
  await writeFile(path.join(root, "docs/spec.md"), SPEC_DOC, "utf8");
  await writeFile(path.join(root, "src/login.ts"), "export const login = 1;\n", "utf8");
  await writeFile(path.join(root, "features/login.feature"), "Feature: Login\n", "utf8");
};

const buildManifest = async (root: string): Promise<TraceabilityManifest> => ({
  version: 1,
  links: [
    {
      id: "login",
      label: "Login",
      spec: [
        {
          path: "docs/spec.md",
          heading: "1. Login",
          hash: await computeHeadingSectionHash(path.join(root, "docs/spec.md"), "1. Login"),
        },
      ],
      impl: [
        {
          path: "src/login.ts",
          hash: await computeFileHash(path.join(root, "src/login.ts")),
        },
      ],
      features: [
        {
          path: "features/login.feature",
          hash: await computeFileHash(path.join(root, "features/login.feature")),
        },
      ],
    },
  ],
});

describe("updateManifestHashes", () => {
  let root: string;
  let manifestPath: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "traceability-update-"));
    manifestPath = path.join(root, "traceability.yaml");
    await buildRepo(root);
    await saveManifest(manifestPath, await buildManifest(root));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("returns a manifest with all hashes refreshed", async () => {
    await writeFile(path.join(root, "src/login.ts"), "export const login = 99;\n", "utf8");

    const updated = await updateManifestHashes(manifestPath, root);

    const expectedHash = await computeFileHash(path.join(root, "src/login.ts"));
    expect(updated.links[0].impl[0].hash).toBe(expectedHash);
  });

  it("persists the updated manifest to disk", async () => {
    await writeFile(path.join(root, "src/login.ts"), "export const login = 42;\n", "utf8");

    await updateManifestHashes(manifestPath, root);
    const reloaded = await loadManifest(manifestPath);

    const expectedHash = await computeFileHash(path.join(root, "src/login.ts"));
    expect(reloaded.links[0].impl[0].hash).toBe(expectedHash);
  });

  it("refreshes spec heading hashes", async () => {
    const edited = SPEC_DOC.replace("login spec body", "login spec body v2");
    await writeFile(path.join(root, "docs/spec.md"), edited, "utf8");

    const updated = await updateManifestHashes(manifestPath, root);

    const expectedHash = await computeHeadingSectionHash(
      path.join(root, "docs/spec.md"),
      "1. Login",
    );
    expect(updated.links[0].spec[0].hash).toBe(expectedHash);
  });

  it("refreshes feature file hashes", async () => {
    await writeFile(path.join(root, "features/login.feature"), "Feature: Login v2\n", "utf8");

    const updated = await updateManifestHashes(manifestPath, root);

    const expectedHash = await computeFileHash(path.join(root, "features/login.feature"));
    expect(updated.links[0].features[0].hash).toBe(expectedHash);
  });

  it("throws when a spec heading is missing", async () => {
    const renamed = SPEC_DOC.replace("## 1. Login", "## 1. Sign in");
    await writeFile(path.join(root, "docs/spec.md"), renamed, "utf8");

    await expect(updateManifestHashes(manifestPath, root)).rejects.toThrow(/SECTION_MISSING/);
  });

  it("throws when a spec file is missing", async () => {
    await rm(path.join(root, "docs/spec.md"));

    await expect(updateManifestHashes(manifestPath, root)).rejects.toThrow(/FILE_MISSING/);
  });

  it("throws when a feature file is missing", async () => {
    await rm(path.join(root, "features/login.feature"));

    await expect(updateManifestHashes(manifestPath, root)).rejects.toThrow(
      /features\/login\.feature/,
    );
  });

  it("handles multiple links and refreshes all of them", async () => {
    await writeFile(path.join(root, "src/history.ts"), "export const history = 1;\n", "utf8");
    await writeFile(path.join(root, "features/history.feature"), "Feature: History\n", "utf8");

    const multiManifest: TraceabilityManifest = {
      version: 1,
      links: [
        (await buildManifest(root)).links[0],
        {
          id: "history",
          label: "History",
          spec: [
            {
              path: "docs/spec.md",
              heading: "2. History",
              hash: await computeHeadingSectionHash(path.join(root, "docs/spec.md"), "2. History"),
            },
          ],
          impl: [
            {
              path: "src/history.ts",
              hash: await computeFileHash(path.join(root, "src/history.ts")),
            },
          ],
          features: [
            {
              path: "features/history.feature",
              hash: await computeFileHash(path.join(root, "features/history.feature")),
            },
          ],
        },
      ],
    };
    await saveManifest(manifestPath, multiManifest);

    await writeFile(path.join(root, "src/login.ts"), "export const login = 2;\n", "utf8");
    await writeFile(path.join(root, "src/history.ts"), "export const history = 2;\n", "utf8");

    const updated = await updateManifestHashes(manifestPath, root);

    expect(updated.links).toHaveLength(2);
    expect(updated.links[0].impl[0].hash).toBe(
      await computeFileHash(path.join(root, "src/login.ts")),
    );
    expect(updated.links[1].impl[0].hash).toBe(
      await computeFileHash(path.join(root, "src/history.ts")),
    );
  });

  it("returns an empty changes array when nothing drifted", async () => {
    const updated = await updateManifestHashes(manifestPath, root);

    expect(updated.changes).toEqual([]);
  });

  it("returns the old and new hash for every ref that changed", async () => {
    const original = await buildManifest(root);
    const originalHash = original.links[0].impl[0].hash;
    await writeFile(path.join(root, "src/login.ts"), "export const login = 99;\n", "utf8");

    const updated = await updateManifestHashes(manifestPath, root);

    const expectedHash = await computeFileHash(path.join(root, "src/login.ts"));
    expect(updated.changes).toEqual([
      {
        linkId: "login",
        side: "impl",
        path: "src/login.ts",
        oldHash: originalHash,
        newHash: expectedHash,
      },
    ]);
  });

  it("dry run computes changes without writing the manifest to disk", async () => {
    const original = await buildManifest(root);
    await writeFile(path.join(root, "src/login.ts"), "export const login = 99;\n", "utf8");

    const updated = await updateManifestHashes(manifestPath, root, {
      dryRun: true,
    });

    expect(updated.changes).toHaveLength(1);
    expect(updated.changes[0]).toMatchObject({
      linkId: "login",
      side: "impl",
      path: "src/login.ts",
    });

    const onDisk = await loadManifest(manifestPath);
    expect(onDisk.links[0].impl[0].hash).toBe(original.links[0].impl[0].hash);
  });

  it("dry run still throws on a missing file instead of blessing it", async () => {
    const original = await buildManifest(root);
    await rm(path.join(root, "src/login.ts"));

    await expect(updateManifestHashes(manifestPath, root, { dryRun: true })).rejects.toThrow(
      /src\/login\.ts/,
    );

    const onDisk = await loadManifest(manifestPath);
    expect(onDisk.links[0].impl[0].hash).toBe(original.links[0].impl[0].hash);
  });

  it.each([
    { name: "全件更新", options: {} },
    { name: "単一 link 更新", options: { linkId: "login" } },
    { name: "全件 dry-run", options: { dryRun: true } },
    { name: "単一 link dry-run", options: { linkId: "login", dryRun: true } },
  ])("$name で criteria と全階層の未知キーを保持する", async ({ options }) => {
    const original = await buildManifest(root);
    const link = original.links[0];
    const decorated = {
      ...original,
      metadata: { owner: "team" },
      links: [
        {
          ...link,
          criteria: ["AC-001", "TC-1A-05-01"],
          extension: { enabled: false },
          spec: link.spec.map((ref) => ({ ...ref, annotation: "仕様" })),
          impl: link.impl.map((ref) => ({ ...ref, annotation: "実装" })),
          features: link.features.map((ref) => ({ ...ref, annotation: "feature" })),
        },
        {
          ...link,
          id: "other",
          label: "Other",
          criteria: ["AC-001"],
          extension: "二つ目",
        },
      ],
    };
    await writeFile(manifestPath, JSON.stringify(decorated), "utf8");
    const before = await readFile(manifestPath, "utf8");
    await writeFile(
      path.join(root, "docs/spec.md"),
      SPEC_DOC.replace("login spec body", "変更した仕様"),
      "utf8",
    );
    await writeFile(path.join(root, "src/login.ts"), "export const login = 99;\n", "utf8");
    await writeFile(path.join(root, "features/login.feature"), "Feature: Changed\n", "utf8");

    const updated = await updateManifestHashes(manifestPath, root, options);
    expect(updated).toMatchObject({
      metadata: decorated.metadata,
      links: [
        {
          criteria: ["AC-001", "TC-1A-05-01"],
          extension: { enabled: false },
          spec: [{ annotation: "仕様" }],
          impl: [{ annotation: "実装" }],
          features: [{ annotation: "feature" }],
        },
        { criteria: ["AC-001"], extension: "二つ目" },
      ],
    });
    expect(updated.links[0].impl[0].hash).toBe(
      await computeFileHash(path.join(root, "src/login.ts")),
    );
    expect(updated.changes).toHaveLength(options.linkId ? 3 : 6);
    if (options.linkId) expect(updated.links[1]).toEqual(decorated.links[1]);
    if (options.dryRun) {
      expect(await readFile(manifestPath, "utf8")).toBe(before);
    } else {
      const { changes: _changes, ...expected } = updated;
      expect(await loadManifest(manifestPath)).toEqual(expected);
    }
  });

  it("更新後も criteria の省略と空配列を区別する", async () => {
    const manifest = await buildManifest(root);
    manifest.links.push({ ...manifest.links[0], id: "empty", label: "Empty", criteria: [] });
    await writeFile(manifestPath, JSON.stringify(manifest), "utf8");
    await updateManifestHashes(manifestPath, root);
    const loaded = await loadManifest(manifestPath);
    expect(Object.hasOwn(loaded.links[0], "criteria")).toBe(false);
    expect(loaded.links[1]).toHaveProperty("criteria", []);
  });

  it.each([
    { name: "全件更新", options: {} },
    { name: "単一 link 更新", options: { linkId: "login" } },
    { name: "全件 dry-run", options: { dryRun: true } },
    { name: "単一 link dry-run", options: { linkId: "login", dryRun: true } },
  ])("$name で他 link の不正な criteria を拒否しファイルを変えない", async ({ options }) => {
    const manifest = await buildManifest(root);
    manifest.links.push({
      ...manifest.links[0],
      id: "invalid",
      label: "Invalid",
      criteria: [""],
    });
    const before = JSON.stringify(manifest);
    await writeFile(manifestPath, before, "utf8");
    await writeFile(path.join(root, "src/login.ts"), "export const login = 99;\n", "utf8");

    await expect(updateManifestHashes(manifestPath, root, options)).rejects.toThrow(
      /links\[1\]\.criteria/,
    );
    expect(await readFile(manifestPath, "utf8")).toBe(before);
  });
});
