# traceability manifest の `version` を上げる規則

> 状態: 提案（2026-10-23）。

`traceability.yaml` は `version: 1` で、loader は 1 以外を拒否する。ところが manifest の意味は
version 1 のまま 2 回変わった。

- **0.2.0**: hash を取る前に内容を正規化する（先頭の BOM を除き、CRLF を LF にする）。CHANGELOG では
  BREAKING としたが、manifest の version は 1 のままだった
- **0.3.0**: 各 `links[]` に任意の `criteria` を足した。省略できる追加で、既存の manifest はそのまま読める

0.2.0 の変更は、specproof 自身にとっては問題にならなかった。`specproof-check` は保存済みの hash と
今の内容から計算し直した hash を比べるので、計算の規則が変われば drift として表に出る。利用者は
差分を確かめて `specproof-update` で取り直せばよかった。

問題になるのは、manifest を読む**外部のツール**である。保存済みの hash を計算し直さずに根拠として
使う読み手は、hash の意味が変わっても version からは知ることができない。version を見て知らない版を
拒否するという、読み手側の正しい防御が働かない。manifest の version は、外部の読み手に向けた契約である。

## 決定

### 1. version を上げる変更

次のいずれかにあたる変更は、manifest の version を上げる。

| 変更 | 例 |
|---|---|
| 保存済みの hash の意味が変わる | 正規化の規則・hash を取る範囲（ファイル全体か、見出しの節か）・アルゴリズムの変更。0.2.0 の正規化はこれにあたる |
| 既存のキーの意味・型が変わる | `spec[].heading` の照合の規則の変更、`headingLevel` の既定値（2）の変更、配列だったキーをオブジェクトにする |
| 必須のキーが増える | 新しいキーを省略した manifest を読めなくする |
| 番兵の集合・綴り・意味が変わる | `FILE_MISSING` / `SECTION_MISSING` の綴りや意味の変更、新しい番兵の追加（外部の読み手は知らない番兵を hash と区別できない） |
| 省略できるキーでも、既存のキーの意味を変えるものを足す | hash の計算方法を切り替える任意のキー。無視する旧い読み手が既存の hash を誤って解釈する |

### 2. version を上げない変更

| 変更 | 理由 |
|---|---|
| 省略でき、無視しても既存のキーの意味が変わらないキーの追加（0.3.0 の `criteria`） | 未知のキーを保持する読み手は壊れない。読まない読み手にも既存のキーの意味は変わらない。この条件を満たさない追加は 1 にあたる |
| loader の検査を厳しくする | 読み手から見た manifest の形と意味は変わらない。ただし以前の loader が受け入れていた manifest を拒否するので、manifest を書く外部の書き手（手書き・生成ツール）は壊れうる。version は上げないが、package の CHANGELOG の BREAKING に書く |
| CLI・出力・lint の変更 | manifest の契約ではない |

迷う場合は上げる側に倒す。上げすぎは読み手の更新で済むが、上げ忘れは読み手が気づけない。

### 3. version を上げるときの手順

- loader（check・update が使う通常の読み込み）は新しい version だけを受け、旧い version には
  **移行の手順を示して**拒否する。「知らない版です」だけで止めず、どのコマンドで移行できるかを
  エラーに書く
- 旧い version を読むのは移行の経路だけにする。`specproof-update` に旧い version からの移行を用意する
  （現時点では未実装。version を上げる変更と同じリリースで入れる）。hash の意味が変わる場合は、
  移行で取り直す
- specproof が知るより新しい version の manifest は、specproof の更新を促して拒否する
  （新しい specproof が書いた manifest を旧い specproof で取り直させない）
- CHANGELOG の BREAKING に、manifest の version が何から何へ上がったかを書く
- package の版も、0.x の間は minor 以上を上げる

### 4. 過去の変更は遡らない

0.2.0 の正規化を理由に、いま version を 2 に上げることはしない。上げると、0.2.0 以降に正しく
取り直された manifest まで、すべて移行が必要になる。0.2.0 は規則の無かった時期の上げ忘れとして
この ADR に記録し、以後の変更から規則を当てる。

## Considered Options

- **package の semver だけで表し、manifest の version は 1 のまま固定する**: 退けた。manifest は
  package とは別に読まれる。読み手が見られるのはファイルの中身だけで、どの版の specproof が
  書いたかは manifest に残らない
- **hash ごとにアルゴリズムの識別子を持たせる**（`sha256-lf:…` など）: 今回は採らない。hash の
  意味の変化は version で表せる。識別子は、版の違う hash が 1 つの manifest に混ざる運用が必要に
  なったときに再検討する

## Consequences

- この ADR 以降の変更については、外部の読み手は version を見て知らない版を拒否すればよい。
  specproof は manifest の意味を変えるときに必ず version を変えるので、拒否は意味の変化を取りこぼさない
- **既知の穴**: version 1 の manifest には、0.2.0 より前に正規化なしで取った hash と、0.2.0 以降に
  取った hash がありうる。どちらも version 1 なので、外部の読み手は区別できない。0.2.0 より前の hash は
  `specproof-check` で drift として表に出るので、`specproof-check --strict` が通る manifest は
  0.2.0 以降の規則で取り直されている。外部の読み手は、この保証のある manifest だけを根拠にする
- hash の正規化や対象範囲を変える改善は、移行を伴う変更として扱う。小さな改善でも、保存済みの
  hash の意味が変わるなら version を上げる
- README の「Manifest の版」節に、この規則への参照を置く
