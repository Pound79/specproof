import assert from "node:assert/strict";
import { test } from "vitest";
import { hashHeadingSectionContent, inspectHistoricalV1Section, listHeadings } from "../hash.js";

// 実装ごとの読み方の癖を個別に追わず、読み方が実装で分かれうる形（hazard）が出たら、その行から末尾
// までを決めきれないとみなす。Markdown は前から順に読むので、hazard より前の行の読み方は変わらない。
const doc = (...lines: string[]): string => lines.join("\n");
const HAZARD = /cannot determine how this section renders from line (\d+) \(([^)]*)\)/;

const hazardAt = (content: string, line: number, kind: RegExp, heading = "A") => {
  assert.throws(
    () => hashHeadingSectionContent(content, heading),
    (error: Error) => {
      const match = HAZARD.exec(error.message);
      return match?.[1] === String(line) && kind.test(match[2]);
    },
  );
  assert.equal(inspectHistoricalV1Section(content, heading, 2).ambiguous, true);
};

const accepted = (content: string, heading = "A") => {
  assert.doesNotThrow(() => hashHeadingSectionContent(content, heading));
  assert.equal(inspectHistoricalV1Section(content, heading, 2).ambiguous, false);
};

// cmark-gfm 0.29 は、記号だけの項目の後の空白だけの行を項目の続きと読み、後ろの字下げした行を項目の
// 中のブロックにする（空の行なら項目は終わる）。
for (const [name, content, line] of [
  [
    "記号だけの項目の後の空白だけの行とコメント",
    "# Spec\n\n## A\n\nThe limit is 10.\n\n- \n  \n    <!--\n  ## B\n  -->\nThe limit is 999999.\n\n## C\n",
    8,
  ],
  ["記号だけの項目の後の空白だけの行と div", "## A\n- \n  \n    <div>\n  ## B\nevil\n\n## C", 3],
  ["記号だけの項目の後の空白だけの行とフェンス", "## A\n-\n  \n  ```\n## B\n  ```\n", 3],
] as const) {
  test(`${name}は拒否する`, () => {
    hazardAt(content, line, /spaces or tabs/);
  });
}

// cmark-gfm は \v・\f を空白として読み、表の区切りの行や HTML の開始の読み方が変わる。
for (const [name, content, line, kind] of [
  [
    "表の区切りの行の \\v",
    "# Spec\n\n## A\n\nThe limit is 10.\n\n| a |\n| -\v |\n<x>\n## B\nThe limit is 999999.\n\n## C\n",
    8,
    /vertical tab/,
  ],
  ["リスト項目の中の表の \\v", "## A\n- x\n  | a |\n  | -\v |\n  <x>\n  ## B\n", 4, /vertical tab/],
  ["\\f", "## A\nx\n<div\fx>\n## B\n", 3, /form feed/],
  ["NUL", "## A\nx\u0000\n## B\n", 2, /U\+0000/],
  ["U+0085", "## A\nx\u0085y\n## B\n", 2, /U\+0085/],
  ["U+2028", "## A\nx\u2028## B\n", 2, /U\+2028/],
  ["U+2029", "## A\nx\u2029y\n## B\n", 2, /U\+2029/],
] as const) {
  test(`${name}は拒否する`, () => {
    hazardAt(content, line, kind);
  });
}

// markdown-it は、リスト項目の中の HTML ブロックを空行で終える（CommonMark は閉じの記号まで続く）。
for (const [name, open, close] of [
  ["コメント", "- <!--", "  -->"],
  ["pre", "- <pre>", "  </pre>"],
  ["番号付きの項目のコメント", "1. <!--", "   -->"],
  ["CDATA", "- <![CDATA[", "  ]]>"],
] as const) {
  test(`リスト項目の中の${name}は拒否する`, () => {
    const indent = " ".repeat(close.length - close.trimStart().length);
    const content = doc(
      "## A",
      open,
      `${indent}\`\`\``,
      "",
      `${indent}## B`,
      `${indent}\`\`\``,
      close,
    );
    hazardAt(content, 2, /HTML block in a list item/);
  });
}

// タブ以外の C0 制御文字・DEL・単独の CR は、実装ごとの扱いを個別に確かめず、すべて hazard にする。
for (const [name, content, line, kind] of [
  ["フェンスの後の \\b", doc("## A", "", "```\b", "npm i x", "```", "## B"), 3, /U\+0008/],
  ["U+0001", doc("## A", "a\u0001b", "## B"), 2, /U\+0001/],
  ["U+001F", doc("## A", "a\u001fb", "## B"), 2, /U\+001F/],
  ["DEL", doc("## A", "a\u007fb", "## B"), 2, /U\+007F/],
  ["単独の CR", doc("## A", "x", "a\rb", "## B"), 3, /carriage return/],
  ["行末に残った CR", doc("## A", "a\r", "## B"), 2, /carriage return/],
] as const) {
  test(`${name}は拒否する`, () => {
    hazardAt(content, line, kind);
  });
}

test("タブは hazard にしない", () => {
  accepted(doc("## A", "a\tb", "\tcode", "", "## B"));
});

test("hazard より前で終わる節は拒否しない", () => {
  accepted(doc("## A", "body", "## B", "- x", "  <!--", "  -->", "x\vy"));
  accepted(doc("## A", "- x", "## B", "- \v"), "A");
});

test("hazard より後ろに参照の見出しになりうる行があれば拒否する", () => {
  hazardAt(doc("## Z", "x\fy", "## A", "body"), 2, /form feed/);
});

// 規則を絞った側（許可側）の回帰。期待値を変えるなら CHANGELOG の hazard の説明も直す。
test("リスト項目の外の空白だけの行と字下げした HTML は拒否しない", () => {
  accepted(doc("## A", "  ", "  <div>", "", "## B", "- x"));
});

test("中身のある項目の後の空白だけの行は拒否しない（どの実装も項目の続きと読む）", () => {
  accepted(doc("## A", "- x", "  ", "  y", "\t", "## B"));
});

test("リストの後の最上位の HTML ブロックの中の字下げしたタグは拒否しない", () => {
  accepted(doc("## A", "- x", "", "<p>", "  <img src=x>", "</p>", "", "## B"));
});

// 記号だけの項目の判定は過大に拾う側に倒す（入れ子の記号・番号・空行を挟んだ空白だけの行）。
for (const [name, lines, line] of [
  ["入れ子の記号だけの項目", ["- a", "  -", "    ", "      <!--"], 4],
  ["番号付きの記号だけの項目", ["1.", "   ", "    <!--"], 3],
  ["空行を挟んだ空白だけの行", ["-", "", "  ", "  x"], 4],
  ["引用の中の記号だけの項目", ["> -", "  "], 3],
] as const) {
  test(`${name}の後の空白だけの行は拒否する`, () => {
    hazardAt(doc("## A", ...lines, "## B"), line, /spaces or tabs/);
  });
}

test("リスト項目の外（字下げしない行）の HTML ブロックは拒否しない", () => {
  accepted(doc("## A", "- x", "", "<!--", "", "-->", "## B", "body"));
});

test("長すぎる行は照合せずに拒否し、走査が落ちない", () => {
  const long = `<a${" b".repeat(2_100_000)} =>`;
  hazardAt(doc("## A", long, "## B"), 2, /longer than/);
  assert.deepEqual(
    listHeadings(doc("## A", long, "## B"), 2).map((heading) => heading.text),
    ["A", "B"],
  );
  hazardAt(doc("## A", "x".repeat(70_000), "## B"), 2, /longer than/);
});

test("上限ちょうどの長さの行は照合しても落ちない", () => {
  const tag = `<a${" b".repeat(32_766)}>`;
  assert.ok(tag.length <= 65_536);
  accepted(doc("## A", tag, "", "## B"));
  // 一致しない形（後戻りが最も深い形）。
  const failing = `<a${" b".repeat(32_765)} =>`;
  assert.ok(failing.length <= 65_536);
  accepted(doc("## A", failing, "", "## B"));
});
