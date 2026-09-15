import type { Config } from 'tailwindcss';

/**
 * Design tokens transcribed from the supplied portal screenshots (spec 4.1).
 * Do not "improve" these values - the UI is judged against those images.
 */
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        jt: {
          red: '#DA251C',
          'red-soft': '#F08A85',
          'red-nav': '#E3001B',
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
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
      },
      fontSize: {
        base: ['13px', '20px'],
        title: ['14px', '22px'],
        mini: ['11px', '16px'],
      },
      borderRadius: {
        DEFAULT: '4px',
      },
      spacing: {
        sidebar: '253px',
        topbar: '56px',
        control: '32px',
      },
    },
  },
  plugins: [],
};

export default config;
