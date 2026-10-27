// Empaqueta el cliente de subida de Vercel Blob para la web (public/blob-client.js).
import { build } from "esbuild";
await build({
  stdin: { contents: 'import { upload } from "@vercel/blob/client"; window.EPBlob = { upload };', resolveDir: process.cwd() },
  bundle: true, minify: true, format: "iife", platform: "browser", target: "es2020",
  outfile: "public/blob-client.js", logLevel: "warning",
});
console.log("public/blob-client.js listo");
