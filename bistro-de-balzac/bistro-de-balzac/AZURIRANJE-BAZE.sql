-- =====================================================================
--  Ažuriranje baze — pokreni jednom u Supabase SQL Editoru (Run).
--  Bezbedno je pokrenuti i više puta.
-- =====================================================================

-- Korpa: obrisani popisi se čuvaju 12 sati i mogu da se vrate
create table if not exists public.report_trash (
  id          uuid primary key,                 -- isti id koji je popis imao
  report_date date not null,
  shift       public.shift_type not null,
  data        jsonb not null,                   -- ceo popis: report, items, staff, images
  deleted_by  uuid references public.profiles (id) on delete set null,
  deleted_at  timestamptz not null default now()
);

alter table public.report_trash enable row level security;

drop policy if exists "trash_admin" on public.report_trash;
create policy "trash_admin"
  on public.report_trash for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Obriši popis → u korpu.
create or replace function public.trash_report(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.shift_reports;
begin
  if not public.is_admin() then
    raise exception 'Samo vlasnik može da briše popise.';
  end if;

  select * into v_row from public.shift_reports where id = p_id;
  if not found then
    raise exception 'Popis nije pronađen.';
  end if;

  insert into public.report_trash (id, report_date, shift, data, deleted_by)
  values (
    v_row.id, v_row.report_date, v_row.shift,
    jsonb_build_object(
      'report', to_jsonb(v_row),
      'items',  coalesce((select jsonb_agg(to_jsonb(i)) from public.shift_report_items i where i.report_id = p_id), '[]'::jsonb),
      'staff',  coalesce((select jsonb_agg(to_jsonb(s)) from public.shift_report_staff s where s.report_id = p_id), '[]'::jsonb),
      'images', coalesce((select jsonb_agg(to_jsonb(m)) from public.report_images m where m.report_id = p_id), '[]'::jsonb)
    ),
    auth.uid()
  )
  on conflict (id) do update
    set data = excluded.data, deleted_at = now(), deleted_by = excluded.deleted_by;

  -- Stavke, radnici i slike idu kaskadno. Fajlovi slika OSTAJU u storage-u
  -- dok se korpa ne isprazni — da bi vraćanje bilo potpuno.
  delete from public.shift_reports where id = p_id;
end;
$$;

-- Vrati popis iz korpe (samo u prvih 12 sati).
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
    raise exception 'Samo vlasnik može da vraća popise.';
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

  -- total_amount, qty_new i qty_sold računa baza — ne upisuju se.
  insert into public.shift_reports (
    id, report_date, shift, created_by, cash_amount, card_amount, note, daily_task_done,
    status, verified_by, verified_at, admin_note, admin_note_by, admin_note_at,
    created_at, updated_at
  ) values (
    r.id, r.report_date, r.shift, r.created_by, r.cash_amount, r.card_amount, r.note,
    r.daily_task_done, r.status, r.verified_by, r.verified_at, r.admin_note,
    r.admin_note_by, r.admin_note_at, r.created_at, r.updated_at
  );

  insert into public.shift_report_staff (report_id, profile_id)
  select s.report_id, s.profile_id
  from jsonb_populate_recordset(null::public.shift_report_staff, v_t.data -> 'staff') s
  where exists (select 1 from public.profiles p where p.id = s.profile_id);

  insert into public.shift_report_items (
    id, report_id, item_id, item_name, unit, category, qty_start, qty_added, qty_end, note
  )
  select i.id, i.report_id, i.item_id, i.item_name, i.unit, i.category,
         i.qty_start, i.qty_added, i.qty_end, i.note
  from jsonb_populate_recordset(null::public.shift_report_items, v_t.data -> 'items') i
  where exists (select 1 from public.items it where it.id = i.item_id);

  insert into public.report_images (id, report_id, storage_path, uploaded_by, created_at)
  select m.id, m.report_id, m.storage_path, m.uploaded_by, m.created_at
  from jsonb_populate_recordset(null::public.report_images, v_t.data -> 'images') m;

  delete from public.report_trash where id = p_id;
  return r.id;
end;
$$;

-- Isprazni ono što je u korpi duže od 12 sati. Vraća putanje slika da ih
-- aplikacija obriše i iz storage-a.
create or replace function public.purge_report_trash()
returns setof text
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    return;
  end if;

  return query
  with gone as (
    delete from public.report_trash
    where deleted_at < now() - interval '12 hours'
    returning data
  )
  select img ->> 'storage_path'
  from gone, jsonb_array_elements(gone.data -> 'images') img;
end;
$$;

grant execute on function public.trash_report(uuid)   to authenticated;
grant execute on function public.restore_report(uuid) to authenticated;
grant execute on function public.purge_report_trash() to authenticated;

-- Provera: treba da vidiš 3 reda
select proname from pg_proc where proname in ('trash_report', 'restore_report', 'purge_report_trash');