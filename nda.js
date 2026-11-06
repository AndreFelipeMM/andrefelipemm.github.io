/*
 * NDA vault runtime.
 * All NDA content (page bodies, images, videos) is stored in nda/vault/ as
 * AES-256-GCM ciphertext. The key is derived from the password with
 * PBKDF2-SHA256, so nothing in the repo is readable without the password.
 * Blobs are produced by nda/build.mjs — never commit plaintext NDA files.
 */
(function () {
   const VAULT = "nda/vault/";
   const KEY_SLOT = "nda-key";
   let key = null;
   let index = null;
   let liveUrls = [];

   const b64 = {
      enc: (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))),
      dec: (str) => Uint8Array.from(atob(str), (c) => c.charCodeAt(0)),
   };

   async function fetchBytes(name) {
      const res = await fetch(VAULT + name, { cache: "no-cache" });
      if (!res.ok) throw new Error("Missing vault file " + name);
      return new Uint8Array(await res.arrayBuffer());
   }

   async function decrypt(bytes) {
      const iv = bytes.slice(0, 12);
      return crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, bytes.slice(12));
   }

   async function deriveKey(password) {
      const meta = await fetch(VAULT + "meta.json", { cache: "no-cache" }).then((r) => r.json());
      const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
      return crypto.subtle.deriveKey(
         { name: "PBKDF2", hash: "SHA-256", salt: b64.dec(meta.salt), iterations: meta.iterations },
         base, { name: "AES-GCM", length: 256 }, true, ["decrypt"]);
   }

   async function loadIndex() {
      const plain = await decrypt(await fetchBytes("index.bin"));
      index = JSON.parse(new TextDecoder().decode(plain));
   }

   async function blobUrl(id) {
      const plain = await decrypt(await fetchBytes(id + ".bin"));
      const url = URL.createObjectURL(new Blob([plain], { type: index.assets[id] }));
      liveUrls.push(url);
      return url;
   }

   function releaseUrls() {
      liveUrls.forEach((u) => URL.revokeObjectURL(u));
      liveUrls = [];
   }

   async function unlock(password) {
      key = await deriveKey(password);
      await loadIndex(); // throws if the password is wrong (GCM auth fails)
      sessionStorage.setItem(KEY_SLOT, b64.enc(await crypto.subtle.exportKey("raw", key)));
   }

   async function restore() {
      const raw = sessionStorage.getItem(KEY_SLOT);
      if (!raw) return false;
      try {
         key = await crypto.subtle.importKey("raw", b64.dec(raw), "AES-GCM", false, ["decrypt"]);
         await loadIndex();
         return true;
      } catch (e) {
         lock();
         return false;
      }
   }

   function lock() {
      sessionStorage.removeItem(KEY_SLOT);
      key = null;
      index = null;
      releaseUrls();
   }

   /* ---------- rendering (same markup/classes as the public pages) ---------- */

   async function fillMedia(root) {
      for (const el of root.querySelectorAll("[data-nda-src]")) {
         el.src = await blobUrl(el.dataset.ndaSrc);
      }
   }

   async function renderHub(view) {
      releaseUrls();
      document.title = "André Felipe Environment Art - NDA and WIP section";
      view.innerHTML = `
         <div class="bodymargin">
            <div class="banner fadeInUp" data-nda-bg="${index.banner}"></div>
            <div class="portfolio fadeInUpDelay">
               <p class="inter" style="font-size: xx-large;">WIP, Sculpts and NDA</p>
            </div>
            <div class="preview-box  fadeInUpDelay">
               ${index.cards.map((c) => `
               <div class="container">
                  <div class="gradientoverlay"></div>
                  <a href="#${c.page}">
                  <img class="thumbnail" data-nda-src="${c.thumb}" alt="">
                  <div class="textparent">
                     <div class="text inter">${c.title}</div>
                  </div>
               </a>
               </div>`).join("")}
            </div>
         </div>`;
      await fillBanner(view);
      await fillMedia(view);
   }

   async function renderPage(view, id) {
      const page = index.pages[id];
      if (!page) return renderHub(view);
      releaseUrls();
      document.title = page.title.replace(/<[^>]+>/g, " ");
      view.innerHTML = `
         <div class="bodymargin-project">
            <div class="banner fadeInUp" data-nda-bg="${page.banner}"></div>
            <div class="project-title fadeInUpDelay" style="display: flex; justify-content: center;">
               <p class="inter" style="font-size: xx-large; align-self: center;">${page.title}</p>
            </div>
            <div class="preview-box-project  fadeInUpDelay">${page.body}</div>
         </div>`;
      window.scrollTo(0, 0);
      if (window.addProjectAuthor) window.addProjectAuthor(view);
      await fillBanner(view);
      view.querySelectorAll(".player").forEach(window.initPlayer || initPlayer);
      await fillMedia(view);
   }

   async function fillBanner(view) {
      const el = view.querySelector("[data-nda-bg]");
      if (el) el.style.backgroundImage = `url(${await blobUrl(el.dataset.ndaBg)})`;
   }

   /* Same behaviour as the inline player script on the public project pages. */
   function initPlayer(player) {
      const video = player.querySelector(".viewer");
      const progress = player.querySelector(".progress");
      const progressBar = player.querySelector(".progress__filled");
      const icon = player.querySelector(".play-icon");
      const showIcon = () => { icon.classList.remove("play-icon-invisible"); icon.classList.add("play-icon"); };
      const hideIcon = () => { icon.classList.remove("play-icon"); icon.classList.add("play-icon-invisible"); };
      const toggle = () => (video.paused ? video.play() : video.pause());
      let mousedown = false;
      const scrub = (e) => { video.currentTime = (e.offsetX / progress.offsetWidth) * video.duration; };
      player.addEventListener("click", (e) => { if (!progress.contains(e.target)) toggle(); });
      video.addEventListener("play", hideIcon);
      video.addEventListener("pause", showIcon);
      video.addEventListener("timeupdate", () => {
         progressBar.style.flexBasis = `${(video.currentTime / video.duration) * 100}%`;
      });
      progress.addEventListener("click", scrub);
      progress.addEventListener("mousemove", (e) => mousedown && scrub(e));
      progress.addEventListener("mousedown", () => (mousedown = true));
      window.addEventListener("mouseup", () => (mousedown = false));
   }

   window.NDA = { unlock, restore, lock, renderHub, renderPage };
})();
