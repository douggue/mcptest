import { fileURLToPath } from 'node:url';
import autoprefixer from 'autoprefixer';
import tailwindcss from 'tailwindcss';

export default {
  plugins: [
    tailwindcss({ config: fileURLToPath(new URL('./tailwind.config.js', import.meta.url)) }),
    autoprefixer(),
  ],
};
