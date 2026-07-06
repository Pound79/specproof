# specproof Flutter adapter (flutter_gherkin + 日本語 Gherkin)

`flutter_gherkin` ベースの BDD 振る舞いテスト足場。**日本語 Gherkin（`# language: ja`・機能/シナリオ/前提/もし/ならば/かつ）がキーワードも step テキストも通る**唯一の実用構成。Flutter 3.44.1 / Dart 3.12.1 で green 実証済み。

> なぜ flutter_gherkin か: `bdd_widget_test` はパーサが英語専用で、さらに step 名生成が `\w`（ASCII限定）で日本語を全 strip するため日本語不可。`flutter_gherkin` は `dart_gherkin` の `ja` dialect で日本語を完全サポート。代償は rc.17 で保守停滞（バージョン pin で対処）。詳細は kit の `docs/flutter-readiness.md`。

## 前提

- Flutter 3.44+ / Dart 3.12+
- **Node.js 24+** — traceability CLI（`npx -y -p @pound79/specproof-traceability specproof-check` 等）を使うため。
  Flutter 専業のリポでも traceability コマンドは Node 製なので Node が必要（`specproof.config.yaml`
  の `commands.traceabilityCheck` / `traceabilityUpdate` / `traceabilityList` を参照）。

## セットアップ（`specproof init --adapter flutter` 後）

1. **別パッケージ構成**: この足場は `bdd_tests/`（アプリ本体とは別 pubspec）。アプリ本体に直接入れると依存衝突（gherkin の uuid^3 ↔ geolocator 等の uuid>=4、mockito 由来の analyzer/source_gen）。

2. **実行先プラットフォームを用意**（headless 実行に必須・別パッケージには runner が無いため）:
   ```bash
   cd bdd_tests && flutter create --platforms=macos --project-name bdd_tests .
   ```
   （CI/実機なら `--platforms=ios,android` 等。macOS desktop が最も手軽な headless 先）

3. 依存解決 → 生成 → 実行:
   ```bash
   cd bdd_tests
   flutter pub get
   dart run build_runner build --delete-conflicting-outputs   # .feature -> *.g.dart（日本語を build 時パース）
   flutter test integration_test/gherkin_suite_test.dart -d macos
   ```

4. **アプリの実画面をテストする場合**: `pubspec.yaml` でアプリへ `path: ..` 依存を追加し、`dependency_overrides: { uuid: ">=4.0.0 <5.0.0" }` を有効化。`appMainFunction` で実アプリの `main()` を起動。

## 必ず守る規約（実機検証で確定した落とし穴）

| # | 規約 | 理由 |
|---|---|---|
| 1 | `Future<void> main() async` で**生成 runner を直接 `await`**（`executeTestSuite` は使わない） | rc.17 の `executeTestSuite` は `void` で runner を fire-and-forget → 新 integration_test で `Can't call group() once tests have begun running`。await すると宣言フェーズが main の Future 完了まで維持される |
| 2 | `@GherkinTestSuite(featureDefaultLanguage: 'ja')`（build時）+ `FlutterTestConfiguration(featureDefaultLanguage: 'ja')`（実行時）の**両方** | build 時コード生成と実行時パースで別々に言語が要る |
| 3 | `build.yaml` の `sources` に **`integration_test/**.dart` 必須** | 無いと build_runner が `@GherkinTestSuite` を発見できず**黙って 0 出力** |
| 4 | step 定義の **Dart 識別子は ASCII**。日本語は **RegExp 文字列内のみ** | `final ログイン = given(...)` は `Illegal character`。`final openLogin = given(RegExp(r'^前提 ...$'), ...)` |
| 5 | step パターンは**キーワード込みの全行**を意識（`^前提 ...$`）。非アンカーにすれば前置キーワード有無に頑健 | matcher は keyword を含む行に対して評価する |
| 6 | traceability は **`.feature` を hash**（生成 `*.g.dart`/`*_test.dart` は対象外） | 生成物は build artifact。source が単一の真実 |
| 7 | `flutter_gherkin: 3.0.0-rc.17` と `build_runner: ">=2.4.0 <2.5.0"` を**pin** | rc.17 は最終リリース。build_runner は transitive 制約で 2.4.x 必須 |

## ファイル構成

```
bdd_tests/
├── pubspec.yaml                         # flutter_gherkin rc.17 / build_runner 2.4.x / (任意で app path 依存 + uuid override)
├── build.yaml                           # sources に integration_test/**.dart
└── integration_test/
    ├── gherkin_suite_test.dart          # @GherkinTestSuite + async main + 生成 runner を await（規約1,2）
    ├── features/counter.feature         # 日本語 Gherkin の例
    ├── steps/counter_steps.dart         # class ベース step（ASCII識別子・日本語は RegExp 内）
    └── app/counter_app.dart             # 自己完結ウィジェット例（実アプリ画面に差し替え可）
```

実アプリの画面をテストするときは `counter_app.dart` を消し、`appMainFunction` でアプリの `main()` を起動して `features/`・`steps/` を書く。

## BDD 方法論の参照ポイント

specproof-* skill は `{{config:layout.e2eReadme}}` としてこのファイルを参照する。詳細は
`docs/methodology.md` を参照（ここは要約 + リンク、複製ではない）。

### 変更起点別フロー

- spec-first: `/specproof-new-feature` または `/specproof-sync` で feature + stub step を作成 → `/specproof-implement` で緑化 → bless
- feature-first: 人が `.feature` を直接編集 → `/specproof-implement` で緑化 → bless
- impl-first: `/specproof-bootstrap`（**一度きり**。次項参照）

### bootstrap は一度きり・実装変更後の追従経路

`/specproof-bootstrap` は既存実装からドメインの feature を**一度だけ**起こす。既存 feature の
再生成には使わない（実装のコピーになり、壊れたら赤くなるというテストの役目を失う）。
実装変更を feature に追従させるときは `specproof-check`（drift 検知）→
`/specproof-sync`（差分反映・既存シナリオは消さない）→ `specproof-update`（bless）の順で行う。

### 仕様の置き場所 と 「テストが難しい ≠ 観測不能」

振る舞いは「自動化の難易度」ではなく「ユーザーが観測可能か」で仕分ける: 観測可能なら
`.feature` に残す（自動化が難しければ `@fixme`/`@skip` + 理由コメント）。観測不能
（ステータスコード契約・内部定数・非機能要件など）だけを rationale doc へ回す。
「テストが難しい」だけを理由に rationale へ逃がさない。

### なぜ層ドキュメント（rationale doc）の規約

rationale doc は**人間が書く。自動生成しない。** 実装からの自動抽出は行番号の写しや
根拠の捏造になり、specproof が防ごうとしている仕様書の腐敗を再生産する。
