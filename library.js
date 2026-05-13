// Storyplay — library landing page
// Loads library.json (produced by tools/build-library.py) and renders a grid.

const LIB = { books: [] };

async function load() {
  try {
    const r = await fetch(`library.json?t=${Date.now()}`);
    if (!r.ok) throw new Error("library.json missing");
    Object.assign(LIB, await r.json());
  } catch (e) {
    console.warn(e);
    LIB.books = [];
  }
  render();
}

function render() {
  const grid = document.getElementById("book-grid");
  grid.innerHTML = "";
  grid.removeAttribute("aria-busy");

  if (!LIB.books.length) {
    grid.style.display = "none";
    document.getElementById("lib-section-empty").hidden = false;
    return;
  }

  for (const book of LIB.books) {
    grid.appendChild(renderCard(book));
  }
}

function renderCard(book) {
  const card = document.createElement("article");
  card.className = "book-card";
  card.dataset.slug = book.slug;
  card.dataset.available = book.available ? "true" : "false";

  const cover = document.createElement("div");
  cover.className = "book-cover";
  if (book.cover) {
    cover.style.backgroundImage = `url("${book.cover}")`;
    cover.dataset.hasCover = "true";
  }
  const fallback = document.createElement("div");
  fallback.className = "cover-fallback";
  fallback.innerHTML = `
    <div class="cover-title">${escapeHtml(book.title)}</div>
    <div class="cover-author">${escapeHtml(book.creator || "")}</div>
  `;
  cover.appendChild(fallback);
  card.appendChild(cover);

  const body = document.createElement("div");
  body.className = "book-body";
  const stats = [];
  if (book.chapterCount) stats.push(`${book.chapterCount} chapters`);
  if (book.totalDurationLabel) stats.push(book.totalDurationLabel);
  body.innerHTML = `
    <h3 class="book-title">${escapeHtml(book.title)}</h3>
    <p class="book-creator">${escapeHtml(book.creator || "")}</p>
    ${stats.length ? `<div class="book-stats">${stats.map(s => `<span>${escapeHtml(s)}</span>`).join("")}</div>` : ""}
    ${book.description ? `<p class="book-description">${escapeHtml(book.description)}</p>` : ""}
  `;
  card.appendChild(body);

  // Pack selector
  const packRow = document.createElement("div");
  packRow.className = "book-pack-row";
  const packs = book.packs || [];
  const defaultPack = book.defaultPack || (packs[0]?.slug || "");
  packRow.innerHTML = `<span class="pack-label">Pack</span>`;
  const select = document.createElement("select");
  select.className = "pack-select";
  if (!packs.length) {
    const opt = document.createElement("option");
    opt.textContent = "— no packs —";
    opt.value = "";
    select.appendChild(opt);
    select.disabled = true;
  } else {
    for (const p of packs) {
      const opt = document.createElement("option");
      opt.value = p.slug;
      opt.textContent = p.name || p.slug;
      if (p.slug === defaultPack) opt.selected = true;
      select.appendChild(opt);
    }
  }
  packRow.appendChild(select);
  card.appendChild(packRow);

  // Read button
  const action = document.createElement("div");
  action.className = "book-action";
  const btn = document.createElement("a");
  btn.className = "read-btn";
  const updateHref = () => {
    if (!book.available) { btn.href = "#"; return; }
    const pack = select.value || defaultPack || "";
    const url = new URL("reader.html", location.href);
    url.searchParams.set("book", book.slug);
    if (pack) url.searchParams.set("pack", pack);
    btn.href = url.toString();
  };
  updateHref();
  select.addEventListener("change", updateHref);
  btn.textContent = book.available ? "Read" : "Needs alignment";
  if (!book.available) btn.setAttribute("aria-disabled", "true");
  action.appendChild(btn);
  card.appendChild(action);

  return card;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[c]);
}

load();
