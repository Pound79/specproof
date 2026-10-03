# 現在の実装対象と残件

S1 はこのブランチで実装済み。公開版 0.2.2 には未配布。S2 は baseline
`origin/main` の `0b2deae1`（0.2.2）で未実装を確認した。
実行の入口は [AGENTS.md](../AGENTS.md)、CLI の現行保証は
[traceability README](../packages/traceability/README.md)。静的集計は実行済み GREEN を認定しない。

## 今回の実装対象

| 工程 | 追加する契約 | 対応ソース |
|---|---|---|
| S1（実装済み・未配布） | phase（draft/pending/complete）と verification（machine/human）を別軸で集計。条件と Outline 展開ケースを区別する。 | `packages/traceability/src/feature-scan.ts`、`stats.ts`、`cli-stats.ts` |
| S2（未実装） | version 1 の `links[].criteria` を任意の string 配列として検証・保持する。 | `packages/traceability/src/manifest.ts`、`update.ts` |

S1 は `@draft`→draft、`@red-contract`→pending、状態タグなし→complete。
verification は `@human`→human、それ以外→machine。complete は静的分類であり GREEN ではない。
Feature/Rule からの状態タグ継承・不正な併記、
JSON と表示の一致を検査する。`@red-contract` を `@fixme` 扱いしない。
従来の fixme/skip 集計、`--strict` の fixme=0、既存の `TOTAL` 行は互換を保つ。

S2 は省略・空配列を許容し、不正型・空文字・制御文字・同一 link 内の重複を拒否する。
同じ条件 ID を複数 link に置ける多対多を維持し、未知キーも load/update/save と
全件/単一 link 更新・dry-run で保持する。ID 書式は既存 consumer 設定との互換を確認して決める。
既存 hash/strict の保証は変更しない。S1/S2 は別 PR とし、配布版更新はその後の別工程。

## 採択済み未実装

[ADR 0008](./adr/0008-flow-layer-separation.md) の `scenarios` ID 台帳、
`@id` の解釈、ID 検証 warning は未実装。S1/S2 の範囲に追加しない。
run 結果・正式 GREEN・時系列・進捗 UI は別ツールの責務という境界は採択済み。

## 従来の残件と未採択案

- 未実装: fixme の最古日付・レビュー周期、`--adapter-dir`。
- 未確認: 外部の本番 Playwright スイートでの dogfood 完了。
- Flutter の現行実行入口・残件は [flutter-readiness](./flutter-readiness.md)。
  Patrol の native 操作・flavor 等の拡張キーは未採択案で、同梱 template/skill は読まない。

## 履歴

完了済み Phase A/B と当時の監査番号・理由は
[旧ロードマップ](./history/2026-07-06-roadmap.md) と
[旧改善バックログ](./history/2026-07-06-improvement-backlog.md) に保存した。
過去の Done や試験数を、現在の実装・実運用の証拠には使わない。
