// csvabi.js — ühine CSV kirjutaja kõigile raportitele.
// Eesti Excel ootab: semikoolon eraldajaks, UTF-8 BOM faili alguses, reavahetus CRLF.
// Iga väli pannakse vajadusel jutumärkidesse — muidu nihutas semikoolon, jutumärk või reavahetus
// kommentaaris veerud paigast (summad sattusid valesse veergu).

// Ainult number (nt "12,5", "-3.20") — neid ei tohi tekstiks muuta, muidu ei saa Excelis summeerida.
const NUMBER_RE = /^-?\d+([.,]\d+)?$/;

function csvVali(vaartus) {
  let s = vaartus == null ? '' : String(vaartus);
  // Excel käivitab =, +, - või @ märgiga algava lahtri valemina. Töötaja kirjutatud tekst ei tohi
  // valemina käivituda, seepärast lisame ette ülakoma (Excel näitab siis lihtsalt teksti).
  if (/^[=+\-@\t\r]/.test(s) && !NUMBER_RE.test(s)) s = "'" + s;
  if (/[;"\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function csvRida(valjad) {
  return valjad.map(csvVali).join(';');
}

// read: massiiv ridadest, iga rida on väljade massiiv. Tagastab valmis faili sisu (koos BOM-iga).
function csvFail(read) {
  return '﻿' + read.map(csvRida).join('\r\n') + '\r\n';
}

// Number Eesti Exceli jaoks: koma komakohana, soovi korral kindel komakohtade arv.
function csvArv(n, kohti) {
  const arv = parseFloat(n);
  if (!Number.isFinite(arv)) return '0';
  return (kohti == null ? String(arv) : arv.toFixed(kohti)).replace('.', ',');
}

function csvKuupaev(kp) {
  if (!kp) return '';
  const d = new Date(kp);
  if (isNaN(d)) return String(kp);
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}

// ── Sisendi kontroll raportitele: vigane kuupäev andis varem andmebaasi vea (HTTP 500) ──
function onKuupaev(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s + 'T00:00:00Z'));
}
// Tagastab { aasta, kuu } või null, kui väärtused pole korrektsed.
function loeAastaKuu(aasta, kuu) {
  const a = parseInt(aasta, 10), k = parseInt(kuu, 10);
  if (!Number.isInteger(a) || !Number.isInteger(k) || String(aasta).trim() !== String(a) || a < 2000 || a > 2100 || k < 1 || k > 12) return null;
  return { aasta: a, kuu: k };
}

// Content-Disposition päise väärtus faili nimega. HTTP päis ei tohi sisaldada täpitähti nagu š ja ž —
// Node viskas siis vea ja raport jäi alla laadimata (nt töötaja nimega Šmidt). Lahendus: päisesse läheb
// lihtsustatud nimi (ilma täpitähtedeta) ja lisaks täpne nimi UTF-8 kujul, mida brauserid eelistavad.
function failiPais(nimi, viis) {
  const puhas = String(nimi || 'fail').replace(/[\\/:*?"<>|\r\n]/g, '-').trim() || 'fail';
  const ascii = puhas.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7e]/g, '_');
  const utf8 = encodeURIComponent(puhas).replace(/['()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  return `${viis || 'attachment'}; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

module.exports = { failiPais,  csvVali, csvRida, csvFail, csvArv, csvKuupaev, onKuupaev, loeAastaKuu };
