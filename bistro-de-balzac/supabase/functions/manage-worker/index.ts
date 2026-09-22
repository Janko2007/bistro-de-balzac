// =====================================================================
//  Edge Function: manage-worker
//  Vlasnik (admin) preko nje otvara naloge radnicima, menja im lozinku
//  i briše ih.
//
//  Zašto Edge Function? Sve tri radnje zahtevaju `service_role` ključ,
//  koji NIKADA ne sme da se nađe u frontend kodu. Zato ključ živi na
//  serveru, a funkcija prvo proveri da je pozivalac zaista admin.
//
//  Deploy:
//    supabase functions deploy manage-worker
//  (SUPABASE_URL, SUPABASE_ANON_KEY i SUPABASE_SERVICE_ROLE_KEY
//   Supabase sam postavlja)
// =====================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

/**
 * Puno ime -> adresa za prijavu.
 * "Marko Marković" -> "marko.markovic@<LOGIN_DOMAIN>"
 * Mora da bude identično funkciji `loginEmail` u src/lib/utils.js.
 */
const LOGIN_DOMAIN = Deno.env.get('LOGIN_DOMAIN') ?? 'bistrodebalzac.rs'

const MAP: Record<string, string> = {
  č: 'c', ć: 'c', ž: 'z', š: 's', đ: 'dj',
  Č: 'c', Ć: 'c', Ž: 'z', Š: 's', Đ: 'dj',
}

function slugifyName(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[čćžšđ]/g, (c) => MAP[c] ?? c)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
}

function loginEmail(name: string) {
  return `${slugifyName(name)}@${LOGIN_DOMAIN}`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Dozvoljen je samo POST.' }, 405)

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
  const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

  const authHeader = req.headers.get('Authorization') ?? ''
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'Niste prijavljeni.' }, 401)

  // 1) Ko poziva?
  const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  })

  const {
    data: { user: caller },
    error: callerError,
  } = await callerClient.auth.getUser()

  if (callerError || !caller) return json({ error: 'Nevažeća sesija.' }, 401)

  const { data: callerProfile } = await callerClient
    .from('profiles')
    .select('role, is_active')
    .eq('id', caller.id)
    .single()

  if (!callerProfile || callerProfile.role !== 'admin' || !callerProfile.is_active) {
    return json({ error: 'Samo vlasnik (admin) može da upravlja nalozima.' }, 403)
  }

  // 2) Ulazni podaci
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Neispravan JSON.' }, 400)
  }

  const action = String(body.action ?? 'create')

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  /* ------------------------------------------------------------------ */
  /*  CREATE — otvaranje naloga                                          */
  /* ------------------------------------------------------------------ */
  if (action === 'create') {
    const fullName = String(body.full_name ?? '').trim().replace(/\s+/g, ' ')
    const password = String(body.password ?? '')
    const phone = String(body.phone ?? '').trim()
    const role = body.role === 'admin' ? 'admin' : 'radnik'
    const dailyWage = Number(body.daily_wage ?? 0)

    if (fullName.split(' ').length < 2) {
      return json({ error: 'Unesi ime i prezime — to je ujedno i korisničko ime.' }, 400)
    }
    if (password.length < 6) return json({ error: 'Lozinka mora imati bar 6 karaktera.' }, 400)
    if (!Number.isFinite(dailyWage) || dailyWage < 0) {
      return json({ error: 'Dnevnica mora biti broj veći ili jednak nuli.' }, 400)
    }

    const email = loginEmail(fullName)
    if (email.startsWith('@')) return json({ error: 'Ime sadrži samo nedozvoljene znakove.' }, 400)

    // Ime mora biti jedinstveno — po njemu se radnik prijavljuje.
    const { data: clash } = await admin
      .from('profiles')
      .select('id')
      .ilike('full_name', fullName)
      .eq('is_deleted', false)
      .maybeSingle()

    if (clash) {
      return json({ error: `Radnik „${fullName}" već postoji. Dodaj npr. srednje slovo.` }, 400)
    }

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // nalog radi odmah, bez potvrde mejla
      user_metadata: { full_name: fullName, role },
    })

    if (createError) {
      const msg = createError.message?.includes('already')
        ? `Nalog za „${fullName}" već postoji.`
        : createError.message
      return json({ error: msg }, 400)
    }

    // Trigger je već napravio profil — dopunjavamo podatke.
    const { error: profileError } = await admin.from('profiles').upsert(
      {
        id: created.user!.id,
        email,
        full_name: fullName,
        phone: phone || null,
        role,
        daily_wage: dailyWage,
        is_active: true,
        is_deleted: false,
      },
      { onConflict: 'id' },
    )

    if (profileError) return json({ error: profileError.message }, 400)

    return json({
      success: true,
      user: { id: created.user!.id, username: fullName, email, role, daily_wage: dailyWage },
    })
  }

  /* ------------------------------------------------------------------ */
  /*  PASSWORD — nova lozinka                                            */
  /* ------------------------------------------------------------------ */
  if (action === 'password') {
    const id = String(body.id ?? '')
    const password = String(body.password ?? '')
    if (!id) return json({ error: 'Nedostaje id radnika.' }, 400)
    if (password.length < 6) return json({ error: 'Lozinka mora imati bar 6 karaktera.' }, 400)

    const { error } = await admin.auth.admin.updateUserById(id, { password })
    if (error) return json({ error: error.message }, 400)

    return json({ success: true })
  }

  /* ------------------------------------------------------------------ */
  /*  DELETE — brisanje naloga                                           */
  /* ------------------------------------------------------------------ */
  if (action === 'delete') {
    const id = String(body.id ?? '')
    if (!id) return json({ error: 'Nedostaje id radnika.' }, 400)
    if (id === caller.id) return json({ error: 'Ne možeš obrisati svoj nalog.' }, 400)

    // Ima li iza njega istorije? Ako ima, profil ostaje (zbog izveštaja),
    // a briše se samo mogućnost prijave.
    const { count: reportCount } = await admin
      .from('shift_reports')
      .select('id', { count: 'exact', head: true })
      .eq('created_by', id)

    const { count: staffCount } = await admin
      .from('shift_report_staff')
      .select('report_id', { count: 'exact', head: true })
      .eq('profile_id', id)

    const hasHistory = (reportCount ?? 0) > 0 || (staffCount ?? 0) > 0

    // Nalog za prijavu se uvek briše.
    const { error: authError } = await admin.auth.admin.deleteUser(id)
    if (authError && !authError.message?.toLowerCase().includes('not found')) {
      return json({ error: authError.message }, 400)
    }

    if (hasHistory) {
      const { error } = await admin
        .from('profiles')
        .update({ is_active: false, is_deleted: true })
        .eq('id', id)
      if (error) return json({ error: error.message }, 400)

      return json({
        success: true,
        kept_history: true,
        reports: reportCount ?? 0,
        shifts: staffCount ?? 0,
      })
    }

    const { error } = await admin.from('profiles').delete().eq('id', id)
    if (error) return json({ error: error.message }, 400)

    return json({ success: true, kept_history: false })
  }

  return json({ error: `Nepoznata radnja: ${action}` }, 400)
})
