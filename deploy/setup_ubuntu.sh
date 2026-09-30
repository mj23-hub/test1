#!/usr/bin/env bash
# さくらのVPS（Ubuntu）向け セットアップスクリプト
#
# 想定する使い方（zipをFTPでVPSへ転送した場合）:
#   1. FTPで committee-attendance-server-ubuntu.zip を /tmp などにアップロード
#   2. VPSにSSHログインし、以下を実行:
#        cd /tmp && unzip -o committee-attendance-server-ubuntu.zip
#        sudo bash /tmp/committee-attendance-server/deploy/setup_ubuntu.sh
#      （実行前に、必要であれば下の「設定」セクションを編集してください）
#
# このスクリプトは以下を行います:
#   - unzip/rsyncなど前提コマンドのインストール確認
#   - Node.js LTS のインストール（NodeSource経由）
#   - アプリ実行用の専用ユーザー作成（既存の場合はスキップ）
#   - 展開したファイル一式を /opt/committee-attendance にコピーし npm ci --omit=dev
#   - systemdサービスの登録・起動
#   - nginxのインストールとリバースプロキシ設定
#   - ufw（ファイアウォール）の設定
#
# 実行前に必ず内容を確認してください。本番サーバーに対する破壊的な変更は行いませんが、
# システム設定（systemd/nginx/ufw）を変更するため sudo が必要です。

set -euo pipefail

# ---- 設定（必要に応じて変更してください） ----
APP_USER="committee"
APP_DIR="/opt/committee-attendance"
DOMAIN_OR_IP="example.com"   # ドメイン、無ければサーバーのグローバルIP
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"  # このスクリプト（展開済みzip）の場所
# ----------------------------------------------

if [ "$(id -u)" -ne 0 ]; then
  echo "root権限（sudo）で実行してください: sudo bash deploy/setup_ubuntu.sh" >&2
  exit 1
fi

echo "== 前提パッケージの確認 (rsync / better-sqlite3のビルドに必要なツール一式) =="
apt-get update -y
apt-get install -y rsync build-essential python3

echo "== Node.js のインストール確認 =="
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
else
  echo "node は既にインストール済みです: $(node -v)"
fi

echo "== アプリ用ユーザーの作成 =="
if ! id -u "$APP_USER" >/dev/null 2>&1; then
  useradd --system --create-home --shell /usr/sbin/nologin "$APP_USER"
else
  echo "ユーザー $APP_USER は既に存在します"
fi

echo "== アプリ配置 ($APP_DIR) =="
mkdir -p "$APP_DIR"
rsync -a --exclude 'node_modules' --exclude 'data' "$SOURCE_DIR"/ "$APP_DIR"/
mkdir -p "$APP_DIR/data"
chown -R "$APP_USER":"$APP_USER" "$APP_DIR"

echo "== 依存パッケージのインストール =="
sudo -u "$APP_USER" bash -c "cd '$APP_DIR' && npm ci --omit=dev"

echo "== systemdサービスの登録 =="
sed "s#/opt/committee-attendance#$APP_DIR#g; s#User=committee#User=$APP_USER#; s#Group=committee#Group=$APP_USER#" \
  "$APP_DIR/deploy/committee-attendance.service" > /etc/systemd/system/committee-attendance.service
systemctl daemon-reload
systemctl enable --now committee-attendance

echo "== nginx のインストールと設定 =="
apt-get install -y nginx
sed "s/example.com/$DOMAIN_OR_IP/" "$APP_DIR/deploy/nginx.conf" > /etc/nginx/sites-available/committee-attendance
ln -sf /etc/nginx/sites-available/committee-attendance /etc/nginx/sites-enabled/committee-attendance
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

echo "== ファイアウォール(ufw)の設定 =="
if command -v ufw >/dev/null 2>&1; then
  ufw allow OpenSSH
  ufw allow 'Nginx Full'
  ufw --force enable
fi

echo ""
echo "セットアップ完了。以下で状態を確認できます:"
echo "  systemctl status committee-attendance"
echo "  journalctl -u committee-attendance -f"
echo "ブラウザで http://$DOMAIN_OR_IP/ にアクセスして確認してください。"
echo "HTTPS化する場合は DEPLOY.md の手順に沿って certbot を実行してください。"
