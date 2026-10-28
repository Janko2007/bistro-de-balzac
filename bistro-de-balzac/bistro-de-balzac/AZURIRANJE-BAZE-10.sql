-- =====================================================================
--  BISTRO DE BALZAC — ažuriranje baze (bedževi i radna mesta)
--
--  Šta ovo radi:
--    · svaki radnik dobija RADNO MESTO (konobar, šanker, pomoćni…)
--    · praviš BEDŽEVE kakve hoćeš (Radnik meseca, 1 godina staža…) i dodeljuješ
--      ih radnicima
--    · svi — i radnici — vide ekran „Tim“: ko je šta i ko ima koji bedž
--
--  Kako:
--    supabase.com → tvoj projekat → SQL Editor → New query → nalepi sve →
--    Run. Može da se pokrene više puta, ništa se ne duplira.
--
--  Napomena: ovo je DODATAK na ranije skripte.
-- =====================================================================

-- ---------------------------------------------------------------------
--  1. RADNO MESTO
-- ---------------------------------------------------------------------
alter table public.profiles
  add column if not exists position text not null default '';


-- ---------------------------------------------------------------------
--  2. BEDŽEVI — spisak koji admin pravi
-- ---------------------------------------------------------------------
create table if not exists public.badges (
  id          uuid primary key default gen_random_uuid(),
  name        text    not null,
  icon        text    not null default '🏅',   -- emodži koji se vidi na bedžu
  description text    not null default '',
  sort_order  integer not null default 100,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create unique index if not exists badges_name_unique_idx on public.badges (lower(name));
create index if not exists badges_order_idx on public.badges (sort_order);

alter table public.badges enable row level security;

-- Bedževe vide svi prijavljeni; menja ih samo admin.
drop policy if exists "badges_select" on public.badges;
create policy "badges_select"
  on public.badges for select
  to authenticated
  using (true);

drop policy if exists "badges_admin" on public.badges;
create policy "badges_admin"
  on public.badges for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());


-- ---------------------------------------------------------------------
--  3. KO IMA KOJI BEDŽ
-- ---------------------------------------------------------------------
create table if not exists public.worker_badges (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  badge_id   uuid not null references public.badges (id)   on delete cascade,
  note       text not null default '',          -- npr. „septembar 2026“
  awarded_at timestamptz not null default now(),
  awarded_by uuid references public.profiles (id) on delete set null,
  primary key (profile_id, badge_id)
);

create index if not exists worker_badges_badge_idx on public.worker_badges (badge_id);

alter table public.worker_badges enable row level security;

drop policy if exists "worker_badges_select" on public.worker_badges;
create policy "worker_badges_select"
  on public.worker_badges for select
  to authenticated
  using (true);

drop policy if exists "worker_badges_admin" on public.worker_badges;
create policy "worker_badges_admin"
  on public.worker_badges for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());


-- ---------------------------------------------------------------------
--  4. RADNIK NE MENJA SEBI RADNO MESTO
-- ---------------------------------------------------------------------
create or replace function public.guard_profile_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    new.role           := old.role;
    new.is_active      := old.is_active;
    new.is_deleted     := old.is_deleted;
    new.daily_wage     := old.daily_wage;
    new.pay_model      := old.pay_model;
    new.monthly_salary := old.monthly_salary;
    new.percent        := old.percent;
    new.sort_order     := old.sort_order;
    new.position       := old.position;
    new.full_name      := old.full_name;   -- po imenu se prijavljuje
    new.email          := old.email;

    -- Slika profila sme da pokazuje samo na fajl u SVOM folderu.
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


-- ---------------------------------------------------------------------
--  5. NEKOLIKO BEDŽEVA ZA POČETAK
-- ---------------------------------------------------------------------
--  Slobodno ih preimenuj, obriši ili dodaj svoje: Radnici → Bedževi.
insert into public.badges (name, icon, description, sort_order)
values
  ('Radnik meseca',  '🏆', 'Najbolji u mesecu',                 10),
  ('Godina dana',    '⭐', 'Godinu dana u lokalu',              20),
  ('Tri godine',     '🌟', 'Tri godine u lokalu',               30),
  ('Pet godina',     '💎', 'Pet godina u lokalu',               40),
  ('Bez greške',     '🎯', 'Mesec dana bez greške u popisu',    50),
  ('Uvek na vreme',  '⏰', 'Nijedno kašnjenje u mesecu',        60)
on conflict do nothing;


-- =====================================================================
--  Gotovo. Dole treba da piše „Success. No rows returned“.
--
--  U aplikaciji:
--    · Radnici → Bedževi — praviš i menjaš spisak bedževa
--    · Radnici → kod radnika „Bedževi“ — dodeljuješ mu ih
--    · Radnici → Izmeni — upisuješ radno mesto
--    · Tim (u donjoj traci) — spisak koji vide i radnici
-- =====================================================================
