# Kako da ubaciš novu verziju u postojeći sajt

Sajt `https://bistro-de-balzac.netlify.app` već radi — ovo samo zamenjuje stare
fajlove novim. Traje oko 5 minuta.

---

## 1. Supabase — SQL (samo kad paket donosi izmene u bazi)

Ova verzija donosi **korpu za obrisane popise** (čuvaju se 12 sati), pa je
SQL potreban.

1. **supabase.com** → tvoj projekat → levo **SQL Editor** → **New query**.
2. Nalepi sadržaj fajla **`AZURIRANJE-BAZE.sql`** (nalazi se u ovom folderu,
   pored ovog uputstva) — ili ga zatraži od Claude-a da ti ga kopira, pa samo
   **Ctrl + V**.
3. **Run**. Dole treba da vidiš 3 reda: `trash_report`, `restore_report`,
   `purge_report_trash`.

---

## 2. GitHub — zameni fajlove

1. Raspakuj ZIP (desni klik → **Extract All**).
2. Otvori **github.com/Janko2007/bistro-de-balzac**.
3. Gore **Add file** → **Upload files**.
4. U raspakovanom folderu nađi folder **`bistro-de-balzac`** i **prevuci ceo
   folder** na stranicu — isto kao prvi put. GitHub sam zameni stare fajlove
   novim (ništa ne moraš da brišeš).
5. Sačekaj da se sve učita, pa dole **Commit changes**.

---

## 3. Netlify — radi sam

Posle **Commit changes** Netlify za 2–3 minuta sam napravi novu verziju sajta.
Stanje vidiš u **Projects → bistro-de-balzac → Deploys** (piše **Published**
kad je gotovo).

---

## 4. Na telefonu i računaru

Aplikacija čuva kopiju na uređaju, zato posle objave:
- osveži stranicu **dva puta**, ili
- potpuno zatvori aplikaciju / pregledač i otvori ponovo.

---

## Šta je novo u ovoj verziji

- **Obrisani popisi** se čuvaju 12 sati — **Pregled → Obrisani popisi → Vrati**.
- Traka **Predato / Zatvori smenu** stoji iznad donjeg menija (nije više ispod
  njega na iPhone-u).
- **Slika lokala** u pozadini ekrana za prijavu.
- Obrisan tekst „Nemaš nalog ili si zaboravio lozinku?…“ sa prijave.
- Sitna slova ispod dugmadi, polje za datum na iPhone-u i obaveštenja (samo
  jedno, manje) — sređeni.
