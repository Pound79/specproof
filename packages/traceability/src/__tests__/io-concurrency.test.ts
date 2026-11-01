import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const readState = vi.hoisted(() => ({ active: 0, peak: 0 }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    // 本体は open から close までの間に読む。その間を 1 件の読み取りとして数える。
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args);
      if (!String(args[0]).endsWith(".ts")) return handle;
      readState.active += 1;
      readState.peak = Math.max(readState.peak, readState.active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      const close = handle.close.bind(handle);
      return Object.assign(handle, {
        close: async () => {
          readState.active -= 1;
          return close();
        },
      });
    },
  };
});

import { checkDrift, updateManifestHashes } from "../index.js";

describe("traceability file I/O concurrency", () => {
  let root: string;
  let manifestPath: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "traceability-io-limit-"));
    manifestPath = path.join(root, "traceability.yaml");
    await mkdir(path.join(root, "src"));
    const refs = Array.from({ length: 96 }, (_, index) => ({
      path: `src/file-${index}.ts`,
      hash: "PENDING",
    }));
    await Promise.all(refs.map((ref) => writeFile(path.join(root, ref.path), "export {};\n")));
    await writeFile(
      manifestPath,
      JSON.stringify({
        version: 1,
        links: [
          {
            id: "large-link",
            label: "Large link",
            spec: [],
            impl: refs,
            features: [],
          },
        ],
      }),
    );
    readState.active = 0;
    readState.peak = 0;
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("limits check reads to 32 concurrent files", async () => {
    const report = await checkDrift(manifestPath, root);

    expect(report.driftCount).toBe(96);
    expect(readState.peak).toBe(32);
    expect(report.entries.map((entry) => entry.path)).toEqual(
      Array.from({ length: 96 }, (_, index) => `src/file-${index}.ts`),
    );
  });

  it("limits dry-run update reads to 32 concurrent files", async () => {
    const result = await updateManifestHashes(manifestPath, root, {
      dryRun: true,
    });

    expect(result.changes).toHaveLength(96);
    expect(readState.peak).toBe(32);
    expect(result.changes.map((change) => change.path)).toEqual(
      Array.from({ length: 96 }, (_, index) => `src/file-${index}.ts`),
    );
  });
});
