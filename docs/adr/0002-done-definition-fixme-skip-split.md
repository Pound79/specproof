# 完了定義と @fixme / @skip の意味的分離

greenfield の素朴な「完了 = 全 feature が green」は、観測可能だが決定論化できないバケット B
（実プロジェクトで約 4 割）と衝突し、到達不能になる。バケット B のシナリオは観測可能なので
`.feature` に残すが、確認コードのメール受信・共有環境への破壊的操作・実 OAuth 同意画面など
原理的に決定論化できないものを含む。

そこで 2 つのタグを**別の意味**として分離する:
- **`@fixme`** = 「いずれ自動化する意図のある TODO」。**done 時点で 0 でなければならない**。
- **`@skip`** = 「意識的に自動化しない・理由＋必要 seam を記録」。done 時点でも残ってよいが、
  **1 件ずつ人間の sign-off が要る**。

これにより done を到達可能かつ嘘のないものに再定義する:

> **Done = すべての観測可能な振る舞いが「green」または「sign-off 済みの `@skip`」であり、`@fixme` が 0。**

運用のため、ドメインごとの green / `@fixme`（→0 にすべき宿題）/ `@skip`（要 sign-off）を集計する
**「完了レポート」capability** を追加する。これは greenfield の「次に人間がやるべきこと」の artifact を兼ねる。

## Consequences

- `@skip` リストは greenfield の **testability backlog**（green 昇格に必要な製品 test seam の一覧）として機能する。
- `@fixme` の放置が完了を妨げるため、宿題を溜めない forcing function になる。
- greenfield はプロダクトを握っているため seam を作って `@skip`→green 昇格を進めやすく、
  brownfield は製品を後から変えにくいため `@skip` が残りやすい、という非対称を説明できる。
