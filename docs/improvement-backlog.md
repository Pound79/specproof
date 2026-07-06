# specproof 改善バックログ

> 出典: 方法論監査（8 観点の独立抽出 → 反証検証 → 統合）。
> 各課題は file:line 根拠付きで確認済み。本ファイルは実行可能な改善リストとして書かれた。

> **監査ステータス（最終更新: 2026-07-06）**: 本文（課題の記述内容）は歴史的記録として一切書き換えていない。
> 2026-07-06 の多角的レビュー（`REVIEW.local.md`）で `git log` を精査した結果、**I1〜I22 の全 22 項目が
> v0.1.0 公開前（I21 のみ本セッション内）に実装完了**していることを確認した。各項目の先頭に
> `[Done <short-hash>]` を付記する（複数コミットにまたがる場合は列挙）。根拠は `git show --stat <hash>` で
> 参照できる。ただし「実装済み」は当時の課題文の解決を意味するのみで、同レビューでは対応後の配布物に
> 新たな未配線・不足（C1〜C4・H1〜H6・M2〜M10、`REVIEW.local.md` 参照）が別途見つかっている。
> それらは本バックログの I1〜I22 とは別の新規課題であり、本ファイルのステータス欄には含めていない。

## 北極星を「今この瞬間」ブロックしているもの（最優先）

「`specproof を導入して`」一声の理想は、以下が直っていないと**最初のコマンドで詰む**。

- **I1 (critical)** `[Done: eabf502, 0cceec1]`（npm publish CI 追加 + README/publishConfig 整備。`@pound79/specproof-traceability`/`@pound79/specproof` とも npm registry で v0.1.6 公開確認済み） パッケージ未公開: `@pound79/specproof-traceability` / `@pound79/specproof` が npm で 404。README の git 依存フォールバックも具体構文なし。→ 公開 + CI publish。当面は README に具体的な git-dep ブロックを足して早期採用者を解放。
- **I2 (critical)** `[Done: 0cceec1]`（2026-07-06 レビューで関連の新規指摘 C4「workspaces 前提で repo root から動かない」が別途判明したが、本セッション内で `templates/playwright/specproof.config.yaml` の commands を `cd packages/e2e && ...` 形に修正済み） playwright テンプレに `traceabilityCheck/Update` コマンドが無い。fallback の `npm run traceability:*` スクリプトも未定義 → sync/new-feature が `Missing script` で途中停止。flutter テンプレには正しく入っている。→ playwright config に npx コマンドを明記（flutter と対称化）。
- **I3 (high)** `[Done: 0cceec1, 6822b57]` Node バージョン不整合: README は「20+」だが engines は `>=24`（`.nvmrc` も 24）。smoke は通った後にエンジンエラーで混乱。→ README を 24+ に統一 + テンプレ package.json に engines を追加。

## ノーマティブ文書の矛盾（契約に従うと壊れる）

- **I5 (high)** `[Done: 0cceec1]` `adapter-contract.md §4` が `layout.featuresDir` → `pagesDir` と誤マッピング（エンジンは `layout.pagesDir` を読む）→ ドメイン探索が空に。doc 修正のみ。
- **I6 (high)** `[Done: 0cceec1]` `adapter-contract.md` は snake_case（`traceability_check`）、`config-schema.md`/テンプレは camelCase。契約に従うと静かに壊れる。→ camelCase に統一。
- **I7 (medium)** `[Done: 0cceec1]`（削除ではなく両 doc で「不採用」と明記する形で確定を反映） `adapter-contract.md` がまだ `bdd_widget_test` を有効 runner として列挙（`flutter-readiness.md` は不採用で確定済み）。→ 削除し確定を反映。
- **I8 (medium)** `[Done: 0cceec1]` `driftCount` の意味ズレ: doc は「drift リンク数」、コードは「drift ref 数」（1 リンクで impl+feature drift なら 2）。CI/bot がリンク数を誤集計。→ `driftLinkCount` を追加（既存 API は壊さない）。
- **I13 (medium)** `[Done: ed430cc]`（doc/prompt レベルの分岐 back-port。この課題の性質上エンジン変更は不要） `specproof-sync`/`methodology.md §4` は「impl のみ changed → feature 更新」を**無条件**化。methodology.md §4 の「リファクタなら bless のみ」分岐が欠落 → 純リファクタで人手シナリオ文言を上書きしうる。→ 両正本に分岐を back-port。
- **I16 (medium)** `[Done: ed430cc]` 3 バケットモデルに「環境条件付き」サブタイプ（B-env）が無い。skill は環境タグを別扱いしているのに methodology は 3 分類のまま → Google-OAuth 系を誤って `@skip` に。→ バケット B に B-env を明記。
- **I21 (low)** `[Done: このセッションで対応、未コミット]`（2026-07-06 レビューの M9 で「未実装の疑い」として再指摘されていたが、`plugins/specproof/skills/specproof-implement/SKILL.md` Step 5 に env-absent フォールバック（smoke を SKIPPED(理由) として明示）を追加し解消） `specproof-implement` に「smoke 環境が無ければ generate+typecheck まで＋未実行を明示」フォールバック節が欠落（sync/bootstrap にはある）→ smoke の PASS と SKIPPED が見分けられない。→ 文言を対称化。

## drift エンジンの鋭い縁

- **I9 (medium)** `[Done: 8c427c2, 307f8a6]` 見出しレベルが `## ` ハードコード。`###` を指すリンクは永久に SECTION_MISSING で bless 不能・エラーメッセージも無説明。→ `headingLevel` を設定可能化 + 明確なエラー。
- **I10 (medium)** `[Done: 0cceec1]` `computeHeadingSectionHash` がコードフェンスを追跡しない。spec 内の ```` ``` ```` コード例に `##` 行があると区間が途中で切れ、偽陰性/偽陽性の両方。→ フェンス状態トグル 4 行 + テスト。
- **I11 (medium)** `[Done: 8c427c2]` `specproof-update` に `--link-id` フィルタが無く毎回全 manifest を書き換え → 並行ブランチの bless が構造的に衝突 + クロスブランチでハッシュ汚染の正しさハザード。→ `--link-id` 追加（将来は per-link ファイル分割）。
- **I12 (medium)** `[Done: 7c97b84]` spec/impl/features が全空のリンクが検証を通過し「常に clean」→ 破損エントリが CI から不可視。→ `checkDrift` で warning、`--strict` で error。

## 規律が「文書だけ」で機械的に守られていない

- **I14 (medium)** `[Done: e9b24c3, 58728ec]` bootstrap 再実行ガードも provenance ガードも doc のみ。`cp scratch/x.feature features/x.feature` → `specproof-implement` で**同語反復ループが CI に検知されず完成可能**。→ ドラフトに機械可読マーカー（`# specproof: draft`）を埋め、implement が検出したら停止（マーカー除去＝人間の「査読した」意思表示）。
- **I15 (medium)** `[Done: 3b50ae4]` `@skip`/`@fixme` の理由コメント必須が**自動検証ゼロ**（3 文書で必須と謳うのに linter なし）→ 理由 corpus が sync の度に静かに劣化。→ 軽量 Gherkin lint（理由コメント存在チェック）を CI に。
- **I19 (low)** `[Done: 521ae46]` `@fixme` のレビュー周期・年齢上限・除去ステップが無い。implement の escalation ③ が `@fixme` を増やす一方で減らす経路が無く、`@fixme`(soon) と `@skip`(indefinite) の区別が崩壊。→ 周期を methodology に明記 + `specproof stats`（fixme/skip 件数・最古 fixme 日付）。

## 移植性・拡張性（他チーム展開）

- **I4 (high)** `[Done: 8b32400]`（v0.1.0 公開スカッシュコミット。README に Prerequisites として明記。以前の詳細な開発履歴は公開時に統合されたため、これより前の個別コミットは参照不可） 「spec はリポ内 markdown の `##` 見出し」前提が consumer 向けのどこにも書かれていない（CONTEXT.md にのみ記載）。spec を外部ツール（Notion / Confluence 等）に置く運用では spec-drift が半分静かに無効。→ README に Prerequisites + specproof-setup に specDir 走査の advisory。
- **I18 (low)** `[Done: c11e49f]` specproof-setup が「実装あり → 必ず bootstrap」とルーティングし、**in-repo spec の有無を見ない** → spec があるのに bootstrap して権威の向きが逆転。→ specDir 走査 + 1 問分岐（spec あり→new-feature）。
- **I20 (low)** `[Done: 0cceec1]` flutter テンプレ README に Node.js 前提が無い（traceability は npx 依存）→ Flutter 専業チームが `npx: command not found`。→ Prerequisites 追記。
- **I22 (low)** `[Done: ed430cc]` 第 3 アダプタ追加が CLI の TS ソース 4 箇所改変を要する（`'flutter'|'playwright'` の閉 union 等）。`将来拡張可能` の主張と乖離。→ 拡張手順を文書化 + `--adapter-dir` フラグ。

## 良い点（保全すべき不変条件 — リファクタで失わない）

1. **セクション単位ハッシュ**: 同一 spec doc の無関係セクション変更が他リンクを drift させない隔離不変条件（hash.ts:29-53, test 済み）。
2. **sentinel 自己 bless 不能**: FILE_MISSING / SECTION_MISSING は手編集で bless できない（check.ts:37-38）。
3. **`resolveWithinRoot` のパストラバーサルガード**: sibling ディレクトリ迂回（`/repo/root-evil`）を全 ref に一律適用、専用テスト有。
4. **feature 本文 touch 禁止不変条件**: specproof-implement の最も自然な失敗モードへの主防御を 3 箇所で強化。
5. **scratchDir / featuresDir 分離**: 最悪ケースが「不要ドラフトが残る」で、「blessed feature 破壊」には決してならない。
6. **自己修正 2 回上限 + 構造化エスカレーション**: AI の誤方向固執を防ぎ、出力が具体的で実行可能。
7. **バックエンド言語非依存検出**: PHP/Laravel でも playwright で正しい、を code-backed で実現。
8. **LLM 不使用の決定論 SHA-256 drift**: byte-exact・言い換え攻撃に不感、PR 毎に回せるコスト構造の根拠。
9. **N対N対N の link スキーマ**: 横断的振る舞い（1 link・複数 spec・複数 impl）を第一級で表現。
10. **escalation ③（@fixme/@skip 提案）**: ゲーミングせず緑化不能を正直に降りる出口を 3 バケットに接続（実運用約 4 割で発動）。
11. **environments × projects × tags の 3 軸直交**: 環境ごとに project を増殖させるアンチパターンを構造的に防止。

## 最大リスク Top（採用信頼を最も損なう順）

I1（未公開で全採用者が初手で詰む）→ I2（主アダプタで traceability ループが静かに壊れる＝価値提案の中核）→ I8（drift 集計の誤解釈）→ I9（`###` が永久 SECTION_MISSING・無診断）→ I11（並行 bless 衝突 + ハッシュ汚染）→ I4（spec 前提が事後に判明）→ I5/I6（正本契約の 2 つの誤り）→ I15（理由 corpus の静かな劣化）。

> **2026-07-06 時点の状態**: 上記の最大リスク Top を構成する全項目（I1, I2, I8, I9, I11, I4, I5, I6, I15）は
> 上のステータス欄の通りすべて Done。このリストは対応時点での優先度付けの記録として保全している。
