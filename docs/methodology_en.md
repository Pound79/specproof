# specproof methodology

[日本語](./methodology.md) | English

This guide describes behavior-driven testing across frameworks and repositories. Resolve the command, path, tag and runner `{{placeholder}}` tokens from the consumer's `specproof.config.yaml`.

## 1. Roles and skills

Use `/specproof` as the entry point. It detects the project, sets up the adapter if needed, and chooses a direction:

| Skill or command | Direction | When to use it |
|---|---|---|
| `specproof-bootstrap` | Implementation → draft feature | Capture observable behavior once for a domain with little E2E coverage. Write the result in scratch for human review. |
| `specproof-new-feature` | Spec → feature | Turn a new spec section into a feature, pending step definitions and a traceability link. |
| `specproof-implement` | Feature → implementation | Start with a reviewed RED feature. Implement step bodies, page interactions and product changes until the contract passes. |
| `specproof-check` | Read-only detection | Compare current inputs with manifest hashes. The deterministic CLI reports drift without changing files. Run it directly or through the orchestrator. |
| `specproof-sync` | Drift → feature, with expectations from the spec | Reconcile changed links according to the decision table below. Implementation differences provide context, never expected outcomes. |

A new requirement starts at new-feature, an uncovered existing behavior at bootstrap, a pending step or failing approved feature at implement, and suspected changes at check. If check reports drift, use sync. Each direction identifies who supplies the evidence and who has authority over expected behavior.

## 2. Why generation is asymmetric

**Continuous `impl → feature` regeneration is tautological and is prohibited.** Apart from the one-time bootstrap, never regenerate a feature from the implementation. `feature → impl` implementation is legitimate TDD and is the only direction specproof-implement takes.

A feature regenerated from implementation describes whatever the code currently does. A regression can then change both the behavior and its oracle together and ship GREEN. Repeated generation tends to omit the human-designed edges, error paths, role differences, rationale links and cases awaiting implementation or verification. CI can remain green as the contract shrinks.

In TDD the direction is reversed: a feature remains fixed while the product changes to satisfy it. A human-reviewed contract can disagree with the product. Bootstrap is a one-time exception for capturing an existing system. After bootstrap, change the feature first for intended behavior changes, observe RED, then implement and confirm GREEN. Where existing code has already changed, detect drift and reconcile with the spec. Human judgment resolves changed observable behavior.

## 3. Classifying behavior

Ask what a user can observe. Keep observable behavior in a feature even when it is difficult to automate. Record design rationale and non-observable requirements separately.

### A. Automate deterministic behavior

Write an ordinary scenario or give a slow one the configured `{{tag_slow}}` tag to exclude it from smoke. Preserve determinism across environments and retries:

- Establish every prerequisite in a Given, seed or fixture. Rebuild the test environment from a fixed state each run before seeding. Reusing a database can hide dependencies on an unrelated row or an earlier user's selection.
- Scope negative assertions to the relevant fixed UI elements. If checking that a read-status badge is absent, restrict the search to the status area. A user-written title or comment can contain even an exact match for the badge text. First verify that the expected item exists, so an empty list cannot pass.
- Recreate or restore consumed state for **each attempt**. Reading an unread notice, joining a group, reporting an item or changing a name can leave the scenario's prerequisite false on retry. If fresh state cannot be created, seed dedicated data per scenario and check the prerequisite before acting. Fail immediately with a reason if it is gone. Choose these cases by asking whether the same scenario remains valid after the action. For a prerequisite invisible in the UI, the implement checklist and the Playwright template describe a per-scenario guard, when to mark it and how to key it across attempts.

### B. Keep observable behavior even when automation is difficult

Typical obstacles include unavailable deterministic test data, a missing external-failure injection seam, or an environment that CI cannot reproduce.

| State | Representation | Execution and completion |
|---|---|---|
| Proposed | `@draft` | Outside E2E and acceptance until a human decides. |
| Implementation pending | `@red-contract` | Keep selected machine scenarios running RED. Any pending condition blocks completion. Use `@red-contract @human` when a person will verify it. |
| Human verification | `@human` | E2E excludes it. Count it and keep human confirmation outside specproof, e.g. in the team's acceptance records. Put the automation seam on the testability backlog. |
| Outside acceptance | `@out-of-scope` | Exclude from execution and acceptance, count separately. Give each scenario an immediately preceding one-line reason comment. |
| Available in selected environments | An environment tag and `environments[].excludeTags` | Run in the applicable environment. This does not change the acceptance decision. |

Pending cases still need step definitions: undefined phrases fail generation. Use a failing stub for an unfinished body. Keep `@red-contract` until a human sees the real GREEN or verifies the human case. Put `@out-of-scope` on the scenario itself: inheritance from Feature, Rule or Examples cannot supply the individual reason and produces `missing-reason`. Stats rejects state tags on Examples and the combination of out-of-scope and pending.

A scenario depending on an unanswered question in the spec can carry `@question:<ID>`. The person recording the question assigns the ID and decides whether to add or remove the tag. If the missing answer prevents writing an expectation, also use `@draft`. A condition independent of the answer may remain runnable. Stats groups questions by ID with scenario counts and feature paths. The question tag changes neither execution nor done and does not replace sync's stop for unresolved permissions.

The runners always exclude draft, human and out-of-scope scenarios. Ordinary project and command-line selections (e.g. `@admin`, `--grep`, or the exact configured `tags.slow` exclusion in smoke) still apply to pending cases. Environment exclusions take individual, non-state tags. Playwright rejects state tags or unbalanced parentheses in project tag expressions. Flutter applies the same restrictions to `SPECPROOF_TAGS`. Never use `--grep-invert @red-contract`; it would manufacture a passing run by omitting pending conditions. A real OAuth consent screen or outgoing email may need `@google-auth` or another environment tag. Keep runtime environment, role/project and scenario attributes independent.

A broken or flaky test stays red until fixed. Runner tags that skip it or make a failure expected (`@skip`, `@fixme`, `@fail`) produce `disallowed-tag` and fail strict stats. See [ADR 0009](./adr/0009-retire-fixme-skip.md).

**Done** requires every accepted condition to have a GREEN run or a human confirmation record, with zero pending conditions and zero prohibited tags. Draft and out-of-scope conditions are outside acceptance. `specproof-stats --strict` enforces the static half, including missing inputs. Add that command as a CI requirement to enforce it. The bundled drift workflow runs `specproof-check --strict`. A census cannot attest to execution or human sign-off.

### C. Record rationale and non-observable contracts

Examples include API distinctions invisible to the UI (400/401/403), implementation constants, scoring weights and internal rules, non-functional performance or SLA requirements, datastore writes and audit logs, and assessments of generated language quality. Keep behavior visible in the feature even if the present test environment cannot exercise it. Otherwise the team loses the single place to find observable requirements.

Humans author rationale. AI may suggest topics. An explanation extracted from code is liable to repeat line numbers or invent justifications, hiding disagreement between spec and implementation. For authorization that crosses system boundaries, document the part invisible in the UI and cover the product boundary with appropriate tests.

## 4. Resolving drift

| Change in a link | Action |
|---|---|
| Implementation only | If it is a behavior-preserving refactor, leave the feature intact and bless the reviewed hash. For an observable behavior change, **stop** and show the implementation diff and corresponding spec. An implementation bug calls for a product fix. A new requirement calls for a spec change first. If the existing spec already requires/allows the behavior, derive any feature update solely from that spec after the human decision. |
| Specification only | Update the feature to the new spec. Any reduction in verification needs explicit specification evidence. |
| Both spec and implementation | Stop, show both diffs and ask which is authoritative. Even if the implementation is accepted, update the spec first. Concurrent changes, refactoring and merge conflicts require domain judgment. |
| Feature only | Respect the human edit. Review and bless its hash without regeneration. |
| Any reference missing | Propose correcting the link and ask before creating or removing files. |
| All reference files missing | Stop all sync work. Verify the root and manifest, then rerun check with `--root`. |

### Preserve existing acceptance conditions

Do not drop scenarios unless the linked spec explicitly removes the behavior and a person decides it should go. Implementation deletion alone is insufficient. Report the before/after and source section in the handoff and PR.

Weakening a check has the same effect: removing Then/And, replacing a concrete expected value with a loose or negative assertion, excluding an existing case through a state tag, inherited tag or Examples tag, and deleting Examples rows all require evidence. Removing `@red-contract` strengthens the failure signal but remains a human tag decision. Present GREEN evidence and propose removal.

Read all affected links and prepare all planned changes **before** editing features, steps, page objects or the manifest. If any deletion or relaxation lacks explicit support, stop with the proposed diff and request a spec clarification. Never loosen a check merely to make a run pass.

### Review the draft

Bootstrap and new-feature apply the generation guide's draft review. Flag negative-only assertions, expectations without a concrete value, uncontrolled setup and contradictory permission rules under decisions for the reviewer. The review itself does not edit the draft.

Read the permission section in the source spec (the linked consumer spec, or the document used to draft the new feature). Compare roles, allowed and denied actions and what the user sees on denial against the **whole feature**. A scenario-by-scenario pass alone misses absent rejection cases.

| Finding | Handoff |
|---|---|
| Contradiction | Show the scenario and conflicting permission. Ask for a decision. |
| Missing coverage | Propose a scenario showing the specified, user-observable rejection. |
| Undecided | Ask for spec text defining the role and denial outcome. With no relevant permission rules, report insufficient input. |
| Consistent | Report the scope of the comparison. It establishes consistency between documents, not the implementation's authorization. |

Use positive observations of a refusal in the feature. Invisible status-code distinctions belong in rationale; authorization of API responses or background jobs belongs in the product's request/job tests.

When check reports drift in a registered permission section, sync performs the same feature-wide comparison before editing. With a spec-only change, update expectations explicitly required by that change. If a changed role/action/object, a scope or rule applying across multiple combinations, or an ambiguously related point leaves permissions undecided or underspecified, stop before updating the manifest. Report other unresolved points without making up outcomes. Register each affected permission section on each relevant link as described below.

### Read-only detection

`specproof-check` compares the current hashes with the saved baseline and reports the evidence. It writes no files. If upstream checks are enabled, `spec-source-unresolved` calls for human intervention even with a clean hash result. Review imports with `spec-source-outdated` or `spec-source-unrecorded` before proceeding. The separate update command changes the baseline.

## 5. Four guards against implementations tailored to tests

1. **State the prohibited patterns and review the result.** Never hardcode a test input, branch only for the example, or return the smallest fake result that satisfies an assertion. Confirm the step exercised the intended path. For a server rejection, for example, positively establish that the request went out; client-side validation might display the same message. For regression tests, reproduce the causal state and observe failure on the previous or reverted product version. For state-consuming scenarios, create fresh prerequisites per attempt or verify them before acting.
2. **Use independent review.** Give code and security reviewers the feature and diff, and ask them to try to disprove the implementation by looking for test-specific shortcuts. Address critical and high findings. Use only the fallback explicitly allowed by the skill and disclose a self-review.
3. **Read the spec and rationale.** A black-box example under-specifies internals. Read the authoritative rules, including reasons for constants, weights and business decisions, before implementing.
4. **Vary inputs.** Exercise other values to reveal hardcoded answers. Where an input cannot be varied through the black-box interface, identify the narrower scope and explain why.

If generation, type checking or smoke fails, make at most two self-correction attempts. Then stop, report the failing evidence and request human judgment.

## 6. Feature-first development and human gates

After bootstrap: a human defines the desired feature, implement real step bodies, observe RED against the unchanged product, implement, confirm GREEN and bless. Failing autogenerated pending stubs cannot tell you which behaviors the product actually lacks. In brownfield work some real steps already pass; confirm the assertion is meaningful and propose that a human remove the corresponding pending tag.

- **Bootstrap review.** Emit a scratch draft with the draft marker. A human reviews the boundaries, failure paths, roles and rationale, edits or discards suggestions, removes the marker and promotes the feature. Only then add the needed stubs and manifest entry. Preserve existing features.
- **Commit and bless.** The implement skill writes code. A human owns the commit and baseline decision. Product changes need security review.
- **Failed verification.** After two unsuccessful self-corrections, stop with the evidence. A failing pending `@red-contract` may be committed as an intentional RED contract. Any other scenario failure, or a generation, type or lint failure, blocks the commit. Disclose any slow scenarios left unrun.

## 7. Traceability manifest

The manifest connects each business link to authoritative spec sections, implementation files and features. Each reference has its own SHA-256 baseline. This makes a subsequent change visible even if related files still compile or tests pass.

```yaml
- id: <feature-id>
  label: "<description>"
  spec:
    - path: <spec-doc-path>
      heading: <heading text>    # Omit the leading Markdown hashes
      headingLevel: 2           # Optional; use 3 for ###
      hash: PENDING
  impl:
    - path: <impl-file-path>
      hash: PENDING
  features:
    - path: <feature-file-path>
      hash: PENDING
```

A new reference can use `PENDING` until its content is ready. Review the link, run `{{cmd_traceability_update}} --link-id <id>` and check again. Repeat the selector to bless multiple reviewed links together. An unscoped update also blesses unrelated implementation drift.

Check reads the manifest. Sync blesses reconciled links and rechecks. New-feature adds a pending link and updates that link only; bootstrap follows the same process for a new link or updates the reviewed existing link. A human blesses after implement.

### Register shared permission sections on every affected link

A shared spec section must occur in the `spec[]` of every feature it governs. For example, a change to invoice-reading permissions can affect the list and detail screens:

```yaml
links:
  - id: invoice-list
    spec:
      - path: docs/spec/invoices.md
        heading: Invoice reading permissions
        hash: PENDING
  - id: invoice-detail
    spec:
      - path: docs/spec/invoices.md
        heading: Invoice reading permissions
        hash: PENDING
```

`criteria` associates requirement IDs with links (many-to-many). It does not carry the spec body or detect changes. The section hash in `spec[]` makes a spec edit visible on the registered links. A human or the orchestrator invokes sync after detection; registering a link does not automatically run sync.

`strictUnregisteredSpecHeadings: true` can detect an unregistered heading in an already referenced spec file at a registered depth, but cannot detect a missing association if a different link already registers that heading. A `###` permission heading in a file registered only at `##` also escapes that advisory. Humans decide which links the rule affects. A clean manifest is not evidence of approval or runtime behavior.

### Reading check output

Use `entries` for the link, side, path, optional spec heading, saved/current hashes and changed/missing status. `driftCount` counts references and `driftLinkCount` counts distinct links. `clean` means no hash drift. Non-drift warnings have their own `failsUnderStrict` flag. With `allReferencesMissing` true, verify the root. With a nonempty `bothSidesChanged`, stop for a decision. Source warnings, exclusion counts, optional history fields, display limits and strict behavior are documented in the [CLI reference](../packages/traceability/README.md#json-report).

## Workflow and configuration placeholders

A new requirement starts with spec → feature + failing stubs. Bootstrap starts with implementation → scratch draft → human review/promotion → feature + stubs. Both then use a real RED baseline, implement, verify, and obtain the human commit/bless decision. Subsequent changes go through check → sync against spec → implement if needed → human gate.

| Placeholder | Meaning |
|---|---|
| `{{cmd_bddgen}}`, `{{cmd_typecheck}}` | `commands.generate` and `commands.typecheck` |
| `{{cmd_traceability_update}}`, `{{cmd_traceability_check}}` | `commands.traceabilityUpdate` and `commands.traceabilityCheck` |
| `{{cmd_smoke}}` | `commands.smoke`, excluding the configured slow tag |
| `{{e2e_features_dir}}`, `{{scratch_dir}}`, `{{traceability_manifest}}` | Feature directory, draft scratch directory and manifest path |
| `{{tag_slow}}`, `{{tag_generate}}` | Slow/external scenarios and domain-specific heavy generation (`tags.slow`, `tags.generate`) |
| `{{tag_role_admin}}`, `{{tag_role_user}}` | Admin/user role tags (`tags.admin`, `tags.user`) |
| `{{bdd_runner}}`, `{{gherkin_language}}` | Framework runner and dialect, e.g. Japanese `ja` |
| `{{code_reviewer_agent}}`, `{{security_reviewer_agent}}` | Configured code and security reviewers |
