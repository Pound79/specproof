# greenfield の導入はワークエド・サンプルを 1 本 env ゲートまで駆動する

greenfield（spec-first growth）では impl も spec もほぼ無く、bootstrap（impl→feature）も
spec→feature も起点が無い。「導入して」が scaffold だけで終わると、チームは BDD ループを体得できず
ただのテンプレ展開になる。さらに「全 green = 完了」（ADR 0002）はテストを実走して green を観測できて
初めて成立し、env（baseUrl・テストユーザー・dev サーバ）が必要（監査 I21）。

そこで greenfield の「導入して」は次を行う:

1. **scaffold**（adapter 検出は低信頼になりがちなので「ブラウザで操作する Web アプリ?」を 1 問確認）。
2. **env セットアップを能動支援** — dev サーバ起動コマンドを検出して baseUrl を配線、`.env.example` を生成、
   認証 setup の雛形を用意（playwright テンプレは既に auth.setup / env.ts を持つ）。
3. 人間が挙げた**観測可能な振る舞い 1 本**を、spec 見出し+WHY の骨子 → feature(RED) → implement → green
   まで**通して駆動**し、フルループを実機で体験させる。
4. env が揃わず green に到達できなければ、**RED + generate + typecheck まで到達**し、「`.env` を埋めれば
   green」とハンドオフレポートで明示（正直性契約・ADR 0005）。
5. 以降は人間が同じループを回し、完了ダッシュボードで green 化の進捗を追う。

## Consequences

- 「導入して」が「テンプレ展開」ではなく「自分の製品で BDD ループが 1 周回る瞬間まで連れて行く」体験になる。
- 他チームが BDD を定着させる最大のハードル（最初の 1 本）を越えさせる。
- env 不在でも正直に RED 止まりを明示するため、green の偽装が起きない。
