# Bistro de Balzac — objava na internet (korak po korak)

Na kraju ćeš imati **pravi sajt** (npr. `https://bistro-de-balzac.netlify.app`) sa
prijavom, koji se na telefonu dodaje na početni ekran i otvara kao aplikacija.

**Ne treba ti ništa da instaliraš na računar.** Sve se radi u pregledaču:

| Servis | Čemu služi | Cena |
|---|---|---|
| **GitHub** | čuva kod aplikacije | besplatno |
| **Supabase** | baza, prijava, slike | besplatno |
| **Netlify** | od koda pravi sajt i drži ga na internetu | besplatno |

Treba ti oko **30–40 minuta** za prvi put.

---

## 1. Raspakuj ZIP

1. Desni klik na `bistro-de-balzac.zip` → **Extract All / Raspakuj sve**.
2. Dobićeš folder `bistro-de-balzac` u kome su, između ostalog, folderi `src`,
   `public`, `supabase` i fajlovi `package.json`, `index.html`, `netlify.toml`…

---

## 2. GitHub — postavi kod

### 2.1 Napravi nalog
1. Otvori **github.com** → **Sign up**.
2. Unesi email, lozinku i korisničko ime → potvrdi email.

### 2.2 Napravi repozitorijum (mesto za kod)
1. Gore desno **+** → **New repository**.
2. **Repository name:** `bistro-de-balzac`
3. Izaberi **Private** (kod vidiš samo ti).
4. **NE** čekiraj „Add a README file“.
5. Klikni **Create repository**.

### 2.3 Prebaci fajlove
1. Na stranici novog repozitorijuma klikni link **uploading an existing file**.
2. Otvori raspakovani folder `bistro-de-balzac`, označi **SVE što je unutra**
   (`Ctrl+A`) i prevuci u pregledač.
   - Prevlači **sadržaj** foldera, ne sam folder.
   - Sačekaj da se učitaju svi fajlovi (brojač dole).
3. Dole klikni zeleno dugme **Commit changes**.

✅ Provera: na početnoj strani repozitorijuma moraš da vidiš `package.json`,
`index.html` i folder `src` **odmah na vrhu** — ne unutar još jednog foldera.

---

## 3. Supabase — baza

> Ako si ovo već uradio, pokreni samo **3.2** ponovo (fajl `schema.sql` je
> dopunjen — slike profila, „1. smena / 2. smena“…). Bezbedno je pokrenuti ga
> više puta, ništa se ne briše.

### 3.1 Napravi projekat
1. **supabase.com** → **Start your project** → prijavi se (najlakše **Continue with GitHub**).
2. **New project**:
   - Name: `bistro-de-balzac`
   - Database Password: izmisli jaku lozinku i **zapiši je**
   - Region: **Central EU (Frankfurt)**
3. Sačekaj ~2 minuta.

### 3.2 Pokreni SQL
1. Levo **SQL Editor** → **New query**.
2. Otvori fajl `supabase/schema.sql` (Notepad-om), `Ctrl+A`, `Ctrl+C`.
3. Nalepi u Supabase i klikni **Run**.
4. Treba da piše **Success**.

### 3.3 Tvoj vlasnički nalog
1. Levo **Authentication** → **Users** → **Add user** → **Create new user**
   - Email: tvoj email · Password: tvoja lozinka
   - ✅ **Auto Confirm User** (obavezno!)
2. Opet **SQL Editor** → **New query**, nalepi (zameni email i ime) → **Run**:

   ```sql
   update public.profiles
   set role = 'admin', full_name = 'Tvoje Ime Prezime'
   where email = 'tvoj-email@primer.com';
   ```

### 3.4 Funkcija za naloge radnika
Bez nje ne možeš iz aplikacije da otvaraš naloge radnicima.

1. Levo **Edge Functions** → **Deploy a new function** → **Via Editor**.
2. Ime funkcije: **`manage-worker`** (tačno ovako).
3. Obriši primer koda, pa nalepi **ceo** sadržaj fajla
   `supabase/functions/manage-worker/index.ts`.
4. **Deploy function**.

### 3.5 Prepiši dva ključa
Levo dole **Project Settings** (zupčanik):
- **Data API** → **Project URL** — izgleda kao `https://abcdefgh.supabase.co`
- **API Keys** → ključ **anon public** — dugačak tekst koji počinje sa `eyJ…`
  (ako ga ne vidiš, otvori karticu **Legacy API keys**; može i novi
  **publishable** ključ, koji počinje sa `sb_publishable_…`)

> Ključ **service_role / secret** nikome ne daješ i nigde ga ne upisuješ.

---

## 4. Netlify — od koda pravi sajt

> Netlify je preimenovao meni: „Sites“ su sada **Projects**, a „Site
> configuration“ je **Project configuration**.

1. **netlify.com** → **Sign up** → **GitHub** (dozvoli pristup).
2. **Add new project** → **Import an existing project** → **GitHub**.
3. Izaberi repozitorijum `bistro-de-balzac`
   (ako ga ne vidiš: **Configure the Netlify app on GitHub** → dozvoli mu taj repo).
4. Podešavanja build-a:
   - **Base directory:** `bistro-de-balzac` — **samo ako** su na GitHub-u fajlovi
     u folderu `bistro-de-balzac` (tako je kod tebe). Ako su `src`, `package.json`…
     odmah na vrhu repozitorijuma, ostavi prazno.
   - **Build command** i **Publish directory** ostavi kako jesu (`npm run build`
     i `dist` su već upisani u fajlu `netlify.toml`; ako polje neće da primi
     `dist`, samo ga preskoči).

   Za već napravljen projekat ovo menjaš u **Project configuration →
   Developer settings → Continuous deployment → Build settings → Configure**.
5. **Project configuration → Environment variables → Add a variable →
   Add a single variable** — dodaj **četiri** stavke:

   | Key | Value |
   |---|---|
   | `VITE_SUPABASE_URL` | tvoj Project URL iz 3.5 |
   | `VITE_SUPABASE_ANON_KEY` | tvoj anon ključ iz 3.5 |
   | `VITE_APP_NAME` | `Bistro de Balzac` |
   | `VITE_LOGIN_DOMAIN` | `bistrodebalzac.rs` |

6. **Deploys → Trigger deploy → Deploy project** (dugme je iznad spiska
   deploy-a, desno). Za 2–3 minuta dobijaš adresu, npr.
   `https://nesto-nasumicno.netlify.app` — piše zelenim slovima na vrhu
   stranice projekta.
7. (Lepše ime) **Project configuration → General → Project details →
   Change project name** → `bistro-de-balzac` → adresa postaje
   `https://bistro-de-balzac.netlify.app`.

> ⚠️ Posle svake promene promenljivih ili podešavanja: **Deploys → Trigger
> deploy → Deploy project**, inače se promena ne vidi.

---

## 5. Poveži Supabase sa adresom sajta

Supabase → **Authentication** → **URL Configuration**:
- **Site URL:** tvoja Netlify adresa (npr. `https://bistro-de-balzac.netlify.app`)
- **Redirect URLs** → **Add URL** → ista adresa → **Save**

---

## 6. Prva prijava

1. Otvori svoju Netlify adresu.
2. Prijavi se **svojim emailom** i lozinkom iz koraka 3.3.
3. **Radnici → + Novi nalog** — otvori naloge radnicima. Oni se prijavljuju
   **imenom i prezimenom** i lozinkom koju im daš.

---

## 7. Na telefon, kao aplikacija

- **Android (Chrome):** otvori adresu → meni **⋮** → **Dodaj na početni ekran / Instaliraj aplikaciju**.
- **iPhone (Safari!):** otvori adresu → dugme **Podeli** (kvadrat sa strelicom) →
  **Dodaj na početni ekran**.

Ikonica se pojavi među aplikacijama i otvara se preko celog ekrana — bez adresne
linije, kao prava aplikacija.

---

## Kad nešto promenimo u kodu

1. Na GitHub-u, u repozitorijumu → **Add file → Upload files**.
2. Prevuci izmenjene fajlove **u isti folder** u kome su i ranije bili
   (npr. `src/pages/NewReport.jsx` ide u `src/pages`). Najlakše je prevući ceo
   novi sadržaj ZIP-a ponovo — GitHub zameni stare fajlove novim.
3. **Commit changes** → Netlify sam napravi novu verziju sajta za 1–2 minuta.

Ako se menjao `supabase/schema.sql`, pokreni ga ponovo (korak 3.2).

---

## Ako nešto ne radi

| Šta vidiš | Šta uraditi |
|---|---|
| **Page not found** (Netlify) | Aplikacija je u podfolderu — upiši **Base directory** `bistro-de-balzac` (korak 4), pa **Trigger deploy**. |
| **Nedostaje Supabase konfiguracija** | Sajt radi, ali fale promenljive — upiši ih (korak 4, tačka 5), pa **Trigger deploy**. |
| Netlify: **Deploy failed** | **Deploys** → klikni neuspeli deploy → kopiraj crveni tekst iz loga i pošalji ga meni. |
| Sajt je beo / prazan | Proveri da su u Netlify-u upisane sve 4 promenljive, pa **Trigger deploy**. |
| Nema dugmeta **Trigger deploy** | Projekat nije povezan sa GitHub-om: **Project configuration → Developer settings → Continuous deployment → Link repository**. |
| „Invalid login credentials“ | Nalog iz 3.3 mora imati ✅ Auto Confirm User; proveri email i lozinku. |
| Ne mogu da otvorim nalog radniku | Proveri korak 3.4 — funkcija mora da se zove tačno `manage-worker`. |
| Ne vidim Radnici / Uplate | Nisi admin — ponovi SQL iz 3.3 sa tačnim emailom. |

> Ako nešto zapne, pošalji mi sliku ekrana ili tekst greške i ispravljamo.
