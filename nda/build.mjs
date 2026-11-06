// Builds the encrypted NDA vault (nda/vault/) from plaintext sources kept OUTSIDE the repo.
//
//   node nda/build.mjs [sourceDir]
//
// sourceDir (default D:/andrefelipemm-NDA-source) contains:
//   hub.json        cards shown on other.html  { banner, cards: [{ title, thumb, page }] }
//   pages/*.html    the original NDA project pages (same template as the public pages)
//   img/...         every image/video those pages reference, at the same relative path
//
// Password: taken from the NDA_PASSWORD env var, otherwise asked for (hidden input).
// Builds are incremental: unchanged files keep the same name and bytes, removed ones are deleted.
import { webcrypto as crypto } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ITERATIONS = 600000;
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(REPO, "nda", "vault");
const SRC = path.resolve(process.argv[2] || "D:/andrefelipemm-NDA-source");

const MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
   ".webp": "image/webp", ".mp4": "video/mp4", ".webm": "video/webm" };

function askHidden(question) {
   return new Promise((resolve) => {
      process.stdout.write(question);
      const stdin = process.stdin;
      stdin.setRawMode?.(true);
      stdin.resume();
      stdin.setEncoding("utf8");
      let value = "";
      stdin.on("data", function onData(ch) {
         if (ch === "\r" || ch === "\n" || ch === "\u0004") {
            stdin.setRawMode?.(false);
            stdin.pause();
            stdin.removeListener("data", onData);
            process.stdout.write("\n");
            resolve(value);
         } else if (ch === "\u0003") {
            process.exit(1);
         } else if (ch === "\u007f" || ch === "\b") {
            value = value.slice(0, -1);
         } else {
            value += ch;
         }
      });
   });
}

async function getPassword() {
   if (process.env.NDA_PASSWORD) return process.env.NDA_PASSWORD;
   const a = await askHidden("NDA password: ");
   const b = await askHidden("Repeat password: ");
   if (a !== b) throw new Error("Passwords do not match");
   return a;
}

const MAX_FILE = 95 * 1024 * 1024; // GitHub rejects files over 100 MB

async function main() {
   const hub = JSON.parse(fs.readFileSync(path.join(SRC, "hub.json"), "utf8"));
   const password = await getPassword();
   if (password.length < 12) throw new Error("Use a password of at least 12 characters");

   // Reuse the salt so unchanged files produce identical ciphertext (keeps git small).
   // Pass --new-salt to force a fresh one; a new password changes every file anyway.
   const metaFile = path.join(OUT, "meta.json");
   const salt = fs.existsSync(metaFile) && !process.argv.includes("--new-salt")
      ? Buffer.from(JSON.parse(fs.readFileSync(metaFile, "utf8")).salt, "base64")
      : crypto.getRandomValues(new Uint8Array(16));
   const pwBytes = new TextEncoder().encode(password);
   const base = await crypto.subtle.importKey("raw", pwBytes, "PBKDF2", false, ["deriveKey"]);
   const key = await crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations: ITERATIONS },
      base, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
   // Separate build-only key for naming files and deriving IVs (never shipped to the browser).
   const macSalt = Buffer.concat([Buffer.from(salt), Buffer.from("|names")]);
   const macKey = await crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: macSalt, iterations: ITERATIONS },
      base, { name: "HMAC", hash: "SHA-256", length: 256 }, false, ["sign"]);
   const mac = async (label, bytes) =>
      Buffer.from(await crypto.subtle.sign("HMAC", macKey, Buffer.concat([Buffer.from(label), bytes])));

   // Synthetic IV: unique per distinct plaintext, identical for identical plaintext.
   const encrypt = async (bytes) => {
      const iv = (await mac("iv|", bytes)).subarray(0, 12);
      const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, bytes));
      return Buffer.concat([iv, ct]);
   };

   fs.mkdirSync(OUT, { recursive: true });
   const keep = new Set(["meta.json", "index.bin"]);

   const assets = {};      // blob id -> mime
   const assetIds = {};    // source relative path -> blob id
   async function addAsset(rel) {
      rel = decodeURI(rel).replace(/^\.\//, "");
      if (assetIds[rel]) return assetIds[rel];
      const file = path.join(SRC, rel);
      if (!fs.existsSync(file)) throw new Error(`Missing source asset ${rel}`);
      const bytes = fs.readFileSync(file);
      if (bytes.length > MAX_FILE) throw new Error(`${rel} is over 95 MB; GitHub will reject it. Compress it first.`);
      const id = (await mac("name|", bytes)).subarray(0, 12).toString("hex");
      const out = path.join(OUT, id + ".bin");
      if (fs.existsSync(out)) {
         console.log("  unchanged", rel);
      } else {
         fs.writeFileSync(out, await encrypt(bytes));
         console.log("  encrypted", rel);
      }
      keep.add(id + ".bin");
      assets[id] = MIME[path.extname(rel).toLowerCase()] || "application/octet-stream";
      assetIds[rel] = id;
      return id;
   }

   const pages = {};
   const cards = [];
   for (const [i, card] of hub.cards.entries()) {
      const id = "p" + (i + 1);
      const html = fs.readFileSync(path.join(SRC, "pages", card.page), "utf8");
      const title = html.match(/class="project-title[^>]*>\s*<p[^>]*>([\s\S]*?)<\/p>/)[1].trim();
      const banner = html.match(/class="banner[^"]*"[^>]*url\(([^)]+)\)/)[1];
      let body = html.split(/class="preview-box-project[^"]*">/)[1].split(/<script>/)[0];
      body = body.replace(/<!--[\s\S]*?-->/g, "").replace(/\s*<\/div>\s*<\/div>\s*$/, "\n");
      const srcs = [...body.matchAll(/src="(img\/[^"]+)"/g)].map((m) => m[1]);
      for (const s of srcs) body = body.split(`src="${s}"`).join(`data-nda-src="${await addAsset(s)}"`);
      pages[id] = { title, banner: await addAsset(banner), body: body.trim() };
      cards.push({ title: card.title, thumb: await addAsset(card.thumb), page: id });
   }

   const index = { banner: await addAsset(hub.banner), cards, pages, assets };
   fs.writeFileSync(path.join(OUT, "index.bin"), await encrypt(new TextEncoder().encode(JSON.stringify(index))));
   fs.writeFileSync(metaFile,
      JSON.stringify({ v: 1, iterations: ITERATIONS, salt: Buffer.from(salt).toString("base64") }) + "\n");
   let removed = 0;
   for (const f of fs.readdirSync(OUT)) if (!keep.has(f)) { fs.rmSync(path.join(OUT, f)); removed++; }
   console.log(`Vault written to ${OUT} (${Object.keys(assets).length} assets, ${cards.length} pages, ${removed} stale files removed)`);
}

main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
