import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        scrow: {
          bg: "#0B0F17",
          surface: "#110C1D",
          accent: "#A855F7",
          magenta: "#D946EF",
        },
      },
    },
  },
  plugins: [],
};

export default config;
