import { createServer } from "vite";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("./", import.meta.url));
const server = await createServer({ root, configFile: fileURLToPath(new URL("vite.config.ts", import.meta.url)),
  cacheDir: fileURLToPath(new URL("../../.vite-contacts-preview", import.meta.url)),
  server: { host: "127.0.0.1", port: 18731, strictPort: true,
    proxy: { "/api": { target: "http://127.0.0.1:18730", changeOrigin: true } } },
});
await server.listen();
console.log("Contacts verification UI: http://127.0.0.1:18731/services/tools/department_contacts");
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { void server.close().then(() => process.exit(0)); });
