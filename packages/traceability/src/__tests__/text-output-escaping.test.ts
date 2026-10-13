import assert from "node:assert/strict";
import { test } from "vitest";
import {
  describeBothSidesChanged,
  describeLinkHeading,
  describeWarning,
} from "../cli-check-format.js";
import { describeChange } from "../cli-update-format.js";
import { formatDomainList } from "../list.js";
import { buildStats, formatStats } from "../stats.js";

// 端末は CR・ESC で前の出力を上書きし、bidi 制御文字で表示順を入れ替える。
// リポジトリ由来の名前・パス・見出しは、どの CLI のテキスト出力でも ? にして表示する。
const unsafe = "\r\u001b\u2028\u202e\u2066\ufeff";
const shown = "??????";
const UNSAFE_RE = /[\r\u001b\u2028\u202e\u2066\ufeff]/;

test("check の warning は bidi 制御文字と BOM も表示しない", () => {
  assert.equal(
    describeWarning({ kind: "disallowed-tag", message: `scenario "a${unsafe}"` }, true),
    `[warning] scenario "a${shown}"`,
  );
});

test("stats の domain 名を無害化し、行の構成は保つ", () => {
  const output = formatStats(
    buildStats([{ domain: `features/a${unsafe}.feature`, scenarios: [] }]),
  );
  assert.ok(output.includes(`  features/a${shown}.feature: 0 conditions`));
  assert.equal(UNSAFE_RE.test(output), false);
});

test("update の変更行はパスと見出しを無害化する", () => {
  assert.equal(
    describeChange({
      linkId: "id",
      side: "spec",
      path: `docs/a${unsafe}.md`,
      heading: `T${unsafe}`,
      oldHash: "PENDING",
      newHash: "a1b2c3d4e5",
    }),
    `id spec docs/a${shown}.md § T${shown}: PENDING -> a1b2c3d4`,
  );
});

test("list は domain・ラベル・ページ名を無害化する", () => {
  const output = formatDomainList({
    registered: [{ id: `d${unsafe}`, label: `L${unsafe}`, featureCount: 1 }],
    candidates: [{ suggestedDomain: `s${unsafe}`, page: `p${unsafe}.ts` }],
  });
  assert.ok(output.includes(`  d${shown}  L${shown}  (features: 1)`));
  assert.ok(output.includes(`  s${shown}  p${shown}.ts`));
  assert.equal(UNSAFE_RE.test(output), false);
});

test("check の link 見出しと両側変更の行は linkId の bidi 制御文字を表示しない", () => {
  assert.equal(describeLinkHeading(`a${unsafe}b`), `link: a${shown}b`);
  assert.ok(describeBothSidesChanged(`a${unsafe}b`).startsWith(`!! link "a${shown}b": BOTH`));
});
