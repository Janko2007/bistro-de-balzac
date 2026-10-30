import { useEffect, useRef } from 'react'

const COLORS = ['#ef5f07', '#ffbf71', '#fbbf24', '#34d399', '#60a5fa', '#f472b6', '#a78bfa', '#ffffff']

/**
 * Slavlje preko celog ekrana: konfete ili vatromet.
 *
 * Crta se na platnu iznad aplikacije, ne hvata dodire i gasi se samo (oko 5 s).
 * Radnici koji u telefonu imaju uključeno „smanji kretanje“ ne dobijaju efekat.
 */
export default function Celebration({ effect }) {
  const ref = useRef(null)

  useEffect(() => {
    if (!effect || effect === 'bez') return undefined
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined

    const canvas = ref.current
    if (!canvas) return undefined
    const ctx = canvas.getContext('2d')
    const dpr = Math.min(window.devicePixelRatio || 1, 2)

    const resize = () => {
      canvas.width = window.innerWidth * dpr
      canvas.height = window.innerHeight * dpr
    }
    resize()
    window.addEventListener('resize', resize)

    const W = () => window.innerWidth
    const H = () => window.innerHeight
    const rnd = (a, b) => a + Math.random() * (b - a)
    const pick = () => COLORS[Math.floor(Math.random() * COLORS.length)]

    const pieces = [] // konfete
    const sparks = [] // iskre vatrometa
    const rockets = []

    function confettiBurst(x, y, n = 90, spread = 1, down = false) {
      for (let i = 0; i < n; i += 1) {
        // gore (topovi iz uglova) ili dole (kiša odozgo)
        const angle = down ? rnd(0.15, Math.PI - 0.15) : -rnd(0.25, Math.PI / 2 + 0.2) * spread - 0.1
        const speed = rnd(5, 13)
        pieces.push({
          x, y,
          // topovi iz uglova pucaju ka sredini ekrana
          vx: Math.cos(angle) * speed * (!down && x > W() / 2 ? -1 : 1),
          vy: Math.sin(angle) * speed,
          w: rnd(6, 11), h: rnd(4, 7),
          rot: rnd(0, Math.PI * 2), vr: rnd(-0.3, 0.3),
          color: pick(), life: rnd(160, 260),
        })
      }
    }

    function fireworkAt(x, y) {
      const color = pick()
      const n = 70
      for (let i = 0; i < n; i += 1) {
        const a = (i / n) * Math.PI * 2
        const s = rnd(2, 6.5)
        sparks.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, color, life: rnd(55, 95), max: 95 })
      }
    }

    if (effect === 'konfete') {
      // dva topa sa donjih uglova + kiša odozgo
      confettiBurst(W() * 0.05, H() * 0.95, 80, 1)
      confettiBurst(W() * 0.95, H() * 0.95, 80, 1)
      for (let i = 0; i < 6; i += 1) {
        setTimeout(() => confettiBurst(rnd(W() * 0.2, W() * 0.8), -10, 30, 1, true), 400 + i * 350)
      }
    } else {
      for (let i = 0; i < 7; i += 1) {
        setTimeout(() => {
          rockets.push({ x: rnd(W() * 0.15, W() * 0.85), y: H(), vy: -rnd(9, 13), peak: rnd(H() * 0.15, H() * 0.45) })
        }, i * 520)
      }
    }

    let frame = 0
    let raf = 0
    const started = Date.now()

    function tick() {
      frame += 1
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, W(), H())

      for (let i = pieces.length - 1; i >= 0; i -= 1) {
        const p = pieces[i]
        p.vy += 0.22
        p.vx *= 0.985
        p.x += p.vx
        p.y += p.vy
        p.rot += p.vr
        p.life -= 1
        if (p.life <= 0 || p.y > H() + 30) {
          pieces.splice(i, 1)
          continue
        }
        ctx.save()
        ctx.translate(p.x, p.y)
        ctx.rotate(p.rot)
        ctx.globalAlpha = Math.min(1, p.life / 40)
        ctx.fillStyle = p.color
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h)
        ctx.restore()
      }

      for (let i = rockets.length - 1; i >= 0; i -= 1) {
        const r = rockets[i]
        r.y += r.vy
        r.vy *= 0.985
        ctx.globalAlpha = 1
        ctx.fillStyle = '#fde68a'
        ctx.fillRect(r.x - 1.5, r.y, 3, 10)
        if (r.y <= r.peak || r.vy > -2) {
          fireworkAt(r.x, r.y)
          rockets.splice(i, 1)
        }
      }

      for (let i = sparks.length - 1; i >= 0; i -= 1) {
        const s = sparks[i]
        s.vy += 0.06
        s.vx *= 0.985
        s.x += s.vx
        s.y += s.vy
        s.life -= 1
        if (s.life <= 0) {
          sparks.splice(i, 1)
          continue
        }
        ctx.globalAlpha = Math.max(0, s.life / s.max)
        ctx.fillStyle = s.color
        ctx.beginPath()
        ctx.arc(s.x, s.y, 2.2, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = 1

      const busy = pieces.length || sparks.length || rockets.length
      // posle 7 s, ili čim se sve ugasi (a nema više najava), prestaje
      if ((busy || Date.now() - started < 3500) && Date.now() - started < 9000) {
        raf = requestAnimationFrame(tick)
      } else {
        ctx.clearRect(0, 0, W(), H())
      }
    }
    raf = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
    }
  }, [effect])

  if (!effect || effect === 'bez') return null
  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-[90] h-full w-full"
    />
  )
}
