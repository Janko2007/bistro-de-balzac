-- =====================================================================
--  BISTRO DE BALZAC — ažuriranje baze (međusmena)
--
--  Šta ovo radi:
--    · u međusmenu može da uđe SAMO JEDAN radnik
--    · taj radnik u svojoj međusmeni vidi ceo popis prve i druge smene
--      tog dana — bez prijavljivanja u njih
--    · dnevnica ostaje jedna po danu (to je već tako i ostaje)
--
--  Kako:
--    supabase.com → tvoj projekat → SQL Editor → New query → nalepi sve →
--    Run. Može da se pokrene više puta, ništa se ne duplira.
--
--  Napomena: ovo je DODATAK na skripte 9, 10 i 11.
-- =====================================================================

-- ---------------------------------------------------------------------
--  1. U MEĐUSMENU ULAZI SAMO JEDAN RADNIK
-- ---------------------------------------------------------------------
create or replace function public.open_or_join_shift(p_date date, p_shift public.shift_type)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id     uuid;
  v_status public.report_status;
  v_zauzeo text;
begin
  if auth.uid() is null then
    raise exception 'Niste prijavljeni.';
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_active and not p.is_deleted
  ) then
    raise exception 'Nalog nije aktivan.';
  end if;

  select id, status into v_id, v_status
  from public.shift_reports
  where report_date = p_date and shift = p_shift;

  if v_id is null then
    begin
      -- I status se mora zapamtiti — bez njega bi nova smena ispod izgledala
      -- kao „već zatvorena“ i otvaranje bi se poništilo.
      insert into public.shift_reports (report_date, shift, created_by, status)
      values (p_date, p_shift, auth.uid(), 'otvoren')
      returning id, status into v_id, v_status;
    exception when unique_violation then
      -- Dvoje su kliknuli u istoj sekundi: uzmi onaj koji je upravo nastao.
      select id, status into v_id, v_status
      from public.shift_reports
      where report_date = p_date and shift = p_shift;
    end;
  end if;

  if v_status = 'potvrdjen' then
    raise exception 'Smena je već potvrđena i ne može da se menja.';
  end if;

  --  Međusmenu radi jedan čovek. Ako je neko već unutra, drugi ne ulazi —
  --  on ide u prvu ili u drugu smenu.
  if p_shift = 'medjusmena' then
    select p.full_name into v_zauzeo
    from public.shift_report_staff s
    join public.profiles p on p.id = s.profile_id
    where s.report_id = v_id and s.profile_id <> auth.uid()
    limit 1;

    if v_zauzeo is not null then
      raise exception 'Međusmenu već radi %. U međusmenu ulazi samo jedan radnik.', v_zauzeo;
    end if;
  end if;

  if v_status = 'otvoren' then
    -- Smena traje: ko uđe, taj je radio i dobija dnevnicu.
    insert into public.shift_report_staff (report_id, profile_id)
    values (v_id, auth.uid())
    on conflict do nothing;

  elsif not exists (
    select 1 from public.shift_report_staff
    where report_id = v_id and profile_id = auth.uid()
  ) then
    -- Smena je već zatvorena, a ovaj u njoj nije radio — ne upisuje se.
    raise exception 'Smena je već zatvorena.';
  end if;

  return v_id;
end;
$$;


-- ---------------------------------------------------------------------
--  2. MEĐUSMENA VIDI PRVU I DRUGU SMENU
-- ---------------------------------------------------------------------
--  Međusmena hvata kraj prve i početak druge smene, pa taj radnik mora da
--  vidi šta je u njima upisano. Po običnim pravilima ne bi video tuđu
--  smenu, zato ovo radi serverskim pravima — ali SAMO za onoga ko tog dana
--  stvarno radi međusmenu (i za admina), i samo za čitanje.
create or replace function public.midshift_view(p_date date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ok boolean;
begin
  if auth.uid() is null then
    raise exception 'Niste prijavljeni.';
  end if;

  select public.is_admin() or exists (
    select 1
    from public.shift_reports r
    join public.shift_report_staff s on s.report_id = r.id
    where r.report_date = p_date
      and r.shift = 'medjusmena'
      and s.profile_id = auth.uid()
  ) into v_ok;

  if not v_ok then
    return '[]'::jsonb;
  end if;

  return coalesce(
    (
      select jsonb_agg(x order by x ->> 'shift')
      from (
        select jsonb_build_object(
                 'shift',  r.shift,
                 'status', r.status,
                 'cash',   r.cash_amount,
                 'card',   r.card_amount,
                 'note',   r.note,
                 'staff',  coalesce(
                   array_to_json(array(
                     select p.full_name
                     from public.shift_report_staff s
                     join public.profiles p on p.id = s.profile_id
                     where s.report_id = r.id
                     order by p.full_name
                   ))::jsonb,
                   '[]'::jsonb
                 ),
                 'items',  coalesce(
                   (
                     select jsonb_agg(
                              jsonb_build_object(
                                'item_id',   i.item_id,
                                'name',      i.item_name,
                                'category',  i.category,
                                'unit',      i.unit,
                                'qty_start', i.qty_start,
                                'qty_added', i.qty_added,
                                'qty_sold',  i.qty_sold,
                                'qty_end',   i.qty_end
                              )
                              order by i.category, i.item_name
                            )
                     from public.shift_report_items i
                     where i.report_id = r.id
                   ),
                   '[]'::jsonb
                 )
               ) as x
        from public.shift_reports r
        where r.report_date = p_date
          and r.shift in ('prva', 'druga')
      ) t
    ),
    '[]'::jsonb
  );
end;
$$;

revoke all on function public.midshift_view(date) from public;
grant execute on function public.midshift_view(date) to authenticated;


-- =====================================================================
--  Gotovo. Dole treba da piše „Success. No rows returned“.
--
--  U aplikaciji:
--    · ako neko već radi međusmenu, drugom piše ko je unutra i ne pušta ga
--    · u međusmeni se ispod popisa otvara „Prva smena“ i „Druga smena“ —
--      samo za gledanje, ne može da se menja
-- =====================================================================
