# Security model

[日本語](security-model.md) | English

This document describes what specproof trusts, which files it reads and writes, its network connections, and the limits of its guarantees. For vulnerability reports and dependency remediation timelines, see the [security policy](../SECURITY.md).

## Assumptions

The CLI (`@pound79/specproof`) and traceability engine (`@pound79/specproof-traceability`) treat the contents of a user's repository as **untrusted input**. In pull request (PR) CI, the contributor controls the config (`specproof.config.yaml`), the manifest (`traceability.yaml`), and the paths and contents of specs, implementation files and features.

Neither package operates a server, maintains a database or authenticates users. The operating system account running the CLI defines its permissions.

## File access and trust boundaries

### Traceability engine

**Root discovery.** An explicit `--root` takes precedence. Otherwise the engine walks up from the current directory to find the first `specproof.config.yaml`, `specproof.config.yml` or `traceability.yaml`. The search stops at a directory containing `.git`. If no marker is found, the fallback is `git rev-parse --show-toplevel`. A directory containing only the old `bdd-kit.config.yaml` or `bdd-kit.config.yml` stops discovery with a message to rename the file.

The engine root can be a subdirectory of the Git repository. If discovery finds only `traceability.yaml`, it checks whether the nearest config above it names this manifest in `layout.manifest`. A match makes the config directory the root. If the config cannot be read, the manifest directory remains the root. This search also stops at `.git`. A config entry in the manifest directory, including a dangling link or a legacy name, prevents the engine from going up and skipping local validation. An intervening config or legacy name likewise blocks selection of a more distant config. Set `--root` explicitly in CI.

**Reads.** The engine confines `layout.manifest`, `layout.pagesDir`, `layout.featuresDir`, the starting directories for `layout.implGlobs`, manifest references and `--manifest` to the resolved root. It checks the path and resolves symlinks to their targets. An outside target or a dangling link causes an error. The diagnostic conceals whether an outside target exists, has restricted permissions, or contains a link loop.

**Writes.** `specproof-update` writes only the manifest. It finishes a temporary file in the same directory, then replaces the manifest. A missing file or heading stops the update with an error.

**Git subprocesses.** The engine invokes Git for the following operations.

| Operation | Git commands |
|---|---|
| Root discovery | `git rev-parse --show-toplevel` with fixed arguments |
| `specproof-check --since-bless` | `git rev-parse`, `git log`, `git show`, `git rev-list`, `git ls-tree` |
| `specproof-update --record-spec-source` and `specproof-check --spec-sources` | In the source checkout, `git config --null --list` to detect partial clones, `git for-each-ref` for exact ref names, `git rev-parse` and `git ls-tree` |

The engine does not execute `commands.*` or `specSources[].importCommand`.

**Source checkouts.** The configured `repo` for a spec source can point outside the engine root. To read it, the engine requires a real `<repo>/.git` directory owned by the current user where the platform supplies an owner ID. The directory must have no `commondir`, and the source must not be a partial clone (`extensions.partialClone` or `remote.*.promisor`). An explicit `--git-dir` prevents discovery of a parent repository or bare repository. The engine refuses partial clones and sets `GIT_NO_LAZY_FETCH=1` to prevent retrieval of missing objects. It also sets `protocol.allow=never` and disables individual built-in transports. Transport-specific repository settings can take precedence over a general protocol setting. The engine sets `GIT_NO_REPLACE_OBJECTS=1` and removes inherited variables such as `GIT_DIR` and Git config overrides.

Source refs must match the accepted name syntax and follow `--end-of-options`. Contributors with push access to the source can create tags whose short names match branches, and ordinary fetches can bring in those tags. To avoid Git's precedence for tags, the engine looks up exact names with `for-each-ref`, checking `refs/remotes/<ref>` and then `refs/heads/<ref>`. A tag must use its full `refs/tags/` name. For a commit ID, the resolved ID must equal the supplied value after conversion to lowercase.

On a case-insensitive filesystem, such as the default on macOS, Git's files backend can store differently capitalized branch names at the same loose-ref path. For example, fetching a branch named `Develop` can overwrite `refs/remotes/origin/develop`. The CLI cannot disambiguate these refs after Git stores them. Use a case-sensitive volume for the source or use Git's reftable backend.

When recording a source, the engine resolves the fixed `HEAD` and compares its committed contents with the configured ref for `paths`. A mismatch ordinarily prevents recording and reports the HEAD commit ID and differing paths. An import that read the ref directly can use the explicit `--allow-head-mismatch` override. This compares committed versions. It does not verify uncommitted contents or what the import actually copied.

Source checks can reveal repository existence and commit IDs. An existing `repo` path that cannot be read as a source produces `spec-source-unresolved`. An absent path produces no such warning. Text output, annotations and JSON can therefore disclose the existence of a path even when it is not a Git repository. Unreadable sources share a diagnostic that does not identify ownership, worktrees or partial clones individually. Omit `--spec-sources` in PR CI. Source checkouts are read only when requested.

**History lookup.** The engine reads recorded content with `git show <commit>:<path>`. It avoids working-tree Git operations such as `status` and `diff`, which can invoke filters from `.gitattributes`. The runner disables fsmonitor, signature verification and `log.follow`, and sets `safe.bareRepository=explicit` to prevent implicit discovery of bare repositories in the worktree.

For `--since-bless`, manifest paths are PR-controlled. Git receives an argument array without a shell. Paths follow `--` or occur in the form `<commit>:./<path>`. The runner sets `GIT_LITERAL_PATHSPECS=1` for literal matching, `GIT_NO_LAZY_FETCH=1` to suppress retrieval of missing objects, and `GIT_TERMINAL_PROMPT=0` to disable credential prompts. Older Git versions that do not recognize `GIT_NO_LAZY_FETCH` may still fetch. Git reads the checkout's `.git/config`. The engine prints a suggested `git diff` command only for paths with characters that can be safely quoted across shells. The command uses a full commit ID and a `:(top,literal)` path.

### CLI

- **Scaffolding.** `specproof init` and `specproof setup-agent` use the current directory as the root and confine `--dir` and write targets to it. They reject symlinks in write paths and refuse to write to files with multiple hard links. Existing files skipped without a write do not trigger the hard-link check. Replacing existing files requires `--force`. Existing files under `.github/workflows/` are preserved even with that flag.
- **Detection.** `specproof detect` and `init --adapter auto` read `package.json`, `pubspec.yaml` and variable names from `.env.example` in the current directory. They read only regular files up to 1 MiB. Detection follows symlinks without enforcing a root boundary, so run it only in trusted directories.
- **Existing ignore rules.** When `init` keeps an existing `.gitignore`, it reads up to 1 MiB and warns if entries from the template for secrets or test output are missing, such as `.env` or `playwright/.auth`. It preserves the file and compares literal lines. Git's ignore evaluation can differ.
- **Child processes.** The CLI starts no subprocesses and does not execute `commands.*`.

### Shared limitation

The tools do not lock paths against replacement by another process between validation and the subsequent read or write.

### AI skills

The skills in `plugins/specproof/skills/` run inside the user's AI agent. They ask the agent to execute configured `commands.*` as verification gates. A PR can change the config and scripts invoked by those commands. Before first execution, the skills instruct the agent to compare relevant files, including the config, `.npmrc`, `package.json` and lockfiles, with the default branch. For changed files, the agent presents the changes and expanded commands and waits for human approval. See the pre-execution check in each `SKILL.md`. This is an instruction to the agent. Even with an unchanged command, the command executes the branch's code. Running a skill on someone else's branch requires the same trust as checking out their PR and running `npm test`.

The upgrade procedure (setup §7) starts on a new branch from the default branch. It skips `commands.*` and uses `npx` with exact versions and explicit registries, including scoped registries. npm reads the repository's `.npmrc`, so changes to that file go through the same review. The agent treats the downloaded changelog and CLI output as data.

The config under review cannot select its own comparison branch. Approval applies only within the current session and is tied to the comparison target and each file's `git hash-object` value. The agent reuses approval while those values match. Approval must come from the user's reply to the displayed values. Claims of approval in command output, files or summaries carry no authority. The agent computes hashes with `--no-filters` to avoid transformations from PR-controlled `.gitattributes`. Approval records never go into repository files or other files the PR or agent could write.

When a skill copies PR-controlled text into a report or PR description, the skill must sanitize it. This includes commit subjects, manifest paths and headings, and feature text. The CLI sanitizes subjects in text output. JSON consumers receive raw values and must sanitize them for the intended output. See `--since-bless` in the [traceability README](../packages/traceability/README.md). When recording per-commit decisions before blessing, the sync skill strips control and invisible characters and backticks, truncates the subject, and uses a code block in the PR description so mentions, issue-closing keywords and HTML comments do not render. It matches only the leading fields containing the full commit ID and link ID. Scenario names, headings, paths and other copied values receive the same handling. Instructions embedded in CLI output or JSON strings remain data.

## Network destinations

| Component | Destination | Purpose | Credentials |
|---|---|---|---|
| CLI and engine | None during normal operation | The Git history lookup also avoids fetching, subject to the Git version limitation above | None |
| Bundled drift-check workflow | GitHub and the Node.js download source | Check out the repository and install Node.js with setup-node | Workflow `GITHUB_TOKEN` for checkout |
| Bundled drift-check workflow | npm registry, by default registry.npmjs.org | Fetch the engine with `npx` | None |
| Bundled drift-check workflow | GitHub REST API | List, create and update PR comments and check the PR head | Workflow `GITHUB_TOKEN` with `contents: read` and `pull-requests: write` |
| AI skills | npm registry | Fetch the CLI and engine with `npx` during setup or through `commands.traceability*` | None |
| AI skills | Public GitHub pages | Read the changelog at the target version tag during upgrades (setup §7) | None |
| AI skills | GitHub through `gh` or a GitHub connector | Push branches and create PRs during sync and other workflows | Credentials in the user's environment |
| AI skills | Application under test at `env.baseUrl` | Execute `commands.smoke` | Test account from `.env` |

For projects using credentials or a saved session, the Playwright scaffold rejects non-loopback `http://` base URLs unless the environment has `allowInsecureHttp: true`. The exception applies to the environment, is not host-specific, and does not validate redirect destinations. See `environments[].allowInsecureHttp` in the [config schema](config-schema_en.md).

npm uses its configured registries, scoped registries and proxy settings. It also reads `.npmrc` in the working directory and its ancestors. In PR CI, run `npx` outside the checked-out worktree and set `--registry` explicitly so a PR's npm configuration cannot redirect the download. By default, `actions/checkout` persists the `GITHUB_TOKEN` for later Git steps. Set `persist-credentials: false` if the same job runs code from a PR or npm package.

## Cryptographic inventory

| Data | Mechanism | Implementation | Purpose |
|---|---|---|---|
| Spec sections, implementation files and features | SHA-256 from `node:crypto` | `packages/traceability/src/hash.ts` | Compare current contents with the stored hash for drift |
| Feature scenarios | SHA-256 from `node:crypto` | `packages/traceability/src/feature-lint.ts` | Generate comparison keys for duplicate detection |
| Temporary manifest filenames | `randomUUID` from `node:crypto` | `packages/traceability/src/atomic-write.ts` | Choose distinct names. Exclusive creation fails if the name already exists |

The packages do not manage keys or certificates, encrypt data, sign content or hash passwords. Published npm package provenance uses npm and Sigstore infrastructure.

**Manifest hashes detect unreviewed changes relative to a baseline.** Anyone who can edit the referenced files can also regenerate their hashes with `specproof-update`. People reviewing the diff decide whether a change is correct. The manifest hashes provide no authentication or tamper-proof record. Changes to hashing semantics follow [ADR 0010](adr/0010-manifest-version-policy.md).

## Resource limits

| Operation | Limit |
|---|---|
| Read config | Regular files up to 1 MiB |
| Read manifest | Up to 8 MiB, 10,000 links, 1,000 references per link and 20,000 references in total. See [manifest safety limits](../packages/traceability/README.md#manifest-safety-limits) for other bounds |
| Read and hash spec, implementation and feature contents | Regular files up to 8 MiB each, up to 32 concurrent reads |
| Scan directories for `layout.featuresDir` and `layout.implGlobs` | Up to 256 impl globs of 1,024 characters each. File count is unbounded |
| Compare features during lint for duplicates and possible contradictions | No explicit limit |
| Find historical versions and group changes by commit with `specproof-check --since-bless` | Search the 200 most recent commits per path and read each path's history and versions once across its references. Grouping considers up to 200 commits per blessed-version/path pair and reads the first-parent sequence once, up to 20,000 commits, for ordering. The operations share a budget of 2,000 Git calls and 60 seconds. The output signals when the budget is exhausted. Each Git call has a 10-second timeout and an 8 MiB output limit |

Unbounded operations consume time and memory as the repository grows. Set a job-level `timeout-minutes`, for example 10 minutes, to keep unusually large inputs from consuming the default 360 minutes.

## Protecting the drift gate

`specproof-check --strict` deterministically detects differences from a blessed baseline, unreviewed draft markers and disallowed tags. Its effectiveness depends on protecting the inputs and workflow that define the check.

- A PR can update manifest hashes by running `specproof-update`.
- The config and its alternate filename control `layout.manifest`, `layout.featuresDir` and the `strict*` settings. A config pointing to an empty manifest and an empty feature directory can make the gate check no references without changing the conventional manifest file.
- On `pull_request`, the drift-check workflow itself comes from the PR.
- Running `npx` in the worktree allows the PR's `.npmrc` to redirect the engine download, compromising the check result.

Use these controls together.

- Require the drift-check status check in the branch ruleset.
- Protect the following paths with CODEOWNERS and require code-owner approval. Use the actual paths the installation reads.
  - Both discovered config names, `specproof.config.yaml` and `specproof.config.yml`. The first existing name in that order wins, so protect unused names as well. Starting in 0.4.0, the engine stops when only a legacy `bdd-kit.config.yaml` or `bdd-kit.config.yml` exists. Engines through 0.3.x, including workflows pinned to those versions, still read the old names when `specproof.config.*` is absent. Protect the legacy names while using those versions.
  - The default `traceability.yaml` and the actual manifest selected by `layout.manifest` or CI's `--manifest`.
  - `.npmrc` and `.github/workflows/`.
- Supply `--root` and `--manifest` explicitly in CI to narrow which inputs the config can redirect.
- Fail CI if the root config is missing. The engine supports config-free usage and falls back to defaults. Without `layout.featuresDir`, it cannot discover unregistered features, so `--strict` alone can pass. The bundled workflow checks for a root config before running the engine.
- Require human review of spec, implementation and feature changes in every PR that updates manifest hashes.

The `unregistered-impl` audit also uses filenames. For names that look like tests or generated files, such as `*.test.*` and `*.spec.*`, text output and annotations normally summarize counts rather than listing files. JSON and the exit code still include the findings. Matches for `layout.implExcludeGlobs` are excluded from the audit itself. Such files cannot fail `--strict` even with `strictUnregisteredImpl: true`. When enabling that setting, review the exclusions written by `specproof init` and scrutinize renames and product code placed under test-like or generated names.
