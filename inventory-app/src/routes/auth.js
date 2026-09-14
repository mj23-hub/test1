const express = require('express');
const db = require('../db');
const { getActiveUsers } = require('../queries');

const router = express.Router();

router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/chat');
  const users = getActiveUsers();
  res.render('login', { users, error: null, selectedUserId: null });
});

router.post('/login', (req, res) => {
  const users = getActiveUsers();
  const userId = Number(req.body.user_id);
  const pin = (req.body.pin || '').trim();
  const user = users.find((u) => u.id === userId);

  if (!user) {
    return res.render('login', { users, error: 'アカウントを選択してください。', selectedUserId: null });
  }
  if (user.pin && user.pin !== pin) {
    return res.render('login', { users, error: 'PINが違います。', selectedUserId: user.id });
  }

  req.session.user = { id: user.id, name: user.name, role: user.role };
  req.session.pending = null;
  res.redirect('/chat');
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;
