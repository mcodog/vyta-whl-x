import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // PURA Color System
        ink: {
          DEFAULT: '#1A1A1A',
          muted: '#6E6E6E',
          light: '#8A8A8A',
        },
        bronze: {
          DEFAULT: '#9C8B5A',
          light: '#B8A876',
          dark: '#7D6F48',
          50: '#FAF8F3',
          100: '#F2EEE3',
        },
        surface: {
          DEFAULT: '#F7F7F7',
          2: '#F2F2F2',
        },
        line: '#C9CCD1',
        // Keep primary/accent for backwards compatibility during transition
        primary: {
          50: '#FAF8F3',
          100: '#F2EEE3',
          200: '#E5DCC7',
          300: '#D4C9A8',
          400: '#B8A876',
          500: '#9C8B5A',
          600: '#7D6F48',
          700: '#5E5336',
          800: '#3F3824',
          900: '#1A1A1A',
        },
        accent: {
          50: '#FAF8F3',
          100: '#F2EEE3',
          200: '#E5DCC7',
          300: '#D4C9A8',
          400: '#B8A876',
          500: '#9C8B5A',
          600: '#7D6F48',
          700: '#5E5336',
          800: '#3F3824',
          900: '#1A1A1A',
        },
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'SF Pro Display', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'sans-serif'],
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
