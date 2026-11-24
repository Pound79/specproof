# @pound79/specproof-traceability

English | [日本語](https://github.com/Pound79/specproof/blob/main/packages/traceability/README_ja.md)

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
npx specproof-check --json
npx specproof-list
npx specproof-stats
```

After reviewing every change to the selected link, preview and bless its hashes:

```bash
npx specproof-update --dry-run --link-id login
npx specproof-update --link-id login
```

- **`check`** compares the current spec/impl/feature hashes against the blessed
  baseline and reports drift per link. `--strict` also fails on unreviewed draft
  markers, all-empty links, `@out-of-scope` scenarios without a reason comment
  (or with `@out-of-scope` inherited from Feature / Rule / Examples), disallowed `@fixme` /
  `@skip` / `@fail` tags, and the structural warnings below
  according to the policy below.
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
  It also lists open spec questions: scenarios tagged `@question:<ID>`
  (directly or inherited from Feature / Rule) depend on a question the spec
  has not answered yet. They are grouped by ID with the number of scenarios and
  the feature files (`--json`: `questions: [{ id, scenarios, features }]`;
  `scenarios` counts conditions, so a Scenario Outline counts once; IDs are
  case-sensitive and must not contain spaces), so
  that when the answer comes you can find the scenarios to revisit. The tag is
  not a state tag: it does not change what runs or the done gate. Remove it
  when the scenario has been updated to the answer.

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
`@admin`), a command-line `--grep`, or the smoke command's exclusion of the exact
configured `tags.slow` tag selects among them like any other scenario.
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


<a id="静的な-phase--verification-とケース数"></a>
### Static phase, verification and case counts

Each domain and the totals return `total` conditions, `cases`, `phase: { draft, pending, complete }`, `verification: { machine, human }`, `outOfScope` and `disallowed`. The CLI sets `done` to false for pending conditions, prohibited tags or missing input (a configured feature directory or a registered feature). The static gate does not verify a real GREEN run or a human sign-off.

A Scenario counts as one case. A Scenario Outline counts as one condition and as many cases as there are data rows across its Examples. An empty set of Examples rows contributes zero. With no Examples, Playwright counts one case and Flutter rejects the outline.

Lint and census read each physical file once, including aliases through links within the repository. Check chooses the first registered path in manifest order and keeps that link ID on the warning, then adds unregistered files from discovery. Stats scans `featuresDir` first, then adds any registered physical files still unseen (including outside that directory) in manifest order. Without a feature directory it starts from the manifest. Thus a registered alias can label a lint warning while the first discovered physical path labels the census domain. Aliases do not create unregistered files or duplicate scenarios. Each manifest reference retains its own hash check.

- `@draft` sets phase draft, `@red-contract` sets pending, otherwise phase is complete. `@human` selects human verification, otherwise machine.
- Phase and verification inherit state tags from Feature and Rule. A later Rule starts a new Rule scope. Combining draft with pending, or out-of-scope with pending, is an error. Examples cannot carry state tags; a row's state cannot represent an entire condition.
- `outOfScope` and `disallowed` use runner-effective tags from Feature, Rule, Scenario and Examples, including tags separated by blank lines. A prohibited tag on any Examples counts the condition once. Out-of-scope conditions still appear in the totals and both axes.
- `tags` contains a scenario's own leading tags. Check the reason for excluding a scenario there: a `# ...` comment immediately preceding the scenario without a blank line. Phase and verification use `effectiveStateTags`.

Text prints one row per domain and a total (`N conditions / C cases; phase: ...; verification: ...; out-of-scope O`), followed by pending and prohibited counts. English and Japanese features are supported. An unsupported language directive or unterminated docstring fails. The parser recognizes elements and steps in the dialect of the Feature keyword. Flutter uses the configured default language without a directive and the Dart runner's case-insensitive keywords and absence of Rule. Unparseable features and Dart whitespace-containing tags such as `@out-of-scope # reason` fail. In ordinary Gherkin a whitespace-delimited inline comment is removed and tags split at `@` (so `@smoke@human` is two tags). The scenario ID ledger in [ADR 0008](https://github.com/Pound79/specproof/blob/main/docs/adr/0008-flow-layer-separation.md) remains unimplemented.

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
| `unknown-config-key` | `specproof.config.yaml` has a key that no consumer (this engine, the skills, the templates) reads, such as a misspelt `layout.featureDir`; the message names the key path, never its value (rule: [docs/config-schema.md](https://github.com/Pound79/specproof/blob/main/docs/config-schema_en.md#unknown-keys)) |
| `unregistered-spec-heading` | a heading in an already-referenced spec file that no link registers |
| `unregistered-impl` | a file matching `layout.implGlobs` that no link's `impl[]` registers |
| `duplicate-heading` | a registered heading appears more than once in its spec file, making the section hash ambiguous |
| `missing-then` | a scenario has no Then step, so it passes without checking anything |
| `duplicate-scenario` | a scenario has the same Background and the same steps (table and docstring arguments included) as an earlier one, under any name and in any feature |
| `step-order` | a step goes back to Given/When after a later keyword (And/But read as the previous keyword) |
| `duplicate-scenario-name` | two scenarios in the same feature file and the same `Rule` share a name |
| `possible-contradiction` | a scenario has the same Given/When as an earlier one but different Then steps — a candidate for a human to judge |
| `spec-source-outdated` | With `--spec-sources`, selected upstream paths changed since import or are absent at the current ref. |
| `spec-source-unrecorded` | A configured import has no recorded commit. |
| `spec-source-unresolved` | The configured source directory exists but its repository, ref, recorded commit or tree could not be checked. |

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
message is cut to 200 characters, ending with `…`. At most 20
`unregistered-impl` warnings are printed and annotated. Every other kind is
always printed in full. When a capped kind goes past its limit, the text output
adds one line per kind, such as
`...and 681 more unregistered-impl (shown 20 of 701; run with --json for the full list)`.

The text output and annotations also leave out `unregistered-impl` warnings
for files that look like tests or generated files (`*.test.*`, `*.spec.*`,
`__tests__/`, `__mocks__/`, `*_test.dart`, `*.g.dart`, `*.freezed.dart`,
`*.mocks.dart`), and print one line with their count instead. Pass
`--include-tests` to list them. `--json` and the exit code always include them,
and they are listed whenever `strictUnregisteredImpl: true` makes them fail
under `--strict`. To stop counting them at all, set `layout.implExcludeGlobs`
(`specproof init` writes the usual globs for the detected framework).

Because `unregistered-impl` / `unregistered-spec-heading` don't escalate
under `--strict` without their opt-in flags, `check --json` annotates every
entry in `warnings[]` with a `failsUnderStrict: boolean` — the effective
verdict for that warning's `kind` given the resolved config, independent of
whether this run actually passed `--strict`. Non-JSON output labels each
warning line the same way: `[warning]` when `failsUnderStrict` is `true`,
`[advisory]` when it's `false`. This lets a CI comment (or any other `--json`
consumer) separate hard failures from noise instead of showing every warning
as if it blocks the check.

The text output also sorts the warnings into two groups and prints the group
to fix first, under `To fix:` and then `For reference:`, after a one-line count
such as `Warnings: 15 to fix (step-order 15); 30 for reference
(unregistered-spec-heading 24, possible-contradiction 6)` (counted before the
display caps, after leaving out the test-like `unregistered-impl` above). `To fix` holds every kind that fails under `--strict` with the
resolved config, plus the feature authoring mistakes (`missing-then`,
`step-order`, `duplicate-scenario-name`, `duplicate-scenario`) even when they
are `[advisory]`; `For reference` holds `unregistered-impl`,
`unregistered-spec-heading` (unless opted in) and `possible-contradiction`, plus advisory source warnings.
Within `To fix`, the kinds that fail under `--strict` come first. A capped
kind's `...and N more` line is printed at the end of its own group.
`--github-annotations` uses the same order, so the group to fix is not pushed
out of GitHub's per-step annotation limit. `--json` keeps the original order.

### JSON report

Check returns `clean`, `driftCount`, `driftLinkCount`, and `entries` (link ID, side, path, optional spec heading, stored hash, current hash, changed/missing status). Its warnings carry `kind`, message and optional link ID/path; the CLI adds `failsUnderStrict`. If all references are missing files, `allReferencesMissing` is true and `bothSidesChanged` is empty. Otherwise the latter lists links with drift on both spec and implementation. Configured exclusions can add `excludedAdvisories`. See the options below for the conditional history and source fields.

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
Run `check` to see what changed, review it, then `specproof-update --link-id <id>`
for each reviewed link to re-bless (plain `specproof-update` blesses every
drifted link at once).


<a id="atx-見出しの互換性"></a>
### ATX headings

Heading discovery trims whitespace and closing hashes. Existing manifest spellings such as `Account ##` remain valid. An exact legacy match takes precedence over a normalized match, so adding `## Account ## ##` near `## Account ##` does not silently redirect the legacy reference. Duplicate detection uses normalized names. Code fences and HTML comment blocks do not create headings or section boundaries. To preserve the version 1 hash contract, check and update stop with an error if old and current parsing disagree on the start or end of a registered section. Indent the apparent heading inside the comment enough to prevent legacy recognition, or reword it, then review the intended section before updating its link. Unaffected sections retain their existing hash semantics. The hash is based on the actual section; stored baselines are never updated by check.

### Manifest storage and concurrent updates

Update patches only changed hash values in the original YAML, preserving comments, blank lines, quoting and unknown fields. Dry runs and unchanged manifests perform no write. A completed temporary file in the same directory is renamed atomically; aliases that would change other values are refused. A pre-rename check detects intervening changes but cannot provide OS-level compare-and-swap. Serialize updates to one manifest, even when they select different links.

### Manifest version

The version is a public contract. Changing the interpretation of stored hashes, existing key semantics/types, required keys or sentinels requires a version bump. This includes optional additions that alter existing meanings. Ignorable additive fields do not require a bump. The engine reads and writes version 1. A newer manifest requires a newer engine. A future version change must ship an update migration in the same release. See [ADR 0010](https://github.com/Pound79/specproof/blob/main/docs/adr/0010-manifest-version-policy.md).

<a id="manifest-の-criteria"></a>
### Manifest criteria

Since 0.3.0, version 1 accepts an optional `criteria?: string[]` on each link.

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

An absent list and an empty list are distinct and preserved. Each ID is an opaque nonempty string, without trimming, case folding or Unicode normalization. Consumers enforce any AC/TC naming convention. Invalid types, empty values, C0/DEL/C1 controls, Unicode line/paragraph separators and duplicates within a link are rejected. Several links can share an ID.

`loadManifest`, check and update validate criteria. Before writing, `saveManifest` validates the criteria contract; the loader validates other legacy field shapes. Criteria and unknown fields survive load, update, save, link selection and dry runs. Update preserves YAML formatting and comments. To patch original hashes using `saveManifest(path, manifest, original)`, pass the original result of `loadManifest`. Without that argument save generates fresh YAML.

Criteria associate requirements with links. They neither track scenario IDs nor attest execution. The example's empty references trigger `empty-link` under strict.

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
stays the control (see [docs/security-model.md](https://github.com/Pound79/specproof/blob/main/docs/security-model_en.md)).

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


<a id="cli-オプション一覧"></a>
## CLI options


| Command | Options |
|---|---|
| specproof-check | --root, --manifest, --strict, --json, --github-annotations, --since-bless, --spec-sources, --include-tests |
| specproof-update | --root, --manifest, --link-id, --spec-ref, --dry-run, --record-spec-source, --allow-head-mismatch |
| specproof-list | --root, --manifest, --pages-dir, --candidate-suffix, --json |
| specproof-stats | --root, --manifest, --strict, --json |

### Selecting references to bless

`--link-id <id>` selects only that link. Repeat it (`--link-id a --link-id b`) for multiple links. Repetitions of the same ID are collapsed. If any are missing, all missing IDs are reported and nothing is written. One space-separated argument is a single ID.

`--spec-ref '<path>#<heading>'` updates just the spec hash for that section in all selected links. Use it when a shared section changes and you have established that the behavioral contract for those links is unaffected. Repeat the option or combine it with link IDs. Parsing splits at the first hash.

- Unknown or incomplete sections fail the operation. Paths and headings are compared separately. Paths receive POSIX normalization (a leading `./` is immaterial). Stored reference whitespace is preserved. The selector trims only its outside whitespace and rejects whitespace around the separator. Use a link ID for unselectable paths/headings with edge whitespace or paths containing a hash.
- A selector matching headings at multiple depths is ambiguous and fails. Only changed baselines are updated. The affected links must share one stored non-PENDING baseline; otherwise review links individually.
- Links with changed or missing implementation are skipped, reported as `skipped link "<id>"` and produce exit status 1. Resolve the joint spec/impl drift in sync first; blessing just the spec would erase the human decision signal.
- Text check groups sections drifting in two or more links by affected link count (up to ten sections) and suggests the selector without interpolating the path or heading into a command. JSON is unchanged. Library callers pass `specRefs` and receive `skipped` only when requesting such a selection.

### Paths and history

`--root <dir>` overrides root discovery. By default, walk up from cwd to the nearest config (`specproof.config.yaml` or `.yml`) or `traceability.yaml`. When a manifest alone is found, use the nearest ancestor config if its `layout.manifest` resolves to that manifest (e.g. running from `e2e/`). Do not search above a Git root. A config entry, including a broken link or legacy name, at the manifest or intervening level prevents passing it. If every reference file is missing, check reports `allReferencesMissing` and clears `bothSidesChanged`; verify the root and manifest.

Resolve `--manifest <file>` relative to cwd and keep it under the root. `--candidate-suffix` includes the extension (e.g. `Page.ts`, `_page.dart`). GitHub annotations are written to stderr.

With `--since-bless`, check searches the most recent 200 commits touching each drifted path for the newest commit matching its blessed hash. Spec references match the section. The entire operation has a shared budget of 2,000 Git calls and 60 seconds, with a diagnostic if truncated. The suggested diff uses the full commit ID and a top-level literal pathspec (`git diff <commit> -- ':(top,literal)<path>'`); paths unsuitable for a shell command are displayed as data. Uncommitted baselines, renames and shallow history can prevent a match. Follow the physical file for repository-internal symbolic links, including linked parent directories.

For a searched entry, JSON adds `blessedCommit` (possibly null) and `blessedPath` if the path searched differs from the stored spelling, e.g. a symbolic link, absolute path or leading dot. It adds `gitHistoryAvailable` and `blessHistoryIncomplete` to the report when relevant. Clean and all-files-missing results skip history and omit these fields.

Check groups changes to blessed references by first-parent commits from the oldest matching point to HEAD, comparing each commit to its first parent and comparing specs by section. A commit containing the baseline is excluded unless a merge also changed it. Merge/squash commits represent PRs without listing all merged commits. A read or range failure marks the result incomplete. Text shows the latest 20 commits with short ID, sanitized subject (120 characters), changed refs and link IDs. Differences between HEAD and the working tree appear under `(uncommitted)`; ungrouped references have counts by reason. Treat commit subjects as untrusted text.

When history is available, JSON adds `sinceBless: { commits: [{ commit, subject, entries: [{ side, path, linkIds }] }], uncommitted, notGrouped: { noBlessedVersion, notSearched, failed }, incomplete }`. Renderers must sanitize raw JSON subjects. The grouping and search share the Git budget; `blessHistoryIncomplete` applies to the search only. Outside a Git repository the CLI prints guidance without changing the verdict. The history flag is opt-in.

### Imported specifications

`--spec-sources` compares local source refs if configured and adds `specSources` to JSON. Source warnings are advisory under strict. A missing checkout with a record is skipped silently; an unrecorded source is reported even without a checkout. Without the flag the check does not inspect the source. Use `specproof-update --record-spec-source <name>` after import. A HEAD mismatch in the relevant paths stops recording unless a verified ref-based import justifies `--allow-head-mismatch`. See the [configuration reference](https://github.com/Pound79/specproof/blob/main/docs/config-schema_en.md#specsources) and [security model](https://github.com/Pound79/specproof/blob/main/docs/security-model_en.md).

### Errors and output

Unknown arguments, wrong-command flags and missing values fail. Errors produce one stderr line, `<command> failed: <message>`, and exit 2. Newlines and controls become question marks. A YAML syntax error contains the line and column without quoting source content. `SPECPROOF_DEBUG=1` also prints unfiltered diagnostics and stack traces; leave it unset in public CI. Text and JSON logs guard against GitHub Actions workflow command interpretation: leading `::` becomes `?:` in text and `##[` becomes `#?[` (escaped in JSON without changing its decoded value). Only explicit `--github-annotations` produces intentional workflow commands.

`layout.implGlobs` accepts literal files, leading `./` and wildcard `*` or `**`. A question mark is literal. CLI diagnostics are in English.
