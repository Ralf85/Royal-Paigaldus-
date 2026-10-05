// zipabi.js — ühine abi ZIP-failide koostamiseks (fotod, arved).
// Varem: üks kättesaamatu pilt katkestas kogu ZIP-i poole pealt, kinni jäänud ühendus jättis
// allalaadimise lõputult ootama ning failinimedes oli kuupäeva asemel pikk ingliskeelne ajatempel.
const archiver = require('archiver');
const https = require('https');
const http = require('http');

const OOTEAEG_MS = 20000; // nii kaua oodatakse ühe faili ühendust / andmeid, enne kui see vahele jäetakse

// Loob ZIP-i ja seob selle vastusega. Tagastab { archive, olek }.
function looZip(res) {
  const archive = archiver('zip', { zlib: { level: 6 } });
  const olek = { katkenud: false, puudu: [], nimed: new Set(), res };
  archive.on('warning', (err) => console.warn('ZIP hoiatus:', err.message));
  archive.on('error', (err) => {
    console.error('ZIP viga:', err.message);
    olek.katkenud = true;
    try { res.destroy(); } catch (e) {}
  });
  // Kasutaja katkestas allalaadimise -> ei laadi ülejäänud faile asjata alla.
  res.on('close', () => {
    if (!res.writableFinished) { olek.katkenud = true; try { archive.abort(); } catch (e) {} }
  });
  archive.pipe(res);
  return { archive, olek };
}

// Failinimi ZIP-i sees: lubatud märgid + kordumatus (sama nimega faile ZIP-is olla ei tohi).
function zipNimi(olek, soovitud) {
  // Täpitähed lihtsustatakse (õ->o, ä->a, š->s), muud keelatud märgid asendatakse alakriipsuga.
  let nimi = String(soovitud || 'fail').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9-_.]/g, '_').replace(/_+/g, '_');
  if (!olek.nimed.has(nimi.toLowerCase())) { olek.nimed.add(nimi.toLowerCase()); return nimi; }
  const punkt = nimi.lastIndexOf('.');
  const alus = punkt > 0 ? nimi.slice(0, punkt) : nimi, laiend = punkt > 0 ? nimi.slice(punkt) : '';
  let n = 2;
  while (olek.nimed.has(`${alus}_${n}${laiend}`.toLowerCase())) n++;
  nimi = `${alus}_${n}${laiend}`;
  olek.nimed.add(nimi.toLowerCase());
  return nimi;
}

// Kuupäev failinime jaoks kujul AAAA-KK-PP (andmebaasi kuupäev on Date objekt, mitte tekst).
function kpNimeks(kp) {
  if (!kp) return 'kuupaevata';
  if (typeof kp === 'string' && /^\d{4}-\d{2}-\d{2}/.test(kp)) return kp.slice(0, 10);
  const d = new Date(kp);
  if (isNaN(d)) return 'kuupaevata';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Lisab ZIP-i faili aadressilt (Cloudinary). Kui faili ei saa kätte (viga, vale vastus, ooteaeg),
// jäetakse see vahele ja märgitakse olek.puudu nimekirja — ülejäänud ZIP tehakse ikka valmis.
function lisaUrl(archive, olek, url, soovitudNimi) {
  return new Promise((resolve) => {
    if (olek.katkenud) return resolve(false);
    const nimi = zipNimi(olek, soovitudNimi);
    let valmis = false;
    const lopeta = (ok, pohjus) => {
      if (valmis) return;
      valmis = true;
      if (!ok) olek.puudu.push(`${nimi} — ${pohjus}`);
      resolve(ok);
    };
    let paring;
    try {
      const proto = new URL(url).protocol === 'https:' ? https : http;
      paring = proto.get(url, (vastus) => {
        if (vastus.statusCode !== 200) {
          vastus.resume();
          return lopeta(false, `server vastas ${vastus.statusCode}`);
        }
        archive.append(vastus, { name: nimi });
        vastus.on('end', () => lopeta(true));
        // Katkes poole faili pealt: ZIP-i ei saa enam terveks teha -> katkestame kohe (parem kui lõputu ootamine).
        const katkes = (miks) => {
          if (valmis) return;
          console.error(`ZIP: fail katkes poole pealt (${nimi}): ${miks}`);
          olek.katkenud = true;
          try { archive.abort(); } catch (e) {}
          try { olek.res.destroy(); } catch (e) {} // lõpetab allalaadimise kohe (muidu jäi brauser ootama)
          lopeta(false, 'katkes poole pealt');
        };
        vastus.on('error', (e) => katkes(e.message));
        vastus.on('aborted', () => katkes('ühendus katkes'));
      });
      paring.setTimeout(OOTEAEG_MS, () => paring.destroy(new Error('ooteaeg ületatud')));
      paring.on('error', (e) => lopeta(false, e.message));
    } catch (e) {
      lopeta(false, e.message);
    }
  });
}

// Lõpetab ZIP-i. Kui mõni fail jäi vahele, lisatakse ZIP-i tekstifail nende nimekirjaga.
async function lopetaZip(archive, olek) {
  if (olek.katkenud) return;
  if (olek.puudu.length) {
    archive.append(
      'Neid faile ei õnnestunud ZIP-i lisada:\r\n\r\n' + olek.puudu.join('\r\n') + '\r\n',
      { name: 'PUUDUVAD_FAILID.txt' }
    );
  }
  await archive.finalize();
}

// Pildi (nt logo) laadimine mällu koos ooteajaga — PDF-i jaoks.
function laadiPuhver(url, ooteMs) {
  return new Promise((resolve, reject) => {
    try {
      const proto = new URL(url).protocol === 'https:' ? https : http;
      const paring = proto.get(url, (r) => {
        if (r.statusCode !== 200) { r.resume(); return reject(new Error('HTTP ' + r.statusCode)); }
        const tykid = [];
        r.on('data', (c) => tykid.push(c));
        r.on('end', () => resolve(Buffer.concat(tykid)));
        r.on('error', reject);
      });
      paring.setTimeout(ooteMs || 10000, () => paring.destroy(new Error('ooteaeg ületatud')));
      paring.on('error', reject);
    } catch (e) { reject(e); }
  });
}

module.exports = { looZip, lisaUrl, lopetaZip, zipNimi, kpNimeks, laadiPuhver };
