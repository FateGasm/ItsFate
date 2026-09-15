import { defineConfig } from "astro/config";

import mdx from "@astrojs/mdx";
import tailwindcss from "@tailwindcss/vite";

// https://astro.build/config
export default defineConfig({
  site: "https://itsfate.dev", // TODO: real domain; needed for absolute og:url / og:image
  integrations: [mdx()],
  vite: {
    plugins: [tailwindcss()]
  }
});