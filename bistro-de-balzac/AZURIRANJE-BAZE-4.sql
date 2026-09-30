-- =====================================================================
--  BISTRO DE BALZAC — ažuriranje baze (umanjena dnevnica za jedan dan)
--
--  Šta ovo radi:
--    Na svakom izveštaju možeš pojedinom radniku da UMANJIŠ dnevnicu baš
--    za taj dan — npr. ako je došao kasnije ili odradio pola smene.
--
--    Upisani iznos zamenjuje njegovu redovnu dnevnicu SAMO za taj dan.
--    Prazno polje znači „puna dnevnica“, kao i do sada.
--
--    Ako je tog dana bio u dve smene (međusmena), dan se i dalje računa
--    kao JEDNA dnevnica — uzima se najmanji upisani iznos.
--
--  Kako:
--    supabase.com → tvoj projekat → SQL Editor → New query → nalepi sve →
--    Run. Može da se pokrene više puta, ništa se ne duplira.
--
--  Napomena: ovo je DODATAK na AZURIRANJE-BAZE-2.sql i -3.sql. Ako ih još
--  nisi pokrenuo, pokreni prvo njih, pa ovo.
-- =====================================================================

-- 1) Nova kolona: umanjena dnevnica za taj izveštaj (NULL = puna dnevnica)
alter table public.shift_report_staff
  add column if not exists wage_override numeric(10,2);

do $$
begin
  alter table public.shift_report_staff add constraint shift_report_staff_wage_check
    check (wage_override is null or wage_override >= 0);
exception when duplicate_object then null;
end $$;


-- 2) Iznos menja SAMO admin
--    Radnik sme da uđe u smenu i da izađe iz nje (to su insert i delete
--    politike), ali ne sme da dira iznos — zato posebna politika za update.
drop policy if exists "staff_update" on public.shift_report_staff;
create policy "staff_update"
  on public.shift_report_staff for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());


-- =====================================================================
--  Gotovo. Dole treba da piše „Success. No rows returned“.
--  U aplikaciji: otvori izveštaj → „U smeni radili“ → Umanji.
-- =====================================================================
