const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'inventory.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'staff',
  pin TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  unit TEXT NOT NULL DEFAULT '個',
  category TEXT,
  aliases TEXT,
  default_supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  item_id INTEGER NOT NULL REFERENCES items(id),
  quantity REAL NOT NULL,
  unit TEXT NOT NULL,
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  supplier_name_raw TEXT,
  note TEXT,
  raw_message TEXT,
  ordered_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  direction TEXT NOT NULL,
  body TEXT NOT NULL,
  meta TEXT,
  order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_orders_ordered_at ON orders(ordered_at);
CREATE INDEX IF NOT EXISTS idx_orders_item ON orders(item_id);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_supplier ON orders(supplier_id);
CREATE INDEX IF NOT EXISTS idx_chat_created_at ON chat_messages(created_at);
`);

function seedIfEmpty() {
  const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (userCount === 0) {
    db.prepare(`INSERT INTO users (name, role, pin) VALUES (?, 'admin', ?)`).run('管理者', '0000');
  }

  const supplierCount = db.prepare('SELECT COUNT(*) AS c FROM suppliers').get().c;
  if (supplierCount === 0) {
    const insertSupplier = db.prepare(`INSERT INTO suppliers (name) VALUES (?)`);
    ['アスクル', '卸業者A', '近隣スーパー', '100円ショップ', 'Amazonビジネス'].forEach((n) => insertSupplier.run(n));
  }

  const itemCount = db.prepare('SELECT COUNT(*) AS c FROM items').get().c;
  if (itemCount === 0) {
    const insertItem = db.prepare(
      `INSERT INTO items (name, unit, category, aliases, sort_order) VALUES (?, ?, ?, ?, ?)`
    );
    const items = [
      ['段ボール箱(大)', '枚', '梱包資材', '段ボール大,ダンボール大,大型ダンボール', 10],
      ['段ボール箱(中)', '枚', '梱包資材', '段ボール中,ダンボール中', 20],
      ['段ボール箱(小)', '枚', '梱包資材', '段ボール小,ダンボール小', 30],
      ['ガムテープ', '個', '梱包資材', '布テープ,クラフトテープ', 40],
      ['紙コップ', '箱', '接客用品', '', 50],
      ['紙皿', '箱', '接客用品', '', 60],
      ['ペーパータオル', '箱', '清掃用品', 'ペーパータオル', 70],
      ['ティッシュ', '箱', '清掃用品', 'ティッシュペーパー', 80],
      ['キッチンペーパー', '個', '清掃用品', '', 90],
      ['ラップ', '個', '接客用品', 'サランラップ', 100],
      ['アルミホイル', '個', '接客用品', '', 110],
      ['ゴミ袋(45L)', '箱', '清掃用品', 'ごみ袋45L,ゴミ袋45リットル', 120],
      ['ゴミ袋(30L)', '箱', '清掃用品', 'ごみ袋30L,ゴミ袋30リットル', 130],
      ['軍手', '双', '作業用品', '', 140],
      ['使い捨て手袋', '箱', '作業用品', 'ビニール手袋,使い捨てグローブ', 150],
      ['マスク', '箱', '衛生用品', '', 160],
      ['除菌スプレー', '本', '衛生用品', '', 170],
      ['アルコール消毒液', '本', '衛生用品', 'アルコール,消毒液', 180],
      ['食器用洗剤', '本', '清掃用品', '洗剤', 190],
      ['スポンジ', '個', '清掃用品', '', 200],
      ['布巾', '枚', '清掃用品', 'ふきん', 210],
      ['トイレットペーパー', '個', '衛生用品', 'トイレットペーパー', 220],
      ['ハンドソープ', '本', '衛生用品', '', 230],
      ['割り箸', '膳', '接客用品', 'わりばし', 240],
      ['おしぼり', '箱', '接客用品', '', 250],
      ['レジ袋', '箱', '接客用品', 'ビニール袋,買い物袋', 260],
      ['領収書用紙', '冊', '事務用品', '領収書', 270],
      ['伝票', '冊', '事務用品', '', 280],
      ['輪ゴム', '袋', '事務用品', '', 290],
      ['セロハンテープ', '個', '事務用品', 'セロテープ', 300],
      ['緩衝材(プチプチ)', '巻', '梱包資材', 'プチプチ,エアキャップ', 310],
      ['結束バンド', '袋', '梱包資材', '', 320],
    ];
    items.forEach((i) => insertItem.run(...i));
  }
}

seedIfEmpty();

module.exports = db;
