const express = require('express');
const db = require('../db');
const { requireLogin } = require('../middleware');
const { getActiveItems, getActiveSuppliers, findOrCreateSupplierByName } = require('../queries');
const { parseMessage, findItemMatch, findQuantity, toHalfWidthDigits } = require('../parser');

const router = express.Router();

const CANCEL_WORDS = ['キャンセル', '取消', '取り消し', 'やめる', 'キャンセルします'];
const HELP_WORDS = ['ヘルプ', 'つかいかた', '使い方', 'help'];
const QUANTITY_SUGGESTIONS = ['1', '2', '3', '5', '10'];

function insertMessage(userId, direction, body, { meta = null, orderId = null } = {}) {
  db.prepare(
    `INSERT INTO chat_messages (user_id, direction, body, meta, order_id) VALUES (?, ?, ?, ?, ?)`
  ).run(userId, direction, body, meta ? JSON.stringify(meta) : null, orderId);
}

function askItem(userId, items) {
  const quickReplies = items.map((i) => i.name);
  insertMessage(
    userId,
    'out',
    '品目がわかりませんでした。何を発注しますか？下のボタンから選ぶか、品名を入力してください。',
    { meta: { quickReplies } }
  );
}

function askQuantity(userId, pending) {
  insertMessage(
    userId,
    'out',
    `「${pending.itemName}」の数量を入力してください（単位: ${pending.unit || ''}）。`,
    { meta: { quickReplies: QUANTITY_SUGGESTIONS } }
  );
}

function buildConfirmText(pending, supplierName) {
  const supplierPart = supplierName ? ` / 発注先: ${supplierName}` : '';
  return `登録しました\n${pending.itemName} ${pending.quantity}${pending.unit}${supplierPart}`;
}

function finalizeOrder(req, pending) {
  const user = req.session.user;
  let supplierId = pending.supplierId || null;
  if (!supplierId && pending.supplierRaw) {
    supplierId = findOrCreateSupplierByName(pending.supplierRaw);
  }
  const supplierRow = supplierId ? db.prepare('SELECT name FROM suppliers WHERE id = ?').get(supplierId) : null;

  const info = db
    .prepare(
      `INSERT INTO orders (user_id, item_id, quantity, unit, supplier_id, supplier_name_raw, raw_message)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      user.id,
      pending.itemId,
      pending.quantity,
      pending.unit,
      supplierId,
      pending.supplierRaw || null,
      pending.rawMessage || null
    );

  req.session.pending = null;
  insertMessage(user.id, 'out', buildConfirmText(pending, supplierRow ? supplierRow.name : pending.supplierRaw), {
    orderId: info.lastInsertRowid,
  });
}

router.get('/chat', requireLogin, (req, res) => {
  const rows = db
    .prepare(
      `SELECT c.*, u.name AS user_name
       FROM chat_messages c JOIN users u ON u.id = c.user_id
       ORDER BY c.id DESC LIMIT 100`
    )
    .all()
    .reverse()
    .map((r) => ({ ...r, meta: r.meta ? JSON.parse(r.meta) : null }));

  res.render('chat', { messages: rows, currentUser: req.session.user });
});

router.post('/chat/message', requireLogin, (req, res) => {
  const user = req.session.user;
  const text = (req.body.text || '').trim();
  if (!text) return res.redirect('/chat');

  insertMessage(user.id, 'in', text);

  if (CANCEL_WORDS.includes(text)) {
    req.session.pending = null;
    insertMessage(user.id, 'out', 'キャンセルしました。');
    return res.redirect('/chat');
  }
  if (HELP_WORDS.some((w) => text.toLowerCase().includes(w.toLowerCase()))) {
    insertMessage(
      user.id,
      'out',
      '例: 「紙コップ 10箱 発注」「ティッシュ3個をアスクルに発注して」のように入力してください。品目や数量が分からないときはこちらから質問します。'
    );
    return res.redirect('/chat');
  }

  const items = getActiveItems();
  const suppliers = getActiveSuppliers();
  let pending = req.session.pending;

  if (pending && pending.missing === 'item') {
    const normalized = toHalfWidthDigits(text);
    const itemMatch = findItemMatch(normalized, items) || { item: items.find((i) => i.name === text) };
    if (itemMatch && itemMatch.item) {
      pending.itemId = itemMatch.item.id;
      pending.itemName = itemMatch.item.name;
      pending.unit = pending.unit || itemMatch.item.unit;
      pending.missing = pending.quantity == null ? 'quantity' : null;
    } else {
      req.session.pending = pending;
      askItem(user.id, items);
      return res.redirect('/chat');
    }
  } else if (pending && pending.missing === 'quantity') {
    const normalized = toHalfWidthDigits(text);
    const qtyMatch = findQuantity(normalized);
    if (qtyMatch) {
      pending.quantity = qtyMatch.quantity;
      pending.unit = qtyMatch.unit || pending.unit;
      pending.missing = null;
    } else {
      req.session.pending = pending;
      askQuantity(user.id, pending);
      return res.redirect('/chat');
    }
  } else {
    const parsed = parseMessage(text, items, suppliers);
    pending = {
      itemId: parsed.item ? parsed.item.id : null,
      itemName: parsed.item ? parsed.item.name : null,
      quantity: parsed.quantity,
      unit: parsed.unit,
      supplierId: parsed.supplier ? parsed.supplier.id : null,
      supplierRaw: parsed.supplierRaw,
      rawMessage: text,
      missing: !parsed.item ? 'item' : parsed.quantity == null ? 'quantity' : null,
    };
  }

  if (pending.missing === 'item') {
    req.session.pending = pending;
    askItem(user.id, items);
  } else if (pending.missing === 'quantity') {
    req.session.pending = pending;
    askQuantity(user.id, pending);
  } else {
    finalizeOrder(req, pending);
  }

  res.redirect('/chat');
});

module.exports = router;
