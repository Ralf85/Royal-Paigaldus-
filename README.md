# Tööaja arvestus

Lihtne veebirakendus töötajate tööaja ja palkade haldamiseks.

## Funktsioonid
- Töötajad logivad sisse PIN-koodiga
- Valivad objekti ja märgivad kellaaegade vahemiku
- Süsteem arvutab tunnid automaatselt
- Admin saab näha kõigi kirjeid, sisestada makseid, alla laadida CSV raportit

## Ülesseadmine Railway peal

### 1. GitHub repo
- Tee uus repo GitHubis
- Lae see kood sinna üles

### 2. Railway
- Mine railway.app → New Project → Deploy from GitHub
- Vali oma repo
- Lisa andmebaas: "+ New" → "Database" → PostgreSQL

### 3. Keskkonnamuutujad (Environment Variables)
Railway projektis "Variables" all lisa:
```
SESSION_SECRET=mingi_pikk_juhuslik_tekst_siin
ADMIN_PIN=sinu_admin_pin
```
DATABASE_URL lisab Railway ise automaatselt.

### 4. Valmis!
Railway annab sulle URL-i. Ava see ja alusta kasutamist.

## Esimesed sammud pärast avamist
1. Mine /admin-login → sisesta admin PIN
2. Lisa töötajad (Töötajad tab)
3. Lisa objektid (Objektid tab)
4. Jaga töötajatele nende PIN-koodid
