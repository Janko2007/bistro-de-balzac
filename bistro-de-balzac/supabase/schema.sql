-- =====================================================================
--  KAFIĆ POPIS — kompletna šema baze za Supabase
--  Nalepi CEO ovaj fajl u: Supabase Dashboard -> SQL Editor -> New query
--  pa klikni RUN. Skript je idempotentan (može se pokrenuti više puta).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. EKSTENZIJE
-- ---------------------------------------------------------------------
create extension if not exists "pgcrypto" with schema extensions;


-- ---------------------------------------------------------------------
-- 1. TIPOVI (ENUM)
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'user_role') then
    create type public.user_role as enum ('admin', 'radnik');
  end if;

  if not exists (select 1 from pg_type where typname = 'shift_type') then
    -- prva = jutarnja, druga = večernja, medjusmena = smena između njih
    create type public.shift_type as enum ('prva', 'druga', 'medjusmena');
  end if;

  if not exists (select 1 from pg_type where typname = 'payout_kind') then
    -- isplata umanjuje dug prema radniku, bonus ga uvećava
    create type public.payout_kind as enum ('isplata', 'bonus');
  end if;

  if not exists (select 1 from pg_type where typname = 'report_status') then
    -- otvoren   -> smena je u toku, radnici zajedno unose popis
    -- poslat    -> smena zatvorena, čeka vlasnika
    -- potvrdjen -> vlasnik overio | vracen -> traži se ispravka
    create type public.report_status as enum ('otvoren', 'poslat', 'potvrdjen', 'vracen');
  end if;
end $$;

-- Ako si već pokrenuo raniju verziju skripta, ovo dodaje status „otvoren“.
alter type public.report_status add value if not exists 'otvoren' before 'poslat';

-- Ako si već pokrenuo raniju verziju skripta (sa smenom 'cela'), ovo dodaje
-- međusmenu u postojeći tip. Na čistoj bazi ne radi ništa.
alter type public.shift_type add value if not exists 'medjusmena';


-- ---------------------------------------------------------------------
-- 2. TABELE
-- ---------------------------------------------------------------------

-- 2.1 Profili korisnika
--     Namerno BEZ `references auth.users on delete cascade`: kad vlasnik obriše
--     radnika, brišemo mu nalog za prijavu, ali profil ostaje ako iza njega ima
--     izveštaja — da istorija smena ne nestane.
create table if not exists public.profiles (
  id          uuid primary key,
  email       text,                                  -- generisana adresa za prijavu
  full_name   text        not null default '',       -- ujedno i korisničko ime
  phone       text,
  role        public.user_role not null default 'radnik',
  daily_wage  numeric(10,2) not null default 0 check (daily_wage >= 0),  -- dnevnica
  is_active   boolean     not null default true,
  is_deleted  boolean     not null default false,    -- obrisan, ali ima istoriju
  avatar_path text,                                  -- slika profila u bucket-u 'avatari'
  created_at  timestamptz not null default now()
);

comment on table public.profiles is 'Radnici i vlasnici. Red se kreira automatski kad se napravi auth korisnik.';

-- Migracije za baze napravljene ranijom verzijom skripta
alter table public.profiles add column if not exists daily_wage numeric(10,2) not null default 0;
alter table public.profiles add column if not exists is_deleted boolean not null default false;
alter table public.profiles add column if not exists avatar_path text;
alter table public.profiles drop constraint if exists profiles_id_fkey;

-- Puno ime je korisničko ime — mora biti jedinstveno među aktivnim nalozima.
create unique index if not exists profiles_full_name_unique_idx
  on public.profiles (lower(full_name))
  where (not is_deleted and full_name <> '');

-- 2.2 Kategorije artikala
--     `sort_order` određuje redosled kojim se kategorije prikazuju u popisu.
--     Artikli se povezuju preko naziva (items.category), pa preimenovanje ide
--     kroz funkciju `rename_category` koja menja i jedno i drugo odjednom.
create table if not exists public.categories (
  id          uuid primary key default gen_random_uuid(),
  name        text    not null,
  sort_order  integer not null default 1000,
  created_at  timestamptz not null default now()
);

create unique index if not exists categories_name_unique_idx on public.categories (lower(name));
create index if not exists categories_order_idx on public.categories (sort_order);

-- 2.3 Artikli koji se popisuju
create table if not exists public.items (
  id          uuid primary key default gen_random_uuid(),
  name        text        not null,
  category    text        not null default 'Ostalo',
  unit        text        not null default 'kom',   -- kom, l, kg, flaša...
  sort_order  integer     not null default 100,
  is_active   boolean     not null default true,
  created_at  timestamptz not null default now()
);

create unique index if not exists items_name_unique_idx on public.items (lower(name));
create index if not exists items_category_idx on public.items (category, sort_order);

-- 2.4 Izveštaj smene (glavna tabela)
create table if not exists public.shift_reports (
  id              uuid primary key default gen_random_uuid(),
  report_date     date        not null default current_date,
  shift           public.shift_type not null,
  created_by      uuid        not null references public.profiles (id) on delete restrict,

  cash_amount     numeric(12,2) not null default 0 check (cash_amount >= 0),  -- gotovina (= predato)
  card_amount     numeric(12,2) not null default 0 check (card_amount >= 0),  -- POS / kartice
  note            text          not null default '',                          -- napomena radnika
  daily_task_done boolean       not null default false,                       -- urađena dnevna obaveza

  -- Ukupan pazar = gotovina + kartice
  total_amount    numeric(12,2) generated always as (cash_amount + card_amount) stored,

  status          public.report_status not null default 'otvoren',
  verified_by     uuid        references public.profiles (id) on delete set null,
  verified_at     timestamptz,

  -- Poruka vlasnika radniku + ko ju je napisao, da radnik vidi čija je.
  admin_note      text        not null default '',
  admin_note_by   uuid        references public.profiles (id) on delete set null,
  admin_note_at   timestamptz,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Migracija: ako si već pokrenuo raniju verziju skripta sa troškovima iz kase.
-- Redosled je bitan — `handover_amount` je zavisio od `expense_amount`.
alter table public.shift_reports drop column if exists handover_amount;
alter table public.shift_reports drop column if exists expense_amount;
alter table public.shift_reports drop column if exists expense_note;

-- Migracija: štiklirana dnevna obaveza za smenu
alter table public.shift_reports add column if not exists daily_task_done boolean not null default false;

-- Migracija: potpis uz poruku vlasnika
alter table public.shift_reports add column if not exists admin_note_by uuid references public.profiles (id) on delete set null;
alter table public.shift_reports add column if not exists admin_note_at timestamptz;

-- Jedna smena = jedan izveštaj. Bez ovoga bi dvoje radnika napravili dva
-- odvojena popisa za istu smenu.
create unique index if not exists shift_reports_one_per_shift_idx
  on public.shift_reports (report_date, shift);

create index if not exists shift_reports_date_idx    on public.shift_reports (report_date desc, shift);
create index if not exists shift_reports_creator_idx on public.shift_reports (created_by, report_date desc);
create index if not exists shift_reports_status_idx  on public.shift_reports (status);

-- 2.4 Ko je radio u smeni (više radnika po smeni)
create table if not exists public.shift_report_staff (
  report_id  uuid not null references public.shift_reports (id) on delete cascade,
  profile_id uuid not null references public.profiles (id)      on delete cascade,
  primary key (report_id, profile_id)
);

create index if not exists shift_report_staff_profile_idx on public.shift_report_staff (profile_id);

-- 2.5 Stavke popisa — iste kolone kao na popisnoj listi
create table if not exists public.shift_report_items (
  id         uuid primary key default gen_random_uuid(),
  report_id  uuid not null references public.shift_reports (id) on delete cascade,
  item_id    uuid not null references public.items (id)         on delete restrict,
  item_name  text not null,                       -- snapshot naziva (ako se artikal kasnije preimenuje)
  unit       text not null default 'kom',
  category   text not null default 'Ostalo',

  -- Radnik unosi ove tri. NULL znači „još nije upisano“ — to je bitno, jer je
  -- 0 sasvim ispravan unos (npr. sve je prodato).
  qty_start  numeric(12,2) check (qty_start >= 0),   -- Početno stanje
  qty_added  numeric(12,2) check (qty_added >= 0),   -- Dodato
  qty_end    numeric(12,2) check (qty_end   >= 0),   -- Krajnje stanje

  -- Ove dve računa baza — nema greške u sabiranju. `qty_sold` ostaje NULL dok
  -- se ne upiše krajnje stanje, da se nepopisan artikal ne prikaže kao prodat.
  qty_new    numeric(12,2) generated always as (
               coalesce(qty_start, 0) + coalesce(qty_added, 0)
             ) stored,                                                        -- Novo stanje
  qty_sold   numeric(12,2) generated always as (
               case when qty_end is null then null
                    else coalesce(qty_start, 0) + coalesce(qty_added, 0) - qty_end end
             ) stored,                                                        -- Prodato

  note       text not null default '',
  unique (report_id, item_id)
);

-- Migracija: ranije verzije skripta imale su kolonu `quantity`.
alter table public.shift_report_items add column if not exists qty_start numeric(12,2);
alter table public.shift_report_items add column if not exists qty_added numeric(12,2);
alter table public.shift_report_items add column if not exists qty_end   numeric(12,2);
alter table public.shift_report_items drop column if exists quantity;

-- Prelazak na „NULL = nije upisano“.
-- Izraz izračunate kolone ne može da se menja na licu mesta, pa se qty_new i
-- qty_sold ruše i prave iznova. To su izvedene vrednosti — ništa se ne gubi.
-- Uslov ispred znači da se ovo radi samo jednom, pri prvom pokretanju nove
-- verzije skripta.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'shift_report_items'
      and column_name  = 'qty_start'
      and is_nullable  = 'NO'
  ) then
    alter table public.shift_report_items drop column if exists qty_new;
    alter table public.shift_report_items drop column if exists qty_sold;

    alter table public.shift_report_items alter column qty_start drop not null;
    alter table public.shift_report_items alter column qty_added drop not null;
    alter table public.shift_report_items alter column qty_end   drop not null;

    alter table public.shift_report_items alter column qty_start drop default;
    alter table public.shift_report_items alter column qty_added drop default;
    alter table public.shift_report_items alter column qty_end   drop default;
  end if;
end $$;

alter table public.shift_report_items
  add column if not exists qty_new numeric(12,2)
  generated always as (coalesce(qty_start, 0) + coalesce(qty_added, 0)) stored;

alter table public.shift_report_items
  add column if not exists qty_sold numeric(12,2)
  generated always as (
    case when qty_end is null then null
         else coalesce(qty_start, 0) + coalesce(qty_added, 0) - qty_end end
  ) stored;

create index if not exists shift_report_items_report_idx on public.shift_report_items (report_id);

-- 2.6 Slike trake sa kase / dnevnog izveštaja
create table if not exists public.report_images (
  id           uuid primary key default gen_random_uuid(),
  report_id    uuid not null references public.shift_reports (id) on delete cascade,
  storage_path text not null,                     -- putanja u bucket-u 'izvestaji'
  uploaded_by  uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists report_images_report_idx on public.report_images (report_id);

-- 2.7 Isplate i bonusi
--     zarađeno   = broj odrađenih smena × dnevnica
--     za isplatu = zarađeno + bonusi − isplaćeno
create table if not exists public.payouts (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  kind        public.payout_kind not null default 'isplata',
  amount      numeric(12,2) not null check (amount > 0),
  paid_on     date not null default current_date,
  -- Kom obračunskom periodu pripada: "2026-09-A" (1–15.) ili "2026-09-B" (16–kraj).
  -- Isplata se dešava POSLE perioda (16. odnosno 1.), pa se ne može izvesti
  -- iz datuma — zato stoji posebno.
  period_key  text not null default '',
  note        text not null default '',
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);

-- Migracije za ranije verzije
alter table public.payouts add column if not exists kind public.payout_kind not null default 'isplata';
alter table public.payouts add column if not exists period_key text not null default '';

create index if not exists payouts_period_idx on public.payouts (profile_id, period_key);

-- Dopisivanje perioda postojećim isplatama:
-- isplata 1.–15. plaća drugu polovinu prethodnog meseca, a 16.–kraj prvu polovinu tekućeg.
update public.payouts
set period_key = case
  when extract(day from paid_on) <= 15
    then to_char(paid_on - interval '1 month', 'YYYY-MM') || '-B'
  else to_char(paid_on, 'YYYY-MM') || '-A'
end
where period_key = '';

create index if not exists payouts_profile_idx on public.payouts (profile_id, paid_on desc);

-- 2.8 Uplate pazara (polog gotovine u banku)
--
--     Raspored u lokalu: ponedeljkom se uplaćuje petak, subota i nedelja,
--     a petkom ponedeljak, utorak, sreda i četvrtak. Drugim rečima — pazar
--     jednog dana ide prvog sledećeg ponedeljka ili petka.
--
--     Baza NE pretpostavlja raspored. Ona samo pamti KOJI SU DANI UPLAĆENI,
--     pa „za uplatu“ ostaje sve što nije na tom spisku. Tako vlasnik može da
--     uplati i mimo rasporeda i da naknadno označi koje je dane pokrio.
create table if not exists public.cash_deposits (
  id           uuid primary key default gen_random_uuid(),
  deposited_on date not null default current_date,       -- kada je novac uplaćen
  amount       numeric(12,2) not null default 0 check (amount >= 0),
  note         text not null default '',
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists cash_deposits_date_idx on public.cash_deposits (deposited_on desc);

--     Jedan radni dan može da bude uplaćen samo jednom — zato je datum ključ.
--     `amount` je snimak gotovine tog dana u trenutku uplate, da istorija
--     ostane tačna i ako se izveštaj kasnije ispravi.
create table if not exists public.cash_deposit_days (
  business_date date primary key,
  deposit_id    uuid not null references public.cash_deposits (id) on delete cascade,
  amount        numeric(12,2) not null default 0
);

create index if not exists cash_deposit_days_deposit_idx on public.cash_deposit_days (deposit_id);

-- 2.9 Pravila i obaveze (pravilnik, dnevne obaveze, obaveze šankera i konobara)
--
--     Radnici ih čitaju na ekranu Dnevnice, vlasnik ih piše i menja.
--     `body` je običan tekst, uz znakove na početku reda:
--        #  naslov    -  stavka sa tačkom    !  upozorenje (žuto)    !!  crveni tekst
--     Sve ostalo se prikazuje kao običan red.
create table if not exists public.rule_docs (
  id          uuid primary key default gen_random_uuid(),
  title       text    not null,
  body        text    not null default '',
  sort_order  integer not null default 1000,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists rule_docs_order_idx on public.rule_docs (sort_order);


-- ---------------------------------------------------------------------
-- 3. FUNKCIJE I TRIGERI
-- ---------------------------------------------------------------------

-- 3.1 Automatsko kreiranje profila pri registraciji auth korisnika
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(new.email, '@', 1)),
    coalesce((new.raw_user_meta_data ->> 'role')::public.user_role, 'radnik')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 3.2 Pomoćna funkcija: da li je trenutni korisnik admin?
--     SECURITY DEFINER = zaobilazi RLS, pa nema beskonačne rekurzije u politikama.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
      and p.is_active
  );
$$;

-- 3.3 Pomoćna funkcija: da li trenutni korisnik sme da vidi dati izveštaj?
create or replace function public.can_access_report(p_report_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin()
      or exists (
           select 1 from public.shift_reports r
           where r.id = p_report_id
             and (
               r.created_by = auth.uid()
               or exists (
                 select 1 from public.shift_report_staff s
                 where s.report_id = r.id and s.profile_id = auth.uid()
               )
             )
         );
$$;

-- 3.4 Da li je izveštaj izmenjiv?
--     Menja ga SVAKO KO JE U SMENI — tako dvoje radnika dele isti popis i vide
--     jedno drugom unos uživo.
--     Izmenjiv je dok smena traje („otvoren“) ili kad ju je vlasnik vratio na
--     ispravku („vracen“). Posle zatvaranja (poslat) i potvrde se ne dira.
create or replace function public.report_is_editable(p_report_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.shift_reports r
    join public.shift_report_staff s
      on s.report_id = r.id and s.profile_id = auth.uid()
    where r.id = p_report_id
      and r.status in ('otvoren', 'vracen')
  );
$$;

-- 3.5 Automatsko osvežavanje updated_at
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists shift_reports_touch_updated_at on public.shift_reports;
create trigger shift_reports_touch_updated_at
  before update on public.shift_reports
  for each row execute function public.touch_updated_at();

drop trigger if exists rule_docs_touch_updated_at on public.rule_docs;
create trigger rule_docs_touch_updated_at
  before update on public.rule_docs
  for each row execute function public.touch_updated_at();

-- 3.6 Radnik NE SME sam sebi da promeni ulogu niti da se deaktivira.
--     Samo admin menja `role` i `is_active`.
--     Izmene bez prijavljenog korisnika (auth.uid() je prazan) dolaze iz
--     Supabase SQL Editora ili sa servera (Edge Function) — tamo može samo
--     vlasnik, pa se propuštaju. Bez toga ni vlasnik ne bi mogao sebi da
--     dodeli ulogu admina.
create or replace function public.guard_profile_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    new.role       := old.role;
    new.is_active  := old.is_active;
    new.is_deleted := old.is_deleted;
    new.daily_wage := old.daily_wage;   -- radnik ne menja sebi dnevnicu

    -- Slika profila sme da pokazuje samo na fajl u SVOM folderu (avatari/<id>/…).
    if new.avatar_path is not null
       and split_part(new.avatar_path, '/', 1) <> auth.uid()::text then
      new.avatar_path := old.avatar_path;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_update on public.profiles;
create trigger profiles_guard_update
  before update on public.profiles
  for each row execute function public.guard_profile_update();

-- 3.65 Otvaranje ili pridruživanje smeni
--
--   Ako izveštaj za taj datum i smenu ne postoji — pravi se novi sa statusom
--   „otvoren“. Ako već postoji — radnik mu se samo pridružuje. Tako dvoje koji
--   rade istu smenu unose u ISTI popis i oboje se vode kao da su radili.
--
--   KO UĐE U SMENU, TAJ DOBIJA DNEVNICU. Zato se u smenu može ući samo dok je
--   otvorena — kad se jednom zatvori, niko se ne može naknadno „ubaciti“.
--
--   SECURITY DEFINER: radnik ne mora unapred da vidi tuđu smenu da bi joj
--   pristupio, a i dalje ne može da upiše nikog osim sebe.
create or replace function public.open_or_join_shift(p_date date, p_shift public.shift_type)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id     uuid;
  v_status public.report_status;
begin
  if auth.uid() is null then
    raise exception 'Niste prijavljeni.';
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_active and not p.is_deleted
  ) then
    raise exception 'Nalog nije aktivan.';
  end if;

  select id, status into v_id, v_status
  from public.shift_reports
  where report_date = p_date and shift = p_shift;

  if v_id is null then
    begin
      -- I status se mora zapamtiti — bez njega bi nova smena ispod izgledala
      -- kao „već zatvorena“ i otvaranje bi se poništilo.
      insert into public.shift_reports (report_date, shift, created_by, status)
      values (p_date, p_shift, auth.uid(), 'otvoren')
      returning id, status into v_id, v_status;
    exception when unique_violation then
      -- Dvoje su kliknuli u istoj sekundi: uzmi onaj koji je upravo nastao.
      select id, status into v_id, v_status
      from public.shift_reports
      where report_date = p_date and shift = p_shift;
    end;
  end if;

  if v_status = 'potvrdjen' then
    raise exception 'Smena je već potvrđena i ne može da se menja.';
  end if;

  if v_status = 'otvoren' then
    -- Smena traje: ko uđe, taj je radio i dobija dnevnicu.
    insert into public.shift_report_staff (report_id, profile_id)
    values (v_id, auth.uid())
    on conflict do nothing;

  elsif not exists (
    select 1 from public.shift_report_staff
    where report_id = v_id and profile_id = auth.uid()
  ) then
    -- Smena je već zatvorena, a ovaj u njoj nije radio — ne upisuje se.
    raise exception 'Smena je već zatvorena.';
  end if;

  return v_id;
end;
$$;


-- 3.66 Da li smena već postoji?
--
--   Radnik po RLS pravilima ne vidi smenu dok joj se ne pridruži, a ekran mora
--   unapred da zna da li piše „Otvori smenu“ ili „Uđi u smenu“ i ko je već
--   unutra. Zato ova funkcija vraća SAMO to — bez pazara i bez popisa.
--
--   Vraća 0 redova ako smena za taj datum još ne postoji.
create or replace function public.peek_shift(p_date date, p_shift public.shift_type)
returns table (report_id uuid, report_status public.report_status, staff_names text[])
language sql
stable
security definer
set search_path = public
as $$
  select
    r.id,
    r.status,
    coalesce(
      array(
        select p.full_name
        from public.shift_report_staff s
        join public.profiles p on p.id = s.profile_id
        where s.report_id = r.id
        order by p.full_name
      ),
      array[]::text[]
    )
  from public.shift_reports r
  where r.report_date = p_date
    and r.shift = p_shift;
$$;


-- 3.67 Prodaja po artiklima za period (ekran Artikli → Prodaja)
--
--   Sabira „prodato“ iz svih ZATVORENIH smena u periodu, po artiklu.
--   Sabiranje radi baza: za mesec je to i do ~10.000 redova popisa, a u
--   aplikaciju stiže samo po jedan red za svaki artikal.
--   SECURITY INVOKER: važe RLS pravila pozivaoca — vlasnik vidi sve smene.
create or replace function public.item_sales(p_from date, p_to date)
returns table (item_id uuid, item_name text, unit text, category text, sold numeric, shifts bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select
    si.item_id,
    max(si.item_name)                  as item_name,
    max(si.unit)                       as unit,
    max(si.category)                   as category,
    coalesce(sum(si.qty_sold), 0)      as sold,
    count(distinct si.report_id)       as shifts
  from public.shift_report_items si
  join public.shift_reports r on r.id = si.report_id
  where r.report_date between p_from and p_to
    and r.status <> 'otvoren'
    and si.qty_end is not null
  group by si.item_id;
$$;


-- 3.7 Preimenovanje kategorije — menja i kategoriju i sve njene artikle odjednom.
--     SECURITY INVOKER: važe RLS pravila pozivaoca, tj. samo admin može.
create or replace function public.rename_category(p_id uuid, p_name text)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_old text;
  v_new text := btrim(p_name);
begin
  if v_new = '' then
    raise exception 'Naziv kategorije ne može biti prazan.';
  end if;

  select name into v_old from public.categories where id = p_id;
  if v_old is null then
    raise exception 'Kategorija ne postoji.';
  end if;

  update public.categories set name = v_new where id = p_id;
  update public.items set category = v_new where category = v_old;
end;
$$;

-- 3.8 Automatski potpis: ko je i kada potvrdio, i ko je napisao poruku.
--     Aplikacija upisuje samo tekst poruke — ime se dopisuje ovde, da niko ne
--     može da se potpiše tuđim imenom.
create or replace function public.stamp_verification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    if new.status = 'potvrdjen' then
      new.verified_by := auth.uid();
      new.verified_at := now();
    else
      new.verified_by := null;
      new.verified_at := null;
    end if;
  end if;

  if new.admin_note is distinct from old.admin_note then
    if btrim(coalesce(new.admin_note, '')) = '' then
      new.admin_note_by := null;
      new.admin_note_at := null;
    else
      new.admin_note_by := auth.uid();
      new.admin_note_at := now();
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists shift_reports_stamp_verification on public.shift_reports;
create trigger shift_reports_stamp_verification
  before update on public.shift_reports
  for each row execute function public.stamp_verification();


-- ---------------------------------------------------------------------
-- 4. ROW LEVEL SECURITY
-- ---------------------------------------------------------------------
alter table public.profiles            enable row level security;
alter table public.categories          enable row level security;
alter table public.items               enable row level security;
alter table public.shift_reports       enable row level security;
alter table public.shift_report_staff  enable row level security;
alter table public.shift_report_items  enable row level security;
alter table public.report_images       enable row level security;
alter table public.payouts             enable row level security;
alter table public.cash_deposits       enable row level security;
alter table public.cash_deposit_days   enable row level security;
alter table public.rule_docs           enable row level security;

-- ===================== 4.1 PROFILES =====================
drop policy if exists "profiles_select_all_authenticated" on public.profiles;
create policy "profiles_select_all_authenticated"
  on public.profiles for select
  to authenticated
  using (true);   -- radnici moraju da vide imena kolega za izbor smene

drop policy if exists "profiles_update_self_or_admin" on public.profiles;
create policy "profiles_update_self_or_admin"
  on public.profiles for update
  to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

drop policy if exists "profiles_insert_admin" on public.profiles;
create policy "profiles_insert_admin"
  on public.profiles for insert
  to authenticated
  with check (public.is_admin());

drop policy if exists "profiles_delete_admin" on public.profiles;
create policy "profiles_delete_admin"
  on public.profiles for delete
  to authenticated
  using (public.is_admin());

-- ===================== 4.2 CATEGORIES =====================
drop policy if exists "categories_select_authenticated" on public.categories;
create policy "categories_select_authenticated"
  on public.categories for select
  to authenticated
  using (true);

drop policy if exists "categories_write_admin" on public.categories;
create policy "categories_write_admin"
  on public.categories for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ===================== 4.3 ITEMS =====================
drop policy if exists "items_select_authenticated" on public.items;
create policy "items_select_authenticated"
  on public.items for select
  to authenticated
  using (true);

drop policy if exists "items_write_admin" on public.items;
create policy "items_write_admin"
  on public.items for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ===================== 4.3 SHIFT_REPORTS =====================
drop policy if exists "reports_select_own_or_admin" on public.shift_reports;
create policy "reports_select_own_or_admin"
  on public.shift_reports for select
  to authenticated
  using (
    public.is_admin()
    or created_by = auth.uid()
    or exists (
      select 1 from public.shift_report_staff s
      where s.report_id = shift_reports.id and s.profile_id = auth.uid()
    )
  );

drop policy if exists "reports_insert_self" on public.shift_reports;
create policy "reports_insert_self"
  on public.shift_reports for insert
  to authenticated
  with check (
    created_by = auth.uid()
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_active)
  );

-- Izveštaj menja SVAKO KO JE U SMENI dok smena traje ili je vraćena na
-- ispravku; admin menja sve. Radnik sme da ga ostavi otvorenim ili da ga
-- zatvori (poslat) — potvrdu upisuje samo vlasnik.
drop policy if exists "reports_update_own_unverified_or_admin" on public.shift_reports;
create policy "reports_update_own_unverified_or_admin"
  on public.shift_reports for update
  to authenticated
  using (
    public.is_admin()
    or public.report_is_editable(id)
  )
  with check (
    public.is_admin()
    or (public.report_is_editable(id) and status in ('otvoren', 'poslat'))
  );

drop policy if exists "reports_delete_admin" on public.shift_reports;
create policy "reports_delete_admin"
  on public.shift_reports for delete
  to authenticated
  using (public.is_admin());

-- ===================== 4.4 SHIFT_REPORT_STAFF =====================
drop policy if exists "staff_select" on public.shift_report_staff;
create policy "staff_select"
  on public.shift_report_staff for select
  to authenticated
  using (public.can_access_report(report_id));

-- VAŽNO: radnik može da upiše u smenu SAMO SEBE — i to sam sebe upisuje time
-- što uđe u smenu (funkcija `open_or_join_shift`). Ko uđe, taj dobija dnevnicu.
-- Tuđe ime u smenu može da doda jedino vlasnik.
drop policy if exists "staff_insert" on public.shift_report_staff;
create policy "staff_insert"
  on public.shift_report_staff for insert
  to authenticated
  with check (
    public.is_admin()
    or (public.report_is_editable(report_id) and profile_id = auth.uid())
  );

drop policy if exists "staff_delete" on public.shift_report_staff;
create policy "staff_delete"
  on public.shift_report_staff for delete
  to authenticated
  using (
    public.is_admin()
    or (public.report_is_editable(report_id) and profile_id = auth.uid())
  );

-- ===================== 4.5 SHIFT_REPORT_ITEMS =====================
drop policy if exists "report_items_select" on public.shift_report_items;
create policy "report_items_select"
  on public.shift_report_items for select
  to authenticated
  using (public.can_access_report(report_id));

drop policy if exists "report_items_insert" on public.shift_report_items;
create policy "report_items_insert"
  on public.shift_report_items for insert
  to authenticated
  with check (public.is_admin() or public.report_is_editable(report_id));

drop policy if exists "report_items_update" on public.shift_report_items;
create policy "report_items_update"
  on public.shift_report_items for update
  to authenticated
  using (public.is_admin() or public.report_is_editable(report_id))
  with check (public.is_admin() or public.report_is_editable(report_id));

drop policy if exists "report_items_delete" on public.shift_report_items;
create policy "report_items_delete"
  on public.shift_report_items for delete
  to authenticated
  using (public.is_admin() or public.report_is_editable(report_id));

-- ===================== 4.6 REPORT_IMAGES =====================
drop policy if exists "report_images_select" on public.report_images;
create policy "report_images_select"
  on public.report_images for select
  to authenticated
  using (public.can_access_report(report_id));

drop policy if exists "report_images_insert" on public.report_images;
create policy "report_images_insert"
  on public.report_images for insert
  to authenticated
  with check (public.is_admin() or public.report_is_editable(report_id));

drop policy if exists "report_images_delete" on public.report_images;
create policy "report_images_delete"
  on public.report_images for delete
  to authenticated
  using (public.is_admin() or public.report_is_editable(report_id));


-- ===================== 4.7 PAYOUTS =====================
-- Radnik vidi samo svoje isplate; vlasnik vidi i upisuje sve.
drop policy if exists "payouts_select_own_or_admin" on public.payouts;
create policy "payouts_select_own_or_admin"
  on public.payouts for select
  to authenticated
  using (profile_id = auth.uid() or public.is_admin());

drop policy if exists "payouts_write_admin" on public.payouts;
create policy "payouts_write_admin"
  on public.payouts for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());


-- ===================== 4.8 UPLATE PAZARA =====================
-- Uplate u banku su isključivo vlasnikova stvar — radnik ih ne vidi.
drop policy if exists "deposits_admin" on public.cash_deposits;
create policy "deposits_admin"
  on public.cash_deposits for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "deposit_days_admin" on public.cash_deposit_days;
create policy "deposit_days_admin"
  on public.cash_deposit_days for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());


-- ===================== 4.9 PRAVILA I OBAVEZE =====================
-- Čitaju svi prijavljeni, menja samo vlasnik.
drop policy if exists "rule_docs_select_authenticated" on public.rule_docs;
create policy "rule_docs_select_authenticated"
  on public.rule_docs for select
  to authenticated
  using (true);

drop policy if exists "rule_docs_write_admin" on public.rule_docs;
create policy "rule_docs_write_admin"
  on public.rule_docs for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());


-- ---------------------------------------------------------------------
-- 5. STORAGE — bucket za slike traka sa kase
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'izvestaji',
  'izvestaji',
  false,                                   -- PRIVATAN bucket (pristup samo preko signed URL-a)
  10485760,                                -- max 10 MB po fajlu
  array['image/jpeg','image/png','image/webp','image/heic','application/pdf']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Svi prijavljeni korisnici (radnici i vlasnik) smeju da čitaju slike iz bucket-a.
-- Bucket je privatan prema spolja — bez prijave se ništa ne vidi.
drop policy if exists "izvestaji_select_authenticated" on storage.objects;
create policy "izvestaji_select_authenticated"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'izvestaji');

drop policy if exists "izvestaji_insert_authenticated" on storage.objects;
create policy "izvestaji_insert_authenticated"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'izvestaji');

drop policy if exists "izvestaji_update_owner_or_admin" on storage.objects;
create policy "izvestaji_update_owner_or_admin"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'izvestaji' and (owner = auth.uid() or public.is_admin()))
  with check (bucket_id = 'izvestaji' and (owner = auth.uid() or public.is_admin()));

drop policy if exists "izvestaji_delete_owner_or_admin" on storage.objects;
create policy "izvestaji_delete_owner_or_admin"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'izvestaji' and (owner = auth.uid() or public.is_admin()));

-- 5.1 Slike profila
--     Svaki radnik ima svoj folder: avatari/<id radnika>/<vreme>.jpg
--     Radnik menja samo svoju sliku, admin svačiju. Vide ih svi prijavljeni.
--     Slika se pre slanja iseče na kvadrat 320×320 (~25 KB), pa 2 MB granica
--     služi samo kao zaštita.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatari',
  'avatari',
  false,                                   -- privatan, kao i slike traka
  2097152,                                 -- max 2 MB po fajlu
  array['image/jpeg','image/png','image/webp']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "avatari_select_authenticated" on storage.objects;
create policy "avatari_select_authenticated"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'avatari');

drop policy if exists "avatari_insert_self_or_admin" on storage.objects;
create policy "avatari_insert_self_or_admin"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'avatari'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  );

drop policy if exists "avatari_update_self_or_admin" on storage.objects;
create policy "avatari_update_self_or_admin"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'avatari'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  )
  with check (
    bucket_id = 'avatari'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  );

drop policy if exists "avatari_delete_self_or_admin" on storage.objects;
create policy "avatari_delete_self_or_admin"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'avatari'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  );


-- ---------------------------------------------------------------------
-- 6. POGLED ZA BRZU STATISTIKU (koristi ga admin dashboard)
-- ---------------------------------------------------------------------
drop view if exists public.report_summary;

create view public.report_summary
with (security_invoker = true)     -- poštuje RLS pozivaoca
as
select
  r.id,
  r.report_date,
  r.shift,
  r.status,
  r.cash_amount,
  r.card_amount,
  r.total_amount,
  r.created_at,
  r.created_by,
  p.full_name as created_by_name,
  (select count(*) from public.report_images i where i.report_id = r.id)      as image_count,
  (select count(*) from public.shift_report_items si where si.report_id = r.id) as item_count
from public.shift_reports r
join public.profiles p on p.id = r.created_by;


-- 6.1 Pazar po danima — osnova za ekran „Uplate“.
--     Smena koja je JOŠ U TOKU se ne sabira: njen pazar još nije zaključen.
--     `open_shifts` postoji da aplikacija može da upozori da dan nije gotov.
drop view if exists public.daily_cash;

create view public.daily_cash
with (security_invoker = true)     -- poštuje RLS pozivaoca (vlasnik vidi sve)
as
select
  r.report_date,
  coalesce(sum(r.cash_amount)  filter (where r.status <> 'otvoren'), 0) as cash_amount,
  coalesce(sum(r.card_amount)  filter (where r.status <> 'otvoren'), 0) as card_amount,
  coalesce(sum(r.total_amount) filter (where r.status <> 'otvoren'), 0) as total_amount,
  count(*) filter (where r.status <> 'otvoren')  as closed_shifts,
  count(*) filter (where r.status =  'otvoren')  as open_shifts
from public.shift_reports r
group by r.report_date;


-- ---------------------------------------------------------------------
-- 7. DOZVOLE
-- ---------------------------------------------------------------------
grant usage on schema public to anon, authenticated;
grant select on public.report_summary to authenticated;
grant select on public.daily_cash     to authenticated;
grant execute on function public.is_admin()                to authenticated;
grant execute on function public.can_access_report(uuid)   to authenticated;
grant execute on function public.report_is_editable(uuid)  to authenticated;
grant execute on function public.rename_category(uuid, text) to authenticated;
grant execute on function public.open_or_join_shift(date, public.shift_type) to authenticated;
grant execute on function public.peek_shift(date, public.shift_type) to authenticated;
grant execute on function public.item_sales(date, date) to authenticated;


-- ---------------------------------------------------------------------
-- 7.1 REALTIME — da dvoje u istoj smeni vide izmene onog drugog
-- ---------------------------------------------------------------------
do $$
begin
  alter publication supabase_realtime add table public.shift_report_items;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.shift_reports;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.shift_report_staff;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.report_images;
exception when duplicate_object then null;
end $$;


-- ---------------------------------------------------------------------
-- 8. KATEGORIJE — redosled kojim se prikazuju u popisu
--    Menjaju se kroz aplikaciju: Vlasnik -> Artikli -> Kategorije.
-- ---------------------------------------------------------------------
-- Preimenovanje „Monin — kafa i deserti“ → „Monin — kafa“ za bazu napunjenu
-- ranijom verzijom skripta (inače bi donji INSERT napravio drugu kategoriju).
update public.categories
set name = 'Monin — kafa'
where name = 'Monin — kafa i deserti'
  and not exists (select 1 from public.categories where name = 'Monin — kafa');

update public.items
set category = 'Monin — kafa'
where category = 'Monin — kafa i deserti';

insert into public.categories (name, sort_order) values
  ('Kafa',                   100),
  ('Čaj',                    200),
  ('Cedevita',               300),
  ('Ceđeni sokovi',          400),
  ('Sokovi',                 500),
  ('Voda',                   600),
  ('Gazirana pića',          700),
  ('Energetska pića',        800),
  ('Pivo',                   900),
  ('Vino',                  1000),
  ('Rakija',                1100),
  ('Viski',                 1200),
  ('Votka i džin',          1300),
  ('Tekila',                1400),
  ('Rum, konjak i vinjak',  1500),
  ('Likeri i aperitivi',    1600),
  ('Monin — kafa', 1700),
  ('Monin — voćni',         1800),
  ('Gelato',                1900),
  ('Ostalo',                2000)
on conflict do nothing;

-- Ako u bazi već postoje artikli sa kategorijom koje nema u tabeli
-- (napravljeni ranijom verzijom, kad je kategorija bila slobodan tekst),
-- ova linija ih dopisuje na kraj spiska.
insert into public.categories (name, sort_order)
select distinct i.category, 9000
from public.items i
where not exists (
  select 1 from public.categories c where lower(c.name) = lower(i.category)
)
on conflict do nothing;


-- ---------------------------------------------------------------------
-- 9. ARTIKLI — Bistro de Balzac
--    Prepisano sa popisnih listi, razvrstano po kategorijama.
--    Redosled (sort_order) prati redosled u popisu; menja se kroz app.
-- ---------------------------------------------------------------------
insert into public.items (name, category, unit, sort_order) values
  -- Kafa
  ('Espresso',                      'Kafa',                   'kom',   110),
  ('Nes kafa',                      'Kafa',                   'kom',   120),
  ('Domaća kafa',                   'Kafa',                   'kom',   130),

  -- Čaj
  ('Čaj nana',                      'Čaj',                    'kom',   210),
  ('Čaj kamilica',                  'Čaj',                    'kom',   220),
  ('Čaj multivitamin',              'Čaj',                    'kom',   230),
  ('Zeleni čaj',                    'Čaj',                    'kom',   240),
  ('Čaj jabuka cimet',              'Čaj',                    'kom',   250),
  ('Čaj Earl Grey',                 'Čaj',                    'kom',   260),

  -- Cedevita
  ('Cedevita limun',                'Cedevita',               'kom',   310),
  ('Cedevita pomorandža',           'Cedevita',               'kom',   320),
  ('Cedevita ananas',               'Cedevita',               'kom',   330),
  ('Cedevita limeta',               'Cedevita',               'kom',   340),
  ('Cedevita limunska trava',       'Cedevita',               'kom',   350),

  -- Ceđeni sokovi
  ('Limun',                         'Ceđeni sokovi',          'kom',   410),
  ('Pomorandža',                    'Ceđeni sokovi',          'kom',   420),
  ('Grejp',                         'Ceđeni sokovi',          'kom',   430),

  -- Sokovi
  ('Next jabuka',                   'Sokovi',                 'flaša', 510),
  ('Next pomorandža',               'Sokovi',                 'flaša', 520),
  ('Next breskva',                  'Sokovi',                 'flaša', 530),

  -- Voda
  ('Knjaz Miloš',                   'Voda',                   'flaša', 610),
  ('Rosa',                          'Voda',                   'flaša', 620),
  ('Limunska trava',                'Voda',                   'flaša', 630),

  -- Gazirana pića
  ('Coca-Cola',                     'Gazirana pića',          'flaša', 710),
  ('Coca-Cola Zero',                'Gazirana pića',          'flaša', 720),
  ('Fanta',                         'Gazirana pića',          'flaša', 730),
  ('Sprite',                        'Gazirana pića',          'flaša', 740),
  ('Schweppes Bitter',              'Gazirana pića',          'flaša', 750),
  ('Schweppes Tonic',               'Gazirana pića',          'flaša', 760),
  ('Cocta',                         'Gazirana pića',          'flaša', 770),
  ('Cocta Free',                    'Gazirana pića',          'flaša', 780),

  -- Energetska pića
  ('Ultra Energy',                  'Energetska pića',        'lim',   810),
  ('Guarana',                       'Energetska pića',        'lim',   820),
  ('Red Bull',                      'Energetska pića',        'lim',   830),

  -- Pivo
  ('Heineken',                      'Pivo',                   'flaša', 910),
  ('Amstel',                        'Pivo',                   'flaša', 920),

  -- Vino
  ('Kupinovo vino',                 'Vino',                   'flaša', 1010),
  ('Vranac',                        'Vino',                   'flaša', 1020),
  ('Crnogorski Chardonnay',         'Vino',                   'flaša', 1030),
  ('Crnogorski Rose',               'Vino',                   'flaša', 1040),

  -- Rakija
  ('Arhiva Živanović',              'Rakija',                 'flaša', 1110),
  ('Šljiva Živanović',              'Rakija',                 'flaša', 1120),
  ('Evdokia Živanović',             'Rakija',                 'flaša', 1130),
  ('Dunja Živanović',               'Rakija',                 'flaša', 1140),
  ('Kajsija Živanović',             'Rakija',                 'flaša', 1150),
  ('Viljamovka Živanović',          'Rakija',                 'flaša', 1160),
  ('Šljiva Pevac',                  'Rakija',                 'flaša', 1170),
  ('Dunja Pevac',                   'Rakija',                 'flaša', 1180),
  ('Kajsija Pevac',                 'Rakija',                 'flaša', 1190),
  ('Viljamovka Pevac',              'Rakija',                 'flaša', 1200),
  ('Loza Pevac',                    'Rakija',                 'flaša', 1210),
  ('Medovača Pevac',                'Rakija',                 'flaša', 1220),
  ('Višnja Pevac',                  'Rakija',                 'flaša', 1230),

  -- Viski
  ('Johnny Walker Red',             'Viski',                  'flaša', 1310),
  ('Johnny Walker Black',           'Viski',                  'flaša', 1320),
  ('Jameson',                       'Viski',                  'flaša', 1330),
  ('Jameson Stout Edition',         'Viski',                  'flaša', 1340),
  ('Jameson Cold Brew',             'Viski',                  'flaša', 1350),
  ('Ballantines',                   'Viski',                  'flaša', 1360),
  ('Jack Daniels',                  'Viski',                  'flaša', 1370),
  ('Jack Daniels Honey',            'Viski',                  'flaša', 1380),
  ('Jack Daniels Apple',            'Viski',                  'flaša', 1390),
  ('Jack Daniels Fire',             'Viski',                  'flaša', 1400),
  ('Jim Beam',                      'Viski',                  'flaša', 1410),
  ('Macallan',                      'Viski',                  'flaša', 1420),
  ('Chivas Regal',                  'Viski',                  'flaša', 1430),

  -- Votka i džin
  ('Belvedere',                     'Votka i džin',           'flaša', 1510),
  ('Smirnoff',                      'Votka i džin',           'flaša', 1520),
  ('Gordons Gin',                   'Votka i džin',           'flaša', 1530),
  ('Whitley Neill Original',        'Votka i džin',           'flaša', 1540),
  ('Whitley Neill Aloe & Krastavac','Votka i džin',           'flaša', 1550),

  -- Tekila
  ('Olmeca Silver',                 'Tekila',                 'flaša', 1610),
  ('Olmeca Gold',                   'Tekila',                 'flaša', 1620),
  ('La Cofradia Blanco',            'Tekila',                 'flaša', 1630),
  ('La Cofradia Reposado',          'Tekila',                 'flaša', 1640),

  -- Rum, konjak i vinjak
  ('Pascas Dark Rum',               'Rum, konjak i vinjak',   'flaša', 1710),
  ('Courvoisier',                   'Rum, konjak i vinjak',   'flaša', 1720),
  ('Rubin Vinjak 5',                'Rum, konjak i vinjak',   'flaša', 1730),

  -- Likeri i aperitivi
  ('Gorki List',                    'Likeri i aperitivi',     'flaša', 1810),
  ('Jägermeister',                  'Likeri i aperitivi',     'flaša', 1820),
  ('Campari',                       'Likeri i aperitivi',     'flaša', 1830),
  ('Vermouth',                      'Likeri i aperitivi',     'flaša', 1840),
  ('Coffee Liqueur',                'Likeri i aperitivi',     'flaša', 1850),

  -- Monin — kafa
  ('Monin Chocolate',               'Monin — kafa', 'flaša', 1910),
  ('Monin Vanille',                 'Monin — kafa', 'flaša', 1920),
  ('Monin Pistachio',               'Monin — kafa', 'flaša', 1930),
  ('Monin Caramel',                 'Monin — kafa', 'flaša', 1940),
  ('Monin Chocolate Cookie',        'Monin — kafa', 'flaša', 1950),

  -- Monin — voćni
  ('Monin Breskva',                 'Monin — voćni',          'flaša', 2010),
  ('Monin Mango',                   'Monin — voćni',          'flaša', 2020),
  ('Monin Kivi',                    'Monin — voćni',          'flaša', 2030),
  ('Monin Jagoda',                  'Monin — voćni',          'flaša', 2040),
  ('Monin Borovnica',               'Monin — voćni',          'flaša', 2050),
  ('Monin Tropsko voće',            'Monin — voćni',          'flaša', 2060),

  -- Gelato
  ('Gelato Čokolada',               'Gelato',                 'kom',   2110),
  ('Gelato Vanila',                 'Gelato',                 'kom',   2120),
  ('Gelato Plazma',                 'Gelato',                 'kom',   2130),
  ('Gelato Pistać',                 'Gelato',                 'kom',   2140),
  ('Gelato Malina',                 'Gelato',                 'kom',   2150),
  ('Gelato Jogurt višnja',          'Gelato',                 'kom',   2160),
  ('Gelato Karamela',               'Gelato',                 'kom',   2170),

  -- Ostalo
  ('Stikeri',                       'Ostalo',                 'kom',   2210)
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 10. PRAVILA I OBAVEZE — Bistro de Balzac
--     Prepisano iz Word dokumenata vlasnika, na latinici.
--     Ubacuje se SAMO ako je tabela prazna — ponovno pokretanje skripta ne
--     briše izmene koje je vlasnik napravio kroz aplikaciju.
-- ---------------------------------------------------------------------
insert into public.rule_docs (title, sort_order, body)
select v.title, v.sort_order, v.body
from (values
  ('Dnevne obaveze', 100, $doc$# Ponedeljak
1. smena: Čišćenje polica sa žestinom, šoljica za čaj i rakija.
2. smena: Čišćenje ostalih polica.
! PRANJE KAFEMATA SA PRAŠKOM NA KRAJU 2. SMENE!!

# Utorak
1. smena: Detaljno čišćenje vitrine, oko burića za pivo, frižidera za flaširana piva.
2. smena: Detaljno čišćenje ispod šanka, sudomašine, ledomata, frižidera za koka-kolu.

# Sreda
1. smena: Čišćenje polica sa knjigama.
2. smena: Čišćenje vinskih flaša, mreže oko njih, vitrine za vino i sladoled.
! PRANJE KAFEMATA SA PRAŠKOM NA KRAJU 2. SMENE!!

# Četvrtak
1. smena: Čišćenje šanka, gde stoje šećerići, med, ratluk itd. i pranje svih guma.
2. smena: Čišćenje monitora, oko monitora, ispod monitora, kase.

# Petak
1. smena: Čišćenje polica sa žestinom.
2. smena: Čišćenje ostalih polica.
! PRANJE KAFEMATA SA PRAŠKOM NA KRAJU 2. SMENE!!

# Subota
1. smena: Čišćenje svih listića bambusa.
2. smena: Čišćenje leve i desne mreže kod ulaznih vrata.

# Nedelja
Nedelja je slobodna, ali to ne znači da se ne treba voditi računa o higijeni.

!! Dnevne obaveze su tu kako biste stekli naviku za održavanje higijene.
!! Dnevne obaveze se obavljaju kada u lokalu nema ljudi kojima biste bili okrenuti leđima ili smetali.
! Neobavljanje dnevnih obaveza biće novčano kažnjivo!$doc$),

  ('Pravilnik o radu u kafiću', 200, $doc$# 1. Radno vreme i dolazak na posao
- Zaposleni je dužan da dođe na posao 15 minuta pre početka smene.
- Kašnjenje nije dozvoljeno bez opravdanog razloga.
- U slučaju sprečenosti za dolazak na posao, zaposleni je dužan da na vreme pronađe zamenu.

# 2. Odeća i lična higijena
- Zaposleni mora biti uredno obučen, u čistoj i pristojnoj garderobi.
- Lična higijena mora biti na visokom nivou (čiste ruke, uredna kosa, kratki i čisti nokti).
- Nije dozvoljeno raditi u neprimerenoj odeći, papučama ili sportskoj garderobi.

# 3. Odnos prema gostima
- Zaposleni je dužan da se prema gostima ophodi ljubazno, kulturno i profesionalno.
- Svakom gostu se treba obraćati sa poštovanjem i bez rasprave.
- Nije dozvoljeno povišavanje tona, raspravljanje ili nepristojno ponašanje prema gostima.
- Primedbe gostiju se rešavaju smireno.

# 4. Radne obaveze
- Zaposleni je dužan da savesno i odgovorno obavlja svoje radne zadatke.
- Radni prostor (šank, stolovi, oprema) mora biti uvek čist i uredan.
- Piće se mora posluživati tačno.
- Nije dozvoljeno konzumiranje alkohola tokom radnog vremena.

# 5. Odnos prema imovini
- Zaposleni je dužan da čuva ceo inventar i opremu kafića.
- Svako namerno oštećenje ili nemar biće sankcionisano.
- Uočeni kvarovi ili bilo kakav manjak moraju se odmah prijaviti.

# 6. Korišćenje telefona
- Korišćenje mobilnog telefona tokom radnog vremena nije dozvoljeno, osim u hitnim slučajevima.
- Telefon se može koristiti tokom pauze, odnosno kada su svi usluženi, piksle zamenjene i kada nema gostiju.

# 7. Zabrane tokom rada
- Zabranjeno je dovođenje prijatelja i poznanika za šank tokom smene.
- Zabranjeno je napuštanje radnog mesta bez dozvole.
- Zabranjeno je uzimanje novca ili bilo čega bez odobrenja.

! Nepoštovanje ovog pravilnika biće novčano kažnjivo.$doc$),

  ('Obaveze šankera', 300, $doc$1. Rađenje popisa na početku svake smene.
2. Šank u svakom trenutku mora biti besprekorno čist.
3. Dolazak u svaku smenu 15 minuta ranije.
4. Higijena mora biti na nivou.
5. Na svakih 65 espresa na mlinu trebaju biti oprane ručke i sita od kafemata.
6. Na zatvaranju prve smene cediljka, džezva i daska za sečenje moraju biti čiste.
7. U drugoj smeni sokovnik, cediljka, džezva, daska za sečenje i ostalo moraju biti čisti do 23:00.
8. Kafemat u drugoj smeni treba biti opran od 23:20 do 23:30 ili ranije uz odobrenje.
9. Obavljanje dnevnih obaveza.

! Nepoštovanje svega navedenog biće novčano kažnjeno!$doc$),

  ('Obaveze konobara', 400, $doc$1. Ljubaznost mora biti na nivou!
2. Kucanje u kasu odmah nakon što uslužite gosta.
3. Menjanje piksli nakon maksimalno 3 pikavca.
4. Čišćenje stolova sa vlažnom krpom.
5. Tabla, piksla i vaza moraju biti uz ivicu stola.
6. Papiriće i đubre po podu skupljajte i bacajte.
7. Dnevne obaveze za vašu smenu moraju biti urađene.
8. Dolazak u svaku smenu 15 minuta ranije.
9. Održavajte higijenu svog radnog prostora (monitor, kasa, šank).
10. Održavanje higijene muškog i ženskog toaleta (provera da li ima ubrusa, da li je sve čisto i upisivanje na papir, u oba toaleta, koji se nalazi iza vrata) tri puta u toku smene.
11. Pokrivanje bašte u 22:45 ili ranije ukoliko je napolju hladno i nema ljudi.
12. Naplaćivanje i zatvaranje prve smene u 15:15 najkasnije, a u drugoj smeni najkasnije u 23:45.
13. Obavljanje dnevnih obaveza.

! Nepoštovanje svega navedenog biće novčano kažnjeno!$doc$)
) as v (title, sort_order, body)
where not exists (select 1 from public.rule_docs);

-- Dnevne obaveze: „1. …“ i „2. …“ postaju „1. smena: …“ i „2. smena: …“ —
-- za baze u kojima su dokumenti već upisani. Menja samo redove koji još
-- nemaju reč „smena“, pa ponovno pokretanje ništa ne kvari.
update public.rule_docs
set body = regexp_replace(body, '^([12])\. (?!smena)', '\1. smena: ', 'gn')
where title = 'Dnevne obaveze'
  and body ~ '(^|\n)[12]\. (?!smena)';

-- Ispravke kategorija za baze napunjene ranijom verzijom skripta.
-- (Gornji INSERT preskače postojeće artikle, pa se izmene rade ovde.)
update public.items
set category = 'Voda', sort_order = 630
where lower(name) = 'limunska trava';


-- =====================================================================
--  GOTOVO.
--
--  SLEDEĆI KORAK — napravi svoj ADMIN nalog:
--  1) Authentication -> Users -> "Add user" -> unesi email i lozinku
--     (obavezno čekiraj "Auto Confirm User").
--  2) Vrati se u SQL Editor i pokreni (zameni svoj email i svoje ime):
--
--       update public.profiles
--       set role = 'admin', full_name = 'Nikola Ivković'
--       where email = 'tvoj-email@primer.com';
--
--  U aplikaciju se prijavljuješ PUNIM IMENOM (ili emailom — oba rade za
--  naloge napravljene ovde). Radnici koje kasnije otvoriš kroz aplikaciju
--  prijavljuju se isključivo punim imenom i lozinkom koju im ti zadaš.
-- =====================================================================
