import type { Config } from "tailwindcss";

// Palette sampled from firmlyresearch.com's computed styles, so Firmly Notes
// reads as a sibling product in the same "Firmly" family. Each color points
// at a CSS custom property (defined in app/globals.css as an RGB triplet)
// wrapped in rgb(... / <alpha-value>) so Tailwind's opacity modifiers
// (bg-danger/10, border-sage/40, etc.) keep working. The properties
// themselves swap between dark (default) and light based on the user's
// OS-level color-scheme preference -- there's no in-app toggle.
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: "rgb(var(--color-bg) / <alpha-value>)", // page background
          elevated: "rgb(var(--color-bg-elevated) / <alpha-value>)", // card / section background
          sunken: "rgb(var(--color-bg-sunken) / <alpha-value>)", // textarea well / inputs
        },
        border: {
          DEFAULT: "rgb(var(--color-border) / <alpha-value>)",
          faint: "rgb(var(--color-border-faint) / <alpha-value>)",
        },
        ink: {
          DEFAULT: "rgb(var(--color-ink) / <alpha-value>)", // primary text
          muted: "rgb(var(--color-ink-muted) / <alpha-value>)", // secondary text
          faint: "rgb(var(--color-ink-faint) / <alpha-value>)", // labels / small caps
        },
        indigo: {
          bg: "rgb(var(--color-indigo-bg) / <alpha-value>)",
          border: "rgb(var(--color-indigo-border) / <alpha-value>)",
          text: "rgb(var(--color-indigo-text) / <alpha-value>)",
          solid: "rgb(var(--color-indigo-solid) / <alpha-value>)",
        },
        sage: {
          DEFAULT: "rgb(var(--color-sage) / <alpha-value>)",
          dim: "rgb(var(--color-sage-dim) / <alpha-value>)",
        },
        success: {
          DEFAULT: "rgb(var(--color-success) / <alpha-value>)",
          border: "rgb(var(--color-success-border) / <alpha-value>)",
        },
        danger: {
          DEFAULT: "rgb(var(--color-danger) / <alpha-value>)",
          bg: "rgb(var(--color-danger-bg) / <alpha-value>)",
          border: "rgb(var(--color-danger-border) / <alpha-value>)",
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
