// meeldetuletused.js — automaatne tunnimeeldetuletus Lidli ja Cramo töötajatele.
//
// Tööpäeviti (E–R) kell 17:30 Eesti aja järgi saadetakse telefoni teavitus
// "PANE TÄNASED TUNNID KIRJA" neile, kes:
//   * on aktiivsed ja kellele on määratud Lidli või Cramo ettevõte,
//   * on telefonis teavitused lubanud ("🔔 Luba teavitused"),
//   * EI OLE täna veel ühtegi töökirjet lisanud (kes juba kirja pani, seda ei segata).
//
// Sama muster mis Padeli uksekoodi teavitusel (routes/padel.js): kell tiksub serveris ja kontrollib
// aega. Et teade ei läheks kaks korda (nt serveri taaskäivitus kell 17:31), märgitakse saatmine
// andmebaasi tabelisse tunni_meeldetuletused — üks rida päeva kohta.
const { pool } = require('./db');
const { saadaTeavitus } = require('./routes/push');

const KELL = '17:30';        // Eesti aeg
const AKEN_MINUTID = 60;     // kui server oli 17:30 maas, saadetakse teade veel kuni 18:30
const ETTEVOTTE_TYYBID = ['lidl', 'cramo'];
const PEALKIRI = '⏰ PANE TÄNASED TUNNID KIRJA';
const SONUM = 'Tööpäev läbi? Lisa oma tänased töötunnid rakendusse.';

// Ühekordsed lisasaatmised (nt proovimiseks). Möödunud kuupäevaga rida ei tee midagi.
const YHEKORDSED = [
  { kuupaev: '2026-10-08', kell: '15:15' }
];

// Praegune aeg Eestis: { kuupaev: 'YYYY-MM-DD', minutid: minuteid südaööst, toopaev: true/false }
function eestiAeg() {
  const osad = {};
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Tallinn', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23'
  }).formatToParts(new Date()).forEach(o => { osad[o.type] = o.value; });
  return {
    kuupaev: `${osad.year}-${osad.month}-${osad.day}`,
    minutid: parseInt(osad.hour, 10) * 60 + parseInt(osad.minute, 10),
    toopaev: !['Sat', 'Sun'].includes(osad.weekday)
  };
}

function minutiteks(kell) {
  const [t, m] = kell.split(':').map(Number);
  return t * 60 + m;
}

let tabelOlemas = false;
async function looTabel() {
  if (tabelOlemas) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tunni_meeldetuletused (
      kuupaev DATE NOT NULL,
      liik VARCHAR(20) NOT NULL,
      saajaid INTEGER DEFAULT 0,
      saadetud TIMESTAMP DEFAULT NOW(),
      PRIMARY KEY (kuupaev, liik)
    );
  `);
  tabelOlemas = true;
}

async function saada(kuupaev, liik) {
  // "Broneerime" saatmise enne saatmist — kui rida on juba olemas, on teade täna juba läinud.
  const b = await pool.query(
    `INSERT INTO tunni_meeldetuletused (kuupaev, liik) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING kuupaev`,
    [kuupaev, liik]
  );
  if (!b.rowCount) return;

  const r = await pool.query(
    `SELECT w.id, w.nimi,
            EXISTS (SELECT 1 FROM push_subscriptions ps WHERE ps.worker_id = w.id) AS teavitused,
            EXISTS (SELECT 1 FROM tookirjed t WHERE t.worker_id = w.id AND t.kuupaev = $1::date) AS kirjas
     FROM workers w
     WHERE w.aktiivne = true
       AND EXISTS (
         SELECT 1 FROM worker_ettevotted we
         JOIN ettevotted e ON e.id = we.ettevote_id
         WHERE we.worker_id = w.id AND e.aktiivne = true AND LOWER(e.tyyp) = ANY($2)
       )
     ORDER BY w.nimi`,
    [kuupaev, ETTEVOTTE_TYYBID]
  );
  const saajad = r.rows.filter(w => w.teavitused && !w.kirjas);
  for (const w of saajad) {
    await saadaTeavitus(w.id, PEALKIRI, SONUM, '/tootaja');
  }
  await pool.query(`UPDATE tunni_meeldetuletused SET saajaid=$1 WHERE kuupaev=$2 AND liik=$3`, [saajad.length, kuupaev, liik]);
  const juba = r.rows.filter(w => w.kirjas).length;
  const lubamata = r.rows.filter(w => !w.teavitused && !w.kirjas).length;
  console.log(`⏰ Tunnimeeldetuletus (${liik}, ${kuupaev}): saadetud ${saajad.length} töötajale`
    + (saajad.length ? ` [${saajad.map(w => w.nimi).join(', ')}]` : '')
    + `; ${juba} on tunnid juba kirja pannud; ${lubamata} pole teavitusi lubanud.`);
}

async function kontrolli() {
  try {
    const nyyd = eestiAeg();
    const ajad = [];
    if (nyyd.toopaev) ajad.push({ kell: KELL, liik: 'paev' });
    YHEKORDSED.filter(y => y.kuupaev === nyyd.kuupaev).forEach(y => ajad.push({ kell: y.kell, liik: 'test-' + y.kell }));
    for (const a of ajad) {
      const algus = minutiteks(a.kell);
      if (nyyd.minutid < algus || nyyd.minutid >= algus + AKEN_MINUTID) continue;
      await looTabel();
      await saada(nyyd.kuupaev, a.liik);
    }
  } catch (err) {
    console.error('Tunnimeeldetuletus ebaõnnestus:', err.message);
  }
}

function kaivita() {
  setInterval(kontrolli, 60 * 1000);
  kontrolli();
}

module.exports = { kaivita, kontrolli, eestiAeg };
