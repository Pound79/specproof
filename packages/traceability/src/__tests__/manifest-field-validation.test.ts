import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadManifest, saveManifest } from "../manifest.js";

// manifest の hash・見出し・ラベルは PR の作者が書ける。hash は sha256 の 16 進（小文字 64 桁）か
// 決まった値だけを受け付け、見出しとラベルは link id と同じく制御文字・行区切りを拒否する。
const HEX = "0123456789abcdef".repeat(4);

describe("manifest のフィールドの検証", () => {
  let dir: string;
  let manifestPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "traceability-fields-"));
    manifestPath = path.join(dir, "traceability.yaml");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const write = (link: Record<string, unknown>): Promise<void> =>
    writeFile(
      manifestPath,
      JSON.stringify({
        version: 1,
        links: [{ id: "a", label: "A", spec: [], impl: [], features: [], ...link }],
      }),
      "utf8",
    );

  // 末尾の改行を落とす処理が、改行の長い連なりで 2 乗の時間にならないこと（長さの上限より先に
  // 正規表現を当てると、上限を超える label でも時間がかかる）。
  it("改行が長く続いたあとに文字がある長い label を、すぐに拒否する", async () => {
    await write({ label: `${"\n".repeat(300_000)}x` });
    const started = Date.now();
    await expect(loadManifest(manifestPath)).rejects.toThrow(/label must be/);
    expect(Date.now() - started).toBeLessThan(2_000);
  }, 10_000);

  it.each([HEX, "PENDING", "FILE_MISSING", "SECTION_MISSING"])(
    "hash %s を受け付ける",
    async (hash) => {
      await write({
        spec: [{ path: "docs/spec.md", heading: "S", hash }],
        impl: [{ path: "src/a.ts", hash }],
        features: [{ path: "f.feature", hash }],
      });
      await expect(loadManifest(manifestPath)).resolves.toBeDefined();
    },
  );

  it.each([
    "",
    "abc",
    HEX.toUpperCase(),
    `${HEX}0`,
    HEX.slice(1),
    `${HEX.slice(1)}g`,
    "pending",
    `${HEX}\n`,
    `sha256:${HEX}`,
  ])("hash %j を読み込みで拒否する", async (hash) => {
    for (const side of ["spec", "impl", "features"] as const) {
      const ref =
        side === "spec" ? { path: "docs/spec.md", heading: "S", hash } : { path: "x", hash };
      await write({ [side]: [ref] });
      await expect(loadManifest(manifestPath)).rejects.toThrow(
        new RegExp(`${side}\\[0\\].*hash must be`),
      );
    }
  });

  it("拒否した hash の値はエラーに出さない", async () => {
    await write({ impl: [{ path: "x", hash: "::error::\u001b[2J" }] });
    const error = await loadManifest(manifestPath).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toMatch(/::error::|\u001b/u);
  });

  it.each(["a\nb", "a\u0000b", "a\u0085b", "a\u2028b", "a\u2029b", "a\u007fb"])(
    "見出し %j を読み込みで拒否する",
    async (heading) => {
      await write({ spec: [{ path: "docs/spec.md", heading, hash: HEX }] });
      await expect(loadManifest(manifestPath)).rejects.toThrow(
        /spec\[0\].*heading must not contain control or separator characters/,
      );
    },
  );

  it.each(["a\nb", "a\rb", "a\n\nb", "\n", "a\r\n", "a\u0000b", "a\u009bb", "a\u2028b"])(
    "ラベル %j を読み込みで拒否する",
    async (label) => {
      await write({ label });
      await expect(loadManifest(manifestPath)).rejects.toThrow(
        /label must (not contain control or separator characters|be a non-empty string)/,
      );
    },
  );

  // 旧い specproof はタブを含む見出しをそのまま保存した（heading-legacy-compat）。読めるままにする。
  it("見出しの水平タブは受け付ける", async () => {
    await write({ spec: [{ path: "docs/spec.md", heading: "\tAccount\t##", hash: HEX }] });
    await expect(loadManifest(manifestPath)).resolves.toBeDefined();
  });

  // YAML のブロック形式（label: > / label: |）は値の末尾に改行が付く。0.4.x で読めた manifest を
  // 読めるままにする。タブは見出しと同じく許す。
  it.each(["a\n", "a\n\n", "a\tb"])("ラベル %j は受け付ける", async (label) => {
    await write({ label });
    await expect(loadManifest(manifestPath)).resolves.toBeDefined();
  });

  it("ブロック形式のラベルの manifest を読み、hash だけを書き換えて保存できる", async () => {
    await writeFile(
      manifestPath,
      [
        "version: 1",
        "links:",
        "  - id: a",
        "    label: >",
        "      long label",
        "      folded",
        "    spec: []",
        "    impl:",
        "      - path: src/a.ts",
        "        hash: PENDING",
        "    features: []",
        "",
      ].join("\n"),
      "utf8",
    );
    const original = await loadManifest(manifestPath);
    expect(original.links[0].label).toBe("long label folded\n");
    const updated = structuredClone(original);
    updated.links[0].impl[0].hash = HEX;
    await saveManifest(manifestPath, updated, original);
    const reloaded = await loadManifest(manifestPath);
    expect(reloaded.links[0].label).toBe("long label folded\n");
    expect(reloaded.links[0].impl[0].hash).toBe(HEX);
  });

  it("制御文字の無い見出しとラベル（記号・非 ASCII を含む）は受け付ける", async () => {
    await write({
      label: "ログイン: ##[x] ::y",
      spec: [{ path: "docs/spec.md", heading: "1. ログイン（概要）", hash: HEX }],
    });
    await expect(loadManifest(manifestPath)).resolves.toBeDefined();
  });
});
