-- =====================================================================
--  BISTRO DE BALZAC — ažuriranje baze (početno stanje prati prethodnu smenu)
--
--  Šta ovo radi:
--    · aplikacija može u svakom trenutku da pita „koje je krajnje stanje
--      PRETHODNE smene“ za svaki artikal
--    · zato početno stanje u drugoj smeni uvek ima onaj broj koji je prva
--      smena na kraju upisala — i kad ga upiše tek pri predaji
--
--  Prethodna smena je ona koja je pre ove po redu: ranije po datumu, a istog
--  dana prva → međusmena → druga. Uzima se poslednje upisano krajnje stanje.
--
--  Kako:
--    supabase.com → tvoj projekat → SQL Editor → New query → nalepi sve →
--    Run. Može da se pokrene više puta.
-- =====================================================================

create or replace function public.previous_item_end(p_report_id uuid)
returns table (item_id uuid, qty_end numeric)
language sql
stable
security definer
set search_path = public
as $$
  with cur as (
    select
      r.report_date,
      r.created_at,
      case r.shift when 'prva' then 1 when 'medjusmena' then 2 else 3 end as rnk
    from public.shift_reports r
    where r.id = p_report_id
  )
  select distinct on (si.item_id)
         si.item_id,
         si.qty_end
    from public.shift_report_items si
    join public.shift_reports r on r.id = si.report_id
    cross join cur
   where auth.uid() is not null
     and r.id <> p_report_id
     and si.qty_end is not null
     and (
           r.report_date,
           case r.shift when 'prva' then 1 when 'medjusmena' then 2 else 3 end,
           r.created_at
         ) < (cur.report_date, cur.rnk, cur.created_at)
   order by si.item_id,
            r.report_date desc,
            case r.shift when 'prva' then 1 when 'medjusmena' then 2 else 3 end desc,
            r.created_at desc;
$$;

revoke all on function public.previous_item_end(uuid) from public;
grant execute on function public.previous_item_end(uuid) to authenticated;


-- =====================================================================
--  Gotovo. Dole treba da piše „Success. No rows returned“.
-- =====================================================================
