-- =====================================================================
--  BISTRO DE BALZAC — ažuriranje baze
--    1) redosled radnika
--    2) popis UŽIVO — da se izmene odmah vide svima u smeni
--
--  Šta ovo radi:
--    Radnici se više ne ređaju samo po imenu — ti im sam zadaješ redosled
--    strelicama ▲▼ na ekranu Radnici, pa najvažniji stoje na vrhu.
--
--    Postojeći radnici dobijaju redosled po abecedi, isti kakav su do sada
--    imali na ekranu, pa se prvi put ništa vidno ne menja.
--
--    Uz to uključuje „uživo“ na popisu: kad dvoje rade istu smenu, ono što
--    jedan upiše drugom se pojavi za sekundu, bez osvežavanja. Aplikacija to
--    radi od početka, ali Supabase mora da dozvoli slanje izmena — a to do
--    sada nije bilo upisano ni u jednu skriptu.
--
--  Kako:
--    supabase.com → tvoj projekat → SQL Editor → New query → nalepi sve →
--    Run. Može da se pokrene više puta, ništa se ne duplira.
--
--  Napomena: ovo je DODATAK na skripte -2, -3, -4 i -5. Ako ih još nisi
--  pokrenuo, pokreni prvo njih.
-- =====================================================================

-- 1) Nova kolona
--    Podrazumevana vrednost je namerno velika (1000) — novootvoren nalog tako
--    ide na KRAJ spiska, pa ga odatle strelicama podižeš gde treba.
alter table public.profiles
  add column if not exists sort_order integer not null default 1000;

alter table public.profiles alter column sort_order set default 1000;

create index if not exists profiles_sort_idx on public.profiles (sort_order, full_name);


-- 2) Prvi put: poređaj postojeće po abecedi, sa razmakom od 10
--    Razmak postoji da premeštanje ne mora da prebrojava ceo spisak.
--    Radi se samo ako nijedan još nije ređan, da se tvoj redosled ne pregazi.
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


-- 3) Redosled menja SAMO admin
--    Radnik ne sme sebe da gurne na vrh spiska, pa okidač vraća staru
--    vrednost svakome ko nije admin.
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


-- 4) POPIS UŽIVO
--    Supabase šalje izmene aplikaciji samo za tabele koje su upisane u
--    „publikaciju“ supabase_realtime. Bez ovoga kolega u istoj smeni vidi
--    tvoj unos tek kad osveži stranicu.
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

--    Kad se red obriše, Supabase podrazumevano šalje samo njegov ključ. Tada
--    aplikacija ne zna KOJI je artikal obrisan, pa bi ostao na ekranu.
--    `replica identity full` znači: pošalji ceo obrisani red.
alter table public.shift_report_items  replica identity full;
alter table public.shift_report_staff  replica identity full;
alter table public.report_images       replica identity full;


-- =====================================================================
--  Gotovo. Dole treba da piše „Success. No rows returned“.
--
--  Provera „uživo“: otvori isti popis na telefonu i na računaru, upiši
--  broj na jednom — na drugom se pojavi za sekundu, bez osvežavanja.
-- =====================================================================
