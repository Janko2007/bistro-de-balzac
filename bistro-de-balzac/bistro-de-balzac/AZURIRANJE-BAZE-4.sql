-- =====================================================================
--  BISTRO DE BALZAC — ažuriranje baze
--    1) umanjena dnevnica za jedan dan
--    2) popravka brisanja uplate pazara
--
--  Šta ovo radi:
--    Na svakom izveštaju možeš pojedinom radniku da UMANJIŠ dnevnicu baš
--    za taj dan — npr. ako je došao kasnije ili odradio pola smene.
--
--    Uz to popravlja i brisanje uplate u Uplatama: u starijim bazama je
--    brisanje padalo jer dani koje je uplata pokrivala nisu nestajali s njom.
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


-- 3) Brisanje uplate pazara
--    Kad se obriše uplata, moraju da nestanu i dani koje je pokrivala — inače
--    baza odbije brisanje, pa dugme „Obriši“ u Uplatama ne radi. U starijim
--    bazama ta veza nije bila postavljena, zato se ovde popravlja.
alter table public.cash_deposit_days
  drop constraint if exists cash_deposit_days_deposit_id_fkey;

alter table public.cash_deposit_days
  add constraint cash_deposit_days_deposit_id_fkey
    foreign key (deposit_id) references public.cash_deposits (id) on delete cascade;

--    Uplate su isključivo adminova stvar — i upis i brisanje.
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


-- =====================================================================
--  Gotovo. Dole treba da piše „Success. No rows returned“.
--  U aplikaciji: otvori izveštaj → „U smeni radili“ → Umanji.
-- =====================================================================
