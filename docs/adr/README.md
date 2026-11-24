# Architecture decision records

[日本語](README_ja.md) | English

Each link opens the original decision. The summaries identify superseded decisions and accepted work that remains unimplemented.

| Original record | Summary |
|---|---|
| [0000 Project rename](0000-rename-note.md) | Earlier records retain the former project name, bdd-kit. |
| [0001 Tracking without a spec](0001-spec-absent-two-point-traceability.md) | Use an outline to help a person author the spec. When no spec is available, track implementation and feature and report the missing spec anchor. |
| [0002 Original done definition](0002-done-definition-fixme-skip-split.md) | The initial decision separated automation work from deliberate manual verification. ADR 0009 supersedes these tags and the original completion rule. |
| [0003 One onboarding entry point](0003-single-orchestrator-direction-internal.md) | One orchestrator selects the workflow according to project maturity and spec availability. The CLI owns read-only drift detection. |
| [0004 Deterministic checks](0004-deterministic-strict-enforcement.md) | The CLI checks invariants that can be verified structurally. ADR 0009 updates its state-tag rules. |
| [0005 Handoff and stopping points](0005-handoff-report-and-stopping-model.md) | Report observed verification, skipped checks and their reasons, decisions and remaining work. Prepare drafts together and obtain a decision per domain before blessing or implementing. ADR 0009 updates the tags. |
| [0006 First greenfield example](0006-greenfield-worked-example-onboarding.md) | Follow one human-selected behavior from a spec through RED, implementation and execution. If the environment is incomplete, report the observed stage and the missing steps. |
| [0007 Phased rollout](0007-phased-rollout.md) | The original plan sequenced compatible fixes, design changes and validation in an existing suite. The roadmap gives current status. |
| [0008 Static analysis and run results](0008-flow-layer-separation.md) | specproof provides static counts and integrity signals. A separate tool owns run results, time series and progress UI. The accepted scenario ID registry remains unimplemented. |
| [0009 State tags and completion](0009-retire-fixme-skip.md) | Use @red-contract for pending implementation, @human for human verification, @out-of-scope with a reason for excluded conditions, and @draft for proposals. @fixme, @skip and @fail are disallowed. |
| [0010 Manifest versions and migration](0010-manifest-version-policy.md) | Changes to the meaning of stored hashes or existing fields require a new manifest version and a migration path. Stricter validation that preserves meaning is recorded as BREAKING in the changelog. |
