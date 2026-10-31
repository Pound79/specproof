import { LineCounter, parse, YAMLError } from "yaml";

/**
 * 利用者のリポジトリにある YAML（設定・manifest）を読む。構文エラーはファイルの行を
 * 含めず、メッセージと位置だけの 1 行にする。
 *
 * yaml の既定（prettyErrors）はエラー文に元の行と位置の表示を改行付きで足す。CI の
 * ログでは PR の作者が書いた行がそのまま行頭に出て、GitHub Actions のワークフロー
 * コマンド（`::warning::` など）として読まれうるため使わない。同じ整形は警告
 * （process.emitWarning で stderr に出る YAMLWarning）にもかかるので、警告も整形させない。
 */
export const parseRepositoryYaml = (text: string, name: string): unknown => {
  const lineCounter = new LineCounter();
  try {
    return parse(text, { lineCounter, prettyErrors: false });
  } catch (error) {
    if (!(error instanceof YAMLError)) throw error;
    // yaml 本体の整形と同じく、位置が無い（-1）エラーには位置を付けない。
    const offset = error.pos[0];
    const where =
      offset >= 0
        ? ` at line ${lineCounter.linePos(offset).line}, column ${lineCounter.linePos(offset).col}`
        : "";
    throw new Error(`Failed to parse ${name}: ${error.message}${where}`);
  }
};
