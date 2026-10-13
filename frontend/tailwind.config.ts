/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: {
          DEFAULT: '#12284C',
          light: '#1B3B6F',
          dark: '#0A172C',
          deep: '#050D19',
        },
        teal: {
          DEFAULT: '#00A3AD',
          light: '#00C4D0',
          dark: '#007A82',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      borderRadius: {
        sm: '6px',
        md: '8px',
        lg: '12px',
      },
      boxShadow: {
        card: '0 1px 2px rgba(0,0,0,0.04)',
        elevation: '0 4px 16px rgba(0,0,0,0.12)',
      },
      transitionDuration: {
        fast: '140ms',
      },
    },
  },
  plugins: [],
}
