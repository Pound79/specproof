import assert from "node:assert/strict";
import { test } from "vitest";
import { toGithubAnnotation, toGithubWarningAnnotation } from "../cli-check-format.js";

test("annotation の file property に %, 改行, コロン, カンマを直接出さない", () => {
  const result = toGithubAnnotation({
    linkId: "id%\r\n::error::injected", side: "spec", status: "changed",
    path: "dir/a,b:c%\r\n.ts", heading: "Title%\nnext", storedHash: "old", currentHash: "new",
  });
  assert.match(result, /^::warning file=dir\/a%2Cb%3Ac%25%0D%0A\.ts::/);
  assert.ok(result.includes("id%25%0D%0A::error::injected"));
  assert.ok(result.includes("Title%25%0Anext"));
  assert.equal(result.includes("\n"), false);
  assert.equal(result.includes("\r"), false);
});

test("warning message も同じデータエスケープを使う", () => {
  const result = toGithubWarningAnnotation({ kind: "empty-link", message: "100%\r\n::error::bad,a:b" });
  assert.equal(result, "::warning::specproof traceability: 100%25%0D%0A::error::bad,a:b");
});
