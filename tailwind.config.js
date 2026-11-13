/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef9f2',
          100: '#d8f0df',
          500: '#078447',
          600: '#06723d',
          700: '#075d35',
          900: '#123d2a',
        },
        leaf: '#83ad19',
        sun: '#ffe200',
      },
      boxShadow: {
        card: '0 18px 50px rgba(18, 61, 42, 0.08)',
      },
    },
  },
  plugins: [],
};
