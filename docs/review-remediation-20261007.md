# 全体レビューの修正対応表

対象は main `49eea1d` に対する21項目のレビュー。
以下は統合PRでのコード・文書・回帰テストの対応を示す。
mainへのマージやnpm公開を完了したという意味ではない。

## 対応表

| 指摘 | 修正 | 主な確認箇所 |
|---|---|---|
| 1 | ルートへの scaffold でも相対パスを `.` として保持する | #47、init-root / scaffold-traceability |
| 2 | 未知・コマンド違いの引数と値欠落を処理前に拒否する | #48、CLI引数回帰 |
| 3 | manifest と探索先をリポジトリ内に限定し、特殊ファイルとサイズ超過を拒否する | #49、config-security / manifest-io |
| 4 | 日本語の短縮Outline同義語と通常ScenarioのExamplesを数える | #52、feature-scan-dialects |
| 5 | Git fallbackを探索開始ディレクトリで実行し、root指定の案内を正す | #52、paths-git-fallback |
| 6 | 無変更時は保存せず、hashだけを原文上で置換して原子的に保存する | #53、manifest-persistence / atomic-write |
| 7 | dotenv・認証状態・生成物を scaffold / prepack から除外し、gitignoreを補う | #50、template-secrets |
| 8 | INT/TERMで終了し、EXITで一度だけ後始末する | #51、release-signals |
| 9 | skillの必須キーをテンプレートに揃え、adapter限定・任意fallbackを明示する | template-contract、両config / skill / schema |
| 10 | `?`のリテラル、完全ファイルパス、先頭`./`を正しく扱う | #55、glob-regression |
| 11 | `.feature`というディレクトリを通常ファイルとして開かない | #55、feature-files / feature-directory-cli |
| 12 | GitHub annotationのdataとpropertyを別々にエスケープする | #55、annotation-escaping |
| 13 | sticky commentは正しいActions botの最新マーカーコメントを選ぶ | template-contract、両drift workflow |
| 14 | detectとinit autoの推薦規則を共通化し、workspaceの誤表示を直す | init-detect-review |
| 15 | Flutter SDKの間のコメント・空行を許容し、検出失敗の説明を正す | init-detect-review |
| 16 | Flutter作成手順のproject-nameを同梱pubspecのbdd_testsと一致させる | init-detect-review |
| 17 | 値欠落を拒否し、正当な`..foo`を許可する。実際の親への脱出は禁止する | #48、init-detect-review |
| 18 | 全CLIの対応オプション・解決規則をREADMEに記載する | packages/traceability/README.md |
| 19 | 実装にないwarnings.headingをJSON例から削除する | template-contract、methodology |
| 20 | strict設定を明示し、未使用runner.authDirを削除。Flutter宣言はsetup skillで照合する | template-contract、config-schema |
| 21 | lint・formatter・カバレッジ下限をCI化し、診断文・集計の可変更新・ATX見出し・Node互換を整理する | quality-gates、全既存テスト、heading-commonmark、changelog-section |

## 追加の問題と公開前検証

Dependency Auditの失敗は、lockfile中のsource-map-js 1.2.1が
[GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q)
に該当したため。#54で1.2.2へ限定更新し、監査閾値や失敗判定は変更していない。

Flutterテンプレートには初期manifestもなかったため追加した。
`scaffold-traceability.test.mjs` は同版のローカルtarballをpackし、
Playwright/Flutter × ルート/既定/custom配置で、生成された4コマンドを実行する。
公開前検証ではpackage specだけをtarballへ置換し、ネットワーク利用は禁止する。
registryの未公開版が解決できたと扱わず、npm公開は別の承認された作業とする。

Playwrightテンプレートのlintはechoだけの処理からBiomeの実検査に変更した。
`scaffold-lint.test.mjs` は親Biome設定なし・json・jsoncの3条件で動作を検証し、
不正コードを与えると実際に失敗することも確認する。

## 統合と検証の境界

#47〜#55の修正を同じツリーに統合して検証した。
#49と#53のmanifest.ts競合は、通常ファイル限定の読込みと原文保持保存を両方残して解消した。
統合PRでは既存PRのcommitを親として保持する。既存PR自体を書き換えたりマージしたりはしていない。

Node 24系のGitHub Actionsでtypecheck、build、lint、書式、全テスト、coverage、auditを実行する。
カバレッジの測定対象と固定下限は[品質基準](quality-gates.md)を参照。
一時検証用の書込みworkflow・変換スクリプトは統合PRに含めない。
通常CIの権限はcontents: readのまま維持する。

実際のFlutter/macOSアプリ実行と、認証を伴うブラウザーsmokeは、この検証には含まれない。
consumer固有の仕様・認証・i18nパスは例示値をそのまま真実と扱わず、導入時に明示設定する。
aliasを安全に更新できない場合や同時編集を検出した場合、manifest更新は停止する。
ファイルI/Oの対策はOSサンドボックスや完全な同時実行排他の代替ではない。
