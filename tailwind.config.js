/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      backgroundImage: {
        "fyllio-gradient": "linear-gradient(90deg, #2563eb 0%, #06b6d4 100%)",
      },
    },
  },
  plugins: [],
};
