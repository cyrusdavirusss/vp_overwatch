import next from 'eslint-config-next'

/**
 * Flat config for ESLint 9.
 *
 * This exists because Next 16 removed the `next lint` subcommand, which is what the
 * `lint` script used to call — so `npm run lint` had been failing outright with
 * "Invalid project directory provided, no such directory: .../lint". Next 16 ships its
 * config as a flat config, so it is spread in directly rather than through a compat shim.
 *
 * `next/core-web-vitals` is deliberately NOT used: this app is a real-time map whose
 * whole job is live data, so the web-vitals ruleset (which chases LCP/CLS on content
 * pages) would be mostly noise. The default ruleset is the one that catches defects.
 *
 * @type {import('eslint').Linter.Config[]}
 */
export default [
  ...(Array.isArray(next) ? next : [next]),
  {
    // Build output, generated bundles and uploaded artifacts are not source. Linting
    // them reports findings in code nobody wrote and nobody will fix — and the
    // Capacitor Android build output alone produced parse fatals.
    ignores: [
      '.next/**',
      '.next-verify/**',
      'node_modules/**',
      'out/**',
      'dist/**',
      'public/**',
      'uploads/**',
      'android/**',
      '**/*.d.ts',
      '**/*.min.js',
    ],
  },
]
