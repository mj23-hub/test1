const express = require('express');
const { requireLogin } = require('../middleware');
const { getActiveItems, getActiveSuppliers, getActiveUsers, searchOrders } = require('../queries');

const router = express.Router();

router.get('/history', requireLogin, (req, res) => {
  const { user_id: userId, item_id: itemId, supplier_id: supplierId, from, to } = req.query;

  const orders = searchOrders({
    userId: userId || null,
    itemId: itemId || null,
    supplierId: supplierId || null,
    from: from || null,
    to: to || null,
    limit: 200,
  });

  res.render('history', {
    orders,
    users: getActiveUsers(),
    items: getActiveItems(),
    suppliers: getActiveSuppliers(),
    filters: { userId, itemId, supplierId, from, to },
  });
});

module.exports = router;
