/**
 * Način plaćanja u formi radnika: dnevnica, plata ili procenat od pazara.
 *
 * U bazi postoje samo „dnevnica“ i „plata“. Procenat od pazara se čuva kao
 * dnevnica 0 uz procenat veći od nule, pa ne treba nova skripta za bazu.
 */
export function payModeOf(person) {
  if (person?.pay_model === 'plata') return 'plata'
  const wage = Number(person?.daily_wage ?? 0)
  const percent = Number(person?.percent ?? 0)
  return wage === 0 && percent > 0 ? 'procenat' : 'dnevnica'
}

/** Polja za bazu iz forme (`parse` pretvara tekst u broj). */
export function payPayload(form, parse) {
  const percent = parse(form.percent)
  if (form.pay_model === 'plata') {
    return {
      pay_model: 'plata',
      daily_wage: parse(form.daily_wage),
      monthly_salary: parse(form.monthly_salary),
      percent,
    }
  }
  if (form.pay_model === 'procenat') {
    return { pay_model: 'dnevnica', daily_wage: 0, monthly_salary: 0, percent }
  }
  return {
    pay_model: 'dnevnica',
    daily_wage: parse(form.daily_wage),
    monthly_salary: parse(form.monthly_salary),
    percent,
  }
}
