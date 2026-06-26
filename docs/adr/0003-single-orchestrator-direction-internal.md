# 主インターフェースを単一オーケストレータに統合し、方向ラベルは内部教義に降格する

6 つの方向ラベル付きスキル（setup / bootstrap / new-feature / sync / drift / implement）は
「権威の向き（impl→feature は禁止、feature→impl は正当）」を誤らせないための**内部教義**としては
優れている。しかしそれを**ユーザーインターフェースに昇格**させると、導入者に方向理論の習熟を強い、
実際に学習負債になっていた（監査 I18 の routing 綻び、I14 の provenance ゲートが doc のみ、も同根）。

主インターフェースを**単一オーケストレータ `/bdd-kit`** に統合する:

- adapter・モード（brownfield / greenfield）・**in-repo spec の有無**を 1 か所で検出する。
- モードに応じて内部ムーブメント（bootstrap / new-feature / implement / sync）を駆動する。
- 各人間ゲートで**機械可読に停止**し、「次に決めて／やってほしいこと」を提示する。
- 方向ラベルは methodology の内部不変条件として温存する（背骨は割らない）。
- `bdd-drift` スキルは削除し、read-only 検知は決定論 CLI（`bdd-traceability-check`）に一本化する
  （スキル版は薄いラッパで CLI と重複）。

結果、人間が日常的に打つのは実質「`導入して`」と「`drift 出てるから sync して`」の 2 つに縮小する。

## Considered Options

- **現状の方向ラベル 6 スキルを主インターフェースで維持** — 却下。方向理論の学習負債、
  routing の綻び（I18）、どのスキルをいつ打つかを人間が判定し続ける負担。

## Consequences

- 方向教義（権威の向き）は内部に残るので思想は割れない。
- オーケストレータがゲートを 1 か所に集約するため、機械可読ゲート（ADR 0004 の enforcement 層）を
  仕込む単一地点が生まれる。

## 実装メモ（このコミット時点）

- `/bdd-kit` オーケストレータ skill を新設（単一入口）。
- `bdd-drift` skill は削除し、read-only 検知は決定論 CLI `bdd-traceability-check` に一本化
  （methodology / adapter-contract / README / 各 skill の参照を CLI に更新）。
- `bdd-setup` は「吸収」を**削除でなく内部ムーブメント化**で実現（detect/scaffold ロジックの
  重複を避けるため残置し、オーケストレータが駆動）。frontmatter から「導入して」トリガを外し、
  `/bdd-kit` を単一入口にした。
- 方向スキル（bootstrap / new-feature / implement / sync）と bdd-setup の本文冒頭に
  「内部ムーブメント」注記を追加（単体起動は引き続き可）。
