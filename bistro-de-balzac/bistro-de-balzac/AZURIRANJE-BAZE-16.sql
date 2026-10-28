-- =====================================================================
--  BISTRO DE BALZAC — ažuriranje baze (uslovi za bedževe i radnici meseca)
--
--  Šta ovo radi:
--    · uz svaki bedž stoji „šta je potrebno da se dobije“ — admin to menja,
--      a radnici čitaju u Profilu, u odeljku Bedževi
--    · pravi spisak radnika meseca (mesec + radnik) koji vide svi
--
--  Kako:
--    supabase.com → tvoj projekat → SQL Editor → New query → nalepi sve →
--    Run. Može da se pokrene više puta, ništa se ne duplira.
--
--  Napomena: ovo je DODATAK na skriptu 10 (bedževi).
-- =====================================================================

-- ---------------------------------------------------------------------
--  1. ŠTA JE POTREBNO ZA BEDŽ
-- ---------------------------------------------------------------------
alter table public.badges
  add column if not exists requirement text not null default '';

--  Za šest gotovih bedževa upisuje se predlog — ako si ih ranije izmenio ili
--  ako imaju svoj tekst, ne dira se. Slobodno ih promeni u aplikaciji.
update public.badges set requirement = 'Najbolji radnik u mesecu — bira ga admin na kraju meseca.'
 where requirement = '' and lower(name) = 'radnik meseca';
update public.badges set requirement = 'Godinu dana rada u lokalu.'
 where requirement = '' and lower(name) = 'godina dana';
update public.badges set requirement = 'Tri godine rada u lokalu.'
 where requirement = '' and lower(name) = 'tri godine';
update public.badges set requirement = 'Pet godina rada u lokalu.'
 where requirement = '' and lower(name) = 'pet godina';
update public.badges set requirement = 'Mesec dana popisa bez ijedne greške.'
 where requirement = '' and lower(name) = 'bez greške';
update public.badges set requirement = 'Nijedno kašnjenje tokom meseca.'
 where requirement = '' and lower(name) = 'uvek na vreme';


-- ---------------------------------------------------------------------
--  2. RADNICI MESECA
-- ---------------------------------------------------------------------
--  Jedan red = jedan radnik u jednom mesecu. Mesec se čuva kao prvi dan
--  tog meseca (npr. 2026-10-01 za oktobar). Za isti mesec može i više ljudi
--  (kad je izjednačeno), ali ista osoba ne dva puta.
create table if not exists public.monthly_winners (
  id         uuid primary key default gen_random_uuid(),
  month      date not null,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  note       text not null default '',
  created_at timestamptz not null default now(),
  constraint monthly_winners_first_day check (month = date_trunc('month', month)::date),
  constraint monthly_winners_unique unique (month, profile_id)
);

create index if not exists monthly_winners_month_idx on public.monthly_winners (month desc);

alter table public.monthly_winners enable row level security;

--  Spisak vide svi prijavljeni; upisuje i briše samo admin.
drop policy if exists "monthly_winners_select" on public.monthly_winners;
create policy "monthly_winners_select"
  on public.monthly_winners for select
  to authenticated
  using (true);

drop policy if exists "monthly_winners_admin" on public.monthly_winners;
create policy "monthly_winners_admin"
  on public.monthly_winners for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());


-- =====================================================================
--  Gotovo. Dole treba da piše „Success. No rows returned“.
--
--  U aplikaciji:
--    · Radnici → Bedževi → Izmeni — upisuješ „Šta je potrebno“
--    · Radnici → Radnici meseca — upisuješ ko je bio radnik kog meseca
--    · Profil → Bedževi — radnici čitaju uslove i vide sve radnike meseca
-- =====================================================================
