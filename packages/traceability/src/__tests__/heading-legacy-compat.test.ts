import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { stringify } from "yaml";
import { checkDrift } from "../check.js";
import { computeHeadingSectionHash, listHeadings, SECTION_MISSING } from "../hash.js";
import { auditSpecHeadings } from "../spec-audit.js";
import type { TraceabilityManifest } from "../manifest.js";
import { updateManifestHashes } from "../update.js";

// main 49eea1d の listHeadings / computeHeadingSectionHash で実際に採取した参照。
// 現在のパーサで期待値を再生成すると、旧 manifest の互換性を検査できない。
const legacyReferences = [
  {
    headingLine: "## Account ##",
    heading: "Account ##",
    hash: "7adbadc175f5c58e6af7cd4ed6f44877760fb6dbbe004b598d9a6965ee0597db",
  },
  {
    headingLine: "##   Account",
    heading: "  Account",
    hash: "19782bbabc44d523bcc430b9491f937b9331e69b4b46c92d535b4757a2e07a50",
  },
  {
    headingLine: "## \tAccount",
    heading: "\tAccount",
    hash: "db12c4ea79d1ef0854641f6b1362fc5c17c1594d9cb812b6382d133c44756116",
  },
  {
    headingLine: "## Account\t##",
    heading: "Account\t##",
    hash: "110a3c2e715e9ea38bb3cfb45ac260a332777762ae22e390b6488c4fa8a3af92",
  },
];

const manifestForHeading = (heading: string): TraceabilityManifest => ({
  version: 1,
  links: [
    {
      id: "account",
      label: "Account",
      spec: [{ path: "spec.md", heading, hash: "stored" }],
      impl: [],
      features: [],
    },
  ],
});

describe("旧見出し参照の互換性", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "heading-legacy-compat-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("旧表記を持つ実在の節を update が missing として拒否しない", async () => {
    const { headingLine, heading, hash } = legacyReferences[0];
    await writeFile(path.join(root, "spec.md"), `${headingLine}\ncontract\n## Next\nother\n`);
    const manifestPath = path.join(root, "traceability.yaml");
    await writeFile(
      manifestPath,
      stringify({
        version: 1,
        links: [
          {
            id: "account",
            label: "Account",
            spec: [{ path: "spec.md", heading, hash }],
            impl: [],
            features: [],
          },
        ],
      }),
    );
    expect((await updateManifestHashes(manifestPath, root)).changes).toEqual([]);
  });

  it.each(legacyReferences)(
    "旧 API が生成した $headingLine の manifest を変更なしで check / update できる",
    async ({ headingLine, heading, hash }) => {
      const content = `${headingLine}\ncontract\n## Next\nother\n`;
      await writeFile(path.join(root, "spec.md"), content);
      const manifestPath = path.join(root, "traceability.yaml");
      const source = stringify({
        version: 1,
        links: [
          {
            id: "account",
            label: "Account",
            spec: [
              { path: "spec.md", heading, hash },
              {
                path: "spec.md",
                heading: "Next",
                hash: "23e9410c82f03036aa17964b229a332f37098d4d5050c2eb38e0c8b38eebe77b",
              },
            ],
            impl: [],
            features: [],
          },
        ],
      });
      await writeFile(manifestPath, source);

      expect(listHeadings(content, 2)).toEqual([
        { line: 1, text: "Account" },
        { line: 3, text: "Next" },
      ]);
      expect(await checkDrift(manifestPath, root)).toMatchObject({ clean: true, warnings: [] });
      expect((await updateManifestHashes(manifestPath, root)).changes).toEqual([]);
      expect((await updateManifestHashes(manifestPath, root, { dryRun: true })).changes).toEqual(
        [],
      );
      expect(await readFile(manifestPath, "utf8")).toBe(source);

      await writeFile(path.join(root, "spec.md"), content.replace("\ncontract\n", "\nchanged\n"));
      const changedHash = createHash("sha256").update(`${headingLine}\nchanged`).digest("hex");
      expect((await checkDrift(manifestPath, root)).entries).toEqual([
        expect.objectContaining({ heading, storedHash: hash, currentHash: changedHash }),
      ]);
      expect((await updateManifestHashes(manifestPath, root, { dryRun: true })).changes).toEqual([
        expect.objectContaining({ heading, oldHash: hash, newHash: changedHash }),
      ]);
      expect(await readFile(manifestPath, "utf8")).toBe(source);
    },
  );

  it.each(["Account", "Account ##", "  Account"])(
    "%s で参照しても canonical 名が同じ見出しの重複を隠さない",
    async (heading) => {
      await writeFile(
        path.join(root, "spec.md"),
        "## Account ##\nfirst\n##   Account\nsecond\n ##\tAccount ###\nthird\n",
      );
      expect(await auditSpecHeadings(manifestForHeading(heading), root)).toEqual([
        expect.objectContaining({
          kind: "duplicate-heading",
          linkId: "account",
          message: expect.stringContaining("3 times"),
        }),
      ]);
    },
  );

  it.each([false, true])(
    "raw と別の canonical 候補の衝突では文書順に依存せず旧参照先を維持する: 逆順=%s",
    async (reverse) => {
      const legacySection = "## Account ##\nlegacy body";
      const canonicalSection = "## Account ## ##\nother body";
      const sections = reverse
        ? [canonicalSection, legacySection]
        : [legacySection, canonicalSection];
      const file = path.join(root, "spec.md");
      await writeFile(file, `${sections.join("\n")}\n## Boundary\nend\n`);

      expect(await computeHeadingSectionHash(file, "Account ##")).toBe(
        createHash("sha256").update(legacySection).digest("hex"),
      );
      const warnings = await auditSpecHeadings(manifestForHeading("Account ##"), root);
      expect(warnings).toEqual([
        expect.objectContaining({
          kind: "unregistered-spec-heading",
          message: 'spec heading is not registered in the manifest: "Account ##" in spec.md',
        }),
        expect.objectContaining({
          kind: "unregistered-spec-heading",
          message: expect.stringContaining("Boundary"),
        }),
      ]);
    },
  );

  it("旧 API が発見しなかったインデントとタブ区切りを raw alias に拡大しない", async () => {
    const file = path.join(root, "spec.md");
    await writeFile(
      file,
      "```\n## Account ##\n## Other ##\n```\n ## Account ##\nbody\n##\tOther ##\nbody\n",
    );
    expect(await computeHeadingSectionHash(file, "Account ##")).toBe(SECTION_MISSING);
    expect(await computeHeadingSectionHash(file, "Other ##")).toBe(SECTION_MISSING);
    expect(await computeHeadingSectionHash(file, "Account")).not.toBe(SECTION_MISSING);
    expect(await computeHeadingSectionHash(file, "Other")).not.toBe(SECTION_MISSING);
  });
});
