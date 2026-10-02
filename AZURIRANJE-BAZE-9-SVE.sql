-- =====================================================================
--  BISTRO DE BALZAC — SVA AŽURIRANJA OD „STRELICA“ NAOVAMO, U JEDNOM
--
--  Ovo je skripta -6, -7 i -8 spojene u jednu, plus ispravka starih popisa.
--  Ako si neku od njih već pokretao, nema veze — sve može više puta, ništa
--  se ne duplira i ništa se ne briše.
--
--  Šta donosi:
--    1. redosled radnika (strelice ▲▼ na ekranu Radnici)
--    2. popis UŽIVO — izmene se odmah vide svima u smeni
--    3. skrivanje cele grupe artikala (Artikli → Kategorije → Sakrij)
--    4. način popisa po artiklu: zalihe / brojač / krajnje stanje
--    5. ispravku svih dosadašnjih popisa: gde prodato nije upisano,
--       upisuje se 0, a krajnje stanje postaje novo (početno + dodato)
--
--  Kako:
--    supabase.com → tvoj projekat → SQL Editor → New query → nalepi sve →
--    Run. Dole treba da piše „Success. No rows returned“.
-- =====================================================================


-- ---------------------------------------------------------------------
--  1. REDOSLED RADNIKA
-- ---------------------------------------------------------------------
--  Podrazumevana vrednost je namerno velika (1000) — novootvoren nalog ide
--  na KRAJ spiska, pa ga odatle strelicama podižeš gde treba.
alter table public.profiles
  add column if not exists sort_order integer not null default 1000;

alter table public.profiles alter column sort_order set default 1000;

create index if not exists profiles_sort_idx on public.profiles (sort_order, full_name);

--  Prvi put: poređaj postojeće po abecedi, sa razmakom od 10. Radi se samo
--  ako nijedan još nije ređan, da se tvoj redosled ne pregazi.
do $$
begin
  if not exists (
    select 1 from public.profiles where sort_order not in (100, 1000)
  ) then
    with numerisani as (
      select id, row_number() over (order by full_name) * 10 as red
      from public.profiles
      where not is_deleted
    )
    update public.profiles p
       set sort_order = n.red
      from numerisani n
     where n.id = p.id;
  end if;
end $$;


-- ---------------------------------------------------------------------
--  2. RADNIK NE MENJA SEBI ZARADU, ULOGU NI REDOSLED
-- ---------------------------------------------------------------------
create or replace function public.guard_profile_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    new.role           := old.role;
    new.is_active      := old.is_active;
    new.is_deleted     := old.is_deleted;
    new.daily_wage     := old.daily_wage;
    new.pay_model      := old.pay_model;
    new.monthly_salary := old.monthly_salary;
    new.percent        := old.percent;
    new.sort_order     := old.sort_order;
    new.full_name      := old.full_name;   -- po imenu se prijavljuje
    new.email          := old.email;

    -- Slika profila sme da pokazuje samo na fajl u SVOM folderu.
    if new.avatar_path is not null
       and split_part(new.avatar_path, '/', 1) <> auth.uid()::text then
      new.avatar_path := old.avatar_path;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_update on public.profiles;
create trigger profiles_guard_update
  before update on public.profiles
  for each row execute function public.guard_profile_update();


-- ---------------------------------------------------------------------
--  3. POPIS UŽIVO
-- ---------------------------------------------------------------------
--  Supabase šalje izmene aplikaciji samo za tabele upisane u publikaciju
--  supabase_realtime. Bez ovoga kolega u istoj smeni vidi tvoj unos tek kad
--  osveži stranicu.
do $$
begin
  alter publication supabase_realtime add table public.shift_report_items;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.shift_reports;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.shift_report_staff;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.report_images;
exception when duplicate_object then null;
end $$;

--  Kad se red obriše, Supabase podrazumevano šalje samo njegov ključ. Tada
--  aplikacija ne zna KOJI je artikal obrisan, pa bi ostao na ekranu.
alter table public.shift_report_items  replica identity full;
alter table public.shift_report_staff  replica identity full;
alter table public.report_images       replica identity full;


-- ---------------------------------------------------------------------
--  4. SKRIVANJE CELE GRUPE ARTIKALA
-- ---------------------------------------------------------------------
alter table public.categories
  add column if not exists is_active boolean not null default true;


-- ---------------------------------------------------------------------
--  5. NAČIN POPISA PO ARTIKLU
-- ---------------------------------------------------------------------
--    zalihe   upisuje se PRODATO    krajnje = (početno + dodato) − prodato
--    brojac   upisuje se PRODATO    krajnje = početno + prodato      (espresso)
--    krajnje  upisuje se KRAJNJE    prodato = (početno + dodato) − krajnje (voće)
alter table public.items
  add column if not exists is_counter boolean not null default false;

alter table public.items
  add column if not exists count_mode text not null default 'zalihe';

alter table public.shift_report_items
  add column if not exists is_counter boolean not null default false;

alter table public.shift_report_items
  add column if not exists count_mode text not null default 'zalihe';

do $$
begin
  alter table public.items add constraint items_count_mode_check
    check (count_mode in ('zalihe', 'brojac', 'krajnje'));
exception when duplicate_object then null;
end $$;

--  Postojeći brojači ostaju brojači.
update public.items
   set count_mode = 'brojac'
 where is_counter and count_mode = 'zalihe';

update public.shift_report_items
   set count_mode = 'brojac'
 where is_counter and count_mode = 'zalihe';


-- ---------------------------------------------------------------------
--  6. ISPRAVKA SVIH DOSADAŠNJIH POPISA
-- ---------------------------------------------------------------------
--  Ranije je artikal kome je upisano samo početno stanje ostajao „nedovršen“:
--  prodato i krajnje su bili prazni. Sada prazno prodato znači NULA prodatih,
--  pa krajnje stanje ostaje ono što je i bilo — novo (početno + dodato).
--
--  Ovo prolazi kroz sve popise, i stare i trenutne, i dopunjava ih po tom
--  pravilu. Već popisani artikli se ne diraju.
update public.shift_report_items
   set qty_sold = 0,
       qty_end = case
         when count_mode = 'brojac'
           then coalesce(qty_start, 0)
         when count_mode = 'krajnje'
           then coalesce(qty_end, coalesce(qty_start, 0) + coalesce(qty_added, 0))
         else coalesce(qty_start, 0) + coalesce(qty_added, 0)
       end
 where qty_sold is null;

--  Retki slučaj: prodato postoji, a krajnje je ostalo prazno.
update public.shift_report_items
   set qty_end = case
         when count_mode = 'brojac'
           then coalesce(qty_start, 0) + coalesce(qty_sold, 0)
         else coalesce(qty_start, 0) + coalesce(qty_added, 0) - coalesce(qty_sold, 0)
       end
 where qty_end is null;


-- ---------------------------------------------------------------------
--  7. OZNAKA DA UZ IZVEŠTAJ STOJI PORUKA
-- ---------------------------------------------------------------------
--  Da radnik u spisku „Moji izveštaji“ odmah vidi gde ga čeka poruka, a ne
--  da otvara jedan po jedan. Sam tekst poruke ostaje u izveštaju.
drop view if exists public.report_summary;

create view public.report_summary
with (security_invoker = true)     -- poštuje RLS pozivaoca
as
select
  r.id,
  r.report_date,
  r.shift,
  r.status,
  r.cash_amount,
  r.card_amount,
  r.total_amount,
  r.created_at,
  r.created_by,
  p.full_name as created_by_name,
  coalesce(r.admin_note, '') <> ''                                           as has_admin_note,
  (select count(*) from public.report_images i where i.report_id = r.id)      as image_count,
  (select count(*) from public.shift_report_items si where si.report_id = r.id) as item_count,
  -- Svi koji su radili smenu — da filter „radnik“ nađe i smene koje nije on otvorio.
  array(select s.profile_id from public.shift_report_staff s where s.report_id = r.id) as staff_ids
from public.shift_reports r
join public.profiles p on p.id = r.created_by;

grant select on public.report_summary to authenticated;


-- =====================================================================
--  Gotovo. Dole treba da piše „Success. No rows returned“.
--
--  Posle ovoga u aplikaciji:
--    · Radnici → strelice ▲▼ za redosled
--    · Artikli → Kategorije → Sakrij (cela grupa)
--    · Artikli → Izmeni → Način popisa (zalihe / brojač / krajnje stanje)
--    · popis se vidi uživo kod svih u smeni
-- =====================================================================
