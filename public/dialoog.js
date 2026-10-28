// Ühine kinnitus-/sisestusaken brauseri confirm()/prompt()/alert() asemel.
// Safari (eriti iPhone'il ja avakuvalt avatud rakenduses) võib brauseri omad aknad vaikselt ära jätta —
// siis nupp "ei tee midagi". Need funktsioonid tagastavad Promise'i, kasuta koos await-iga:
//   if (!await rpKysi('Kustutad?')) return;
//   var nimi = await rpKysiTeksti('Nimi:', 'vaikimisi');   // null = katkestati
//   rpTeata('Salvestatud');
(function () {
  // Läti lehed on inglise keeles (lang="en") — siis ka nupud inglise keeles.
  var ingl = (document.documentElement.lang || '').toLowerCase().indexOf('en') === 0;
  function looAken(tekst, tyyp, vaikimisi, jahTekst) {
    return new Promise(function (valmis) {
      var kate = document.createElement('div');
      kate.setAttribute('style', 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif');
      var kast = document.createElement('div');
      kast.setAttribute('style', 'background:#171a21;color:#e2e8f0;border:1px solid #2b3039;border-radius:14px;width:100%;max-width:400px;padding:18px;box-shadow:0 20px 50px rgba(0,0,0,0.5)');
      var t = document.createElement('div');
      t.setAttribute('style', 'font-size:15px;line-height:1.5;white-space:pre-wrap;margin-bottom:14px');
      t.textContent = tekst;
      kast.appendChild(t);
      var sisend = null;
      if (tyyp === 'tekst') {
        sisend = document.createElement('input');
        sisend.type = 'text';
        sisend.value = vaikimisi == null ? '' : String(vaikimisi);
        sisend.setAttribute('style', 'width:100%;box-sizing:border-box;background:#0d0f13;border:1px solid #2b3039;border-radius:8px;padding:10px 12px;color:#e2e8f0;font-size:16px;margin-bottom:14px;outline:none');
        kast.appendChild(sisend);
      }
      var nupud = document.createElement('div');
      nupud.setAttribute('style', 'display:flex;gap:8px;justify-content:flex-end');
      var nupuStiil = 'border-radius:9px;padding:10px 16px;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;border:1px solid #2b3039;';
      function sulge(v) {
        document.removeEventListener('keydown', klahv, true);
        if (kate.parentNode) kate.parentNode.removeChild(kate);
        valmis(v);
      }
      var katkestus = tyyp === 'tekst' ? null : false;
      if (tyyp !== 'teade') {
        var ei = document.createElement('button');
        ei.type = 'button'; ei.textContent = ingl ? 'Cancel' : 'Tühista';
        ei.setAttribute('style', nupuStiil + 'background:#1e2128;color:#cbd2dc');
        ei.onclick = function () { sulge(katkestus); };
        nupud.appendChild(ei);
      }
      var jah = document.createElement('button');
      jah.type = 'button';
      jah.textContent = jahTekst || (tyyp === 'kysimus' ? (ingl ? 'Yes' : 'Jah') : 'OK');
      jah.setAttribute('style', nupuStiil + 'background:#c9a84c;border-color:#c9a84c;color:#14110a');
      jah.onclick = function () { sulge(tyyp === 'tekst' ? sisend.value : true); };
      nupud.appendChild(jah);
      kast.appendChild(nupud);
      kate.appendChild(kast);
      kate.addEventListener('click', function (e) { if (e.target === kate) sulge(katkestus); });
      function klahv(e) {
        if (e.key === 'Escape') { e.preventDefault(); sulge(katkestus); }
        else if (e.key === 'Enter') { e.preventDefault(); jah.click(); }
      }
      document.addEventListener('keydown', klahv, true);
      document.body.appendChild(kate);
      if (sisend) { sisend.focus(); sisend.select(); } else jah.focus();
    });
  }
  window.rpKysi = function (tekst, jahTekst) { return looAken(tekst, 'kysimus', null, jahTekst); };
  window.rpKysiTeksti = function (tekst, vaikimisi) { return looAken(tekst, 'tekst', vaikimisi); };
  window.rpTeata = function (tekst) { return looAken(String(tekst), 'teade'); };
  // Ka tavalised teated (alert) näidatakse oma aknas — Safari võib brauseri alert()-i vaikselt ära jätta.
  window.alert = function (tekst) { window.rpTeata(tekst == null ? '' : tekst); };
  // Tänane kuupäev KOHALIKU aja järgi (AAAA-KK-PP). toISOString() annab UTC aja — Eestis kell 00–03 oleks see eilne päev.
  window.kohalikTana = function () {
    var t = new Date();
    return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
  };
})();
