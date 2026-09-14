import type { Config } from 'tailwindcss';

/**
 * VYTA Biosciences design tokens.
 * ---------------------------------------------------------------------------
 * Brand Identity Guidelines v1.0 — "Premium bioscience. Human vitality.
 * Clinical credibility."
 *
 * Midnight Navy is the anchor; Vital Blue, Bio Teal and Aqua carry vitality;
 * Mist and Cloud create the breathing room the guidelines ask for. The named
 * brand swatches below are the canonical values — every other scale in this
 * file is interpolated from them so a `-500` or `-700` step always lands on,
 * or between, two real brand colors.
 */
const brand = {
  navy: '#07203A',   // Midnight Navy — anchor
  ocean: '#0E3F5F',  // Deep Ocean
  vital: '#1B5D83',  // Vital Blue
  teal: '#438B9E',   // Bio Teal
  aqua: '#6EB2B8',   // Aqua
  mist: '#BBD6D6',   // Mist
  cloud: '#F7FAFB',  // Cloud — page ground
} as const;

/**
 * The single brand ramp. Light steps breathe (Cloud/Mist), mid steps carry the
 * vitality accents (Aqua/Bio Teal) and dark steps anchor (Vital Blue → Deep
 * Ocean → Midnight Navy). `vital`, `primary` and `accent` all share it so an
 * accent swap is a one-line change here.
 */
const ramp = {
  50: '#F2F8F9',
  100: '#E1EFF1',
  200: '#C9DFE2',
  300: '#9CC8CE',
  400: brand.aqua,
  500: brand.teal,
  600: '#34718A',
  700: brand.vital,
  800: brand.ocean,
  900: brand.navy,
};

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Named brand swatches, straight from the guidelines.
        navy: brand.navy,
        ocean: brand.ocean,
        teal: { ...ramp, DEFAULT: brand.teal },
        aqua: brand.aqua,
        mist: brand.mist,
        cloud: brand.cloud,

        // Ink — body copy and dark surfaces. Anchored on Midnight Navy, with
        // two cooled-down steps for secondary and tertiary text.
        ink: {
          DEFAULT: brand.navy,
          muted: '#4E6E85',
          light: '#7E99AB',
        },
        // Vital — the accent that replaces the old vital. Bio Teal leads,
        // Aqua lifts it on dark grounds, Vital Blue grounds it on light ones.
        vital: {
          ...ramp,
          DEFAULT: brand.teal,
          light: brand.aqua,
          dark: brand.vital,
        },
        surface: {
          DEFAULT: brand.cloud,
          2: '#EFF5F7',
        },
        line: '#D5E2E7',
        primary: ramp,
        accent: ramp,
      },
      fontFamily: {
        // Inter for body copy, UI, specifications and long-form text.
        sans: ['var(--font-inter)', 'Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'sans-serif'],
        // Inter Display for headings, product names and campaigns. Same family,
        // driven to its display optical size by the `.font-display` utility.
        display: ['var(--font-inter)', 'Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'sans-serif'],
      },
      backgroundImage: {
        // Soft gradients, per the design language. `brand` is the navy → aqua
        // sweep used on rules, buttons and hero washes.
        'brand': `linear-gradient(90deg, ${brand.navy} 0%, ${brand.ocean} 35%, ${brand.teal} 75%, ${brand.aqua} 100%)`,
        'brand-diagonal': `linear-gradient(135deg, ${brand.navy} 0%, ${brand.vital} 55%, ${brand.teal} 100%)`,
        'brand-soft': `linear-gradient(180deg, ${brand.cloud} 0%, #FFFFFF 60%, ${brand.cloud} 100%)`,
      },
      animation: {
        'fade-in': 'fadeIn 0.6s cubic-bezier(0.4, 0, 0.2, 1)',
        'slide-up': 'slideUp 0.6s cubic-bezier(0.4, 0, 0.2, 1)',
        'slide-in-right': 'slideInRight 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
        'float': 'float 3s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { transform: 'translateY(30px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        slideInRight: {
          '0%': { transform: 'translateX(100%)' },
          '100%': { transform: 'translateX(0)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-20px)' },
        },
      },
      backdropBlur: {
        xs: '2px',
      },
    },
  },
  plugins: [],
};
export default config;
