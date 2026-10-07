# 品質チェック基準

レビュー残件対応時に Node 24 と実依存で測定した全ソースの基準値。
全メトリクスの下限を測定値の切り捨てから2ポイント低い値で固定する。
基準は自動更新されない。下限を下げる変更は理由とレビューを要する。
CLIの子プロセスによる機能試験はあるが、Vitestのcoverageに計上されない経路もある。
テストファイルだけを除外し、srcのCLI入口を含めて計測する。

| workspace | 指標 | 実測 % | 下限 % |
|---|---|---:|---:|
| cli | lines | 74.07 | 72 |
| cli | statements | 74.44 | 72 |
| cli | functions | 81.66 | 79 |
| cli | branches | 67.88 | 65 |
| packages/traceability | lines | 86.96 | 84 |
| packages/traceability | statements | 86.36 | 84 |
| packages/traceability | functions | 91.87 | 89 |
| packages/traceability | branches | 83.47 | 81 |

`npm run lint`、`npm run format:check`、`npm run test:coverage` を CI で実行する。
リポジトリの型検査は TypeScript strict。lint は到達不能コード・debugger・曖昧な等価比較を検査する。
Biome は3ルールを明示的に有効化し、formatter は引用符・セミコロン・字下げ・改行を統一する。
生成済みのCLI配布物を使う試験があるため、テスト前に `npm run build` を行う。
Vitest の worker は traceability で最大1、CLI で最大2とする。16コア環境の全体検査で
大きい manifest の解析が既定の5秒を超えたため、検査内容と timeout を維持して
並列数を制限する。concurrency の試験は各ケース内で従来どおり並列処理を検証する。
総参照数の上限試験は20,001参照を維持し、境界と無関係なダミーパス・hashを最小化する。
Node のスクリプト試験も `--test-concurrency=1` でファイルを順に実行する。
シグナル後の復元試験は、Git の呼出を記録 stub に限定して外部 Git 環境に依存させない。
終了コード・復元内容・後続処理の不実行・cleanup 回数は実際の終了経路で検証する。
