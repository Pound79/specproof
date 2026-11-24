# specproof.config.yaml reference

[日本語](./config-schema.md) | English

Put one configuration file at the consumer repository root. The skills read its values when resolving `{{placeholder}}` tokens. Start from the [Playwright example](../templates/playwright/specproof.config.yaml) or the [Flutter example](../templates/flutter/specproof.config.yaml).

## Principles and validation

An adapter declares capabilities for the skills. Its runner, commands and adapter-specific settings select the framework behavior. The engine shares its hash rules, selects the appropriate feature parser, and reads the scan locations, strict policy and imported spec sources.

Use `specproof.config.yaml` or `specproof.config.yml` at the root, as a regular file of at most 1 MiB. Since 0.4.0, finding only `bdd-kit.config.yaml` or `.yml` at the root or in an unmarked ancestor during discovery stops with a rename hint. For typed engine keys, omission or YAML null selects the default. A non-empty value of the wrong type, a quoted boolean or an empty string where a nonempty string is required fails. The engine does not type-check values used solely by skills. `layout` and `tags` must be mappings when set. See [unknown keys](#unknown-keys) for spelling errors.

| Key | Required | Purpose |
|---|---|---|
| `adapter` | Yes for skills | `playwright` or `flutter`. The engine reads Flutter features with the Dart runner's rules. |
| `bddRunner`, `bddGenTool` | Yes | BDD runner and generator identifiers, e.g. `playwright-bdd` and `bddgen`. |
| `language` | Yes for skills | Gherkin dialect, e.g. `ja`. With `adapter: flutter`, use `en` or `ja`, the dialects the engine's Dart-runner parser reads; any other value fails when features are read. |
| `strictUnregisteredImpl` | No, default false | Escalate `unregistered-impl` under `--strict`. Broad implementation globs can otherwise produce many advisories. |
| `strictUnregisteredSpecHeadings` | No, default false | Escalate unregistered headings in referenced spec files. Some files also contain untracked glossaries and revision histories. |
| `strictFeatureLint` | No, default false | Escalate `missing-then`, `step-order`, `duplicate-scenario-name`, and `duplicate-scenario`. `possible-contradiction` always calls for human judgment. |

## Commands

The agent executes commands from the repository root. The CLI and engine do not execute these strings. Review changes to a branch's commands and what they invoke before running the skill. Include `cd <e2eRoot> && ...` when a script belongs to a nested E2E package. Init leaves the root workspace configuration alone, so a bare npm command may fail with “Missing script”.

| Key | Required | Playwright example |
|---|---|---|
| `generate` | Yes | `cd packages/e2e && npm run bddgen` |
| `typecheck`, `lint` | Yes | `cd packages/e2e && npm run typecheck` and `cd packages/e2e && npm run lint` |
| `productTypecheck`, `productLint` | No | `npm run typecheck` and `npm run lint` for product code. Implement reports the omitted checks as unverified. |
| `smoke` | Yes | `cd packages/e2e && npm run test:smoke` |
| `install` | No | `npm ci` |
| `traceabilityUpdate`, `traceabilityCheck`, `traceabilityList`, `traceabilityStats` | No | `npx -y -p @pound79/specproof-traceability specproof-*` with the corresponding command name |

## Layout

Paths are relative to the repository root. The manifest, page and feature directories and implementation scan roots must be inside it both lexically and after resolving symbolic links. External targets and dangling links fail.

| Key | Required | Purpose |
|---|---|---|
| `e2eRoot`, `stepsDir`, `pagesDir` | Yes | E2E package, step definitions, and page objects |
| `featuresDir` | Yes | Location of source features. When a config exists, an unset directory produces `features-dir-unset`; a missing or non-directory target produces `features-dir-missing`. Both fail under strict. |
| `stepFileExt`, `stepFileSuffix` | Ext required | Language extension such as `.ts`, and optional more specific step suffix such as `.steps.ts`. |
| `candidateSuffix` | No | File suffix for discovery in `specproof-list`, default `Page.tsx`. Set this to the actual convention, e.g. `Page.ts` or a Dart suffix, or no candidates may be found. |
| `textConstants`, `i18nSource` | Constants required | UI text mirror and its optional upstream translation source, such as `ja.yaml`. |
| `manifest`, `specDir` | Yes for skills | Traceability manifest and directory holding specification/rationale documents. |
| `implGlobs` | No | Enables discovery of unregistered implementation files. Only `*` and `**` are wildcards. At most 256 unique patterns, each at most 1,024 characters. |
| `implExcludeGlobs` | No | Exclude matches from the unregistered implementation advisory only. Uses the same syntax and limits. See below. |
| `specHeadingIgnore` | No | Ignore all unregistered headings in `<path>` or one in `<path>#<heading>`, split at the first `#`. Registered drift and duplicate-heading checks still apply. The CLI counts exclusions and JSON exposes `excludedAdvisories.unregisteredSpecHeading`. |
| `scratchDir`, `testRunnerConfig`, `idiomGuide` | No | Scratch workspace, runner configuration and local step idioms |
| `e2eReadme` | No | README for bootstrap/implement. Both templates include one. In a custom scaffold document workflows by change origin, the one-time bootstrap rule and rationale document conventions. |

`implExcludeGlobs` never suppresses drift for a registered reference. The CLI prints the count and JSON exposes `excludedAdvisories.unregisteredImpl`. Init supplies common Playwright exclusions (`**/__tests__/**`, `**/__mocks__/**`, `**/*.test.*`, `**/*.spec.*`) or Flutter exclusions (`**/*_test.dart`, `**/*.g.dart`, `**/*.freezed.dart`, `**/*.mocks.dart`). Even without exclusions, check summarizes such test-like names in text and annotations. Use `--include-tests` to list them. JSON, exit status and strict failures retain them. With that flag, at least five test-like files and no configured exclusions produce a configuration hint. Review globs before enabling strict enforcement as they act on names alone.

## Fixtures and other blocks

Map fixture names to page-object files under `fixtures` when the skills generate step bindings. An empty map or fixtures limited to world/authentication are valid. Follow the local step style and avoid introducing page objects into such a suite.

| Block | Requirement and keys |
|---|---|
| `runner` | Optional Playwright settings: `device` (default `Desktop Chrome`), `webServerCommand`, `globalTeardown`, `i18nLocaleStorageKey`. |
| `tags` | Declare canonical slow/generate/admin/user tags. Fixed state tags need no aliases. A config with `tags.fixme` or `tags.skip` is rejected. `tags.slow` (default `@slow`) is the single tag smoke excludes; it cannot be a state tag. Playwright's `test:smoke` detects smoke through the environment variable `SPECPROOF_SMOKE=1` and excludes `tags.slow` in the tag expression; to get the smoke exclusion when launching `bddgen` and `playwright` directly rather than through the npm script, set `SPECPROOF_SMOKE=1` for both, because the exclusion also applies at generation time. Accepted values differ by adapter. Flutter (`tool/smoke.dart` validates `^@\w[^@()&\s\\]*$`) accepts only a tag whose first character after `@` is an ASCII letter, digit or `_`, with no `&`, parentheses, whitespace, second `@` or backslash. Playwright rejects a tag containing whitespace, parentheses, a second `@` or a backslash. For example, `@長時間` works with Playwright but not with Flutter. |
| `projects[]` | Declare runner profiles with `name`, `tags`, optional `features` selection and `conditional`. Playwright also reads `storageState`, `setup` and `credentialsEnv` (`username`, `password`, `newPassword`). Tag expressions must have balanced parentheses and must leave state tags alone. |
| `env` | Logical environment variable names. Declare `baseUrl`. `adminUsername` can control the authed-admin profile. |
| `environments[]` | Declare at least one runtime environment. See [environments](#environments). |
| `implement` | Optional. `blastRadiusGlobs` bound product edits independently of discovery globs. `productChanges` defaults to `sameBranch`. With `separateBranch`, leave the E2E branch unmerged and put product changes on a branch off the product's default branch. The implement skill owns this policy. |
| `git` | Optional sync commit scope and branch prefix (`commitScope`, `branchPrefix`). |
| `agents` | Optional `codeReviewer` and `securityReviewer` identifiers. |
| `conventions` | Optional `agentsDoc`, `i18nLintPlugin`, `stepFrameworkPattern`, `pendingStubBody`. |
| `examples` | Optional `domainName`, `specDoc`, `internalConstants`. |
| `flutter` | Adapter-specific declarations: `gherkinParser`, `testEntry`, `device`, `buildRunnerPin`, `buildYamlSources`, `traceabilityHashSource`. |
| `specSources[]` | Optional sources for copied specifications, described below. |

## specSources

If the consumer copies specifications from another checkout, record the imported commit and check for changes upstream. The consuming project's import script performs the copy.

```yaml
specSources:
  - name: permissions                 # Record name: letters, digits, dot, underscore, hyphen
    repo: ../backend                  # Required: absolute or relative to this repository's root
    ref: origin/develop               # Required: remote/local branch, fully qualified ref or commit ID
    paths: [config/permissions]       # Optional: defaults to the entire repository
    specDir: docs/specs/permissions   # Optional: destination for warning locations and skill guidance
    importCommand: scripts/import-permissions.sh  # Optional: run by the skill after human approval
```

**Resolve the ref.** For a full 40-digit SHA-1 or 64-digit SHA-256 object ID, accept upper or lowercase and use the commit only if the resolved ID equals the lowercase input. A hex-only branch name of that length needs `refs/heads/<name>`. A name beginning with `refs/` selects that exact ref. Otherwise, look for exact `refs/remotes/<ref>`, then `refs/heads/<ref>`. A tag needs `refs/tags/<name>`; DWIM resolution could otherwise select an identically named tag. Do not use `HEAD`, an abbreviated object ID, `heads/<name>` or `tags/<name>`.

**Record the source.** After import, `specproof-update --record-spec-source <name>` records the commit in `specSources.<name>`, preserving reference hashes. Use `--dry-run` to preview. Verify the reported absolute source location matches the actual import. A missing checkout, unresolved ref or absent source path fails without writing. Fetch the intended source yourself first as the CLI only uses local refs. The record describes the selected commit and cannot prove what the import script copied.

Before recording, the CLI compares committed trees (including file modes) for HEAD and the selected ref over `paths`, or the whole repository if omitted. Differences fail even in dry run. A different HEAD with identical content is fine. Use `--allow-head-mismatch` only after establishing that the importer reads the chosen ref directly. The difference is then reported. Uncommitted changes are outside this comparison.

**Import from a fixed commit.** A script reading objects directly assumes the path checks normally provided by checkout and the Git restrictions used by the CLI. The source may be changed in a PR. Before copying:

1. Run `specproof-update --record-spec-source <name> --dry-run`. Require success, including on first import. This checks repository, ownership, ref and selected paths. `specproof-check --spec-sources` can succeed with advisories and is insufficient here. Apply the HEAD exception only under the condition above.
2. Run Git with explicit `--git-dir=<repo>/.git`, `GIT_NO_LAZY_FETCH=1`, `GIT_NO_REPLACE_OBJECTS=1`, `-c protocol.allow=never` and `-c protocol.<name>.allow=never` for each built-in transport. This prevents a lazy fetch from invoking commands configured by the source.
3. Resolve the commit once and reuse that immutable ID for the whole copy. Report it for comparison with the record. For short names, use `git --git-dir="$repo/.git" for-each-ref --format='%(objectname) %(refname)' -- "refs/remotes/$ref" "refs/heads/$ref"` and select a fully matching ref name in that order. Prefix matches may include descendants and no match still yields exit 0. For full ref names, query only that exact name. Peel the selected object with `rev-parse --verify "$id^{commit}"`. For a full commit ID, lowercase it first and require equality with the returned ID. Passing a symbolic input straight to `rev-parse` permits different fallback resolution.
4. Read paths and modes with `ls-tree -r -z <commit-id> -- <paths>`. Copy regular files only (100644 or 100755). Reject empty path components, `..` and case-insensitive `.git` before writing. Exclude symlinks (120000) and submodules (160000).
5. Read the blob contents using `cat-file blob <blob-id>`. Leave filters and textconv off. Archive export can apply attributes such as `export-subst`.

**Check results.** Enable `specproof-check --spec-sources` explicitly. The default PR workflow does not start Git in a location supplied by the PR. The comparison includes mode changes. If any configured path is absent from the current ref or changed since the recorded commit, check reports `spec-source-outdated`. If no record exists it reports `spec-source-unrecorded`, even when the source checkout is absent. A missing checkout with a record is skipped silently. If the directory exists but cannot be checked, `spec-source-unresolved` identifies the reason: unsupported checkout, unresolved ref (lists exact candidates and tag syntax), missing recorded commit (fetch history, check for rewrites), or Git read failure (verify the clone). Diagnostics use the configured repository path. All three source warnings are advisory under strict.

JSON adds `specSources: [{ name, status, recorded, current, missingPaths, reason }]`. Status can be `current`, `outdated`, `path-missing`, `unrecorded` or `unavailable`. Only an unavailable result includes a reason: `source-missing` (silent), `source-unreadable`, `ref-unresolved`, `recorded-missing` or `read-failed`.

**Source boundaries.** Use the checkout root with a real, user-owned `.git` directory. Subdirectories, linked worktrees, submodules, bare and partial clones are unsupported. A linked worktree's gitfile and shared common directory could read configuration outside the checked ownership boundary. Even a real `.git` can refer elsewhere via includes or object alternates; the ownership test does not police those. To read another branch use the fixed ref method. The CLI explicitly points Git at its directory, disables transport and external execution, and runs only `git config --null --list`, `for-each-ref`, `rev-parse` and `ls-tree`. A dot in `paths` selects the whole repository. Manifest names and commit values are quoted strings, including names that resemble booleans or numbers.

## Unknown keys

Check emits `unknown-config-key` for each key unread by the engine, templates or skills. A misspelling such as `layout.featureDir` or `strictUnregisteredImp` could silently disable the intended audit. Strict fails with no opt-out. Messages contain only the path, e.g. `projects[0].tag` or `["a b"]`, limited to 200 characters ending in an ellipsis. After 100 unknown keys, scanning stops with one extra `truncated: true` warning. Text and annotations show up to 20 ordinary findings plus the truncation warning; JSON includes all collected ones. Update, list and stats do not emit these warnings.

The top-level fields and fixed-size key sets are listed in the tables above. For nested fixed mappings the check recognizes only the named keys: each project and its credentials, each environment and its auth, each spec source, commands, layout, implement, git, agents, conventions, examples, runner and flutter. `fixtures`, `tags`, `env` and `environments[].envOverrides` have user-defined keys. `tags.fixme` and `tags.skip` are still invalid. Values with an unexpected container type do not undergo nested-key traversal. Their actual consumers validate types. Retired keys such as `runner.authDir` or exploratory keys in historical documents are outside the schema. Keep new known keys in sync with `packages/traceability/src/config-keys.ts`.

## Environments

Even a single-environment repository declares at least `[{name: local, default: true}]`. Authentication is scoped to the environment; resolve `{{config:auth.provider}}` and `{{config:auth.description}}` from it. Local mock and dev OAuth can share the same project.

1. When set, `SPECPROOF_ENV` selects the matching name. An unknown name fails.
2. Otherwise choose the first entry marked `default: true`.
3. If no entry is marked, choose the first entry.

Since 0.4.0, a lone legacy `BDD_KIT_ENV` stops with migration guidance.

| Field | Type and behavior |
|---|---|
| `name` | Required string such as local, dev or staging. |
| `default` | Optional boolean. Mark one entry as the default. |
| `dotenvFile` | Optional string, relative to the E2E package. Defaults to `.env`. |
| `auth` | Optional mapping. `provider` names the mechanism (mock, google, email-password, saml). `description` guides the skill. |
| `excludeTags` | Optional string array. Each value is one tag matching `/^@[^@\s()]+$/`. State tags and tag expressions are rejected by the Playwright loader. |
| `envOverrides` | Optional string-to-string map injected after dotenv, preserving pre-existing shell values. |
| `allowInsecureHttp` | Optional boolean introduced in 0.5.0. Only literal true permits non-loopback HTTP in that Playwright environment. |

### Credential-bearing URLs

When any configured project meeting its `conditional` uses setup, credentials or a nonempty storage state, Playwright checks the base URL during config load and again before login, even for a guest-only CLI selection. HTTPS and loopback HTTP work by default. Loopback includes localhost, *.localhost, 127.0.0.0/8 and ::1. It excludes localhost with a trailing dot, ::ffff:127.0.0.1 and 0.0.0.0. Other schemes fail even with opt-in. Enable HTTP only when HTTPS is unavailable. The exception accepts every HTTP host in the active profile. The check covers the base URL alone; inspect redirects and separately constructed URLs.

```yaml
environments:
  - name: staging
    dotenvFile: ".env.staging"
    allowInsecureHttp: true
```

The Playwright loader ignores unknown environment keys. The engine's unknown-key check uses the fixed environment field set above.

### Example profiles

```yaml
environments:
  - name: local
    default: true
    dotenvFile: ".env.local"
    auth:
      provider: mock
      description: "Local mock authentication without a real IdP."
    excludeTags: ["@google-auth", "@requires-real-smtp"]
  - name: dev
    dotenvFile: ".env.dev"
    auth:
      provider: google
      description: "Firebase Auth (Google), development project."
    excludeTags: []
  - name: staging
    dotenvFile: ".env.staging"
    auth:
      provider: google
      description: "Firebase Auth (Google), production-like IdP settings."
    excludeTags: ["@destructive"]
```

Runtime environment, authentication role and scenario attributes form three independent selections. Environment exclusions can omit a tag such as `@google-auth`, and project conditions can disable an admin role when a variable is absent. Every filter must allow a scenario for it to run. Runners always exclude `@draft`, `@human` and `@out-of-scope`. Ordinary selections (project tags such as `@admin`, CLI `--grep`, smoke's exclusion of the configured `tags.slow` tag) still apply to `@red-contract`. A pending human condition remains pending and outside E2E. State tags or unbalanced parentheses in Playwright project tags or Flutter's `SPECPROOF_TAGS` are rejected. Never pass `--grep-invert @red-contract`.

## Why these fields exist

The initial review compared 143 hardcoded tokens against the config, identifying gaps and corrections. `i18nSource` identifies the upstream translation of the text mirror. The fixtures map names all page-object fixtures. Edit permissions for implement can extend beyond discovery globs. A step suffix such as `.steps.ts` avoids unrelated TypeScript files. Project feature lists distinguish cases that tags alone cannot. Git scope, branch prefix, dependency installation, reviewer names, authentication provider/description, spec examples and admin conditions all vary by consumer. Playwright assertions such as `toHaveURL` belong in idiom guides; language keywords come from the dialect.

## Skill resolution and template examples

Both templates declare `layout.i18nSource`, conventions, examples and git settings. Replace illustrative paths for i18n, project agent instructions and specs with existing files. These example paths do not permit skills to create or fill in missing paths; skills MUST NOT do so. `i18nLintPlugin: none` explicitly means no dedicated lint and must be reported as unverified. `conventions.pendingStubBody` is a pending example that always fails; never replace it with an empty, passing implementation. Optional service tags such as `tags.sf` are consumer-specific; also tag slow external-service scenarios appropriately.

Flutter projects, env and environments inform the skills. They do not automatically configure Dart authentication or filters; the sample counter needs neither credentials nor a URL. Setup verifies `flutter.*` against pubspec, build configuration and real commands. Playwright uses `projects[].storageState` for saved authentication. Stop on missing required keys. Use only the applicable skill's stated optional fallback and clearly disclose any self-review.
