import { defineConfig, loadEnv } from 'vite';

const env = loadEnv('', process.cwd(), '');

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    pool: 'forks',
    fileParallelism: false,
    env: {
      PULSO_TEST_DATABASE_URL: env['PULSO_TEST_DATABASE_URL'] ?? '',
      DATABASE_URL: env['DATABASE_URL'] ?? '',
    },
  },
});
