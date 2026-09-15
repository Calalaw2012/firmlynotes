import type { Config } from "tailwindcss";

// Palette sampled from firmlyresearch.com's computed styles, so Firmly Notes
// reads as a sibling product in the same "Firmly" family.
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: "#12160f", // page background
          elevated: "#191f17", // card / section background
          sunken: "#0d100b", // textarea well / inputs
        },
        border: {
          DEFAULT: "#37402f",
          faint: "#232a1f",
        },
        ink: {
          DEFAULT: "#e9eee6", // primary text
          muted: "#a9b5a6", // secondary text
          faint: "#7f8c85", // labels / small caps
        },
        indigo: {
          bg: "#262c56",
          border: "#97a3e8",
          text: "#bec7f2",
          solid: "#4c56a6",
        },
        sage: {
          DEFAULT: "#8fae8a",
          dim: "#5f7a5c",
        },
        success: {
          DEFAULT: "#4fa873",
          border: "#17301f",
        },
        danger: {
          DEFAULT: "#e2897e",
          bg: "#2c1a17",
          border: "#4a2a24",
        },
      },
      fontFamily: {
        // Points at the CSS variable next/font injects in app/layout.tsx
        // (self-hosted Public Sans) rather than the bare family name, so the
        // optimized/self-hosted font is actually the one used.
        sans: [
          "var(--font-public-sans)",
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
        ],
      },
      borderRadius: {
        pill: "999px",
      },
    },
  },
  plugins: [],
};

export default config;
