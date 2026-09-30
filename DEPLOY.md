# さくらのVPS（Ubuntu）へのデプロイ手順

このドキュメントは、委員会出席カウントシステムをさくらのVPS（Ubuntu）上で
常時稼働させるための手順です。Node.jsアプリを **systemd** でサービス化し、
**nginx** でリバースプロキシ（+ 任意でHTTPS化）する構成を前提にしています。

```
インターネット → nginx (80/443) → Node.js (127.0.0.1:3000, systemdで常駐)
```

## 前提

- さくらのVPSでUbuntu 22.04/24.04系のサーバーを契約済み
- SSHでサーバーにログインでき、sudoが使えるユーザーがいること
- （HTTPS化する場合）独自ドメインをサーバーのIPに向けてある

## 0. 自動セットアップスクリプトを使う場合（推奨）

`deploy/setup_ubuntu.sh` に、以下1〜7の手順をまとめて実行するスクリプトを用意しています。
VPSにアプリ一式（zipをFTPで転送して展開したもの、またはgit clone したもの）を置いた状態で、
スクリプト冒頭の `DOMAIN_OR_IP` などの設定を編集してから実行してください。

### zipをFTPでアップロードした場合

FTPクライアントで `committee-attendance-server-ubuntu.zip` を `/tmp` などにアップロードした後、
VPSにSSHログインして以下を実行します。

```bash
cd /tmp && unzip -o committee-attendance-server-ubuntu.zip
# 必要であれば /tmp/committee-attendance-server/deploy/setup_ubuntu.sh の
# DOMAIN_OR_IP 等を nano などで編集してから
sudo bash /tmp/committee-attendance-server/deploy/setup_ubuntu.sh
```

`unzip` コマンドが無い場合は先に `sudo apt install -y unzip` を実行してください。

### git cloneする場合

```bash
git clone https://github.com/mj23-hub/test1.git
cd test1
# deploy/setup_ubuntu.sh の DOMAIN_OR_IP 等を編集してから
sudo bash deploy/setup_ubuntu.sh
```

いずれの方法でも、内容を理解した上で使う場合のみ実行してください。以下は同じ内容を
手動で行う手順です（自動セットアップが失敗した場合の切り分けにも使えます）。

## 1. サーバーの初期設定

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git rsync unzip build-essential
```

`build-essential` は、`better-sqlite3` の依存する native モジュールのビルドが
必要になった場合（多くの環境ではプリビルド済みバイナリが使われるため不要ですが、
念のため）に備えたものです。

## 2. Node.js のインストール

Node.js 20 系（LTS）をNodeSource経由で入れます。

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt install -y nodejs
node -v   # v20.x が表示されればOK
```

## 3. アプリ用ユーザーとディレクトリの作成

root権限のプロセスとしてWebアプリを動かさないよう、専用ユーザーを作ります。

```bash
sudo useradd --system --create-home --shell /usr/sbin/nologin committee
sudo mkdir -p /opt/committee-attendance
sudo chown committee:committee /opt/committee-attendance
```

## 4. アプリの配置

**zipをFTPでアップロードした場合:**

```bash
cd /tmp && unzip -o committee-attendance-server-ubuntu.zip
sudo rsync -a --exclude 'node_modules' --exclude 'data' \
  /tmp/committee-attendance-server/ /opt/committee-attendance/
sudo chown -R committee:committee /opt/committee-attendance
sudo -u committee bash -c "cd /opt/committee-attendance && npm ci --omit=dev"
```

**git cloneする場合:**

```bash
sudo -u committee git clone https://github.com/mj23-hub/test1.git /opt/committee-attendance
cd /opt/committee-attendance
sudo -u committee npm ci --omit=dev
```

`npm ci --omit=dev` は `package-lock.json` に基づき本番用の依存パッケージのみを
インストールします。

## 5. systemdサービスとして登録

リポジトリ同梱の `deploy/committee-attendance.service` を使います。

```bash
sudo cp deploy/committee-attendance.service /etc/systemd/system/committee-attendance.service
sudo systemctl daemon-reload
sudo systemctl enable --now committee-attendance
sudo systemctl status committee-attendance
```

- `Restart=on-failure` によりプロセスが落ちても自動再起動します。
- サーバー再起動時も `enable` により自動起動します。
- Node自体は `HOST=127.0.0.1` にバインドし、外部からは直接アクセスできないようにしています
  （外部公開はnginx経由のみ）。

ログの確認:

```bash
sudo journalctl -u committee-attendance -f
```

## 6. nginxでリバースプロキシ

```bash
sudo apt install -y nginx
sudo cp deploy/nginx.conf /etc/nginx/sites-available/committee-attendance
# server_name を実際のドメイン or サーバーIPに変更
sudo nano /etc/nginx/sites-available/committee-attendance
sudo ln -s /etc/nginx/sites-available/committee-attendance /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

ここまでで `http://<サーバーのIPまたはドメイン>/` でアクセスできるようになります。

## 7. ファイアウォール（ufw）

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
sudo ufw status
```

Node.jsの3000番ポートは `127.0.0.1` にしかバインドしていないため外部からは
そもそも到達できませんが、念のためufwでも80/443とSSH以外は閉じています。

## 8. HTTPS化（独自ドメインがある場合）

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d example.com
```

自動でnginx設定にSSL証明書が組み込まれ、以後 `https://example.com/` でアクセスできます。
証明書の自動更新はcertbotのsystemdタイマーが自動で設定します（`sudo certbot renew --dry-run` で確認可能）。

IPアドレスのみでの運用（独自ドメインなし）の場合、Let's Encryptは使えないため
HTTPS化はスキップして`http://`のままか、社内ネットワーク限定でのみアクセスさせる運用にしてください。

## 9. データの永続化とバックアップ

出欠データは `/opt/committee-attendance/data/attendance.db`（SQLite）に保存されます。
`deploy/backup.sh` を使って定期バックアップを取ることを推奨します。

```bash
sudo cp deploy/backup.sh /opt/committee-attendance/deploy/backup.sh
sudo chmod +x /opt/committee-attendance/deploy/backup.sh
sudo crontab -u committee -e
# 以下の行を追加（毎日AM3時にバックアップ）
# 0 3 * * * /opt/committee-attendance/deploy/backup.sh >> /var/log/committee-attendance-backup.log 2>&1
```

## 10. アップデート手順（コード更新時）

**zipを再アップロードした場合:**

```bash
cd /tmp && unzip -o committee-attendance-server-ubuntu.zip
sudo rsync -a --exclude 'node_modules' --exclude 'data' \
  /tmp/committee-attendance-server/ /opt/committee-attendance/
sudo chown -R committee:committee /opt/committee-attendance
sudo -u committee bash -c "cd /opt/committee-attendance && npm ci --omit=dev"
sudo systemctl restart committee-attendance
```

**git cloneしている場合:**

```bash
cd /opt/committee-attendance
sudo -u committee git pull
sudo -u committee npm ci --omit=dev
sudo systemctl restart committee-attendance
```

## トラブルシューティング

- **`systemctl status` が failed になる**: `journalctl -u committee-attendance -n 50` でエラー内容を確認してください。多くは `npm ci` のやり直しやNode.jsバージョン不一致（`package.json` の `engines.node` は18以上）が原因です。
- **502 Bad Gateway（nginx経由）**: Node側が起動していない可能性があります。`systemctl status committee-attendance` を確認してください。
- **CSVアップロードが失敗する**: nginxの `client_max_body_size` が小さすぎる可能性があります。`deploy/nginx.conf` では10MBに設定しています。
- **`better-sqlite3` のインストールでビルドエラー**: `sudo apt install -y build-essential python3` を実行してから `npm ci` をやり直してください。
