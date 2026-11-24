# セキュリティポリシー

[English](SECURITY.md) | 日本語

## 対象版と報告窓口

specproof は 1.0 未満です。`@pound79/specproof` と `@pound79/specproof-traceability` の各パッケージの最新リリースに修正を提供します。脆弱性は非公開で報告してください。リポジトリの Security タブの「Report a vulnerability」または[報告用メールアドレス](SECURITY.md#reporting-a-vulnerability)を利用できます。問題の内容・影響、最小限の再現条件、対象パッケージとバージョンを記載してください。

報告から7日以内の受領連絡を目指します。非公開で修正を準備してリリースし、利用者が更新できる期間を設けたうえで詳細を公表します。目標は最初の報告から90日以内です。

## 依存関係の修正期限

アドバイザリの公開または報告から起算します。対象は lockfile に記録した npm 依存、雛形が指定する依存の範囲（Playwright は npm、Flutter は pub）、本リポジトリと生成される drift ワークフローで使う GitHub Actions です。

| 重要度 | 修正期限 |
|---|---|
| Critical | 7日 |
| High | 14日 |
| Moderate | 30日 |
| Low | 次のリリース |

CISA の Known Exploited Vulnerabilities に掲載されたものは重要度にかかわらず7日以内です。上流の修正版がない場合は、同じ期限内に回避策または影響するコード経路に到達しない理由を公開します。

- 雛形に lockfile は含まれません。監視するのは雛形が指定する範囲で、推移的依存は導入先で解決されます。修正は次のリリースの雛形に入ります。導入済みのリポジトリは手動で取り込んでください。
- 日本語 Gherkin を扱う Flutter ランナーは `flutter_gherkin: 3.0.0-rc.17` に固定しています。上流で修正されない場合は影響と利用可能な回避策を期限内に示します。
- 雛形と本リポジトリで共用する Actions の版はテストで照合します。雛形だけで使う `actions/github-script` はリリース前に手動で確認します。
- Dependabot のアラートとセキュリティ更新を使います。PR で Moderate 以上の脆弱性を含む依存を追加または更新すると dependency review が失敗します。通常のバージョン更新は週次で、新版公開後7日の待機期間があります。
- 0.3.0 より後の GitHub Release には、lockfile 全体を対象にした CycloneDX SBOM（`specproof-<version>.cdx.json`）が付きます。開発依存は `cdx:npm:package:development` で区別します。

読み書き・通信・暗号の用途と、検査が保証する範囲は[セキュリティモデル](docs/security-model.md)を参照してください。
