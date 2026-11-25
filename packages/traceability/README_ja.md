# @pound79/specproof-traceability

[English](./README.md) | 日本語

仕様の見出し、実装ファイル、Gherkin feature の参照を manifest に登録し、それぞれの SHA-256 の変化を検出する Node.js パッケージ。AI を使わず、実行時の依存は `yaml` だけ。

## インストール

```bash
npm i -D @pound79/specproof-traceability
```

Node.js 24 以上が必要。

## CLI

各コマンドはリポジトリのルートから設定と manifest を探索する。

```bash
npx specproof-check --json
npx specproof-list
npx specproof-stats
```

- `check` は登録した参照のハッシュを比べ、リンクごとに drift を報告する。drift したリンクが 1 つでもあれば終了コード 1 で終わるので、CI を drift で失敗させられる。`--strict` は未査読のドラフト、空のリンク、不正なタグなども検査する。
- `list` は登録済みのドメインと未登録ページの候補を列挙する。
- `update` はレビューした変更を新しい基準にする。例の login は対象リンクの ID に置き換える。ID を指定しない更新は全リンクに適用される。

```bash
npx specproof-update --dry-run --link-id login
npx specproof-update --link-id login
```

- `stats` は静的なシナリオ集計を行う。`--strict` は実装待ち・禁止タグ・入力の欠落があれば失敗する。所在を確認できない登録 feature と設定した探索ディレクトリは JSON の `missingFeatures` / `missingFeaturesDir` に現れる。`--manifest` で明示したファイルが存在しない場合、`--strict` の有無にかかわらず終了コード 2 になる。実行済みの GREEN はランナーの結果、人が確認した条件はチームの記録で確かめる。同梱の CI は `specproof-check --strict` を実行する。静的な完了条件をマージ条件にするには `specproof-stats --strict` を追加する。
- 仕様に未決の問いがあるなら、その ID を `@question:<ID>` としてシナリオ、Feature または Rule に付ける。stats の `questions: [{ id, scenarios, features }]` で問いごとに件数（Outline は 1 条件）と feature を引ける。ID は空白を含めず、大文字小文字を区別する。実行や完了条件は変わらない。答えを反映したらタグを外す。

状態タグの名前は固定。壊れたテストは修正まで RED のまま残す。`@skip` / `@fixme` / `@fail` は検証を飛ばしたり、失敗を期待値に変えたりするので、check は `disallowed-tag`、stats は strict 失敗にする。`tags.fixme` / `tags.skip` の別名設定も拒否する。

`@out-of-scope` はシナリオに直接付け、直前に理由コメントを書く。Feature・Rule・Examples からの継承は `missing-reason`。Examples の状態タグや、同じシナリオでの実装待ちと対象外の併記は stats が拒否する。

runner は `@draft` / `@human` / `@out-of-scope` を除外し、`@red-contract` は選択されたシナリオで実行する。project のロール条件、CLI の `--grep`、smoke の `tags.slow` による絞り込みは通常どおり適用する。`@red-contract @human` は人が確認して外すまで実装待ち。Playwright の環境別除外タグは `/^@[^@\s()]+$/` に合う単一タグ。状態タグの除外はできず、project のタグ式と Flutter の `SPECPROOF_TAGS` は状態タグの参照と不均衡な括弧を拒否する。CLI の `--grep-invert @red-contract` で実装待ちだけを除外して結果を GREEN にしない。

### 静的な phase / verification とケース数

`stats` の各 domain と totals は `total`（条件数）、`cases`、`phase: { draft, pending, complete }`、
`verification: { machine, human }`、`outOfScope`、`disallowed` を返します。
`disallowed` は使えないタグ（`@skip` / `@fixme` / `@fail`）が付いた条件の数です。
レポート全体の `done` は `@red-contract`（pending）と使えないタグがともに 0 件で、入力の欠落もないとき `true` です。
Outline は条件として1件、ケースは複数 Examples の全データ行を合計します。通常 Scenario は1ケースです。
Playwright の runner と同じく、Examples が無い Outline も1ケースと数えます。
Examples が存在してデータ行が無い場合は0ケースです。Flutter の runner は Examples が無い Outline を拒否します。

同じ実体の feature を複数の link や repo 内のシンボリックリンク経由で登録しても、
lint と census は、それぞれ同じ実体を一度だけ読みます。表示する代表パスの選択規則は異なります。
`check` の lint は manifest の登録順で最初のパスを選び、その登録の `linkId` を警告に残します。
未登録の実体だけを `featuresDir` の探索結果から追加します。
`stats` の census は `featuresDir` があれば探索順で選び、未集計の登録 feature（ディレクトリの外も含む）を manifest 順に追加します。探索ディレクトリの設定が無ければ manifest の登録順です。
たとえば `features/alias.feature` だけを登録し、探索が同じ実体の `features/a.feature` を先に
見つける場合、lint の警告パスは `features/alias.feature`、census の domain は `features/a.feature` です。
別名を未登録や重複シナリオとは判定しません。
manifest の各参照に保存した hash は、それぞれ独立に検査します。

- phase: `@draft` は draft、`@red-contract` は pending、状態タグなしは complete。
- verification: `@human` は human、その他は machine。phase と別軸です。
- phase/verification の状態タグだけを Feature/Rule から継承し、次の Rule には前の Rule の状態を持ち越しません。
- 継承を含む `@draft` と `@red-contract` の併記、同じシナリオでの `@out-of-scope` と `@red-contract` の併記、
  Examples の `@draft` / `@red-contract` / `@human` / `@out-of-scope` はエラーです。Examples 行の状態を条件全体へ投影できないためです。

complete は状態タグなしという静的分類です。実行済み GREEN や正式な完了を示しません。

`outOfScope` と `disallowed` は runner と同じく Gherkin のタグ継承に従い、`effectiveTags`
（Feature・Rule・Scenario 自身・Examples のタグ。空行を挟んだタグも含む）で数えます。
Feature に付けた `@fixme` は配下の全シナリオを disallowed と数え、strict を満たしません。
一部の Examples だけに付いた使えないタグも、残件を見落とさないよう条件全体に数えます。
`@out-of-scope` の条件も `total` と phase/verification には含まれます。`done` の判定には影響しません。

`tags` は Scenario 自身の直前タグを返し、`@out-of-scope` の理由コメントの検査はこの範囲だけで
行います（理由コメントは、空行を挟まずシナリオの直前にある `# ...` 行）。
phase/verification は `effectiveStateTags` を使用します。
表示は domain ごとと TOTAL の 1 行ずつ（`N conditions / C cases; phase: ...; verification: ...;
out-of-scope O`）で、続けて `@red-contract` の残数、使えないタグが残っていれば `tags that switch scenarios off (@fixme / @skip / @fail) remaining: N` で始まる行を表示します。scanner は同梱 adapter の英語・日本語に対応し、閉じていない docstring と、それ以外の言語を
`# language:` で指定した feature は失敗させます。ファイルの言語は Feature 行のキーワードで決め、
その言語のキーワードだけを要素と step として読みます（runner も自分の言語で Feature 行を読めた
ときだけ解析するため）。`specproof.config.yaml` の `adapter` が `flutter` のときは、Flutter の runner
（Dart の gherkin）と同じ規則で読みます（キーワードの大文字小文字を区別しない、Rule が無いなど）。
宣言の無い feature は設定の `language` を既定の言語として読みます。runner が解析できない feature と、
Dart の gherkin が 1 つのタグとして読む空白を含むタグ（`@out-of-scope # 理由` など）は、
0 件や無効なタグとして通さず失敗させます。タグ行は Gherkin と同じく、空白に続く `#` 以降を
除いて `@` で区切ります（`@smoke@human` は 2 つのタグ）。
[ADR 0008](https://github.com/Pound79/specproof/blob/main/docs/adr/0008-flow-layer-separation.md)
で決めたシナリオ ID 台帳はまだ実装しておらず、この統計には含まれません。

### 構造上の警告

警告は `warnings[]` に入り、ハッシュの `clean` や `driftCount` には影響しない。strict のときだけ、設定で有効な種類を失敗扱いにする。

| kind | 意味 |
|---|---|
| `empty-link` | spec・impl・features の参照がすべて空。 |
| `unreviewed-draft` | 未査読のドラフトマーカーが残っている。 |
| `missing-reason` | 対象外の理由がない、または対象外タグを上位要素から継承している。 |
| `disallowed-tag` | 検証を止める、もしくは失敗を期待するタグを自分または上位要素が持つ。 |
| `unregistered-feature` | 探索ディレクトリ内の feature がどのリンクにも登録されていない。 |
| `features-dir-unset` | 設定ファイルに feature の探索先が指定されていない。設定ファイル自体がない場合は出ない。 |
| `features-dir-missing` | 設定した探索先が存在しない、またはディレクトリではない。 |
| `unknown-config-key` | エンジン・skill・テンプレートのどれも読まない設定名。値を出さずキーの経路を示す。 |
| `unregistered-spec-heading` | 登録済みの仕様ファイルに、同じ深さの未登録見出しがある。 |
| `unregistered-impl` | `layout.implGlobs` に該当する実装がどのリンクにも登録されていない。 |
| `duplicate-heading` | 同一ファイルの同じ深さに同名の見出しがあり、登録参照の節を一意に決められない。 |
| `missing-then` | 確認する step がない。 |
| `duplicate-scenario` | 同じ背景・step・引数（表や docstring）を持つシナリオが既にある。 |
| `step-order` | 前提・操作・確認の順序が前の段階に戻る。 |
| `duplicate-scenario-name` | 同一ファイルの同一 Rule 内に同名のシナリオがある。 |
| `possible-contradiction` | 前提と操作が同じで期待値が異なる。人が意図を確かめる。 |
| `spec-source-outdated` | 仕様の取り込み後に対象の内容が変わったか、現在の ref に対象パスが見つからない。 |
| `spec-source-unrecorded` | 取り込み元の記録がない。 |
| `spec-source-unresolved` | 取り込み元ディレクトリはあるが、リポジトリ、ref、記録済みコミット等を確認できない。 |

`unregistered-impl` と `unregistered-spec-heading` はそれぞれ `strictUnregisteredImpl`、`strictUnregisteredSpecHeadings` を有効にすると strict で失敗する。探索対象の粒度や、仕様と同居する用語集・改訂履歴で件数が増えやすいため、既定は参考扱い。実装 glob がなければ実装の探索はしない。

`strictFeatureLint` は `missing-then`、`step-order`、`duplicate-scenario-name`、`duplicate-scenario` を strict 失敗にする。矛盾候補と取り込み元の警告は有効化後も人の判断に委ねる。Outline と Examples 付きシナリオは重複・矛盾の比較から外す。`*` や「かつ」だけで種類を決められないときは順序・確認有無の検査をせず、対象外シナリオは確認がなくてもよい。

テキストと注釈では矛盾候補は 10 件、未知キーと未登録実装は各 20 件まで。超過分はグループ末尾に件数で示す。未知キーは走査自体が 100 件までで、以降には `truncated: true` の警告を 1 件添え、表示からも外さない。キーの経路は 200 文字までで末尾を `…` にする。JSON と strict の判定は表示上限を適用しない。テストや生成物らしい未登録実装も既定ではテキスト・注釈で件数にまとめる（`*.test.*`、`*.spec.*`、`__tests__`、`__mocks__`、`*_test.dart`、`*.g.dart`、`*.freezed.dart`、`*.mocks.dart`）。一覧には `--include-tests`、集計自体からの除外には `layout.implExcludeGlobs` を使う。strict で失敗理由になる項目は表示される。

JSON の各警告はこの設定下の `failsUnderStrict` を持ち、テキストは対応する `[warning]` / `[advisory]` を付ける。表示上限の前、テスト等を一覧から除いた後に件数を合計する。失敗にする種類と feature の執筆ミスは `To fix:`（厳格時に失敗するものが先）、それ以外は `For reference:` に表示する。GitHub 注釈も同順で、JSON は元の順番を保つ。

### JSON レポート

`clean`、`driftCount`、`driftLinkCount`、`entries`（リンク ID、side、パス、spec の見出し、保存・現在の hash、変更・欠落の状態）、`warnings` を返す。警告には `kind` とメッセージ、該当時のリンク ID・パスがあり、CLI が `failsUnderStrict` を加える。全参照のファイルが欠落すれば `allReferencesMissing` が真になり `bothSidesChanged` は空、それ以外では後者に spec と impl の両方が変わったリンクを示す。明示的な除外数は `excludedAdvisories`、履歴・取り込みのオプションを有効にしたときの追加キーは後述する。

### 更新のプレビュー

```
$ npx specproof-update --dry-run
login impl src/login.ts: a1b2c3d4 -> e5f6a7b8
history spec docs/spec.md § 2. History: PENDING -> 9c8d7e6f

Dry run — manifest not modified.
```

変更がなければ `No hash changes; manifest already up to date.` と表示する。

### CRLF と BOM

ハッシュ、見出し解析、ドラフトマーカーの検出は先頭の UTF-8 BOM を落とし、CRLF を LF に正規化する。導入前に CRLF を含む内容で計算した hash は次の check で差分になる。レビュー後に `specproof-update --link-id <id>` で対象だけを更新する。

### ATX 見出しの互換性

見出し一覧は前後の空白と末尾の閉じ `#` を除いた CommonMark の見出し名を返す。
旧版が返した `Account ##` のような表記も、既存 manifest の参照として読み取れる。
文書内に旧表記の完全一致があればそれを優先し、なければ正規化した名前で照合する。
たとえば `## Account ##` と `## Account ## ##` が共存するとき、旧参照 `Account ##`
を後者へ黙って移動させない。重複見出しの検査は正規化した名前で行う。
コードフェンスや HTML ブロック（コメントを含む）の中の見出しは節の境界にしない。version 1 の hash を維持するため、登録した節の範囲が新旧の規則で違う場合や、範囲を確定できない場合は check と update が停止する。例えば、単独の CR や UTF-16 で 65,536 コード単位を超える行があると、その行に掛かる節や、それ以降の節も検証できない場合がある。その行より前で終わる節には影響しない。

エラーに表示された行と構文を確認する。閉じ忘れたコメントを閉じる、コメント内の見出しに見える行を書き換える、単独の CR を LF に直す、長い行を分けるなど、原因に応じて仕様を修正する。登録した節全体が隠れている場合は manifest の参照を見直す。仕様の差分と対象の節を確認してから、そのリンクを更新する。check は保存済みの基準を変更しない。

### Manifest の保存と同時更新

`specproof-update` は変更した hash の値だけを原文へ反映し、コメント・空行・引用符・
未知の拡張キーを保持する。変更ゼロと `--dry-run` では保存しない。
更新は同じディレクトリの一時ファイルを完成させてから rename し、途中失敗で元ファイルを
破断させない。hash 以外まで変わる YAML alias は、安全に保存できないため拒否する。

読込後の変更は保存前に検査するが、検査と rename は OS レベルの compare-and-swap
ではない。同じ manifest への更新は順に実行する。異なる `--link-id` でも同時実行すると、
両方が成功したまま一方の hash 更新が失われる可能性がある。

### Manifest の版

manifest の `version` は、外部の読み手に向けた契約である。保存済みの hash の意味、既存のキーの
意味・型、必須のキー、番兵の値のいずれかを変えるときに上げる。省略できるキーの追加でも、既存の
キーの意味を変えるなら上げる。無視しても既存のキーの意味が変わらない追加では上げない。
規則と理由は [ADR 0010](https://github.com/Pound79/specproof/blob/main/docs/adr/0010-manifest-version-policy.md)。

この specproof が読み書きするのは version 1 だけ。知るより新しい version の manifest は、新しい
specproof が書いたものとして、specproof の更新を促すエラーで止まる（旧い規則で hash を取り直さない）。
旧い version からの移行の経路は、version を上げる変更と同じリリースで `specproof-update` に入れる。

### Manifest の criteria

0.3.0 以降、version 1 の各 `links[]` に `criteria?: string[]` を指定できる。

```yaml
version: 1
links:
  - id: login
    label: Login
    criteria: [AC-001, TC-1A-05-01]
    spec: []
    impl: []
    features: []
```

省略と空配列を許容し、両者を区別して保持する。各 ID は空でない不透明文字列で、
AC / TC 等の形式を固定せず、空白除去・大文字小文字変換・Unicode 正規化も行わない。
consumer 固有の ID 書式は consumer の設定が検査する。
不正型、空文字、C0 / DEL / C1 制御文字、Unicode の行区切り・段落区切り、
同じ link 内の ID 重複は拒否する。同じ ID を複数 link から参照する多対多は許容する。

`loadManifest` と、それを使う check/update は criteria を検査する。
`saveManifest` も新しい criteria の契約だけを書込み前に検査し、不正なら既存ファイルを変えない。
他の既存フィールドの形は従来どおり loader が検査する。
load/update/save、全件更新、`--link-id`、`--dry-run` で criteria とオブジェクトの未知キーを
保持する。dry-run はファイルの byte を変えない。update は YAML コメントと書式も保持する。
低レベルの `saveManifest(path, manifest)` は新規 YAML を生成する。
原文を保持した hash 更新には `loadManifest` の戻り値を第3引数の `original` に渡す。

criteria は条件と参照 link の対応であり、シナリオ ID 台帳・実行済み GREEN の証跡ではない。
hash と strict の検査は従来のまま行う。上の空参照の例は `check --strict` の empty-link に該当する。

### Manifest の安全上の制限

参照はハッシュを計算する直前に物理的なリポジトリルートとの位置を照合する。内部を指すシンボリックリンクだけを許し、切れたリンクや外部へのリンクを拒否する。検査後の別プロセスによる差し替えを排他するものではない。

| 入力 | 上限・要件 |
|---|---|
| manifest | 8 MiB |
| リンク数 | 10,000 |
| 参照数 | 1 リンク 1,000、全体 20,000 |
| 文字数 | パス 4,096、ID 256、ラベルと見出し 1,024 |
| 個々の参照ファイル | 各 8 MiB 以下の通常ファイル。FIFO・デバイスは開く前に拒否する。 |

リンク ID は一意。criteria の ID と同様に制御文字・区切り文字を含めない。ラベル・見出しはタブを許し、ラベル末尾の YAML ブロック由来の改行は保持するが、ラベル途中の改行は拒否する。`headingLevel` は 1〜6 の整数、既定は 2。hash は小文字 16 進 64 桁、初回の `PENDING`、旧 manifest 等の `FILE_MISSING` / `SECTION_MISSING` だけを受け付ける。それ以外は値を表示せず失敗する。欠落したファイル・見出しは bless できない。

ハッシュは差分を示す。参照ファイルと manifest を同時に書き換えられるので、変更の妥当性は差分をレビューして判断する。check と update は manifest 順を維持し、同時のファイル読み込みを 32 件に制限する。失敗時には待機中の読み込みを取り消す。

## ライブラリ API

```ts
import {
  checkDrift,
  updateManifestHashes,
  loadManifest,
  buildStats,
  discoverConfig,
} from "@pound79/specproof-traceability";
```

主な公開 API は `checkDrift`、`updateManifestHashes`、`loadManifest` / `saveManifest`、`buildStats` / `formatStats`、`buildDomainList`、`discoverConfig` と、ハッシュ関連の `computeFileHash`、`computeHeadingSectionHash`、`FILE_MISSING`、`SECTION_MISSING`、`DRAFT_MARKER`。

## 関連文書

[方法論](https://github.com/Pound79/specproof/blob/main/docs/methodology.md)・[設定](https://github.com/Pound79/specproof/blob/main/docs/config-schema.md)・[アダプター契約](https://github.com/Pound79/specproof/blob/main/docs/adapter-contract.md)。

## ライセンス

[MIT](./LICENSE) © Pound79

## CLI オプション一覧

| コマンド | 対応オプション |
|---|---|
| specproof-check | --root, --manifest, --strict, --json, --github-annotations, --since-bless, --spec-sources, --include-tests |
| specproof-update | --root, --manifest, --link-id, --spec-ref, --dry-run, --record-spec-source, --allow-head-mismatch |
| specproof-list | --root, --manifest, --pages-dir, --candidate-suffix, --json |
| specproof-stats | --root, --manifest, --strict, --json |

`specproof-update --link-id <id>` はそのリンクだけを bless する。`--link-id` は重ねて指定でき
（`--link-id a --link-id b`）、指定したリンクをまとめて bless する。同じ id は 1 つとして扱う。manifest に無い
id が 1 つでもあれば、manifest を書かずに失敗し、無い id をすべて示す。1 つの値に空白区切りで複数の id を
入れる書き方は受け付けない（1 つの id として扱われ、無い id として失敗する）。

`specproof-update --spec-ref '<path>#<見出し>'` は、その仕様の節の spec 側の hash だけを、それを参照する全リンクで
取り直す。共通の決まりを書いた節を多くのリンクが参照していて、変更がそれらのリンクに関係しないと確かめたときに
使う。impl・feature の hash と、ほかの節の hash は変えない。`<path>#<見出し>` は `layout.specHeadingIgnore` と
同じく最初の `#` で分ける。重ねて指定でき、`--link-id` と合わせるとそのリンクの中だけで取り直す。

- どのリンクも参照していない節や、見出しの無い指定があれば、manifest を書かずに失敗する
- 照合はパスと見出しを別々に比べる。manifest に保存した参照は空白を残したまま比べる（旧形式の見出し `##  X` の参照
  ` X` や、末尾に空白のあるファイル名は別の節・別のファイル）。パスは posix で正規化する（`./docs/x.md` と `docs/x.md`
  は同じ）。`--spec-ref` の値は全体の前後の空白だけを除き、`#` の前後に空白があれば失敗する。前後に空白のある
  保存済みのパス・見出しの参照は `--spec-ref` では選べないので、`--link-id` を使う
- 深さ（`headingLevel`）の違う同名の節に当たる指定は、どちらの節か決められないので失敗する
- パスに `#` を含む参照は、最初の `#` で分けるため `--spec-ref` では選べない（該当なしで失敗する）。`--link-id` を使う
- 取り直すのは、その節の hash が今の版と違うリンクだけ。それらのリンクで bless した版（保存済みの hash）が
  揃っていない、または `PENDING` なら、人が確かめた 1 つの変更として扱えないので、manifest を書かずに失敗する。
  そのときはリンクごとに確かめて `--link-id` で bless する
- impl も drift した（変わった・無くなった）リンクは書き換えずに飛ばし、`skipped link "<id>"` と示して終了コード 1 にする。spec 側だけを
  bless すると、次の `check` で「spec と impl の両方が変わった」が impl だけの drift に見え、`specproof-sync` が
  止まって人に聞く信号が消えるため。飛ばしたリンクは sync で決めてから `--link-id` で bless する
- `check` は、同じ節が 2 つ以上のリンクで drift したときに、テキスト出力で「Spec sections that drifted in several
  links」として節ごとのリンクの数を多い順にまとめ（10 節まで）、この形を Next に示す（コマンドにパスと見出しは
  埋めない）。`--json` の出力は変えない
- ライブラリの `updateManifestHashes` では `specRefs` で指定し、飛ばしたリンクは結果の `skipped` に入る
  （`specRefs` を指定したときだけ付く）

`--root <dir>` は探索ルートを明示する。省略時は cwd から親へたどり、設定ファイル
（`specproof.config.yaml` / `.yml`）か `traceability.yaml` が最初に見つかった段をルートにする。
`traceability.yaml` だけが見つかった段でも、その上の最も近い設定ファイルが `layout.manifest` で
その manifest を指していれば、設定ファイルの段をルートにする（`e2e/traceability.yaml` のような
構成で `e2e/` から流しても参照を取り違えない）。cwd から親へたどる探索も、この設定ファイルの探索も、
`.git` のある段より上を見ない（worktree や submodule の `.git` ファイルも対象）。その段に目印がなければ、
Git がそこを作業ツリーの最上段として認識しているかを確かめる。`.git` が壊れている場合、bare リポジトリや
別の作業ツリーを指す場合はエラーになる。継承した `GIT_DIR` や `GIT_WORK_TREE` によってこの境界で別の
ルートに切り替わることはない。cwd を含むどの段にも `.git` がなければ、Git の環境変数を含む通常のルート解決に従う。
manifest の段や途中の段に設定ファイルの項目（リンク切れや旧名を含む）があれば親へ移らない。
manifest の参照がすべてファイルごと見つからないときは、drift ではなくルートや manifest の
取り違えを疑う案内を出し、`bothSidesChanged` を空にする（`--json` の `allReferencesMissing`）。

`--manifest <file>` は cwd 相対で解決するが、
指定した root 内に置く必要がある。`--candidate-suffix <suffix>` は候補の拡張子込み suffix
（例: Page.ts / _page.dart）。`--github-annotations` は GitHub Actions 用の注釈を stderr に出す。
`--since-bless` は、drift した参照ごとに、manifest に記録した hash（前に bless した中身）と同じ版を持つ
最も新しいコミットを git の履歴から探し、`git diff <commit> -- ':(top,literal)<path>'` の形で示す（完全な
コミット id と、どこから流しても同じファイルを指すパス。シェルで扱いにくい文字を含むパスはコマンドにせず
コミットと比べるパスを文字として示す）。spec は見出しの節の hash で照合する。探すのはパスごとに、そのパスに触れた直近 200 コミット
まで。全体で git の起動 2,000 回・60 秒を超えたら打ち切り、打ち切ったことを示す。bless した中身がコミット
されていない・ファイルの名前が変わった・履歴が浅い（shallow clone）ときは見つからない。一致した最も新しい版で、
登録した節の範囲が version 1 の規則と違うか確定できないときは、その参照の探索を止める。さらに古い一致から
bless した版を特定することはできないため、ファイルの履歴を手で確かめる。HTML ブロック・コードフェンス・単独の
CR など、[ATX 見出しの互換性](#atx-見出しの互換性)に挙げた構文でも起きる。drift があるとき、
`--json` では探した参照に `blessedCommit`（見つからない・特定できなければ `null`。特定できなかったときは
`blessedCommitUnidentified: "html-comment-boundary"` も足す）と、全体に `gitHistoryAvailable` と
`blessHistoryIncomplete` を足す（clean のときと全参照 missing のときは探さず、これらのキーも出さない）。
リポジトリ内のシンボリックリンクの参照は、hash と同じくリンク先の実体の履歴を辿り、示す差分も実体のパスで取る
（親ディレクトリがリンクのときも同じ）。`--json` では、辿ったパスが参照の書き方と違うとき（シンボリックリンクの
実体、`./` や絶対パスで書いた参照）に、その参照に `blessedPath` として辿ったパスを足す。
bless した版が見つかった参照は、HEAD の first-parent の列のうち、bless した版を含む最も古いコミットから HEAD
までで、その参照を変えたコミットにまとめて出す（`Changes since bless, by commit`。HEAD に近い順に、短いコミット id・件名・変わった参照と、それを
参照するリンク）。コミットとその第 1 親の版を比べ、spec の見出しの参照は節の単位で、ほかはファイルの単位で
変わったものだけを割り当てる（spec でも、どちらかの版で節の境界が曖昧なときは、従来の
境界で隠れる変更を落とさないよう、ファイルの単位でも比べる）。その版が bless した中身と同じコミット（ブランチで bless してマージした、など）は
割り当てない。ブランチで bless した版を持ち込んだマージがそれ以外の変更も含むときは、そのマージに割り当てる。
git が失敗して版を読めない・範囲を決められないときは、推測で割り当てず、打ち切ったと示す。PR のマージや squash のコミットが 1 件として出るので、件名の PR の番号で「見た目だけ」「動きが
変わった」などを PR の単位で仕分けられる。マージに含まれる個々のコミットは出さない。HEAD の版と今の中身が違う
参照は `(uncommitted)` に、まとめられなかった参照は理由ごとの件数を出す。テキストは 20 コミットまで、件名は
制御文字と見えない文字を除いて 120 文字までにする。件名は誰でも書ける文字列で、中の指示に従わない。
`--json` では全体に `sinceBless: { commits: [{ commit, subject, entries: [{ side, path, linkIds }] }], uncommitted,
notGrouped: { noBlessedVersion, notSearched, failed, unidentifiedBlessedVersion }, incomplete }` を足す
（`unidentifiedBlessedVersion` は最も新しい一致で節の境界が曖昧なために bless した版を特定できなかった参照の件数。理由の値はどの構文でも互換性のため `html-comment-boundary`。git の履歴を辿れたときだけ。
`subject` は生の件名なので、表示する側で無害化する）。既存のキーは変えない。git の起動の上限は bless した版の探索と
共有し、まとめを打ち切ったときは `incomplete` と 1 行の案内で示す（`blessHistoryIncomplete` は探索の打ち切りだけを表す）。
git の管理下でなければ 1 行の案内を出し、check の結果は変えない。フラグが無ければ git を起動しない。
設定に `specSources` があり `--spec-sources` を付けたときは、check は写した仕様の取り込み元を確かめ、記録した
コミットから `paths` の中で進んでいれば（または今の ref に無ければ）`spec-source-outdated`、記録が無ければ
`spec-source-unrecorded` を参考の警告として出す。取り込み元のディレクトリはあるのに確かめられない（`ref` を
解決できない・記録したコミットが無い・取り込み元として読めない・git が途中で読めない）ときは `spec-source-unresolved` を出す（どれも
`--strict` でも失敗しない。`repo` のパスが無いときだけ黙って飛ばす。フラグが無ければ取り込み元を読まない）。取り込んだコミットは
`specproof-update --record-spec-source <name>` で manifest の `specSources` に記録する（取り込み元の HEAD が `paths` の中で
`ref` と違えば記録せずに止まる。取り込みが ref から読む形なら `--allow-head-mismatch`）。詳細は
[config-schema](https://github.com/Pound79/specproof/blob/main/docs/config-schema.md#specsources)。
git に渡す制限は [security-model](https://github.com/Pound79/specproof/blob/main/docs/security-model.md) の子プロセスの項。
未知の引数・コマンド違いのオプション・値の欠落はエラーで停止する。

失敗したときは stderr に `<command> failed: <message>` を 1 行だけ出し、終了コード 2 で終わる。
メッセージの改行・制御文字は `?` に置き換え、設定や manifest の YAML 構文エラーはファイルの行を
写さずに行と列だけを示す（公開リポジトリの CI ログに、PR の内容で GitHub Actions の
ワークフローコマンドや偽の行を作らせないため）。想定外のエラーのスタックは既定では出さず、
環境変数 `SPECPROOF_DEBUG=1` を付けたときだけ続けて出す（このときは整形前のメッセージも出るので、
公開の CI では付けない）。

テキストと JSON の出力は、GitHub Actions のログでワークフローコマンドとして読まれない形にする。
行頭（空白を除く）の `::` は `?:`、行のどこかにある `##[` は `#?[`（JSON では値を変えずに
`\u0023#[`）と書く。`--github-annotations` が出す `::warning` だけが意図したコマンドになる。

`layout.implGlobs` は `*` / `**` に加えてリテラルのファイルパスと先頭 `./` を受け付ける。
`?` はワイルドカードではなく文字として扱う。
`specproof-update` は変更ゼロなら保存せず、変更した hash だけを原子的に保存する。
コメント・書式を保持し、検出した同時編集や安全に更新できない YAML alias はエラーにする。
