# 設計判断の索引

日本語 | [English](README.md)

各リンクは決定時の原文を指す。後から置き換わった判断と未実装の契約は要旨に記した。

| 原文 | 要旨 |
|---|---|
| [0000 旧名](0000-rename-note.md) | 旧称 bdd-kit は改名前の設計記録に残す。 |
| [0001 仕様がない場合の追跡](0001-spec-absent-two-point-traceability.md) | 人が仕様を確定するための骨子を起こせる。仕様を用意できなければ、実装と feature の二点を追跡し、仕様側の未検査を明示する。 |
| [0002 旧完了定義](0002-done-definition-fixme-skip-split.md) | 当初は自動化待ちと人による確認を別タグで表現した。ADR 0009 がこのタグと完了定義を置き換えた。 |
| [0003 単一の導入入口](0003-single-orchestrator-direction-internal.md) | 利用者は一つのオーケストレータから開始し、既存アプリ・新規開発・仕様の有無に応じた工程を内部で選ぶ。読み取り専用の drift 検知は CLI が担う。 |
| [0004 決定論的な検査](0004-deterministic-strict-enforcement.md) | 構造から判定できる不変条件は CLI で検査する。状態タグの検査内容は ADR 0009 が一部更新した。 |
| [0005 引き継ぎと停止の条件](0005-handoff-report-and-stopping-model.md) | 検証の結果、未実行の理由、人に必要な判断と作業を報告する。草案は一括で準備でき、採用と実装はドメイン単位で人が判断する。タグの扱いは ADR 0009 に従う。 |
| [0006 新規開発の最初の例](0006-greenfield-worked-example-onboarding.md) | 人が選んだ観測可能な振る舞いを仕様、RED、実装、実行まで一つ通す。環境が足りなければ到達点と必要な作業を報告する。 |
| [0007 段階的な導入](0007-phased-rollout.md) | 当時の計画は、互換性を保つ修正、設計変更、既存スイートでの検証の順。現在の進捗はロードマップを参照する。 |
| [0008 静的検査と実行結果の分離](0008-flow-layer-separation.md) | specproof は静的集計と整合性を扱う。実行結果・時系列・進捗 UI は外部ツールが担う。採択したシナリオ ID 台帳は未実装。 |
| [0009 状態タグと完了定義](0009-retire-fixme-skip.md) | 実装待ちは @red-contract、人による確認は @human、受け入れ対象外は理由付きの @out-of-scope で示す。@draft は草案。@fixme・@skip・@fail を禁止する。 |
| [0010 manifest の版と移行](0010-manifest-version-policy.md) | 保存済み hash や既存キーの意味が変わる場合は manifest の版を上げ、移行経路を提供する。意味を保つ検査の厳格化は CHANGELOG の BREAKING に記載する。 |
