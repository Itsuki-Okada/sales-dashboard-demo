import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// host: true にすることで、同じネットワーク内の他の端末からも
// http://<このPCのIPアドレス>:5173 でアクセスできるようになります。
//
// base: "./" にすることで、GitHub Pages のようにサブパス
// (https://<user>.github.io/<repo>/) で配信されても
// アセットのパスが正しく解決されます。
export default defineConfig({
  plugins: [react()],
  base: "./",
  server: {
    host: true,
    port: 5173,
  },
  preview: {
    host: true,
    port: 4173,
  },
});
