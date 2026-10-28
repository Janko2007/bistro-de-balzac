-- =====================================================================
--  BISTRO DE BALZAC — ažuriranje baze (radno iskustvo u profilu)
--
--  Šta ovo radi:
--    · radnik u svom profilu sam upisuje opis radnog iskustva
--    · to vide SAMO on i admin — baza ne daje ostalim radnicima pristup,
--      pa ne mogu da ga pročitaju ni na zaobilazan način
--
--  Kako:
--    supabase.com → tvoj projekat → SQL Editor → New query → nalepi sve →
--    Run. Može da se pokrene više puta, ništa se ne duplira.
--
--  Napomena: broj telefona ne traži izmenu u bazi — radnik već sme da
--  menja svoj. (Telefon vide svi prijavljeni, kao i do sada.)
-- =====================================================================

create table if not exists public.profile_details (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  experience text not null default '',
  updated_at timestamptz not null default now(),
  constraint profile_details_experience_len check (char_length(experience) <= 1500)
);

alter table public.profile_details enable row level security;

--  Čita ga radnik za sebe i admin za sve.
drop policy if exists "profile_details_select" on public.profile_details;
create policy "profile_details_select"
  on public.profile_details for select
  to authenticated
  using (profile_id = auth.uid() or public.is_admin());

--  Upisuje ga radnik za sebe i admin za sve.
drop policy if exists "profile_details_insert" on public.profile_details;
create policy "profile_details_insert"
  on public.profile_details for insert
  to authenticated
  with check (profile_id = auth.uid() or public.is_admin());

drop policy if exists "profile_details_update" on public.profile_details;
create policy "profile_details_update"
  on public.profile_details for update
  to authenticated
  using (profile_id = auth.uid() or public.is_admin())
  with check (profile_id = auth.uid() or public.is_admin());

drop policy if exists "profile_details_delete" on public.profile_details;
create policy "profile_details_delete"
  on public.profile_details for delete
  to authenticated
  using (public.is_admin());


-- =====================================================================
--  Gotovo. Dole treba da piše „Success. No rows returned“.
--
--  U aplikaciji:
--    · Profil → „Moji podaci“ — radnik upisuje telefon i radno iskustvo
--    · Radnici — admin vidi oba kod svakog radnika
-- =====================================================================
