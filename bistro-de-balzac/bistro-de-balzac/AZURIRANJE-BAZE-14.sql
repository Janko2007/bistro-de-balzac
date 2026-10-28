-- =====================================================================
--  BISTRO DE BALZAC — ažuriranje baze (međusmena uređuje prvu i drugu)
--
--  Šta ovo radi:
--    · ko uđe u međusmenu, automatski ulazi i u prvu i u drugu smenu tog
--      dana — čim te smene postoje i traju
--    · u njima može da uređuje popis kao i ostali koji rade u njima
--    · ako se prva ili druga smena otvori POSLE njegovog ulaska u
--      međusmenu, i u nju ulazi sam od sebe
--    · dnevnica ostaje JEDNA: računa se po danu, ne po smeni
--
--  Kako:
--    supabase.com → tvoj projekat → SQL Editor → New query → nalepi sve →
--    Run. Može da se pokrene više puta, ništa se ne duplira.
--
--  Napomena: ovo menja funkciju iz skripte 12 — pusti je POSLE nje.
-- =====================================================================

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

    --  Ko radi međusmenu, radi i prvu i drugu: ulazi u njih čim postoje.
    --  Dnevnica se ne udvostručuje — računa se jedna po danu.
    if p_shift = 'medjusmena' then
      insert into public.shift_report_staff (report_id, profile_id)
      select r.id, auth.uid()
        from public.shift_reports r
       where r.report_date = p_date
         and r.shift in ('prva', 'druga')
         and r.status = 'otvoren'
      on conflict do nothing;

    elsif p_shift in ('prva', 'druga') then
      --  Prva ili druga se otvara, a međusmena tog dana već traje:
      --  onaj ko je u međusmeni ulazi i u ovu.
      insert into public.shift_report_staff (report_id, profile_id)
      select v_id, s.profile_id
        from public.shift_reports m
        join public.shift_report_staff s on s.report_id = m.id
       where m.report_date = p_date
         and m.shift = 'medjusmena'
         and m.status = 'otvoren'
      on conflict do nothing;
    end if;

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


-- =====================================================================
--  Gotovo. Dole treba da piše „Success. No rows returned“.
--
--  U aplikaciji:
--    · u međusmeni se gore, kod izbora smene, štiklira i Prva i Druga
--      čim postoje — klikneš ih i uređuješ popis
--    · dnevnica je jedna, bez obzira u koliko smena je radnik upisan
-- =====================================================================
