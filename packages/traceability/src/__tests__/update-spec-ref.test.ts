import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "vitest";
import type { DriftEntry } from "../check.js";
import { describeNextSteps } from "../cli-check-format.js";
import { updateManifestHashes } from "../update.js";
import { parse } from "yaml";

// 共通の決まりを書いた 1 つの仕様の節を多くのリンクが参照していると、関係の無い変更で全リンクが drift する。
// --spec-ref は、その節の spec 側の hash だけを、それを持つ全リンクでまとめて取り直す。

const cli = fileURLToPath(new URL("../../dist/cli-update.js", import.meta.url));

const SPEC = (common: string, other: string): string =>
  `# Spec\n\n## Common\n\n${common}\n\n## Other\n\n${other}\n`;

const link = (id: string, headings: string[]): string =>
  `  - id: ${id}\n    label: ${id}\n    spec:\n${headings
    .map(
      (heading) =>
        `      - path: docs/spec.md\n        heading: ${heading}\n        hash: PENDING\n`,
    )
    .join("")}    impl:\n      - path: ${id}.ts\n        hash: PENDING\n    features: []\n`;

const MANIFEST = `version: 1\nlinks:\n${link("a", ["Common", "Other"])}${link("b", ["Common"])}${link("c", ["Common"])}`;

interface Ref {
  path: string;
  heading?: string;
  hash: string;
}
interface Link {
  id: string;
  spec: Ref[];
  impl: Ref[];
}

const run = (root: string, args: string[]) => {
  const result = spawnSync(process.execPath, [cli, "--root", root, ...args], {
    encoding: "utf8",
    timeout: 10_000,
  });
  assert.ifError(result.error);
  return result;
};

const readLinks = (root: string): Link[] =>
  parse(readFileSync(path.join(root, "traceability.yaml"), "utf8")).links;

// 全リンクを bless した後、Common と Other の両方の節を変える。changeImplOf のリンクは impl も変える。
const withDriftedRepo = (changeImplOf: string[], body: (root: string, blessed: Link[]) => void) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "specproof-spec-ref-"));
  try {
    mkdirSync(path.join(root, "docs"));
    writeFileSync(path.join(root, "docs/spec.md"), SPEC("rule one", "other body"));
    for (const id of ["a", "b", "c"])
      writeFileSync(path.join(root, `${id}.ts`), `export const ${id} = 1;\n`);
    writeFileSync(path.join(root, "traceability.yaml"), MANIFEST);
    assert.equal(run(root, []).status, 0);
    const blessed = readLinks(root);
    writeFileSync(
      path.join(root, "docs/spec.md"),
      SPEC("rule one\n\nrule two", "other body changed"),
    );
    for (const id of changeImplOf)
      writeFileSync(path.join(root, `${id}.ts`), `export const ${id} = 2;\n`);
    body(root, blessed);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

const specHash = (links: Link[], id: string, heading: string): string | undefined =>
  links.find((l) => l.id === id)?.spec.find((ref) => ref.heading === heading)?.hash;

test("--spec-ref は、その節の spec 側の hash だけを全リンクで取り直し、ほかの参照は変えない", () => {
  withDriftedRepo([], (root, blessed) => {
    const result = run(root, ["--spec-ref", "docs/spec.md#Common"]);
    assert.equal(result.status, 0, result.stderr);
    const after = readLinks(root);
    for (const id of ["a", "b", "c"]) {
      assert.notEqual(specHash(after, id, "Common"), specHash(blessed, id, "Common"), id);
      assert.equal(
        after.find((l) => l.id === id)?.impl[0].hash,
        blessed.find((l) => l.id === id)?.impl[0].hash,
      );
    }
    assert.equal(
      specHash(after, "a", "Other"),
      specHash(blessed, "a", "Other"),
      "Other は取り直さない",
    );
    assert.match(result.stdout, /spec ref\(s\) refreshed in 3 link\(s\) \(3 hash\(es\) changed\)/);
  });
});

test("impl も drift したリンクは、spec 側だけを bless せずに飛ばし、名前を出して終了コード 1 にする", () => {
  // spec だけを bless すると、次の check で「spec と impl の両方が変わった」が impl だけの drift に見え、止まる信号が消える。
  withDriftedRepo(["c"], (root, blessed) => {
    const result = run(root, ["--spec-ref", "docs/spec.md#Common"]);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /skipped link "c": its impl also drifted/);
    const after = readLinks(root);
    assert.equal(specHash(after, "c", "Common"), specHash(blessed, "c", "Common"));
    assert.notEqual(specHash(after, "a", "Common"), specHash(blessed, "a", "Common"));
    assert.notEqual(specHash(after, "b", "Common"), specHash(blessed, "b", "Common"));
  });
});

test("--link-id と合わせると、そのリンクの中だけで取り直す", () => {
  withDriftedRepo([], (root, blessed) => {
    const result = run(root, ["--spec-ref", "docs/spec.md#Common", "--link-id", "b"]);
    assert.equal(result.status, 0, result.stderr);
    const after = readLinks(root);
    assert.notEqual(specHash(after, "b", "Common"), specHash(blessed, "b", "Common"));
    assert.equal(specHash(after, "a", "Common"), specHash(blessed, "a", "Common"));
  });
});

test("どのリンクにも無い参照や、見出しの無い指定は、何も書かずに失敗する", () => {
  withDriftedRepo([], (root) => {
    const before = readFileSync(path.join(root, "traceability.yaml"), "utf8");
    const unknown = run(root, [
      "--spec-ref",
      "docs/spec.md#Common",
      "--spec-ref",
      "docs/spec.md#Nope",
    ]);
    assert.equal(unknown.status, 2);
    assert.match(unknown.stderr, /no spec reference "docs\/spec\.md#Nope"/);
    const noHeading = run(root, ["--spec-ref", "docs/spec.md"]);
    assert.equal(noHeading.status, 2);
    assert.match(noHeading.stderr, /<path>#<heading>/);
    assert.equal(readFileSync(path.join(root, "traceability.yaml"), "utf8"), before);
  });
});

test("--dry-run では書かずに、取り直す参照と飛ばすリンクを示す", () => {
  withDriftedRepo(["c"], (root) => {
    const before = readFileSync(path.join(root, "traceability.yaml"), "utf8");
    const result = run(root, ["--spec-ref", "docs/spec.md#Common", "--dry-run"]);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /^a spec docs\/spec\.md § Common: /m);
    assert.match(result.stdout, /skipped link "c"/);
    assert.equal(readFileSync(path.join(root, "traceability.yaml"), "utf8"), before);
  });
});

describe("describeNextSteps の --spec-ref の案内", () => {
  const specEntry = (linkId: string, heading: string): DriftEntry => ({
    linkId,
    side: "spec",
    path: "docs/spec.md",
    heading,
    storedHash: "a".repeat(64),
    currentHash: "b".repeat(64),
    status: "changed",
  });

  test("同じ節が 2 つ以上のリンクで drift したときだけ、--spec-ref の形を示す（パスと見出しは埋めない）", () => {
    const shared = describeNextSteps([specEntry("a", "Common"), specEntry("b", "Common")]).join(
      "\n",
    );
    assert.match(shared, /specproof-update --spec-ref '<path>#<heading>'/);
    assert.doesNotMatch(shared, /Common/);
    const notShared = describeNextSteps([specEntry("a", "Common"), specEntry("b", "Other")]).join(
      "\n",
    );
    assert.doesNotMatch(notShared, /--spec-ref/);
  });
});

// manifest を直接組み立てる場合のための小さな道具。spec.md は Common（## と ### の 2 つ）と Other を持つ。
const withRepo = (manifest: string, body: (root: string) => void | Promise<void>) => async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "specproof-spec-ref-edge-"));
  try {
    mkdirSync(path.join(root, "docs"));
    writeFileSync(
      path.join(root, "docs/spec.md"),
      "# Spec\n\n## Common\n\nrule\n\n### Common\n\nnested\n\n## Other\n\nother\n",
    );
    for (const id of ["a", "b"])
      writeFileSync(path.join(root, `${id}.ts`), `export const ${id} = 1;\n`);
    writeFileSync(path.join(root, "traceability.yaml"), manifest);
    await body(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

const OLD = "a".repeat(64);
const OTHER_OLD = "c".repeat(64);
const specLink = (
  id: string,
  spec: { heading: string; hash: string; level?: number; path?: string }[],
  impl: { path: string; hash: string }[] = [],
): string =>
  `  - id: ${id}\n    label: ${id}\n    spec:\n${spec
    .map(
      (ref) =>
        `      - path: ${JSON.stringify(ref.path ?? "docs/spec.md")}\n        heading: ${JSON.stringify(ref.heading)}\n        hash: ${ref.hash}\n${ref.level ? `        headingLevel: ${ref.level}\n` : ""}`,
    )
    .join(
      "",
    )}    impl:${impl.length === 0 ? " []\n" : `\n${impl.map((ref) => `      - path: ${ref.path}\n        hash: ${ref.hash}\n`).join("")}`}    features: []\n`;

const manifestOf = (...links: string[]): string => `version: 1\nlinks:\n${links.join("")}`;

test(
  "impl の保存値が FILE_MISSING で今も無いリンクは、check と同じく drift と数えて飛ばす",
  withRepo(
    manifestOf(
      specLink(
        "a",
        [{ heading: "Common", hash: OLD }],
        [{ path: "gone.ts", hash: "FILE_MISSING" }],
      ),
      specLink("b", [{ heading: "Common", hash: OLD }]),
    ),
    (root) => {
      const result = run(root, ["--spec-ref", "docs/spec.md#Common"]);
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stdout, /skipped link "a"/);
      assert.match(result.stdout, /^b spec docs\/spec\.md § Common: /m);
    },
  ),
);

test(
  "深さの違う同名の節に当たる指定は、何も書かずに失敗する",
  withRepo(
    manifestOf(
      specLink("a", [{ heading: "Common", hash: OLD }]),
      specLink("b", [{ heading: "Common", hash: OLD, level: 3 }]),
    ),
    (root) => {
      const before = readFileSync(path.join(root, "traceability.yaml"), "utf8");
      const result = run(root, ["--spec-ref", "docs/spec.md#Common"]);
      assert.equal(result.status, 2);
      assert.match(result.stderr, /different heading levels/);
      assert.equal(readFileSync(path.join(root, "traceability.yaml"), "utf8"), before);
    },
  ),
);

test(
  "bless した版がリンクごとに違う、または PENDING なら、何も書かずに失敗する",
  withRepo(
    manifestOf(
      specLink("a", [{ heading: "Common", hash: OLD }]),
      specLink("b", [{ heading: "Common", hash: OTHER_OLD }]),
    ),
    (root) => {
      const differing = run(root, ["--spec-ref", "docs/spec.md#Common"]);
      assert.equal(differing.status, 2);
      assert.match(differing.stderr, /blessed at different versions/);
      writeFileSync(
        path.join(root, "traceability.yaml"),
        manifestOf(specLink("a", [{ heading: "Common", hash: "PENDING" }])),
      );
      const pending = run(root, ["--spec-ref", "docs/spec.md#Common"]);
      assert.equal(pending.status, 2);
      assert.match(pending.stderr, /blessed at different versions \(or never\)/);
    },
  ),
);

test(
  "すでに今の版で bless したリンクは版の比較に入れず、残りだけを取り直す",
  withRepo(manifestOf(specLink("a", [{ heading: "Common", hash: OLD }])), (root) => {
    // a を一度取り直して今の版にし、b を古い版で足す。
    assert.equal(run(root, ["--spec-ref", "docs/spec.md#Common"]).status, 0);
    const current = (
      parse(readFileSync(path.join(root, "traceability.yaml"), "utf8")).links as Link[]
    )[0].spec[0].hash;
    writeFileSync(
      path.join(root, "traceability.yaml"),
      manifestOf(
        specLink("a", [{ heading: "Common", hash: current }]),
        specLink("b", [{ heading: "Common", hash: OLD }]),
      ),
    );
    const result = run(root, ["--spec-ref", "docs/spec.md#Common"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^b spec /m);
    assert.doesNotMatch(result.stdout, /^a spec /m);
  }),
);

test(
  "パスは正規化し、値全体の前後の空白だけを除いて照合する",
  withRepo(
    manifestOf(specLink("a", [{ heading: "Common", hash: OLD, path: "./docs/spec.md" }])),
    (root) => {
      const result = run(root, ["--spec-ref", "  docs/spec.md#Common\n"]);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /^a spec /m);
    },
  ),
);

test(
  "`#` を含むパスの参照と、`#` を含む見出しの参照を取り違えない",
  withRepo(
    manifestOf(
      specLink("hash-in-path", [{ heading: "C", hash: OLD, path: "docs/a#b.md" }]),
      specLink("hash-in-heading", [{ heading: "b.md#C", hash: OLD, path: "docs/a" }]),
    ),
    (root) => {
      writeFileSync(path.join(root, "docs/a#b.md"), "## C\n\nx\n");
      writeFileSync(path.join(root, "docs/a"), "## b.md#C\n\ny\n");
      // 最初の `#` で分けるので、この指定は path "docs/a"・見出し "b.md#C" の参照だけを選ぶ。
      const result = run(root, ["--spec-ref", "docs/a#b.md#C", "--dry-run"]);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /^hash-in-heading spec /m);
      assert.doesNotMatch(result.stdout, /^hash-in-path spec /m);
    },
  ),
);

test(
  "節が変わっていなければ書かずに already up to date と示す",
  withRepo(manifestOf(specLink("a", [{ heading: "Common", hash: OLD }])), (root) => {
    assert.equal(run(root, ["--spec-ref", "docs/spec.md#Common"]).status, 0);
    const again = run(root, ["--spec-ref", "docs/spec.md#Common"]);
    assert.equal(again.status, 0, again.stderr);
    assert.match(again.stdout, /already up to date/);
  }),
);

test(
  "ライブラリ: 空の specRefs は失敗し、specRefs を指定しなければ結果に skipped を付けない",
  withRepo(manifestOf(specLink("a", [{ heading: "Common", hash: OLD }])), async (root) => {
    const manifestPath = path.join(root, "traceability.yaml");
    await assert.rejects(
      updateManifestHashes(manifestPath, root, { specRefs: [] }),
      /specRefs is empty/,
    );
    const plain = await updateManifestHashes(manifestPath, root, { dryRun: true });
    assert.equal("skipped" in plain, false);
    const selected = await updateManifestHashes(manifestPath, root, {
      specRefs: ["docs/spec.md#Common"],
      dryRun: true,
    });
    assert.deepEqual(selected.skipped, []);
  }),
);

test("describeNextSteps は ./ の付いたパスを同じ節と数え、missing の節は数えない", () => {
  const specEntry = (
    linkId: string,
    entryPath: string,
    status: DriftEntry["status"],
  ): DriftEntry => ({
    linkId,
    side: "spec",
    path: entryPath,
    heading: "Common",
    storedHash: "a".repeat(64),
    currentHash: status === "changed" ? "b".repeat(64) : "SECTION_MISSING",
    status,
  });
  const normalized = describeNextSteps([
    specEntry("a", "docs/spec.md", "changed"),
    specEntry("b", "./docs/spec.md", "changed"),
  ]).join("\n");
  assert.match(normalized, /--spec-ref/);
  const missing = describeNextSteps([
    specEntry("a", "docs/spec.md", "missing"),
    specEntry("b", "docs/spec.md", "missing"),
  ]).join("\n");
  assert.doesNotMatch(missing, /--spec-ref/);
});

test(
  "1 つのリンクに 2 つの指定が当たれば両方を取り直し、同じ指定を重ねても 1 回と同じ",
  withRepo(
    manifestOf(
      specLink("a", [
        { heading: "Common", hash: OLD },
        { heading: "Other", hash: OLD },
      ]),
    ),
    (root) => {
      const result = run(root, [
        "--spec-ref",
        "docs/spec.md#Common",
        "--spec-ref",
        "docs/spec.md#Other",
        "--spec-ref",
        "docs/spec.md#Common",
      ]);
      assert.equal(result.status, 0, result.stderr);
      assert.match(
        result.stdout,
        /spec ref\(s\) refreshed in 1 link\(s\) \(2 hash\(es\) changed\)/,
      );
    },
  ),
);

// 前後の空白を除くのは CLI に書いた値だけにする。manifest に保存した参照は hash の計算と同じ規則で区別する
// （旧形式の見出し `##  Rule` の参照 " Rule" や、末尾に空白のあるファイル名は、別の節・別のファイル）。
const withBlessedFiles = (
  files: Record<string, string>,
  links: { id: string; path: string; heading: string }[],
  body: (root: string, blessed: Link[]) => void,
) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "specproof-spec-ref-identity-"));
  try {
    for (const [name, content] of Object.entries(files))
      writeFileSync(path.join(root, name), content);
    const manifest = `version: 1\nlinks:\n${links
      .map(
        (link) =>
          `  - id: ${link.id}\n    label: ${link.id}\n    spec:\n      - path: ${JSON.stringify(link.path)}\n        heading: ${JSON.stringify(link.heading)}\n        hash: PENDING\n    impl: []\n    features: []\n`,
      )
      .join("")}`;
    writeFileSync(path.join(root, "traceability.yaml"), manifest);
    assert.equal(run(root, []).status, 0);
    body(root, readLinks(root));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

test("前後の空白で区別される保存済みの見出しを、指定した見出しと同じ節として bless しない", () => {
  withBlessedFiles(
    {
      "spec.md": "# Spec\n\n## Rule\n\nFirst approved rule.\n\n##  Rule\n\nSecond approved rule.\n",
    },
    [
      { id: "intended", path: "spec.md", heading: "Rule" },
      { id: "legacy-distinct", path: "spec.md", heading: " Rule" },
    ],
    (root, blessed) => {
      writeFileSync(
        path.join(root, "spec.md"),
        "# Spec\n\n## Rule\n\nFirst approved rule.\n\n##  Rule\n\nSecond rule changed.\n",
      );
      const result = run(root, ["--spec-ref", "spec.md#Rule"]);
      assert.equal(result.status, 0, result.stderr);
      assert.doesNotMatch(result.stdout, /^legacy-distinct /m);
      const after = readLinks(root);
      assert.equal(
        after.find((l) => l.id === "legacy-distinct")?.spec[0].hash,
        blessed.find((l) => l.id === "legacy-distinct")?.spec[0].hash,
      );
    },
  );
});

test("末尾に空白のある別のファイルの参照を、指定したファイルと同じものとして bless しない", () => {
  withBlessedFiles(
    { "spec.md": "## Rule\n\na\n", "spec.md ": "## Rule\n\nb\n" },
    [
      { id: "intended", path: "spec.md", heading: "Rule" },
      { id: "other-file", path: "spec.md ", heading: "Rule" },
    ],
    (root, blessed) => {
      writeFileSync(path.join(root, "spec.md "), "## Rule\n\nb changed\n");
      const result = run(root, ["--spec-ref", "spec.md#Rule"]);
      assert.equal(result.status, 0, result.stderr);
      assert.doesNotMatch(result.stdout, /^other-file /m);
      const after = readLinks(root);
      assert.equal(
        after.find((l) => l.id === "other-file")?.spec[0].hash,
        blessed.find((l) => l.id === "other-file")?.spec[0].hash,
      );
    },
  );
});

test("`#` の前後に空白のある指定は、似た名前の別の節を選ばずに失敗する", () => {
  withBlessedFiles(
    { "spec.md": "# Spec\n\n## Rule\n\nFirst.\n\n##  Rule\n\nSecond.\n" },
    [
      { id: "intended", path: "spec.md", heading: "Rule" },
      { id: "legacy-distinct", path: "spec.md", heading: " Rule" },
    ],
    (root) => {
      writeFileSync(
        path.join(root, "spec.md"),
        "# Spec\n\n## Rule\n\nFirst changed.\n\n##  Rule\n\nSecond.\n",
      );
      const before = readFileSync(path.join(root, "traceability.yaml"), "utf8");
      for (const value of ["spec.md# Rule", "spec.md #Rule"]) {
        const result = run(root, ["--spec-ref", value]);
        assert.equal(result.status, 2, value);
        assert.match(result.stderr, /whitespace around '#'/);
      }
      assert.equal(readFileSync(path.join(root, "traceability.yaml"), "utf8"), before);
    },
  );
});

test("describeNextSteps は --spec-ref で選べない節（前後に空白、パスに #）を数えない", () => {
  const entry = (linkId: string, entryPath: string, heading: string): DriftEntry => ({
    linkId,
    side: "spec",
    path: entryPath,
    heading,
    storedHash: "a".repeat(64),
    currentHash: "b".repeat(64),
    status: "changed",
  });
  for (const [entryPath, heading] of [
    ["spec.md", " Rule"],
    ["spec.md ", "Rule"],
    ["docs/a#b.md", "Rule"],
  ]) {
    const text = describeNextSteps([
      entry("a", entryPath, heading),
      entry("b", entryPath, heading),
    ]).join("\n");
    assert.doesNotMatch(text, /--spec-ref/, JSON.stringify([entryPath, heading]));
  }
});
