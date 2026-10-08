# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.0] - 2026-10-07

### Added

- 静的統計に phase（draft/pending/complete）と verification（machine/human）の
  別軸、Outline の展開ケース数を追加する。条件数とケース数を区別し、
  従来の TOTAL 表示・fixme/skip・strict を維持する。complete は実行済み GREEN を示さない。
- version 1 manifest の `links[].criteria` を任意の不透明な ID 配列として
  検証・保持する。多対多の対応と未知キーを更新・dry-run で維持する。

### Changed

- **`specproof-stats` の fixme / skip の数が増える場合がある。** 集計を runner と同じく
  Gherkin のタグ継承に従わせた。Feature・Rule・Examples に付けた `@fixme` / `@skip` と、
  空行を挟んでシナリオに付けたタグも数える。従来は自身の直前タグだけを見ていたため、
  Feature に `@fixme` があっても fixme=0 と判定し、`--strict` の完了条件を誤って満たした。
  理由コメントの検査範囲は従来どおりシナリオ自身のタグに限る。
- `specproof-stats --strict` は、manifest に登録した feature が読めないときと、設定した
  `featuresDir` が無いときに失敗する。`featuresDir` を集計する場合も、登録済み feature の
  実在を確かめる。従来は欠落したファイルを黙って集計から外し、その中の `@fixme` ごと
  消えて完了条件を満たした。`--json` は `missingFeatures` と `missingFeaturesDir` を出す。
- **feature の scanner が Gherkin と同じ字句規則で読む。** `@smoke@fixme` のように空白なしで
  続けたタグを 2 つのタグとして読み、タグ行の空白に続く `#` 以降をコメントとして除く。
  英語・日本語以外の `# language:` を指定した feature は 0 件として通さず、`stats` と
  `check` をファイル名付きのエラーで止める。従来は runner が skip するシナリオを
  automated と数え、未対応言語の `@fixme` を見落とした。
- **設定値の型の誤りがエラーになる。** traceability エンジンが読む `layout.*`・`tags.*`・
  `strictUnregistered*` に、型の違う値（`implGlobs` に文字列、`"true"` や `yes` の
  真偽値、空文字列、空白を含むタグなど）があると止まる。従来は未設定として扱い、
  `implGlobs` の監査や strict の指定が黙って無効になった。キーの省略と空の値は従来どおり。
  エラーには実際に読んだ設定ファイル名を示し、タグの値は JSON 文字列で示す。
- `specproof-check` は、登録済み feature への別名リンクを未登録と判定しない。登録済みと
  探索結果を実体で照合する。
- `specproof-list` は、`./src/...` のような表記の impl 登録も正規化して照合し、登録済みの
  ページを bootstrap 候補として表示しない。
- `specproof-sync` no longer updates a `.feature` to match the implementation
  when only the implementation changed and its observable behavior changed. It
  now stops, shows the implementation diff with the linked spec section, and
  asks the user whether the change follows the spec before touching the
  feature. Pure refactors are still blessed with a hash update only. This keeps
  `impl → feature` regeneration out of the sync path, so tests do not absorb
  implementation mistakes as expected values.
- `specproof-sync` now defines what happens after that decision: an
  implementation mistake or a needed spec change stops without touching the
  feature or manifest, and only a spec that already requires the new behavior
  lets sync update the feature, with expected values derived from the spec. The
  same rule applies when both spec and implementation changed and the user
  picks the implementation: the spec is updated first. Even after user
  confirmation, the implementation diff is never used as the source of expected
  values. The skill descriptions, `specproof-implement`, `specproof-bootstrap`,
  `docs/methodology.md`, both READMEs and the Playwright / Flutter template
  READMEs now describe `specproof-sync` this way instead of as "reflect the
  implementation diff into the feature".
- **既存の manifest に drift が出る場合がある。** spec 見出しの判定を CommonMark に
  合わせた。字下げ（1〜3 個の空白）やタブ区切りの `##`、空の `##` 行が、節の終わりと
  して扱われるようになった。そうした行が後ろにある節は、旧版とハッシュが変わる。
  内容を確認してから `specproof-update` で bless し直す。登録済みの見出し文字列
  （`Account ##` のような閉じ記号付きを含む）は、旧版と同じく解決する。
- traceability CLI と `specproof` CLI は、未知の引数と値の欠落を処理前に拒否する。
  `--stric` のような誤記で `--strict` が黙って無効になることはなくなった。
  traceability CLI は終了コード 2、`specproof` CLI は 1 で止まる。
  `--` で始まる値と `-h` は次のオプションとみなし、`-page.ts` のような値は受け付ける。
  `specproof init --help` などは使い方を表示して終了する。
- `layout.manifest`・`layout.pagesDir`・`layout.featuresDir` と `--manifest` は、
  manifest の参照と同じく repo root の内側に限る。外を指す設定は拒否する。
  symlink 経由の root と物理パスの manifest の組み合わせは同じ repo として扱う。
- `layout.implGlobs` の `?` はワイルドカードではなくリテラル文字として扱う。
  ワイルドカードを含まないファイルパスと `./` で始まるパターンも照合する。
- `specproof-update` は変更が無いとき manifest を書き込まず、「更新した」とも
  表示しない。変更時はハッシュの値だけを差し替え、コメント・引用符・未知キーを保つ。
  一時ファイル経由で置き換え、実行中の手編集を検知したら書き込まずに止まる。
- Playwright テンプレートに Biome を同梱し、`lint` と `format:check` を実際の
  検査にした。両テンプレートの config に、skill が参照するキーを揃えた。

### Fixed

- `specproof init --dir .` が `cd  &&` や `/features` のような壊れた設定を
  生成していた。設定の書き換えは値の範囲だけを差し替え、節見出しのコメントや
  コメントアウトされた環境例の位置を変えない。
- 日本語 Gherkin の `シナリオテンプレ` / `テンプレ` を集計する。`Scenario:` に
  `Examples` を付けた場合も、展開後のケース数を数える。
- repo root の探索で `git rev-parse` のフォールバックが働いていなかった。
- feature の探索がディレクトリの symlink を辿り、repo 外を走査したりループで
  同じファイルを重複して報告したりしていた。repo 外の実体は読まない。`.feature`
  名のリンクが repo 外やリンク切れなら拒否し、それ以外の名前のリンクは無視する。
  repo 内の別ディレクトリへのリンクは辿る順序によらず一度ずつ数え、同じ実体の
  ファイルは重複させない。`.feature` という名前のディレクトリはファイルとして扱わない。
- symlink の manifest を `specproof-update` で更新できなかった。リンク先の実体を
  更新し、リンクは残す。保存の直前にも、実体が repo 内にあることを確かめる。
- 新規作成した manifest が所有者しか読めない権限（0600）になっていた。
- GitHub annotation の値をエスケープする。
- traceability CLI の引数の誤りは、スタックトレースを付けずに 1 行で知らせる。
- repo 外の絶対パスや、repo 外を指すリンクを経由した参照を拒否するとき、リンク先が
  存在するか・権限があるか・ループしているかで文言を変えない。OS のエラー文も出さず、
  常に「is dangling or resolves outside the repository root」で知らせる。
- `specproof detect` と `init --adapter auto` の推奨を一致させ、pubspec の
  コメント行や Flutter のプロジェクト名を正しく扱う。
- drift-check workflow の sticky comment は、Actions bot が書いたものだけを更新する。
- `scripts/release.sh` は INT/TERM で後続処理へ進まず、後始末を一度だけ最後まで行う。

### Security

- scaffold と npm の配布物から `.env*`・`.npmrc`・`playwright/.auth`・テスト生成物を
  除外する。テンプレートの gitignore も `.env.*`（`.env.example` を除く）を無視する。
- manifest は通常ファイルだけを読み、FIFO やデバイスを拒否する。
- 推移的依存 `source-map-js` を監査指摘の修正版（1.2.2）へ更新した。
- `layout.implGlobs` の照合を正規表現から計算量に上限のある方法に替えた。`*` の繰り返しと
  末尾の不一致を組み合わせたパターンで、照合時間が爆発して CI を止められた。一致の意味は
  従来と同じ。あわせてパターンの数（重複を除き 256）と長さ（1024 文字）に上限を設け、
  同じ base のパターンは 1 回の走査で照合する。
- `specproof.config.yaml` 自体にも manifest と同じ読み取りの境界を適用する。repo 外を指す
  symlink、通常ファイル以外（FIFO・ディレクトリ）、1 MiB を超えるファイルを拒否する。
  従来は FIFO で読み込みが止まり、リンク切れは設定なしとして既定値で動いた。
- manifest の link `id` に改行などの制御文字・区切り文字を拒否する。id は check の報告と
  PR コメントにそのまま出るため、見出しや行を偽装できた。

## [0.2.2] - 2026-09-02

### Added

- A dependency audit workflow now blocks pull requests when `npm audit` finds
  moderate-or-higher vulnerabilities.

### Changed

- Traceability manifest loading now rejects files larger than 8 MiB, more than
  10,000 links, more than 1,000 refs per link or 20,000 refs total, empty/NUL
  paths, and oversized path/id/label/heading/hash fields. File hashing for both
  `check` and `update` is capped at 32 concurrent reads, and queued reads are
  cancelled after the first failure.
- GitHub Actions are pinned to reviewed immutable commit SHAs. Generated
  traceability commands pin `@pound79/specproof-traceability` to the scaffold
  release version, and the release script updates/verifies those pins.

### Fixed

- `specproof init` and `specproof setup-agent` now reject pre-existing symbolic
  links in destination ancestors instead of following them to write outside the
  target repository. Template and skill source walks also reject symbolic links.
- Manifest references now enforce physical repository containment immediately
  before hashing: pre-existing symlinks that resolve outside the repository or
  cannot be resolved are rejected while internal symlinks remain supported.
  Concurrent filesystem replacement after validation remains outside the
  check's threat model.
- Updated the transitive `esbuild` dependency to 0.28.2, resolving the Windows
  development-server arbitrary file-read advisory.

## [0.2.1] - 2026-07-07

### Changed

- Playwright template ships its dotenv sample as `env.example` (no leading dot)
  instead of `.env.example`; `specproof init` restores the dot on scaffold, so
  consumers still get `.env.example`. The dotless name keeps the file
  committable and packable in environments where `**/.env.*` deny rules (secret
  scanners, sandboxes, some CI) would otherwise block reading or publishing it —
  the same reason templates already ship `gitignore` rather than `.gitignore`.

### Fixed

- Playwright template dotenv sample referenced the pre-rename
  `bdd-kit.config.yaml` in a comment; corrected to `specproof.config.yaml`
  (missed by the 0.2.0 rename because the sandbox blocked writing `.env.example`).

## [0.2.0] - 2026-07-06

### Changed

- **BREAKING**: Project renamed from `bdd-kit` to `specproof` (see
  [`docs/adr/0000-rename-note.md`](./docs/adr/0000-rename-note.md)). Package,
  binary, config, and skill names all move to the new prefix:
  - npm: `@pound79/bdd-kit` → `@pound79/specproof`, `@pound79/bdd-traceability`
    → `@pound79/specproof-traceability`.
  - bins: `bdd-traceability-check` → `specproof-check`,
    `bdd-traceability-update` → `specproof-update`,
    `bdd-traceability-list` → `specproof-list`,
    `bdd-traceability-stats` → `specproof-stats`.
  - Claude Code plugin: marketplace/plugin id `bdd-kit` → `specproof`
    (`/plugin marketplace add Pound79/specproof` then
    `/plugin install specproof@specproof`).
  - Skills: single entry point `/bdd-kit` → `/specproof`; internal movements
    `bdd-setup` → `specproof-setup`, `bdd-bootstrap` → `specproof-bootstrap`,
    `bdd-new-feature` → `specproof-new-feature`, `bdd-implement` →
    `specproof-implement`, `bdd-sync` → `specproof-sync`.
  - Config file: `bdd-kit.config.yaml` → `specproof.config.yaml`.
  - Draft marker: `# bdd-kit: draft` → `# specproof: draft`.
  - Env var: `BDD_KIT_ENV` → `SPECPROOF_ENV`.

  **Migration** — old and new names interoperate, so there is no forced flag
  day:
  - Config discovery prefers `specproof.config.yaml` and falls back to
    `bdd-kit.config.yaml` with a one-line stderr deprecation warning
    (`bdd-kit.config.yaml is deprecated; rename it to specproof.config.yaml`);
    rename the file at your convenience.
  - The draft-marker detector recognizes both `# specproof: draft` and the
    legacy `# bdd-kit: draft`; only the new marker is ever generated going
    forward.
  - `SPECPROOF_ENV` takes priority; `BDD_KIT_ENV` is still read as a fallback
    where it applied before.
  - The old packages (`@pound79/bdd-kit`, `@pound79/bdd-traceability`) are
    `npm deprecate`d pointing at their replacements and keep working for
    existing installs. Upgrade at your own pace by installing the new package
    names and switching to the new bin names — no aliases are provided for the
    old bins.
- **BREAKING**: file content is now normalized before hashing, heading
  parsing, and draft-marker detection — a leading UTF-8 BOM is stripped and
  `\r\n` is normalized to `\n`. A manifest whose blessed hashes were computed
  against CRLF or BOM-prefixed content will show those refs as drifted on the
  next `specproof-check`. Migration: run `specproof-check`, review the
  reported diffs (they should be no-op content changes), then
  `specproof-update` to re-bless.

### Added

- `specproof-check` (formerly `bdd-traceability-check`) now detects four
  additional kinds of structural drift, surfaced as `warnings[]` entries and
  shown but not failing unless `--strict` is passed:
  - `unregistered-feature` — a `.feature` file under `featuresDir` that no
    link's `features[]` registers.
  - `unregistered-spec-heading` — a heading in an already-referenced spec file
    that no link's `spec[]` registers (file-limited: only markdown files with
    at least one registered spec ref are scanned). Does **not** escalate under
    `--strict` unless the new `strictUnregisteredSpecHeadings: true` config
    flag is also set — even file-limited, a real spec doc can mix several
    domains' headings with intentionally-unlinked sections (revision history,
    glossary) in one file.
  - `unregistered-impl` — a file matching the new `layout.implGlobs` config
    (self-implemented `*`/`**` glob matcher, no new dependency) that no link's
    `impl[]` registers. Opt-in: skipped entirely when `implGlobs` is unset.
    Does **not** escalate under `--strict` unless the new
    `strictUnregisteredImpl: true` config flag is also set.
  - `duplicate-heading` — a registered heading appears more than once in its
    spec file, making the section hash ambiguous.
- `specproof-check --json`'s `warnings[]` entries now include
  `failsUnderStrict: boolean` — the effective per-warning verdict (does this
  warning's `kind` fail under `--strict`, given the resolved
  `strictUnregisteredImpl` / `strictUnregisteredSpecHeadings` config),
  independent of whether the current run actually passed `--strict`. Non-JSON
  output labels each warning line to match: `[warning]` vs `[advisory]`.
  `checkDrift`/`DriftWarning` stay config-agnostic; the field is attached at
  the CLI output layer only. The Playwright/Flutter `specproof-drift-check.yml`
  workflow templates now split the PR comment accordingly — hard warnings are
  listed under "Warnings (fail under `--strict`)"; advisory warnings collapse
  into a `<details>` block so a large `unregistered-impl` count no longer
  visually equates to a blocking failure.
- `DriftReport.bothSidesChanged`: a list of link ids where both a spec ref and
  an impl ref drifted in the same `check` run — the case `specproof-sync` must
  never auto-resolve, now machine-checkable instead of requiring its own
  grouping logic.
- `specproof-update --dry-run` (formerly `bdd-traceability-update
  --dry-run`): previews the hash changes a bless would make (`<linkId> <side>
  <path>: <old 8 chars> -> <new 8 chars>`) without writing the manifest.
  `update`'s return value now also includes the list of changed refs for
  programmatic callers.

## [0.1.6] - 2026-07-01

### Fixed

- Bumped the Claude Code plugin manifests
  (`.claude-plugin/marketplace.json`, `plugins/bdd-kit/.claude-plugin/plugin.json`)
  to match the published npm version. They were stranded at `0.1.4` while npm was
  already `0.1.5`, so `/plugin install` reported the plugin was "already at the
  latest version" even though the code was current.

### Changed

- Release automation now bumps the two plugin manifests in lockstep with the npm
  workspaces (`scripts/release.sh`), and a new `npm run check:versions`
  (`scripts/check-versions.mjs`) asserts all four version sources agree. It runs
  on every PR (CI), in the release script, and as a pre-publish gate in the
  Release workflow, so plugin/npm version drift can neither merge nor publish.

## [0.1.5] - 2026-06-30

### Fixed

- bdd-kit orchestrator no longer treats a non-JS backend (PHP/Laravel, Go,
  Python, etc.) as a reason a repository is "unsupported". Adapter selection
  follows the observable surface (browser UI → Playwright, Flutter app →
  Flutter), not the server language; the orchestrator entry point now carries
  the same backend-agnostic guard `bdd-setup` documents, and `detect` flags
  `composer.json` / `artisan` as a web-backend signal that raises a Playwright
  candidate.
- Corrected `detect` failure guidance: `ENOVERSIONS` is now diagnosed as an npm
  `min-release-age` cooldown (versions newer than the cooldown window are
  filtered out) rather than a private/scoped-registry problem, with the in-place
  `npx -y --min-release-age=0 @pound79/bdd-kit ...` override documented. The
  public-registry override is kept as a separate branch for genuine `E404`
  cases.

### Changed

- Updated the bundled Playwright template dependencies: `playwright-bdd`
  8.5.1 → 9.2.0, `typescript` 5.9.3 → 6.0.3, and `@types/node`
  22.20.0 → 26.0.1.

## [0.1.4] - 2026-06-28

### Fixed

- `resolveRepoRoot` now correctly handles MSYS / Git Bash paths
  (`/c/Users/...`) on Windows by converting to native format (`C:/Users/...`)
  before `path.resolve()`. Guarded by `process.platform === "win32"` to avoid
  false positives on Unix systems.
- `buildDomainList` now normalises backslash `pagesDir` (`src\pages`) to
  forward slashes so manifest path matching works on Windows.
- Manifest-relative path operations in `list.ts` use `path.posix.join` /
  `path.posix.basename` to make the POSIX convention explicit.
- Build scripts use Node.js `fs.chmodSync` instead of shell `chmod` for
  cross-platform compatibility.
- Printed "Next steps" instructions use platform-neutral wording instead of
  Unix-only `cp` command.
- Added `.gitignore` rules for Flutter scaffold generated files (`.dart_tool/`,
  `.flutter-plugins*`, `pubspec.lock`).

## [0.1.3] - 2026-06-28

### Added

- OpenAI Codex support: bdd-kit is now multi-agent. The existing SKILL.md files
  work with any agent that supports the SKILL.md open standard (Claude Code,
  Codex, Gemini CLI, Cursor, etc.).
- `bdd-kit setup-agent <codex|claude>` subcommand to install skills for a
  specific AI coding agent. `setup-agent codex` copies skills to
  `.agents/skills/` for Codex discovery.
- `bdd-kit init --agent <claude|codex>` flag to tailor the "Next steps" output
  to a specific agent.
- `AGENTS.md` at the repo root — project instructions for Codex (equivalent to
  CLAUDE.md for Claude Code).
- `.agents/skills/` directory with full skill copies for Codex skill discovery.

### Changed

- SKILL.md files are now agent-neutral: Claude Code-specific tool references
  (`AskUserQuestion`) replaced with generic wording.
- `bdd-setup` skill install instructions now cover Claude Code, Codex, and
  manual copy.
- README, README_ja, cli README, CONTRIBUTING, and package.json descriptions
  updated from "Claude Code plugin" to "AI coding agent skills (SKILL.md
  standard)".
- npm tarball now includes `skills/` so `setup-agent codex` works from the
  published package.

## [0.1.2] - 2026-06-26

### Changed

- `bdd-kit init` now leads its "Next steps" with the recommended Claude Code
  plugin flow (`/plugin marketplace add` → `/bdd-kit`), with the manual setup
  steps shown as the alternative.
- Fixed the Flutter "Next steps" hint to reference the actual scaffold directory
  instead of a hard-coded `bdd_tests/` path.

- README quick start now leads with the plugin-only path — `/bdd-kit` scaffolds
  the config and e2e package itself, so no manual `npx ... init` or hand-placed
  config is needed. The CLI scaffold is documented as an optional standalone path.

## [0.1.1] - 2026-06-26

### Added

- Per-package READMEs for `@pound79/bdd-traceability` and `@pound79/bdd-kit` so
  the npm package pages render documentation.

## [0.1.0] - 2026-06-26

Initial public release.

### Added

- `@pound79/bdd-traceability` — framework-agnostic, minimal-dependency spec ↔ impl
  ↔ feature traceability engine with SHA-256 drift detection, scenario census
  (`stats`), and configurable heading levels and tags.
- `@pound79/bdd-kit` — `bdd-kit init` scaffolder for Playwright (web) and
  Flutter (`flutter_gherkin`) adapters.
- Claude Code plugin with `bdd-*` skills (bootstrap / new-feature / sync /
  implement) driven by a single `bdd-kit.config.yaml`.
- Documentation: methodology, adapter contract, config schema, and ADRs
  0001–0007.
- Community health files (CONTRIBUTING, CODE_OF_CONDUCT, SECURITY), issue/PR
  templates, Dependabot, and CODEOWNERS.

[Unreleased]: https://github.com/Pound79/specproof/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/Pound79/specproof/compare/v0.2.2...v0.3.0
[0.2.2]: https://github.com/Pound79/specproof/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/Pound79/specproof/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/Pound79/specproof/compare/v0.1.6...v0.2.0
[0.1.6]: https://github.com/Pound79/specproof/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/Pound79/specproof/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/Pound79/specproof/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/Pound79/specproof/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/Pound79/specproof/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/Pound79/specproof/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/Pound79/specproof/releases/tag/v0.1.0
