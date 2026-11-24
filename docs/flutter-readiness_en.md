# Flutter adapter status

English | [日本語](flutter-readiness.md)

The bundled runner uses `flutter_gherkin: 3.0.0-rc.17` for Japanese Gherkin and pins `build_runner` to `>=2.4.0 <2.5.0`. The sample passed on Flutter 3.44.1 and Dart 3.12.1 on June 6, 2026. A current app or SDK requires a new run.

Initialize with `npx @pound79/specproof init --adapter flutter`. Follow the [template guide](../templates/flutter/README_en.md) for prerequisites, platform setup, generation, execution, both language settings, ASCII identifiers and hashing source features. See the [configuration schema](config-schema.md) and the [adapter contract](adapter-contract.md) for configuration and responsibilities.

The full drift → sync → implement cycle in a production Flutter application still needs validation, and a dedicated idiom guide remains open. Patrol tag propagation, build-only runs, native permissions and flavors are proposals. The [original investigation](history/2026-06-06-flutter-readiness.md) records rejected parsers and early capability proposals.
