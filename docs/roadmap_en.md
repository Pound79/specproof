# Implementation status and open work

[日本語](roadmap.md) | English

S1 and S2 shipped in 0.3.0. Versions up to 0.2.2 do not include them. See the [contributor guide](../CONTRIBUTING.md) for development instructions and the [traceability README](../packages/traceability/README.md) for current CLI guarantees. Static counts alone cannot establish a successful test run.

## Static counts and condition IDs

| Work | Contract | Source |
|---|---|---|
| S1 (0.3.0) | Count phase (draft, pending, complete) separately from verification (machine, human). Count conditions and expanded Scenario Outline cases separately. | `packages/traceability/src/feature-scan.ts`, `stats.ts`, `cli-stats.ts` |
| S2 (0.3.0) | Validate and preserve optional string arrays in version 1 `links[].criteria`. | `packages/traceability/src/manifest.ts`, `update.ts` |

For S1, `@draft` sets the draft phase, `@red-contract` sets pending, and the default phase is complete. Verification is human with `@human` and machine otherwise. “Complete” describes the tags on a condition. Proving GREEN requires a run. Tests cover state-tag inheritance from Feature and Rule, invalid tag combinations, and agreement between JSON and text output.

The static done gate in `specproof-stats --strict` requires zero pending `@red-contract` conditions and zero conditions with disallowed `@fixme`, `@skip` or `@fail` tags. See [ADR 0009 (Japanese original)](adr/0009-retire-fixme-skip.md).

For S2, omitting `criteria` or supplying an empty array is valid. Invalid types, empty strings, control characters and duplicate entries within a link are rejected. A condition ID can appear in multiple links. Loading, updating and saving preserve unknown keys, including updates to all links, single-link updates and dry runs. IDs are opaque, nonempty strings. Consumer-specific formats such as AC or TC are validated by the consumer. The [manifest criteria reference](../packages/traceability/README.md#manifest-criteria) defines validation and writer behavior. Adding `criteria` preserved the existing hash and strict-mode contracts.

## Distribution

The [release guide](../RELEASING.md) describes how `scripts/release.sh` pushes the tag and the Release workflow publishes the packages. The script can release an unpublished candidate already at the requested version and checks all workspace and lockfile versions. Fixtures cover restoration after a declined publication prompt and rejection of a non-main branch, an existing tag or uncommitted changes.

## Accepted work awaiting implementation

[ADR 0008 (Japanese original)](adr/0008-flow-layer-separation.md) defines a `scenarios` ID registry, `@id` interpretation and ID validation warnings. These remain unimplemented and outside S1 and S2. A separate tool owns run results, confirmation of GREEN, time series and the progress UI.

## Open work and proposals

- Still unimplemented: tracking the oldest `@red-contract` date and review cadence, and supporting `--adapter-dir`.
- Still unconfirmed: completion of the planned trial on an external production Playwright suite.
- The [Flutter status](flutter-readiness_en.md) lists current execution entry points and remaining work. The bundled template and skills do not read proposed extension keys for Patrol native operations or flavors.

## Decision records and history

The [ADR index](adr/README.md) summarizes design decisions. The [history index](history/README.md) links earlier plans and validation notes. The [archived roadmap](history/2026-07-06-roadmap.md) and [archived improvement backlog](history/2026-07-06-improvement-backlog.md) record the completed Phase A and B items, audit identifiers and reasons. Historical Done labels and test counts describe the state at the time.

## Testing a consumer before publication

Registry-based `npx` cannot resolve an unpublished candidate at the intended version. During `npm test`, `scaffold-traceability.test.mjs` substitutes local tarballs of that version for the package specs and runs all four generated traceability commands. It covers both adapters and installations at the repository root, default path and custom path. Registry availability requires a separately approved release. A fix PR does not publish packages.
