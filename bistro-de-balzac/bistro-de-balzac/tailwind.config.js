/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        /**
         * NAMERNO NIJE ČISTO BELA (#ffffff).
         * Ekran kafića se gleda i u mraku i na suncu, a puna bela blešti.
         * Ovim se `bg-white` svuda u aplikaciji pretvara u toplu, mekšu belu.
         */
        white: '#fbf9f5',

        brand: {
          50: '#fff8ed',
          100: '#ffefd4',
          200: '#ffdaa8',
          300: '#ffbf71',
          400: '#ff9938',
          500: '#fe7b11',
          600: '#ef5f07',
          700: '#c64608',
          800: '#9d370f',
          900: '#7e2f10',
        },
        // Topla crna iz logotipa — zaglavlje, ekran prijave, istaknuti iznosi
        ink: {
          DEFAULT: '#1c1917',
          600: '#57534e',
          700: '#44403c',
          800: '#292524',
          900: '#1c1917',
        },
        // Podloga aplikacije — topla, ne plavičasta
        paper: '#f0ece5',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      keyframes: {
        'slide-up': {
          from: { transform: 'translateY(12px)', opacity: '0' },
          to: { transform: 'translateY(0)', opacity: '1' },
        },
        // Uvećanje slike profila — kao da se približi iz kruga.
        'zoom-in': {
          from: { transform: 'scale(.35)', opacity: '0', borderRadius: '999px' },
          to: { transform: 'scale(1)', opacity: '1' },
        },
      },
      animation: {
        'slide-up': 'slide-up .18s ease-out',
        'zoom-in': 'zoom-in .22s cubic-bezier(.2,.8,.2,1)',
      },
    },
  },
  plugins: [],
}
