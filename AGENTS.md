# specproof

spec <-> impl <-> feature のトレーサビリティ駆動 BDD フローを、framework 非依存の
3 層（方法論 skill / traceability エンジン / 足場テンプレート）に分離した
振る舞いテスト生成キット。

## 変更対象から読む

最初にこの入口を読み、対象行の資料・ソースだけを追加で読む。全 ADR・履歴の通読は不要。

| 変更対象 | 現行資料 | 対応ソース |
|---|---|---|
| S1/S2・静的 CLI | [roadmap](docs/roadmap.md)、[traceability README](packages/traceability/README.md) | `packages/traceability/src/`（S1: `feature-scan.ts` / `stats.ts` / `cli-stats.ts`、S2: `manifest.ts` / `update.ts`） |
| 設定・adapter 境界 | [config-schema](docs/config-schema.md)、[adapter-contract](docs/adapter-contract.md) | `packages/traceability/src/config.ts`、`templates/*/specproof.config.yaml` |
| Flutter 実行 | [Flutter template README](templates/flutter/README.md)、[残件](docs/flutter-readiness.md) | `templates/flutter/`、`cli/src/init.ts` |
| skill・BDD 規則 | [methodology](docs/methodology.md)、対象 skill の `SKILL.md` | `plugins/specproof/skills/` |
| scaffold・agent 導入 | [cli README](cli/README.md) | `cli/src/detect.ts` / `init.ts` / `setup-agent.ts` |

ID 台帳は [ADR 0008](docs/adr/0008-flow-layer-separation.md) の採択済み未実装契約。
S1/S2 に追加しない。CLI で実行済み GREEN は判定せず、run は別ツールの責務。
履歴は roadmap のリンク先に保存し、当時の Done を現在の保証として読まない。

## 開発・検証

Node.js 24+。`npm ci` 後、コード変更は `npm run typecheck`、`npm test`、`npm run build`。
文書変更は関連リンク/anchor・CLI/skill/prompt の参照を確認する。
追跡 manifest の spec/hash へ影響する変更を過去 GREEN や凍結値の更新で隠さない。

## 作業規則

main の作業ツリー・既存 PR を保護し、新規 branch で小さい PR に分ける。
機能変更は実際の RED 観測から始め、コードとセキュリティの独立レビュー後に commit する。
会話・新規文書・commit は日本語、絵文字無し。commit は Conventional Commits、全行72文字以内。
本文は heredoc から `git commit -F -` へ渡す。既存 PR 更新・merge・force push は別途指示が要る。
`.env*`・`.npmrc`・鍵は読まず、資格情報は既存注入経路を使用する。不要資料は削除せず移動する。

## Invariants

- **impl -> feature 再生成は一度きりの bootstrap 専用**。継続再生成は同語反復で禁止。
- **feature 本文を黙って書き換えない**。修正は提案のみ。
- **`# specproof: draft` マーカーが残る feature は実装しない**。
- **ブラックボックス厳守**: step 文に内部 API 名・セレクタを書かない。
- **AI は提示し、人間が裁定する**。spec <-> impl の矛盾は人間に返す。
