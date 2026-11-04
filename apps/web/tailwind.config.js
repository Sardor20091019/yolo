module.exports = {
  content: [
    "./src/**/*.{html,ts}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        dark: {
          bg: '#08090b',
          card: '#0f1115',
          elevated: '#16181f',
          border: 'rgba(255, 255, 255, 0.07)',
          borderHover: 'rgba(255, 255, 255, 0.14)',
        },
        studio: {
          bone: '#f4f4f6',
          muted: '#8e95a5',
          dim: '#525866',
          safe: '#10b981',
          warning: '#f59e0b',
          danger: '#f43f5e',
        }
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      letterSpacing: {
        tightest: '-0.035em',
        widest: '0.2em',
      }
    },
  },
  plugins: [],
}
