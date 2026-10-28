-- =====================================================================
--  BISTRO DE BALZAC — ažuriranje baze (skrivanje grupa artikala)
--
--  Šta ovo radi:
--    Do sada si mogao da isključiš pojedinačan artikal. Sada možeš i celu
--    grupu — npr. dok ne stigne nova tura rakija, sakriješ „RAKIJA“ i radnici
--    je uopšte ne vide u popisu.
--
--    Sakrivena grupa ostaje u bazi sa svim artiklima; vrati je jednim klikom.
--    Stari izveštaji se ne diraju.
--
--  Kako:
--    supabase.com → tvoj projekat → SQL Editor → New query → nalepi sve →
--    Run. Može da se pokrene više puta, ništa se ne duplira.
--
--  Napomena: ovo je DODATAK na skripte -2 do -6.
-- =====================================================================

alter table public.categories
  add column if not exists is_active boolean not null default true;


-- =====================================================================
--  Gotovo. Dole treba da piše „Success. No rows returned“.
--  U aplikaciji: Artikli → Kategorije → oko pored grupe je sakriva.
-- =====================================================================
