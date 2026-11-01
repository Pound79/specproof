import { LineCounter, parseDocument, YAMLError } from "yaml";
import { printable } from "./display-text.js";
import { printErrorText } from "./output.js";

// 位置が無い（-1）エラーには、yaml 本体の整形と同じく位置を付けない。
const formatProblem = (error: YAMLError, lineCounter: LineCounter): string => {
  const offset = error.pos[0];
  const where =
    offset >= 0
      ? ` at line ${lineCounter.linePos(offset).line}, column ${lineCounter.linePos(offset).col}`
      : "";
  return `${error.message.replace(/\s+/g, " ")}${where}`;
};

/**
 * 利用者のリポジトリにある YAML（設定・manifest）を読む。構文エラーはファイルの行を
 * 含めず、メッセージと位置だけの 1 行にする。
 *
 * yaml の既定（prettyErrors）はエラー文に元の行と位置の表示を改行付きで足す。CI の
 * ログでは PR の作者が書いた行がそのまま行頭に出て、GitHub Actions のワークフロー
 * コマンド（`::warning::` など）として読まれうるため使わない。
 *
 * 警告（解決できないタグなど）は、yaml に任せると process.emitWarning で stderr に直接出て、
 * タグ名やキー（PR の作者が書ける）の `##[` が出口（output.ts）を通らない。parse() だけでなく
 * toJS() も（キーがコレクションのとき）警告を出すので、logLevel で yaml 自身の出力を止め、
 * document.warnings をここで 1 行にして出口から出す。
 */
export const parseRepositoryYaml = (text: string, name: string): unknown => {
  const lineCounter = new LineCounter();
  // logLevel "error": toJS() もキーがコレクションのとき警告を emitWarning で直接出すので止める。
  // document.warnings は残り、エラーも従来どおり errors に入る。
  const document = parseDocument(text, { lineCounter, prettyErrors: false, logLevel: "error" });
  for (const warning of document.warnings) {
    // タグ名などに入った制御文字・bidi 制御文字は、ほかの出力と同じく printable で除く。
    printErrorText(printable(`warning: ${name}: ${formatProblem(warning, lineCounter)}`));
  }
  const [error] = document.errors;
  if (error) throw new Error(`Failed to parse ${name}: ${formatProblem(error, lineCounter)}`);
  return document.toJS();
};
