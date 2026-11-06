history.scrollRestoration = "manual";

/* Adds the author header to the top of a project page's info panel (.project-title).
   Project pages already contain it in their HTML; this covers pages rendered by nda.js. */
function addProjectAuthor(root) {
   const panel = (root || document).querySelector(".bodymargin-project .project-title");
   if (!panel || panel.querySelector(".project-author")) return;
   panel.insertAdjacentHTML("afterbegin", `
      <a class="project-author inter" href="about.html">
         <img src="profile.jpg" alt="André Felipe">
         <div>
            <div class="project-author-name">André Felipe</div>
            <div class="project-author-role">Senior 3D Environment Artist</div>
         </div>
      </a>`);
}

/* Video player used on every project page (and by nda.js).
   Builds the control bar inside the page's existing .player__controls:
   play/pause, seekable progress bar (mouse + touch, drag), time, mute + volume slider, fullscreen.
   Keyboard (when the player has focus): Space/K play, F fullscreen, M mute, arrows seek / volume. */
const PLAYER_ICONS = {
   play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>',
   pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>',
   volume: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15 8.5a5 5 0 0 1 0 7M17.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
   muted: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9.5l5 5M20.5 9.5l-5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
   full: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
   exitFull: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

function formatTime(s) {
   if (!isFinite(s)) return "0:00";
   s = Math.max(0, Math.floor(s));
   const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = String(s % 60).padStart(2, "0");
   return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

function initPlayer(player) {
   if (player.dataset.ready) return;
   const video = player.querySelector(".viewer");
   const controls = player.querySelector(".player__controls");
   const bigIcon = player.querySelector(".play-icon");
   if (!video || !controls) return;
   player.dataset.ready = "1";
   player.removeAttribute("title");
   player.tabIndex = 0;
   player.setAttribute("role", "region");
   player.setAttribute("aria-label", video.getAttribute("aria-label") || "Video player");
   video.controls = false;
   video.playsInline = true;

   controls.classList.add("pc");
   controls.innerHTML = `
      <div class="pc-progress" role="slider" aria-label="Seek" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" tabindex="0">
         <div class="pc-track"><div class="pc-buffered"></div><div class="pc-filled"></div><div class="pc-thumb"></div></div>
      </div>
      <div class="pc-row">
         <button type="button" class="pc-btn pc-play" aria-label="Play">${PLAYER_ICONS.play}</button>
         <div class="pc-volume-group">
            <button type="button" class="pc-btn pc-mute" aria-label="Mute">${PLAYER_ICONS.volume}</button>
            <input type="range" class="pc-volume" min="0" max="1" step="0.01" value="1" aria-label="Volume">
         </div>
         <span class="pc-time"><span class="pc-current">0:00</span> / <span class="pc-duration">0:00</span></span>
         <span class="pc-spacer"></span>
         <button type="button" class="pc-btn pc-fullscreen" aria-label="Fullscreen">${PLAYER_ICONS.full}</button>
      </div>`;

   const $ = (s) => controls.querySelector(s);
   const progress = $(".pc-progress"), filled = $(".pc-filled"), buffered = $(".pc-buffered"), thumb = $(".pc-thumb");
   const playBtn = $(".pc-play"), muteBtn = $(".pc-mute"), volume = $(".pc-volume"), fullBtn = $(".pc-fullscreen");
   const current = $(".pc-current"), duration = $(".pc-duration");

   // ---- play / pause ----
   const toggle = () => (video.paused || video.ended ? video.play() : video.pause());
   const syncPlay = () => {
      const paused = video.paused || video.ended;
      playBtn.innerHTML = paused ? PLAYER_ICONS.play : PLAYER_ICONS.pause;
      playBtn.setAttribute("aria-label", paused ? "Play" : "Pause");
      player.classList.toggle("is-paused", paused);
      if (bigIcon) {
         bigIcon.classList.toggle("play-icon", paused);
         bigIcon.classList.toggle("play-icon-invisible", !paused);
      }
      if (paused) showControls(false); else hideSoon();
   };
   video.addEventListener("play", syncPlay);
   video.addEventListener("pause", syncPlay);
   video.addEventListener("ended", syncPlay);
   playBtn.addEventListener("click", (e) => { e.stopPropagation(); toggle(); });
   // clicking the picture toggles play; a double click toggles fullscreen
   let clickTimer = null;
   video.addEventListener("click", () => {
      clearTimeout(clickTimer);
      clickTimer = setTimeout(toggle, 220);
   });
   video.addEventListener("dblclick", () => { clearTimeout(clickTimer); toggleFullscreen(); });
   if (bigIcon) bigIcon.addEventListener("click", (e) => { e.stopPropagation(); toggle(); });

   // ---- progress / seeking (pointer events cover mouse, pen and touch) ----
   const setProgress = (ratio) => {
      const pct = Math.min(100, Math.max(0, ratio * 100));
      filled.style.width = pct + "%";
      thumb.style.left = pct + "%";
      progress.setAttribute("aria-valuenow", Math.round(pct));
   };
   const ratioAt = (clientX) => {
      const r = progress.getBoundingClientRect();
      return Math.min(1, Math.max(0, (clientX - r.left) / r.width));
   };
   let seeking = false;
   const seekTo = (clientX) => {
      if (!video.duration) return;
      const ratio = ratioAt(clientX);
      video.currentTime = ratio * video.duration;
      setProgress(ratio);
   };
   progress.addEventListener("pointerdown", (e) => {
      seeking = true;
      try { progress.setPointerCapture(e.pointerId); } catch (err) {}
      player.classList.add("is-seeking");
      seekTo(e.clientX);
   });
   progress.addEventListener("pointermove", (e) => { if (seeking) seekTo(e.clientX); });
   const endSeek = () => { seeking = false; player.classList.remove("is-seeking"); };
   progress.addEventListener("pointerup", endSeek);
   progress.addEventListener("pointercancel", endSeek);
   progress.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight") { video.currentTime = Math.min(video.duration || 0, video.currentTime + 5); e.preventDefault(); }
      if (e.key === "ArrowLeft") { video.currentTime = Math.max(0, video.currentTime - 5); e.preventDefault(); }
   });
   video.addEventListener("timeupdate", () => {
      if (!seeking && video.duration) setProgress(video.currentTime / video.duration);
      current.textContent = formatTime(video.currentTime);
   });
   const syncDuration = () => { duration.textContent = formatTime(video.duration); };
   video.addEventListener("loadedmetadata", syncDuration);
   video.addEventListener("durationchange", syncDuration);
   video.addEventListener("progress", () => {
      if (video.duration && video.buffered.length) {
         buffered.style.width = (video.buffered.end(video.buffered.length - 1) / video.duration) * 100 + "%";
      }
   });
   if (video.readyState >= 1) syncDuration();

   // ---- volume ----
   const syncVolume = () => {
      const silent = video.muted || video.volume === 0;
      muteBtn.innerHTML = silent ? PLAYER_ICONS.muted : PLAYER_ICONS.volume;
      muteBtn.setAttribute("aria-label", silent ? "Unmute" : "Mute");
      volume.value = silent ? 0 : video.volume;
      volume.style.setProperty("--vol", (silent ? 0 : video.volume) * 100 + "%");
   };
   let lastVolume = 1;
   muteBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (video.muted || video.volume === 0) {
         video.muted = false;
         video.volume = lastVolume || 1;
      } else {
         lastVolume = video.volume;
         video.muted = true;
      }
   });
   volume.addEventListener("input", () => {
      video.volume = parseFloat(volume.value);
      video.muted = video.volume === 0;
      if (video.volume > 0) lastVolume = video.volume;
   });
   video.addEventListener("volumechange", syncVolume);
   syncVolume();

   // ---- fullscreen (Fullscreen API on the whole player; iOS falls back to native video fullscreen) ----
   const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement;
   function toggleFullscreen() {
      if (fsElement()) {
         (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      } else if (player.requestFullscreen) {
         player.requestFullscreen().catch(() => {});
      } else if (player.webkitRequestFullscreen) {
         player.webkitRequestFullscreen();
      } else if (video.webkitEnterFullscreen) {
         video.webkitEnterFullscreen();
      }
   }
   const syncFullscreen = () => {
      const on = fsElement() === player;
      player.classList.toggle("is-fullscreen", on);
      fullBtn.innerHTML = on ? PLAYER_ICONS.exitFull : PLAYER_ICONS.full;
      fullBtn.setAttribute("aria-label", on ? "Exit fullscreen" : "Fullscreen");
   };
   fullBtn.addEventListener("click", (e) => { e.stopPropagation(); toggleFullscreen(); });
   document.addEventListener("fullscreenchange", syncFullscreen);
   document.addEventListener("webkitfullscreenchange", syncFullscreen);

   // ---- auto-hide controls while playing ----
   let hideTimer = null;
   function showControls(autoHide = true) {
      player.classList.add("show-controls");
      clearTimeout(hideTimer);
      if (autoHide) hideSoon();
   }
   function hideSoon() {
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
         if (!video.paused && !seeking) player.classList.remove("show-controls");
      }, 2500);
   }
   player.addEventListener("pointermove", () => showControls(!video.paused));
   player.addEventListener("pointerdown", () => showControls(!video.paused));
   player.addEventListener("mouseleave", () => { if (!video.paused) player.classList.remove("show-controls"); });
   player.addEventListener("focusin", () => showControls(!video.paused));

   // ---- keyboard ----
   player.addEventListener("keydown", (e) => {
      if (e.target === volume) return;
      const k = e.key.toLowerCase();
      if (k === " " || k === "k") { if (e.target.tagName !== "BUTTON") { toggle(); e.preventDefault(); } }
      else if (k === "f") { toggleFullscreen(); }
      else if (k === "m") { muteBtn.click(); }
      else if (k === "arrowup") { video.volume = Math.min(1, video.volume + 0.1); video.muted = false; e.preventDefault(); }
      else if (k === "arrowdown") { video.volume = Math.max(0, video.volume - 0.1); e.preventDefault(); }
      else if (e.target !== progress && k === "arrowright") { video.currentTime = Math.min(video.duration || 0, video.currentTime + 5); }
      else if (e.target !== progress && k === "arrowleft") { video.currentTime = Math.max(0, video.currentTime - 5); }
      showControls(!video.paused);
   });

   syncPlay();
}

function initPlayers(root) {
   (root || document).querySelectorAll(".player").forEach(initPlayer);
}

/* E-mail links are written as "user [at] domain" in the HTML (harder for spam bots to scrape)
   and turned into a real mailto link here. */
function initEmailLinks() {
   document.querySelectorAll(".email-link[data-user][data-domain]").forEach((a) => {
      const address = `${a.dataset.user}@${a.dataset.domain}`;
      a.href = `mailto:${address}`;
      a.textContent = address;
   });
}

/* Home page filter tabs: show cards whose data-category matches. The choice is remembered for the
   tab session, so coming back from a project keeps the same filter. */
function initFilters() {
   const buttons = document.querySelectorAll(".filter-btn");
   if (!buttons.length) return;
   const cards = document.querySelectorAll(".preview-box .container[data-category]");
   const apply = (filter) => {
      buttons.forEach((b) => b.classList.toggle("active", b.dataset.filter === filter));
      cards.forEach((c) => { c.hidden = filter !== "all" && c.dataset.category !== filter; });
      try { sessionStorage.setItem("home-filter", filter); } catch (e) {}
   };
   buttons.forEach((b) => b.addEventListener("click", () => apply(b.dataset.filter)));
   let saved = "all";
   try { saved = sessionStorage.getItem("home-filter") || "all"; } catch (e) {}
   apply([...buttons].some((b) => b.dataset.filter === saved) ? saved : "all");
}

document.addEventListener("DOMContentLoaded", () => {
   addProjectAuthor();
   initPlayers();
   initEmailLinks();
   initFilters();
});
