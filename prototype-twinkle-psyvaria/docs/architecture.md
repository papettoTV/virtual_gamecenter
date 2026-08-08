# アーキテクチャ

## 方針

ゲームセンターと個別ゲームを別の境界として扱います。プラットフォーム側はゲーム選択、筐体、プレイヤー、観戦、クレジット、結果を管理し、BUZZ BARRIER側はゲームルールと描画だけを担当します。

```mermaid
flowchart LR
  UI["React画面"] --> Domain["ドメインルール"]
  UI --> Runtime["BUZZ BARRIERランタイム"]
  UI --> Realtime["WebSocketクライアント"]
  Realtime --> Room["Durable Object 筐体ルーム"]
  UI --> API["Worker API"]
  API --> D1["D1"]
  Room --> Storage["Durable Object Storage"]
```

## 概念モデル

```mermaid
erDiagram
  GAME ||--o{ PLAY_SESSION : "選択される"
  CABINET ||--o{ PLAY_SESSION : "開催する"
  PLAYER o|--o{ PLAY_SESSION : "参加する"
  PLAY_SESSION ||--o{ GAME_RESULT : "結果を残す"
  PLAYER o|--o{ GAME_RESULT : "獲得する"
  PLAYER ||--|| CREDIT_ACCOUNT : "保有する"
  CREDIT_ACCOUNT ||--o{ CREDIT_TRANSACTION : "記録する"
```

- **ゲーム**: プラットフォームに登録された遊戯単位
- **筐体**: URLで共有されるリアルタイムルーム。現在はDurable Objectが状態を保持
- **プレイヤー**: 将来のログイン主体。現段階では匿名
- **プレイセッション**: 筐体で始まる1回のソロ・対戦・協力プレイ
- **ゲーム結果**: クリア時間、スコア、レベル、勝敗などの不変記録
- **クレジット口座・取引**: 残高と増減履歴。現段階はフリープレイ
- **ランキング**: ゲーム結果を並べた読み取りモデル。独立した永続エンティティにはしない

## フロントエンド

- `ArcadeScreen`: ゲームセンタートップとゲーム一覧
- `CabinetScreen`: 個別筐体の状態、共有URL、着席・観戦への入口
- `GameScreen`: プレイ・観戦共通のゲーム表示領域
- `src/domain`: UIや通信に依存しない状態遷移
- `src/realtime`: 通信形式と再接続
- `src/games/graze-duel`: BUZZ BARRIER固有実装

ゲームの表示名、説明、アセット、クレジット数、バージョンは `src/domain/game.ts` のゲームカタログへ集約します。ゲーム固有ランタイムは `src/games/registry.ts` に遅延ロード関数を登録します。画面、筐体通信、クレジット予約、ランキングは `gameId` を受け取り、個別ゲーム名を直接参照しません。

新しいゲームを追加する際は、最低限以下を行います。

1. `GAME_CATALOG` にゲーム定義を追加する
2. `src/games/registry.ts` にランタイムローダーを追加する
3. ゲーム固有ランタイムから共通Canvas、筐体プロトコル、結果APIへ接続する
4. `games` テーブルへ同じ `gameId` を追加するマイグレーションを用意する
5. ソロ、観戦、ランキング、クレジット予約の契約テストを追加する

既存の筐体URL `/cabinets/:cabinetId` は維持し、`game` クエリでゲームを識別します。クエリがない過去URLは既定ゲームへフォールバックします。

BUZZ BARRIERの既存Canvas処理は挙動を壊さないため `legacy-runtime.js` に隔離しています。新しい画面、ドメイン、通信、APIはTypeScriptで実装し、ゲーム固有処理を変更する際は `core.ts`、`audio.ts` などへ段階的に移します。この互換層からプラットフォーム機能を増やさないことをルールとします。

## リアルタイム通信

筐体IDごとにDurable Objectを1つ割り当てます。最初の接続者をプレイヤー、後続を観戦者として扱います。

- プレイヤーは弾生成イベント、位置更新、定期キーフレームを送信
- 観戦側は速度からローカル描画し、キーフレームで差分補正
- Durable Objectは最新状態を保持し、途中参加者へ再送
- Hibernation WebSocket APIでアイドル時の実行コストを抑制
- 観戦者からのゲーム操作メッセージは受理しない

対戦実装では、同じ筐体状態機械に `challengePending`、`versusReady`、`versusPlaying`、`result` を追加済みの状態として接続します。

## データ

D1には以下を保持します。

- `games`
- `players`
- `play_sessions`
- `game_results`
- `credit_accounts`
- `credit_transactions`
- `rankings`（既存API互換。将来は `game_results` からの読み取りへ移行）

ゲーム中の高頻度な位置や弾情報はD1に保存せず、Durable ObjectとWebSocketだけで扱います。

## Cloudflare境界

`src/worker/index.ts` が唯一のWorker入口です。

- `/api/cabinets/:id/ws`: Durable Objectへ転送
- `/api/ranking`: D1ランキングAPI
- `/api/health`: 動作確認
- その他: Workers Static Assets

本番だけBasic認証を有効にし、認証情報はWorker Secretで管理します。ローカルおよび同一LANのプライベートIPは開発確認のため認証対象外です。
