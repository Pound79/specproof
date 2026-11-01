# @pound79/specproof-traceability

[![npm](https://img.shields.io/npm/v/@pound79/specproof-traceability.svg)](https://www.npmjs.com/package/@pound79/specproof-traceability) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

Framework-agnostic **spec ↔ impl ↔ feature** traceability engine for BDD behavior
tests. It detects drift deterministically (no AI) using SHA-256 hashes of your
spec sections, implementation files, and `.feature` files.

Part of [**specproof**](https://github.com/Pound79/specproof). Minimal dependencies (only `yaml`), pure Node.

## Install

```bash
npm i -D @pound79/specproof-traceability
```

Requires Node.js **>= 24**.

## CLI

All commands auto-discover `specproof.config.yaml` / `traceability.yaml` from the repo root.

```bash
npx specproof-check --json     # detect drift (exit non-zero on drift; --strict for lint gates)
npx specproof-update           # bless current hashes (single link: --link-id <id>)
npx specproof-list             # registered domains + bootstrap candidates
npx specproof-stats            # scenario census (phase / verification / out-of-scope; --strict for done gate)
```

- **`check`** compares the current spec/impl/feature hashes against the blessed
  baseline and reports drift per link. `--strict` also fails on unreviewed draft
  markers, all-empty links, `@out-of-scope` scenarios without a reason comment
  (or with `@out-of-scope` inherited from Feature / Rule / Examples), disallowed `@fixme` /
  `@skip` / `@fail` tags, and the structural warnings below
  (`unregistered-impl` and `unregistered-spec-heading` excepted — see below).
- **`update`** re-blesses the manifest hashes after you've reconciled a change.
  Pass `--dry-run` to preview the change list without writing the manifest.
- **`stats`** produces a scenario census and, with `--strict`, enforces the
  static half of the "done" gate: no `@red-contract` and no disallowed `@fixme` /
  `@skip` / `@fail` may remain. A manifest-registered feature that cannot be
  read (checked whether or not `featuresDir` is scanned), or a configured
  `featuresDir` that does not exist, is reported (listed in `--json` as
  `missingFeatures` / `missingFeaturesDir`) and also fails `--strict`, because
  missing input cannot prove that no `@red-contract` remains. GREEN runs and
  human confirmation of `@human` scenarios are outside this static gate.

The done gate only blocks anything where `specproof-stats --strict` is wired
into CI. The bundled drift-check workflow templates run `specproof-check
--strict`, not `specproof-stats --strict`; add the latter to your CI to enforce
done. `@human` scenarios are only counted: completing them needs human
confirmation records, which specproof does not keep — keep them outside
specproof (a team checklist, or an external tool that handles acceptance
criteria).

The state tags (`@draft` / `@red-contract` / `@human` / `@out-of-scope`) are
fixed. There is no tag that switches a broken or flaky test off; it stays red
until fixed. Tags that make the runner skip a scenario or treat its failure as
expected (`@skip` / `@fixme` / playwright-bdd's `@fail`) cannot be used: `check`
reports them as `disallowed-tag` and `stats --strict` fails. A config that sets
`tags.fixme` / `tags.skip` (an alias for such a tag) fails to load, so an
aliased tag cannot slip past these checks.

`@out-of-scope` must be on the scenario itself, with its own reason comment:
inherited from Feature / Rule / Examples it is reported as `missing-reason`,
and on Examples `stats` also rejects it like the other state tags. `stats` also rejects a
scenario that carries both `@out-of-scope` and `@red-contract`.

The runner templates always exclude `@draft` / `@human` / `@out-of-scope` and
never exclude `@red-contract` through their own filters. Positive selection
still applies to `@red-contract` scenarios: a project's `tags` filter (such as
`@admin`), a command-line `--grep`, or the smoke command's
`--grep-invert @slow` selects among them like any other scenario.
`@red-contract @human` (implementation pending, verified by a person) is valid
and is not run by E2E, because `@human` never runs; it stays pending until a
person confirms it and removes the tag.

The Playwright template's config loader rejects an `environments[].excludeTags`
entry that is not a single tag (`/^@[^@\s()]+$/`) or that is a state tag, and a
`projects[].tags` expression that mentions a state tag or has unbalanced
parentheses. The Flutter template refuses a `SPECPROOF_TAGS` expression that
mentions any state tag or has unbalanced parentheses. A command-line
`--grep-invert @red-contract` cannot be blocked by the templates: do not use
it, since it hides pending conditions and makes the run look green.

### 静的な phase / verification とケース数

`stats` の各 domain と totals は `total`（条件数）、`cases`、`phase: { draft, pending, complete }`、
`verification: { machine, human }`、`outOfScope`、`disallowed` を返します。
`disallowed` は使えないタグ（`@skip` / `@fixme` / `@fail`）が付いた条件の数です。
レポート全体の `done` は `@red-contract`（pending）と使えないタグがともに 0 件のとき `true` です。
Outline は条件として1件、ケースは複数 Examples の全データ行を合計します。通常 Scenario は1ケースです。
Playwright の runner と同じく、Examples が無い Outline も1ケースと数えます。
Examples が存在してデータ行が無い場合は0ケースです。Flutter の runner は Examples が無い Outline を拒否します。

同じ実体の feature を複数の link や repo 内のシンボリックリンク経由で登録しても、
lint と census は、それぞれ同じ実体を一度だけ読みます。表示する代表パスの選択規則は異なります。
`check` の lint は manifest の登録順で最初のパスを選び、その登録の `linkId` を警告に残します。
未登録の実体だけを `featuresDir` の探索結果から追加します。
`stats` の census は `featuresDir` があれば探索順、無ければ manifest の登録順で選びます。
たとえば `features/alias.feature` だけを登録し、探索が同じ実体の `features/a.feature` を先に
見つける場合、lint の警告パスは `features/alias.feature`、census の domain は `features/a.feature` です。
別名を未登録や重複シナリオとは判定しません。
manifest の各参照に保存した hash は、それぞれ独立に検査します。

- phase: `@draft` は draft、`@red-contract` は pending、状態タグなしは complete。
- verification: `@human` は human、その他は machine。phase と別軸です。
- phase/verification の状態タグだけを Feature/Rule から継承し、次の Rule には前の Rule の状態を持ち越しません。
- 継承を含む `@draft` と `@red-contract` の併記、同じシナリオでの `@out-of-scope` と `@red-contract` の併記、
  Examples の `@draft` / `@red-contract` / `@human` / `@out-of-scope` はエラーです。Examples 行の状態を条件全体へ投影できないためです。

complete は状態タグなしという静的分類です。実行済み GREEN や正式な完了を示しません。

`outOfScope` と `disallowed` は runner と同じく Gherkin のタグ継承に従い、`effectiveTags`
（Feature・Rule・Scenario 自身・Examples のタグ。空行を挟んだタグも含む）で数えます。
Feature に付けた `@fixme` は配下の全シナリオを disallowed と数え、strict を満たしません。
一部の Examples だけに付いた使えないタグも、残件を見落とさないよう条件全体に数えます。
`@out-of-scope` の条件も `total` と phase/verification には含まれます。`done` の判定には影響しません。

`tags` は Scenario 自身の直前タグを返し、`@out-of-scope` の理由コメントの検査はこの範囲だけで
行います（理由コメントは、空行を挟まずシナリオの直前にある `# ...` 行）。
phase/verification は `effectiveStateTags` を使用します。
表示は domain ごとと TOTAL の 1 行ずつ（`N conditions / C cases; phase: ...; verification: ...;
out-of-scope O`）で、続けて `@red-contract` の残数、使えないタグが残っていれば `tags that switch scenarios off (@fixme / @skip / @fail) remaining: N` で始まる行を表示します。scanner は同梱 adapter の英語・日本語に対応し、閉じていない docstring と、それ以外の言語を
`# language:` で指定した feature は失敗させます。ファイルの言語は Feature 行のキーワードで決め、
その言語のキーワードだけを要素と step として読みます（runner も自分の言語で Feature 行を読めた
ときだけ解析するため）。`specproof.config.yaml` の `adapter` が `flutter` のときは、Flutter の runner
（Dart の gherkin）と同じ規則で読みます（キーワードの大文字小文字を区別しない、Rule が無いなど）。
宣言の無い feature は設定の `language` を既定の言語として読みます。runner が解析できない feature と、
Dart の gherkin が 1 つのタグとして読む空白を含むタグ（`@out-of-scope # 理由` など）は、
0 件や無効なタグとして通さず失敗させます。タグ行は Gherkin と同じく、空白に続く `#` 以降を
除いて `@` で区切ります（`@smoke@human` は 2 つのタグ）。
[ADR 0008](https://github.com/Pound79/specproof/blob/main/docs/adr/0008-flow-layer-separation.md)
で決めたシナリオ ID 台帳はまだ実装しておらず、この統計には含まれません。

### Structural warnings (`check`)

Alongside drift, `check` reports non-drift structural advisories under
`warnings[]`. They never affect `clean`/`driftCount`, and are shown but not
failing unless `--strict` is passed:

| `kind` | meaning |
|---|---|
| `empty-link` | a link whose `spec`/`impl`/`features` are all empty |
| `unreviewed-draft` | a feature still carries the specproof bootstrap draft marker |
| `missing-reason` | an `@out-of-scope` scenario has no reason comment (its own tags only), or `@out-of-scope` is inherited from Feature / Rule / Examples — put `@out-of-scope` on each scenario with a reason comment |
| `disallowed-tag` | a scenario carries a tag that makes the runner skip it or expect its failure (`@fixme` / `@skip` / `@fail`), including one inherited from Feature / Rule / Examples |
| `unregistered-feature` | a `.feature` file under `featuresDir` that no link registers |
| `features-dir-unset` | a config file exists but sets no `layout.featuresDir`, so `.feature` files that no link registers are not scanned (no warning when there is no config file) |
| `features-dir-missing` | `featuresDir` is set but is not an existing directory, so `.feature` files that no link registers are not scanned |
| `unknown-config-key` | `specproof.config.yaml` has a key that no consumer (this engine, the skills, the templates) reads, such as a misspelt `layout.featureDir`; the message names the key path, never its value (rule: [docs/config-schema.md](../../docs/config-schema.md#未知のキー)) |
| `unregistered-spec-heading` | a heading in an already-referenced spec file that no link registers |
| `unregistered-impl` | a file matching `layout.implGlobs` that no link's `impl[]` registers |
| `duplicate-heading` | a registered heading appears more than once in its spec file, making the section hash ambiguous |
| `missing-then` | a scenario has no Then step, so it passes without checking anything |
| `duplicate-scenario` | a scenario has the same Background and the same steps (table and docstring arguments included) as an earlier one, under any name and in any feature |
| `step-order` | a step goes back to Given/When after a later keyword (And/But read as the previous keyword) |
| `duplicate-scenario-name` | two scenarios in the same feature file and the same `Rule` share a name |
| `possible-contradiction` | a scenario has the same Given/When as an earlier one but different Then steps — a candidate for a human to judge |

`unregistered-impl` requires `layout.implGlobs` to be set (opt-in; unset means
no scan at all), and it does **not** fail under `--strict` unless the config
also sets `strictUnregisteredImpl: true` — an implementation tree can produce
a lot of unregistered matches, so hard-failing on it is opt-in.

`unregistered-spec-heading` also does **not** fail under `--strict` by
default; set `strictUnregisteredSpecHeadings: true` to opt in. Scoping the
scan to already-registered spec files still isn't false-positive-free in
practice — a real spec doc often mixes several domains' headings with
intentionally-unlinked sections (revision history, glossary, non-behavioral
notes) in one file.

`missing-then`, `step-order`, `duplicate-scenario-name` and `duplicate-scenario`
do **not** fail under `--strict` by default; set `strictFeatureLint: true` to opt in, so existing suites keep
passing until a repo fixes them. `possible-contradiction` never fails: two
scenarios may split assertions on purpose, so only a human can tell a real
contradiction. Scenarios with Examples are left out of the duplicate and
contradiction comparison, and so are Scenario Outlines. Scenarios written only
with `*` / And / But steps are not checked for `missing-then` or `step-order`
(their step types are unknown), and `@out-of-scope` scenarios are not
checked for `missing-then`. At most 10
`possible-contradiction` warnings are printed; `--json` has them all.
Likewise at most 20 `unknown-config-key` warnings are printed and annotated
(a config file is PR-controlled); `--json` and the `--strict` verdict use all of them.
Past 100 unknown keys the scan stops and one more warning (with
`truncated: true`) says so; that warning is always printed. Each key path in a
message is cut to 200 characters, ending with `…`.

Because `unregistered-impl` / `unregistered-spec-heading` don't escalate
under `--strict` without their opt-in flags, `check --json` annotates every
entry in `warnings[]` with a `failsUnderStrict: boolean` — the effective
verdict for that warning's `kind` given the resolved config, independent of
whether this run actually passed `--strict`. Non-JSON output labels each
warning line the same way: `[warning]` when `failsUnderStrict` is `true`,
`[advisory]` when it's `false`. This lets a CI comment (or any other `--json`
consumer) separate hard failures from noise instead of showing every warning
as if it blocks the check.

### `--dry-run` output example

```
$ npx specproof-update --dry-run
login impl src/login.ts: a1b2c3d4 -> e5f6a7b8
history spec docs/spec.md § 2. History: PENDING -> 9c8d7e6f

Dry run — manifest not modified.
```

With no drift to bless: `No hash changes; manifest already up to date.`

### CRLF / BOM normalization

File content is normalized before hashing, heading-parsing, and draft-marker
detection: a leading UTF-8 BOM is stripped, and `\r\n` is normalized to `\n`.
This means a file's hash no longer depends on its line-ending style or a BOM
— useful on Windows / `autocrlf` checkouts. **This is a breaking change** for
a manifest whose blessed hashes were computed against CRLF content before this
normalization existed: those refs will show as drifted on the next `check`.
Run `check` to see what changed, review it, then `specproof-update` to
re-bless.

### ATX 見出しの互換性

見出し一覧は前後の空白と末尾の閉じ `#` を除いた CommonMark の見出し名を返す。
旧版が返した `Account ##` のような表記も、既存 manifest の参照として読み取れる。
文書内に旧表記の完全一致があればそれを優先し、なければ正規化した名前で照合する。
たとえば `## Account ##` と `## Account ## ##` が共存するとき、旧参照 `Account ##`
を後者へ黙って移動させない。重複見出しの検査は正規化した名前で行う。
hash は文書中の実際のセクションから計算し、保存済みの基準を自動更新しない。

### Manifest の保存と同時更新

`specproof-update` は変更した hash の値だけを原文へ反映し、コメント・空行・引用符・
未知の拡張キーを保持する。変更ゼロと `--dry-run` では保存しない。
更新は同じディレクトリの一時ファイルを完成させてから rename し、途中失敗で元ファイルを
破断させない。hash 以外まで変わる YAML alias は、安全に保存できないため拒否する。

読込後の変更は保存前に検査するが、検査と rename は OS レベルの compare-and-swap
ではない。同じ manifest への更新は順に実行する。異なる `--link-id` でも同時実行すると、
両方が成功したまま一方の hash 更新が失われる可能性がある。

### Manifest の版

manifest の `version` は、外部の読み手に向けた契約である。保存済みの hash の意味、既存のキーの
意味・型、必須のキー、番兵の値のいずれかを変えるときに上げる。省略できるキーの追加でも、既存の
キーの意味を変えるなら上げる。無視しても既存のキーの意味が変わらない追加では上げない。
規則と理由は [ADR 0010](https://github.com/Pound79/specproof/blob/main/docs/adr/0010-manifest-version-policy.md)。

この specproof が読み書きするのは version 1 だけ。知るより新しい version の manifest は、新しい
specproof が書いたものとして、specproof の更新を促すエラーで止まる（旧い規則で hash を取り直さない）。
旧い version からの移行の経路は、version を上げる変更と同じリリースで `specproof-update` に入れる。

### Manifest の criteria

0.3.0 以降、version 1 の各 `links[]` に `criteria?: string[]` を指定できる。

```yaml
version: 1
links:
  - id: login
    label: Login
    criteria: [AC-001, TC-1A-05-01]
    spec: []
    impl: []
    features: []
```

省略と空配列を許容し、両者を区別して保持する。各 ID は空でない不透明文字列で、
AC / TC 等の形式を固定せず、空白除去・大文字小文字変換・Unicode 正規化も行わない。
consumer 固有の ID 書式は consumer の設定が検査する。
不正型、空文字、C0 / DEL / C1 制御文字、Unicode の行区切り・段落区切り、
同じ link 内の ID 重複は拒否する。同じ ID を複数 link から参照する多対多は許容する。

`loadManifest` と、それを使う check/update は criteria を検査する。
`saveManifest` も新しい criteria の契約だけを書込み前に検査し、不正なら既存ファイルを変えない。
他の既存フィールドの形は従来どおり loader が検査する。
load/update/save、全件更新、`--link-id`、`--dry-run` で criteria とオブジェクトの未知キーを
保持する。dry-run はファイルの byte を変えない。update は YAML コメントと書式も保持する。
低レベルの `saveManifest(path, manifest)` は新規 YAML を生成する。
原文を保持した hash 更新には `loadManifest` の戻り値を第3引数の `original` に渡す。

criteria は条件と参照 link の対応であり、シナリオ ID 台帳・実行済み GREEN の証跡ではない。
hash と strict の検査は従来のまま行う。上の空参照の例は `check --strict` の empty-link に該当する。

### Manifest safety limits

Manifest paths are checked against the physical repository root immediately
before hashing. A symlink is accepted only when its resolved target stays inside
that root; pre-existing escaping or dangling symlinks are rejected. This check
does not provide an OS-level lock against another process replacing a path
after validation.

To keep pull-request CI predictable for untrusted manifests, the loader applies
these limits:

- manifest file: 8 MiB
- links: 10,000
- references: 1,000 per link and 20,000 total
- path: 4,096 characters; id: 256; label/heading: 1,024
- link `id` must not contain control or separator characters (like criterion
  IDs); a link `label` and a spec reference's `heading` must not either, except
  a horizontal tab (a Markdown heading line can hold one, and older manifests
  stored it as-is). Trailing line feeds of a `label` (as YAML block scalars
  `label: >` / `label: |` produce) are ignored by this check and kept in the
  file; a line break inside the label is rejected
- each referenced spec / implementation / feature file: 8 MiB, regular files only
  (a FIFO or device is rejected before it is opened); the limit is per file

Other rules the loader and `specproof-update` enforce:

- link `id` values are unique across the manifest
- a spec reference's `headingLevel`, when present, is an integer from 1 through
  6 and selects the heading level matched for its `heading` (default 2)
- `hash` must be a SHA-256 hex digest (64 lowercase hex characters), the
  placeholder `PENDING` for a new reference, or `FILE_MISSING` /
  `SECTION_MISSING` (left by older or hand-edited manifests; `check` always
  reports them as missing). Any other value fails the load, without echoing
  the value. A valid value that differs from the computed hash reads as drift
- `specproof-update` refuses to bless a reference whose file or heading is
  missing; fix the manifest entry instead

The hashes detect changes; they are not a tamper-proof seal. Anyone who can edit
the referenced files can also re-run `specproof-update`, so reviewing the diff
stays the control (see [docs/security-model.md](../../docs/security-model.md)).

`specproof-check` and `specproof-update` preserve manifest order while limiting
file reads to 32 concurrent operations. If a read fails, queued reads are
cancelled instead of continuing unnecessary filesystem work.

## Programmatic API

The package also exposes a typed library surface:

```ts
import {
  checkDrift,
  updateManifestHashes,
  loadManifest,
  buildStats,
  discoverConfig,
} from "@pound79/specproof-traceability";
```

Key exports: `checkDrift`, `updateManifestHashes`, `loadManifest` / `saveManifest`,
`buildStats` / `formatStats`, `buildDomainList`, `discoverConfig`, plus the hash
primitives (`computeFileHash`, `computeHeadingSectionHash`, `FILE_MISSING`,
`SECTION_MISSING`, `DRAFT_MARKER`).

## Documentation

See the [specproof repository](https://github.com/Pound79/specproof) for the full
methodology, config schema, and the adapter contract.

## License

[MIT](./LICENSE) © Pound79

## CLI オプション一覧

| コマンド | 対応オプション |
|---|---|
| specproof-check | --root, --manifest, --strict, --json, --github-annotations |
| specproof-update | --root, --manifest, --link-id, --dry-run |
| specproof-list | --root, --manifest, --pages-dir, --candidate-suffix, --json |
| specproof-stats | --root, --manifest, --strict, --json |

`--root <dir>` は探索ルートを明示する。`--manifest <file>` は cwd 相対で解決するが、
指定した root 内に置く必要がある。`--candidate-suffix <suffix>` は候補の拡張子込み suffix
（例: Page.ts / _page.dart）。`--github-annotations` は GitHub Actions 用の注釈を stderr に出す。
未知の引数・コマンド違いのオプション・値の欠落はエラーで停止する。

失敗したときは stderr に `<command> failed: <message>` を 1 行だけ出し、終了コード 2 で終わる。
メッセージの改行・制御文字は `?` に置き換え、設定や manifest の YAML 構文エラーはファイルの行を
写さずに行と列だけを示す（公開リポジトリの CI ログに、PR の内容で GitHub Actions の
ワークフローコマンドや偽の行を作らせないため）。想定外のエラーのスタックは既定では出さず、
環境変数 `SPECPROOF_DEBUG=1` を付けたときだけ続けて出す（このときは整形前のメッセージも出るので、
公開の CI では付けない）。

テキストと JSON の出力は、GitHub Actions のログでワークフローコマンドとして読まれない形にする。
行頭（空白を除く）の `::` は `?:`、行のどこかにある `##[` は `#?[`（JSON では値を変えずに
`\u0023#[`）と書く。`--github-annotations` が出す `::warning` だけが意図したコマンドになる。

`layout.implGlobs` は `*` / `**` に加えてリテラルのファイルパスと先頭 `./` を受け付ける。
`?` はワイルドカードではなく文字として扱う。
`specproof-update` は変更ゼロなら保存せず、変更した hash だけを原子的に保存する。
コメント・書式を保持し、検出した同時編集や安全に更新できない YAML alias はエラーにする。

CLI の診断メッセージは英語、プロジェクトの説明文書は日本語を基本とする。
