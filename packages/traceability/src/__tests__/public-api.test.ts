import assert from "node:assert/strict";
import { test } from "vitest";

test("PENDING_HASH を FILE_MISSING / SECTION_MISSING と同じく公開する", async () => {
  const api = await import("../index.js");
  assert.equal(api.PENDING_HASH, "PENDING");
  assert.equal(api.FILE_MISSING, "FILE_MISSING");
});
