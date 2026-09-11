import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        // Manrope is shipped with the desktop bundle. It has the calm density and tabular
        // clarity needed for long shifts at a counter, without falling back to an OS serif.
        sans: ["Manrope Variable", "Manrope", "Noto Sans Devanagari Variable", "Segoe UI", "sans-serif"],
        display: ["Manrope Variable", "Manrope", "Noto Sans Devanagari Variable", "Segoe UI", "sans-serif"],
        serif: ["Manrope Variable", "Manrope", "Noto Sans Devanagari Variable", "Segoe UI", "sans-serif"],
        mono: ["Fira Code", "monospace"],
      },
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: { DEFAULT: "hsl(var(--card))", foreground: "hsl(var(--card-foreground))" },
        popover: { DEFAULT: "hsl(var(--popover))", foreground: "hsl(var(--popover-foreground))" },
        primary: { DEFAULT: "hsl(var(--primary))", foreground: "hsl(var(--primary-foreground))" },
        secondary: { DEFAULT: "hsl(var(--secondary))", foreground: "hsl(var(--secondary-foreground))" },
        muted: { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" },
        accent: { DEFAULT: "hsl(var(--accent))", foreground: "hsl(var(--accent-foreground))" },
        destructive: { DEFAULT: "hsl(var(--destructive))", foreground: "hsl(var(--destructive-foreground))" },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        chart: {
          1: "hsl(var(--chart-1))", 2: "hsl(var(--chart-2))", 3: "hsl(var(--chart-3))",
          4: "hsl(var(--chart-4))", 5: "hsl(var(--chart-5))",
        },
        brand: {
          50: "#F0EDFF", 100: "#E3DDFF", 200: "#CFC4FF", 300: "#B6A8FF", 400: "#8D79FF",
          500: "#664CF0", 600: "#5138CF", 700: "#3E289F", 800: "#2C1C70", 900: "#1D124B",
        },
        success: { DEFAULT: "#10B981", bg: "#ECFDF5" },
        warning: { DEFAULT: "#F59E0B", bg: "#FFFBEB" },
        danger: { DEFAULT: "#EF4444", bg: "#FEF2F2" },
        info: { DEFAULT: "#3B82F6", bg: "#EFF6FF" },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "slide-up": { from: { opacity: "0", transform: "translateY(8px)" }, to: { opacity: "1", transform: "translateY(0)" } },
        "accordion-down": { from: { height: "0" }, to: { height: "var(--radix-accordion-content-height)" } },
        "accordion-up": { from: { height: "var(--radix-accordion-content-height)" }, to: { height: "0" } },
      },
      animation: {
        "fade-in": "fade-in 0.2s ease-out",
        "slide-up": "slide-up 0.25s ease-out",
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
