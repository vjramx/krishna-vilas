/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          primary: '#C83E24',
          primaryDark: '#A83318',
          secondary: '#F47B35',
          bg: '#FFF4E7',
          card: '#FFFFFF',
          text: '#40271F',
          subtle: '#80665A',
          border: '#F0DFCE',
          divider: '#F6EADF',
          success: '#1B7A43',
          successBg: '#E7F5EC',
          error: '#B3261E',
          errorBg: '#FCEBEA',
          warn: '#8A5A00',
          warnBg: '#FFF3D6',
          scrim: 'rgba(32,18,13,0.48)',
        },
      },
      fontFamily: {
        sans: ['Roboto', "'Noto Sans Kannada'", 'ui-sans-serif', 'system-ui', "'Segoe UI'", 'sans-serif'],
      },
      maxWidth: { screen: '430px', app: '480px' },
      boxShadow: {
        soft: '0 1px 2px rgba(64,39,31,0.06), 0 4px 14px rgba(64,39,31,0.08)',
        elev1: '0 1px 3px rgba(64,39,31,0.12), 0 1px 2px rgba(64,39,31,0.08)',
        elev2: '0 -1px 3px rgba(64,39,31,0.08), 0 -8px 24px rgba(64,39,31,0.10)',
        sheet: '0 -8px 32px rgba(32,18,13,0.22)',
      },
      borderRadius: { xl2: '1rem', xl3: '1.5rem' },
    },
  },
  plugins: [],
};
