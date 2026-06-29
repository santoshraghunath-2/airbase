import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./index.html",
    "./src/**/*.{ts,tsx}",
  ],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        sans: ["Hanken Grotesk", "system-ui", "sans-serif"],
      },
      colors: {
        // shadcn/ui CSS-variable bridge (required for primitive components)
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },

        // Airbase warm design tokens
        bone: "#F1EBE1",
        paper: "#FBF8F3",
        raised: "#FEFCF9",
        "panel-warm": "#F4EFE6",
        ink: {
          DEFAULT: "#292420",
          hover: "#3a342d",
          2: "#6F6658",
        },
        "ink-muted": "#9A9082",
        faint: "#B0A691",
        line: {
          DEFAULT: "#E6DECF",
          2: "#EFE9DE",
        },
        "field-border": "#D8CEBC",

        // AI accent — periwinkle, exclusively for AI-proposed content
        ai: {
          DEFAULT: "#5B6B9E",
          ink: "#46537F",
          tint: "#F3F1F8",
          "tint-border": "#D3D9EC",
          "chip-bg": "#EEF0F7",
        },

        // Semantic state colors (low-chroma)
        confirmed: {
          text: "#4C6749",
          bg: "#ECF1EC",
          border: "#CFE0CD",
          dot: "#5E7A5A",
        },
        waiting: {
          text: "#8A6A22",
          bg: "#F8F1E1",
          border: "#ECDDBF",
          dot: "#B0822F",
        },
        blocked: {
          text: "#A85A40",
          bg: "#F7ECE6",
          border: "#E8CFC2",
          dot: "#A85A40",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        pill: "9999px",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        abpulse: {
          "0%, 100%": { transform: "scale(1)", opacity: "1" },
          "50%": { transform: "scale(2.1)", opacity: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        abpulse: "abpulse 2.4s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
