require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const { initDB } = require('./db');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'muuda-see-ara',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000 }
}));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/tood', require('./routes/tood'));
app.use('/api/admin', require('./routes/admin'));

// HTML lehed
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/tootaja', (req, res) => res.sendFile(path.join(__dirname, 'public', 'tootaja.html')));
app.get('/admin-login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin-login.html')));
app.get('/admin', (req, res) => {
  if (req.session && req.session.isAdmin) {
    return res.sendFile(path.join(__dirname, 'public', 'admin.html'));
  }
  res.redirect('/admin-login');
});

initDB().then(() => {
  app.listen(PORT, () => console.log(`🚀 Server käib pordil ${PORT}`));
});
