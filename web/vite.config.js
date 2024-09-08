import { defineConfig } from "vite";

export default defineConfig({
    define: {
        "import.meta.env.APP_VERSION": JSON.stringify(
            process.env.npm_package_version,
        ),
    },
    server: {
        proxy: {
            "/data": "ws://127.0.0.1:10110",
            "/sensors": "http://127.0.0.1:10110",
            "/configs": "http://127.0.0.1:10110",
        },
    },
});
