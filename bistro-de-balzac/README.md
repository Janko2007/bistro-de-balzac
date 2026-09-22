# Bistro de Balzac — PWA za vođenje smena

Aplikacija za evidenciju smena u lokalu: radnici unose popis artikala, pazar
(gotovina + kartice), troškove iz kase i slikaju traku sa kase. Vlasnik sve to
vidi na jednom mestu i potvrđuje popise.

Radi na telefonu i računaru, instalira se na početni ekran (PWA) — **bez Google
Play i App Store-a**.

| Sloj | Tehnologija |
|---|---|
| Frontend | React 18 + Vite + Tailwind CSS |
| Baza / Auth / Storage | Supabase (besplatni tier) |
| PWA | vite-plugin-pwa (manifest + service worker) |
| Hosting | Vercel ili Netlify (besplatno) |

> **Prvi put postavljaš aplikaciju?** Prati **[UPUTSTVO-GITHUB.md](UPUTSTVO-GITHUB.md)** —
> sve se radi u pregledaču (GitHub → Supabase → Netlify), bez instaliranja ičega.
> Ovaj README je detaljniji opis za kasnije.

---

## 📁 Struktura projekta

```
bistro-de-balzac/
├─ supabase/
│  ├─ schema.sql                     ← SQL za Supabase (tabele, RLS, storage)
│  └─ functions/manage-worker/
│     └─ index.ts                    ← Edge Function: nalozi radnika (otvaranje,
│                                      lozinka, brisanje)
├─ public/
│  ├─ logo.png                       ← logo lokala (izvor za sve ikonice)
│  └─ icons/                         ← PWA ikonice (već generisane iz logotipa)
├─ scripts/
│  └─ generate-icons.ps1             ← ponovno generisanje ikonica iz logo.png
├─ src/
│  ├─ main.jsx                       ← ulazna tačka + registracija service workera
│  ├─ App.jsx                        ← rute
│  ├─ index.css                      ← Tailwind + osnovni stilovi
│  ├─ lib/
│  │  ├─ supabaseClient.js           ← konfiguracija Supabase klijenta
│  │  ├─ utils.js                    ← formatiranje para/datuma, prevodi statusa
│  │  ├─ payperiod.js                ← polumesečni obračunski periodi (1. i 16.)
│  │  ├─ earnings.js                 ← obračun dnevnica, bonusa i isplata
│  │  ├─ deposits.js                 ← raspored uplate pazara (pon / pet)
│  │  ├─ categories.js               ← redosled kategorija
│  │  ├─ avatars.js                  ← slike profila (slanje, brisanje, adrese)
│  │  └─ image.js                    ← kompresija slika pre uploada
│  ├─ context/
│  │  ├─ AuthContext.jsx             ← sesija, profil, uloga
│  │  └─ ToastContext.jsx            ← obaveštenja
│  ├─ components/
│  │  ├─ Layout.jsx                  ← zaglavlje + donja navigacija
│  │  ├─ Avatar.jsx                  ← slika profila: prikaz, uvećanje, izmena
│  │  ├─ ProtectedRoute.jsx          ← zaštita ruta po ulozi
│  │  ├─ InstallPrompt.jsx           ← „Dodaj na početni ekran“
│  │  ├─ PeriodPicker.jsx            ← izbor obračunskog perioda (padajući meni)
│  │  ├─ CategoryManager.jsx         ← kategorije: dodavanje, redosled
│  │  ├─ StorageCleanup.jsx          ← brisanje starih slika
│  │  ├─ ReportListItem.jsx
│  │  └─ ui.jsx                      ← dugmad, polja, modal, kartice…
│  └─ pages/
│     ├─ Login.jsx
│     ├─ NewReport.jsx               ← RADNIK: unos popisa i pazara
│     ├─ MyReports.jsx               ← RADNIK: istorija (8 po strani, pretraga)
│     ├─ Profile.jsx                 ← RADNIK: slika, podaci, dnevnice, pravila
│     ├─ MyEarnings.jsx              ← RADNIK: dnevnice, bonusi, isplate
│     ├─ ReportDetail.jsx            ← detaljan pregled + potvrda (admin)
│     ├─ AdminDashboard.jsx          ← VLASNIK: pregled i filteri
│     ├─ AdminDeposits.jsx           ← VLASNIK: uplate pazara u banku
│     ├─ AdminItems.jsx              ← VLASNIK: artikli
│     └─ AdminWorkers.jsx            ← VLASNIK: radnici
├─ vite.config.js                    ← PWA manifest + service worker
├─ netlify.toml / vercel.json        ← podešavanja za hosting
└─ .env.example
```

---

## 🚀 KORAK 1 — Supabase projekat

1. Otvori [supabase.com](https://supabase.com) → **Start your project** → prijavi se (GitHub nalog je najbrži).
2. **New project**:
   - *Name*: `bistro-de-balzac`
   - *Database Password*: izmisli jaku lozinku i **sačuvaj je**
   - *Region*: `Central EU (Frankfurt)` — najbliži Srbiji
   - Plan: **Free**
3. Sačekaj ~2 minuta da se projekat napravi.

### 1.1 Pokreni SQL

1. U levom meniju: **SQL Editor** → **New query**.
2. Otvori fajl `supabase/schema.sql`, kopiraj **ceo sadržaj** i nalepi ga.
3. Klikni **Run** (ili `Ctrl+Enter`).
4. Treba da piše *Success. No rows returned*.

Ovim si dobio:
- tabele `profiles`, `items`, `shift_reports`, `shift_report_staff`, `shift_report_items`, `report_images`
- sva RLS pravila (radnik vidi samo svoje, vlasnik vidi sve)
- storage bucket `izvestaji` za slike traka sa kase
- **102 artikla Bistroa de Balzac**, razvrstana u 20 kategorija (kafa, čaj, cedevita,
  ceđeni sokovi, sokovi, voda, gazirana pića, energetska pića, pivo, vino, rakija, viski,
  votka i džin, tekila, rum/konjak/vinjak, likeri i aperitivi, Monin sirupi, gelato, ostalo)

### 1.2 Napravi svoj ADMIN nalog

1. **Authentication** → **Users** → **Add user** → **Create new user**:
   - Email: tvoj email
   - Password: tvoja lozinka
   - ✅ **Auto Confirm User** (obavezno čekiraj!)
2. Vrati se u **SQL Editor** i pokreni (zameni svoj email):

```sql
update public.profiles
set role = 'admin', full_name = 'Vlasnik'
where email = 'tvoj-email@primer.com';
```

### 1.3 Prepiši API ključeve

**Project Settings** (zupčanik) → **API**. Trebaju ti:
- **Project URL** → `https://xxxx.supabase.co`
- **anon / public** ključ (dugačak `eyJ...`)

> `service_role` ključ **nikada** ne ide u frontend — njega koristi samo Edge Function.

---

## 💻 KORAK 2 — Pokretanje lokalno

### 2.1 Instaliraj Node.js

Skini **LTS** verziju sa [nodejs.org](https://nodejs.org) i instaliraj (Next → Next → Finish).
Provera u terminalu / PowerShell-u:

```bash
node --version
```

### 2.2 Instaliraj pakete

U folderu projekta:

```bash
npm install
```

### 2.3 Napravi `.env`

Kopiraj `.env.example` u `.env` i popuni:

```
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...
VITE_APP_NAME=Bistro de Balzac
```

### 2.4 Pokreni

```bash
npm run dev
```

Otvori `http://localhost:5173`, prijavi se svojim admin nalogom.

> **Test na telefonu dok razvijaš:** terminal ispisuje i `Network` adresu
> (npr. `http://192.168.0.15:5173`). Otvori je na telefonu — mora biti na istom Wi-Fi-ju.
> Instalacija na početni ekran radi tek preko HTTPS-a, tj. posle objave (Korak 4).

---

## 👥 KORAK 3 — Nalozi za radnike

Otvaranje naloga, promena lozinke i brisanje radnika rade preko Edge Funkcije, jer
sve troje zahteva `service_role` ključ koji ne sme da stoji u frontendu. Objavi je:

```bash
npm install -g supabase
supabase login
supabase link --project-ref TVOJ_PROJECT_REF
supabase functions deploy manage-worker
```

`TVOJ_PROJECT_REF` je deo URL-a: `https://TVOJ_PROJECT_REF.supabase.co`.

Zatim u **Supabase → Edge Functions → manage-worker → Secrets** dodaj:

| Name | Value |
|---|---|
| `LOGIN_DOMAIN` | `bistrodebalzac.rs` |

> Mora biti **identično** vrednosti `VITE_LOGIN_DOMAIN` iz `.env`. Objašnjenje je
> u odeljku *Kako radi prijava* niže.

Funkcija prvo proveri da je pozivalac admin, pa tek onda radi bilo šta.

---

## 🔑 Kako radi prijava

Radnici se prijavljuju **imenom i prezimenom** — nemaju mejl i ne pamte ga.

Supabase Auth ipak traži email, pa ga aplikacija sama pravi iz imena:

```
"Marko Marković"  →  marko.markovic@bistrodebalzac.rs
```

Domen je izmišljen, na njega se ništa ne šalje i radnik ga nikad ne vidi. Zato:

- **ime i prezime mora biti jedinstveno** — baza to i proverava (unikatni indeks);
  ako imaš dva Marka Markovića, dodaj srednje slovo;
- kad vlasnik promeni radniku ime, menja mu se i korisničko ime za prijavu — app
  te na to upozori;
- tvoj vlasnički nalog, koji si napravio iz Supabase panela, radi i dalje — možeš
  se prijaviti i punim imenom i svojim pravim emailom.

---

## 🌍 KORAK 4 — Besplatna objava

Aplikaciji treba HTTPS da bi radila kao PWA. Oba servisa ga daju besplatno.

### Prvo: kod na GitHub

```bash
git init
git add .
git commit -m "Bistro de Balzac - prva verzija"
```

Napravi prazan repozitorijum na [github.com/new](https://github.com/new) (može **Private**), pa:

```bash
git remote add origin https://github.com/KORISNIK/bistro-de-balzac.git
git branch -M main
git push -u origin main
```

> **Za kafić uzmi Opciju B (Netlify).** Vercel-ov besplatni plan je po uslovima
> korišćenja namenjen nekomercijalnim projektima.

### Opcija A — Vercel

1. [vercel.com](https://vercel.com) → **Sign up with GitHub**.
2. **Add New → Project** → izaberi svoj repozitorijum → **Import**.
3. Vercel sam prepoznaje Vite. Framework Preset: **Vite**, Build: `npm run build`, Output: `dist`.
4. Otvori **Environment Variables** i dodaj:
   | Name | Value |
   |---|---|
   | `VITE_SUPABASE_URL` | `https://xxxx.supabase.co` |
   | `VITE_SUPABASE_ANON_KEY` | `eyJhbGciOi...` |
   | `VITE_APP_NAME` | `Bistro de Balzac` |
5. **Deploy**. Za minut dobijaš adresu tipa `https://bistro-de-balzac.vercel.app`.

### Opcija B — Netlify (preporuka)

1. [netlify.com](https://netlify.com) → **Sign up with GitHub**.
2. **Add new site → Import an existing project** → GitHub → izaberi repo.
3. Build command: `npm run build`, Publish directory: `dist` (već je u `netlify.toml`).
4. **Site configuration → Environment variables** → dodaj iste tri promenljive kao gore.
5. **Deploy site**.

> ⚠️ Kad menjaš environment promenljive, obavezno pokreni **novi deploy** —
> Vite ih ugrađuje u kod tokom build-a.

### 4.1 Dozvoli svoj domen u Supabase

**Authentication → URL Configuration**:
- *Site URL*: `https://tvoja-adresa.vercel.app`
- *Redirect URLs*: dodaj istu adresu

### 4.2 (opciono) Svoj domen

Vercel: **Settings → Domains** → dodaj domen i podesi DNS po uputstvu.
Netlify: **Domain management → Add domain**.

---

## 📱 KORAK 5 — Instalacija na telefon

**Android (Chrome):** otvori adresu → pojaviće se banner „Instaliraj aplikaciju“,
ili meni ⋮ → **Dodaj na početni ekran**.

**iPhone (Safari — mora Safari, ne Chrome):** otvori adresu → dugme **Podeli**
(kvadrat sa strelicom) → **Dodaj na početni ekran** → **Dodaj**.

**Računar (Chrome/Edge):** ikonica ⊕ u adresnoj liniji → **Instaliraj**.

Posle toga se aplikacija otvara preko cele ikonice, bez adresne linije — izgleda
i ponaša se kao prava aplikacija.

---

## 📖 Kako se koristi

### Radnik (konobar / šanker)
1. Prijavi se **imenom i prezimenom** i lozinkom koju je dobio od vlasnika.
2. **Novi popis**: izabere datum i smenu (prva / druga / međusmena). Dugme ispod se samo
   menja prema tome šta zatekne:
   - **Otvori smenu** — za tu smenu još nema popisa, pravi se novi;
   - **Uđi u smenu** — neko je već otvorio tu smenu; iznad dugmeta piše **ko je unutra**,
     pa ulaskom nastavlja na istom popisu;
   - smena koja je već **zatvorena** — dugme je isključeno i piše zašto.

   Tek time počinje popis. **Ko uđe u smenu, tome se računa dnevnica za nju** — nikog
   drugog ne može da upiše, samo sebe.
3. Unese **pazar** i **kartice** sa trake — **predato** (gotovina koju predaje)
   aplikacija računa sama: *pazar − kartice*. Kartice ne mogu biti veće od pazara.
   Uz polja stoji upozorenje da se upisuju **tačni iznosi, bez zaokruživanja**.
   Redosled je svuda u aplikaciji isti: **pazar, kartice, predato**.
4. Otvori kategoriju u **listi artikala** — kategorije su skupljene dok se ne kliknu, a
   pored svake piše koliko je artikala popisano (npr. `4/13`). Po artiklu upiše tri broja:
   **Početno stanje**, **Dodato** i **Prodato** (i `0` ako ništa nije prodato).
   **Krajnje stanje** aplikacija računa sama: *(početno + dodato) − prodato*. Pretraga
   otvara sve kategorije i filtrira artikle.

   U bazi se i dalje čuva krajnje stanje (`qty_end`), a prodato baza izračuna sama —
   zato svi izveštaji, zbirovi i *Prodaja po artiklima* rade kao i pre.
5. **Slika izveštaj prodaje po operateru** — **obavezno**, do 6 slika. Slike se
   automatski smanjuju pre slanja.
6. Upiše **napomenu za admina** ako ima nešto da javi (opciono, na dnu strane).
7. **Zatvori smenu**. Pre slanja iskoči **obračun smene**: pazar, kartice i —
   krupno — **Predato**, tj. gotovina koju radnik fizički predaje. Tek potvrdom se
   popis šalje vlasniku.

Smena **ne može da se zatvori**:

- bez slike izveštaja prodaje po operateru;
- ako je nekom artiklu upisano **početno stanje, a nije prodato** — red požuti i piše
  *„Fali prodato“*, a u zaglavlju popisa stoji koliko ih je. Klik na
  *Zatvori smenu* odmah otvori kategorije u kojima ti artikli stoje;
- ako je **prodato veće od novog stanja** — red pocrveni, jer bi krajnje stanje bilo
  negativno;
- bez pazara, ili ako su kartice veće od pazara.

8. **Dnevnice**: radnik u svakom trenutku vidi koliko je smena odradio tog meseca,
   koliko je zaradio, šta mu je isplaćeno i **koliko ima da primi**.

**Izveštaji** — gore stoji **ukupan broj** svih izveštaja radnika i koliko čeka
potvrdu. Ispod je spisak u kome piše **samo datum, smena i stanje** (čeka potvrdu,
potvrđen, vraćen na ispravku) — iznosi se vide tek kad se izveštaj otvori. Najviše
**4 na strani** (najnoviji prvi), sa dugmićima
*‹ Novije* / *Starije ›*. Dugme sa **lupom** pored *Novi popis* otvara pretragu po
datumu (`15`, `15.09`, `15.09.2026`, ili `09.2026` za ceo mesec); ponovni klik je
zatvara i vraća ceo spisak.

**Slika profila** — na ekranu **Profil** radnik dodaje ili menja svoju sliku
(*Dodaj sliku* / *Promeni sliku*), a admin svakome u **Radnici → Izmeni**. Slika se sama
iseče na kvadrat i smanji (~60 KB), pa se vidi u zaglavlju, u smeni i na spisku
radnika. **Klik na sliku je uveća** preko celog ekrana; klik bilo gde je zatvara.

### 👥 Zajednički popis — dvoje u istoj smeni

Jedna smena = **jedan popis**. Kad drugi radnik uđe u istu smenu (isti datum, ista
smena), ne pravi se novi popis — pridružuje se postojećem:

- **oba vide iste brojeve, uživo.** Što jedan upiše, drugom se pojavi za sekundu, bez
  osvežavanja. Polje koje trenutno kucaš se ne dira, pa ti se unos ne vraća unazad;
- **oba mogu da menjaju sve** — i ono što je upisao onaj drugi;
- **oba dobijaju punu dnevnicu** za tu smenu;
- gore piše **ko je u smeni**, sa imenima.

Popis se čuva **u bazu dok kucaš** (nema više dugmeta „sačuvaj“) — gore desno piše
*Čuva se… / Sačuvano*. Ako se telefon ugasi ili se aplikacija zatvori, sledeći put te
vraća pravo u tu istu otvorenu smenu.

Ako je neko ušao u pogrešnu smenu, ima dugme **Izađi iz smene** — skida se sa spiska i
dnevnica mu se za nju ne računa. Popis ostaje ostalima.

U smenu se može ući **samo dok je otvorena**. Kad se jednom zatvori, niko se ne može
naknadno ubaciti i tako „pokupiti“ dnevnicu. Ispravke posle toga radi vlasnik.

### Vlasnik (admin)
- **Pregled**: otvara se na **juče i danas** — samo ono što te trenutno zanima.
  Na vrhu je **Filteri** kao padajući meni (period, smena, status, radnik); dok je
  zatvoren, u jednom redu piše šta je trenutno izabrano. Ispod su zbirne sume predatog
  novca, kartica i ukupnog pazara, pa lista izveštaja sa dugmetom **⬇ CSV**.
- **Pretraga po datumu** iznad liste traži kroz **celu istoriju**, bez obzira na
  izabrani period. Prihvata: `15` (15. u ovom mesecu), `15.09`, `15.09.2026`,
  `2026-09-15`, ili `09.2026` za ceo mesec.
- **Detalji izveštaja**: obračun smene (gotovina, kartice, ukupan pazar, predato), ko je
  radio, popis po kategorijama koje se otvaraju klikom — svaka sa tabelom od pet kolona
  (Početno, Dodato, Novo, Prodato, Krajnje) — i slike trake (klik → uvećanje).
- **✅ Potvrdi popis** — overava izveštaj. Posle potvrde se više ne može menjati.
- **↩︎ Vrati na ispravku** — uz poruku radniku šta fali. Vraćen popis radnik ponovo
  može da menja i da ga pošalje ispravljenog.
- **Poruka radniku**: u detaljima izveštaja, pored naslova *Poruka*, stoji dugme
  **Napiši / Izmeni**. Piše se kad god hoćeš, ne samo pri vraćanju na ispravku.
  Poruka se **potpisuje tvojim imenom** (radnik vidi „Poruka · Nikola Ivković“), a ime
  upisuje baza — niko se ne može potpisati tuđim. Prazno polje briše poruku.
- **Ko je radio**: spisak se puni sam — upisuje se svako ko je ušao u smenu. Dugmetom
  *Izmeni* vlasnik može da ispravi spisak (doda nekog ko je zaboravio da uđe ili skine
  nekog ko je ušao greškom). Po tom spisku se računaju dnevnice.
- **Artikli → Prodaja po artiklima** (na vrhu ekrana): koliko je čega prodato u
  mesecu, zbir iz svih zatvorenih smena. Mesec se kuca (`09.2026`) ili bira sa
  *Ovaj mesec* / *Prošli mesec*. Dva prikaza: **Po kategorijama** (svi artikli, i oni
  sa 0) i **Najprodavanije** (rang lista). Dugme **CSV** skida tabelu za Excel.
  Sabiranje radi baza (funkcija `item_sales`), pa je brzo i za ceo mesec.
- **Detalji izveštaja → Popis artikala** prikazuju **sve artikle**, ne samo popisane.
  Filteri: *Svi artikli* · *Nije popisano* (radnik preskočio — žuto) · *Nije prodato*
  (popisano, a prodato 0).
- **Artikli**: dodavanje, izmena, redosled, isključivanje — grupisano u padajuće
  kategorije. *Isključi* je bolje od *Obriši* kad je artikal već korišćen u popisima —
  istorija ostaje netaknuta.
- **Kategorije** (dugme u Artiklima): dodavanje novih, preimenovanje i — važno —
  **redosled**. Strelicama ▲▼ pomeraš kategoriju gore-dole, i tim redom ih radnik vidi
  u popisu. Preimenovanje automatski prebacuje sve artikle iz te kategorije na novi
  naziv (radi se jednom transakcijom u bazi, funkcija `rename_category`). Kategorija
  može da se obriše samo ako je prazna.
- **Uplate**: koliko gotovine ima da se uplati u banku i koji dani su već pokriveni
  (vidi ispod).
- **Radnici**: otvaranje naloga (ime + lozinka koju ti zadaš), **dnevnica** po radniku,
  promena uloge, nova lozinka, deaktivacija i **brisanje**.
- **Prostor za slike** (dno pregleda): koliko je od 1 GB popunjeno i dugme za brisanje
  slika starijih od 6 / 12 / 24 meseca.

### 📋 Pravila i obaveze

Pravilnik o radu, dnevne obaveze, obaveze šankera i obaveze konobara stoje u aplikaciji,
prepisani iz Word dokumenata (na latinici).

- **Radnik** ih vidi na ekranu **Profil** (ikonica čovečuljka), na dnu — ispod svojih
  podataka (ime, telefon, uloga, dnevnica) i ispod dnevnica. Svaki dokument je zatvoren
  dok se ne klikne na naslov. U *Dnevnim obavezama* današnji dan je označen sa **danas**.
- **U popisu smene**, ispod *Izveštaja prodaje po operateru*, stoji kartica **Dnevna
  obaveza — (dan)** sa obavezama baš za taj dan i štiklom *„Dnevna obaveza za ovu smenu
  je urađena“*. Štikla se deli sa kolegom u smeni, a vlasnik u izveštaju vidi
  *urađena* / *nije štiklirana*. Zatvaranje smene nije uslovljeno njome.
- **Vlasnik** ih uređuje na dnu ekrana **Radnici**: otvori dokument → *Izmeni*, *▲▼* za
  redosled, *Obriši*; a **+ Novi** dodaje novi dokument.

Tekst se piše kao običan tekst, uz tri znaka na početku reda:

| Znak | Izgled |
|---|---|
| `#` | naslov (npr. `# Utorak` ili `# 3. Odnos prema gostima`) |
| `-` | stavka sa tačkom |
| `!` | upozorenje, u žutom polju |
| `!!` | crveni tekst |

Naslov koji se zove kao dan u nedelji se tog dana radnicima označi sa **danas**.
Početni tekst se u bazu upisuje samo jednom — ponovno pokretanje `schema.sql` ne briše
tvoje izmene.

### 🏦 Uplate pazara

Raspored uplate gotovine u banku:

| Uplata | Pokriva |
|---|---|
| ponedeljkom | petak, subota, nedelja |
| petkom | ponedeljak, utorak, sreda, četvrtak |

Oba pravila su zapravo jedno te isto: pazar nekog dana se uplaćuje **prvog sledećeg
ponedeljka ili petka**. Tako to i računa aplikacija — nigde nije potrebno nabrajati dane.

Na ekranu **Uplate** stoji:

- **Za uplatu** — ukupna gotovina koja još nije uplaćena.
- **Dospelo** — deo toga kome je dan uplate već stigao (ovo je iznos koji kasni).
- **Sledeća uplata** — prvi sledeći ponedeljak ili petak.
- **Uplaćeno ovog meseca** — zbir uplata u tekućem mesecu.

Ispod je spisak neuplaćenih dana, grupisan po danu uplate. Svaki dan ima kvadratić:
**označiš dane koje si uplatio**, pa klikneš *Upiši uplatu*. U prozoru se upisuje datum
uplate (podrazumevano današnji) i iznos (ponuđen je zbir označenih dana, ali se može
ispraviti ako je u banci otišao drugačiji iznos).

Raspored je **samo podsetnik** — baza pamti koji su dani uplaćeni, a ne kalendar. Zato
možeš da uplatiš i mimo rasporeda i da označiš tačno one dane koje si pokrio. Ako grešiš,
u istoriji je uz svaku uplatu dugme **Poništi** — dani se vraćaju u „za uplatu“, a popisi
se ne diraju.

Računa se samo **gotovina iz zatvorenih smena** — kartice idu pravo na račun, a smena
koja je još u toku nema zaključen pazar. Prikazuje se poslednjih 180 dana.

### 💰 Dnevnice, bonusi i isplate

Obračun ide po **polumesečnim periodima**, jer se plate isplaćuju 1. i 16. u mesecu:

| Period | Isplata |
|---|---|
| 1. – 15. | 16. istog meseca |
| 16. – kraj meseca | 1. sledećeg meseca |

Otuda pravilo: **smena odrađena na dan isplate ulazi u sledeću platu.** Smena od 16.
pada u period 16.–kraj, koji se plaća tek 1. sledećeg meseca; smena od 1. pada u
period 1.–15., koji se plaća 16.

Period se bira **kucanjem datuma** — ukucaš bilo koji dan iz perioda i aplikacija
pokaže taj period. Radi isto na telefonu, tabletu i računaru; prihvata `16`,
`16.09` ili `16.09.2026`.

```
zarađeno   = broj odrađenih smena × dnevnica
za isplatu = zarađeno + bonusi − isplaćeno
```

Smena se broji svakome ko je u njoj upisan — ako rade dvoje, oboje dobijaju punu
dnevnicu. Vraćeni izveštaji se ne broje dok se ne isprave.

> Isplate se u bazi vezuju za **ključ perioda** (`payouts.period_key`, npr.
> `2026-09-A`), a ne za datum isplate — jer se isplata dešava *posle* perioda, pa bi
> po datumu upala u pogrešan obračun.

Vlasnik vidi zbir za sve radnike i po svakom pojedinačno, pa ima dva dugmeta:

- **💵 Isplati** — upisuje isplatu (umanjuje dug prema radniku),
- **🎁 Bonus** — dodaje bonus **na platu** (uvećava dug prema radniku).

Oboje se upisuju u istu tabelu `payouts`, razlikuje ih kolona `kind`. Radnik isti
taj obračun vidi na svom ekranu **Profil**, sa spiskom svojih smena, bonusa i
isplata.

### Brisanje popisa

**Obriši** u detaljima izveštaja ne briše odmah: popis nestane sa spiskova i iz
obračuna (pazar, uplate, dnevnice), a radnik može ponovo da otvori istu smenu —
ali se čuva još **12 sati** u **Pregled → Obrisani popisi**, odakle se vraća
jednim klikom (**Vrati**). Posle 12 sati se briše trajno, zajedno sa slikama
(tabela `report_trash`, funkcije `trash_report`, `restore_report`,
`purge_report_trash`).

### Brisanje radnika

Briše se nalog za prijavu. Ako iza radnika postoje popisi, **oni ostaju u istoriji**
sa njegovim imenom — samo nestaje sa spiska. Ako nema istorije, briše se u potpunosti.
Za privremeno isključivanje koristi *Deaktiviraj*.

---

## 🔐 Bezbednost (kako je rešeno)

- **RLS je uključen na svim tabelama.** Radnik čita i menja samo izveštaje koje je
  sam poslao ili u kojima je bio u smeni; vlasnik vidi sve.
- **Zatvoren izveštaj je zaključan** — radnik ga menja samo dok je smena otvorena ili
  dok je vraćena na ispravku (`status in ('otvoren','vracen')` u RLS politici, ne samo
  u interfejsu).
- **U smenu se ulazi samo dok traje.** Funkcija `open_or_join_shift` upisuje radnika u
  smenu jedino kad je status `otvoren`; posle zatvaranja niko se ne može naknadno
  ubaciti i tako dobiti dnevnicu.
- **Tuđa smena se ne vidi dok joj se ne pridružiš.** Da bi ekran ipak znao da li piše
  „Otvori smenu“ ili „Uđi u smenu“, postoji funkcija `peek_shift` — ona vraća samo
  status smene i imena onih koji su u njoj, bez pazara i bez popisa.
- **Poruku vlasnika potpisuje baza.** Aplikacija šalje samo tekst — ime i vreme dopisuje
  trigger `stamp_verification` iz `auth.uid()`, pa se niko ne može potpisati tuđim imenom.
- **Radnik ne može sam sebi da promeni ulogu** — trigger `guard_profile_update`
  vraća `role` i `is_active` na staru vrednost ako izmenu ne radi admin.
- **Uplate pazara vidi samo vlasnik** — tabele `cash_deposits` i `cash_deposit_days`
  imaju politiku koja traži `is_admin()` i za čitanje i za upis.
- **Bucket `izvestaji` je privatan.** Slike se otvaraju samo preko potpisanog URL-a
  koji važi 2 sata; bez prijave se ništa ne vidi.
- **Slike profila (`avatari`) su takođe privatne.** Svaki radnik ima svoj folder
  (`avatari/<id>/…`) i može da menja samo njega; admin menja svačiju. Trigger
  `guard_profile_update` ne dozvoljava radniku da u profil upiše putanju do tuđe slike.
- **`service_role` ključ nije u frontendu** — koristi ga isključivo Edge Function.

---

## 🧰 Česti problemi

| Problem | Rešenje |
|---|---|
| „Nedostaje Supabase konfiguracija“ | Nema `.env` ili nije restartovan `npm run dev`. Na hostingu: dodaj env promenljive i pokreni novi deploy. |
| „Pogrešan email ili lozinka“ | Nalog nije potvrđen — u Supabase *Authentication → Users* korisnik mora biti *Confirmed*. |
| Admin deo se ne vidi | Nije pokrenut `update public.profiles set role = 'admin' ...`. Odjavi se i prijavi ponovo. |
| Popis je prazan | Nema aktivnih artikala — dodaj ih u **Artikli**. |
| Slika se ne šalje | Bucket `izvestaji` ne postoji (pokreni `schema.sql` ponovo) ili je slika veća od 10 MB. |
| Nema „Dodaj na početni ekran“ | Radi samo preko HTTPS-a (posle objave) i na iPhone-u isključivo u **Safari**. |
| Stara verzija posle deploya | Zatvori i ponovo otvori instaliranu aplikaciju — service worker povlači novu verziju u pozadini. |

---

## 💰 Koliko košta

**0 din mesečno**, i tako može da ostane zauvek.

| Stavka | Cena |
|---|---|
| Supabase (baza, prijava, slike) | 0 |
| Netlify (hosting + HTTPS) | 0 |
| Edge Function | 0 — 500.000 poziva mesečno besplatno, troši se ~10 |
| Google Play / App Store | 0 — **ne trebaju**, ovo je PWA |
| Svoj domen (opciono) | ~1.800 din godišnje |

> **Hosting:** uzmi **Netlify**, ne Vercel. Vercel-ov besplatni Hobby plan je po
> uslovima korišćenja za nekomercijalne projekte, a ovo je alat za posao. Netlify-jev
> besplatni plan dozvoljava komercijalnu upotrebu (isto važi i za Cloudflare Pages).

### Zašto ostaje besplatno

| Resurs | Free limit | Realna potrošnja |
|---|---|---|
| Baza | 500 MB | ~35 MB godišnje → 10+ godina |
| Storage (slike) | 1 GB | ~140 KB po slici |
| Saobraćaj | 5 GB/mes. | ~100 MB/mes. |
| Mesečni aktivni korisnici | 50.000 | 5–10 |

Slike su jedino što s vremenom raste, pa su rešene na dva načina:

1. **Jaka kompresija** (`src/lib/image.js`): 1280 px, siva skala, JPEG 0.68. Traka sa
   kase je crn tekst na belom — boja ne nosi informaciju, a njeno uklanjanje skida
   dodatnih ~25%. Fotografija od 5 MB postaje **~140 KB**, tekst ostaje čitak.
   Ako ti je premutno, podigni `QUALITY` na 0.8.
2. **Brisanje starih slika**: na vlasničkom pregledu, kartica *Prostor za slike*
   pokazuje popunjenost i briše slike starije od 6 / 12 / 24 meseca. **Brojevi iz
   popisa ostaju** — nestaju samo fotografije.

Uz to dvoje 1 GB se praktično nikad ne popuni.

### Dve stvari o besplatnom planu

**Pauziranje:** Supabase pauzira projekat posle 7 dana potpune neaktivnosti. Kod
svakodnevnog korišćenja se to nikad ne dešava; ako ipak stane, vraća se jednim klikom.

**Nema automatskog bekapa.** Ovo je jedini stvarni nedostatak. Rešenje bez plaćanja:
jednom mesečno klikni **⬇ CSV** u pregledu i sačuvaj fajl, ili povremeno pusti
`supabase db dump -f bekap.sql`.

Ako ti dnevni automatski bekapi vrede 2.700 din mesečno, to je Supabase **Pro** plan
($25) — jedini razlog da ga uzmeš, ne limiti.

---

## 🔧 Izmene koje ćeš verovatno hteti

**Naziv lokala u zaglavlju** → `.env`, promenljiva `VITE_APP_NAME`.

**Boje** → `tailwind.config.js`: paleta `brand` je narandžasti akcenat (dugmad,
aktivne stavke), a `ink` je topla crna iz logotipa (zaglavlje, ekran prijave).
Ako promeniš `ink`, promeni i `theme_color` u `vite.config.js` i u `index.html`.

**Logo** → zameni `public/logo.png` svojom slikom (kvadratna, bar 512×512) i pokreni:

```bash
npm run icons
```

Skript sam odseca belu ivicu, centrira logo i pravi sve četiri PWA ikonice
(192, 512, maskable 512, apple-touch 180). Logo se u aplikaciji vidi u zaglavlju,
na ekranu prijave i na početnom ekranu telefona.

**Nazivi smena** → `src/lib/utils.js`, niz `SHIFTS` + enum `shift_type` u SQL-u.
