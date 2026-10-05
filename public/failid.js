// failid.js — failide (PDF, ZIP) avamine ja allalaadimine sisselogimise päisega.
// Varem pandi sisselogimisvõti lingi sisse (?_token=...). Selline link jääb brauseri ajalukku ja
// serveri logidesse ning edasi saates annab saajale ligipääsu. Nüüd küsitakse fail päisega ja
// antakse brauserile valmis failina.
(function () {
  function failiNimi(resp, vaikimisi) {
    var cd = resp.headers.get('content-disposition') || '';
    var m = /(?:^|;)\s*filename="?([^";]+)"?/i.exec(cd) || /filename\*=UTF-8''([^;]+)/i.exec(cd);
    if (!m) return vaikimisi;
    try { return decodeURIComponent(m[1]); } catch (e) { return m[1]; }
  }
  function salvesta(blob, nimi) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = nimi;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 5 * 60 * 1000);
  }
  var pooleli = false;

  // url           — faili aadress (ilma võtmeta)
  // token         — sisselogimisvõti (läheb päisesse)
  // vaikimisiNimi — faili nimi, kui server seda ei anna
  // seaded        — { ava: true } avab faili uuel vahelehel (PDF); { inglise: true } ingliskeelsed teated
  window.rpLaeFail = async function (url, token, vaikimisiNimi, seaded) {
    seaded = seaded || {};
    if (pooleli) return false;
    pooleli = true;
    var aken = null;
    if (seaded.ava) {
      // Vaheleht avatakse kohe klõpsu peale — pärast ootamist avatud akna blokeerib brauser.
      try { aken = window.open('', '_blank'); } catch (e) { aken = null; }
      if (aken) { try { aken.document.write('<title>…</title><p style="font-family:sans-serif;padding:24px;color:#555">' + (seaded.inglise ? 'Loading…' : 'Laadin…') + '</p>'); } catch (e) {} }
    }
    try {
      var resp = await fetch(url, { headers: { 'x-session-token': token || '' } });
      if (!resp.ok) {
        var pohjus = '';
        try { var j = await resp.clone().json(); pohjus = j.veateade || j.error || ''; } catch (e) {}
        if (resp.status === 401) pohjus = seaded.inglise ? 'Your session has expired. Please log in again.' : 'Sessioon on aegunud. Palun logi uuesti sisse.';
        throw new Error(pohjus || ('HTTP ' + resp.status));
      }
      var blob = await resp.blob();
      if (!blob.size) throw new Error(seaded.inglise ? 'Empty file' : 'Server tagastas tühja faili');
      if (aken && !aken.closed) {
        var tyyp = resp.headers.get('content-type') || 'application/pdf';
        var blobUrl = URL.createObjectURL(new Blob([blob], { type: tyyp }));
        aken.location.href = blobUrl;
        setTimeout(function () { URL.revokeObjectURL(blobUrl); }, 5 * 60 * 1000);
      } else {
        salvesta(blob, failiNimi(resp, vaikimisiNimi || 'fail'));
      }
      return true;
    } catch (err) {
      if (aken && !aken.closed) aken.close();
      alert((seaded.inglise ? 'Could not download the file: ' : 'Faili ei õnnestunud alla laadida: ') + (err && err.message ? err.message : ''));
      return false;
    } finally {
      pooleli = false;
    }
  };
})();
