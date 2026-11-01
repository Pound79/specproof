import { isDeepStrictEqual } from "node:util";
import { isMap, isScalar, parse, parseDocument, type Scalar, visit } from "yaml";
import { printable } from "./display-text.js";

export const assertScaffoldDirectory = (dir: string): void => {
  if (/[\x00-\x1f\x7f]/.test(dir)) {
    throw new Error("--dir must not contain control characters");
  }
};

// printf の書式で、[A-Za-z0-9_./-] 以外の文字を UTF-8 のバイトの 8 進表記にする（POSIX の printf
// が戻す）。表示に危険な文字に加え、%・\・'・!（対話的な bash 3.2 は "$(...)" の中の ' ' の中でも
// 履歴展開する）・$・`・" も画面に出さない。
const printfFormat = (text: string): string =>
  [...text]
    .map((char) =>
      /^[A-Za-z0-9_./-]$/.test(char)
        ? char
        : [...Buffer.from(char, "utf8")]
            .map((byte) => `\\${byte.toString(8).padStart(3, "0")}`)
            .join(""),
    )
    .join("");

/**
 * 配置先へ移る cd のコマンド。CDPATH や単独「-」に依存せず、相対配置先を現在地から指定する。表示に危険な文字（制御文字・行区切り・bidi 制御文字・BOM）を含む
 * 名前は、画面に生の文字を出さずに元の名前を指せるよう、printf で組み立てる形にする。
 */
export const shellCdCommand = (dir: string): string => {
  const operand = dir === "." ? "." : `./${dir}`;
  if (/^[A-Za-z0-9_./-]+$/.test(operand)) return `cd ${operand}`;
  if (printable(operand) !== operand) return `cd -- "$(printf '${printfFormat(operand)}')"`;
  return `cd -- '${operand.replaceAll("'", "'\\''")}'`;
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
    return parse(`key: ${value}\n`, { logLevel: "error" })?.key === value;
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
  // toJS() に警告を emitWarning で直接出させない（キーがコレクションのときなど）。
  const document = parseDocument(source, { logLevel: "error" });
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
  // 比べるためだけの読み直しなので、yaml に警告を stderr へ直接出させない。
  if (!isDeepStrictEqual(parse(rewritten, { logLevel: "error" }), document.toJS())) {
    throw new Error("Template config rewrite did not preserve the intended values");
  }
  return rewritten;
};
