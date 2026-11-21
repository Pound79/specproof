import { describe, expect, it } from "vitest";
import { describeHeadMismatch, describeRecorded } from "../cli-update-format.js";

const commit = "a".repeat(40);
const head = "b".repeat(40);

describe("--record-spec-source の出力の文言", () => {
  it("HEAD が ref と同じ中身なら何も出さない", () => {
    expect(describeHeadMismatch("p", "develop", { repoPath: "/src", head, headMismatch: [] })).toBe(
      undefined,
    );
  });

  it("違うパスと HEAD のコミットを示す", () => {
    expect(
      describeHeadMismatch("p", "develop", {
        repoPath: "/src",
        head,
        headMismatch: ["master", "."],
      }),
    ).toBe(`spec source "p": HEAD (${head}) in /src differs from develop in "master", "."`);
  });

  it("HEAD を解決できないときは、違いでなく解決できないことを示す", () => {
    expect(
      describeHeadMismatch("p", "develop", { repoPath: "/src", headMismatch: ["master"] }),
    ).toBe(
      'spec source "p": HEAD in /src could not be resolved, so it cannot be compared with develop',
    );
  });

  it("制御文字を表示できる形にする", () => {
    const shown = describeHeadMismatch("p", "develop", {
      repoPath: "/src\u001b[31m",
      head,
      headMismatch: ["master"],
    });
    expect(shown).not.toMatch(/\u001b/);
  });

  it("記録したコミットと、前の記録からの変わり方を示す", () => {
    const read = { repoPath: "/src", commit };
    expect(describeRecorded("p", "develop", read, undefined)).toBe(
      `spec source p: develop in /src is ${commit} (first record)`,
    );
    expect(describeRecorded("p", "develop", read, commit)).toBe(
      `spec source p: develop in /src is ${commit} (unchanged)`,
    );
    expect(describeRecorded("p", "develop", read, head)).toBe(
      `spec source p: develop in /src is ${commit} (was ${head})`,
    );
  });
});
