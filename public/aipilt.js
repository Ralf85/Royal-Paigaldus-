// aipilt.js — valmistab tšeki/arve pildi AI lugemiseks ette.
// Telefonipilt on väga suur ja AI teeb selle enne lugemist väiksemaks — siis muutuvad väikesed numbrid
// (nt käibemaksu rida) uduseks ja loetakse valesti. Siin lõigatakse pilt brauseris suurendatud ribadeks,
// nii et iga rida jõuab AI-ni terava ja loetavana. Originaalfail läheb alati muutmata kaasa (salvestamiseks).
(function () {
  var LAIUS = 1500;      // lõigu suurim laius pikslites
  var RIBA = 1500;       // lõigu kõrgus
  var KATTUVUS = 180;    // naaberlõigud kattuvad, et ükski rida ei jääks lõikejoonele
  var MAX_RIBASID = 4;
  var TERVIK = 1568;     // tervikvaate pikem külg

  function laePilt(file) {
    if (window.createImageBitmap) {
      return createImageBitmap(file, { imageOrientation: 'from-image' }).catch(function () { return laeImg(file); });
    }
    return laeImg(file);
  }
  function laeImg(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('pilti ei saa avada')); };
      img.src = url;
    });
  }
  // Joonistab pildi osa (sx, sy, sw, sh) lõuendile suurusega (w, h) ja tagastab JPEG-faili.
  function loik(pilt, sx, sy, sw, sh, w, h) {
    return new Promise(function (resolve) {
      var c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(w));
      c.height = Math.max(1, Math.round(h));
      var ctx = c.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(pilt, sx, sy, sw, sh, 0, 0, c.width, c.height);
      c.toBlob(function (b) { c.width = c.height = 0; resolve(b); }, 'image/jpeg', 0.9);
    });
  }

  // Tagastab AI jaoks valmis pildid: [tervikvaade, riba 1, riba 2, ...]. Kui pilt on väike, siis ainult üks.
  async function teeLoigud(file) {
    if (!file || !file.type || file.type.indexOf('image/') !== 0) return [];
    var pilt = await laePilt(file);
    var W = pilt.width || pilt.naturalWidth, H = pilt.height || pilt.naturalHeight;
    if (!W || !H) return [];
    var tulemus = [];
    var tk = Math.min(1, TERVIK / Math.max(W, H));
    var tervik = await loik(pilt, 0, 0, W, H, W * tk, H * tk);
    if (tervik) tulemus.push(tervik);

    // Suurendatud ribad on vajalikud ainult siis, kui tervikvaade on originaalist väiksem.
    var k = Math.min(1, LAIUS / W);
    var maxKorgus = MAX_RIBASID * RIBA - (MAX_RIBASID - 1) * KATTUVUS;
    if (H * k > maxKorgus) k = maxKorgus / H;
    if (k > tk * 1.15) {
      var korgus = H * k;
      var n = Math.max(1, Math.ceil((korgus - KATTUVUS) / (RIBA - KATTUVUS)));
      if (n > MAX_RIBASID) n = MAX_RIBASID;
      if (n > 1) {
        var samm = (korgus - RIBA) / (n - 1);
        for (var i = 0; i < n; i++) {
          var y = Math.max(0, Math.min(korgus - RIBA, i * samm));
          var b = await loik(pilt, 0, y / k, W, RIBA / k, W * k, RIBA);
          if (b) tulemus.push(b);
        }
      } else {
        var yks = await loik(pilt, 0, 0, W, H, W * k, korgus);
        if (yks) tulemus = [yks]; // üks terav pilt asendab tervikvaate
      }
    }
    if (pilt.close) { try { pilt.close(); } catch (e) {} }
    return tulemus;
  }

  // Tagastab saatmiseks valmis vormi: originaalfail ("fail") + AI jaoks tehtud lõigud ("ai_pilt").
  // Kui lõikamine mingil põhjusel ei õnnestu, saadetakse ainult originaal — lugemine töötab ikka.
  window.rpAiVorm = async function (file) {
    var fd = new FormData();
    fd.append('fail', file);
    try {
      var loigud = await teeLoigud(file);
      for (var i = 0; i < loigud.length; i++) fd.append('ai_pilt', loigud[i], 'loik' + (i + 1) + '.jpg');
    } catch (e) { /* jätkame ainult originaaliga */ }
    return fd;
  };
  window.rpAiLoigud = teeLoigud;

  // Näitab välja all, mida AI summade kohta luges ja kas kontroll klappis. Teade jääb nähtavale.
  // koht — element (või selle id), mille järele teade pannakse; r — serveri vastus.
  window.rpAiKmTeade = function (koht, r) {
    var el = typeof koht === 'string' ? document.getElementById(koht) : koht;
    if (!el || !el.parentNode) return;
    var id = (el.id || 'ai') + '-km-kontroll';
    var kast = document.getElementById(id);
    if (!kast) {
      kast = document.createElement('div');
      kast.id = id;
      kast.style.cssText = 'font-size:12.5px;line-height:1.45;margin:8px 0;padding:8px 11px;border-radius:8px;border:1px solid transparent';
      el.parentNode.insertBefore(kast, el.nextSibling);
    }
    var k = r && r.ok && r.km_kontroll;
    if (!k || !k.tekst) { kast.style.display = 'none'; return; }
    var halb = k.olek === 'kontrolli', pooleldi = k.olek === 'km_puudub';
    kast.style.display = 'block';
    kast.style.color = halb ? '#fb923c' : (pooleldi ? '#eab308' : '#4ade80');
    kast.style.borderColor = halb ? 'rgba(251,146,60,0.5)' : (pooleldi ? 'rgba(234,179,8,0.4)' : 'rgba(74,222,128,0.35)');
    kast.style.background = halb ? 'rgba(251,146,60,0.1)' : (pooleldi ? 'rgba(234,179,8,0.08)' : 'rgba(74,222,128,0.08)');
    kast.textContent = (halb ? '⚠️ ' : '🤖 ') + k.tekst;
  };
})();
