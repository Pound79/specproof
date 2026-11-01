import assert from "node:assert/strict";
import { test } from "vitest";
import { printable, printableLines } from "../display-text.js";

test("printable は制御文字・行区切り・bidi 制御文字・BOM を ? にする", () => {
  assert.equal(printable("a\u001b[2Jb\rc\u2028d\u202ee\ufefff\u061cg"), "a?[2Jb?c?d?e?f?g");
  assert.equal(printable("日本語 OK"), "日本語 OK");
});

test("printableLines は改行を残し、行の中だけを無害化する", () => {
  assert.equal(
    printableLines("first\u001b[31m\r\nsecond\u2028x\nthird"),
    "first?[31m\nsecond?x\nthird",
  );
});
