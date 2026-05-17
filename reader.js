// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Storyplay Reader — multi-segment client
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const STATE = {
  manifest: null,
  chapterIdx: 0,
  chapter: null,            // current chapter object
  segments: [],             // segments of current chapter
  segOffsets: [],           // cumulative virtual-time start of each segment
  fragments: [],            // flattened, with virtual times
  segIdx: 0,                // currently loaded audio segment
  activeFragIdx: -1,
  audio: null,
  userScrubbing: false,
  pendingPlay: false,
  // visual-layer state (per-chapter scene/character data)
  sceneData: null,
  sceneFragRanges: [],
  momentFragRanges: [],     // [{startIdx, endIdx, moment}]
  activeSceneId: null,
  activeSpeakerId: null,
  activeMomentId: null,
  lastSpeakerId: null,
  lastSpeakerTimeout: 0,
  // True when the current chapter has no audio fragments — reader falls
  // back to showing the first scene + first key moment statically.
  textOnlyMode: false,
  // Audio/text sync. `audioFragIdx` is the raw playhead fragment;
  // `syncOffset` shifts the highlighted sentence to correct a constant
  // drift in the alignment data (audio leading/lagging the text).
  audioFragIdx: -1,
  syncOffset: 0,
  // book + pack identity (parsed from URL)
  bookSlug: null,
  packSlug: null,
  bookRoot: "",             // e.g. "books/echo-of-worlds/"
  packRoot: "",             // e.g. "packs/echo-of-worlds-default/"
};

// URL params: ?book=<slug>&pack=<slug>  (defaults below are for back-compat)
(function parseUrlParams() {
  const u = new URL(location.href);
  STATE.bookSlug = u.searchParams.get("book") || "echo-of-worlds";
  STATE.packSlug = u.searchParams.get("pack") || `${STATE.bookSlug}-default`;
  STATE.bookRoot = `books/${STATE.bookSlug}/`;
  STATE.packRoot = `packs/${STATE.packSlug}/`;
})();

// Position + theme storage is per-book; visual toggles are global.
const LS_KEY = `storyplay.position.${STATE.bookSlug}`;
const LS_SYNC = `storyplay.sync.${STATE.bookSlug}`;
const LS_THEME = "storyplay.theme";
const LS_CONTEXT = "storyplay.context";
const LS_CUSTOM = "storyplay.custom";
const LS_TOGGLES = "storyplay.toggles";

function isAbsoluteUrl(p) {
  return typeof p === "string" && /^(https?:|data:|blob:|\/)/.test(p);
}
function resolveBookAsset(p) {
  return p && !isAbsoluteUrl(p) ? STATE.bookRoot + p : p;
}
function resolvePackAsset(p) {
  return p && !isAbsoluteUrl(p) ? STATE.packRoot + p : p;
}
function rewritePackPaths(data) {
  if (!data) return data;
  if (data.characters) {
    for (const c of Object.values(data.characters)) {
      if (c?.portrait) c.portrait = resolvePackAsset(c.portrait);
    }
  }
  if (data.scenes) {
    for (const s of data.scenes) {
      if (s?.background) s.background = resolvePackAsset(s.background);
    }
  }
  if (data.keyMoments) {
    for (const m of data.keyMoments) {
      if (m?.image) m.image = resolvePackAsset(m.image);
    }
  }
  // Normalize `speakers` to a { fragId: charId } lookup map. Packs may
  // author it either as that map or as an array of { fragId, id } entries.
  if (Array.isArray(data.speakers)) {
    const map = {};
    for (const s of data.speakers) {
      if (s && s.fragId) map[s.fragId] = s.id;
    }
    data.speakers = map;
  }
  return data;
}
const VISUAL_TOGGLES = ["scenes", "characters", "speakers", "moments"];
const CONTEXT_LEVELS = ["all", "3", "2", "1", "0"]; // page → focus(±3) → ... → just current
const CONTEXT_LABEL = { all: "Page", "3": "±3", "2": "±2", "1": "±1", "0": "Just" };
const CUSTOM_VARS = ["--u-bg", "--u-fg", "--u-active", "--u-accent", "--u-font-reading", "--u-font-display", "--u-font-size", "--u-line-height", "--u-content-width"];
const CUSTOM_UNITS = { "--u-font-size": "px", "--u-content-width": "rem" };

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

// ─── time formatting ─────────────────────────────────────────────
function fmtTime(s) {
  if (!isFinite(s)) return "00:00";
  s = Math.max(0, Math.floor(s));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2,"0")}:${String(ss).padStart(2,"0")}`
    : `${String(m).padStart(2,"0")}:${String(ss).padStart(2,"0")}`;
}
function fmtHud(s) {
  if (!isFinite(s)) return "T+00:00:00";
  s = Math.max(0, Math.floor(s));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return `T+${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(ss).padStart(2,"0")}`;
}

// ─── virtual time / segment helpers ──────────────────────────────
function virtualTime() {
  const s = STATE.segments[STATE.segIdx];
  if (!s) return 0;
  const into = Math.max(0, STATE.audio.currentTime - s.clipStart);
  return STATE.segOffsets[STATE.segIdx] + into;
}
function totalDuration() {
  return STATE.chapter ? STATE.chapter.duration : 0;
}
function segmentForVirtualTime(vt) {
  const offs = STATE.segOffsets;
  for (let i = offs.length - 1; i >= 0; i--) {
    if (vt >= offs[i]) return i;
  }
  return 0;
}
function findFragIdx(vt) {
  const f = STATE.fragments;
  if (!f.length) return -1;
  let lo = 0, hi = f.length - 1;
  if (vt < f[0].vStart) return -1;
  if (vt >= f[hi].vEnd) return hi;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (vt < f[mid].vStart) hi = mid - 1;
    else if (vt >= f[mid].vEnd) lo = mid + 1;
    else return mid;
  }
  return Math.max(0, Math.min(f.length - 1, lo));
}

// ─── manifest / TOC ──────────────────────────────────────────────
async function loadManifest() {
  const r = await fetch(STATE.bookRoot + "manifest.json");
  if (!r.ok) throw new Error(`manifest fetch failed for book "${STATE.bookSlug}"`);
  const m = await r.json();
  // Rewrite chapter/segment paths to be relative to the site root.
  for (const ch of m.chapters || []) {
    if (ch.xhtml) ch.xhtml = resolveBookAsset(ch.xhtml);
    for (const seg of ch.segments || []) {
      if (seg.audio) seg.audio = resolveBookAsset(seg.audio);
    }
  }
  if (m.cover) m.cover = resolveBookAsset(m.cover);
  STATE.manifest = m;
  // Sync offset: per-book localStorage override, else the manifest default.
  const savedSync = parseInt(localStorage.getItem(LS_SYNC) ?? "", 10);
  STATE.syncOffset = Number.isFinite(savedSync) ? savedSync : (m.syncOffset || 0);
  const syncDisp = document.querySelector("#sync-display");
  if (syncDisp) syncDisp.textContent = STATE.syncOffset > 0 ? `+${STATE.syncOffset}` : `${STATE.syncOffset}`;
  $("#book-title").textContent = m.title;
  $("#book-creator").textContent = m.creator || "";
  document.title = `${m.title} — Storyplay`;
  buildToc();
}

function buildToc() {
  const list = $("#toc-list");
  list.innerHTML = "";
  const chapters = STATE.manifest.chapters || [];
  const anyAudio = chapters.some(ch => ch.segments && ch.segments.length);
  // Audio mode: only chapters with media-overlay alignment.
  // Text-only mode (no audio in book): everything that has a usable title.
  const include = ch => anyAudio
    ? !!(ch.segments && ch.segments.length)
    : !!(ch.title && ch.title.trim().length > 0);
  let n = 0;
  chapters.forEach((ch, i) => {
    if (!include(ch)) return;
    n++;
    const li = document.createElement("li");
    li.dataset.idx = i;
    const label = ch.title || ch.id;
    li.innerHTML = `<span class="num">${String(n).padStart(2, "0")}</span><span class="label">${label}</span>`;
    li.addEventListener("click", () => {
      loadChapter(i, { autoplay: anyAudio });
      closeToc();
    });
    list.appendChild(li);
  });
  refreshTocHighlight();
}
function refreshTocHighlight() {
  $$("#toc-list li").forEach((li) => {
    const idx = parseInt(li.dataset.idx, 10);
    li.classList.toggle("current", idx === STATE.chapterIdx);
  });
}

// ─── visual layers (scenes + characters) ─────────────────────────
function getToggles() {
  try { return JSON.parse(localStorage.getItem(LS_TOGGLES) || "{}"); } catch { return {}; }
}
function isToggleOn(name) {
  // Visual layers default ON when unset — must match applyTogglesFromStorage.
  const t = getToggles();
  return t[name] === undefined ? true : !!t[name];
}
function setToggle(name, on) {
  const t = getToggles();
  t[name] = !!on;
  try { localStorage.setItem(LS_TOGGLES, JSON.stringify(t)); } catch {}
  document.body.dataset[`toggle${name.charAt(0).toUpperCase()}${name.slice(1)}`] = on ? "on" : "off";
  // re-render whatever depends on this
  renderStage();
  applySceneBackground(true);
  applyKeyMoment(true);
}
function applyTogglesFromStorage() {
  const t = getToggles();
  for (const name of VISUAL_TOGGLES) {
    // Visual layers default ON so packs show their art the moment a reader
    // opens a book. Users can flip individual toggles off in settings, and
    // those choices persist.
    const on = t[name] === undefined ? true : !!t[name];
    document.body.dataset[`toggle${name.charAt(0).toUpperCase()}${name.slice(1)}`] = on ? "on" : "off";
    const cb = document.querySelector(`input[data-toggle="${name}"]`);
    if (cb) cb.checked = on;
  }
}

async function loadSceneData(chapterId) {
  STATE.sceneData = null;
  STATE.sceneFragRanges = [];
  STATE.momentFragRanges = [];
  STATE.activeSceneId = null;
  STATE.activeSpeakerId = null;
  STATE.activeMomentId = null;
  STATE.lastSpeakerId = null;
  try {
    // Try the chapter-specific JSON first; fall back to pack-wide default.json
    // so unwritten chapters still get scene + character art.
    let r = await fetch(`${STATE.packRoot}${chapterId}.json?t=${Date.now()}`);
    if (!r.ok) {
      r = await fetch(`${STATE.packRoot}default.json?t=${Date.now()}`);
    }
    if (!r.ok) { renderStage(); applySceneBackground(true); applyKeyMoment(); return; }
    const data = rewritePackPaths(await r.json());
    STATE.sceneData = data;
    const idxOf = (fragId) => STATE.fragments.findIndex(f => f.id === fragId);
    STATE.sceneFragRanges = (data.scenes || []).map(s => ({
      id: s.id, startIdx: idxOf(s.startFragId), endIdx: idxOf(s.endFragId), scene: s,
    })).filter(r => r.startIdx >= 0 && r.endIdx >= 0);
    STATE.momentFragRanges = (data.keyMoments || []).map(m => {
      const startIdx = idxOf(m.anchorFragId);
      const endIdx = startIdx >= 0 ? Math.min(STATE.fragments.length - 1, startIdx + (m.durationFrags || 4) - 1) : -1;
      return { id: m.id, startIdx, endIdx, moment: m };
    }).filter(r => r.startIdx >= 0);
  } catch (e) {
    console.warn("scene data load failed", e);
  }
  renderStage();
  applySceneBackground(true);
  applyKeyMoment(true);
  startSceneDataPolling(chapterId);
}

// ─── live refresh: while images are being generated, re-fetch the chapter
// JSON every 6s. If anything (image paths, prompts) changed, refresh
// displayed src's without disturbing reading position. ──────────────────
let sceneDataPollTimer = 0;
function startSceneDataPolling(chapterId) {
  if (sceneDataPollTimer) clearInterval(sceneDataPollTimer);
  sceneDataPollTimer = setInterval(async () => {
    if (!STATE.chapter || STATE.chapter.id !== chapterId) {
      clearInterval(sceneDataPollTimer); sceneDataPollTimer = 0; return;
    }
    try {
      const r = await fetch(`${STATE.packRoot}${chapterId}.json?t=${Date.now()}`);
      if (!r.ok) return;
      const newData = rewritePackPaths(await r.json());
      if (JSON.stringify(newData) === JSON.stringify(STATE.sceneData)) return;
      // Diff and refresh image sources without re-rendering everything
      const oldChars = STATE.sceneData?.characters || {};
      Object.entries(newData.characters || {}).forEach(([id, c]) => {
        if (oldChars[id]?.portrait !== c.portrait) {
          document.querySelectorAll(`.stage-character[data-char-id="${id}"] .stage-portrait`).forEach(el => {
            el.style.backgroundImage = `url('${c.portrait}?t=${Date.now()}')`;
          });
        }
      });
      // Refresh scene background if path changed
      const newScene = (newData.scenes || []).find(s => s.id === STATE.activeSceneId);
      const oldScene = (STATE.sceneData?.scenes || []).find(s => s.id === STATE.activeSceneId);
      const sceneChanged = newScene && oldScene && newScene.background !== oldScene.background;
      // Refresh moment image if path changed
      const newMoment = (newData.keyMoments || []).find(m => m.id === STATE.activeMomentId);
      const oldMoment = (STATE.sceneData?.keyMoments || []).find(m => m.id === STATE.activeMomentId);
      const momentChanged = newMoment && oldMoment && newMoment.image !== oldMoment.image;
      STATE.sceneData = newData;
      if (sceneChanged) applySceneBackground(true);
      if (momentChanged) applyKeyMoment(true);
      // Refresh inline moment images for any moment whose image path changed
      (newData.keyMoments || []).forEach(m => {
        const old = (STATE.sceneData?.keyMoments || []).find(x => x.id === m.id);
        if (old && old.image !== m.image) {
          const fig = document.querySelector(`.inline-moment[data-moment-id="${m.id}"]`);
          if (fig) {
            const img = fig.querySelector("img");
            if (img) img.src = m.image + (m.image.includes("?") ? "&" : "?") + "t=" + Date.now();
          }
        }
      });
    } catch {}
  }, 6000);
}

function sceneForFragIdx(idx) {
  if (STATE.textOnlyMode) return STATE.sceneData?.scenes?.[0] || null;
  for (const r of STATE.sceneFragRanges) {
    if (idx >= r.startIdx && idx <= r.endIdx) return r.scene;
  }
  return null;
}

function applySceneBackground(force = false) {
  const layer = $("#scene-bg");
  if (!layer) return;
  const on = isToggleOn("scenes") && STATE.sceneData;
  layer.classList.toggle("on", !!on);
  if (!on) {
    STATE.activeSceneId = null;
    $("#scene-bg-current").style.backgroundImage = "";
    $("#scene-bg-next").style.backgroundImage = "";
    $("#scene-bg-current").classList.remove("show");
    $("#scene-bg-next").classList.remove("show");
    return;
  }
  const scene = sceneForFragIdx(STATE.activeFragIdx);
  if (!scene) return;
  if (!force && scene.id === STATE.activeSceneId) return;
  // cross-fade: current shifts to "previous", new fills "current"
  const cur = $("#scene-bg-current");
  const nxt = $("#scene-bg-next");
  // swap visible layers via opacity
  if (cur.classList.contains("show")) {
    nxt.style.backgroundImage = `url("${scene.background}")`;
    requestAnimationFrame(() => {
      nxt.classList.add("show");
      cur.classList.remove("show");
      setTimeout(() => {
        cur.style.backgroundImage = nxt.style.backgroundImage;
        cur.classList.add("show");
        nxt.classList.remove("show");
      }, 900);
    });
  } else {
    cur.style.backgroundImage = `url("${scene.background}")`;
    cur.classList.add("show");
  }
  STATE.activeSceneId = scene.id;
}

// ─── inline moments (Option C — figures within the text column) ──
// Each key moment becomes a <figure> inserted immediately after its anchor
// sentence's parent paragraph. They're hidden in focus modes (CSS) and only
// fade in once the image actually loads (so broken paths leave no trace).
function injectInlineMoments() {
  // remove old ones
  document.querySelectorAll(".inline-moment").forEach(el => el.remove());
  const moments = STATE.sceneData?.keyMoments || [];
  if (!moments.length) return;
  moments.forEach(m => {
    const anchor = document.getElementById(m.anchorFragId);
    if (!anchor) return;
    const parent = anchor.closest("p, section, h1, h2") || anchor;
    const fig = document.createElement("figure");
    fig.className = "inline-moment";
    fig.dataset.momentId = m.id;
    const img = document.createElement("img");
    img.alt = m.title || "";
    img.onload = () => { if (img.naturalWidth > 0) fig.classList.add("loaded"); };
    img.onerror = () => { fig.remove(); };
    img.src = m.image + (m.image.includes("?") ? "&" : "?") + "t=" + Date.now();
    const cap = document.createElement("figcaption");
    cap.textContent = m.title || "";
    fig.appendChild(img);
    fig.appendChild(cap);
    parent.parentNode.insertBefore(fig, parent.nextSibling);
  });
}

// ─── draggable portraits + moment cards ──────────────────────────
// Click-and-drag (or touch-drag) to move a portrait or the moment card to a
// custom position. Position persists for as long as the element stays on
// stage. When the character leaves the scene (or the moment ends), the
// custom position resets.
const DRAG = {
  active: null,        // element currently being dragged
  startX: 0, startY: 0,
  baseX: 0, baseY: 0,
  moved: false,
};
function attachDragHandlers() {
  document.addEventListener("pointerdown", (e) => {
    const portrait = e.target.closest(".stage-character .stage-portrait");
    const card = e.target.closest("#key-moment-card");
    const target = portrait?.closest(".stage-character") || (card && $("#key-moment"));
    if (!target) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    DRAG.active = target;
    DRAG.pointerId = e.pointerId;
    DRAG.startX = e.clientX;
    DRAG.startY = e.clientY;
    const cs = getComputedStyle(target);
    DRAG.baseX = parseFloat(cs.getPropertyValue("--drag-x")) || 0;
    DRAG.baseY = parseFloat(cs.getPropertyValue("--drag-y")) || 0;
    DRAG.moved = false;
    // Do NOT capture the pointer immediately — that would steal the click.
    // We only capture once actual drag movement happens (threshold reached).
  });
  document.addEventListener("pointermove", (e) => {
    if (!DRAG.active) return;
    const dx = e.clientX - DRAG.startX;
    const dy = e.clientY - DRAG.startY;
    if (!DRAG.moved && Math.hypot(dx, dy) > 6) {
      DRAG.moved = true;
      DRAG.active.classList.add("has-drag", "dragging");
      try { DRAG.active.setPointerCapture(DRAG.pointerId); } catch {}
    }
    if (DRAG.moved) {
      DRAG.active.style.setProperty("--drag-x", (DRAG.baseX + dx) + "px");
      DRAG.active.style.setProperty("--drag-y", (DRAG.baseY + dy) + "px");
    }
  });
  document.addEventListener("pointerup", (e) => {
    if (!DRAG.active) return;
    if (DRAG.moved) {
      DRAG.active.classList.remove("dragging");
      // Eat the trailing click so we don't pop the lightbox after a drop.
      window.__suppressNextClick = Date.now();
    }
    DRAG.active = null;
  });
}
const LS_FLIPS = "storyteller-reader.flips";
function getFlips() {
  try { return JSON.parse(localStorage.getItem(LS_FLIPS) || "{}"); } catch { return {}; }
}
function setFlipStored(charId, flipped) {
  const f = getFlips();
  if (flipped) f[charId] = true; else delete f[charId];
  try { localStorage.setItem(LS_FLIPS, JSON.stringify(f)); } catch {}
}
function applyFlipsToStage() {
  const f = getFlips();
  document.querySelectorAll(".stage-character").forEach(el => {
    if (f[el.dataset.charId]) el.dataset.flip = "true";
    else delete el.dataset.flip;
  });
}

let LIGHTBOX_CHAR = null;       // character id currently shown (null for moments)
function openLightbox(src, caption, { charId = null } = {}) {
  const lb = $("#lightbox");
  const img = $("#lightbox-img");
  const cap = $("#lightbox-caption");
  if (!lb || !img) return;
  img.src = src + (src.includes("?") ? "&" : "?") + "t=" + Date.now();
  img.alt = caption || "";
  if (cap) cap.textContent = caption || "";
  LIGHTBOX_CHAR = charId;
  // Only show the flip button when we're viewing a character portrait
  lb.classList.toggle("show-flip", !!charId);
  const flipped = charId && getFlips()[charId];
  lb.classList.toggle("flipped", !!flipped);
  lb.classList.add("open");
  lb.setAttribute("aria-hidden", "false");
}
function closeLightbox() {
  const lb = $("#lightbox");
  if (!lb) return;
  lb.classList.remove("open");
  lb.setAttribute("aria-hidden", "true");
  LIGHTBOX_CHAR = null;
}
function toggleLightboxFlip() {
  const lb = $("#lightbox");
  if (!lb || !LIGHTBOX_CHAR) return;
  const nowFlipped = !lb.classList.contains("flipped");
  lb.classList.toggle("flipped", nowFlipped);
  setFlipStored(LIGHTBOX_CHAR, nowFlipped);
  applyFlipsToStage();
}

// ─── stage engine (left + right column, up to ~3 per side) ──────
// Each character has an assigned `side` ("left"|"right"). Each side is a
// vertical column that can hold multiple characters. Active speaker is large
// and glows; previous speaker lingers 3.5s in "fading" state; everyone else
// in the scene shows at smaller "ambient" size. Total visible ~ up to 6.
function renderSlotMulti(side, characters, modeFor) {
  const slot = document.querySelector(`.stage-slot[data-slot="${side}"]`);
  if (!slot) return;
  const wantedIds = characters.map(c => c._id);
  // remove characters that are no longer in the scene
  Array.from(slot.children).forEach(child => {
    if (!wantedIds.includes(child.dataset.charId) && !child.classList.contains("leaving")) {
      child.classList.add("leaving");
      setTimeout(() => { if (child.parentNode) child.parentNode.removeChild(child); }, 520);
    }
  });
  // add/update each character
  characters.forEach((c, i) => {
    let fig = slot.querySelector(`.stage-character[data-char-id="${c._id}"]`);
    if (!fig) {
      fig = document.createElement("figure");
      fig.className = "stage-character entering";
      fig.dataset.charId = c._id;
      if (c.flip) fig.dataset.flip = "true";
      fig.style.setProperty("--char-color", c.color || "#888");
      fig.innerHTML = `
        <div class="stage-portrait" style="background-image: url('${c.portrait}')"></div>
        <figcaption class="stage-name">${c.short || c.name}</figcaption>
      `;
      slot.appendChild(fig);
      requestAnimationFrame(() => fig.classList.remove("entering"));
    } else if (c.flip !== undefined) {
      fig.dataset.flip = c.flip ? "true" : "false";
    }
    // ensure speaker is first in the column (visually prominent)
    if (modeFor(c) === "speaking" && slot.firstElementChild !== fig) {
      slot.insertBefore(fig, slot.firstElementChild);
    }
    const mode = modeFor(c);
    fig.classList.toggle("speaking", mode === "speaking");
    fig.classList.toggle("fading", mode === "fading");
    fig.classList.toggle("ambient", mode === "ambient");
    fig.classList.toggle("hidden-by-moment", mode === "hidden");
  });
}

function renderStage() {
  const stage = $("#stage");
  if (!stage) return;
  const on = isToggleOn("characters") && STATE.sceneData;
  stage.classList.toggle("on", !!on);
  if (!on) {
    document.querySelectorAll(".stage-slot").forEach(s => s.innerHTML = "");
    return;
  }
  const scene = sceneForFragIdx(STATE.activeFragIdx);
  if (!scene) {
    document.querySelectorAll(".stage-slot").forEach(s => s.innerHTML = "");
    return;
  }
  const speakersOn = isToggleOn("speakers");
  const fragId = STATE.activeFragIdx >= 0 ? STATE.fragments[STATE.activeFragIdx]?.id : null;
  const speakerId = speakersOn && fragId ? (STATE.sceneData.speakers || {})[fragId] || null : null;
  STATE.activeSpeakerId = speakerId;

  // characters available in scene
  // A scene's `characters` entry may be a plain id string ("selim") or an
  // object ({ id, side }). Side comes from the entry if given, else the
  // character definition, else defaults to "left".
  const present = (scene.characters || []).map(entry => {
    const id = typeof entry === "string" ? entry : entry?.id;
    if (!id) return null;
    const c = STATE.sceneData.characters[id];
    if (!c) return null;
    const side = (typeof entry === "object" && entry.side) || c.side || "left";
    return { ...c, _id: id, side };
  }).filter(Boolean);

  // Group present characters by side (each side can hold multiple — up to ~3)
  const leftSide = present.filter(c => c.side === "left");
  const rightSide = present.filter(c => c.side === "right");

  // The hidden-by-moment behavior is only relevant in focus mode where the
  // moment lives as a side card. In page mode the moment is inline within the
  // text column (Option C), so all characters can stay visible.
  const ctxMode = document.body.dataset.context || "all";
  const inFocus = ctxMode !== "all";
  const activeMoment = inFocus && isToggleOn("moments") && STATE.activeMomentId
    ? STATE.momentFragRanges.find(r => r.id === STATE.activeMomentId)?.moment
    : null;
  let leftFinal = leftSide;
  let rightFinal = rightSide;
  if (activeMoment) {
    const speakerSide = speakerId ? (STATE.sceneData.characters[speakerId]?.side || null) : null;
    const momentSide = speakerSide === "left" ? "right" : speakerSide === "right" ? "left" : "right";
    if (momentSide === "left") leftFinal = leftSide.filter(c => c._id === speakerId);
    if (momentSide === "right") rightFinal = rightSide.filter(c => c._id === speakerId);
  }

  // If there's a current speaker, mark them speaking; otherwise track last speaker
  const speakerSide = speakerId ? (STATE.sceneData.characters[speakerId]?.side || null) : null;

  // track who was last speaker for the linger effect
  if (speakerId && speakerId !== STATE.activeSpeakerId_prev) {
    STATE.lastSpeakerId = STATE.activeSpeakerId_prev || null;
    STATE.activeSpeakerId_prev = speakerId;
    if (STATE.lastSpeakerTimeout) clearTimeout(STATE.lastSpeakerTimeout);
    STATE.lastSpeakerTimeout = setTimeout(() => { STATE.lastSpeakerId = null; renderStage(); }, 3500);
  } else if (!speakerId && STATE.activeSpeakerId_prev) {
    STATE.lastSpeakerId = STATE.activeSpeakerId_prev;
    STATE.activeSpeakerId_prev = null;
    if (STATE.lastSpeakerTimeout) clearTimeout(STATE.lastSpeakerTimeout);
    STATE.lastSpeakerTimeout = setTimeout(() => { STATE.lastSpeakerId = null; renderStage(); }, 3500);
  }

  function modeFor(c) {
    if (!c) return null;
    if (c._id === speakerId) return "speaking";
    if (c._id === STATE.lastSpeakerId) return "fading";
    return "ambient";
  }

  renderSlotMulti("left", leftFinal, modeFor);
  renderSlotMulti("right", rightFinal, modeFor);
  applyFlipsToStage();

  // accent color of the active sentence borders the speaker's color
  const activeEl = document.querySelector(".s.active");
  if (activeEl) {
    if (speakerId) {
      const col = STATE.sceneData.characters[speakerId]?.color || "transparent";
      activeEl.style.setProperty("--speaker-color", col);
      activeEl.classList.add("has-speaker");
    } else {
      activeEl.classList.remove("has-speaker");
      activeEl.style.removeProperty("--speaker-color");
    }
  }
}

// ─── key moments ─────────────────────────────────────────────────
function momentForFragIdx(idx) {
  if (STATE.textOnlyMode) return STATE.sceneData?.keyMoments?.[0] || null;
  for (const r of STATE.momentFragRanges) {
    if (idx >= r.startIdx && idx <= r.endIdx) return r.moment;
  }
  return null;
}

function applyKeyMoment(force = false) {
  const wrap = $("#key-moment");
  if (!wrap) return;
  const on = isToggleOn("moments") && STATE.sceneData;
  wrap.classList.toggle("on", !!on);
  if (!on) {
    STATE.activeMomentId = null;
    wrap.classList.remove("show");
    return;
  }
  const moment = momentForFragIdx(STATE.activeFragIdx);
  if (!moment) {
    if (STATE.activeMomentId) {
      STATE.activeMomentId = null;
      wrap.classList.remove("show");
    }
    return;
  }
  if (!force && moment.id === STATE.activeMomentId) return;
  STATE.activeMomentId = moment.id;
  // Reset any drag offset from the previous moment.
  wrap.classList.remove("has-drag");
  wrap.style.removeProperty("--drag-x");
  wrap.style.removeProperty("--drag-y");
  // pick the slot that's least crowded: opposite of current speaker
  const speakerId = STATE.activeSpeakerId;
  const speakerSide = speakerId ? (STATE.sceneData.characters[speakerId]?.side || null) : null;
  const slot = speakerSide === "left" ? "right" : speakerSide === "right" ? "left" : "right";
  wrap.dataset.slot = slot;
  const img = $("#key-moment-img");
  img.onerror = () => { wrap.classList.remove("show"); };
  img.onload = () => { if (img.naturalWidth > 0) wrap.classList.add("show"); };
  img.src = moment.image;
  img.alt = moment.title || "";
  $("#key-moment-caption").textContent = moment.title || "";
  // re-trigger entry animation only if image looks loadable
  wrap.classList.remove("show");
  if (img.complete && img.naturalWidth > 0) {
    requestAnimationFrame(() => wrap.classList.add("show"));
  }
}

// ─── chapter loading ─────────────────────────────────────────────
async function loadChapter(idx, { virtualTime = 0, autoplay = false } = {}) {
  const ch = STATE.manifest.chapters[idx];
  if (!ch) return;
  STATE.chapterIdx = idx;
  STATE.chapter = ch;
  STATE.segments = ch.segments || [];
  // build virtual offsets
  STATE.segOffsets = [];
  let acc = 0;
  for (const seg of STATE.segments) {
    STATE.segOffsets.push(acc);
    acc += seg.duration;
  }
  // flatten fragments with virtual times
  const flat = [];
  STATE.segments.forEach((seg, si) => {
    for (const f of seg.fragments) {
      const intoSeg = f.start - seg.clipStart;
      const vStart = STATE.segOffsets[si] + intoSeg;
      const vEnd = vStart + (f.end - f.start);
      flat.push({ id: f.id, segIdx: si, cStart: f.start, cEnd: f.end, vStart, vEnd });
    }
  });
  STATE.fragments = flat;
  STATE.activeFragIdx = -1;
  STATE.audioFragIdx = -1;       // reset so the chapter's first applyHighlight isn't deduped away
  STATE.segIdx = 0;
  STATE.textOnlyMode = flat.length === 0;
  document.body.dataset.textOnly = STATE.textOnlyMode ? "on" : "off";

  // render XHTML
  const r = await fetch(ch.xhtml);
  const html = await r.text();
  const doc = new DOMParser().parseFromString(html, "application/xhtml+xml");
  const body = doc.querySelector("body");
  if (!body) {
    $("#page").innerHTML = "<p style='opacity:0.5'>(no body content)</p>";
  } else {
    body.querySelectorAll("[epub\\:type='pagebreak'], [role='doc-pagebreak']").forEach(n => n.classList.add("pagebreak"));
    body.querySelectorAll("span[id]").forEach(span => {
      if (/^[a-z0-9_-]+-s\d+$/i.test(span.id)) {
        span.classList.add("s");
        span.querySelectorAll("a").forEach(a => a.replaceWith(...a.childNodes));
      }
    });
    if (!ch.title) {
      const t1 = body.querySelector(".chapter-title, h1.chapter-title");
      const t2 = body.querySelector("h1");
      const title = (t1 || t2)?.textContent?.trim();
      if (title) {
        ch.title = title.replace(/\s+/g, " ").slice(0, 80);
        const tocLi = document.querySelector(`#toc-list li[data-idx="${idx}"] .label`);
        if (tocLi) tocLi.textContent = ch.title;
      }
    }
    $("#page").innerHTML = body.innerHTML;
  }
  $("#reader").scrollTop = 0;

  // load first segment & seek
  const targetSeg = segmentForVirtualTime(virtualTime);
  await loadSegment(targetSeg, virtualTime - STATE.segOffsets[targetSeg], { autoplay });

  // load any prepared scene/character data for this chapter (silent if missing)
  await loadSceneData(ch.id);
  injectInlineMoments();

  // proactively highlight the first sentence so focus modes have something to show
  const initialFrag = findFragIdx(virtualTime);
  applyHighlight(initialFrag >= 0 ? initialFrag : 0);

  // HUD
  $("#hud-chapter").textContent = `CH ${String(idx + 1).padStart(2,"0")}/${String(STATE.manifest.chapters.length).padStart(2,"0")}`;
  refreshTocHighlight();
  updatePlayerUi();
  savePosition();
}

async function loadSegment(segIdx, intoOffset = 0, { autoplay = false } = {}) {
  STATE.segIdx = segIdx;
  const seg = STATE.segments[segIdx];
  const audio = STATE.audio;
  if (!seg) {
    audio.removeAttribute("src");
    audio.load();
    return;
  }
  const wantSrc = seg.audio;
  // compare without origin-prefix tail
  const currentSrc = audio.src.includes(wantSrc) ? wantSrc : null;
  if (currentSrc !== wantSrc) {
    audio.src = wantSrc;
    await new Promise(resolve => {
      const ok = () => { audio.removeEventListener("loadedmetadata", ok); audio.removeEventListener("error", ok); resolve(); };
      audio.addEventListener("loadedmetadata", ok, { once: true });
      audio.addEventListener("error", ok, { once: true });
    });
  }
  const targetTime = seg.clipStart + Math.max(0, intoOffset);
  if (Math.abs(audio.currentTime - targetTime) > 0.05) {
    audio.currentTime = targetTime;
  }
  if (autoplay) audio.play().catch(()=>{});
}

// ─── highlight ───────────────────────────────────────────────────
function applyHighlight(audioIdx) {
  const fragments = STATE.fragments;
  if (!fragments.length) return;        // text-only mode — no fragments to highlight
  if (audioIdx === STATE.audioFragIdx) return;
  STATE.audioFragIdx = audioIdx;
  // The highlighted sentence is the playhead fragment shifted by the
  // per-book sync offset (corrects constant audio/text alignment drift).
  const idx = audioIdx < 0 ? -1
    : Math.max(0, Math.min(fragments.length - 1, audioIdx + STATE.syncOffset));
  if (idx === STATE.activeFragIdx) return;

  // clean previous
  if (STATE.activeFragIdx >= 0 && fragments[STATE.activeFragIdx]) {
    const prev = document.getElementById(fragments[STATE.activeFragIdx].id);
    if (prev) {
      prev.classList.remove("active");
      prev.style.removeProperty("--progress");
    }
  }

  // refresh past/near classes around new index
  if (Math.abs(idx - STATE.activeFragIdx) > 1 || STATE.activeFragIdx < 0) {
    fragments.forEach((f, i) => {
      const el = document.getElementById(f.id);
      if (!el) return;
      el.classList.toggle("past", i < idx);
      el.classList.toggle("near-past", i === idx - 1);
      el.classList.toggle("near-future", i === idx + 1);
    });
  } else {
    if (idx > STATE.activeFragIdx && STATE.activeFragIdx >= 0) {
      const el = document.getElementById(fragments[STATE.activeFragIdx].id);
      if (el) el.classList.add("past");
    }
    fragments.forEach((f, i) => {
      const el = document.getElementById(f.id);
      if (!el) return;
      el.classList.toggle("near-past", i === idx - 1);
      el.classList.toggle("near-future", i === idx + 1);
    });
  }

  STATE.activeFragIdx = idx;
  if (idx < 0) return;
  const cur = document.getElementById(fragments[idx].id);
  if (!cur) return;
  cur.classList.add("active");
  cur.classList.remove("past");
  cur.style.setProperty("--progress", "0");
  updateContextWindow();
  // Visual layers — scene / stage / key moment may have changed on this sentence
  applySceneBackground();
  renderStage();
  applyKeyMoment();
  // Page mode needs explicit scroll-into-view when active drifts;
  // focus/cinema mode is handled by updateContinuousScroll each frame.
  const ctx = document.body.dataset.context || "all";
  const theme = document.body.dataset.theme;
  if (ctx === "all" && theme !== "cinema") scrollSentenceIntoView(cur);
}

// ─── audio/text sync offset ──────────────────────────────────────
// Storyteller's alignment can drift by a constant number of sentences
// (audio leading or lagging the text). `syncOffset` shifts the highlight
// to compensate; it persists per book. Adjust live with , and . keys or
// the Audio sync stepper in settings.
function setSyncOffset(n) {
  STATE.syncOffset = Math.max(-25, Math.min(25, Math.round(n)));
  try { localStorage.setItem(LS_SYNC, String(STATE.syncOffset)); } catch {}
  const disp = document.querySelector("#sync-display");
  if (disp) disp.textContent = STATE.syncOffset > 0 ? `+${STATE.syncOffset}` : `${STATE.syncOffset}`;
  // Re-apply the highlight immediately from the current playhead.
  const audioIdx = STATE.audioFragIdx >= 0 ? STATE.audioFragIdx : findFragIdx(virtualTime());
  STATE.audioFragIdx = -2;          // force applyHighlight past its dedup guard
  applyHighlight(audioIdx);
  showSyncToast();
}
function showSyncToast() {
  let t = document.getElementById("sync-toast");
  if (!t) {
    t = document.createElement("div");
    t.id = "sync-toast";
    t.style.cssText =
      "position:fixed;left:50%;bottom:96px;transform:translateX(-50%);" +
      "background:rgba(18,20,26,0.94);color:#e7e4d8;" +
      "font:500 13px/1.4 'JetBrains Mono',ui-monospace,monospace;letter-spacing:0.07em;" +
      "padding:10px 18px;border-radius:8px;border:1px solid rgba(217,181,106,0.32);" +
      "z-index:9999;opacity:0;transition:opacity 180ms ease;pointer-events:none;" +
      "box-shadow:0 8px 28px -10px rgba(0,0,0,0.7);";
    document.body.appendChild(t);
  }
  const n = STATE.syncOffset;
  t.textContent = n === 0
    ? "Audio sync — aligned"
    : `Audio sync — text ${n > 0 ? "+" : ""}${n} sentence${Math.abs(n) === 1 ? "" : "s"}`;
  t.style.opacity = "1";
  clearTimeout(showSyncToast._t);
  showSyncToast._t = setTimeout(() => { t.style.opacity = "0"; }, 1500);
}

function updateSentenceProgress(vt) {
  if (STATE.activeFragIdx < 0) return;
  // The highlighted element comes from activeFragIdx; the timing window
  // comes from the raw audio fragment so progress tracks the narration
  // even when a sync offset shifts the highlight.
  const el = STATE.fragments[STATE.activeFragIdx];
  const frag = STATE.fragments[STATE.audioFragIdx] || el;
  const sentence = document.getElementById(el.id);
  if (!sentence) return;
  const span = Math.max(0.01, frag.vEnd - frag.vStart);
  const progress = Math.max(0, Math.min(1, (vt - frag.vStart) / span));
  sentence.style.setProperty("--progress", progress.toFixed(4));
  // Drive the global bar above the player
  document.body.style.setProperty("--sentence-progress", progress.toFixed(4));
}

// ─── scrolling ───────────────────────────────────────────────────
// ─── continuous scroll engine ────────────────────────────────────
// Page-mode behavior: discrete smoothScrollTo when active drifts out of band.
// Focus/Cinema behavior: every frame, compute the *interpolated* target between
// the current and next sentence based on audio progress within the active
// sentence. Apply low-pass smoothing on top so the page glides continuously,
// never snaps.
let scrollRaf = 0;
function smoothScrollTo(target, duration = 540) {
  const reader = $("#reader");
  if (scrollRaf) cancelAnimationFrame(scrollRaf);
  const start = reader.scrollTop;
  const max = reader.scrollHeight - reader.clientHeight;
  const dest = Math.max(0, Math.min(max, target));
  const dist = dest - start;
  if (Math.abs(dist) < 1) { reader.scrollTop = dest; return; }
  const t0 = performance.now();
  // ease-in-out cubic: gentle start AND landing
  const ease = (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const step = (now) => {
    const t = Math.min(1, (now - t0) / duration);
    reader.scrollTop = start + dist * ease(t);
    if (t < 1) scrollRaf = requestAnimationFrame(step);
    else scrollRaf = 0;
  };
  scrollRaf = requestAnimationFrame(step);
}

function centerScrollFor(el) {
  const reader = $("#reader");
  return el.offsetTop + el.offsetHeight / 2 - reader.clientHeight / 2;
}

// Called every frame from the main loop while audio plays in focus/cinema mode.
// The active sentence stays fixed at the viewport center — reading a moving
// target is exhausting. When the active index changes, we ease over to the
// new center; within a sentence, nothing moves.
function updateContinuousScroll(_vt) {
  const ctx = document.body.dataset.context || "all";
  const theme = document.body.dataset.theme;
  const centerMode = (ctx !== "all") || (theme === "cinema");
  if (!centerMode) return;
  const idx = STATE.activeFragIdx;
  if (idx < 0) return;
  const cur = document.getElementById(STATE.fragments[idx].id);
  if (!cur) return;
  const target = centerScrollFor(cur);

  const reader = $("#reader");
  const cs = reader.scrollTop;
  const delta = target - cs;
  const absDelta = Math.abs(delta);
  if (absDelta < 0.5) return;
  // Adaptive smoothing: gentle glide between sentences, faster catch-up only
  // when the page is far from target (seek, chapter switch). Constants are
  // 3× softer than a "snappy" baseline — visible easing over ~1 s for a
  // typical sentence-to-sentence move.
  const factor = Math.min(0.09, 0.015 + absDelta / 27000);
  reader.scrollTop = cs + delta * factor;
}

function scrollSentenceIntoView(el, force = false) {
  const reader = $("#reader");
  const ctx = document.body.dataset.context || "all";
  const theme = document.body.dataset.theme;
  const centerMode = (ctx !== "all") || (theme === "cinema");
  // In centerMode, updateContinuousScroll handles all motion every frame.
  // We don't need a discrete animation — the adaptive smoothing converges fast
  // from any starting position.
  if (centerMode) return;
  // Page mode: only scroll when active drifts outside the middle band.
  const r = el.getBoundingClientRect();
  const containerRect = reader.getBoundingClientRect();
  const topMargin = containerRect.top + reader.clientHeight * 0.30;
  const bottomMargin = containerRect.top + reader.clientHeight * 0.70;
  if (force || r.top < topMargin || r.bottom > bottomMargin) {
    smoothScrollTo(el.offsetTop - reader.clientHeight * 0.35);
  }
}

// ─── player UI ───────────────────────────────────────────────────
function updatePlayerUi() {
  const a = STATE.audio;
  const dur = totalDuration();
  const vt = virtualTime();
  $("#time-now").textContent = fmtTime(vt);
  $("#time-total").textContent = fmtTime(dur);
  $("#hud-time").textContent = fmtHud(vt);
  $("#hud-speed").textContent = `x${a.playbackRate.toFixed(2).replace(/\.?0+$/, "") || "1"}`;
  // Focus theme repurposes the HUD slots: chapter readout becomes sentence counter
  const inFocus = (document.body.dataset.context || "all") !== "all";
  if (inFocus && STATE.fragments.length) {
    const idx = STATE.activeFragIdx;
    const total = STATE.fragments.length;
    $("#hud-chapter").textContent = idx >= 0 ? `${idx + 1} / ${total}` : `— / ${total}`;
  } else if (STATE.manifest && STATE.chapter) {
    $("#hud-chapter").textContent = `CH ${String(STATE.chapterIdx + 1).padStart(2,"0")}/${String(STATE.manifest.chapters.length).padStart(2,"0")}`;
  }
  if (dur > 0 && !STATE.userScrubbing) {
    const pct = vt / dur;
    $("#track-fill").style.width = (pct * 100) + "%";
    $("#track-input").value = String(Math.round(pct * 1000));
  }
  const playing = !a.paused && !a.ended;
  $("#icon-play").style.display = playing ? "none" : "";
  $("#icon-pause").style.display = playing ? "" : "none";
}

// ─── persistence ─────────────────────────────────────────────────
let saveTimer = 0;
function savePosition() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        chapterIdx: STATE.chapterIdx,
        virtualTime: virtualTime(),
      }));
    } catch (e) {}
  }, 400);
}
function loadPosition() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

// ─── theme ───────────────────────────────────────────────────────
function setTheme(name) {
  document.body.dataset.theme = name;
  const sel = $("#theme-select");
  if (sel && sel.value !== name) sel.value = name;
  try { localStorage.setItem(LS_THEME, name); } catch {}
  if (name === "scifi") startStarfield(); else stopStarfield();
  refreshSettingsControls();
}

// ─── customization (CSS variable overrides) ──────────────────────
function getCustomOverrides() {
  try { return JSON.parse(localStorage.getItem(LS_CUSTOM) || "{}"); } catch { return {}; }
}
function applyOverrides() {
  const overrides = getCustomOverrides();
  for (const v of CUSTOM_VARS) {
    if (overrides[v] !== undefined && overrides[v] !== "") {
      const unit = CUSTOM_UNITS[v] || "";
      document.body.style.setProperty(v, overrides[v] + unit);
    } else {
      document.body.style.removeProperty(v);
    }
  }
  refreshSettingsControls();
}
function setCustomVar(varName, rawValue) {
  const overrides = getCustomOverrides();
  if (rawValue === "" || rawValue === null || rawValue === undefined) {
    delete overrides[varName];
  } else {
    overrides[varName] = String(rawValue);
  }
  try { localStorage.setItem(LS_CUSTOM, JSON.stringify(overrides)); } catch {}
  applyOverrides();
}
function resetCustom() {
  try { localStorage.removeItem(LS_CUSTOM); } catch {}
  applyOverrides();
}
function getEffectiveValue(varName) {
  // returns the current effective value of the variable (override or theme default)
  const cs = getComputedStyle(document.body);
  if (varName === "--u-bg") return cs.getPropertyValue("--t-bg").trim() || cs.backgroundColor;
  if (varName === "--u-fg") return cs.getPropertyValue("--t-fg").trim() || cs.color;
  if (varName === "--u-active") return cs.getPropertyValue("--t-active").trim();
  if (varName === "--u-accent") return cs.getPropertyValue("--t-accent").trim();
  if (varName === "--u-font-reading") return cs.getPropertyValue("--t-font-reading").trim();
  if (varName === "--u-font-display") return cs.getPropertyValue("--t-font-display").trim();
  if (varName === "--u-font-size") return parseFloat(cs.getPropertyValue("--t-font-size")) || 19;
  if (varName === "--u-line-height") return parseFloat(cs.getPropertyValue("--t-line-height")) || 1.65;
  if (varName === "--u-content-width") return parseFloat(cs.getPropertyValue("--t-content-width")) || 38;
  return "";
}
function normalizeColor(value) {
  // Convert arbitrary CSS color string to #rrggbb so <input type="color"> shows it
  if (!value) return "#000000";
  const probe = document.createElement("span");
  probe.style.color = value;
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe).color;
  document.body.removeChild(probe);
  const m = cs.match(/rgba?\(([^)]+)\)/);
  if (!m) return "#000000";
  const parts = m[1].split(",").map(s => parseFloat(s.trim()));
  const [r, g, b] = parts;
  const hex = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}
function refreshSettingsControls() {
  const overrides = getCustomOverrides();
  $$("[data-var]").forEach(input => {
    const v = input.dataset.var;
    if (!v) return;
    const has = overrides[v] !== undefined && overrides[v] !== "";
    const row = input.closest(".settings-row");
    if (row) row.classList.toggle("has-override", has);
    if (input.tagName === "INPUT" && input.type === "color") {
      const effective = has ? overrides[v] : getEffectiveValue(v);
      input.value = normalizeColor(effective);
    } else if (input.tagName === "INPUT" && input.type === "range") {
      const effective = has ? parseFloat(overrides[v]) : parseFloat(getEffectiveValue(v));
      if (Number.isFinite(effective)) input.value = String(effective);
      const display = $(`.settings-value[data-for="${v}"]`);
      if (display) {
        const unit = CUSTOM_UNITS[v] || "";
        display.textContent = (Math.round(effective * 100) / 100) + unit;
      }
    } else if (input.tagName === "SELECT") {
      input.value = has ? overrides[v] : "";
    }
  });
}

function setContext(value) {
  const v = String(value);
  if (!CONTEXT_LEVELS.includes(v)) return;
  document.body.dataset.context = v;
  $("#ctx-display").textContent = CONTEXT_LABEL[v];
  $("#ctx-minus").disabled = (v === "0");
  $("#ctx-plus").disabled = (v === "all");
  try { localStorage.setItem(LS_CONTEXT, v); } catch {}
  updateContextWindow();
  // re-center active sentence smoothly when window changes
  const el = document.querySelector(".s.active");
  if (el) scrollSentenceIntoView(el, true);
}

function stepContext(delta) {
  const cur = document.body.dataset.context || "all";
  const i = CONTEXT_LEVELS.indexOf(cur);
  const next = CONTEXT_LEVELS[Math.max(0, Math.min(CONTEXT_LEVELS.length - 1, i + delta))];
  setContext(next);
}

function updateContextWindow() {
  // tag sentences within ±N around active
  const ctxRaw = document.body.dataset.context || "all";
  const idx = STATE.activeFragIdx;
  // clear previous
  document.querySelectorAll(".s.in-context").forEach(el => {
    el.classList.remove("in-context");
    el.removeAttribute("data-offset");
  });
  if (ctxRaw === "all") return;
  const N = parseInt(ctxRaw, 10);
  if (!Number.isFinite(N) || idx < 0) return;
  const total = STATE.fragments.length;
  for (let i = Math.max(0, idx - N); i <= Math.min(total - 1, idx + N); i++) {
    const f = STATE.fragments[i];
    const el = document.getElementById(f.id);
    if (!el) continue;
    el.classList.add("in-context");
    el.setAttribute("data-offset", String(i - idx));
  }
}

// ─── starfield ───────────────────────────────────────────────────
let starfieldRaf = 0, stars = [];
function startStarfield() {
  if (starfieldRaf) return;
  const canvas = $("#starfield");
  const ctx = canvas.getContext("2d");
  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener("resize", resize);
  if (!stars.length) {
    for (let i = 0; i < 180; i++) {
      stars.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        z: Math.random() * 0.9 + 0.1,
        r: Math.random() * 1.2 + 0.2,
        tw: Math.random() * Math.PI * 2,
      });
    }
  }
  function frame(t) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // parallax: deeper stars (low z) drift less with scroll than nearer ones
    const reader = $("#reader");
    const scroll = reader ? reader.scrollTop : 0;
    for (const s of stars) {
      const flicker = 0.5 + 0.5 * Math.sin(t * 0.001 * s.z + s.tw);
      const py = ((s.y - scroll * s.z * 0.15) % canvas.height + canvas.height) % canvas.height;
      ctx.fillStyle = `rgba(${180 + 50 * s.z}, ${230 + 20 * s.z}, 238, ${0.15 + flicker * 0.55 * s.z})`;
      ctx.beginPath();
      ctx.arc(s.x, py, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    starfieldRaf = requestAnimationFrame(frame);
  }
  starfieldRaf = requestAnimationFrame(frame);
}
function stopStarfield() {
  if (starfieldRaf) cancelAnimationFrame(starfieldRaf);
  starfieldRaf = 0;
  const canvas = $("#starfield");
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

// ─── toc ─────────────────────────────────────────────────────────
function openToc() { $("#toc").classList.add("open"); }
function closeToc() { $("#toc").classList.remove("open"); }

// ─── main loop ───────────────────────────────────────────────────
function loop() {
  const playing = STATE.audio && !STATE.audio.paused;
  if (playing) {
    const vt = virtualTime();
    const idx = findFragIdx(vt);
    if (idx !== STATE.audioFragIdx) applyHighlight(idx);
    updateSentenceProgress(vt);
    updateContinuousScroll(vt);
    updatePlayerUi();
  } else {
    // Even when paused, keep settling toward the active sentence so the page
    // never sits "stuck" off-screen after a seek or theme switch.
    updateContinuousScroll(virtualTime());
  }
  requestAnimationFrame(loop);
}

// ─── audio segment advancement ───────────────────────────────────
function onSegmentEnd() {
  if (STATE.segIdx < STATE.segments.length - 1) {
    const wasPlaying = !STATE.audio.paused;
    loadSegment(STATE.segIdx + 1, 0, { autoplay: wasPlaying });
  } else {
    // chapter end
    if (STATE.chapterIdx < STATE.manifest.chapters.length - 1) {
      const wasPlaying = !STATE.audio.paused;
      loadChapter(STATE.chapterIdx + 1, { autoplay: wasPlaying });
    }
  }
}

// ─── wire up ─────────────────────────────────────────────────────
async function main() {
  STATE.audio = $("#audio");

  const savedTheme = (() => { try { return localStorage.getItem(LS_THEME); } catch { return null; } })();
  const savedContext = (() => { try { return localStorage.getItem(LS_CONTEXT); } catch { return null; } })();
  const initialTheme = (savedTheme === "focus") ? "vinyl" : (savedTheme || "vinyl");
  setTheme(initialTheme);
  setContext(savedContext && CONTEXT_LEVELS.includes(savedContext) ? savedContext : "all");

  $("#theme-select").addEventListener("change", e => setTheme(e.target.value));
  $("#ctx-minus").addEventListener("click", () => stepContext(+1));
  $("#ctx-plus").addEventListener("click", () => stepContext(-1));

  // settings panel
  $("#settings-toggle").addEventListener("click", e => {
    e.stopPropagation();
    $("#settings").classList.toggle("open");
  });
  $("#settings-close").addEventListener("click", () => $("#settings").classList.remove("open"));
  document.addEventListener("click", (e) => {
    const panel = $("#settings");
    if (panel.classList.contains("open") && !panel.contains(e.target) && !e.target.closest("#settings-toggle")) {
      panel.classList.remove("open");
    }
  });
  $("#settings-reset").addEventListener("click", resetCustom);
  $$("[data-var]").forEach(input => {
    const v = input.dataset.var;
    if (!v) return;
    const handler = () => setCustomVar(v, input.value);
    input.addEventListener("input", handler);
    input.addEventListener("change", handler);
  });
  $$(".settings-clear").forEach(btn => {
    btn.addEventListener("click", e => {
      e.preventDefault();
      const v = btn.dataset.var;
      setCustomVar(v, "");
    });
  });

  applyOverrides();

  // visual-layer toggles (scenes / characters / speakers / moments)
  $$("[data-toggle]").forEach(cb => {
    cb.addEventListener("change", () => setToggle(cb.dataset.toggle, cb.checked));
  });
  applyTogglesFromStorage();

  // audio/text sync offset stepper
  $("#sync-minus")?.addEventListener("click", () => setSyncOffset(STATE.syncOffset - 1));
  $("#sync-plus")?.addEventListener("click", () => setSyncOffset(STATE.syncOffset + 1));

  attachDragHandlers();

  // Lightbox — click any character portrait or key moment card to enlarge.
  // Delegated handler so dynamically-rendered portraits also work.
  document.addEventListener("click", (e) => {
    // Suppress click if it just followed a drag
    if (window.__suppressNextClick && Date.now() - window.__suppressNextClick < 300) {
      window.__suppressNextClick = 0;
      return;
    }
    const portrait = e.target.closest(".stage-character .stage-portrait");
    if (portrait) {
      const fig = portrait.closest(".stage-character");
      const charId = fig?.dataset.charId;
      const c = STATE.sceneData?.characters?.[charId];
      const src = (c?.portrait || "").replace(/\?t=\d+$/, "");
      const caption = c ? (c.name || c.short || "") + (c.description ? " — " + c.description.slice(0, 160) : "") : "";
      if (src) openLightbox(src, caption, { charId });
      return;
    }
    const card = e.target.closest("#key-moment-card");
    if (card) {
      const moment = STATE.activeMomentId
        ? (STATE.sceneData?.keyMoments || []).find(m => m.id === STATE.activeMomentId)
        : null;
      if (moment?.image) openLightbox(moment.image, moment.title || "");
      return;
    }
    const inlineMoment = e.target.closest(".inline-moment");
    if (inlineMoment) {
      const mid = inlineMoment.dataset.momentId;
      const moment = (STATE.sceneData?.keyMoments || []).find(m => m.id === mid);
      if (moment?.image) openLightbox(moment.image, moment.title || "");
      return;
    }
    // Click outside lightbox closes it
    if (e.target.id === "lightbox") closeLightbox();
  });
  $("#lightbox-close")?.addEventListener("click", closeLightbox);
  $("#lightbox-flip")?.addEventListener("click", toggleLightboxFlip);

  $("#toc-toggle").addEventListener("click", (e) => { e.stopPropagation(); $("#toc").classList.toggle("open"); });
  $("#toc-close").addEventListener("click", closeToc);
  document.addEventListener("click", (e) => {
    const toc = $("#toc");
    if (toc.classList.contains("open") && !toc.contains(e.target) && e.target.id !== "toc-toggle" && !e.target.closest("#toc-toggle")) {
      closeToc();
    }
  });

  $("#playpause").addEventListener("click", async () => {
    if (!STATE.audio.src) return;
    if (STATE.audio.paused) await STATE.audio.play();
    else STATE.audio.pause();
    updatePlayerUi();
  });
  $("#rewind").addEventListener("click", () => seekVirtual(virtualTime() - 15));
  $("#forward").addEventListener("click", () => seekVirtual(virtualTime() + 15));
  $("#prev-ch").addEventListener("click", () => loadChapter(Math.max(0, STATE.chapterIdx - 1), { autoplay: !STATE.audio.paused }));
  $("#next-ch").addEventListener("click", () => loadChapter(Math.min(STATE.manifest.chapters.length - 1, STATE.chapterIdx + 1), { autoplay: !STATE.audio.paused }));

  $("#speed").addEventListener("change", e => {
    STATE.audio.playbackRate = parseFloat(e.target.value);
    updatePlayerUi();
  });

  const input = $("#track-input");
  input.addEventListener("input", () => {
    STATE.userScrubbing = true;
    const pct = input.value / 1000;
    const dur = totalDuration();
    if (dur > 0) {
      $("#track-fill").style.width = (pct * 100) + "%";
      $("#time-now").textContent = fmtTime(pct * dur);
    }
  });
  input.addEventListener("change", async () => {
    const pct = input.value / 1000;
    const dur = totalDuration();
    if (dur > 0) await seekVirtual(pct * dur);
    STATE.userScrubbing = false;
  });

  STATE.audio.addEventListener("loadedmetadata", updatePlayerUi);
  STATE.audio.addEventListener("timeupdate", () => {
    if (STATE.audio.paused) updatePlayerUi();
    savePosition();
    // segment boundary check (in case ended event doesn't fire for trimmed clips)
    const seg = STATE.segments[STATE.segIdx];
    if (seg && STATE.audio.currentTime >= seg.clipStart + seg.duration - 0.05) {
      if (STATE.segIdx < STATE.segments.length - 1) onSegmentEnd();
    }
  });
  STATE.audio.addEventListener("play", updatePlayerUi);
  STATE.audio.addEventListener("pause", updatePlayerUi);
  STATE.audio.addEventListener("ended", onSegmentEnd);
  STATE.audio.addEventListener("seeked", () => {
    applyHighlight(findFragIdx(virtualTime()));
    updatePlayerUi();
    savePosition();
  });

  window.addEventListener("keydown", e => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
    if (e.key === " ") { e.preventDefault(); $("#playpause").click(); }
    else if (e.key === "ArrowLeft") $("#rewind").click();
    else if (e.key === "ArrowRight") $("#forward").click();
    else if (e.key === "[") $("#prev-ch").click();
    else if (e.key === "]") $("#next-ch").click();
    else if (e.key === ",") setSyncOffset(STATE.syncOffset - 1);
    else if (e.key === ".") setSyncOffset(STATE.syncOffset + 1);
    else if (e.key === "1") setTheme("vinyl");
    else if (e.key === "2") setTheme("cinema");
    else if (e.key === "3") setTheme("karaoke");
    else if (e.key === "4") setTheme("scifi");
    else if (e.key === "f") stepContext(+1);
    else if (e.key === "F") stepContext(-1);
    else if (e.key === "t") $("#toc").classList.toggle("open");
    else if (e.key === "Escape") { closeLightbox(); closeToc(); }
  });

  await loadManifest();

  let startIdx = 0;
  let startVT = 0;
  const saved = loadPosition();
  if (saved && typeof saved.chapterIdx === "number") {
    startIdx = saved.chapterIdx;
    startVT = saved.virtualTime || 0;
  } else {
    startIdx = STATE.manifest.chapters.findIndex(c => c.segments && c.segments.length);
    if (startIdx < 0) startIdx = 0;
  }
  await loadChapter(startIdx, { virtualTime: startVT, autoplay: false });

  requestAnimationFrame(loop);
}

async function seekVirtual(vt) {
  const dur = totalDuration();
  vt = Math.max(0, Math.min(dur, vt));
  const segIdx = segmentForVirtualTime(vt);
  const into = vt - STATE.segOffsets[segIdx];
  if (segIdx !== STATE.segIdx) {
    const wasPlaying = !STATE.audio.paused;
    await loadSegment(segIdx, into, { autoplay: wasPlaying });
  } else {
    const seg = STATE.segments[segIdx];
    STATE.audio.currentTime = seg.clipStart + into;
  }
}

main().catch(err => {
  console.error(err);
  document.body.innerHTML = `<pre style="padding:40px; font-family:monospace; color:#c33">Reader failed:\n${err.message}\n\n${err.stack || ""}</pre>`;
});
