import type { Config } from 'tailwindcss';

/**
 * Design tokens in Inaaya Store's style (inaayastore.com): near-black ink on
 * white, Plus Jakarta Sans, square corners.  Red is kept for problems only.
 * Sizes stay large on the merchant's request, so everyone can read the portal.
 */
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#030302',
          soft: '#5B5A56',
          tint: '#F4F2EE',
        },
        danger: {
          DEFAULT: '#C62828',
          tint: '#FDECEA',
        },
        text: {
          primary: '#303133',
          regular: '#606266',
          secondary: '#909399',
        },
        line: {
          DEFAULT: '#DCDFE6',
          light: '#EBEEF5',
        },
        surface: {
          page: '#F5F7FA',
          head: '#FAFAFA',
          card: '#F5F7FA',
        },
      },
      fontFamily: {
        sans: [
          'Plus Jakarta Sans',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
        serif: ['Cormorant Garamond', 'Georgia', 'Times New Roman', 'serif'],
      },
      fontSize: {
        base: ['15px', '22px'],
        title: ['17px', '24px'],
        mini: ['13px', '18px'],
      },
      borderRadius: {
        DEFAULT: '2px',
      },
      spacing: {
        sidebar: '272px',
        topbar: '64px',
        control: '40px',
      },
    },
  },
  plugins: [],
};

export default config;
