# MEX Fetcher

MediaWiki サイトの拡張機能一覧を取得し、比較・依存関係の確認・別サイトへの移植チェックができるブラウザアプリです。サーバー側の処理はなく、ブラウザから各サイトの API を直接呼びます。

## 起動

ES modules を使うため、`file://` ではなく Web サーバー経由で開いてください。

```sh
npm start        # http://localhost:8080 （npx http-server）
npm test         # 単体テスト（node --test）
```

`index.html` を任意の静的ホスティングに置いても動きます（`mediawiki_extensions_fetcher.html` は `index.html` へのリダイレクトです）。

## 機能

| タブ | 内容 |
|---|---|
| 比較 | 1サイトなら一覧、2サイトなら 共通/不足/余剰、3サイト以上ならバージョンのマトリクス。検索、並べ替え、CSV / wikitable / Markdown 出力 |
| 依存関係 | 各拡張の `extension.json` から依存グラフを作成。標準のSVG描画と Cytoscape.js（CDN）を切り替え可。未導入の依存先・循環依存・孤立を検出 |
| 移植チェック | サイトA → サイトB。MediaWiki/PHP の要件、推移的な依存、保守状況（mediawiki.org）、パーサータグ・関数・スキン・ユーザーグループ・名前空間の差、導入順、`LocalSettings.php` / `git clone` のスニペット |
| 履歴 | 取得のたびにブラウザ内（IndexedDB）へ保存し、任意の2時点の差分を表示 |

その他:

- **言語（日本語 / English）**: 右上のセレクタで切り替えます。既定はブラウザの言語（日本語以外は英語）で、選択はこのブラウザに保存されます。取得済みの結果は再取得せずに表示だけが切り替わります。リンクに `?lang=en` を付けると言語を固定できます。
- **テーマ（自動 / ライト / ダーク）**: 自動は OS の設定に従います。選択はこのブラウザに保存され、ページの描画前に適用されるため、ちらつきません。

- **API URL の自動検出**: 記事のURLやトップページのURLでも `api.php` を探します。
- **共有用URL**: 入力したサイトとタブが URL（`?site=…&site=…&tab=port&a=0&b=1`）に反映されます。スナップショットや貼り付けたサイトは URL に含まれません。
- **スナップショット**: 取得結果（依存情報を取得済みならそれも）を JSON で保存・読み込み（ドラッグ＆ドロップ可）。CORS に対応していないサイトや、まだ存在しない構成案との比較にも使えます。
- **JSON の貼り付け**: ブラウザから API に直接アクセスできないサイト（例: CORS 非対応）は、ご自身のブラウザで `siteinfo` の URL を開き、表示された JSON を貼り付けて取り込めます。

## データの出所と限界

- サイト情報: `action=query&meta=siteinfo`（`general|extensions|skins|libraries|extensiontags|functionhooks|namespaces|usergroups`）
- 依存関係・要件: Wikimedia の GitHub ミラー（`raw.githubusercontent.com/wikimedia/mediawiki-extensions-*`）の `extension.json` / `skin.json`。サイトの MediaWiki バージョンに対応する `REL1_xx` ブランチを読み、無ければ `master` を使って警告します。
- 保守状況・同梱情報: mediawiki.org の各拡張ページのカテゴリ（Unmaintained / Archived / Experimental / bundled with MediaWiki …）
- API は `$wg` 設定、DB スキーマ、独自パッチ、サーバー側の依存を返さないため、移植チェックの判定には含まれません。導入前にステージング環境で確認してください。
- Wikimedia 以外の拡張は、`vcs-url` が GitHub であればそこから manifest を読みます。取得できない拡張は「不明」になり、`extension.json` のURL（raw）を指定するか、内容を貼り付けて補えます（このブラウザに保存されます）。
- 依存グラフでは、依存関係のない拡張（孤立ノード）は既定で隠します。「孤立ノードを隠す」で切り替えられます。
- ブラウザのキャッシュ（`localStorage`）に manifest を1日保存します。

## 構成

```
index.html, css/            画面とスタイル（Codex 準拠。css/theme.css にダーク用トークン）
js/main.js                  起動、タブ、URL 同期、言語・テーマの切り替え
js/i18n.js, js/i18n/        翻訳（t / msg / tr）と日英の辞書（ja.js, en.js）
js/theme.js                 テーマ（light / dark / auto）
js/api/                     siteinfo / api.php 検出 / manifest / mediawiki.org
js/store/                   スナップショット変換、履歴（IndexedDB）
js/core/                    DOM に依存しない純粋なロジック（semver, graph, compare, portability, export, snippets）
js/views/                   各タブの描画
tests/                      core / api の単体テスト
```
