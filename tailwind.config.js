/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        'sc': {
          DEFAULT: '#ff5500',
          hover: '#ff3300'
        }
      }
    },
  },
  plugins: [],
};