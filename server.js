require('dotenv').config();
const express = require('express');
const path = require('path');
const { initDB } = require('./db');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Lihtne mälu-põhine sessioon
const sessions = {};
function makeToken() {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}
app.use((req, res, next) => {
  const token = req.headers['x-session-token'] || req.query._token;
  req.session = sessions[token] || {};
  req.sessionToken = token;
  req.saveSession = (data) => {
    const t = token || makeToken();
    sessions[t] = { ...sessions[t], ...data };
    res.setHeader('x-session-token', t);
    return t;
  };
  next();
});

app.use(express.static(path.join(__dirname, 'public')));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/tood', require('./routes/tood'));
app.use('/api/admin', require('./routes/admin'));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/tootaja', (req, res) => res.sendFile(path.join(__dirname, 'public', 'tootaja.html')));
app.get('/admin-login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin-login.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

initDB().then(() => {
  app.listen(PORT, () => console.log(`🚀 Server käib pordil ${PORT}`));
});
