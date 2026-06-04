/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // DAW dark studio palette
        studio: {
          bg:      "#0F0F0F",
          surface: "#1A1A1A",
          panel:   "#212121",
          border:  "#2E2E2E",
          hover:   "#2A2A2A",
          active:  "#333333",
          accent:  "#4A90D9",
          "accent-dim": "#2D5F99",
          mute:    "#E84C3D",
          solo:    "#F5A623",
          text:    "#E8E8E8",
          "text-dim": "#9A9A9A",
          "text-faint": "#5A5A5A",
          meter:   "#2ECC71",
          "meter-warn": "#F39C12",
          "meter-clip": "#E84C3D",
        },
        track: {
          reference: "#4A90D9",
          user:      "#2ECC71",
          analysis:  "#9B59B6",
        },
        stem: {
          full_mix: "#4A90D9",
          drums:    "#E84C3D",
          bass:     "#F39C12",
          vocals:   "#2ECC71",
          music:    "#9B59B6",
          other:    "#95A5A6",
          fx:       "#1F618D",
          unknown:  "#5D6D7E",
        },
      },
      fontFamily: {
        mono: ["'JetBrains Mono'", "'Fira Code'", "monospace"],
        sans: ["Inter", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
