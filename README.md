# discord-tts-bot

とあるDiscordサーバー用に開発した読み上げBotのコードを公開用に手直ししたものです。

## この読み上げBotの特徴

- 正規表現対応の辞書機能
- Bot再起動後、参加中だったVCへ自動再接続
- 1つの親Botで複数読み上げBotを一元管理
- 最新のDiscord Voice接続仕様（E2EE）に対応

## 動作環境（推奨バージョン）

- Node.js: `24.14.1` 以上の 24.x 系を推奨
- pnpm: 10.x 系を推奨
- Docker: `Docker` + `Docker Compose`（`compose.yml` を利用）

## 環境変数などの設定

`.env.example` をコピーして、 `.env` に名前を変えます。

#### 以下を設定してください

- `DISCORD_TOKEN`  
  Botのトークン
- `APPLICATION_ID`  
  BotのID
- `LOGGER_NAME`  
  親機ロガー名
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`  
  Google Cloud サービスアカウントのメールアドレス
- `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`  
  Google Cloud サービスアカウントの秘密鍵（改行は `\n` で表現）

#### 必要に応じて設定してください

- `GUILD_ID`
  コマンドを登録するギルドID(deploy:guild実行時に必要です)
- `OWNER_ID`  
  管理者ID（メンテナンスモード中でもコマンド・読み上げを利用可）
- `VOICE_CATEGORY_ID`  
  自動参加確認の対象カテゴリID（このカテゴリ内でVC作成時に確認メッセージを自動送信）

```env
DISCORD_TOKEN=xxxx
APPLICATION_ID=123456789012345678
LOGGER_NAME=discord-tts-bot-parent
GOOGLE_SERVICE_ACCOUNT_EMAIL=xxxx@xxxx.iam.gserviceaccount.com
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"

GUILD_ID=123456789012345678
OWNER_ID=123456789012345678
VOICE_CATEGORY_ID=123456789012345678
```

#### 同時に複数Botを起動する場合は、以下も設定してください

- `CHILD_CLIENTS_COUNT`
  子機の数（親機は含めません）
- `CHILD_X_DISCORD_TOKEN`
  子機Botのトークン（`X` には子機番号を入れます）
- `CHILD_X_NAME`
  子機Botの識別名（ロガー名にも使用されます）

`X` には、`1` から始まる連番を設定してください。以下は設定例です。

##### 子機が0個の場合

```env
CHILD_CLIENTS_COUNT=0
```

この場合、他の CHILD_X\_ は不要です。

##### 子機が1個の場合

```env
CHILD_CLIENTS_COUNT=1
CHILD_1_DISCORD_TOKEN=YYYYYYYY
CHILD_1_NAME=discord-tts-bot-child-1
```

##### 子機が2個の場合

```env
CHILD_CLIENTS_COUNT=2
CHILD_1_DISCORD_TOKEN=YYYYYYYY
CHILD_1_NAME=discord-tts-bot-child-1
CHILD_2_DISCORD_TOKEN=ZZZZZZZZ
CHILD_2_NAME=discord-tts-bot-child-2
```

> [!WARNING]
> 複数の子機を設定する場合は、**子機ごとに異なるBotトークン**を設定してください。
> **子機に親機と同じトークンを設定しないでください**
> **同じトークンを複数の子機で使い回さないでください。**

## 起動方法

1. コンテナをビルドします

```bash
docker compose build
```

2. スラッシュコマンドを同期します

```bash
docker compose run --rm app node dist/util/deploy.js
```

3. 起動します

```bash
docker compose up -d
```

## 開発用コマンド

- 依存関係のインストール

```bash
pnpm install
```

- ビルド

```bash
pnpm run build
```

- 開発起動（ソースマップ有効）

```bash
pnpm run dev
```

- 本番相当で起動

```bash
pnpm run start
```

- Lint（Prettier + ESLint）

```bash
pnpm run lint
```

- フォーマット + 自動修正

```bash
pnpm run format
```

- スラッシュコマンド同期

```bash
pnpm run deploy
```

- 特定ギルドへ同期

```bash
pnpm run deploy:guild
```

## 補足: 開発時の終了挙動

`pnpm run` 経由で起動したプロセスを `Ctrl+C` で停止した場合、環境によっては `SIGINT` ハンドラが実行されず `Shutting down...` が表示されないことがあります。あわせて `ELIFECYCLE Command failed.` が表示される場合がありますが、`pnpm run` でシグナル終了した際の挙動です。

この挙動を補足しているのは、終了時に接続中のVC情報を正しく保存するためです。`ELIFECYCLE` 終了になるとJSONが空の状態で保存されることがあり、再起動時に自動再接続できない、またはJSON読み込みでエラーになる場合があります。

本番環境では Docker 上で `node` を直接実行する想定のため、この挙動の影響はありません。

開発環境では

```
NODE_ENV=development node --env-file=.env dist/index.js --enable-source-maps
```

を直接実行することを推奨します。

## ライセンス

このプロジェクトは [MIT License](./LICENSE) のもとで公開されています。
