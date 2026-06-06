const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const webpush = require('web-push');

function getWebPush() {
  webpush.setVapidDetails(
    'mailto:admin@royalpaigaldus.ee',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
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

module.exports = { router, saadaTeavitus };
