# specproof への貢献

[English](CONTRIBUTING.md) | 日本語

## 開発環境と検証

Node.js 24 以上を使い、リポジトリ直下で次の順に実行します。ビルドした CLI を起動するテストがあるため、コードを編集したらテストの前にビルドします。

```sh
npm ci
npm run typecheck
npm run build
npm run lint
npm run format:check
npm test
npm run test:coverage
```

整形は `npm run format` です。カバレッジと CI の設定は[品質基準](docs/quality-gates.md)を参照してください。

## 変更を提出する

1. リポジトリを fork し、`fix/...`、`feat/...`、`docs/...` など変更内容に対応するブランチを作ります。
2. 動作を変える場合は先にテストの失敗を確認し、提出前に上の検査を実行します。
3. コミットは `fix: …` など Conventional Commits に従い、変更内容を日本語で書きます。各行は72文字以内、CLI の診断は英語です。
4. PR に関連 issue、変更内容、検証結果を書きます。振る舞いや設計に関わる場合は `docs/adr/` の ADR を参照または追加します。
5. 利用者・貢献者向け文書は同じ PR で日英を更新します。既存の正本の名前を保ち、対訳には `_ja.md` または `_en.md` を付けて相互リンクします。実行用 skill の指示と共用のコード例は一か所で管理します。

npm workspace は `packages/traceability/`（drift 検知）と `cli/`（足場の生成）です。skill は `plugins/specproof/`、アダプターは `templates/`、方法論・設定・設計判断は `docs/` にあります。[用語集](CONTEXT.md)、[公開手順](RELEASING_ja.md)、[行動規範](CODE_OF_CONDUCT_ja.md)も参照してください。

## 公開内容の検査

このリポジトリは公開 OSS なので、私的な名前・手元の検証記録・マシン固有のパスを
追跡しない（方針は [AGENTS.md](./AGENTS.md#公開リポジトリとしての規則)）。

- `npm test` の `scripts/public-content.test.mjs` が、マシン固有のパス、許可していない
  メールアドレス、`docs/evidence/`・`*.local.md`・見本以外の dotenv を検出する。CI でも走る。
- 私的な名前はリポジトリに書くと公開されるため、clone ごとに次のフックを有効にし、
  語彙をリポジトリの外に置く。

```bash
git config core.hooksPath scripts/githooks
mkdir -p ~/.config/git
$EDITOR ~/.config/git/private-terms.txt   # 1 行 1 語。空行と # で始まる行は無視
```

語彙の置き場所は環境変数 `SPECPROOF_PRIVATE_TERMS` でも指定できる。pre-commit は
ステージした各ファイルの内容・パス・名義、commit-msg はメッセージの全文を検査する。
pre-push は送り先の ref 名、送る全コミット、多段の注釈付きタグとその参照先を検査する。
commit を介さず tree や blob を指すタグも対象にし、ref の削除は妨げない。
語彙ファイルが無いときは、省略した旨を表示して通す。

commit-msg は、実効の cleanup を設定値だけでは確定できないため、コメント行や scissors
以降も安全側で検査する。削除予定のコメントや `git commit -v` の差分で拒否された場合は、
私的な語を含めないメッセージファイルを用意して `git commit -F <file>` でコミットする。

語彙の照合は大文字小文字を区別せず、Unicode を NFC に揃えて行う。CI とフックの内容検査は
共通で UTF-8 か BOM 付きの UTF-16 として読み、NUL を理由にファイルを除外しない。
BOM の無い UTF-16 や Shift_JIS のファイルにある語は検出できない。

フックはチェックアウト中のブランチにある `scripts/githooks` を実行する。`npm test` と同じく、
信頼できないブランチでは中身を確認してから commit や push をする。
