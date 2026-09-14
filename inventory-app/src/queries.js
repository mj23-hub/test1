const db = require('./db');

function getActiveUsers() {
  return db.prepare(`SELECT * FROM users WHERE active = 1 ORDER BY role DESC, name`).all();
}

function getAllUsers() {
  return db.prepare(`SELECT * FROM users ORDER BY active DESC, role DESC, name`).all();
}

function getActiveItems() {
  return db.prepare(`SELECT * FROM items WHERE active = 1 ORDER BY sort_order, name`).all();
}

function getAllItems() {
  return db.prepare(`SELECT * FROM items ORDER BY active DESC, sort_order, name`).all();
}

function getActiveSuppliers() {
  return db.prepare(`SELECT * FROM suppliers WHERE active = 1 ORDER BY name`).all();
}

function getAllSuppliers() {
  return db.prepare(`SELECT * FROM suppliers ORDER BY active DESC, name`).all();
}

const ORDER_SELECT = `
  SELECT o.*, u.name AS user_name, i.name AS item_name, i.unit AS item_unit,
         s.name AS supplier_name
  FROM orders o
  JOIN users u ON u.id = o.user_id
  JOIN items i ON i.id = o.item_id
  LEFT JOIN suppliers s ON s.id = o.supplier_id
`;

function getOrderById(id) {
  return db.prepare(`${ORDER_SELECT} WHERE o.id = ?`).get(id);
}

function searchOrders({ userId, itemId, supplierId, from, to, limit } = {}) {
  const clauses = [];
  const params = {};
  if (userId) {
    clauses.push('o.user_id = @userId');
    params.userId = userId;
  }
  if (itemId) {
    clauses.push('o.item_id = @itemId');
    params.itemId = itemId;
  }
  if (supplierId) {
    clauses.push('o.supplier_id = @supplierId');
    params.supplierId = supplierId;
  }
  if (from) {
    clauses.push('date(o.ordered_at) >= date(@from)');
    params.from = from;
  }
  if (to) {
    clauses.push('date(o.ordered_at) <= date(@to)');
    params.to = to;
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const limitClause = limit ? `LIMIT ${Number(limit)}` : '';
  return db.prepare(`${ORDER_SELECT} ${where} ORDER BY o.ordered_at DESC, o.id DESC ${limitClause}`).all(params);
}

function getSupplierIdByName(name) {
  const row = db.prepare(`SELECT id FROM suppliers WHERE name = ?`).get(name);
  return row ? row.id : null;
}

function findOrCreateSupplierByName(name) {
  if (!name) return null;
  const existing = db.prepare(`SELECT id FROM suppliers WHERE name = ?`).get(name);
  if (existing) return existing.id;
  const info = db.prepare(`INSERT INTO suppliers (name) VALUES (?)`).run(name);
  return info.lastInsertRowid;
}

module.exports = {
  getActiveUsers,
  getAllUsers,
  getActiveItems,
  getAllItems,
  getActiveSuppliers,
  getAllSuppliers,
  getOrderById,
  searchOrders,
  getSupplierIdByName,
  findOrCreateSupplierByName,
};
