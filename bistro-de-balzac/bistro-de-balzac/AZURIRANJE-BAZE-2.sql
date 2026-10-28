-- =====================================================================
--  BISTRO DE BALZAC — ažuriranje baze (verzija sa štampom izveštaja)
--
--  Šta ovo radi:
--    1. Prijava radi i kad vlasnik preimenuje radnika.
--    2. Nalog otvoren spolja ne može sam sebi da dodeli ulogu vlasnika.
--    3. Radnik ne može sebi da menja ime, mejl, dnevnicu ni ulogu.
--    4. Ispravke na VRAĆENOM popisu se konačno čuvaju, a radnik i dalje ne
--       može da menja datum, smenu, potvrdu ni poruku vlasnika.
--    5. Slika vraćenog popisa može da se obriše i kad je poslao kolega.
--
--  Kako:
--    supabase.com → tvoj projekat → SQL Editor → New query → nalepi sve →
--    Run. Može da se pokrene više puta, ništa se ne duplira.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. PRIJAVA PO IMENU
--    Radnik kuca „Marko Marković“, a Supabase traži mejl. Ranije se mejl
--    računao iz imena, pa bi radnik posle preimenovanja ostao zaključan.
--    Sada se traži u bazi — i posle promene imena prijava radi.
--    Vraća SAMO mejl radnika (nikad vlasnikov) i samo za aktivan nalog.
-- ---------------------------------------------------------------------
create or replace function public.login_email(p_name text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select p.email
  from public.profiles p
  where lower(p.full_name) = lower(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'))
    and p.role = 'radnik'
    and not p.is_deleted
    and p.email is not null
  order by p.is_active desc
  limit 1;
$$;

revoke execute on function public.login_email(text) from public;
grant execute on function public.login_email(text) to anon, authenticated;


-- ---------------------------------------------------------------------
-- 2. NOVI NALOG JE UVEK „RADNIK“
--    Uloga se ranije čitala iz podataka koje pošalje onaj ko otvara nalog,
--    pa je neko spolja mogao sam sebi da otvori nalog vlasnika. Ulogu sada
--    dodeljuje samo vlasnik (ekran Radnici).
-- ---------------------------------------------------------------------
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
    coalesce(
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'Novi radnik'
    ),
    'radnik'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;


-- ---------------------------------------------------------------------
-- 3. ŠTA RADNIK SME DA MENJA NA SVOM PROFILU
--    Sliku — da. Ime, mejl, dnevnicu, ulogu i aktivnost — ne.
-- ---------------------------------------------------------------------
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
    new.daily_wage := old.daily_wage;
    new.full_name  := old.full_name;   -- po imenu se prijavljuje
    new.email      := old.email;

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
-- 4. ŠTA RADNIK SME DA MENJA NA POPISU
--    Pazar, kartice, napomenu, stavke i dnevnu obavezu — da.
--    Datum, smenu, potvrdu i poruku vlasnika — ne.
--    Status sme samo da postavi na „poslat“ (zatvori smenu ili pošalje
--    ispravku); potvrđuje i vraća samo vlasnik.
-- ---------------------------------------------------------------------
create or replace function public.guard_report_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    new.id            := old.id;
    new.report_date   := old.report_date;
    new.shift         := old.shift;
    new.created_by    := old.created_by;
    new.created_at    := old.created_at;
    new.verified_by   := old.verified_by;
    new.verified_at   := old.verified_at;
    new.admin_note    := old.admin_note;
    new.admin_note_by := old.admin_note_by;
    new.admin_note_at := old.admin_note_at;

    if new.status is distinct from old.status and new.status <> 'poslat' then
      new.status := old.status;
    end if;
  end if;
  return new;
end;
$$;

-- Okidači idu po abecedi — „guard“ radi pre „stamp“ i pre „touch“.
drop trigger if exists shift_reports_guard_update on public.shift_reports;
create trigger shift_reports_guard_update
  before update on public.shift_reports
  for each row execute function public.guard_report_update();


-- ---------------------------------------------------------------------
-- 5. PRAVILA PRISTUPA
-- ---------------------------------------------------------------------

-- Radnik otvara smenu samo kao „otvoren“.
drop policy if exists "reports_insert_self" on public.shift_reports;
create policy "reports_insert_self"
  on public.shift_reports for insert
  to authenticated
  with check (
    created_by = auth.uid()
    and status = 'otvoren'
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_active)
  );

-- VAŽNO: bez „vracen“ u proveri ispod, ispravke na vraćenom popisu se
-- tiho ne bi sačuvale — radnik bi kucao, a ništa se ne bi upisalo.
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
    or (public.report_is_editable(id) and status in ('otvoren', 'vracen', 'poslat'))
  );

-- Iz smene se izlazi samo dok traje — iz vraćenog popisa ne, jer se posle
-- ne bi moglo nazad, a izgubila bi se dnevnica.
drop policy if exists "staff_delete" on public.shift_report_staff;
create policy "staff_delete"
  on public.shift_report_staff for delete
  to authenticated
  using (
    public.is_admin()
    or (
      profile_id = auth.uid()
      and exists (
        select 1 from public.shift_reports r
        where r.id = report_id and r.status = 'otvoren'
      )
    )
  );

-- Sliku popisa može da obriše i kolega iz iste smene dok se popis menja
-- (putanja je <id popisa>/…) — inače bi fajl zauvek ostao u storage-u.
drop policy if exists "izvestaji_delete_owner_or_admin" on storage.objects;
create policy "izvestaji_delete_owner_or_admin"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'izvestaji'
    and (
      owner = auth.uid()
      or public.is_admin()
      or (
        (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        and public.report_is_editable(((storage.foldername(name))[1])::uuid)
      )
    )
  );

-- Ko još nije prijavljen, ne treba da može da pita da li smena postoji.
revoke execute on function public.peek_shift(date, public.shift_type) from public, anon;
grant  execute on function public.peek_shift(date, public.shift_type) to authenticated;


-- ---------------------------------------------------------------------
-- 6. PREGLED — spisak svih koji su radili smenu
--    Koristi se za filtriranje i izveštaje; pogled se pravi iznova.
-- ---------------------------------------------------------------------
drop view if exists public.report_summary;

create view public.report_summary
with (security_invoker = true)
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
  (select count(*) from public.report_images i where i.report_id = r.id)        as image_count,
  (select count(*) from public.shift_report_items si where si.report_id = r.id) as item_count,
  array(select s.profile_id from public.shift_report_staff s where s.report_id = r.id) as staff_ids
from public.shift_reports r
join public.profiles p on p.id = r.created_by;

grant select on public.report_summary to authenticated;


-- =====================================================================
--  Gotovo. Dole treba da piše „Success. No rows returned“.
-- =====================================================================
