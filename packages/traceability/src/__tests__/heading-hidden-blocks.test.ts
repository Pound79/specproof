import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "vitest";
import { hashHeadingSectionContent, inspectHistoricalV1Section, listHeadings } from "../hash.js";

// CommonMark で表示上の節の範囲が従来の v1 の範囲と食い違う入力は拒否し、食い違わない入力は
// 従来どおりの hash を返す。区切り線・setext 下線・中身の無いリスト項目の読み分けと、コメント以外の
// HTML ブロック・リスト内のコードフェンスについて、分岐ごとに両側を押さえる。
const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");
const doc = (...lines: string[]): string => lines.join("\n");
const BOUNDARY = /changes its boundaries/;

const rejects = (content: string, heading = "支払い") => {
  assert.throws(() => hashHeadingSectionContent(content, heading), BOUNDARY);
  assert.equal(inspectHistoricalV1Section(content, heading, 2).ambiguous, true);
};

// リスト項目の中の HTML ブロックは、markdown-it が空行で終えるなど実装で読み方が分かれるので、その行から
// 末尾までを決めきれない行（hazard）として拒否する（heading-hazards.test.ts）。
const IN_LIST = "an HTML block in a list item";
const hazard = (content: string, line: number, kind = IN_LIST, heading = "支払い") => {
  assert.throws(
    () => hashHeadingSectionContent(content, heading),
    (error: Error) => error.message.includes(`renders from line ${line} (${kind})`),
  );
  assert.equal(inspectHistoricalV1Section(content, heading, 2).ambiguous, true);
};

const keeps = (content: string, expected: string, heading = "支払い") => {
  assert.equal(hashHeadingSectionContent(content, heading), sha256(expected));
  assert.equal(inspectHistoricalV1Section(content, heading, 2).ambiguous, false);
};

// 区切り線・setext 下線・段落の後の中身の無い項目は、リストを始めない。直後の字下げしたコメントは
// 最上位のコメントなので、後ろの見出しを隠す。
for (const [name, before] of [
  ["区切り線 * * *", ["* * *"]],
  ["区切り線 - - -", ["- - -"]],
  ["区切り線 _ _ _ の後ろの空白", ["_ _ _  "]],
  ["段落の後の setext 下線 -", ["料金", "-"]],
  ["段落の後の setext 下線 ---", ["料金", "---"]],
  ["段落の後の中身の無い項目 *", ["項目", "*"]],
  ["段落の後の中身の無い項目 + と空白", ["項目", "+  "]],
] as const) {
  test(`${name}の後の字下げしたコメントは最上位のコメントとして見出しを隠す`, () => {
    rejects(
      doc(
        "## 支払い",
        "",
        ...before,
        "  <!-- 旧仕様",
        "## 旧料金",
        "-->",
        "手数料は500円。",
        "## 次の節",
      ),
    );
  });
}

// 上と似ているが、実際にリスト項目になる形。コメントは項目の中で、字下げの外の見出しで終わる
// （CommonMark）が、リスト項目の中の HTML ブロックなので拒否する。
for (const [name, before] of [
  ["区切り線を中身に持つ項目", ["- * * *"]],
  ["区切り線にならない記号の並び", ["* * x"]],
  ["2 個だけの記号", ["* *"]],
  ["空行の後の中身の無い項目", ["項目", "", "-"]],
  ["段落の後でも中身のある項目", ["項目", "- 中身"]],
] as const) {
  test(`${name}の中のコメントはリスト項目の中の HTML ブロックとして拒否する`, () => {
    const lines = ["## 支払い", "", ...before, "  <!-- 旧仕様"];
    hazard(doc(...lines, "## 旧料金", "-->", "手数料は500円。", "## 次の節"), lines.length);
  });
}

// 番号付きの項目の本文は 3 列目から。中身の無い `1.` が段落を中断しなければ、3 スペースの
// コメントは最上位のコメントになる。
test("段落の後の中身の無い番号付き項目 1. はリストを始めない", () => {
  rejects(doc("## 支払い", "項目", "1.", "   <!--", "## 旧料金", "-->", "手数料は500円。"));
});

test("空行の後の中身の無い番号付き項目 1. はリストを始める（中のコメントは拒否する）", () => {
  const lines = ["## 支払い", "項目", "", "1.", "   <!--"];
  hazard(doc(...lines, "## 旧料金", "-->", "手数料は500円。"), 5);
});

test("項目の中の段落の後の setext 下線は、入れ子の項目を始めない", () => {
  // `  -` は setext の下線で、続く `    <!--` は `- 料金` の項目のコメント（リスト項目の中）。
  hazard(
    doc("## 支払い", "", "- 料金", "  -", "    <!--", "  ## 旧料金", "  -->", "手数料は500円。"),
    5,
  );
});

// 従来の規則が見出しとして読む行を、表示上は HTML ブロックが含む。
for (const [name, open, close] of [
  ["script", "<script>", "</script>"],
  ["大文字の SCRIPT と別の閉じタグ", "<SCRIPT type=x", "</style>"],
  ["pre", "<pre>", "</PRE>"],
  ["style", "<style", "</style>"],
  ["textarea", "<textarea>", "</textarea>"],
  ["処理命令", "<?php", "?>"],
  ["宣言", "<!DOCTYPE x", ">"],
  ["小文字の宣言", "<!doctype", ">"],
  ["CDATA", "<![CDATA[", "]]>"],
] as const) {
  test(`HTML ブロック（${name}）の中の見出しで節を切らない`, () => {
    const content = doc(
      "## 支払い",
      "",
      open,
      "## 旧料金",
      "",
      close,
      "手数料は500円。",
      "## 次の節",
    );
    rejects(content);
    assert.deepEqual(
      listHeadings(content, 2).map(({ text }) => text),
      ["支払い", "次の節"],
    );
  });
}

// 閉じの記号の一部（`>`、`?`、`]]`）だけを含む行では閉じない。
for (const [name, open, close] of [
  ["script", "<script>", "</script>"],
  ["処理命令", "<?", "?>"],
  ["CDATA", "<![CDATA[", "]]>"],
] as const) {
  test(`HTML ブロック（${name}）は閉じの記号の一部だけでは閉じない`, () => {
    rejects(doc("## 支払い", open, "a > b ? ]] </scrip>", "## 旧料金", close, "手数料は500円。"));
  });
}

test("HTML ブロックは段落を中断する", () => {
  rejects(doc("## 支払い", "本文", "<script>", "## 旧料金", "</script>", "手数料は500円。"));
});

test("リスト項目の中の HTML ブロックは拒否する", () => {
  hazard(doc("## 支払い", "", "- <?", "  ## 旧料金", "  ?>", "手数料は500円。", "## 次の節"), 3);
});

for (const [name, body] of [
  ["同じ行で閉じた HTML ブロック", ["<script>x</script>"]],
  ["同じ行で閉じた処理命令", ["<? x ?>"]],
  ["同じ行で閉じた宣言", ["<!X y>"]],
  ["同じ行で閉じた CDATA", ["<![CDATA[ x ]]>"]],
  ["タグ名が続く script でない要素", ["<scripts> 本文"]],
  ["英字の続かない <!", ["<!1 本文"]],
  ["4 スペース字下げの script", ["    <script>"]],
  ["見出しを含まない script", ["<script>", "x", "</script>"]],
] as const) {
  test(`${name}は後ろの見出しを隠さず、従来の範囲で読める`, () => {
    const lines = ["## 支払い", "", ...body];
    keeps(doc(...lines, "## 公開", "手数料は500円。"), doc(...lines));
  });
}

test("字下げの外で終わるリスト項目の script も、リスト項目の中の HTML ブロックとして拒否する", () => {
  hazard(doc("## 支払い", "", "- <script>", "## 公開", "手数料は500円。"), 3);
});

test("リスト内のフェンスの中の見出しで節を切らない", () => {
  rejects(doc("## 支払い", "- ```", "  ## 旧料金", "  ```", "手数料は500円。", "## 次の節"));
});

test("リスト内のフェンスの中の別の記号のフェンスを従来の規則が開始と読むなら拒否する", () => {
  // 従来の規則は `  ```` から末尾までをフェンスとみなし、次の節の見出しを読まない。
  rejects(doc("## 支払い", "- ~~~", "  ```", "  ~~~", "手数料は500円。", "## 次の節"));
});

for (const [name, body] of [
  ["4 列の字下げで閉じるリスト内のフェンス", ["10. ```", "    ## 例", "    ```"]],
  ["字下げの外で終わるリスト内のフェンス", ["- ```", "  x"]],
  ["最上位のフェンス", ["```", "## 例", "```"]],
  ["項目の本文の字下げで始まるフェンス", ["- 項目", "", "  ```", "  ## 例", "  ```"]],
] as const) {
  test(`${name}は従来の範囲で読める`, () => {
    const lines = ["## 支払い", "", ...body];
    keeps(doc(...lines, "## 公開", "手数料は500円。"), doc(...lines));
  });
}

test("エラーはコメント以外の HTML ブロックとリスト内のフェンスの開始行も並べる", () => {
  const content = doc(
    "## 支払い",
    "<script>",
    "## 旧料金",
    "</script>",
    "- ```",
    "  ## 例",
    "<?",
    "## 閉じない",
  );
  assert.throws(
    () => hashHeadingSectionContent(content, "支払い"),
    (error: Error) =>
      /HTML comment/.test(error.message) &&
      error.message.includes(
        'by opening line: line 2, line 5 (not closed: add "```" where the block should end), ' +
          'line 7 (not closed: add "?>" where the block should end).',
      ),
  );
});

test("並べる原因の行が無ければ、両方の範囲と、閉じの記号の前に終わるブロックを示す", () => {
  // 記号だけの項目の中のフェンスは `## B` で項目とともに終わる。従来の規則は字下げした ``` まで読み続ける。
  const content = doc("## A", "- a", "-", "  ```", "## B", "  ```", "");
  assert.throws(
    () => hashHeadingSectionContent(content, "A"),
    (error: Error) =>
      !/: an HTML comment/.test(error.message) &&
      error.message.includes(
        "version 1 hashes lines 1 to the end of the file, but the rendered section spans lines 1-4. " +
          "Blocks that CommonMark ends before their closing marker (for example, when a list item " +
          'ends), by opening line: line 4 (ends before line 5 without "```"), ' +
          'line 6 (ends at the end of the file without "```").',
      ),
  );
});

test("範囲の後ろの単独の CR（hazard）を原因の行として並べない", () => {
  const content = doc("## A", "- a", "-", "  ```", "## B", "  ```", "x\ry", "");
  assert.throws(
    () => hashHeadingSectionContent(content, "A"),
    (error: Error) =>
      !/lone CR/.test(error.message) &&
      error.message.includes('line 4 (ends before line 5 without "```")'),
  );
});

test("項目の本文から 4 列以上字下げしたフェンス記号はリスト内のフェンスを閉じない", () => {
  rejects(doc("## 支払い", "- ```", "      ```", "  ## 旧料金", "  ```", "手数料は500円。"));
});

test("記号だけの項目の後に空行が続くと項目は終わり、字下げしたコメントは最上位になる", () => {
  rejects(doc("## 支払い", "", "-", "", "  <!--", "## 旧料金", "-->", "手数料は500円。"));
});

test("setext 見出しの後の記号だけの項目はリストを始める（中のコメントは拒否する）", () => {
  const lines = ["## 支払い", "料金", "==", "*", "  <!--"];
  hazard(doc(...lines, "## 旧料金", "-->", "手数料は500円。"), 5);
});

test("リスト項目の段落の字下げの無い続きの行は項目を終わらせない", () => {
  // `-->` は段落の続き（lazy continuation）なので、次のフェンスは項目の中にあり `手数料` で終わる。
  // 従来の規則はフェンスが末尾まで続くとみなし、次の節の見出しを読まない。
  rejects(doc("## 支払い", "", "- 項目", "-->", "   ```", "", "手数料は500円。", "## 次の節"));
});

// 段落の続きに見えても、新しいブロックを始める行はリスト項目を終わらせる。続くフェンスは最上位で、
// 従来の規則と同じく字下げの無い ``` で閉じる。
for (const [name, line] of [
  ["区切り線", "***"],
  // 本文が 4 列目からの項目にして、続くフェンスをその項目の外に置く。
  ["1 以外から始まる番号付きリスト", "10. 次の項目"],
  ["見出し", "### 小見出し"],
  ["引用", "> 引用"],
  ["HTML ブロック", "<? x ?>"],
] as const) {
  test(`リスト項目の段落の後の${name}は項目を終わらせる`, () => {
    const lines = ["## 支払い", "", "- 項目", line, "   ```", "## 例", "```"];
    keeps(doc(...lines, "## 公開", "手数料は500円。"), doc(...lines));
  });
}

test("項目の字下げに足りない 4 スペースのブロックの開始は、読み方を決めきれず拒否する", () => {
  // 本文が 5 列目からの項目で、4 スペースの `<!--` は CommonMark では段落の続き（項目が続き、後ろの
  // `  <!--` は `*` の項目の中で `## 旧料金` を隠さない）。markdown-it は項目を閉じてインデントコードと
  // 読み、後ろのコメントが `## 旧料金` を隠す。どちらの読み方か決めないので拒否する。
  const lines = ["## 支払い", "", "10.  項目", "    <!--", "x", "*", "  <!--"];
  assert.throws(
    () => hashHeadingSectionContent(doc(...lines, "## 旧料金", "-->", "手数料は500円。"), "支払い"),
    /cannot determine how this section renders near line 4 \(an indented line after a paragraph/,
  );
});

test("項目の字下げに足りない 4 スペースの本文は、段落の続きとして読む", () => {
  // `*` の項目の中のコメントは拒否するので、その前の行までで比べる。
  const lines = ["## 支払い", "", "10.  項目", "    続き", "x", "*", "-"];
  keeps(doc(...lines, "## 旧料金", "手数料は500円。"), doc(...lines));
  hazard(doc("## 支払い", "", "10.  項目", "    続き", "x", "*", "  <!--", "## 旧料金"), 7);
});

test("閉じていない pre には </pre> を補う対処を示し、参照の見出しを含むブロックにも注記する", () => {
  const content = doc("## 支払い", "<pre", "## 旧料金", "本文", "## 次の節");
  assert.throws(
    () => hashHeadingSectionContent(content, "旧料金"),
    (error: Error) =>
      error.message.includes(
        'line 2 (not closed: add "</pre>" where the block should end; contains the referenced ' +
          "heading: if the whole section is inside this block, remove this reference",
      ),
  );
});

test("最上位のフェンスはエラーに並べない", () => {
  const content = doc("## 支払い", "```", "## 例", "```", "<script>", "## 旧料金", "</script>");
  assert.throws(() => hashHeadingSectionContent(content, "支払い"), /by opening line: line 5\. /);
});

// 表示上の規則（CommonMark）と従来の規則の差で、登録した節の後ろが隠れる入力。
const BASE_TAIL = ["## A", "foo", "## B", "bar", ""];

// 単独の CR は、CommonMark では改行で従来の規則と行の数え方が変わるので、その行から末尾までを決めきれない
// 行（hazard）として拒否する。
for (const [name, before, line] of [
  ["単独の CR の後のコメント", ["# T", "intro\r<!--"], 2],
  ["単独の CR の後の見出し", ["# T", "intro\r## A", "x"], 2],
  ["行末に残った CR", ["# T", "", "-\r", "  <!--"], 3],
  ["単独の CR を含む本文", ["# T", "intro\r more"], 2],
] as const) {
  test(`${name}は hazard として拒否する`, () => {
    hazard(doc(...before, ...BASE_TAIL), line, "carriage return", "A");
  });
}

for (const [name, before] of [
  [
    "バッククォートを情報文字列に含む行（フェンスでない）",
    ["# T", "intro", "``` a`", "<!--", "```"],
  ],
  ["空白とタブ以外が後ろに続くフェンス記号（閉じない）", ["# T", "intro", "```", "```　"]],
] as const) {
  test(`${name}は表示上の節の範囲を変えるので拒否する`, () => {
    rejects(doc(...before, ...BASE_TAIL), "A");
  });
}

for (const [name, fence] of [
  ["U+2028 を情報文字列に持つフェンス", "``` \u2028"],
  ["U+2029 を情報文字列に持つチルダのフェンス", "~~~ x\u2029y"],
] as const) {
  test(`${name}は hazard として拒否する`, () => {
    const separator = fence.includes("\u2028") ? "U+2028" : "U+2029";
    hazard(
      doc("# T", "intro", fence, ...BASE_TAIL),
      3,
      `control or separator character ${separator}`,
      "A",
    );
  });
}

for (const [name, content] of [
  [
    "引用の段落の字下げした続きの行の後の項目",
    ["## A", "> q", "  ===", "-", "  ```", "* * *", "  ```", "## B", "hidden text", "## C"],
  ],
  ["項目の中の引用の段落の続きの行", ["## A", "- > q", "lazy", "  ```", "## B", "  ```", "## C"]],
] as const) {
  test(`${name}は引用の段落の続き（lazy continuation）として読む`, () => {
    rejects(doc(...content), "A");
  });
}

for (const [name, before] of [
  ["バッククォートを情報文字列に含むチルダのフェンス", ["~~~ a`b", "## x", "~~~"]],
  ["後ろに空白とタブが続く閉じのフェンス", ["``` js", "## x", "```  \t"]],
  ["引用の後の空行と字下げした段落", ["> q", "", "  x"]],
  ["引用の中の見出しの後の項目", ["- > # q", "  x", "  ```", "  ## x", "  ```"]],
] as const) {
  test(`${name}は従来の範囲で読める`, () => {
    const lines = ["# T", ...before];
    assert.equal(
      hashHeadingSectionContent(doc(...lines, ...BASE_TAIL), "A"),
      sha256(doc("## A", "foo")),
    );
  });
}

test("エラーは境界を変えないリスト内のフェンスを並べず、原因のブロックを示す", () => {
  const fences = Array.from({ length: 12 }, () => ["- a", "  ```", "  x", "  ```", ""]).flat();
  const content = doc("## 支払い", ...fences, "<script>", "## 旧料金", "</script>", "本文");
  assert.throws(() => hashHeadingSectionContent(content, "支払い"), /by opening line: line 62\. /);
});

test("エラーは表示上だけ閉じない最上位のフェンスを並べる", () => {
  const content = doc("## 支払い", "```", "```　", "## 旧料金", "本文");
  assert.throws(
    () => hashHeadingSectionContent(content, "支払い"),
    /by opening line: line 2 \(not closed: add "```" where the block should end\)\./,
  );
});

test("エラーに並べる閉じの記号は長さを数で示す", () => {
  // 照合する行の長さの上限（64 Ki）より短い、長いフェンス。
  const content = doc("## 支払い", `- ${"`".repeat(60_000)}`, "  ## 旧料金", "本文");
  assert.throws(
    () => hashHeadingSectionContent(content, "支払い"),
    (error: Error) =>
      error.message.length < 2000 && /a fence of 60000 backticks/.test(error.message),
  );
});
