-- =====================================================================
--  BISTRO DE BALZAC — ažuriranje baze (način popisa po artiklu)
--
--  Šta ovo radi:
--    Do sada su postojala dva načina popisa — zalihe i brojač. Sada ih ima
--    tri, i biraš ga za svaki artikal: Artikli → Izmeni → „Način popisa“.
--
--      zalihe   upisuje se PRODATO    krajnje = (početno + dodato) − prodato
--      brojač   upisuje se PRODATO    krajnje = početno + prodato
--      krajnje  upisuje se KRAJNJE    prodato = (početno + dodato) − krajnje
--
--    Treći je za voće i slično, gde je lakše prebrojati šta je ostalo nego
--    pamtiti koliko je potrošeno.
--
--    Artikli koji su do sada bili brojač ostaju brojač — ništa ne treba da
--    podešavaš ponovo.
--
--  Kako:
--    supabase.com → tvoj projekat → SQL Editor → New query → nalepi sve →
--    Run. Može da se pokrene više puta, ništa se ne duplira.
--
--  Napomena: ovo je DODATAK na skripte -2 do -7.
-- =====================================================================

-- 1) Nova kolona na artiklu i snimak na stavci popisa
alter table public.items
  add column if not exists count_mode text not null default 'zalihe';

alter table public.shift_report_items
  add column if not exists count_mode text not null default 'zalihe';

do $$
begin
  alter table public.items add constraint items_count_mode_check
    check (count_mode in ('zalihe', 'brojac', 'krajnje'));
exception when duplicate_object then null;
end $$;


-- 2) Postojeći brojači ostaju brojači
update public.items
   set count_mode = 'brojac'
 where is_counter and count_mode = 'zalihe';

update public.shift_report_items
   set count_mode = 'brojac'
 where is_counter and count_mode = 'zalihe';


-- =====================================================================
--  Gotovo. Dole treba da piše „Success. No rows returned“.
--  U aplikaciji: Artikli → Izmeni kod voća → Način popisa → „Krajnje stanje“.
-- =====================================================================
