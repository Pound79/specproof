# @pound79/bdd-traceability

[![npm](https://img.shields.io/npm/v/@pound79/bdd-traceability.svg)](https://www.npmjs.com/package/@pound79/bdd-traceability) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

Framework-agnostic **spec ↔ impl ↔ feature** traceability engine for BDD behavior
tests. It detects drift deterministically (no AI) using SHA-256 hashes of your
spec sections, implementation files, and `.feature` files.

Part of [**bdd-kit**](https://github.com/Pound79/bdd-kit). Minimal dependencies (only `yaml`), pure Node.

## Install

```bash
npm i -D @pound79/bdd-traceability
```

Requires Node.js **>= 24**.

## CLI

All commands auto-discover `bdd-kit.config.yaml` / `traceability.yaml` from the repo root.

```bash
npx bdd-traceability-check --json     # detect drift (exit non-zero on drift; --strict for lint gates)
npx bdd-traceability-update           # bless current hashes (single link: --link-id <id>)
npx bdd-traceability-list             # registered domains + bootstrap candidates
npx bdd-traceability-stats            # scenario census (automated / @fixme / @skip; --strict for done gate)
```

- **`check`** compares the current spec/impl/feature hashes against the blessed
  baseline and reports drift per link. `--strict` also fails on unreviewed draft
  markers, all-empty links, and missing `@skip` / `@fixme` reason comments.
- **`update`** re-blesses the manifest hashes after you've reconciled a change.
- **`stats`** produces a scenario census and, with `--strict`, enforces the
  "done" gate (`@fixme` must be 0).

## Programmatic API

The package also exposes a typed library surface:

```ts
import {
  checkDrift,
  updateManifestHashes,
  loadManifest,
  buildStats,
  discoverConfig,
} from "@pound79/bdd-traceability";
```

Key exports: `checkDrift`, `updateManifestHashes`, `loadManifest` / `saveManifest`,
`buildStats` / `formatStats`, `buildDomainList`, `discoverConfig`, plus the hash
primitives (`computeFileHash`, `computeHeadingSectionHash`, `FILE_MISSING`,
`SECTION_MISSING`, `DRAFT_MARKER`).

## Documentation

See the [bdd-kit repository](https://github.com/Pound79/bdd-kit) for the full
methodology, config schema, and the adapter contract.

## License

[MIT](./LICENSE) © Pound79
