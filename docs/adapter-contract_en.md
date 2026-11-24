# Adapter contract

[日本語](./adapter-contract.md) | English

The [configuration reference](./config-schema_en.md) defines types, required keys and compatibility. The two adapter templates supply working values and their READMEs describe how to run them.

## 1. How adapters work

The orchestrator, setup, bootstrap, new-feature, sync and implement skills are Markdown instructions. A consuming repository declares its capabilities in one `specproof.config.yaml`. The agent resolves placeholders from it at runtime, so each repository can use the distributed skills unchanged. The engine shares its hashing algorithm across adapters, and selects the Gherkin parsing rules that match the runner.

## 2. Capabilities

| Capability | Contract |
|---|---|
| Commands | Run generation, type checking, lint and smoke commands from the repository root. The adapter supplies the command strings. |
| Layout | Paths are repository-relative. Track the source `.feature`, including for code-generating runners. |
| Language | Keep the configured Gherkin language consistent with the file directive, e.g. `# language: ja`. Flutter uses `flutter_gherkin` for Japanese support. |
| Tags | State tags are fixed across adapters: `@draft`, `@red-contract`, `@human`, `@out-of-scope`. Reason lint and the static done gate depend on them. |
| Projects | Projects select authentication roles independently of environment and scenario attributes. |
| Step and page-object idioms | Point `layout.idiomGuide` at an existing guide relative to the consumer root. No Flutter-specific guide is bundled. |
| Environment variables | `env` names the logical inputs. Supply the values through the consumer's shell or CI. Keep credentials out of configuration and logs. |
| Adapter identity | `adapter` selects `playwright` or `flutter`. `bddRunner` and `bddGenTool` identify the BDD runner and generator. |
| Conventions | Resolve `stepFrameworkPattern` and `pendingStubBody` using the consumer's configuration and real steps. |
| Environments | Follow the environment selection order in the configuration reference. Flutter runtime switching is the responsibility of the consumer's CI or scripts. |

## 3. Playwright and Flutter

Use the [Playwright configuration](../templates/playwright/specproof.config.yaml) and [Flutter configuration](../templates/flutter/specproof.config.yaml) for command and layout values. The [Flutter README](../templates/flutter/README.md) covers SDK prerequisites, dependency pins, generation, execution and step definitions.

The Flutter-specific section contains six declarations for the skills:

| Key | Value or purpose |
|---|---|
| `gherkinParser` | `flutter_gherkin`, supporting Japanese Gherkin |
| `testEntry` | Repository-relative path to the suite entry point |
| `device` | Desktop target, device or emulator ID |
| `buildRunnerPin` | `>=2.4.0 <2.5.0` |
| `buildYamlSources` | Source patterns declared in `build.yaml` |
| `traceabilityHashSource` | `feature` to hash source features and exclude generated files such as `*.g.dart` |

The engine does not launch the Flutter runner. Native Patrol interaction, flavors and tag propagation are proposals, with no corresponding bundled configuration.

## 4. Traceability engine

`discoverConfig` produces the configuration consumed by `checkDrift`, `updateManifestHashes` and the CLIs.

| Input | Use |
|---|---|
| `layout.manifest` | `manifestPath` |
| `layout.pagesDir` | `buildDomainList` candidate discovery |
| `layout.candidateSuffix` | Suffix for untracked pages in `specproof-list`, default `Page.tsx` |
| `layout.featuresDir` | Scan for drafts and unregistered features, and count scenarios with `specproof-stats` |
| `layout.implGlobs` | Scan for files absent from all links' `impl` lists. Omitting the key disables this scan. |

`layout.specDir` is a skill reference. Paths in a link's `spec`, `impl` and `features` are relative to the repository root. Other engine inputs include the syntax flavor and language, advisory exclusions, strict options and configured spec sources.

## 5. Resolution

1. Skills start by locating the root configuration.
2. Missing required keys stop the applicable skill. An optional key uses only the fallback specified for that step, e.g. a disclosed self-review when reviewers are absent. CLI discovery follows `packages/traceability/src/config.ts`.
3. Use the `flutter` block for the Flutter adapter.
4. Without `commands.traceability*`, use the corresponding `npx -y -p @pound79/specproof-traceability specproof-*` command. See the [CLI reference](../packages/traceability/README.md#cli).
5. Resolve `{{config:auth.provider}}` and `{{config:auth.description}}` from the selected environment's `auth`. Declare at least one environment. There is no top-level `auth`.

## 6. Adding an adapter

1. Extend the `Adapter` type and detection signals in `cli/src/detect.ts`.
2. Register the adapter and its default directory and next steps in the scaffold CLI.
3. Add a working package and `specproof.config.yaml` under `templates/<adapter>/`.
4. Declare any necessary adapter-specific capabilities, as Flutter does in its `flutter` block.
5. Accept the adapter in `packages/traceability/src/config.ts` and select a Gherkin parser compatible with the runner. Different syntax also requires scanner changes and tests.
6. Register new keys in the configuration reference and `config-keys.ts`, then check related skill branches and real generation and execution.

Selecting an external template with `--adapter-dir <path>` remains a proposal.
