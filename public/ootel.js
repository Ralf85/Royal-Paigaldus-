// ootel.js — töökirjete ootejärjekord nõrga levi jaoks (telefoni brauseri IndexedDB-s).
// Kui kirje salvestamisel levi pole, jääb kirje (koos poe seisu ja piltidega) telefoni ootama
// ja saadetakse automaatselt, kui ühendus tagasi tuleb. Iga kirjel on oma klient_id — server
// ei loo sama kirjet kaks korda, isegi kui vastus eelmisel katsel teele jäi.
(function () {
  var DB = 'rp-ootel', POOD = 'kirjed';
  function ava() {
    return new Promise(function (ok, viga) {
      var r = indexedDB.open(DB, 1);
      r.onupgradeneeded = function () { r.result.createObjectStore(POOD, { keyPath: 'klient_id' }); };
      r.onsuccess = function () { ok(r.result); };
      r.onerror = function () { viga(r.error); };
    });
  }
  function paring(rezhiim, tegevus) {
    return ava().then(function (db) {
      return new Promise(function (ok, viga) {
        var t = db.transaction(POOD, rezhiim);
        var r = tegevus(t.objectStore(POOD));
        t.oncomplete = function () { ok(r && r.result); db.close(); };
        t.onerror = function () { viga(t.error); db.close(); };
      });
    });
  }
  window.rpOotel = {
    toetatud: typeof indexedDB !== 'undefined',
    salvesta: function (k) { return paring('readwrite', function (s) { return s.put(k); }); },
    koik: function () { return paring('readonly', function (s) { return s.getAll(); }).then(function (x) { return x || []; }); },
    eemalda: function (id) { return paring('readwrite', function (s) { return s.delete(id); }); }
  };
  // Uus unikaalne id kirjele (kordussaatmise kaitse)
  window.rpKlientId = function () {
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  };
})();
