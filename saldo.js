// ── Töötaja saldo ja tundide arvutamise reeglid ÜHES KOHAS ──────────────────
// Varem oli sama valem kopeeritud mitmesse faili (admini kokkuvõte, töötaja vaade, Exceli raport)
// ja Cramo lõunapausi reegel kolme kohta. Koopiad läksid ajapikku lahku ja saldod erinesid.
// Nüüd kasutavad kõik need kohad seda faili.
//
// Saldo = kõik teenitud kuni kuupäevani − kõik makstud kuni kuupäevani, kus "teenitud" on:
//   töötunnid × tunnitasu (kirje oma tunnitasu või töötaja tasu selles ettevõttes)
//   + km-hüvitis + töökirje lisakulu
//   + vabad lisakulud + EDGF kulud + Rally Estonia kulud + X-seeria omakulud

// Kulutabelid, mis lähevad saldosse (igas on worker_id, kuupaev, summa)
const KULU_TABELID = ['lisakulud', 'edgf_kulud', 're_kulud', 'xseeria_omakulud'];

// SQL-avaldis: töötaja kogu teenitud summa.
//   wid — SQL-avaldis töötaja id jaoks (nt '$1' või 'w.id')
//   kp  — funktsioon, mis annab kuupäeva tingimuse antud veerule, nt v => `${v} <= $2`
function kogTeenitudSql(wid, kp) {
  return [
    `COALESCE((SELECT SUM(tk.tunnid * COALESCE(tk.muu_tunnitasu, we.tunnitasu, 0))
              FROM tookirjed tk LEFT JOIN worker_ettevotted we ON (we.worker_id = tk.worker_id AND we.ettevote_id = tk.ettevote_id)
              WHERE tk.worker_id=${wid} AND ${kp('tk.kuupaev')}), 0)`,
    `COALESCE((SELECT SUM(km_raha) FROM tookirjed x WHERE x.worker_id=${wid} AND ${kp('x.kuupaev')}), 0)`,
    `COALESCE((SELECT SUM(lisakulu_summa) FROM tookirjed x WHERE x.worker_id=${wid} AND ${kp('x.kuupaev')}), 0)`,
    ...KULU_TABELID.map(t => `COALESCE((SELECT SUM(summa) FROM ${t} x WHERE x.worker_id=${wid} AND ${kp('x.kuupaev')}), 0)`)
  ].join(' +\n');
}

// SQL-avaldis: töötajale kogu makstud summa (sama tingimusega)
function kogMakstudSql(wid, kp) {
  return `COALESCE((SELECT SUM(summa) FROM maksed x WHERE x.worker_id=${wid} AND ${kp('x.kuupaev')}), 0)`;
}

// Tunnid kellaaegadest ("08:00", "16:30"). Üle südaöö (nt 22:00–06:00) loetakse järgmise päevani.
function tunnidKellaajast(algus, lopp) {
  const [ah, am] = String(algus).split(':').map(Number);
  const [lh, lm] = String(lopp).split(':').map(Number);
  let minutid = (lh * 60 + lm) - (ah * 60 + am);
  if (minutid < 0) minutid += 1440;
  return { minutid, tunnid: minutid / 60 };
}

// Cramo: 6 h või pikema päeva puhul arvestatakse maha 0,5 h lõunapausi
function cramoLounapaus(tunnid, tyyp) {
  return (tyyp === 'cramo' && tunnid >= 6) ? tunnid - 0.5 : tunnid;
}

module.exports = { KULU_TABELID, kogTeenitudSql, kogMakstudSql, tunnidKellaajast, cramoLounapaus };
