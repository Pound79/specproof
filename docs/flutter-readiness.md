# Flutter adapter の現行入口

**現行（0.2.2）**: 同梱 adapter は `flutter_gherkin: 3.0.0-rc.17` と
`build_runner: ">=2.4.0 <2.5.0"` を使用する。日本語 Gherkin 対応を理由に採用し、
`bdd_widget_test` は不採用。2026-06-06 の Flutter 3.44.1 / Dart 3.12.1 での
sample GREEN は当時の観測であり、現在のアプリ・SDK・revision の GREEN を保証しない。

## 現在使える手順と正本

- scaffold: `npx @pound79/specproof init --adapter flutter`。
- SDK/Node の前提、別 `bdd_tests/` package、実行先の作成、依存解決→生成→実行は
  [Flutter template README](../templates/flutter/README.md#セットアップspecproof-init---adapter-flutter-後) が正本。
- async main で生成 runner を直接 await、build/runtime 両方の日本語指定、
  `build.yaml` sources、ASCII 識別子、pin、`.feature` のみ hash する規約も同 README に集約。
- 設定キーは [config-schema](./config-schema.md)、層の境界と Flutter 固有値は
  [adapter-contract](./adapter-contract.md#3-playwright-v1-vs-flutter-の-capability-マッピング対照表)。

## 未完作業と未採択案

Flutter の drift→sync→implement の実アプリ dogfood、専用 idiomGuide は未確認/未整備。
Patrol の tag 伝播、build-only、native 権限、flavor 等は調査案であり、
現在の `flutter:` 設定や実行手順に加えてはならない。

## 履歴

不採用 parser の生成方式と Phase 0 の 9 capability 案は
[調査本文](./history/2026-06-06-flutter-readiness.md) に移動した。
現行の step 実装・必須設定は上記正本から読む。
