/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#060B16',
        card: '#0D1628',
        line: '#1E2D4A',
        text: '#EEF2FA',
        sub: '#93A3C0',
        significant: '#F0484D',
        moderate: '#F5B83D',
        stable: '#3DD68C',
        water: '#4AA8FF',
        'brand-blue': '#0B4BAA',
        sky: '#5B9BF5',
        'gold': '#E8B84A',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['Oswald', 'Inter', 'sans-serif'],
        arabic: ['"Noto Kufi Arabic"', 'sans-serif'],
      },
      borderRadius: { card: '12px', panel: '20px' },
      boxShadow: {
        panel: '0 12px 40px rgba(0,0,0,.45)',
        card: '0 2px 10px rgba(0,0,0,.25)',
      },
      keyframes: {
        pulseRing: {
          '0%': { transform: 'scale(.6)', opacity: '.9' },
          '100%': { transform: 'scale(2.6)', opacity: '0' },
        },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
        fadeIn: { from: { opacity: '0' }, to: { opacity: '1' } },
        rise: { from: { opacity: '0', transform: 'translateY(8px)' }, to: { opacity: '1', transform: 'none' } },
      },
      animation: {
        pulseRing: 'pulseRing 1.8s ease-out infinite',
        fadeIn: 'fadeIn .4s ease-out both',
        rise: 'rise .35s ease-out both',
      },
    },
  },
  plugins: [],
}
