-- =====================================================================
--  BISTRO DE BALZAC — ažuriranje baze (artikal sa brojačem, npr. espresso)
--
--  Šta ovo radi:
--    Neki artikli se ne popisuju po zalihama nego po BROJAČU na kasi ili
--    aparatu — broj samo raste. Za espresso: ako je na početku smene brojač
--    bio 5, a prodato je 5 kafa, na kraju smene piše 10.
--
--      običan artikal  →  krajnje = (početno + dodato) − prodato
--      brojač          →  krajnje = početno + prodato
--
--    Koji je artikal brojač bira se u aplikaciji: Artikli → Izmeni →
--    „Broji unapred (brojač)“.
--
--  Kako:
--    supabase.com → tvoj projekat → SQL Editor → New query → nalepi sve →
--    Run. Može da se pokrene više puta, ništa se ne duplira.
--
--  Napomena: ovo je DODATAK na AZURIRANJE-BAZE-2.sql, -3.sql i -4.sql.
--  Ako ih još nisi pokrenuo, pokreni prvo njih, pa ovo.
-- =====================================================================

-- 1) Oznaka na artiklu i na stavci popisa
--    Na stavci popisa je snimak (kao i naziv i jedinica) — da stari izveštaji
--    ostanu tačni i ako artikal kasnije prestane da bude brojač.
alter table public.items
  add column if not exists is_counter boolean not null default false;

alter table public.shift_report_items
  add column if not exists is_counter boolean not null default false;


-- 2) „Prodato“ više ne računa baza nego aplikacija
--    Do sada je baza računala prodato po jednoj jedinoj formuli
--    (početno + dodato − krajnje). Brojač ima svoju, pa prodato sada upisuje
--    aplikacija. Postojeće vrednosti se prenose netaknute — ništa se ne gubi.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'shift_report_items'
      and column_name  = 'qty_sold'
      and is_generated = 'ALWAYS'
  ) then
    alter table public.shift_report_items rename column qty_sold to qty_sold_stara;
    alter table public.shift_report_items add column qty_sold numeric(12,2);
    update public.shift_report_items set qty_sold = qty_sold_stara;
    alter table public.shift_report_items drop column qty_sold_stara;
  end if;
end $$;

--    Ako je neko pokrenuo skript na praznoj bazi, kolone možda nema uopšte.
alter table public.shift_report_items
  add column if not exists qty_sold numeric(12,2);


-- 3) Vraćanje popisa iz korpe mora da ponese i prodato i oznaku brojača
create or replace function public.restore_report(p_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_t public.report_trash;
  r   public.shift_reports;
begin
  if not public.is_admin() then
    raise exception 'Samo admin može da vraća popise.';
  end if;

  select * into v_t from public.report_trash where id = p_id;
  if not found or v_t.deleted_at < now() - interval '12 hours' then
    raise exception 'Ovaj popis više ne može da se vrati — prošlo je 12 sati.';
  end if;

  if exists (
    select 1 from public.shift_reports
    where report_date = v_t.report_date and shift = v_t.shift
  ) then
    raise exception 'Za taj dan i smenu u međuvremenu je otvoren novi popis — prvo njega obriši.';
  end if;

  r := jsonb_populate_record(null::public.shift_reports, v_t.data -> 'report');

  -- total_amount i qty_new računa baza — ne upisuju se.
  insert into public.shift_reports (
    id, report_date, shift, created_by, cash_amount, card_amount, note, daily_task_done,
    status, verified_by, verified_at, admin_note, admin_note_by, admin_note_at,
    created_at, updated_at
  ) values (
    r.id, r.report_date, r.shift, r.created_by, r.cash_amount, r.card_amount, r.note,
    r.daily_task_done, r.status, r.verified_by, r.verified_at, r.admin_note,
    r.admin_note_by, r.admin_note_at, r.created_at, r.updated_at
  );

  insert into public.shift_report_staff (report_id, profile_id, wage_override)
  select s.report_id, s.profile_id, s.wage_override
  from jsonb_populate_recordset(null::public.shift_report_staff, v_t.data -> 'staff') s
  where exists (select 1 from public.profiles p where p.id = s.profile_id);

  insert into public.shift_report_items (
    id, report_id, item_id, item_name, unit, category,
    qty_start, qty_added, qty_end, qty_sold, is_counter, note
  )
  select i.id, i.report_id, i.item_id, i.item_name, i.unit, i.category,
         i.qty_start, i.qty_added, i.qty_end, i.qty_sold,
         coalesce(i.is_counter, false), i.note
  from jsonb_populate_recordset(null::public.shift_report_items, v_t.data -> 'items') i
  where exists (select 1 from public.items it where it.id = i.item_id);

  insert into public.report_images (id, report_id, storage_path, uploaded_by, created_at)
  select m.id, m.report_id, m.storage_path, m.uploaded_by, m.created_at
  from jsonb_populate_recordset(null::public.report_images, v_t.data -> 'images') m;

  delete from public.report_trash where id = p_id;
  return r.id;
end;
$$;


-- =====================================================================
--  Gotovo. Dole treba da piše „Success. No rows returned“.
--  U aplikaciji: Artikli → Izmeni kod espressa → uključi „Broji unapred“.
-- =====================================================================
