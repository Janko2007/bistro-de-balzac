-- =====================================================================
--  BISTRO DE BALZAC — ažuriranje baze (dnevnica ili plata + procenat)
--
--  Šta ovo radi:
--    Svaki radnik može da bude na DNEVNICI ili na PLATI, a uz oba može da
--    ide i PROCENAT od pazara smena koje je radio.
--
--      dnevnica  →  zarada = broj smena × dnevnica
--      plata     →  zarada = mesečna plata ÷ 2 (period je pola meseca)
--      procenat  →  + (pazar njegovih smena × procenat)
--
--  Kako:
--    supabase.com → tvoj projekat → SQL Editor → New query → nalepi sve →
--    Run. Može da se pokrene više puta, ništa se ne duplira.
--
--  Napomena: ovo je DODATAK na AZURIRANJE-BAZE-2.sql. Ako taj još nisi
--  pokrenuo, pokreni prvo njega.
-- =====================================================================

-- 1) Nove kolone na profilima
alter table public.profiles add column if not exists pay_model text not null default 'dnevnica';
alter table public.profiles add column if not exists monthly_salary numeric(10,2) not null default 0;
alter table public.profiles add column if not exists percent numeric(5,2) not null default 0;

do $$
begin
  alter table public.profiles add constraint profiles_pay_model_check
    check (pay_model in ('dnevnica', 'plata'));
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.profiles add constraint profiles_percent_check
    check (percent >= 0 and percent <= 100);
exception when duplicate_object then null;
end $$;


-- 2) Radnik ne menja sebi način plaćanja, platu ni procenat
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


-- =====================================================================
--  Gotovo. Dole treba da piše „Success. No rows returned“.
--  Svi postojeći radnici ostaju na dnevnici, bez procenta — menjaš ih u
--  aplikaciji: Radnici → Izmeni.
-- =====================================================================
