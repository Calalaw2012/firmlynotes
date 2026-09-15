import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Default config: this app doesn't use ISR/on-demand revalidation or
// incremental caching, so the plain default (no KV/R2 cache overrides) is
// all it needs. See https://opennext.js.org/cloudflare for the options
// available here if that changes later.
export default defineCloudflareConfig();
