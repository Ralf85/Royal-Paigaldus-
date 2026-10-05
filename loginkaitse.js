// loginkaitse.js — PIN-i äraarvamise kaitse.
// Pärast liiga palju valesid PIN-e samalt IP-aadressilt lukustatakse sisselogimine 15 minutiks.
// Katsed hoitakse andmebaasis (tabel login_katsed), nii et lukk ei kao serveri taaskäivitusel.
const crypto = require('crypto');
const { pool } = require('./db');

const LUKU_MINUTID = 15;
// Lubatud valede katsete arv 15 minuti jooksul. Töötajatel on piir veidi kõrgem, sest ühe objekti
// WiFi taga on mitu inimest sama IP-aadressiga — muidu lukustaks ühe inimese näpuviga kõik teised.
const MAX_KATSEID = { admin: 3, graafik: 3, latvia: 3, tootaja: 5 };

// Kliendi päris IP. Railway lisab X-Real-IP päise ise; X-Forwarded-For esimest väärtust saab
// klient võltsida, seepärast seda ei usalda.
function kliendiIp(req) {
  const real = req.headers['x-real-ip'];
  if (typeof real === 'string' && real.trim()) return real.trim().slice(0, 64);
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim()) return xff.split(',').pop().trim().slice(0, 64);
  return String((req.socket && req.socket.remoteAddress) || 'tundmatu').slice(0, 64);
}

// Tagastab, mitu minutit on sisselogimine veel lukus (0 = pole lukus).
async function lukusMinuteid(req, tyyp) {
  try {
    const r = await pool.query(
      `SELECT COUNT(*)::int AS arv, MAX(aeg) AS viimane FROM login_katsed
       WHERE ip=$1 AND tyyp=$2 AND aeg > NOW() - ($3 || ' minutes')::interval`,
      [kliendiIp(req), tyyp, String(LUKU_MINUTID)]
    );
    const { arv, viimane } = r.rows[0];
    if (arv < (MAX_KATSEID[tyyp] || 3)) return 0;
    const jaanud = LUKU_MINUTID * 60000 - (Date.now() - new Date(viimane).getTime());
    return jaanud > 0 ? Math.ceil(jaanud / 60000) : 0;
  } catch (err) {
    // Kui kaitse ise ei tööta (nt tabel puudub), ei tohi see sisselogimist täielikult blokeerida.
    console.error('Login-kaitse kontroll ebaõnnestus:', err.message);
    return 0;
  }
}

// Salvestab vale katse. Tagastab, mitu katset on enne lukku veel alles.
async function margiVale(req, tyyp) {
  try {
    const ip = kliendiIp(req);
    await pool.query('INSERT INTO login_katsed (ip, tyyp) VALUES ($1,$2)', [ip, tyyp]);
    const r = await pool.query(
      `SELECT COUNT(*)::int AS arv FROM login_katsed
       WHERE ip=$1 AND tyyp=$2 AND aeg > NOW() - ($3 || ' minutes')::interval`,
      [ip, tyyp, String(LUKU_MINUTID)]
    );
    return Math.max(0, (MAX_KATSEID[tyyp] || 3) - r.rows[0].arv);
  } catch (err) {
    console.error('Login-kaitse salvestus ebaõnnestus:', err.message);
    return null;
  }
}

// Õige PIN -> selle IP valed katsed kustutatakse.
async function margiOige(req, tyyp) {
  try {
    await pool.query('DELETE FROM login_katsed WHERE ip=$1 AND tyyp=$2', [kliendiIp(req), tyyp]);
  } catch (err) {
    console.error('Login-kaitse puhastus ebaõnnestus:', err.message);
  }
}

function lukuTeade(minuteid) {
  return `Liiga palju valesid katseid. Proovi uuesti ${minuteid} minuti pärast.`;
}
function valeTeade(alus, alles) {
  if (alles === 0) return `${alus}. Sisselogimine on ${LUKU_MINUTID} minutiks lukus.`;
  if (alles === 1) return `${alus}. Veel 1 katse, siis läheb sisselogimine ${LUKU_MINUTID} minutiks lukku.`;
  return alus;
}

// Võrdleb kahte teksti nii, et vastamise aeg ei reeda, mitu märki oli õige.
function turvalineVordlus(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

module.exports = { kliendiIp, lukusMinuteid, margiVale, margiOige, lukuTeade, valeTeade, turvalineVordlus, LUKU_MINUTID };
