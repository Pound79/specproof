// specproof-update --record-spec-source: 取り込み元のコミットを manifest の specSources に書く。
// hash の更新と同じく、変える値の範囲だけを書き換えてコメント・空行・ほかのキーを残し、書いた後の内容が
// 意図どおり（specSources の 1 つの値だけが変わった）かを読み直して確かめてから保存する。
// 名前は数値や真偽値に見えても文字列として扱うよう、キーも値も引用して書く。
import { isDeepStrictEqual } from "node:util";
import { isMap, isScalar, parse, parseDocument } from "yaml";
import { writeFileAtomic } from "./atomic-write.js";
import { readManifestFile } from "./manifest-io.js";
import { loadManifest, writeTargetOf } from "./manifest.js";

const YAML_OPTIONS = { logLevel: "error", prettyErrors: false } as const;
const CANNOT_UPDATE =
  "Cannot safely update specSources in the manifest: write it as a block mapping of quoted names to commit ids";

const withRecorded = (raw: string, name: string, commit: string): string => {
  const newline = raw.includes("\r\n") ? "\r\n" : "\n";
  const entry = `${JSON.stringify(name)}: "${commit}"`;
  const document = parseDocument(raw, YAML_OPTIONS);
  if (document.errors.length > 0) throw new Error("Cannot read the manifest as YAML");
  const node = document.get("specSources", true);
  if (node === undefined) {
    const separator = raw.length === 0 || raw.endsWith("\n") ? "" : newline;
    return `${raw}${separator}specSources:${newline}  ${entry}${newline}`;
  }
  // `specSources:`（値が空）の行は、その行のまま mapping にする。
  if (isScalar(node) && node.value === null) {
    const line = /^specSources:[ \t]*(?:#[^\r\n]*)?(?=\r?$)/m;
    if (raw.match(new RegExp(line.source, "gm"))?.length !== 1) throw new Error(CANNOT_UPDATE);
    return raw.replace(line, (found) => `${found}${newline}  ${entry}`);
  }
  if (!isMap(node) || node.flow === true || !node.range) throw new Error(CANNOT_UPDATE);
  const pair = node.items.find((item) => isScalar(item.key) && String(item.key.value) === name);
  if (pair !== undefined) {
    if (!isScalar(pair.value) || !pair.value.range) throw new Error(CANNOT_UPDATE);
    const [start, end] = pair.value.range;
    return `${raw.slice(0, start)}"${commit}"${raw.slice(end)}`;
  }
  // 既存の項目と同じ字下げで、mapping の最後の項目の行の後ろに足す。
  const first = node.items[0]?.key;
  const firstStart = isScalar(first) && first.range ? first.range[0] : undefined;
  if (firstStart === undefined) throw new Error(CANNOT_UPDATE);
  const indent = raw.slice(raw.lastIndexOf("\n", firstStart - 1) + 1, firstStart);
  const lineEnd = raw.indexOf("\n", node.range[1] - 1);
  const at = lineEnd < 0 ? raw.length : lineEnd + 1;
  const prefix = at === raw.length && !raw.endsWith("\n") ? `${raw}${newline}` : raw.slice(0, at);
  return `${prefix}${indent}${entry}${newline}${raw.slice(at)}`;
};

/** manifest の specSources[name] に commit を書く。前に記録していたコミット（無ければ undefined）を返す。 */
export const recordSpecSource = async (
  manifestPath: string,
  repoRoot: string,
  name: string,
  commit: string,
  { dryRun = false }: { dryRun?: boolean } = {},
): Promise<{ previous?: string }> => {
  const original = await loadManifest(manifestPath);
  const raw = await readManifestFile(manifestPath);
  const recorded = original.specSources ?? {};
  const previous = Object.hasOwn(recorded, name) ? recorded[name] : undefined;
  const next = withRecorded(raw, name, commit);
  const expected = { ...original, specSources: { ...recorded, [name]: commit } };
  let parsed: unknown;
  try {
    parsed = parse(next, YAML_OPTIONS);
  } catch {
    throw new Error(CANNOT_UPDATE);
  }
  if (!isDeepStrictEqual(parsed, expected)) throw new Error(CANNOT_UPDATE);
  if (!dryRun) await writeFileAtomic(await writeTargetOf(manifestPath, repoRoot), next, raw);
  return previous === undefined ? {} : { previous };
};
