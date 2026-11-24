# Flutter adapter

English | [日本語](README.md)

This scaffold uses `flutter_gherkin` to read Japanese Gherkin keywords and step text. The sample passed on Flutter 3.44.1 and Dart 3.12.1 on June 6, 2026. Run the suite again on your SDK, device and app revision. The alternative `bdd_widget_test` parser reads English and strips non-ASCII characters from generated step names. The included runner supports the Japanese dialect but depends on the pinned release candidate.

## After initialization

Use Flutter 3.44+, Dart 3.12+ and Node.js 24+. The framework-independent traceability commands use Node even in a Flutter-only repository. See `commands.traceabilityCheck`, `traceabilityUpdate`, `traceabilityList` and `traceabilityStats` in the root configuration.

1. Keep the generated `bdd_tests/` package separate from the app. The runner and application can require incompatible versions of uuid, analyzer and source_gen.
2. Create a platform runner. From the repository root:

   ```sh
   cd bdd_tests
   flutter create --platforms=macos --project-name bdd_tests .
   ```

   Substitute `ios,android` when targeting those devices.
3. In the same package directory, resolve dependencies, generate the suite and run it:

   ```sh
   flutter pub get
   dart run build_runner build --delete-conflicting-outputs
   flutter test integration_test/gherkin_suite_test.dart -d macos
   ```

   The suite always excludes `@draft`, `@human` and `@out-of-scope`. An eligible `@red-contract` runs and stays red until implemented. `@red-contract @human` remains pending for human verification. To narrow the selection, pass a Gherkin expression such as `--dart-define=SPECPROOF_TAGS="not @slow"`. The suite combines it with the fixed exclusions in `FlutterTestConfiguration.tagExpression` and rejects expressions with unbalanced parentheses or state tags. See the configured smoke command for your project.
4. To test the real application, add a path dependency on the app (`path: ..`), enable `dependency_overrides: { uuid: ">=4.0.0 <5.0.0" }` as required, and call its `main()` in `appMainFunction` in place of the bundled counter widget.

## Runner conventions

| Setting | Why it matters |
|---|---|
| Await the generated runner directly from `Future<void> main() async`. | The rc.17 `executeTestSuite` returns void. Fire-and-forget registration can cause “Can't call group() once tests have begun running.” |
| Set `featureDefaultLanguage: 'ja'` on both `@GherkinTestSuite` and `FlutterTestConfiguration`. | Generation and runtime parse the feature separately. |
| Include `integration_test/**.dart` in `build.yaml` sources. | Otherwise build_runner can finish without generating any output. |
| Use ASCII Dart identifiers and put Japanese text in the step regular expressions. | A Japanese identifier can produce an illegal-character error. |
| Match the complete step line including the keyword, or use an unanchored expression when appropriate. | The runner includes the keyword in the matched text. |
| Track the source `.feature` files. | Generated Dart files are build artifacts. |
| Use `flutter_gherkin: 3.0.0-rc.17` and `build_runner: ">=2.4.0 <2.5.0"`. | These pins keep generation compatible with the runner. |

`integration_test/gherkin_suite_test.dart` is the entry point. The sample feature, step definitions and application live in `integration_test/features/`, `integration_test/steps/` and `integration_test/app/`. Replace the counter example with your application and steps.

## Drift checks and BDD

Make the generated `specproof-check --strict` workflow a required check. Protect both configuration filenames, the manifest, `.npmrc` and workflows with CODEOWNERS. A PR can change the baseline or the check itself. The workflow fails if the configuration is absent. See the [security model](https://github.com/Pound79/specproof/blob/main/docs/security-model_en.md).

Start from a spec with `/specproof-new-feature` or reconcile changes with `/specproof-sync`. Use `/specproof-implement` for reviewed RED features. Bootstrap from existing code once per domain. After implementation changes, check drift and reconcile against the spec; a change to observable behavior requires a human decision. Review each affected link before blessing it with `--link-id`.

Keep observable behavior in the feature, including pending or human-verified conditions. Mark exclusions with `@out-of-scope` and a reason. A human writes the rationale for internal constraints and non-observable requirements. See the [methodology](https://github.com/Pound79/specproof/blob/main/docs/methodology_en.md).
