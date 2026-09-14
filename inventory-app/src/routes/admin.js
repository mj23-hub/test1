const express = require('express');
const db = require('../db');
const { requireAdmin } = require('../middleware');
const {
  getAllItems,
  getAllSuppliers,
  getAllUsers,
  getActiveSuppliers,
  searchOrders,
  getOrderById,
} = require('../queries');

const router = express.Router();
router.use(requireAdmin);

// ---------- Dashboard ----------
router.get('/admin', (req, res) => {
  const today = db
    .prepare(`SELECT COUNT(*) AS cnt FROM orders WHERE date(ordered_at) = date('now','localtime')`)
    .get().cnt;
  const thisMonth = db
    .prepare(
      `SELECT COUNT(*) AS cnt FROM orders WHERE strftime('%Y-%m', ordered_at) = strftime('%Y-%m', 'now','localtime')`
    )
    .get().cnt;
  const topItemsThisMonth = db
    .prepare(
      `SELECT i.name AS item_name, i.unit AS unit, SUM(o.quantity) AS total
       FROM orders o JOIN items i ON i.id = o.item_id
       WHERE strftime('%Y-%m', o.ordered_at) = strftime('%Y-%m', 'now','localtime')
       GROUP BY o.item_id ORDER BY total DESC LIMIT 5`
    )
    .all();
  const recentOrders = searchOrders({ limit: 10 });

  res.render('admin/dashboard', { today, thisMonth, topItemsThisMonth, recentOrders });
});

// ---------- Items ----------
router.get('/admin/items', (req, res) => {
  res.render('admin/items', { items: getAllItems(), suppliers: getActiveSuppliers() });
});

router.post('/admin/items', (req, res) => {
  const { name, unit, category, aliases, default_supplier_id: defaultSupplierId, sort_order: sortOrder } = req.body;
  db.prepare(
    `INSERT INTO items (name, unit, category, aliases, default_supplier_id, sort_order) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(name.trim(), (unit || '個').trim(), (category || '').trim() || null, (aliases || '').trim() || null,
    defaultSupplierId || null, Number(sortOrder) || 0);
  res.redirect('/admin/items');
});

router.post('/admin/items/:id', (req, res) => {
  const { name, unit, category, aliases, default_supplier_id: defaultSupplierId, sort_order: sortOrder, active } = req.body;
  db.prepare(
    `UPDATE items SET name = ?, unit = ?, category = ?, aliases = ?, default_supplier_id = ?, sort_order = ?, active = ?
     WHERE id = ?`
  ).run(
    name.trim(),
    (unit || '個').trim(),
    (category || '').trim() || null,
    (aliases || '').trim() || null,
    defaultSupplierId || null,
    Number(sortOrder) || 0,
    active ? 1 : 0,
    req.params.id
  );
  res.redirect('/admin/items');
});

router.post('/admin/items/:id/delete', (req, res) => {
  db.prepare(`UPDATE items SET active = 0 WHERE id = ?`).run(req.params.id);
  res.redirect('/admin/items');
});

// ---------- Suppliers ----------
router.get('/admin/suppliers', (req, res) => {
  res.render('admin/suppliers', { suppliers: getAllSuppliers() });
});

router.post('/admin/suppliers', (req, res) => {
  const name = (req.body.name || '').trim();
  if (name) {
    db.prepare(`INSERT OR IGNORE INTO suppliers (name) VALUES (?)`).run(name);
  }
  res.redirect('/admin/suppliers');
});

router.post('/admin/suppliers/:id', (req, res) => {
  const { name, active } = req.body;
  db.prepare(`UPDATE suppliers SET name = ?, active = ? WHERE id = ?`).run(
    (name || '').trim(),
    active ? 1 : 0,
    req.params.id
  );
  res.redirect('/admin/suppliers');
});

router.post('/admin/suppliers/:id/delete', (req, res) => {
  db.prepare(`UPDATE suppliers SET active = 0 WHERE id = ?`).run(req.params.id);
  res.redirect('/admin/suppliers');
});

// ---------- Users ----------
router.get('/admin/users', (req, res) => {
  res.render('admin/users', { users: getAllUsers() });
});

router.post('/admin/users', (req, res) => {
  const { name, role, pin } = req.body;
  const trimmedName = (name || '').trim();
  if (!trimmedName) return res.redirect('/admin/users');
  db.prepare(`INSERT INTO users (name, role, pin) VALUES (?, ?, ?)`).run(
    trimmedName,
    role === 'admin' ? 'admin' : 'staff',
    (pin || '').trim() || null
  );
  res.redirect('/admin/users');
});

router.post('/admin/users/:id', (req, res) => {
  const { name, role, pin, active } = req.body;
  db.prepare(`UPDATE users SET name = ?, role = ?, pin = ?, active = ? WHERE id = ?`).run(
    (name || '').trim(),
    role === 'admin' ? 'admin' : 'staff',
    (pin || '').trim() || null,
    active ? 1 : 0,
    req.params.id
  );
  res.redirect('/admin/users');
});

router.post('/admin/users/:id/delete', (req, res) => {
  db.prepare(`UPDATE users SET active = 0 WHERE id = ?`).run(req.params.id);
  res.redirect('/admin/users');
});

// ---------- Orders ----------
router.get('/admin/orders', (req, res) => {
  const { user_id: userId, item_id: itemId, supplier_id: supplierId, from, to } = req.query;
  const orders = searchOrders({
    userId: userId || null,
    itemId: itemId || null,
    supplierId: supplierId || null,
    from: from || null,
    to: to || null,
    limit: 500,
  });
  res.render('admin/orders', {
    orders,
    users: getAllUsers(),
    items: getAllItems(),
    suppliers: getAllSuppliers(),
    filters: { userId, itemId, supplierId, from, to },
  });
});

router.get('/admin/orders/:id/edit', (req, res) => {
  const order = getOrderById(req.params.id);
  if (!order) return res.status(404).send('見つかりません。');
  res.render('admin/order_form', { order, users: getAllUsers(), items: getAllItems(), suppliers: getAllSuppliers() });
});

router.post('/admin/orders/:id', (req, res) => {
  const { user_id: userId, item_id: itemId, quantity, unit, supplier_id: supplierId, note, ordered_at: orderedAt } =
    req.body;
  const normalizedOrderedAt = orderedAt.replace('T', ' ').length === 16 ? `${orderedAt.replace('T', ' ')}:00` : orderedAt.replace('T', ' ');
  db.prepare(
    `UPDATE orders SET user_id = ?, item_id = ?, quantity = ?, unit = ?, supplier_id = ?, note = ?, ordered_at = ?
     WHERE id = ?`
  ).run(
    userId,
    itemId,
    Number(quantity),
    unit,
    supplierId || null,
    (note || '').trim() || null,
    normalizedOrderedAt,
    req.params.id
  );
  res.redirect('/admin/orders');
});

router.post('/admin/orders/:id/delete', (req, res) => {
  db.prepare(`DELETE FROM orders WHERE id = ?`).run(req.params.id);
  res.redirect('/admin/orders');
});

// ---------- Reports ----------
function dateFilterClause(mode, dateValue) {
  if (mode === 'day') return { clause: `date(o.ordered_at) = date(@dateValue)`, params: { dateValue } };
  if (mode === 'year') return { clause: `strftime('%Y', o.ordered_at) = @dateValue`, params: { dateValue } };
  return { clause: `strftime('%Y-%m', o.ordered_at) = @dateValue`, params: { dateValue } };
}

router.get('/admin/reports', (req, res) => {
  const mode = ['day', 'month', 'year'].includes(req.query.mode) ? req.query.mode : 'month';
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const defaultValue =
    mode === 'day'
      ? `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
      : mode === 'year'
      ? `${now.getFullYear()}`
      : `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
  const dateValue = req.query.date || defaultValue;

  const { clause, params } = dateFilterClause(mode, dateValue);

  const byItem = db
    .prepare(
      `SELECT i.name AS label, i.unit AS unit, SUM(o.quantity) AS total, COUNT(*) AS cnt
       FROM orders o JOIN items i ON i.id = o.item_id
       WHERE ${clause}
       GROUP BY o.item_id ORDER BY total DESC`
    )
    .all(params);

  const bySupplier = db
    .prepare(
      `SELECT COALESCE(s.name, o.supplier_name_raw, '未設定') AS label, SUM(o.quantity) AS total, COUNT(*) AS cnt
       FROM orders o LEFT JOIN suppliers s ON s.id = o.supplier_id
       WHERE ${clause}
       GROUP BY label ORDER BY total DESC`
    )
    .all(params);

  const byUser = db
    .prepare(
      `SELECT u.name AS label, SUM(o.quantity) AS total, COUNT(*) AS cnt
       FROM orders o JOIN users u ON u.id = o.user_id
       WHERE ${clause}
       GROUP BY o.user_id ORDER BY cnt DESC`
    )
    .all(params);

  const totalOrders = byItem.reduce((sum, r) => sum + r.cnt, 0);

  res.render('admin/reports', { mode, dateValue, byItem, bySupplier, byUser, totalOrders });
});

module.exports = router;
