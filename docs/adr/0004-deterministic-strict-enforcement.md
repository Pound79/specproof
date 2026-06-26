# 不変条件を決定論 CLI の --strict enforcement 層で機械強制する

Q1〜Q6 で確立した不変条件（impl→feature→impl 禁止、@fixme/@skip 規律、done 定義など）は
現状 doc のみで、自動「導入して」パイプライン + LLM の rubber-stamp が同居する世界では静かに腐る
（監査 I14: `cp scratch/x.feature features/x.feature` で同語反復ループが CI 非検知で完成可能 /
I15: 理由コメント必須が自動検証ゼロ / I19: @fixme ライフサイクル無し）。

enforcement は既存哲学（**検知=決定論・AI 不使用／生成=AI／権威・裁定=人間**）と**同型**に保つ。
`bdd-traceability-check` に `--strict` を足し、**構造的にチェック可能な不変条件のみ**を機械強制する。
**AI を enforcer にしない**（検知に推測を持ち込まない）。

| 不変条件 | 強制レベル |
|---|---|
| featuresDir にドラフトマーカー（`# bdd-kit: draft`）残存（同語反復ファイアウォール = ADR 0001/Q1 の魂） | **`--strict`／consumer の drift CI で `unreviewed-draft` 失敗 ＋ bdd-implement が着手前に拒否** |
| spec/impl/features 全空のリンク（破損） | **ハード（`--strict`／consumer の drift CI で失敗・ローカル既定は警告表示）** |
| `@fixme` > 0 | **done 判定でのみハード**（日常開発では soft） |
| `@skip`/`@fixme` に理由コメントが無い | ソフト（warn）→ config でハード化可 |
| `driftLinkCount` の追加（drift 集計の誤解消、I8） | バグ修正 |

## Considered Options

- **ゲートを人間の手続き（scratch/features 分離の摩擦）だけに留め、文書改善のみ** — 却下。
  手続きゲートは自動パイプライン + rubber-stamp で必ず腐る（監査の中心的実証）。

## Consequences

- Q1（同語反復禁止）と Q5（done 定義）が「実際に守られる歯止め」になる。
- 誤検知で開発を止めないよう、ハードは「同語反復」と「破損」の 2 種に限定。
- ドラフトマーカー（bootstrap 出力に埋め、bless = 人間がマーカーを除去）は、cp で査読を飛ばす
  I14 の穴を塞ぐ唯一の構造的手段。
- enforcement の単一地点はオーケストレータ（ADR 0003）と CI が共有する。
