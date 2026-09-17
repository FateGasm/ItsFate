import { defineConfig } from "astro/config";

import mdx from "@astrojs/mdx";
import tailwindcss from "@tailwindcss/vite";

// https://astro.build/config
export default defineConfig({
  // site: "https://itsfate.dev", // TODO: purchase domain
  site: "https://itsfate.fategasm.workers.dev",
  integrations: [mdx()],
  vite: {
    plugins: [tailwindcss()]
  }
});
