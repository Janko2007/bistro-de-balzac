-- =====================================================================
--  BISTRO DE BALZAC — ažuriranje baze (popis žestina na 7 dana)
--
--  Šta ovo radi:
--    · svaka grupa artikala može da se popisuje ređe — npr. žestine na 7 dana
--    · dok ne dođe red, radniku se početno stanje PREPISUJE iz prošle smene
--      i on upisuje samo prodato; krajnje se prenosi sledećoj smeni
--    · ti kao admin možeš u svakom trenutku da tražiš popis odmah
--    · dodaje pravilo „Popis žestina“ koje radnici čitaju na ekranu Profil
--
--  Kako:
--    supabase.com → tvoj projekat → SQL Editor → New query → nalepi sve →
--    Run. Može da se pokrene više puta, ništa se ne duplira.
--
--  Napomena: ovo je DODATAK na skripte 9 i 10.
-- =====================================================================

-- ---------------------------------------------------------------------
--  1. KOLIKO ČESTO SE GRUPA POPISUJE
-- ---------------------------------------------------------------------
alter table public.categories
  add column if not exists count_every_days integer not null default 0;

alter table public.categories
  add column if not exists last_count_on date;

alter table public.categories
  add column if not exists count_due boolean not null default false;

comment on column public.categories.count_every_days is
  '0 = popisuje se svaku smenu. 7 = popisuje se na svakih 7 dana.';
comment on column public.categories.last_count_on is
  'Datum poslednjeg pravog popisa ove grupe.';
comment on column public.categories.count_due is
  'Admin je tražio popis odmah, bez obzira na broj dana.';

--  Ako već postoji grupa sa žestinama, odmah joj se postavlja 7 dana.
update public.categories
   set count_every_days = 7
 where count_every_days = 0
   and (name ilike '%žestin%' or name ilike '%zestin%'
     or name ilike '%žestok%' or name ilike '%zestok%'
     or name ilike '%rakij%');


-- ---------------------------------------------------------------------
--  2. POSLEDNJE KRAJNJE STANJE PO ARTIKLU
-- ---------------------------------------------------------------------
--  Odavde aplikacija prepisuje početno stanje kad grupa nije na redu za
--  popis. Uzima se poslednja smena u kojoj je artikal imao krajnje stanje.
create or replace view public.last_item_end as
select distinct on (si.item_id)
       si.item_id,
       si.qty_end,
       r.report_date,
       r.shift
  from public.shift_report_items si
  join public.shift_reports r on r.id = si.report_id
 where si.qty_end is not null
 order by si.item_id,
          r.report_date desc,
          case r.shift
            when 'druga'      then 3
            when 'medjusmena' then 2
            else 1
          end desc,
          r.created_at desc;

grant select on public.last_item_end to authenticated;


-- ---------------------------------------------------------------------
--  3. UPIS DA JE GRUPA POPISANA
-- ---------------------------------------------------------------------
--  Zove je aplikacija kad radnik zatvori smenu u kojoj su te grupe
--  stvarno popisane. Radnik ne sme da menja kategorije, pa funkcija radi
--  serverskim pravima — ali samo nad ove tri kolone.
create or replace function public.mark_categories_counted(
  p_names text[],
  p_date  date default current_date
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Nisi prijavljen.';
  end if;

  update public.categories
     set last_count_on = p_date,
         count_due     = false
   where name = any (p_names);
end;
$$;

revoke all on function public.mark_categories_counted(text[], date) from public;
grant execute on function public.mark_categories_counted(text[], date) to authenticated;


-- ---------------------------------------------------------------------
--  4. PRAVILO: POPIS ŽESTINA
-- ---------------------------------------------------------------------
--  Radnici ga čitaju na ekranu Profil. Slobodno ga menjaj u aplikaciji:
--  Radnici → Pravila i obaveze.
insert into public.rule_docs (title, body, sort_order)
select 'Popis žestina',
E'# Kada se radi\n'
 || E'- Popis žestina se radi na svakih 7 dana.\n'
 || E'- Dok ne dođe red, u popisu stoji prepisano početno stanje — ti upisuješ samo prodato.\n'
 || E'- Admin može da zatraži popis i ranije; tada se u popisu jasno vidi da se žestine broje.\n'
 || E'\n'
 || E'# Merenje\n'
 || E'- Rakija Arhiva 0.7l — meri se po Jameson 0.7\n'
 || E'- Rakije Živanović 0.7 — meri se po Chivas 0.7\n'
 || E'- Rakije Pevac 0.7 — meri se po Chivas 0.7\n'
 || E'- Gorki list 0.7 — meri se po OLMECA 0.7\n'
 || E'\n'
 || E'# Nova flaša\n'
 || E'- Nova neotvorena flaša 0.7 ima 23 merice.\n'
 || E'- Nova neotvorena flaša 1l ima 33 merice.\n'
 || E'\n'
 || E'# Flaše kojih nema na šankomeru\n'
 || E'- Gleda se koja je flaša najsličnija i po njoj se meri.\n'
 || E'- Medovača nema nijednu približno sličnu flašu — njeno stanje se meri tek kada se donese i otvori nova flaša.\n'
 || E'- Isto važi i za Monin ukuse za kafe, limunade i ice tea.\n'
 || E'\n'
 || E'# Dozvoljeno odstupanje\n'
 || E'! Kada se potroši jedna flaša bilo čega, sme da fali najviše 2 merice.\n'
 || E'- Neko sipa malo više, malo kane, malo izvetri — zato tolerancija postoji.\n'
 || E'!! Više od 2 merice manjka se prijavljuje adminu.',
       (select coalesce(max(sort_order), 0) + 100 from public.rule_docs)
 where not exists (
   select 1 from public.rule_docs where lower(title) = lower('Popis žestina')
 );


-- =====================================================================
--  Gotovo. Dole treba da piše „Success. No rows returned“.
--
--  U aplikaciji:
--    · Artikli → Kategorije → kod grupe upišeš na koliko dana se popisuje
--      i dugmetom „Popiši sada“ tražiš popis van reda
--    · Profil → Pravila i obaveze → „Popis žestina“
-- =====================================================================
