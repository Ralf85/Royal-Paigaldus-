// ailugeja.js — ühine tšekkide ja arvete lugemine AI abil.
//
// Miks see fail on: varem luges iga leht dokumenti omaette, kõige väiksema mudeliga ja ilma kontrollita.
// Lõppsumma (suur kiri) tuli tavaliselt õigesti, kuid käibemaks (väike kiri) tihti valesti — nt Bauhofi
// tšekil 9,27 asemel 7,22. Nüüd:
//   1) kasutatakse täpsemat mudelit (kui see pole saadaval, minnakse automaatselt järgmise peale);
//   2) telefonipilt saadetakse lisaks tervikvaatele ka suurendatud lõikudena (teeb brauser, vt public/aipilt.js);
//   3) AI kirjutab kõigepealt kokkuvõtte read tšekilt sõna-sõnalt maha ja alles siis täidab väljad — arvutada ei tohi;
//   4) server kontrollib ise üle, kas  summa km-ta + käibemaks = kokku.  Kui ei klapi, leitakse õige käibemaks
//      kahe omavahel klappiva arvu ja Eesti käibemaksumäära järgi või palutakse AI-l uuesti lugeda.
//      Kui ka siis ei klapi, saab kasutaja selge hoiatuse (mitte vaikselt vale numbri).

const API_URL = process.env.ANTHROPIC_API_URL || 'https://api.anthropic.com/v1/messages';
const OOTEAEG_MS = 60000;

// Mudelid eelistuse järjekorras. Railway muutujaga AI_MUDEL saab esimest valikut muuta.
function mudelid() {
  const list = ['claude-sonnet-5-5', 'claude-sonnet-4-5', 'claude-haiku-4-5-20251001'];
  const oma = (process.env.AI_MUDEL || '').trim();
  return oma ? [oma].concat(list.filter(m => m !== oma)) : list;
}
let toimivMudel = null; // viimati töötanud mudel — et mitte iga kord puuduvat mudelit uuesti proovida

// ── Failide vastuvõtt: "fail" on originaal (salvestamiseks), "ai_pilt" on brauseri tehtud lõigud AI jaoks ──
function aiFailid(upload) {
  const mw = upload.fields([{ name: 'fail', maxCount: 1 }, { name: 'ai_pilt', maxCount: 6 }]);
  return (req, res, next) => mw(req, res, (err) => {
    if (err) return next(err);
    const f = req.files || {};
    req.file = (f.fail && f.fail[0]) || null;
    req.aiPildid = (f.ai_pilt || []).filter(p => /^image\/(jpeg|png|webp)$/.test(p.mimetype));
    next();
  });
}

const LUBATUD_PILDID = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

// Koostab AI-le saadetava sisu (PDF või pildid). Tagastab { sisu } või { veateade }.
function sisuBlokid(req) {
  const fail = req.file;
  if (!fail) return { veateade: 'Faili ei leitud' };
  if (fail.mimetype === 'application/pdf') {
    return { sisu: [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: fail.buffer.toString('base64') } }] };
  }
  const pildid = req.aiPildid || [];
  if (pildid.length) {
    const sisu = [];
    if (pildid.length > 1) {
      sisu.push({ type: 'text', text: `Järgnevad ${pildid.length} pilti on ÜKS JA SAMA dokument. Esimene pilt on tervikvaade. Ülejäänud on sama dokumendi suurendatud lõigud ülalt alla (lõigud kattuvad veidi, sama rida võib olla kahel lõigul). Numbrid loe suurendatud lõikudelt — seal on need selgemad.` });
    }
    pildid.forEach(p => sisu.push({ type: 'image', source: { type: 'base64', media_type: p.mimetype, data: p.buffer.toString('base64') } }));
    return { sisu };
  }
  if (!LUBATUD_PILDID.includes(fail.mimetype)) {
    return { veateade: 'Seda pildivormingut AI lugeda ei oska. Tee pilt JPG või PNG kujul või täida väljad käsitsi.' };
  }
  return { sisu: [{ type: 'image', source: { type: 'base64', media_type: fail.mimetype, data: fail.buffer.toString('base64') } }] };
}

// ── Üks päring AI-le. messages = tavaline sõnumite massiiv. Tagastab { ok, tekst } või { ok:false, veateade } ──
async function kysiAI(messages, maxTokens) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { ok: false, veateade: 'AI lugemine pole seadistatud (ANTHROPIC_API_KEY puudub Railway keskkonnamuutujates).' };
  }
  let jarjekord = mudelid();
  if (toimivMudel) jarjekord = [toimivMudel].concat(jarjekord.filter(m => m !== toimivMudel));
  let viimaneViga = 'AI lugemine ebaõnnestus';
  for (const mudel of jarjekord) {
    let resp, data;
    try {
      resp = await fetch(API_URL, {
        method: 'POST',
        headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: mudel, max_tokens: maxTokens || 1000, messages }),
        signal: AbortSignal.timeout(OOTEAEG_MS)
      });
      data = await resp.json().catch(() => ({}));
    } catch (err) {
      viimaneViga = (err && err.name === 'TimeoutError') ? 'AI ei vastanud õigeks ajaks — proovi uuesti või täida käsitsi.' : 'AI-ga ei saanud ühendust: ' + (err && err.message);
      console.error(`AI lugeja (${mudel}):`, err && err.message);
      continue;
    }
    if (resp.ok) {
      toimivMudel = mudel;
      const tekst = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
      return { ok: true, tekst, mudel };
    }
    const teade = (data.error && data.error.message) || ('HTTP ' + resp.status);
    console.error(`AI lugeja (${mudel}) viga ${resp.status}:`, teade);
    viimaneViga = teade;
    if (toimivMudel === mudel) toimivMudel = null;
    // Vale võti või vigane fail -> teine mudel ei aita, lõpetame kohe.
    if (resp.status === 401 || resp.status === 403) return { ok: false, veateade: 'AI võti (ANTHROPIC_API_KEY) ei kehti.' };
    if (resp.status === 400 && !/model/i.test(teade)) return { ok: false, veateade: 'AI ei saanud faili lugeda: ' + teade };
    if (resp.status === 413) return { ok: false, veateade: 'Fail on AI jaoks liiga suur — täida väljad käsitsi.' };
    // Muul juhul (mudelit pole, ülekoormus, ajutine viga) proovime järgmist mudelit.
  }
  return { ok: false, veateade: 'AI lugemine ebaõnnestus: ' + viimaneViga };
}

function loeJson(tekst) {
  try {
    const vaste = String(tekst || '').match(/\{[\s\S]*\}/);
    const v = JSON.parse(vaste ? vaste[0] : tekst);
    return v && typeof v === 'object' ? v : null;
  } catch (e) { return null; }
}

// ── Summade kontroll ──
const MAARAD = [24, 22, 20, 13, 9, 5]; // Eesti käibemaksumäärad (praegused ja varasemad)

// "1 234,50 €" -> 1234.5
function arv(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (v == null) return 0;
  let s = String(v).replace(/[^\d,.\-]/g, '');
  if (s.includes(',') && s.includes('.')) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else s = s.replace(',', '.');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}
const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const eur = (n) => r2(n).toFixed(2).replace('.', ',');

// Kas km on km_ta suhtes mõne Eesti määra järgi õige? Tagastab määra (nt 24) või null.
function sobivMaar(kmTa, km) {
  if (!(kmTa > 0) || !(km > 0)) return null;
  const lubatud = Math.max(0.021, kmTa * 0.0006); // tšekil ümardatakse ridade kaupa, paar senti võib erineda
  let parim = null, parimVahe = Infinity;
  for (const m of MAARAD) {
    const vahe = Math.abs(kmTa * m / 100 - km);
    if (vahe <= lubatud && vahe < parimVahe) { parim = m; parimVahe = vahe; }
  }
  return parim;
}
const klapib = (kmTa, km, kokku) => Math.abs(kmTa + km - kokku) <= 0.021;

// Võtab AI loetud arvud ja tagastab kontrollitud { summa_km_ta, kaibemaks, kokku, km_kontroll }.
// km_kontroll.olek:  'ok' (klapib) | 'parandatud' (üks arv oli valesti loetud, leitud teiste järgi)
//                    | 'km_puudub' (dokumendil käibemaksu pole) | 'kontrolli' (ei klapi — vaata ise üle)
function kontrolliSummad(v) {
  v = v || {};
  let kmTa = r2(arv(v.summa_km_ta)), km = r2(arv(v.kaibemaks)), kokku = r2(arv(v.kokku != null ? v.kokku : v.summa));
  const loetud = { kmTa, km, kokku };
  const read = (Array.isArray(v.km_read) ? v.km_read : [])
    .map(r => ({ kmTa: r2(arv(r && r.km_ta)), km: r2(arv(r && r.km)) }))
    .filter(r => r.kmTa > 0 || r.km > 0);
  const rKmTa = r2(read.reduce((s, r) => s + r.kmTa, 0)), rKm = r2(read.reduce((s, r) => s + r.km, 0));
  const readKlapivad = read.length > 0 && kokku > 0 && klapib(rKmTa, rKm, kokku);

  const valmis = (olek, tekst, maar) => ({
    summa_km_ta: kmTa, kaibemaks: km, kokku,
    km_kontroll: { olek, tekst, maar: maar || null, kontrolli: olek === 'kontrolli' }
  });
  const rida = (maar) => `${eur(kmTa)} + KM ${maar ? maar + '% ' : ''}${eur(km)} = ${eur(kokku)} €`;

  if (!(kokku > 0) && !(kmTa > 0)) return valmis('kontrolli', 'Summat ei õnnestunud lugeda — täida käsitsi.');

  // Käibemaksu dokumendil pole (müüja pole käibemaksukohustuslane) või see on 0.
  if (kokku > 0 && km === 0 && (kmTa === 0 || Math.abs(kmTa - kokku) <= 0.021) && !rKm) {
    kmTa = kokku;
    return valmis('km_puudub', `Käibemaksu dokumendil ei leitud (kokku ${eur(kokku)} €). Kui tšekil on käibemaks siiski kirjas, lisa see käsitsi.`);
  }

  // 1) Kõik kolm arvu klapivad omavahel.
  if (kokku > 0 && kmTa > 0 && km > 0 && klapib(kmTa, km, kokku)) {
    const maar = sobivMaar(kmTa, km);
    if (maar || readKlapivad || read.length > 1) return valmis('ok', 'Loetud: ' + rida(maar) + ' ✓', maar);
    return valmis('kontrolli', `Loetud: ${rida()} — käibemaksu määr on ebatavaline, kontrolli käibemaks üle.`);
  }

  // 2) Ei klapi või üks arv puudub: otsime kaks arvu, mis annavad korrektse käibemaksumäära.
  const variandid = [];
  if (kokku > 0 && kmTa > 0 && kokku > kmTa) {
    const m = sobivMaar(kmTa, r2(kokku - kmTa));
    if (m) variandid.push({ kmTa, km: r2(kokku - kmTa), kokku, maar: m, vale: 'käibemaks' });
  }
  if (kokku > 0 && km > 0 && kokku > km) {
    const m = sobivMaar(r2(kokku - km), km);
    if (m) variandid.push({ kmTa: r2(kokku - km), km, kokku, maar: m, vale: 'summa käibemaksuta' });
  }
  if (kmTa > 0 && km > 0) {
    const m = sobivMaar(kmTa, km);
    if (m) variandid.push({ kmTa, km, kokku: r2(kmTa + km), maar: m, vale: 'lõppsumma' });
  }
  // Mitme käibemaksumääraga dokument: määrade read kokku annavad lõppsumma.
  if (!variandid.length && readKlapivad) {
    kmTa = rKmTa; km = rKm;
    return valmis('parandatud', `Võetud käibemaksu ridadelt: ${rida()} ✓`);
  }
  // Sama tulemusega variandid loeme üheks.
  const erinevad = variandid.filter((a, i) => variandid.findIndex(b => b.kmTa === a.kmTa && b.km === a.km && b.kokku === a.kokku) === i);
  if (erinevad.length === 1) {
    const x = erinevad[0];
    const puudus = (x.vale === 'käibemaks' && !loetud.km) || (x.vale === 'summa käibemaksuta' && !loetud.kmTa) || (x.vale === 'lõppsumma' && !loetud.kokku);
    kmTa = x.kmTa; km = x.km; kokku = x.kokku;
    if (puudus) return valmis('ok', 'Loetud: ' + rida(x.maar) + ' ✓', x.maar);
    return valmis('parandatud', `Kontrollitud: ${rida(x.maar)} ✓ (${x.vale} oli valesti loetud, parandatud teiste arvude järgi)`, x.maar);
  }

  // 3) Ei õnnestunud kindlaks teha.
  if (!(kokku > 0)) kokku = r2(kmTa + km);
  return valmis('kontrolli', `Summad ei klapi: ${eur(loetud.kmTa)} + KM ${eur(loetud.km)} ≠ ${eur(loetud.kokku)} € — kontrolli käibemaks üle!`);
}

// Viimane abinõu: arvud ei klappinud ka pärast uuesti lugemist. Lõppsumma on tšekil suurelt ja loetakse
// peaaegu alati õigesti, seega pakume käibemaksu lõppsummast tavamäära järgi (dokumendi kuupäeval kehtinud määr).
// Olek jääb 'kontrolli' — kasutaja näeb hoiatust, kuid väljal on tõenäoliselt õige number, mitte valesti loetud.
function pakuStandardMaaraga(summad, kuupaev) {
  const kokku = summad.kokku;
  if (!(kokku > 0)) return summad;
  const kp = String(kuupaev || '');
  const maar = /^\d{4}-\d{2}-\d{2}/.test(kp) ? (kp < '2024-01-01' ? 20 : (kp < '2025-07-01' ? 22 : 24)) : 24;
  const km = r2(kokku * maar / (100 + maar));
  return {
    summa_km_ta: r2(kokku - km), kaibemaks: km, kokku,
    km_kontroll: {
      olek: 'kontrolli', kontrolli: true, maar,
      tekst: `Käibemaksu ei õnnestunud dokumendilt kindlalt lugeda. Pakun lõppsumma järgi ${maar}%: ${eur(kokku - km)} + KM ${eur(km)} = ${eur(kokku)} € — võrdle tšekiga!`
    }
  };
}

// Juhise osa, mis lisatakse iga arve/tšeki juhise lõppu — kuidas summasid lugeda.
const SUMMADE_JUHIS = `
SUMMADE LUGEMINE (väga tähtis — siin tehakse kõige rohkem vigu):
- Leia dokumendilt kokkuvõtte/käibemaksu plokk (read nagu "Summa km-ta", "Käibemaksuta", "KM 24%", "Käibemaks", "Kokku", "Tasuda", "Maksta"; tšekkidel sageli tabel "KM% / KM-ta / KM / Kokku" või "A=24% ...").
- Väljale "kokkuvotte_read" kirjuta need read TÄPSELT nii, nagu need dokumendil on (märk-märgilt, koos numbritega). Tee seda ENNE teiste summaväljade täitmist.
- ÄRA ARVUTA ühtegi summat ise. Kirjuta numbrid dokumendilt maha. Kui käibemaksu summa on dokumendil kirjas, siis kasuta täpselt seda numbrit.
- Loe iga number märk-märgilt. Ära aja segi sarnaseid numbreid: 7 ja 9, 2 ja 7, 1 ja 7, 3 ja 8, 5 ja 6, 0 ja 8. Kõik summad on kahe komakohaga.
- "kaibemaks" on käibemaksu SUMMA eurodes (mitte protsent). "kokku" on lõppsumma KOOS käibemaksuga (see, mis tegelikult maksti). Allahindlus, sularaha, tagasiraha ega kaardimakse rida EI OLE käibemaks.
- Kui dokumendil on mitu käibemaksumäära, pane iga määr eraldi "km_read" reale ning "summa_km_ta" ja "kaibemaks" olgu dokumendil näidatud kogusummad.
- Kontrolli enne vastamist: summa_km_ta + kaibemaks peab andma kokku. Kui ei anna, lugesid mõne numbri valesti — vaata pilti uuesti.
- Kui dokumendil käibemaksu üldse ei ole (müüja pole käibemaksukohustuslane), pane kaibemaks 0 ja summa_km_ta võrdseks lõppsummaga.
Summaväljad JSON-is:
"kokkuvotte_read": ["rida 1 täpselt nagu dokumendil", "rida 2", ...], "km_read": [{"protsent": <nt 24>, "km_ta": <number>, "km": <number>}], "summa_km_ta": <number>, "kaibemaks": <number>, "kokku": <number>`;

// ── Põhifunktsioon: loeb dokumendi ja tagastab JSON-väljad. valikud.summad=true lisab summade kontrolli. ──
// Tagastab { ok:true, valjad, summad } või { ok:false, veateade }.
async function loeDokument(req, juhis, valikud) {
  valikud = valikud || {};
  const s = sisuBlokid(req);
  if (s.veateade) return { ok: false, veateade: s.veateade };
  const esimene = { role: 'user', content: s.sisu.concat([{ type: 'text', text: juhis + (valikud.summad ? SUMMADE_JUHIS : '') }]) };
  const maxTokens = valikud.maxTokens || (valikud.summad ? 1200 : 500);

  const v1 = await kysiAI([esimene], maxTokens);
  if (!v1.ok) return v1;
  let valjad = loeJson(v1.tekst);
  if (!valjad) return { ok: false, veateade: 'AI vastust ei õnnestunud lugeda — proovi uuesti või täida käsitsi.' };
  if (!valikud.summad) return { ok: true, valjad };

  let summad = kontrolliSummad(valjad);
  if (summad.km_kontroll.olek === 'kontrolli') {
    // Arvud ei klapi -> palume üks kord uuesti lugeda, öeldes täpselt, mis ei klappinud.
    const parandus = `Sinu loetud summad ei klapi omavahel: summa_km_ta ${arv(valjad.summa_km_ta)} + kaibemaks ${arv(valjad.kaibemaks)} ei anna kokku ${arv(valjad.kokku)}. Vähemalt üks number on valesti loetud. Vaata kokkuvõtte/käibemaksu plokki uuesti (kasuta suurendatud lõike), loe iga number märk-märgilt ja vasta uuesti SAMA JSON-objektiga (kõik väljad), ilma muu tekstita. Ära arvuta — kirjuta dokumendilt maha.`;
    const v2 = await kysiAI([esimene, { role: 'assistant', content: v1.tekst || '{}' }, { role: 'user', content: parandus }], maxTokens);
    const uued = v2.ok ? loeJson(v2.tekst) : null;
    if (uued) {
      const summad2 = kontrolliSummad(uued);
      if (summad2.km_kontroll.olek !== 'kontrolli') {
        valjad = Object.assign({}, valjad, uued);
        summad = summad2;
      }
    }
  }
  if (summad.km_kontroll.olek === 'kontrolli') summad = pakuStandardMaaraga(summad, valjad.kuupaev);
  console.log(`AI lugeja [${v1.mudel}] ${summad.km_kontroll.olek}: loetud km-ta=${arv(valjad.summa_km_ta)} km=${arv(valjad.kaibemaks)} kokku=${arv(valjad.kokku)} -> ${summad.summa_km_ta} / ${summad.kaibemaks} / ${summad.kokku}`);
  return { ok: true, valjad, summad };
}

// Kuupäev peab olema kujul AAAA-KK-PP, muidu jätame tühjaks (vigane kuupäev ei lähe vormi).
function puhasKuupaev(s) {
  s = String(s || '').trim().slice(0, 10);
  const pp = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/); // 05.10.2026 -> 2026-10-05
  if (pp) s = `${pp[3]}-${pp[2].padStart(2, '0')}-${pp[1].padStart(2, '0')}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s + 'T00:00:00Z')) ? s : '';
}

module.exports = { pakuStandardMaaraga, aiFailid, loeDokument, kontrolliSummad, kysiAI, loeJson, arv, puhasKuupaev, SUMMADE_JUHIS };
