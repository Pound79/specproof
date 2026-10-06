import { isDeepStrictEqual } from "node:util";
import { isScalar, parse, parseDocument, stringify } from "yaml";
import type { TraceabilityManifest } from "./manifest.js";

/** hash の scalar 範囲だけを置換し、コメント・空行・未知の拡張キーを残す。 */
export const replaceManifestHashes = (
  raw: string,
  original: TraceabilityManifest,
  updated: TraceabilityManifest,
): string => {
  const document = parseDocument(raw);
  if (document.errors.length > 0) throw document.errors[0];
  if (!isDeepStrictEqual(document.toJS(), original)) {
    throw new Error("Manifest snapshot does not match the original manifest");
  }
  const edits: { start: number; end: number; value: string }[] = [];
  for (const [linkIndex, link] of updated.links.entries()) {
    for (const side of ["spec", "impl", "features"] as const) {
      for (const [refIndex, ref] of link[side].entries()) {
        const oldRef = original.links[linkIndex]?.[side][refIndex];
        if (oldRef?.hash === ref.hash) continue;
        const scalar = document.getIn(["links", linkIndex, side, refIndex, "hash"], true);
        if (!isScalar(scalar) || !scalar.range || scalar.value !== oldRef?.hash) {
          throw new Error("Cannot safely update an aliased or structurally changed manifest hash");
        }
        const [start, end] = scalar.range;
        const quote = raw[start];
        const value =
          quote === "'"
            ? `'${ref.hash.replace(/'/g, "''")}'`
            : quote === '"'
              ? JSON.stringify(ref.hash)
              : stringify(ref.hash).trimEnd();
        edits.push({ start, end, value });
      }
    }
  }
  const result = edits
    .sort((a, b) => b.start - a.start)
    .reduce((text, edit) => text.slice(0, edit.start) + edit.value + text.slice(edit.end), raw);
  // alias や不正な呼出で hash 以外まで変わるなら書き込まない。
  if (!isDeepStrictEqual(parse(result), updated)) {
    throw new Error(
      "Manifest update must change hashes only; review structural changes separately",
    );
  }
  return result;
};
