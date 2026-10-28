// Kuu sulgemine: kui admin on kuu sulgenud (tunnid makstud), ei saa töötaja selle kuu
// töökirjeid ega lisakulusid enam lisada, muuta ega kustutada. Admin saab ikka muuta.
const { pool } = require('./db');

// Kas kuupäev (AAAA-KK-PP string või Date) kuulub suletud kuusse?
async function onKuuSuletud(kuupaev) {
  if (!kuupaev) return false;
  try {
    const r = await pool.query(
      `SELECT 1 FROM kuu_lukud WHERE aasta = EXTRACT(YEAR FROM $1::date)::int AND kuu = EXTRACT(MONTH FROM $1::date)::int`,
      [kuupaev]
    );
    return r.rows.length > 0;
  } catch (e) {
    return false; // tabelit pole veel või vigane kuupäev — ära blokeeri tööd
  }
}

const SULETUD_TEADE = 'See kuu on suletud (tunnid on makstud). Muudatuseks võta ühendust adminiga.';

module.exports = { onKuuSuletud, SULETUD_TEADE };
