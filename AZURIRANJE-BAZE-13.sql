-- =====================================================================
--  BISTRO DE BALZAC — ažuriranje baze (radna mesta)
--
--  Šta ovo radi:
--    · pravi spisak radnih mesta koji ti sam dopunjuješ
--    · za početak: Konobar, Šanker, Menadžer
--    · jedan radnik može da ima više radnih mesta (npr. Konobar i Šanker)
--
--  Kako:
--    supabase.com → tvoj projekat → SQL Editor → New query → nalepi sve →
--    Run. Može da se pokrene više puta, ništa se ne duplira.
--
--  Napomena: ovo je DODATAK na skripte 10, 11 i 12.
-- =====================================================================

-- ---------------------------------------------------------------------
--  1. SPISAK RADNIH MESTA
-- ---------------------------------------------------------------------
create table if not exists public.positions (
  id         uuid primary key default gen_random_uuid(),
  name       text    not null,
  sort_order integer not null default 100,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index if not exists positions_name_unique_idx on public.positions (lower(name));
create index if not exists positions_order_idx on public.positions (sort_order);

alter table public.positions enable row level security;

--  Spisak vide svi prijavljeni; menja ga samo admin.
drop policy if exists "positions_select" on public.positions;
create policy "positions_select"
  on public.positions for select
  to authenticated
  using (true);

drop policy if exists "positions_admin" on public.positions;
create policy "positions_admin"
  on public.positions for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());


-- ---------------------------------------------------------------------
--  2. TRI ZA POČETAK
-- ---------------------------------------------------------------------
--  Nova dodaješ u aplikaciji: Radnici → Izmeni → Radno mesto → „+ Novo“.
insert into public.positions (name, sort_order)
values
  ('Konobar', 10),
  ('Šanker',  20),
  ('Menadžer', 30)
on conflict do nothing;


-- ---------------------------------------------------------------------
--  3. ŠTA JE VEĆ UPISANO OSTAJE
-- ---------------------------------------------------------------------
--  Kod radnika se radna mesta i dalje čuvaju u koloni `position`. Kad ih
--  ima više, odvojena su zarezom — npr. „Konobar, Šanker“.
--  Ako je nekome ranije upisano radno mesto kog nema u spisku, ovde se
--  dodaje, da ne nestane iz ponude.
insert into public.positions (name, sort_order)
select distinct btrim(p.position), 100
  from public.profiles p
 where btrim(coalesce(p.position, '')) <> ''
   and p.position not like '%,%'
   and not exists (
     select 1 from public.positions q
      where lower(q.name) = lower(btrim(p.position))
   )
on conflict do nothing;


-- =====================================================================
--  Gotovo. Dole treba da piše „Success. No rows returned“.
--
--  U aplikaciji:
--    · Radnici → Izmeni → Radno mesto — klikneš jedno ili više, a
--      dugmetom „+ Novo“ dodaješ svoje
-- =====================================================================
