# Flutter adapter readiness 検証サマリ（Phase 5 必読）

## 決定（実証済み・2026-06-06）

**採用: `flutter_gherkin` 3.0.0-rc.17（日本語 Gherkin 完全対応）。bdd_widget_test は不採用。**
sample-flutter-app（Flutter 3.44.1 / Dart 3.12.1）で日本語シナリオ（`# language: ja`・機能/シナリオ/前提/もし/ならば）が
build_runner 生成 → `flutter test` で **green** を実証。実装は `templates/flutter/` + `specproof init --adapter flutter`。
実機検証で確定した必須レシピ（落とし穴）は `templates/flutter/README.md` の規約表を参照:
別 `bdd_tests/` パッケージ / `flutter create --platforms=macos .` で実行先用意 / `Future<void> main() async` + 生成 runner を
直接 `await`（rc.17 の `executeTestSuite` は fire-and-forget で `group()` エラー） / `build.yaml` の sources に
`integration_test/**.dart` / Dart 識別子は ASCII・日本語は RegExp 内 / build_runner 2.4.x pin。

以下は Phase 0 時点（実装前）の調査サマリ。

---

Phase 0 で `bdd_widget_test` + `Patrol` を実地調査（context7 + 公式 docs）し、
adapter contract が「方法論・traceability エンジンを無改変のまま Flutter を載せられるか」を
adversarial に検証した結果。**結論: 現 contract のままでは不十分（adequate: false）。**
ただし不足はすべて `flutter:` セクションと scaffold template の追加で吸収可能で、
**①エンジン・②方法論の改変は不要**。

出典: pub.dev/bdd_widget_test, github.com/olexale/bdd_widget_test, patrol.leancode.co,
context7 `/olexale/bdd_widget_test` `/leancodepl/patrol`。

## 最重要ブロッカー: 日本語 Gherkin 非対応

`bdd_widget_test` は `dart_gherkin`/`flutter_gherkin` に依存せず**独自パーサー**を持ち、
`bdd_line.dart` に英語キーワード（`Feature:` `Scenario:` `Given` `When` `Then` `And` `But` …）
のみハードコード。`# language: ja` ディレクティブの解析は存在せず、`機能:` `シナリオ:` `前提`
`もし` `ならば` `かつ` は parse 失敗するか黙殺される。

**対処は二択**:
- **(A) 前処理**: `commands.preprocess` で日本語キーワードを英語へ変換してから `build_runner`。
- **(B) 切替**: `flutter_gherkin`/`dart_gherkin`（Cucumber i18n 完全対応・`# language: ja` 可）を使う。

→ `flutter.gherkinParser: bdd_widget_test | flutter_gherkin` を config に持たせ、
skill が前処理要否を判断する設計にする。Phase 5 着手前に A/B を決定すること。

## codegen / step / traceability の要点

- **codegen**: `build_runner` の `FeatureBuilder` が `foo.feature` -> `foo_test.dart` を生成。
  `_test.dart` は **build のたびに上書き** されるので **commit せず CI で再生成**（`generatedTestPolicy: regenerate-on-ci`）。
- **step 束縛**: 実行時 regex レジストリ無し。step 文 -> lowerCamelCase 関数名へ**コンパイル時変換**
  （`I see {'0'} text` -> `iSeeText(tester, text)`、`step/i_see_text.dart`）。step ファイルは
  一度生成され**上書きされない**ので実装は保全される。keyword は lookup で無視される
  （`Given`/`When` 同文 -> 同一関数）。
- **traceability ハッシュ対象**: **`.feature` を hash する**（`_test.dart` は volatile なので不可）。
  → エンジンは `layout.featuresDir` を hash source にする現設計のままで正しい。

## contract に不足している capability（9 件・Phase 5 で `flutter:` に追加）

| # | 不足 | 追加案 |
|---|---|---|
| 1 | ja Gherkin 前処理の口 | `commands.preprocess` + `flutter.gherkinParser` |
| 2 | `@tag` が `patrolTest(tags:)` に自動伝播しない | `flutter.tagPropagationMechanism` + flutter idiomGuide |
| 3 | device farm 向け build-only モード | `commands.buildArtifact`（`patrol build android/ios`） |
| 4 | CI で generate が smoke より先という順序保証 | `flutter.ciCommandOrder` or scaffold の CI YAML で構造的に担保 |
| 5 | traceability hash source が `.feature` である明記 | contract §4 に明記 + `flutter.traceabilityHashSource: feature` |
| 6 | `bdd_hooks/`（beforeAll 等）の配置 | `layout.hooksDir`（default `bdd_hooks`） |
| 7 | `build.yaml` の sources に `integration_test/**` 追加が必須 | `flutter.buildYamlSources` + scaffold が build.yaml を同梱 |
| 8 | flavor（build-time）と auth role（runtime）の直交性が projects[] で表現不可 | `flutter.flavors` を projects[] と分離、`projects[].flavor` を追加 |
| 9 | `{}` パラメータは Dart リテラル必須（任意文字列は compile-fail） | `flutter.parameterLiteralPolicy` + bootstrap が feature に注記 |

## Patrol が web には無い native capability

permission ダイアログ（`grantPermissionWhenInUse` 等）/ システム通知 / WebView /
クロスアプリ（OAuth）/ 接続・ダークモード制御 / native sharding（Firebase Test Lab・
emulator.wtf）/ `patrol develop` hot-restart。これらは `flutter.nativePermissions` 等で
表現する（Phase 5 で required/optional を確定）。

## Phase 5 着手前チェックリスト

- [ ] gherkin 戦略 A（前処理）/ B（flutter_gherkin）を決定
- [ ] `flutter:` セクションの 9 capability を required/optional 確定（config の TODO ブロック）
- [ ] flutter scaffold template に `build.yaml`（sources 含む）/ `pubspec` devDeps / CI YAML を同梱
- [ ] flutter idiomGuide（PatrolTester + step 命名 + tag 伝播）を著す
- [ ] sample Flutter app で drift -> sync -> implement が green になることを dogfood
