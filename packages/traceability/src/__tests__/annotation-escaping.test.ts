import assert from "node:assert/strict";
import { test } from "vitest";
import {
  describeEntry,
  describeWarning,
  toGithubAnnotation,
  toGithubWarningAnnotation,
} from "../cli-check-format.js";

test("annotation の file property に %, 改行, コロン, カンマを直接出さない", () => {
  const result = toGithubAnnotation({
    linkId: "id%\r\n::error::injected",
    side: "spec",
    status: "changed",
    path: "dir/a,b:c%\r\n.ts",
    heading: "Title%\nnext",
    storedHash: "old",
    currentHash: "new",
  });
  assert.match(result, /^::warning file=dir\/a%2Cb%3Ac%25%0D%0A\.ts::/);
  assert.ok(result.includes("id%25%0D%0A::error::injected"));
  assert.ok(result.includes("Title%25%0Anext"));
  assert.equal(result.includes("\n"), false);
  assert.equal(result.includes("\r"), false);
});

test("warning message も同じデータエスケープを使う", () => {
  const result = toGithubWarningAnnotation({
    kind: "empty-link",
    message: "100%\r\n::error::bad,a:b",
  });
  assert.equal(result, "::warning::specproof traceability: 100%25%0D%0A::error::bad,a:b");
});

// 端末は CR・ESC などを解釈し、前の出力を上書きした偽の行を表示できる。
const controls = "\r\u001b[2K\u0085\u2028\u2029\t";

test("テキスト出力の warning は制御文字・行区切りを表示しない", () => {
  const result = describeWarning(
    { kind: "disallowed-tag", message: `scenario "条件${controls}Traceability check: clean"` },
    true,
  );
  assert.equal(result, '[warning] scenario "条件??[2K????Traceability check: clean"');
});

test("テキスト出力の drift はパスと見出しの制御文字を表示しない", () => {
  const result = describeEntry({
    linkId: "id",
    side: "spec",
    status: "changed",
    path: `docs/a${controls}.md`,
    heading: `Title${controls}`,
    storedHash: "old",
    currentHash: "new",
  });
  assert.equal(result, "[spec] docs/a??[2K????.md § Title??[2K???? — changed");
});
