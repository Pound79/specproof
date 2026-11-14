import assert from "node:assert/strict";
import { describe, test } from "vitest";
import { applyAdvisoryExclusions } from "../advisory-exclusions.js";
import type { DriftWarning } from "../check.js";

const impl = (relPath: string): DriftWarning => ({
  kind: "unregistered-impl",
  path: relPath,
  message: `impl ${relPath}`,
});
const heading = (relPath: string, text: string): DriftWarning => ({
  kind: "unregistered-spec-heading",
  path: relPath,
  heading: text,
  message: `heading ${text}`,
});
const others: DriftWarning[] = [
  { kind: "empty-link", linkId: "l", message: "empty" },
  { kind: "duplicate-heading", linkId: "l", path: "docs/a.md", message: "dup" },
];

describe("applyAdvisoryExclusions", () => {
  test("設定が無ければ何も外さず、件数も返さない", () => {
    const warnings = [impl("src/a.ts"), ...others];
    assert.deepEqual(applyAdvisoryExclusions(warnings, {}), { warnings });
  });

  test("外すのは対象の 2 種類だけで、ほかの警告とパスの無い警告は残す", () => {
    const result = applyAdvisoryExclusions(
      [impl("src/__tests__/a.test.ts"), impl("src/a.ts"), heading("docs/a.md", "Roles"), ...others],
      { implExcludeGlobs: ["**/__tests__/**"], specHeadingIgnore: ["docs/a.md"] },
    );
    assert.deepEqual(
      result.warnings.map((warning) => warning.message),
      ["impl src/a.ts", "empty", "dup"],
    );
    assert.deepEqual(result.excluded, { unregisteredImpl: 1, unregisteredSpecHeading: 1 });
  });

  test("見出し単位の指定は、そのファイルのその見出しだけを外す（前後の空白と ./ は無視する）", () => {
    const result = applyAdvisoryExclusions(
      [heading("docs/a.md", "Roles"), heading("docs/a.md", "Rules"), heading("docs/b.md", "Roles")],
      { specHeadingIgnore: [" ./docs/a.md # Roles "] },
    );
    assert.deepEqual(
      result.warnings.map((warning) => `${warning.path}#${warning.heading}`),
      ["docs/a.md#Rules", "docs/b.md#Roles"],
    );
  });

  test("glob の数・長さは implGlobs と同じ上限で止める", () => {
    const tooMany = Array.from({ length: 257 }, (_, index) => `src/${index}/**`);
    assert.throws(
      () => applyAdvisoryExclusions([], { implExcludeGlobs: tooMany }),
      /layout\.implExcludeGlobs: at most 256/,
    );
  });
});
