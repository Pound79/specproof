# @fixme / @skip の退役と状態タグへの統一

ADR 0002 は「いずれ自動化する `@fixme`」と「当面自動化しない `@skip`」を分け、done を
`@fixme` = 0 で判定した。どちらのタグも runner が黙って実行しないため、落ちる条件を付けるだけで
消せる。これは完了を偽装する経路になる。また、受け入れ条件を扱う外部のツールと併用するとき、
specproof だけ別の語彙を持つと、単体でも併用でも同じ feature の意味が変わってしまう。

そこで `@fixme` / `@skip` を退役し、次の状態タグに統一する。状態タグは固定で、設定では変えない。

| 状態 | タグ | E2E で実行するか | 完了判定 |
|---|---|---|---|
| 草案（作るか未定） | `@draft` | しない | 数えない |
| 実装待ち | `@red-contract` | `@human` が付いていなければする。落ちるのを観測し続ける。`@human` と併記した場合は実装待ちのまま人が確かめ、E2E では実行しない | 1 件でも残れば未完了 |
| 人が確認 | `@human` | しない | 数える。specproof 単体は件数のみ。完了は人の確認記録で決まる |
| 受け入れ対象外 | `@out-of-scope` ＋理由コメント（必須） | しない | 完了の判定に含めない（件数は別に数える） |
| 特定の環境だけ | 環境タグ ＋ `environments[].excludeTags` | 該当環境だけ | 変わらない |

旧バケット B（観測可能だが決定論的に自動化できない）は `@human` に移す。自動化するなら
`@red-contract`、受け入れ条件に含めないなら `@out-of-scope` にする。

> **Done = 受け入れ対象のすべての条件が GREEN か確認記録のある `@human` であり、`@red-contract` と退役タグが 0。**

決めた点:
- **一時的に止める手段は作らない。** 壊れたテスト・不安定なテストも直るまで赤のままにする。
  止める印は、そのまま完了の偽装に使える。
- **猶予期間を置かず即時に退役する。** 確認できた実際の利用先の feature に
  `@fixme` / `@skip` を使ったものが無かった。猶予期間を置くと、その間に新しく付けられてしまう。
- **`@fail` も同じ理由で使わせない。** playwright-bdd の `@fail` は「失敗することを期待する」修飾で、
  落ちるテストを GREEN に見せる。止める印と同じく完了の偽装に使えるため、退役タグ
  （`@fixme` / `@skip` / `@fail`）に含める。
- **状態タグは実行の除外に流用させない。** runner のテンプレートは `@draft` / `@human` / `@out-of-scope` を
  常に除外し、`@red-contract` はテンプレートの絞り込みでは除外しない（プロジェクトの `tags`・`--grep`・
  smoke の `--grep-invert @slow` などの絞り込みには従う）。`environments[].excludeTags` は単一のタグだけを受け付け、状態タグ
  （`@draft` / `@red-contract` / `@human` / `@out-of-scope`）を書くと Playwright テンプレートの設定読み込みが失敗する。
  Playwright の `projects[].tags` も、状態タグに触れる式と括弧の対応が取れていない式で設定読み込みが失敗する。
  Flutter テンプレートは状態タグに触れる `SPECPROOF_TAGS` と括弧の対応が取れていない `SPECPROOF_TAGS` を拒否する。
  `@red-contract` を外して E2E を緑に見せる経路を塞ぐため。コマンドラインの `--grep-invert @red-contract` は
  テンプレートでは止められないので、使わないと定める。
- **`@out-of-scope` はシナリオ自身に付ける。** 理由はシナリオごとに違うので、Feature・Rule・Examples から継承した
  `@out-of-scope` は `missing-reason`（シナリオごとに理由コメントを付けて付け直す）になり、Examples に付けると
  他の状態タグと同じく `specproof-stats` も拒否する。同じシナリオに `@out-of-scope` と `@red-contract` を
  両方付けることも `specproof-stats` がエラーにする（対象外なのに実装待ちという矛盾になる）。

## Consequences

- 設定の `tags.fixme` / `tags.skip` はエラーになる。feature に残った `@fixme` / `@skip` / `@fail` は
  `specproof-check` が `retired-tag` を出し、`specproof-stats --strict` も失敗する。
- 理由コメントの検査は `@out-of-scope` だけが対象になる（`missing-skip-reason` は `missing-reason` に変わる）。
- testability backlog は `@human` の一覧から作る。seam ができた条件は `@red-contract` に付け替える。
- `@human` の付いていない `@red-contract` は実行されるため、残っている間は E2E が赤になる。これは意図した状態で、完了まで隠さない。
  `@red-contract @human` は E2E では実行せず、人が確かめてタグを外すまで実装待ちとして残る。
- 「テストが落ちた状態でコミットしない」は `@red-contract` の RED だけを例外にする。それ以外の失敗はコミットを止める。
- done の判定が機械的に止まるのは、`specproof-stats --strict` を CI に組み込んだリポジトリだけ。
  drift-check のワークフローテンプレートが実行するのは `specproof-check --strict` で、`specproof-stats --strict` は実行しない。また `@human` の完了には人の確認記録が要り、
  その記録は specproof の外で持つ（specproof は件数を出すだけ）。
- [ADR 0002](./0002-done-definition-fixme-skip-split.md) を置き換え、[ADR 0004](./0004-deterministic-strict-enforcement.md)
  （`@fixme` / `@skip` の強制レベル）と [ADR 0005](./0005-handoff-report-and-stopping-model.md)
  （ハンドオフレポートの裁定・作業・完了ダッシュボード）を一部置き換える。
