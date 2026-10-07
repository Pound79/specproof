import { isDeepStrictEqual } from "node:util";
import { isMap, isScalar, parse, parseDocument, type Scalar, visit } from "yaml";

export const assertScaffoldDirectory = (dir: string): void => {
  if (/[\x00-\x1f\x7f]/.test(dir)) {
    throw new Error("--dir must not contain control characters");
  }
};

/** CDPATH や単独「-」に依存せず、相対配置先を現在地から指定する。 */
export const shellCdCommand = (dir: string): string => {
  const operand = dir === "." ? "." : `./${dir}`;
  return /^[A-Za-z0-9_./-]+$/.test(operand)
    ? `cd ${operand}`
    : `cd -- '${operand.replaceAll("'", "'\\''")}'`;
};

interface ScalarEdit {
  start: number;
  end: number;
  text: string;
}

/** plain のまま書いても同じ文字列として読み戻せるか。 */
const isPlainSafe = (value: string): boolean => {
  if (value === "" || /[\n\r]/.test(value)) return false;
  try {
    return parse(`key: ${value}\n`)?.key === value;
  } catch {
    return false;
  }
};

/** 元の引用形式を保ち、引用が要る値だけ YAML の二重引用符で表す。 */
const renderScalar = (original: string, value: string): string => {
  if (original.startsWith("'")) return `'${value.replaceAll("'", "''")}'`;
  if (original.startsWith('"') || !isPlainSafe(value)) return JSON.stringify(value);
  return value;
};

const editFor = (source: string, node: Scalar, value: string): ScalarEdit => {
  const [start, end] = node.range ?? [];
  if (start === undefined || end === undefined) {
    throw new Error("Template config scalar has no source range");
  }
  const original = source.slice(start, end);
  if (/^[|>]/.test(original)) {
    throw new Error(`Template config block scalar cannot be rewritten: ${original}`);
  }
  return { start, end, text: renderScalar(original, value) };
};

/**
 * 配置パスと shell コマンドの値だけを元テキスト上で差し替える。
 * Document の再出力は節見出しのコメントを直前のノードへ移すため使わない。
 */
export const rewriteScaffoldConfig = (
  source: string,
  templateDir: string,
  targetDir: string,
): string => {
  const document = parseDocument(source);
  if (document.errors.length > 0) throw document.errors[0];
  if (!isMap(document.contents)) throw new Error("Template config must be a YAML mapping");
  const edits: ScalarEdit[] = [];

  for (const key of ["layout", "fixtures", "flutter"]) {
    const section = document.get(key, true);
    if (!isMap(section)) continue;
    visit(section, {
      Scalar(key, node) {
        if (key === "key" || typeof node.value !== "string") return;
        if (
          targetDir !== templateDir &&
          (node.value === templateDir || node.value.startsWith(`${templateDir}/`))
        ) {
          const value = targetDir + node.value.slice(templateDir.length);
          edits.push(editFor(source, node, value));
          node.value = value;
        }
      },
    });
  }

  const commands = document.get("commands", true);
  if (isMap(commands)) {
    const prefix = `cd ${templateDir} && `;
    for (const pair of commands.items) {
      if (isScalar(pair.value) && typeof pair.value.value === "string") {
        if (pair.value.value.startsWith(prefix)) {
          const value = `${shellCdCommand(targetDir)} && ${pair.value.value.slice(prefix.length)}`;
          edits.push(editFor(source, pair.value, value));
          pair.value.value = value;
        }
      }
    }
  }
  if (edits.length === 0) return source;

  const rewritten = [...edits]
    .sort((a, b) => b.start - a.start)
    .reduce((text, edit) => text.slice(0, edit.start) + edit.text + text.slice(edit.end), source);
  // 差し替えた文字列が構文木での更新と同じ値になることを保存前に確かめる。
  if (!isDeepStrictEqual(parse(rewritten), document.toJS())) {
    throw new Error("Template config rewrite did not preserve the intended values");
  }
  return rewritten;
};
