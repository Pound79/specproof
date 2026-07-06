# specproof

spec <-> impl <-> feature のトレーサビリティ駆動 BDD フローを、framework 非依存の
3 層（方法論 skill / traceability エンジン / 足場テンプレート）に分離した
振る舞いテスト生成キット。

## Skills

specproof は 6 つの skill を提供する。`specproof` がオーケストレータで、残り 5 つは
内部ムーブメントとして駆動される（単体起動も可）。

| Skill | Direction | Use when |
|-------|-----------|----------|
| `specproof` | orchestrator | BDD フロー全体を駆動する単一入口 |
| `specproof-setup` | detect + scaffold | リポに specproof を導入する |
| `specproof-bootstrap` | impl -> feature draft | 既存コードから .feature ドラフトを生成 |
| `specproof-new-feature` | spec -> feature | 新しい spec セクションから RED な .feature を作成 |
| `specproof-implement` | feature -> impl | blessed .feature を GREEN にする実装 |
| `specproof-sync` | drift -> feature | spec/impl 変更後に .feature を追従 |

## Config

すべての skill は `specproof.config.yaml`（リポルート）から設定を読む。
`{{config:...}}` トークンは skill 実行時にこのファイルの値で解決する。

## Traceability CLI (AI-free)

Drift 検知は決定論的 CLI で、AI を使わない:

```bash
npx -y -p @pound79/specproof-traceability specproof-check   # drift 検知
npx -y -p @pound79/specproof-traceability specproof-update  # ハッシュを bless
npx -y -p @pound79/specproof-traceability specproof-stats   # シナリオ census
```

## Development

```bash
npm ci            # 依存インストール
npm run typecheck # tsc --noEmit
npm test          # vitest run
npm run build     # ビルド
```

## Architecture

- `packages/traceability/` — `@pound79/specproof-traceability`: SHA-256 drift 検知 CLI
- `cli/` — `@pound79/specproof`: scaffold CLI (`specproof init`)
- `plugins/specproof/skills/` — BDD methodology skill 群 (SKILL.md)
- `templates/` — framework 別テンプレート (playwright / flutter)

## Invariants

- **impl -> feature 再生成は一度きりの bootstrap 専用**。継続再生成は同語反復で禁止。
- **feature 本文を黙って書き換えない**。修正は提案のみ。
- **`# specproof: draft` マーカーが残る feature は実装しない**。
- **ブラックボックス厳守**: step 文に内部 API 名・セレクタを書かない。
- **AI は提示し、人間が裁定する**。spec <-> impl の矛盾は人間に返す。
