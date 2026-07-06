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
  "done" gate (`@fixme` must be 0).

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

### Manifest comments are not preserved by `update`

`specproof-update` rewrites the manifest YAML from a parsed in-memory
object, not by patching the source text. Any hand-written comments in
`traceability.yaml` will be dropped the next time `update` runs. Keep
rationale/notes in the linked spec doc or a sibling comment file instead of
inline in the manifest.

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
