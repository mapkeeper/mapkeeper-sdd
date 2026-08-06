/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: { pretendard: ['Pretendard', 'sans-serif'] },
      colors: { brand: '#1f57bd', ink: '#191f28' },
      boxShadow: { card: '0 4px 18px rgba(25, 31, 40, 0.06)' },
    },
  },
  plugins: [],
};
