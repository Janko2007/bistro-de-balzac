# Kako da ubaciš novu verziju u postojeći sajt

Sajt `https://bistro-de-balzac.netlify.app` već radi — ovo samo zamenjuje stare
fajlove novim. Traje oko 10 minuta.

**Ništa se ne briše.** Svi popisi, uplate, radnici i isplate ostaju kakvi jesu.

Redosled je važan: **prvo baza (korak 1), pa tek onda sajt (korak 2)**. Ako
obrneš, aplikacija će tražiti kolone kojih u bazi još nema.

---

## 1. Supabase — baza

Otvori **supabase.com**, prijavi se i uđi u svoj projekat.

> Ako gore piše da je projekat **paused** (pauziran), klikni **Restore** i
> sačekaj minut. Supabase pauzira besplatne projekte posle nedelju dana
> nekorišćenja — podaci ostaju, samo se baza „probudi“.

Levo klikni **SQL Editor** → **New query**. Onda, jedan po jedan:

| Redom | Fajl | Šta donosi |
| --- | --- | --- |
| 1. | `AZURIRANJE-BAZE-2.sql` | prijava imenom i prezimenom, korpa, pravila |
| 2. | `AZURIRANJE-BAZE-3.sql` | izbor *dnevnica / plata* i procenat |
| 3. | `AZURIRANJE-BAZE-4.sql` | umanjena dnevnica za dan + brisanje uplate |
| 4. | `AZURIRANJE-BAZE-5.sql` | artikal sa brojačem (espresso) |
| 5. | `AZURIRANJE-BAZE-6.sql` | redosled radnika + **popis uživo** |

> U paketu je i **`POCETAK-ISPOCETKA.sql`** — on **briše sve popise, isplate i
> uplate**, da kreneš od nule posle probe. Nije deo ažuriranja; pokreni ga
> samo ako to zaista hoćeš, jer se ne može poništiti.

Za svaki: otvori fajl iz ovog foldera, označi sve (**Ctrl + A**), kopiraj
(**Ctrl + C**), nalepi u Supabase (**Ctrl + V**), klikni **Run**. Dole treba da
piše **Success**. Pa **New query** i sledeći fajl.

> Fajlovi mogu da se pokreću više puta — ništa se ne duplira i ništa se ne
> briše. Ako si neki već pokretao ranije, slobodno ga pokreni opet.

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

Ako piše **Failed**, klikni na taj red i pogledaj poslednje crvene redove —
najčešće je do neke od tri promenljive iz koraka 5.

---

## 4. Na telefonu i računaru

Aplikacija čuva kopiju na uređaju, zato posle objave:
- osveži stranicu **dva puta**, ili
- potpuno zatvori aplikaciju / pregledač i otvori ponovo.

---

## 5. Da bi otvaranje naloga radilo

Nalog radniku ne pravi sajt nego **Edge Function** u Supabase — mali program na
serveru. Samo on sme da dodiruje lozinke. Ako ti **Radnici → + Novi nalog**
prijavljuje grešku, ovde je uzrok.

**A) Provera da funkcija postoji**

Supabase → levo **Edge Functions**. Treba da vidiš **manage-worker**.

- **Ako je nema** — klikni **Deploy a new function**, nazovi je tačno
  `manage-worker`, obriši ponuđeni kod i nalepi sadržaj fajla
  `supabase/functions/manage-worker/index.ts` iz paketa, pa **Deploy**.
- **Ako je ima** — otvori je, **Ctrl + A**, nalepi sadržaj istog fajla,
  **Deploy**. (Ova verzija bolje objašnjava greške i pamti način plaćanja.)

**B) Provera da sajt zna gde je baza**

Netlify → **Projects → bistro-de-balzac → Site configuration → Environment
variables**. Treba da stoje **tri**:

| Ime | Gde se nalazi u Supabase |
| --- | --- |
| `VITE_SUPABASE_URL` | Settings → API → *Project URL* |
| `VITE_SUPABASE_ANON_KEY` | Settings → API → *anon public* ključ |
| `VITE_LOGIN_DOMAIN` | upiši `bistrodebalzac.rs` |

> `anon` ključ je javan i sme da stoji ovde. Ključ koji piše **service_role**
> se **nikada** ne stavlja ni u Netlify ni u GitHub — njega Supabase sam daje
> Edge Function-u.

Ako si nešto menjao, posle toga u Netlify → **Deploys** → **Trigger deploy** →
**Clear cache and deploy site**.

**C) Kako se pravi nalog**

Aplikacija → **Radnici → + Novi nalog** → ime i prezime, telefon (nije
obavezno), **lozinka koju ti zadaš**, način plaćanja (dnevnica ili plata) i,
ako ga ima, procenat.

Radnik se posle prijavljuje **imenom i prezimenom** i tom lozinkom — nikakav
mejl mu ne treba. (Aplikacija u pozadini od imena napravi adresu oblika
`marko.markovic@bistrodebalzac.rs`; to je samo za Supabase, radnik je ne vidi.)

Ako kasnije promeniš radniku ime, menja se i korisničko ime za prijavu —
lozinka ostaje ista.

---

## 6. Gde se čuvaju podaci i šta da paziš

Sve — radnici, popisi, pazari, slike, uplate, isplate — stoji u **Supabase**,
ne na telefonu i ne u Netlify. Netlify drži samo izgled aplikacije.

Zato:

- **Podaci se čuvaju sami.** Nema dugmeta „sačuvaj“; popis se upisuje u bazu
  dok radnik kuca.
- **Menjanje sajta ne dira podatke.** Možeš da postaviš novu verziju koliko god
  puta hoćeš.
- **Besplatan Supabase pauzira projekat** posle nedelju dana nekorišćenja.
  Aplikacija tada neće raditi dok ne otvoriš supabase.com i klikneš
  **Restore**. Podaci se ne gube. Pošto se aplikacija koristi svaki dan, do
  ovoga dolazi samo ako lokal ne radi duže.
- **Slike zauzimaju najviše mesta** (1 GB besplatno). U aplikaciji, dole na
  ekranu **Pregled**, stoji kartica koja pokazuje koliko je zauzeto i briše
  slike starije od izabranog roka.
- **Rezervna kopija:** Supabase → **Database** → **Backups**. Na besplatnom
  planu se čuva kratko, pa ako ti je stalo do istorije, s vremena na vreme
  preuzmi obračune preko dugmeta **Preuzmi** (PDF) — to ti ostaje na telefonu.

---

## Šta je novo u ovoj verziji

### Popis uživo

Kad dvoje rade istu smenu, ono što jedan upiše drugom se pojavi **za sekundu,
bez osvežavanja** — i brojevi u popisu, i pazar, i ko je ušao u smenu, i slike.
Polje koje baš kucaš se ne dira, da ti se unos ne vrati unazad.

Aplikacija je to radila od početka, ali Supabase to nije propuštao — nijedna
ranija skripta nije uključila slanje izmena. Uključuje ga `AZURIRANJE-BAZE-6.sql`.

> Provera: otvori isti popis na telefonu i na računaru, upiši broj na jednom —
> na drugom se pojavi sam.

### Redosled radnika

Na ekranu **Radnici** svaki aktivan radnik ima **▲▼** levo od slike — njima ga
podižeš ili spuštaš. Redosled se odmah pamti i važi za sve. Nov nalog ide na
kraj spiska, pa ga odatle podigneš gde treba.

### Nema više minusa u obračunu

Kad je nekome isplaćeno više nego što je zaradio, umesto *„za isplatu −2.000"*
piše **„pretplaćeno 2.000"**. Radniku na njegovom ekranu piše *„Primio si
više"*. Ako je isplata greška, brišeš je u **Radnici → Isplati → ×**.

### Artikal sa brojačem (espresso)

Kod kafe kasa broji unapred — brojač samo raste. Zato takav artikal ima svoje
računanje:

```
običan artikal  →  krajnje = (početno + dodato) − prodato
brojač          →  krajnje = početno + prodato
```

Ako je na početku smene brojač bio **5**, a prodato je **5** kafa, na kraju
smene piše **10**.

Uključuje se u **Artikli → Izmeni** kod tog artikla → **„Broji unapred
(brojač)"**. Posle toga u popisu kod njega nema polja *Dodato* (stoji crtica),
a u spisku artikala nosi oznaku **brojač**.

Uz to su **polja u popisu proširena**, da i petocifren broj brojača stane ceo.

### Međusmena ulazi i u prvu i u drugu smenu

Izbor smene više nije padajući meni nego **tri dugmeta: Prva · Među · Druga**.
Radnik može da bude u **više smena istog dana** — ko radi međusmenu uđe i u
prvu i u drugu. Svaka smena ima svoj popis; smena u kojoj već jeste ima
kvačicu, a klikom na drugo dugme prelazi na njen popis.

**Dnevnica se računa po danu, ne po smeni** — dve smene istog dana su **jedna**
dnevnica. Procenat od pazara se i dalje računa od obe smene, jer je u obe radio.

U **Pregledu** smena je sada mala oznaka (**Među** je narandžasta), a smene
unutar dana idu redom: prva → međusmena → druga.

### Umanjena dnevnica za jedan dan

Ako je neko došao kasnije ili odradio pola smene, možeš mu smanjiti dnevnicu
**samo za taj dan**. Na dva mesta:

- **Izveštaj → U smeni radili** → dugme **Umanji** pored imena;
- **Radnici → Dnevnice** → spisak svih njegovih dana u periodu, pa **Umanji**
  u redu tog dana.

Umanjen dan se vidi crvenim (stari iznos precrtan), a dugme **Puna dnevnica**
vraća na staro. Radnik taj iznos vidi u *Dnevnice*, ali ne može da ga menja.

### „Vlasnik“ je sada „Admin“

Svuda u aplikaciji — u zaglavlju, na Profilu, pri otvaranju naloga i u svim
porukama.

### Uplate — preglednije

- **„Dospelo“ se sada zove „Rok stigao“** — to je deo gotovine kojem je dan
  uplate već došao (danas ili ranije), tj. ono što ide u banku odmah.
- U **Uplaćeno** se vidi samo **poslednja uplata**; strelica ispod otvara još
  četiri. Starije se uzimaju **strelicom za mesece** ili **lupom** (pretraga po
  datumu, hvata i dan uplate i dane koje je ta uplata pokrila).

### Izgled

Modernije, a jednostavnije: mekše kartice, mirnija polja, jedna siva paleta
umesto dve i **jedna boja na ekranu** — narandžasto ide samo na glavni broj.
Izbačeni su i mnogi suvišni pasusi; dinari se više ne pišu uz svaki iznos
(ionako je sve u dinarima).

### Ostalo iz ranijih verzija (ako preskačeš više verzija odjednom)

- **Preuzimanje i štampa** svuda gde piše **Preuzmi** — prvo štikliraš šta
  ulazi u izveštaj, pa dobiješ uredan PDF sa logotipom.
- **Slika izveštaja** — jedna slika sa *prodajom po operateru* i izveštajem sa
  aparata za kartice (*ukupan izveštaj* na kraju prve i međusmene, *kraj dana*
  na kraju druge).
- **Dnevnica ili plata, uz procenat** — bira se pri otvaranju naloga i menja
  kad god hoćeš kroz **Radnici → Izmeni**.
- **Potvrđen popis** radnik više ne pregleda — ostaju mu samo datum, poruka da
  iznose vidi admin, ko je radio i dnevna obaveza.
- **Brisanje pogrešne isplate ili bonusa** sa pitanjem „Da li si siguran?“.
- **Neaktivni radnici** su sklonjeni na dno, iza dugmeta **Neaktivni**.
- Klik ili izbor **više ne vraća na vrh strane**.
