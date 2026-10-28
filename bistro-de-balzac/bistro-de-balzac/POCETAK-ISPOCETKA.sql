-- =====================================================================
--  BISTRO DE BALZAC — čist početak (brisanje probnih podataka)
--
--  !!! PAŽNJA — OVO SE NE MOŽE PONIŠTITI !!!
--
--  Pokreni SAMO ako hoćeš da kreneš od nule, sa praznom istorijom.
--  Ako u aplikaciji postoji ijedan pravi popis koji ti treba — NE pokreći.
--
--  ŠTA SE BRIŠE:
--    · svi popisi smena (sa stavkama, slikama i spiskom ko je radio)
--    · korpa obrisanih popisa
--    · sve isplate i bonusi
--    · sve uplate pazara u banku
--
--  ŠTA OSTAJE:
--    · radnici i njihovi nalozi, dnevnice, plate i procenti
--    · artikli i kategorije
--    · pravila i dnevne obaveze
--
--  Slike ostaju u skladištu (Storage → izvestaji) i ne troše mnogo mesta.
--  Ako hoćeš i njih, obriši ih ručno: Supabase → Storage → izvestaji.
--
--  Kako:
--    supabase.com → tvoj projekat → SQL Editor → New query → nalepi sve →
--    Run. Dole treba da piše „Success. No rows returned“.
-- =====================================================================

-- Redosled je bitan: prvo ono što zavisi od popisa, pa popisi.
delete from public.cash_deposit_days;
delete from public.cash_deposits;

delete from public.payouts;

delete from public.report_trash;

delete from public.report_images;
delete from public.shift_report_items;
delete from public.shift_report_staff;
delete from public.shift_reports;


-- =====================================================================
--  Gotovo. U aplikaciji osveži stranicu (dvaput) — Pregled, Uplate,
--  Radnici i Prodaja po artiklima biće prazni i kreće se od nule.
-- =====================================================================
