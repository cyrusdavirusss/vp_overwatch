import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-ui)'],
        mono: ['var(--font-mono)'],
      },
      colors: {
        ink: {
          0: 'var(--ink-0)',
          1: 'var(--ink-1)',
          2: 'var(--ink-2)',
          3: 'var(--ink-3)',
          4: 'var(--ink-4)',
        },
        fg: {
          1: 'var(--fg-1)',
          2: 'var(--fg-2)',
          3: 'var(--fg-3)',
          4: 'var(--fg-4)',
        },
        border: {
          DEFAULT: 'var(--border)',
          strong: 'var(--border-strong)',
          subtle: 'var(--border-subtle)',
        },
        signal: {
          blue: 'var(--blue)',
          'blue-hi': 'var(--blue-hi)',
          'blue-lo': 'var(--blue-lo)',
        },
        amber: {
          DEFAULT: 'var(--amber)',
          hi: 'var(--amber-hi)',
          lo: 'var(--amber-lo)',
        },
        red: {
          DEFAULT: 'var(--red)',
          hi: 'var(--red-hi)',
          lo: 'var(--red-lo)',
        },
        green: {
          DEFAULT: 'var(--green)',
        },
        stale: 'var(--stale)',
      },
      borderRadius: {
        sm: 'var(--r-sm)',
        md: 'var(--r-md)',
        lg: 'var(--r-lg)',
        xl: 'var(--r-xl)',
        full: 'var(--r-full)',
      },
      boxShadow: {
        sheet: 'var(--shadow-sheet)',
        fab: 'var(--shadow-fab)',
        panel: 'var(--shadow-panel)',
        pop: 'var(--shadow-pop)',
      },
      transitionTimingFunction: {
        spring: 'var(--ease-spring)',
        out: 'var(--ease-out)',
        in: 'var(--ease-in)',
      },
    },
  },
  plugins: [],
}

export default config
