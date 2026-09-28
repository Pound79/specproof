# フロー層（run 状態・進捗・進捗管理 UI）を specproof から分離し、静的エンジンの境界を維持する

受入条件を分母にした進捗管理（run 結果にもとづくシナリオ状態の認定、時系列の計測、
受入条件一覧の入口ゲート UI）を求める開発フロー側の要求が生じた。これらを specproof に
取り込むかが論点。

specproof の traceability エンジンは静的・決定論的であることを設計の核とし、`stats.ts` にも
「実際に GREEN かは runner の関心事であり、この静的エンジンには分からない」と明記している。
run 結果の解釈・時系列・ホスティングを取り込むことは、このアイデンティティの破壊であり、
「進捗管理だけ欲しいユーザー」に BDD スタック採用を強制する結合にもなる。

そこで**フロー層を別リポの別ツールとして新設**し、specproof は静的正典層に徹する:

- **specproof（静的正典層）が供給するもの**: シナリオの同一性（既定 = ファイルパス + シナリオ
  タイトル、リネーム耐性が必要な箇所は任意の `@id:<value>` タグで上書き）、シナリオ台帳と
  静的センサス（分母）、drift / 整合性シグナル。詳細は下記「契約」節
- **フロー層が担うもの**: run レポートの解釈（シナリオ状態の認定。通過は CI プロファイルの
  実行事実で判定し自己申告を認めない）、時系列（進捗・velocity・健全性）、入口ゲート UI
- **接続はデータ契約経由**: run レポートは標準形式（Cucumber Messages / CTRF）+ プロファイル
  メタデータ。シナリオ台帳・整合性は `ScenarioSource` / `IntegritySource` インターフェースとして
  定義し、specproof はその一実装（アダプタはフロー層側に置く）。specproof は差し替え可能

## 契約

フロー層アダプタが依存してよいのは以下の CLI 出力だけとする。library API（`parseScenarios`
等）は公開契約に含めない（物理分離の規律を内部 import で崩さないため）。

- **シナリオ台帳**: `specproof-stats --json` の各 domain に
  `scenarios: [{ id, path, title, tags }]` を後方互換で追加する（既存の集計フィールドは維持）。
  `path` は正規化した repo 相対 POSIX パス。行番号は編集のたびに動くため同一性に含めない。
- **シナリオ同一性**: `@id:<value>` タグがあればその値、無ければ `path` とタイトルから作る
  fallback ID。括弧は Cucumber の tag expression でグループ化の記号なので書式に使わない。
  - ID の文字列表現は両リポジトリで同じ値を生成するための契約として固定する。どちらも
    Unicode NFC に正規化する（macOS のファイル名は NFD になりうる）。
    - `@id` あり: `<value>` をそのまま使う。
    - `@id` なし: `JSON.stringify([path, title])`。`path` は台帳と同じ正規化済みパス、
      `title` は前後の空白を除き、連続する空白を 1 つの半角スペースにまとめたもの。出力は
      JavaScript の `JSON.stringify` と同じ形（区切りに空白を入れず、非 ASCII 文字を
      `\u` エスケープしない）とする。区切り文字や引用符のエスケープは JSON に任せる。
    - 先頭が `[` の `@id` 値は `invalid-scenario-id` とし、`@id` 値と fallback ID が同じ文字列に
      ならないようにする。
    - 台帳の `title` フィールドは正規化前の元のタイトルを返す。
  - `@id` は Scenario / Scenario Outline に直接付けたタグだけを読み、1 シナリオに最大 1 個、
    value は非空とする。2 個以上・空値・Feature / Rule / Examples への付与は
    `specproof-check` の warning kind `invalid-scenario-id` とし、そのシナリオは台帳上
    `id: null`（フロー層では untracked）になる。Feature に付けると Cucumber のタグ継承で
    配下の全シナリオが同じ ID を持つため、継承したタグは ID として扱わない。
  - 一意性は repo 全体。重複（`@id` の重複と、`@id` の無いシナリオ同士のフォールバック ID の
    衝突の両方）は `specproof-check` の warning kind `duplicate-scenario-id` として報告し、
    `--strict` で失敗させる。
  - `ScenarioSource` アダプタは、台帳に同じ `id` が 2 件以上あれば読み込み自体を失敗させる
    （ID は join key なので、曖昧なまま集計を続けない）。`--strict` なしの check を通った
    台帳でも同じ。`id: null` のシナリオは一意性チェックの対象外とする。
  - `@id` の値を変えたら別シナリオとして扱う（履歴は引き継がない）。
- **run 結果とシナリオ ID の対応**:
  - Cucumber Messages: pickle の `astNodeIds` 先頭が指す Scenario ノード自身の `@id` タグ、
    無ければ pickle の `uri` とその AST ノードの静的タイトルから上記の規則で fallback ID を
    作る。Examples の値が展開された
    `pickle.name` は使わない。`uri` は runner に渡されたパスがそのまま入る（絶対パスや
    Windows の区切り文字もありうる）ため、`file://` を外し、区切りを `/` に揃え、run
    プロファイルのメタデータが示す repository root を基準に repo 相対化してから、台帳の
    `path` と同じ POSIX 正規化をかける。repo root の外を指す `uri` は untracked とする。
  - CTRF: `testId` / `filePath` は任意項目で specproof の ID と一致する保証がないため、
    producer / profile が各 test の `labels.specproofScenarioId` に ID を入れることを必須と
    する。テスト名からの推測はしない。
  - どちらの形式でも ID を取り出せない結果、台帳に無い ID を指す結果は untracked とする。
- **Scenario Outline**: 静的には Outline 1 件を 1 受入条件として数える（`parseScenarios` と
  ADR 0002 の分母に揃える）。フロー層は Examples の全行が通過したときだけその受入条件を
  green と認定する。Cucumber Messages の pickle は Outline の AST ノードを参照するので
  （上記の対応規則）、run 結果から元のシナリオに戻せる。CTRF では同じ
  `specproofScenarioId` を持つ全結果を 1 受入条件にまとめる。
- **整合性の投影**（`specproof-check --json` の結果をシナリオ単位に落とす規則）:
  - ある `linkId` の drift エントリが 1 件でもあれば、その link の `features[]` に含まれる
    全シナリオを untrusted とする（green を認定しない）。
  - `unreviewed-draft`（draft マーカーが残る feature）のシナリオは green にしない。
  - `unregistered-feature` のシナリオは trusted ではなく untracked として扱う。

## Considered Options

- **specproof を拡張して全部入り** — 却下。静的エンジンの設計思想を壊し、リリース周期も対象
  ユーザー（開発者/AI エージェント vs PM）も異なるものを同居させることになる。
- **完全独立（specproof を知らないツール）** — 却下。drift と green の突合（drift している
  シナリオの green を信用しない）というフロー層の品質判定が失われる。
- **monorepo 内の別 package** — 却下。内部 import による境界浸食のリスクと、「specproof 採用が
  前提のツール」という位置づけになる。契約の規律は物理分離で担保する。

## Consequences

- specproof 側の変更は最小で済む: `@id:<value>` タグの解釈、`specproof-stats --json` への
  `scenarios` 台帳の追加、`duplicate-scenario-id` / `invalid-scenario-id` warning の追加、そして stats / check の
  JSON 出力の安定化（フロー層アダプタが依存する公開契約になる）程度。コード変更は後続の
  PR で行い、本 ADR は契約の決定だけを記録する。
- フロー層は将来、specproof 非採用のスタック（別の Gherkin 資産、非 BDD のテスト体系）にも
  アダプタ追加で接続できる。
- 用語衝突に注意: specproof の **Feature**（`.feature` ファイル）と、開発フロー側の
  **feature**（変更・見積もり・分担の単位。複数の `.feature` を含みうる）は別概念。フロー層の
  用語集で明示的に呼び分ける（specproof の "domain" が後者に近い）。
- フロー層の設計本文と用語集はフロー層側のリポジトリで管理し、本リポジトリには置かない。

決定: 2026-07-11。記録のコミットは 2026-09-08。「契約」節の追記: 2026-09-28。
