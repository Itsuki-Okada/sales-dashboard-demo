/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Noto Sans JP"', "-apple-system", "BlinkMacSystemFont", '"Hiragino Sans"', "Meiryo", "sans-serif"],
      },
    },
  },
  plugins: [],
};
