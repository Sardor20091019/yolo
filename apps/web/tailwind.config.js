module.exports = {
  content: ['./src/**/*.{html,ts}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        obs: {
          bg: '#0b0b09',
          1: '#111110',
          2: '#171715',
          3: '#1e1e1c',
          4: '#252523',
        },
        'tx-1': '#d0cdc4',
        'tx-2': '#8c8880',
        'tx-3': '#524f4b',
        amber: {
          ops: '#a88840',
          'ops-dim': '#6b5828',
        },
        green: {
          ops: '#3d6b54',
        },
        red: {
          ops: '#7a4242',
        },
      },
      fontFamily: {
        mono: ['IBM Plex Mono', 'ui-monospace', 'Menlo', 'monospace'],
        sans: ['Space Grotesk', 'Inter', 'system-ui', 'sans-serif'],
      },
      letterSpacing: {
        label: '0.1em',
        wide2: '0.18em',
        spread: '0.25em',
      },
      borderColor: {
        DEFAULT: 'rgba(210,205,195,0.08)',
      },
    },
  },
  plugins: [],
}
