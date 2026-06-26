# bdd-kit

spec <-> impl <-> feature のトレーサビリティ駆動 BDD フローを、framework 非依存の
3 層（方法論 skill / traceability エンジン / 足場テンプレート）に分離した
振る舞いテスト生成キット。

## Skills

bdd-kit は 6 つの skill を提供する。`bdd-kit` がオーケストレータで、残り 5 つは
内部ムーブメントとして駆動される（単体起動も可）。

| Skill | Direction | Use when |
|-------|-----------|----------|
| `bdd-kit` | orchestrator | BDD フロー全体を駆動する単一入口 |
| `bdd-setup` | detect + scaffold | リポに bdd-kit を導入する |
| `bdd-bootstrap` | impl -> feature draft | 既存コードから .feature ドラフトを生成 |
| `bdd-new-feature` | spec -> feature | 新しい spec セクションから RED な .feature を作成 |
| `bdd-implement` | feature -> impl | blessed .feature を GREEN にする実装 |
| `bdd-sync` | drift -> feature | spec/impl 変更後に .feature を追従 |

## Config

すべての skill は `bdd-kit.config.yaml`（リポルート）から設定を読む。
`{{config:...}}` トークンは skill 実行時にこのファイルの値で解決する。

## Traceability CLI (AI-free)

Drift 検知は決定論的 CLI で、AI を使わない:

```bash
npx -y -p @pound79/bdd-traceability bdd-traceability-check   # drift 検知
npx -y -p @pound79/bdd-traceability bdd-traceability-update  # ハッシュを bless
npx -y -p @pound79/bdd-traceability bdd-traceability-stats   # シナリオ census
```

## Development

```bash
npm ci            # 依存インストール
npm run typecheck # tsc --noEmit
npm test          # vitest run
npm run build     # ビルド
```

## Architecture

- `packages/traceability/` — `@pound79/bdd-traceability`: SHA-256 drift 検知 CLI
- `cli/` — `@pound79/bdd-kit`: scaffold CLI (`bdd-kit init`)
- `plugins/bdd-kit/skills/` — BDD methodology skill 群 (SKILL.md)
- `templates/` — framework 別テンプレート (playwright / flutter)

## Invariants

- **impl -> feature 再生成は一度きりの bootstrap 専用**。継続再生成は同語反復で禁止。
- **feature 本文を黙って書き換えない**。修正は提案のみ。
- **`# bdd-kit: draft` マーカーが残る feature は実装しない**。
- **ブラックボックス厳守**: step 文に内部 API 名・セレクタを書かない。
- **AI は提示し、人間が裁定する**。spec <-> impl の矛盾は人間に返す。
