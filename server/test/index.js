// Cho phép chạy `node --test server/test/` (Node 24 coi thư mục như một module → nạp index.js):
// nạp mọi file *.test.mjs trong thư mục này. `npm test` / `node --test 'test/*.test.mjs'` không cần file này.
import { readdirSync } from "node:fs";

for (const f of readdirSync(new URL(".", import.meta.url)).filter((f) => f.endsWith(".test.mjs")).sort()) {
  await import(new URL(f, import.meta.url));
}
