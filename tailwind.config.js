/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
    "./*.{js,ts,jsx,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        // 主色调
        sky: {
          50: '#f0f9ff',
          100: '#e0f2fe',
          400: '#38bdf8',
          500: '#4A90E2',
          600: '#3b7bc9',
          700: '#2c5fa3',
        },
        mint: {
          100: '#d1fae5',
          300: '#6ee7b7',
          400: '#5FD4A0',
          500: '#4ec190',
          600: '#3da876',
        },
        sunset: {
          400: '#FFB84D',
          500: '#ffa933',
          600: '#e69520',
        },
        // 强调色（豆沙护眼绿主调）
        // Why: 主色调以森林绿为核心，蓝/紫/橙做辅助；豆沙底上均通过 WCAG AA
        neon: {
          blue: '#1F6FB2',     // 深橄榄蓝（次强调）
          purple: '#6D28D9',   // 葡萄紫
          pink: '#B91C1C',     // 醒目红（仅 wrong/error）
          green: '#15803D',    // 森林绿（主强调色）
          amber: '#B45309',    // 柿子橙
        },
        // 主背景 / 表面（豆沙护眼系）
        cyber: {
          bg: '#E8EFE3',       // 豆沙绿（主背景）
          bg2: '#DDE5D7',      // 深一档豆沙（次级面板）
          surface: '#F0F4EC',  // 卡片底（更亮的豆沙白）
          border: '#C6D1BD',   // 苔藓灰绿边
          text: '#2A3026',     // 深橄榄主文字（WCAG AAA）
          muted: '#5C6655',    // 苔藓灰次文字
        },
        // 学科色彩
        math: {
          DEFAULT: '#3B82F6',
          light: '#DBEAFE',
        },
        chinese: {
          DEFAULT: '#FB7185',
          light: '#FECDD3',
        },
        english: {
          DEFAULT: '#A78BFA',
          light: '#E9D5FF',
        },
        science: {
          DEFAULT: '#10B981',
          light: '#D1FAE5',
        },
        // 背景色
        paper: '#F8F9FA',
      },
      fontFamily: {
        sans: ['Inter', '"PingFang SC"', '"Microsoft YaHei"', 'system-ui', '-apple-system', 'sans-serif'],
      },
      boxShadow: {
        // 豆沙基调下用深橄榄绿做阴影色，避免普通灰阴影显脏
        'card': '0 1px 3px rgba(42, 48, 38, 0.08), 0 1px 2px rgba(42, 48, 38, 0.05)',
        'card-hover': '0 4px 12px rgba(21, 128, 61, 0.12)',
        'modal': '0 10px 24px rgba(42, 48, 38, 0.14)',
        'glow': '0 4px 12px rgba(21, 128, 61, 0.18)',
        'glow-sm': '0 2px 6px rgba(21, 128, 61, 0.12)',
        'glow-amber': '0 2px 8px rgba(180, 83, 9, 0.18)',
        'glow-cyan-lg': '0 4px 16px rgba(31, 111, 178, 0.20)',
      },
      backgroundImage: {
        // 豆沙渐变：上浅下稍深，有层次但不刺眼
        'cyber-gradient': 'linear-gradient(180deg, #ECF2E7 0%, #E1E9DC 100%)',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'float': 'float 3s ease-in-out infinite',
        'shimmer': 'shimmer 2s linear infinite',
        'fade-in': 'fadeIn 0.4s ease-out',
        'slide-up': 'slideUp 0.3s ease-out',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-6px)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      backdropBlur: {
        xs: '2px',
      },
      typography: ({ theme }) => ({
        DEFAULT: {
          css: {
            '--tw-prose-body': theme('colors.gray[700]'),
            '--tw-prose-headings': theme('colors.gray[900]'),
            '--tw-prose-links': theme('colors.blue[600]'),
            '--tw-prose-bold': theme('colors.gray[900]'),
            '--tw-prose-quotes': theme('colors.gray[900]'),
            '--tw-prose-quote-borders': theme('colors.blue[500]'),
            '--tw-prose-captions': theme('colors.gray[500]'),
            '--tw-prose-code': theme('colors.blue[600]'),
            '--tw-prose-pre-code': theme('colors.gray[100]'),
            '--tw-prose-pre-bg': theme('colors.gray[900]'),
            '--tw-prose-th-borders': theme('colors.gray[200]'),
            '--tw-prose-td-borders': theme('colors.gray[100]'),
            maxWidth: 'none',
            img: {
              borderRadius: theme('borderRadius.2xl'),
              boxShadow: theme('boxShadow.lg'),
            },
            a: {
              textDecoration: 'none',
              fontWeight: '600',
              '&:hover': {
                textDecoration: 'underline',
              },
            },
            blockquote: {
              fontStyle: 'normal',
              fontWeight: '400',
              backgroundColor: theme('colors.blue[50]'),
              padding: `${theme('spacing.1')} ${theme('spacing.4')}`,
              borderRadius: theme('borderRadius.r-lg'),
            },
            code: {
              backgroundColor: theme('colors.gray[100]'),
              padding: '2px 6px',
              borderRadius: '4px',
              fontWeight: '400',
            },
            'code::before': { content: 'none' },
            'code::after': { content: 'none' },
          },
        },
        sepia: {
          css: {
            '--tw-prose-body': '#433422',
            '--tw-prose-headings': '#111',
            '--tw-prose-links': '#92400e',
            '--tw-prose-bg': '#f4ecd8',
          },
        },
      }),
    }
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
}
