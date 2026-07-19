import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Netlify sets COMMIT_REF to the deployed commit's full SHA during builds.
const commitSha = process.env.COMMIT_REF ?? 'dev';

export default defineConfig({
  plugins: [react()],
  define: {
    __COMMIT_SHA__: JSON.stringify(commitSha),
  },
});
