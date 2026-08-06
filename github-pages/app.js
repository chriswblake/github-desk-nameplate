/* =========================================================================
 * SETTINGS — edit these to change the available colors and grid.
 * Each built-in color needs: label (shown in UI/legend), color (any CSS color),
 * and key (single lowercase letter used as a desktop shortcut).
 * ========================================================================= */
const CONFIG = {
  rows: 7,
  cols: 52,
  defaultPlateColor: "#000000",
  defaultLogoColor: "#ffffff",
  colors: [
    { label: "Red", color: "#e5484d", key: "r" },
    { label: "Orange", color: "#f76808", key: "o" },
    { label: "Yellow", color: "#f5d90a", key: "y" },
    { label: "Green", color: "#46a758", key: "g" },
    { label: "Blue", color: "#3b82f6", key: "b" },
    { label: "Pink", color: "#f63bdd", key: "i" },
    { label: "Purple", color: "#8e4ec6", key: "p" },
    { label: "White", color: "#ffffff", key: "w" },
    { label: "Gray", color: "#999999", key: "n" },
    { label: "Black", color: "#222222", key: "k" },
  ],
};
/* ===================== end of settings =================================== */

const STORAGE_KEY = "nameplate-planner-v1";
// Separate store for named designs saved from the side menu.
const SAVED_KEY = "nameplate-saved-v1";
const INSPIRATION_INDEX = "inspiration.json";

// Gap between dots as a fraction of the dot size, so spacing scales with the
// nameplate as it resizes.
const GAP_RATIO = 0.2;

// Mobile zoom: multiplies the auto-fitted dot size so the nameplate can be made
// taller (larger dots), at the cost of earlier horizontal scrolling.
const ZOOM_MIN = 1;
const ZOOM_MAX = 3;
const ZOOM_STEP = 0.25;

// Path to the GitHub mark SVG. It is recolored to the logo color both
// on-screen (via CSS mask) and in the exported image (below).
const LOGO_SRC = "github-mark-white.svg";
let logoSvgPromise = null;

function loadLogoSvg() {
  if (!logoSvgPromise) {
    logoSvgPromise = fetch(LOGO_SRC)
      .then((r) => r.text())
      .catch(() => null);
  }
  return logoSvgPromise;
}

const { rows, cols, colors } = CONFIG;
const BUILT_IN_COLOR_COUNT = colors.length;

const state = {
  // grid[r][c] = color index (0..n-1) or null for empty
  grid: Array.from({ length: rows }, () => Array(cols).fill(null)),
  active: 0,
  plateColor: CONFIG.defaultPlateColor,
  logoColor: CONFIG.defaultLogoColor,
  highlight: null, // { row, col } or null
  lastModified: null, // { row, col } — arrow nav starts here
  arrowStart: null, // { row, col } — set on Escape; overrides arrow-nav start
  zoom: 1, // mobile size multiplier (see ZOOM_* constants)
  textSize: "regular", // letter width for the write-a-word tool
  textAlign: "left",
};

// DOM references
const el = {
  root: document.documentElement,
  grid: document.getElementById("grid"),
  logo: document.getElementById("logo"),
  palette: document.getElementById("palette"),
  customColor: document.getElementById("custom-color"),
  stage: document.getElementById("stage"),
  plateColor: document.getElementById("plate-color"),
  logoColor: document.getElementById("logo-color"),
  clearAll: document.getElementById("clear-all"),
  uploadDesign: document.getElementById("upload-design"),
  designFile: document.getElementById("design-file"),
  downloadImage: document.getElementById("download-image"),
  downloadCounts: document.getElementById("download-counts"),
  downloadDesign: document.getElementById("download-design"),
  shiftLeft: document.getElementById("shift-left"),
  shiftRight: document.getElementById("shift-right"),
  canvas: document.getElementById("export-canvas"),
  infoBtn: document.getElementById("info-btn"),
  infoPopover: document.getElementById("info-popover"),
  infoWrap: document.getElementById("info-wrap"),
  zoomIn: document.getElementById("zoom-in"),
  zoomOut: document.getElementById("zoom-out"),
  zoomLabel: document.getElementById("zoom-label"),
  menuBtn: document.getElementById("menu-btn"),
  drawer: document.getElementById("drawer"),
  drawerOverlay: document.getElementById("drawer-overlay"),
  drawerClose: document.getElementById("drawer-close"),
  textInput: document.getElementById("text-input"),
  designName: document.getElementById("design-name"),
  saveDesignBtn: document.getElementById("save-design"),
  savedList: document.getElementById("saved-list"),
  inspirationGrid: document.getElementById("inspiration-grid"),
};

const cellEls = []; // cellEls[r][c] -> button element

/* --------------------------------------------------------------------- */
/* Build UI                                                              */
/* --------------------------------------------------------------------- */
function buildGrid() {
  el.grid.innerHTML = "";
  cellEls.length = 0;
  for (let r = 0; r < rows; r++) cellEls.push(Array(cols).fill(null));

  // Column-major flow so the grid fills like a contribution graph.
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cell";
      btn.tabIndex = -1;
      btn.dataset.r = String(r);
      btn.dataset.c = String(c);
      btn.setAttribute("aria-label", `Row ${r + 1}, column ${c + 1}`);
      // A click paints but never shows the arrow-navigation highlight.
      btn.addEventListener("click", () => {
        toggleCell(r, c, state.active);
        btn.blur();
      });
      cellEls[r][c] = btn;
      el.grid.appendChild(btn);
    }
  }
}

function buildPalette() {
  el.palette.innerHTML = "";
  colors.forEach((color, i) => {
    const wrap = document.createElement("span");
    wrap.className = "swatch-wrap";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "swatch";
    btn.dataset.index = String(i);
    btn.style.background = color.color;
    btn.style.color = textColorFor(color.color);
    const shortcut = color.key ? ` (${color.key})` : "";
    btn.dataset.tip = `${color.label}${shortcut}`;
    btn.setAttribute("aria-pressed", String(i === state.active));
    btn.setAttribute(
      "aria-label",
      color.key ? `${color.label}, shortcut ${color.key}` : color.label
    );
    btn.innerHTML = `<span class="count" data-count="${i}">0</span>`;
    btn.addEventListener("click", () => setActive(i));
    wrap.appendChild(btn);
    if (color.custom) {
      wrap.classList.add("custom-swatch-wrap");
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "remove-color";
      remove.textContent = "×";
      remove.title = `Remove ${color.label}`;
      remove.setAttribute("aria-label", `Remove ${color.label}`);
      remove.addEventListener("click", () => removeCustomColor(i));
      wrap.appendChild(remove);
    }
    el.palette.appendChild(wrap);
  });

  const add = document.createElement("label");
  add.className = "swatch add-color";
  add.htmlFor = "custom-color";
  add.dataset.tip = "Add";
  add.title = "Add";
  add.setAttribute("aria-label", "Add custom color");
  add.tabIndex = 0;
  add.textContent = "+";
  add.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      el.customColor.click();
    }
  });
  el.palette.appendChild(add);
}

function customColorValues() {
  return colors.slice(BUILT_IN_COLOR_COUNT).map((color) => color.color);
}

function restoreCustomColors(values, legacyValue) {
  colors.splice(BUILT_IN_COLOR_COUNT);
  const customValues = Array.isArray(values)
    ? values
    : typeof legacyValue === "string"
      ? [legacyValue]
      : [];
  customValues
    .filter((value) => /^#[0-9a-f]{6}$/i.test(value))
    .forEach((color, index) => {
      colors.push({
        label: color,
        color,
        number: index + 1,
        key: index < 9 ? String(index + 1) : null,
        custom: true,
      });
    });
  if (state.active >= colors.length) state.active = 0;
}

function addCustomColor(value) {
  if (!/^#[0-9a-f]{6}$/i.test(value)) return;
  const number = colors.length - BUILT_IN_COLOR_COUNT + 1;
  colors.push({
    label: value,
    color: value,
    number,
    key: number < 10 ? String(number) : null,
    custom: true,
  });
  buildPalette();
  updateCounts();
  setActive(colors.length - 1);
  save();
}

function removeCustomColor(index) {
  if (index < BUILT_IN_COLOR_COUNT || index >= colors.length) return;
  colors.splice(index, 1);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const value = state.grid[r][c];
      if (value === index) state.grid[r][c] = null;
      else if (value !== null && value > index) state.grid[r][c] = value - 1;
    }
  colors.slice(BUILT_IN_COLOR_COUNT).forEach((color, customIndex) => {
    const number = customIndex + 1;
    color.number = number;
    color.key = number < 10 ? String(number) : null;
  });
  if (state.active === index) state.active = 0;
  else if (state.active > index) state.active--;
  buildPalette();
  repaintAll();
  updateCounts();
  save();
}

// Relative brightness (0–1) of a hex color.
function luminance(hex) {
  const c = hex.replace("#", "");
  const n = c.length === 3 ? c.split("").map((x) => x + x).join("") : c;
  const r = parseInt(n.slice(0, 2), 16);
  const g = parseInt(n.slice(2, 4), 16);
  const b = parseInt(n.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

// Pick black or white text for readable contrast on a hex background.
function textColorFor(hex) {
  return luminance(hex) > 0.6 ? "#1f2328" : "#ffffff";
}

/* --------------------------------------------------------------------- */
/* State updates                                                         */
/* --------------------------------------------------------------------- */
function setActive(i) {
  state.active = i;
  document.querySelectorAll(".swatch").forEach((s) => {
    s.setAttribute("aria-pressed", String(Number(s.dataset.index) === i));
  });
  save();
}

function toggleCell(r, c, index) {
  // Toggle: painting a cell that already has this color clears it.
  state.grid[r][c] = state.grid[r][c] === index ? null : index;
  state.lastModified = { row: r, col: c };
  state.arrowStart = null; // a fresh edit resets the arrow-nav start point
  paintCell(r, c);
  updateCounts();
  save();
}

function paintCell(r, c) {
  const btn = cellEls[r][c];
  const v = state.grid[r][c];
  if (v === null) {
    btn.classList.remove("filled");
    btn.style.background = "";
  } else {
    btn.classList.add("filled");
    btn.style.background = colors[v].color;
  }
  btn.classList.toggle(
    "highlight",
    !!state.highlight && state.highlight.row === r && state.highlight.col === c
  );
}

function repaintAll() {
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) paintCell(r, c);
}

function updateCounts() {
  const counts = Array(colors.length).fill(0);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const v = state.grid[r][c];
      if (v !== null) counts[v]++;
    }
  document.querySelectorAll(".count").forEach((n) => {
    n.textContent = String(counts[Number(n.dataset.count)]);
  });
  return counts;
}

function applyColors() {
  el.root.style.setProperty("--plate-color", state.plateColor);
  el.root.style.setProperty("--logo-color", state.logoColor);
  el.plateColor.value = state.plateColor;
  el.logoColor.value = state.logoColor;
  // Empty dot locations are a dark overlay by default, which vanishes on a
  // dark plate. On dark plates, tint them lighter so they stay visible.
  const dark = luminance(state.plateColor) < 0.3;
  el.root.style.setProperty(
    "--cell-bg",
    dark ? "rgba(255, 255, 255, 0.12)" : "rgba(0, 0, 0, 0.28)"
  );
}

// Size the dots so the whole plate fits the available width. On desktop this
// removes horizontal scrolling; on very narrow screens the cell is clamped to a
// minimum and the stage scrolls instead.
function fitPlate() {
  const s = getComputedStyle(el.root);
  const pad = parseFloat(s.getPropertyValue("--plate-pad")) || 22;
  const sp = getComputedStyle(el.stage);
  const stagePadX =
    (parseFloat(sp.paddingLeft) || 0) + (parseFloat(sp.paddingRight) || 0);
  const avail = el.stage.clientWidth - stagePadX;
  if (!avail || avail <= 0) return;
  // The gap between dots scales with the dot size (see GAP_RATIO).
  // Across the width: 7 logo + 52 grid = 59 cells, 6 + 51 = 57 internal gaps,
  // plus 3 plate paddings (left, middle, right). Solve for cell given that
  // gap = cell * GAP_RATIO:
  //   avail = 3*pad + cellCount*cell + gapCount*(cell*GAP_RATIO)
  const cellCount = rows + cols;
  const gapCount = rows - 1 + (cols - 1);
  const raw = (avail - 3 * pad) / (cellCount + gapCount * GAP_RATIO);
  // Fractional (not floored) so the plate fills the width exactly, leaving no
  // centering gap on the sides. The zoom multiplier can enlarge it further.
  const cell = Math.max(10, Math.min(28, raw)) * state.zoom;
  el.root.style.setProperty("--cell", cell + "px");
  el.root.style.setProperty("--gap", cell * GAP_RATIO + "px");
}

// Change the mobile zoom and re-fit. The − button can't go below the natural
// fit (1×); the + button grows the dots up to ZOOM_MAX.
function setZoom(z) {
  state.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
  fitPlate();
  if (el.zoomLabel)
    el.zoomLabel.textContent = Math.round(state.zoom * 100) + "%";
  if (el.zoomOut) el.zoomOut.disabled = state.zoom <= ZOOM_MIN + 1e-9;
  if (el.zoomIn) el.zoomIn.disabled = state.zoom >= ZOOM_MAX - 1e-9;
}

/* --------------------------------------------------------------------- */
/* Keyboard (desktop)                                                    */
/* --------------------------------------------------------------------- */
function moveHighlight(dr, dc) {
  const prev = state.highlight ? { ...state.highlight } : null;
  let row, col;
  if (state.highlight) {
    row = Math.min(rows - 1, Math.max(0, state.highlight.row + dr));
    col = Math.min(cols - 1, Math.max(0, state.highlight.col + dc));
  } else {
    // Begin navigation at the cell cleared with Escape, else the last modified
    // cell, else the origin.
    const start = state.arrowStart || state.lastModified || { row: 0, col: 0 };
    row = start.row;
    col = start.col;
  }
  state.highlight = { row, col };
  state.arrowStart = { row, col }; // remember cursor for resuming after clear
  if (prev) paintCell(prev.row, prev.col);
  paintCell(row, col);
  // Keep keyboard focus on the stage so Space/Enter target the grid.
  el.stage.focus({ preventScroll: true });
  cellEls[row][col].scrollIntoView({ block: "nearest", inline: "nearest" });
}

function clearHighlight() {
  if (!state.highlight) return;
  const { row, col } = state.highlight;
  state.highlight = null;
  paintCell(row, col);
}

/* --------------------------------------------------------------------- */
/* Info popover                                                          */
/* --------------------------------------------------------------------- */
function showInfo() {
  el.infoPopover.hidden = false;
  el.infoBtn.setAttribute("aria-expanded", "true");
}

function hideInfo() {
  el.infoPopover.hidden = true;
  el.infoBtn.setAttribute("aria-expanded", "false");
}

function toggleInfo() {
  if (el.infoPopover.hidden) showInfo();
  else hideInfo();
}

function onKeyDown(e) {
  if (e.target.tagName === "INPUT") return;
  // Never override browser/OS shortcuts (e.g. Ctrl+R to refresh).
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  const moves = {
    ArrowUp: [-1, 0],
    ArrowDown: [1, 0],
    ArrowLeft: [0, -1],
    ArrowRight: [0, 1],
  };
  if (moves[e.key]) {
    e.preventDefault();
    moveHighlight(moves[e.key][0], moves[e.key][1]);
    return;
  }

  // Tab cycles the active color (Shift+Tab goes back).
  if (e.key === "Tab") {
    e.preventDefault();
    const n = colors.length;
    setActive((state.active + (e.shiftKey ? -1 : 1) + n) % n);
    return;
  }

  // Escape hides the arrow-navigation highlight; arrowStart already holds its
  // location so the next arrow press resumes from there.
  if (e.key === "Escape") {
    clearHighlight();
    return;
  }

  // Space / Enter apply or unapply the active color on the highlighted cell.
  if (e.key === " " || e.key === "Enter") {
    if (e.target.tagName === "BUTTON") return; // let real buttons activate
    if (state.highlight) {
      e.preventDefault();
      const { row, col } = state.highlight;
      toggleCell(row, col, state.active);
    }
    return;
  }

  if ((e.key === "Backspace" || e.key === "Delete") && state.highlight) {
    e.preventDefault();
    const { row, col } = state.highlight;
    state.grid[row][col] = null;
    state.lastModified = { row, col };
    paintCell(row, col);
    updateCounts();
    save();
    return;
  }

  const idx = colors.findIndex((c) => c.key === e.key.toLowerCase());
  if (idx !== -1 && state.highlight) {
    e.preventDefault();
    setActive(idx);
    const { row, col } = state.highlight;
    toggleCell(row, col, idx); // same-color key clears (toggle)
  } else if (idx !== -1) {
    setActive(idx);
  }
}

/* --------------------------------------------------------------------- */
/* Persistence                                                           */
/* --------------------------------------------------------------------- */
// Store one nullable color index per cell so the palette can grow without an
// encoding limit. String decoding below keeps older saved designs compatible.
function encodeGrid() {
  const encoded = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      encoded.push(state.grid[r][c]);
    }
  return encoded;
}

function encodeDesignGrid() {
  const encoded = [];
  for (let r = 0; r < rows; r++) {
    let row = "";
    for (let c = 0; c < cols; c++) {
      const value = state.grid[r][c];
      if (value === null) {
        row += ".";
      } else if (value < BUILT_IN_COLOR_COUNT) {
        row += colors[value].key;
      } else {
        const customIndex = value - BUILT_IN_COLOR_COUNT;
        if (customIndex < 9) {
          row += String(customIndex + 1);
        } else if (customIndex < 35) {
          row += String.fromCharCode("A".charCodeAt(0) + customIndex - 9);
        } else {
          return null;
        }
      }
    }
    encoded.push(row);
  }
  return encoded;
}

function decodeGrid(g, colorCount = colors.length) {
  if (Array.isArray(g) && g.length === rows * cols) {
    return g.map((value) =>
      value === null ||
      (Number.isInteger(value) && value >= 0 && value < colorCount)
        ? value
        : null
    );
  }
  if (typeof g !== "string" || g.length !== rows * cols) return null;
  return [...g].map((ch) => {
    const value = ch === "." ? null : parseInt(ch, 36);
    return value !== null && value < colorCount ? value : null;
  });
}

function applyGridString(g) {
  const decoded = decodeGrid(g);
  if (!decoded) return;
  let k = 0;
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      state.grid[r][c] = decoded[k++];
    }
}

function save() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        g: encodeGrid(),
        active: state.active,
        plate: state.plateColor,
        logo: state.logoColor,
        textSize: state.textSize,
        textAlign: state.textAlign,
        customColors: customColorValues(),
      })
    );
  } catch (_) {
    /* storage unavailable — ignore */
  }
}

function load() {
  let data;
  try {
    data = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
  } catch (_) {
    data = null;
  }
  if (!data) return;

  restoreCustomColors(data.customColors, data.custom);
  applyGridString(data.g);
  if (typeof data.active === "number" && data.active < colors.length)
    state.active = data.active;
  if (typeof data.plate === "string") state.plateColor = data.plate;
  if (typeof data.logo === "string") state.logoColor = data.logo;
  const legacySizes = { small: "narrow", medium: "regular", large: "wide" };
  const textSize = legacySizes[data.textSize] || data.textSize;
  if (window.NameplateFont && window.NameplateFont.SIZES[textSize])
    state.textSize = textSize;
  if (["left", "center", "right"].includes(data.textAlign))
    state.textAlign = data.textAlign;
}

/* --------------------------------------------------------------------- */
/* Downloads                                                             */
/* --------------------------------------------------------------------- */
function prepareExportCanvas(width, height, scale = 2) {
  const canvas = el.canvas;
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);
  return { canvas, ctx };
}

function downloadCanvas(canvas, filename) {
  const link = document.createElement("a");
  link.download = filename;
  link.href = canvas.toDataURL("image/png");
  link.click();
}

async function downloadImage() {
  const scale = 2;
  const cell = 24;
  const gap = 4;
  const pad = 28;

  const gridH = rows * cell + (rows - 1) * gap;
  const gridW = cols * cell + (cols - 1) * gap;
  const logoD = gridH;
  const plateW = pad + logoD + pad + gridW + pad;
  const plateH = pad + gridH + pad;

  const { canvas, ctx } = prepareExportCanvas(plateW, plateH, scale);

  ctx.fillStyle = state.plateColor;
  roundRect(ctx, 0, 0, plateW, plateH, 18);
  ctx.fill();

  const gx = pad + logoD + pad;
  const gy = pad;
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const x = gx + c * (cell + gap);
      const y = gy + r * (cell + gap);
      const v = state.grid[r][c];
      ctx.fillStyle = v === null ? "rgba(255,255,255,0.06)" : colors[v].color;
      roundRect(ctx, x, y, cell, cell, 5);
      ctx.fill();
    }

  await drawLogoOnCanvas(ctx, pad, pad, logoD);
  downloadCanvas(canvas, "nameplate.png");
}

function downloadCounts() {
  const counts = updateCounts();
  const used = colors
    .map((c, i) => ({ ...c, count: counts[i] }))
    .filter((c) => c.count > 0);
  const scale = 2;
  const pad = 24;
  const titleH = 28;
  const legendRowH = 30;
  const contentRows = Math.max(used.length, 1);
  const width = 360;
  const height = pad + titleH + contentRows * legendRowH + pad;
  const { canvas, ctx } = prepareExportCanvas(width, height, scale);

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "#1f2328";
  ctx.font = "700 18px -apple-system, Segoe UI, Arial, sans-serif";
  ctx.textBaseline = "middle";
  ctx.fillText("Inserts needed", pad, pad + titleH / 2);
  if (used.length) {
    used.forEach((c, i) => {
      const y = pad + titleH + i * legendRowH + legendRowH / 2;
      ctx.fillStyle = c.color;
      roundRect(ctx, pad, y - 10, 20, 20, 5);
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.15)";
      ctx.lineWidth = 1;
      roundRect(ctx, pad, y - 10, 20, 20, 5);
      ctx.stroke();
      ctx.fillStyle = "#1f2328";
      ctx.font = "400 16px -apple-system, Segoe UI, Arial, sans-serif";
      ctx.fillText(`${c.label} — ${c.count}`, pad + 30, y);
    });
  } else {
    ctx.fillStyle = "#656d76";
    ctx.font = "400 16px -apple-system, Segoe UI, Arial, sans-serif";
    ctx.fillText("No inserts needed", pad, pad + titleH + legendRowH / 2);
  }

  downloadCanvas(canvas, "nameplate-counts.png");
}

function downloadDesign() {
  const grid = encodeDesignGrid();
  if (!grid) {
    alert("Design downloads support up to 35 custom colors.");
    return;
  }
  const design = {
    name: "nameplate-design",
    plate: state.plateColor,
    logo: state.logoColor,
    grid,
  };
  const customColors = customColorValues();
  if (customColors.length) design.customColors = customColors;
  const blob = new Blob([JSON.stringify(design, null, 2) + "\n"], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.download = "nameplate-design.json";
  link.href = url;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function drawLogoOnCanvas(ctx, x, y, size) {
  return loadLogoSvg().then((svg) => {
    if (!svg) return;
    const colored = svg.replace(/fill="white"/g, `fill="${state.logoColor}"`);
    const url =
      "data:image/svg+xml;charset=utf-8," + encodeURIComponent(colored);
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const ar = img.width / img.height || 1;
        let w = size,
          h = size;
        if (ar >= 1) h = size / ar;
        else w = size * ar;
        ctx.drawImage(img, x + (size - w) / 2, y + (size - h) / 2, w, h);
        resolve();
      };
      img.onerror = () => resolve();
      img.src = url;
    });
  });
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/* --------------------------------------------------------------------- */
/* Wire up                                                               */
/* --------------------------------------------------------------------- */
function clearAll() {
  if (!confirm("Clear all dots? This cannot be undone.")) return;
  state.grid = Array.from({ length: rows }, () => Array(cols).fill(null));
  state.lastModified = null;
  state.arrowStart = null;
  state.highlight = null;
  repaintAll();
  updateCounts();
  save();
}

// Shift every dot by one column. delta = -1 shifts left, +1 shifts right.
// Wraps around the edges so no dots are ever lost and the action is reversible.
function shiftColumns(delta) {
  state.grid = state.grid.map((row) => {
    const next = Array(cols).fill(null);
    for (let c = 0; c < cols; c++) next[c] = row[(c - delta + cols) % cols];
    return next;
  });
  // Keep tracked positions (highlight / arrow-nav anchors) on the same dots.
  const shiftPos = (p) =>
    p ? { row: p.row, col: (p.col + delta + cols) % cols } : p;
  state.highlight = shiftPos(state.highlight);
  state.lastModified = shiftPos(state.lastModified);
  state.arrowStart = shiftPos(state.arrowStart);
  repaintAll();
  updateCounts();
  save();
}

/* --------------------------------------------------------------------- */
/* Side menu (drawer)                                                    */
/* --------------------------------------------------------------------- */
function openMenu() {
  el.drawer.classList.add("open");
  el.drawerOverlay.classList.add("open");
  el.drawer.setAttribute("aria-hidden", "false");
  el.menuBtn.setAttribute("aria-expanded", "true");
}

function closeMenu() {
  el.drawer.classList.remove("open");
  el.drawerOverlay.classList.remove("open");
  el.drawer.setAttribute("aria-hidden", "true");
  el.menuBtn.setAttribute("aria-expanded", "false");
}

function toggleMenu() {
  if (el.drawer.classList.contains("open")) closeMenu();
  else openMenu();
}

/* --------------------------------------------------------------------- */
/* Write a word (stamp text as dots)                                     */
/* --------------------------------------------------------------------- */
// Fill the grid with a word rendered in the active color. Letters are included
// until the next one would overflow the 52 columns, then the visible dots are
// aligned within the plate.
function applyText(raw) {
  const F = window.NameplateFont;
  if (!F) return;
  const word = String(raw == null ? "" : raw);
  if (!word) return; // nothing typed — leave the current design alone

  // Writing a word replaces the current dots so the result is predictable.
  state.grid = Array.from({ length: rows }, () => Array(cols).fill(null));

  const textColumns = [];
  for (const ch of word) {
    const glyph = F.charColumns(ch, state.textSize);
    const w = glyph.length;
    if (w === 0) continue; // unsupported character — skip it
    const spacer = textColumns.length ? 1 : 0;
    if (textColumns.length + spacer + w > cols) break;
    if (spacer) textColumns.push(Array(rows).fill(false));
    textColumns.push(...glyph);
  }

  const filledColumns = textColumns
    .map((column, index) => (column.some(Boolean) ? index : -1))
    .filter((index) => index >= 0);
  if (filledColumns.length) {
    const first = filledColumns[0];
    const last = filledColumns[filledColumns.length - 1];
    const visibleWidth = last - first + 1;
    let visibleStart = 0;
    if (state.textAlign === "center")
      visibleStart = Math.floor((cols - visibleWidth) / 2);
    else if (state.textAlign === "right") visibleStart = cols - visibleWidth;
    const offset = visibleStart - first;

    for (let tc = 0; tc < textColumns.length; tc++) {
      const col = textColumns[tc];
      for (let r = 0; r < rows; r++) {
        const target = offset + tc;
        if (col[r] && target >= 0 && target < cols)
          state.grid[r][target] = state.active;
      }
    }
  }

  state.highlight = null;
  state.lastModified = null;
  state.arrowStart = null;
  repaintAll();
  updateCounts();
  save();
}

// Change the letter size for the write-a-word tool and re-render the current
// word so the change is visible immediately.
function setTextSize(size) {
  if (!window.NameplateFont || !window.NameplateFont.SIZES[size]) return;
  state.textSize = size;
  document.querySelectorAll(".size-btn").forEach((b) => {
    b.setAttribute("aria-pressed", String(b.dataset.size === size));
  });
  save();
  if (el.textInput.value) applyText(el.textInput.value);
}

function setTextAlign(align) {
  if (!["left", "center", "right"].includes(align)) return;
  state.textAlign = align;
  document.querySelectorAll(".align-btn").forEach((button) => {
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.align === align)
    );
  });
  save();
  if (el.textInput.value) applyText(el.textInput.value);
}

/* --------------------------------------------------------------------- */
/* Saved designs                                                         */
/* --------------------------------------------------------------------- */
function loadSaved() {
  try {
    const arr = JSON.parse(localStorage.getItem(SAVED_KEY) || "[]");
    return Array.isArray(arr) ? arr : [];
  } catch (_) {
    return [];
  }
}

function persistSaved(arr) {
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(arr));
  } catch (_) {
    /* storage unavailable — ignore */
  }
}

function saveDesign() {
  const name = el.designName.value.trim();
  if (!name) {
    el.designName.focus();
    return;
  }
  const arr = loadSaved();
  const entry = {
    name,
    g: encodeGrid(),
    plate: state.plateColor,
    logo: state.logoColor,
    customColors: customColorValues(),
    savedAt: Date.now(),
  };
  const i = arr.findIndex((d) => d.name === name);
  if (i >= 0) {
    if (!confirm(`Replace saved design "${name}"?`)) return;
    arr[i] = entry;
  } else {
    arr.push(entry);
  }
  persistSaved(arr);
  el.designName.value = "";
  renderSavedList();
}

function loadDesign(name) {
  const d = loadSaved().find((x) => x.name === name);
  if (!d) return;
  restoreCustomColors(d.customColors, d.custom);
  applyGridString(d.g);
  if (typeof d.plate === "string") state.plateColor = d.plate;
  if (typeof d.logo === "string") state.logoColor = d.logo;
  state.highlight = null;
  state.lastModified = null;
  state.arrowStart = null;
  applyColors();
  buildPalette();
  repaintAll();
  updateCounts();
  save();
  closeMenu();
}

function designGridString(design) {
  const designCustomColors = getDesignCustomColors(design);
  const designColorCount = BUILT_IN_COLOR_COUNT + designCustomColors.length;
  if (Array.isArray(design.g) || typeof design.g === "string")
    return decodeGrid(design.g, designColorCount);
  if (
    Array.isArray(design.grid) &&
    design.grid.length === rows &&
    design.grid.every((row) => typeof row === "string" && row.length === cols)
  ) {
    const encoded = [];
    for (const ch of design.grid.join("")) {
      if (ch === ".") {
        encoded.push(null);
        continue;
      }
      if (ch === "c" && designCustomColors.length) {
        encoded.push(BUILT_IN_COLOR_COUNT);
        continue;
      }
      const colorIndex = colors
        .slice(0, BUILT_IN_COLOR_COUNT)
        .findIndex((color) => color.key === ch);
      if (colorIndex >= 0) {
        encoded.push(colorIndex);
        continue;
      }
      if (/^[A-Z]$/.test(ch)) {
        const customNumber = ch.charCodeAt(0) - "A".charCodeAt(0) + 10;
        if (customNumber <= designCustomColors.length) {
          encoded.push(BUILT_IN_COLOR_COUNT + customNumber - 1);
          continue;
        }
      }
      const customNumber = Number(ch);
      if (
        Number.isInteger(customNumber) &&
        customNumber > 0 &&
        customNumber <= designCustomColors.length
      ) {
        encoded.push(BUILT_IN_COLOR_COUNT + customNumber - 1);
        continue;
      }
      const legacyIndex = parseInt(ch, 36);
      if (!Number.isInteger(legacyIndex) || legacyIndex >= designColorCount)
        return null;
      encoded.push(legacyIndex);
    }
    return encoded;
  }
  return null;
}

function getDesignCustomColors(design) {
  if (Array.isArray(design.customColors)) return design.customColors;
  return typeof design.custom === "string" ? [design.custom] : [];
}

function applyDesignData(design, grid) {
  restoreCustomColors(design.customColors, design.custom);
  applyGridString(grid);
  if (typeof design.plate === "string") state.plateColor = design.plate;
  if (typeof design.logo === "string") state.logoColor = design.logo;
  state.highlight = null;
  state.lastModified = null;
  state.arrowStart = null;
  applyColors();
  buildPalette();
  repaintAll();
  updateCounts();
  setActive(state.active);
  save();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function validateUploadedDesign(design) {
  if (!design || typeof design !== "object" || Array.isArray(design))
    throw new Error("The file must contain a JSON design object.");
  if (typeof design.name !== "string" || !design.name.trim())
    throw new Error("The design must include a name.");
  if (!/^#[0-9a-f]{6}$/i.test(design.plate))
    throw new Error("The design must include a six-digit plate color.");
  if (!/^#[0-9a-f]{6}$/i.test(design.logo))
    throw new Error("The design must include a six-digit logo color.");

  const customColors = design.customColors ?? [];
  if (
    !Array.isArray(customColors) ||
    customColors.length > 35 ||
    customColors.some((color) => !/^#[0-9a-f]{6}$/i.test(color))
  ) {
    throw new Error("Custom colors must be an array of up to 35 hex colors.");
  }
  if (
    !Array.isArray(design.grid) ||
    design.grid.length !== rows ||
    !design.grid.every(
      (row) => typeof row === "string" && row.length === cols
    )
  ) {
    throw new Error(`The grid must contain ${rows} rows of ${cols} characters.`);
  }
  const builtInKeys = new Set(
    colors.slice(0, BUILT_IN_COLOR_COUNT).map((color) => color.key)
  );
  for (const ch of design.grid.join("")) {
    if (ch === "." || builtInKeys.has(ch)) continue;
    if (/^[1-9]$/.test(ch) && Number(ch) <= customColors.length) continue;
    if (
      /^[A-Z]$/.test(ch) &&
      ch.charCodeAt(0) - "A".charCodeAt(0) + 10 <= customColors.length
    ) {
      continue;
    }
    throw new Error(`The grid contains an unknown color reference: ${ch}`);
  }

  const grid = designGridString(design);
  if (!grid) throw new Error("The grid contains an unknown color reference.");
  return grid;
}

async function uploadDesignFile(file) {
  try {
    const design = JSON.parse(await file.text());
    const grid = validateUploadedDesign(design);
    applyDesignData(design, grid);
    closeMenu();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "The file could not be read.";
    alert(`Could not upload design: ${message}`);
  } finally {
    el.designFile.value = "";
  }
}

function renderInspiration(designs) {
  el.inspirationGrid.innerHTML = "";
  if (!designs.length) {
    el.inspirationGrid.innerHTML =
      '<p class="inspiration-status">No examples are available yet.</p>';
    return;
  }

  designs.forEach((design) => {
    const grid = designGridString(design);
    if (!grid) return;
    const card = document.createElement("button");
    card.type = "button";
    card.className = "inspiration-card";
    card.setAttribute(
      "aria-label",
      `Use ${design.name || "inspirational"} design`
    );
    card.addEventListener("click", () => applyDesignData(design, grid));

    const preview = document.createElement("div");
    preview.className = "inspiration-preview";
    preview.style.setProperty("--preview-plate", design.plate || "#000000");
    preview.style.setProperty("--preview-logo", design.logo || "#ffffff");
    const logo = document.createElement("span");
    logo.setAttribute("aria-hidden", "true");
    logo.className = "inspiration-logo";
    const dotGrid = document.createElement("span");
    dotGrid.setAttribute("aria-hidden", "true");
    dotGrid.className = "inspiration-dot-grid";
    const designCustomColors = getDesignCustomColors(design);
    const previewColors = [
      ...colors.slice(0, BUILT_IN_COLOR_COUNT).map((color) => color.color),
      ...designCustomColors,
    ];
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        const index = grid[r * cols + c];
        const dot = document.createElement("span");
        dot.className = "inspiration-dot";
        if (index !== null && previewColors[index]) {
          dot.style.background = previewColors[index];
        }
        dotGrid.appendChild(dot);
      }
    }
    preview.append(logo, dotGrid);

    card.appendChild(preview);
    el.inspirationGrid.appendChild(card);
  });
}

async function loadInspiration() {
  try {
    const indexResponse = await fetch(INSPIRATION_INDEX);
    if (!indexResponse.ok) throw new Error("Unable to load inspiration index");
    const files = await indexResponse.json();
    if (!Array.isArray(files)) throw new Error("Invalid inspiration index");
    const responses = await Promise.all(
      files.map((file) => fetch(`inspiration/${file}`))
    );
    if (responses.some((response) => !response.ok))
      throw new Error("Unable to load an inspiration design");
    renderInspiration(await Promise.all(responses.map((r) => r.json())));
  } catch (error) {
    console.error(error);
    el.inspirationGrid.innerHTML =
      '<p class="inspiration-status">Examples could not be loaded.</p>';
  }
}

function deleteDesign(name) {
  persistSaved(loadSaved().filter((x) => x.name !== name));
  renderSavedList();
}

function renderSavedList() {
  const arr = loadSaved().sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  el.savedList.innerHTML = "";
  if (!arr.length) {
    const li = document.createElement("li");
    li.className = "saved-empty";
    li.textContent = "No saved designs yet.";
    el.savedList.appendChild(li);
    return;
  }
  for (const d of arr) {
    const li = document.createElement("li");
    li.className = "saved-item";

    const loadBtn = document.createElement("button");
    loadBtn.type = "button";
    loadBtn.className = "saved-load";
    loadBtn.textContent = d.name;
    loadBtn.title = `Load "${d.name}"`;
    loadBtn.addEventListener("click", () => loadDesign(d.name));

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "saved-delete";
    delBtn.setAttribute("aria-label", `Delete ${d.name}`);
    delBtn.title = `Delete "${d.name}"`;
    delBtn.textContent = "×";
    delBtn.addEventListener("click", () => {
      if (confirm(`Delete saved design "${d.name}"?`)) deleteDesign(d.name);
    });

    li.append(loadBtn, delBtn);
    el.savedList.appendChild(li);
  }
}

function init() {
  loadLogoSvg(); // warm the SVG so exports are instant
  load();
  buildGrid();
  buildPalette();
  applyColors();
  fitPlate();
  repaintAll();
  updateCounts();
  setActive(state.active);

  el.plateColor.addEventListener("input", (e) => {
    state.plateColor = e.target.value;
    applyColors();
    save();
  });
  el.logoColor.addEventListener("input", (e) => {
    state.logoColor = e.target.value;
    applyColors();
    save();
  });
  el.customColor.addEventListener("change", (e) =>
    addCustomColor(e.target.value)
  );
  el.clearAll.addEventListener("click", clearAll);
  el.uploadDesign.addEventListener("click", () => el.designFile.click());
  el.designFile.addEventListener("change", () => {
    const [file] = el.designFile.files;
    if (file) uploadDesignFile(file);
  });
  el.downloadImage.addEventListener("click", downloadImage);
  el.downloadCounts.addEventListener("click", downloadCounts);
  el.downloadDesign.addEventListener("click", downloadDesign);
  el.shiftLeft.addEventListener("click", () => shiftColumns(-1));
  el.shiftRight.addEventListener("click", () => shiftColumns(1));
  el.infoBtn.addEventListener("click", toggleInfo);
  el.zoomIn.addEventListener("click", () => setZoom(state.zoom + ZOOM_STEP));
  el.zoomOut.addEventListener("click", () => setZoom(state.zoom - ZOOM_STEP));
  setZoom(state.zoom); // initialize label + button disabled states

  // Side menu (drawer)
  renderSavedList();
  loadInspiration();
  el.menuBtn.addEventListener("click", toggleMenu);
  el.drawerClose.addEventListener("click", closeMenu);
  el.drawerOverlay.addEventListener("click", closeMenu);
  // Write-a-word tool (main screen): apply live, debounced as the user types.
  let textDebounce = null;
  el.textInput.addEventListener("input", () => {
    clearTimeout(textDebounce);
    textDebounce = setTimeout(() => applyText(el.textInput.value), 300);
  });
  el.textInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      clearTimeout(textDebounce);
      applyText(el.textInput.value); // apply immediately on Enter
    }
  });
  document.querySelectorAll(".size-btn").forEach((b) => {
    b.addEventListener("click", () => setTextSize(b.dataset.size));
  });
  setTextSize(state.textSize); // reflect the restored/default size on the buttons
  document.querySelectorAll(".align-btn").forEach((button) => {
    button.addEventListener("click", () => setTextAlign(button.dataset.align));
  });
  setTextAlign(state.textAlign);
  el.saveDesignBtn.addEventListener("click", saveDesign);
  el.designName.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      saveDesign();
    }
  });
  // Escape closes the drawer even while a menu input is focused (the color
  // shortcut handler ignores keys typed into inputs, so add a dedicated one).
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && el.drawer.classList.contains("open")) closeMenu();
  });

  document.addEventListener("keydown", onKeyDown);
  window.addEventListener("resize", fitPlate);

  // Any click deactivates the arrow-navigation highlight and closes the info
  // popover when the click lands outside it.
  document.addEventListener("click", (e) => {
    clearHighlight();
    if (!el.infoPopover.hidden && !el.infoWrap.contains(e.target)) hideInfo();
  });
}

init();
