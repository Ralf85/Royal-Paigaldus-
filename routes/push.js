const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const webpush = require('web-push');

// Muudab võtme "URL-safe base64 ilma täidiseta" kujule, mida web-push nõuab —
// kaitseb juhul, kui Railway muutujasse on kogemata sattunud tavaline base64 (+, /, = täidis).
function puhastaVapidVoti(voti) {
  return (voti || '').trim().replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function getWebPush() {
  webpush.setVapidDetails(
    'mailto:admin@royalpaigaldus.ee',
    puhastaVapidVoti(process.env.VAPID_PUBLIC_KEY),
    puhastaVapidVoti(process.env.VAPID_PRIVATE_KEY)
  );
  return webpush;
}

function noudaSisslogimist(req, res, next) {
  if (!req.session.workerId) return res.status(401).json({ ok: false });
  next();
}

// Salvesta töötaja push subscription
router.post('/subscribe', noudaSisslogimist, async (req, res) => {
  const { subscription } = req.body;
  try {
    await pool.query(
      `INSERT INTO push_subscriptions (worker_id, subscription)
       VALUES ($1, $2)
       ON CONFLICT (worker_id) DO UPDATE SET subscription=$2, uuendatud=NOW()`,
      [req.session.workerId, JSON.stringify(subscription)]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false });
  }
});

// Kustuta subscription (kui töötaja logib välja)
router.delete('/unsubscribe', noudaSisslogimist, async (req, res) => {
  await pool.query('DELETE FROM push_subscriptions WHERE worker_id=$1', [req.session.workerId]);
  res.json({ ok: true });
});

// Saada teavitus ühele töötajale (kasutatakse admin.js-ist)
async function saadaTeavitus(workerId, title, body, url) {
  try {
    const r = await pool.query('SELECT subscription FROM push_subscriptions WHERE worker_id=$1', [workerId]);
    if (!r.rows.length) return;
    const subscription = JSON.parse(r.rows[0].subscription);
    await getWebPush().sendNotification(subscription, JSON.stringify({ title, body, url }));
  } catch (err) {
    console.error('Push teavitus ebaõnnestus:', err.message);
    // Eemalda vigane subscription
    if (err.statusCode === 410) {
      await pool.query('DELETE FROM push_subscriptions WHERE worker_id=$1', [workerId]);
    }
  }
}

// Saada teavitus käsitsi (admin valib töötaja ja kirjutab vabas vormis sõnumi)
router.post('/saada', async (req, res) => {
  if (!req.session || !req.session.isAdmin) return res.status(401).json({ ok: false, veateade: 'Admin õigused puuduvad' });
  const { worker_id, title, body } = req.body;
  if (!worker_id || !title || !body) return res.json({ ok: false, veateade: 'Täida töötaja, pealkiri ja sõnum' });
  try {
    const sub = await pool.query('SELECT 1 FROM push_subscriptions WHERE worker_id=$1', [worker_id]);
    if (!sub.rows.length) {
      return res.json({ ok: false, veateade: 'Sellel töötajal pole veel telefonis teavitusi lubatud — palu tal töötaja vaates "🔔 Luba teavitused" nupule vajutada.' });
    }
    await saadaTeavitus(worker_id, title, body, '/tootaja');
    // Salvestame sõnumi, et see jääks töötaja pealehele "Sinu teated" alla nähtavaks
    // ka pärast seda, kui telefoni teavitus ise on kadunud.
    await pool.query(
      'INSERT INTO worker_teated (worker_id, pealkiri, sonum) VALUES ($1,$2,$3)',
      [worker_id, title, body]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, veateade: 'Serveri viga' });
  }
});

// Töötaja enda viimased käsitsi saadetud teated (kuvatakse töötaja pealehel)
router.get('/minu-teated', noudaSisslogimist, async (req, res) => {
  try {
    const r = await pool.query(
      'SELECT pealkiri, sonum, loodud FROM worker_teated WHERE worker_id=$1 ORDER BY loodud DESC LIMIT 5',
      [req.session.workerId]
    );
    res.json({ ok: true, teated: r.rows });
  } catch (err) {
    res.status(500).json({ ok: false, teated: [] });
  }
});

module.exports = { router, saadaTeavitus };
