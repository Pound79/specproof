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
npx specproof-stats            # scenario census (automated / @fixme / @skip; --strict for done gate)
```

- **`check`** compares the current spec/impl/feature hashes against the blessed
  baseline and reports drift per link. `--strict` also fails on unreviewed draft
  markers, all-empty links, missing `@skip` / `@fixme` reason comments, and the
  structural warnings below (`unregistered-impl` and `unregistered-spec-heading`
  excepted — see below).
- **`update`** re-blesses the manifest hashes after you've reconciled a change.
  Pass `--dry-run` to preview the change list without writing the manifest.
- **`stats`** produces a scenario census and, with `--strict`, enforces the
  "done" gate (`@fixme` must be 0). A manifest-registered feature that cannot be
  read (checked whether or not `featuresDir` is scanned), or a configured
  `featuresDir` that does not exist, is reported (listed in `--json` as
  `missingFeatures` / `missingFeaturesDir`) and also fails `--strict`, because
  missing input cannot prove that no `@fixme` remains.

### 静的な phase / verification とケース数

`stats` の各 domain と totals は従来の `total`（条件数）、automated/fixme/skip に加えて、
`cases`、`phase: { draft, pending, complete }`、`verification: { machine, human }` を返します。
Outline は条件として1件、ケースは複数 Examples の全データ行を合計します。通常 Scenario は1ケースです。

- phase: `@draft` は draft、`@red-contract` は pending、状態タグなしは complete。
- verification: `@human` は human、その他は machine。phase と別軸です。
- phase/verification の状態タグだけを Feature/Rule から継承し、次の Rule には前の Rule の状態を持ち越しません。
- 継承を含む `@draft` と `@red-contract` の併記、Examples の `@draft` / `@red-contract` /
  `@human` はエラーです。Examples 行の状態を条件全体へ投影できないためです。

complete は状態タグなしという静的分類です。実行済み GREEN や正式な完了を示しません。

fixme/skip の集計は runner と同じく Gherkin のタグ継承に従い、`effectiveTags`
（Feature・Rule・Scenario 自身・Examples のタグ。空行を挟んだタグも含む）で行います。
Feature に付けた `@fixme` は配下の全シナリオを fixme と数え、strict の fixme=0 を満たしません。
一部の Examples だけに付いた `@fixme` / `@skip` も、残件を見落とさないよう条件全体に数えます。
両方が付いた条件は fixme として数えます。

`tags` は Scenario 自身の直前タグを返し、理由コメントの検査はこの範囲だけで行います。
phase/verification は `effectiveStateTags` を使用します。red-contract 単独は fixme 扱いしません。
表示では従来の `TOTAL: N total / M automated / @fixme F / @skip S` 行を保持し、
新しい統計を別行で表示します。scanner は同梱 adapter の英語・日本語に対応し、閉じていない docstring と、それ以外の言語を
`# language:` で指定した feature は失敗させます。タグ行は Gherkin と同じく、空白に続く `#` 以降を
除いて `@` で区切ります（`@smoke@fixme` は 2 つのタグ）。
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
| `missing-skip-reason` | a `@fixme`/`@skip` scenario has no reason comment |
| `unregistered-feature` | a `.feature` file under `featuresDir` that no link registers |
| `unregistered-spec-heading` | a heading in an already-referenced spec file that no link registers |
| `unregistered-impl` | a file matching `layout.implGlobs` that no link's `impl[]` registers |
| `duplicate-heading` | a registered heading appears more than once in its spec file, making the section hash ambiguous |

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
- path: 4,096 characters; id/hash: 256; label/heading: 1,024

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

`layout.implGlobs` は `*` / `**` に加えてリテラルのファイルパスと先頭 `./` を受け付ける。
`?` はワイルドカードではなく文字として扱う。
`specproof-update` は変更ゼロなら保存せず、変更した hash だけを原子的に保存する。
コメント・書式を保持し、検出した同時編集や安全に更新できない YAML alias はエラーにする。

CLI の診断メッセージは英語、プロジェクトの説明文書は日本語を基本とする。
