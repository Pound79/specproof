# bdd-kit 改善ロードマップ（3 フェーズ）

> 出典: grilling セッション（`CONTEXT.md` + ADR 0001–0007）と方法論監査（`docs/improvement-backlog.md`）。
> 実行順は **バグ → 設計 → 自リポ実証**（ADR 0007）。各設計項目は ADR と監査 issue ID に紐付く。

---

## Phase A — 純バグ・パッチ（即時 / 破壊ゼロ / 設計判断なし）

**目的**: 採用者が README どおりに `npx ... init` → smoke 緑 まで到達できる状態にする。

| issue | 内容 | 対応 |
|---|---|---|
| I1 (critical) | パッケージが npm 404 | 公開 + CI publish。当面 README に具体的 git-dep ブロック |
| I2 (critical) | playwright テンプレに traceability コマンド欠落 | config に npx コマンド明記（flutter と対称化）+ adapter-contract:210 の fallback 文言修正 |
| I3 (high) | README「20+」vs engines `>=24` | 全 README を 24+ に統一 + テンプレ package.json に engines 追加 |
| I5 (high) | adapter-contract §4 が featuresDir→pagesDir 誤マッピング | doc を `layout.pagesDir` に修正 |
| I6 (high) | 契約が snake_case、他は camelCase | 契約を camelCase に統一 + config-schema を正本と明記 |
| I7 (medium) | 契約がまだ bdd_widget_test を有効列挙 | 削除し flutter_gherkin 確定を反映 |
| I8 (medium) | driftCount の意味ズレ | `driftLinkCount` を追加（既存 API 非破壊） |
| I10 (medium) | hash がコードフェンス非追跡 | フェンス状態トグル + テスト |
| I20 (low) | flutter README に Node 前提なし | Prerequisites 追記 |

**受け入れ基準**: 素の他リポで `init → npm install → bddgen → smoke` が通り、`bdd-traceability-check` が clean。

---

## Phase B — v2 設計変更

破壊的 enforcement は「同語反復ゲート」「空リンク」の 2 つに限定。他は加算的 / soft 起点。

### B-1. オーケストレータ統合（ADR 0003）→ 監査 I18, I14
- 単一 `/bdd-kit`: adapter・モード（brownfield/greenfield）・**in-repo spec 有無**を 1 か所で検出（I18）。
- 方向スキル（bootstrap/new-feature/implement/sync）は内部ムーブメントに降格。
- `bdd-drift` スキルは削除、read-only 検知は `bdd-traceability-check` に一本化。

### B-2. 決定論 `--strict` enforcement（ADR 0004）→ 監査 I12, I14, I15, I19
- **ハード**: featuresDir のドラフトマーカー残存（同語反復ファイアウォール, I14）/ 全空リンク（I12）。
- **done でのみハード**: `@fixme` > 0。
- **soft（config でハード化可）**: `@skip`/`@fixme` の理由コメント欠落（I15）。
- `bdd-kit stats`（fixme/skip 件数・最古 fixme 日付, I19）。AI は enforcer にしない。

### B-3. ハンドオフレポート + 停止モデル（ADR 0005）→ 監査 I21
- 固定 6 セクション（やったこと / 検証 PASS-FAIL-SKIPPED / 裁定 / 作業 / 完了ダッシュボード / 次の一手）。
- 可逆作業は一括 + レポート 1 枚、不可逆（bless/implement）はドメイン毎ゲート。
- bdd-implement に env-absent fallback 節を追加（I21、smoke の SKIPPED と PASS を区別）。

### B-4. spec 不在の 2 点運用（ADR 0001）→ 監査 I4
- spec 骨子抽出をデフォルト、無理なら impl↔feature の 2 点運用に正式降格。
- マニフェストは spec 欠落リンクを欠陥でなく正規状態として許容、drift は「spec 側未アンカー」を明示報告。
- README に in-repo markdown spec 前提を明記（I4）。

### B-5. done 定義 + 完了レポート（ADR 0002）→ 監査 I15, I19
- `@fixme`（done で 0）/ `@skip`（要 sign-off）の意味分離。完了ダッシュボードに集計。

### B-6. greenfield ワークエド・サンプル + env 支援（ADR 0006）
- scaffold + env セットアップ支援 + 人間が挙げた 1 振る舞いを env ゲートまで通す。

### B-7. 振る舞い矛盾レンズ（Q2/Q3, CONTEXT 黒箱原則）
- bootstrap と sync が共有する behavior-contradiction lens（観測可能レベルのみ、AI は裁定せず提示）。

### B-8. 設計寄りの監査残務
- I9: `headingLevel` を設定可能化 + SECTION_MISSING の明確なエラー。
- I16: バケット B に環境条件付きサブタイプ（B-env）を明記。
- I13: sync の「impl のみ changed」に「リファクタなら bless のみ」分岐を back-port。
- I11: `bdd-traceability-update --link-id`（将来は per-link ファイル分割）。
- I17: テンプレに `agents:` / `implement:` の雛形ブロック + 未設定時の in-session fallback。
- I22: 第 3 アダプタ拡張手順の文書化 + `--adapter-dir` フラグ。

**受け入れ基準**: 破壊は 2 ゲートのみ。既存ユーザーが段階的に opt-in できる。

---

## Phase C — 本番 E2E スイートで dogfood 実証

- 実在の本番 Playwright スイートで v2 を dogfood する。
- **受け入れ基準**: 既存シナリオが green のまま通る。draft-marker ゲート・`--strict`・完了レポートを
  実データで検証する。

---

## リファクタで失ってはいけない不変条件（監査 strengths）

1. セクション単位ハッシュの隔離（無関係セクション変更が他リンクを drift させない）
2. sentinel（FILE_MISSING / SECTION_MISSING）は手編集で自己 bless 不能
3. `resolveWithinRoot` のパストラバーサルガード
4. bdd-implement の feature 本文 touch 禁止（3 箇所で強化）
5. scratchDir / featuresDir 分離（最悪ケースが「不要ドラフト残存」止まり）
6. 自己修正 2 回上限 + 構造化エスカレーション
7. バックエンド言語非依存の adapter 検出
8. LLM 不使用の決定論 SHA-256 drift
9. N 対 N 対 N の link スキーマ（横断的振る舞いを第一級表現）
10. escalation ③（@fixme/@skip 提案）で緑化不能を正直に降りる出口
11. environments × projects × tags の 3 軸直交
