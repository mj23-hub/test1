const path = require('path');
const express = require('express');
const session = require('express-session');

const authRoutes = require('./routes/auth');
const chatRoutes = require('./routes/chat');
const historyRoutes = require('./routes/history');
const adminRoutes = require('./routes/admin');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'sakaya-inventory-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 30 },
  })
);

app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  next();
});

app.get('/', (req, res) => {
  res.redirect(req.session.user ? '/chat' : '/login');
});

app.use(authRoutes);
app.use(chatRoutes);
app.use(historyRoutes);
app.use(adminRoutes);

app.use((req, res) => {
  res.status(404).send('ページが見つかりません。');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`酒屋在庫管理システム: http://localhost:${PORT}`);
});
