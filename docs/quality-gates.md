# 品質チェック基準

[English](quality-gates_en.md) | 日本語

[開発環境と検証](../CONTRIBUTING_ja.md#開発環境と検証)の順に実行します。TypeScript は strict です。Biome は到達不能コード・debugger・曖昧な等価比較を検出し、引用符・セミコロン・字下げ・改行の書式も検査します。

Vitest はテストを除く TypeScript ソース全体を測定し、CLI 入口も含めます。子プロセスで実行した CLI の経路は Vitest 側に計上されない場合があります。ワークスペースごとの下限と worker 数は [CLI の設定](../cli/vitest.config.ts)と[エンジンの設定](../packages/traceability/vitest.config.ts)が正本です。下限を下げる変更には理由とレビューが必要です。

大きい manifest のテストが制限時間内に収まるよう Vitest はエンジンで1、CLI で最大2 worker とし、スクリプト試験はファイル単位で直列に実行します。並行性は各ケース内で検証します。参照数の境界は20,001件で試験します。シグナル試験では Git の代役を使い、実際の終了経路で終了状態、復元、一度だけの後始末を確かめます。
