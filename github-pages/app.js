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
// Separate store for designs saved from the main designer.
const SAVED_KEY = "nameplate-saved-v1";
const INSPIRATION_INDEX = "inspiration.json";
const SUBTITLES_SRC = "subtitles.json";
const PNG_DESIGN_KEYWORD = "NameplateDesign";
const PNG_SIGNATURE = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const UTF8_ENCODER = new TextEncoder();
const UTF8_DECODER = new TextDecoder();

// Every nameplate location uses this geometry. Measurements are ratios of one
// cell so previews, the editor, zoomed views, and exports keep identical
// proportions.
const NAMEPLATE_LAYOUT = Object.freeze({
  gapRatio: 0.2,
  paddingRatio: 1.1,
  plateRadiusRatio: 0.8,
  cellRadiusRatio: 0.2,
  maxFittedCell: 28,
});

// Mobile zoom: multiplies the auto-fitted dot size so the nameplate can be made
// taller (larger dots), at the cost of earlier horizontal scrolling.
const ZOOM_MIN = 1;
const ZOOM_MAX = 6;
const ZOOM_STEP = 0.25;
const DEFAULT_MOBILE_ZOOMS = {
  portrait: 4.75,
  landscape: 2.25,
};
const MOBILE_ZOOM_QUERY =
  "(max-width: 640px), (hover: none) and (pointer: coarse)";

function isMobileZoomMode() {
  return window.matchMedia(MOBILE_ZOOM_QUERY).matches;
}

function zoomOrientation() {
  return window.matchMedia("(orientation: portrait)").matches
    ? "portrait"
    : "landscape";
}

function validZoom(value, fallback) {
  return Number.isFinite(value)
    ? Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, value))
    : fallback;
}

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

function getNameplateMetrics(cell, { showLogo = true } = {}) {
  const gap = cell * NAMEPLATE_LAYOUT.gapRatio;
  const padding = cell * NAMEPLATE_LAYOUT.paddingRatio;
  const gridHeight = rows * cell + (rows - 1) * gap;
  const gridWidth = cols * cell + (cols - 1) * gap;
  const logoSize = gridHeight;
  return {
    cell,
    gap,
    padding,
    gridHeight,
    gridWidth,
    logoSize,
    width:
      padding * (showLogo ? 3 : 2) + (showLogo ? logoSize : 0) + gridWidth,
    height: padding * 2 + gridHeight,
    plateRadius: cell * NAMEPLATE_LAYOUT.plateRadiusRatio,
    cellRadius: cell * NAMEPLATE_LAYOUT.cellRadiusRatio,
  };
}

function setNameplateCellSize(plate, cell) {
  const cellKey = cell.toFixed(4);
  if (plate.dataset.nameplateCell === cellKey) return null;
  plate.dataset.nameplateCell = cellKey;
  const metrics = getNameplateMetrics(cell, {
    showLogo: !plate.classList.contains("nameplate-no-logo"),
  });
  plate.style.setProperty("--nameplate-cell", `${metrics.cell}px`);
  plate.style.setProperty("--nameplate-gap", `${metrics.gap}px`);
  plate.style.setProperty("--nameplate-pad", `${metrics.padding}px`);
  plate.style.setProperty("--nameplate-logo-size", `${metrics.logoSize}px`);
  plate.style.setProperty("--nameplate-grid-width", `${metrics.gridWidth}px`);
  plate.style.setProperty("--nameplate-grid-height", `${metrics.gridHeight}px`);
  plate.style.setProperty("--nameplate-width", `${metrics.width}px`);
  plate.style.setProperty("--nameplate-height", `${metrics.height}px`);
  plate.style.setProperty("--nameplate-radius", `${metrics.plateRadius}px`);
  plate.style.setProperty("--nameplate-cell-radius", `${metrics.cellRadius}px`);
  plate.style.setProperty(
    "--nameplate-line",
    `${metrics.cell * 0.05}px`
  );
  plate.style.setProperty(
    "--nameplate-highlight-inner",
    `${metrics.cell * 0.1}px`
  );
  plate.style.setProperty(
    "--nameplate-highlight-outer",
    `${metrics.cell * 0.2}px`
  );
  return metrics;
}

function emptyCellColor(plateColor) {
  return luminance(plateColor) < 0.3
    ? "rgba(255, 255, 255, 0.12)"
    : "rgba(0, 0, 0, 0.28)";
}

function setNameplateColors(plate, plateColor, logoColor) {
  const dark = luminance(plateColor) < 0.3;
  plate.style.setProperty("--nameplate-plate-color", plateColor);
  plate.style.setProperty("--nameplate-logo-color", logoColor);
  plate.style.setProperty(
    "--nameplate-label-color",
    dark ? "#ffffff" : "#1f2328"
  );
  plate.style.setProperty("--nameplate-empty-color", emptyCellColor(plateColor));
}

function gridValueAt(grid, row, column) {
  return Array.isArray(grid[row])
    ? grid[row][column]
    : grid[row * cols + column];
}

function createNameplate({
  grid,
  palette,
  plateColor = CONFIG.defaultPlateColor,
  logoColor = CONFIG.defaultLogoColor,
  interactive = false,
  showColumnNumbers = false,
  showEmptyCells = true,
  showLogo = true,
  showShadow = true,
  showCellDepth = true,
  decorative = false,
  onCellClick = null,
} = {}) {
  const plate = document.createElement("div");
  plate.className = "nameplate";
  plate.classList.toggle("nameplate-no-logo", !showLogo);
  plate.classList.toggle("nameplate-no-shadow", !showShadow);
  plate.classList.toggle("nameplate-hide-empty", !showEmptyCells);
  plate.classList.toggle("nameplate-flat-cells", !showCellDepth);
  if (decorative) plate.setAttribute("aria-hidden", "true");
  setNameplateCellSize(plate, 20);
  setNameplateColors(plate, plateColor, logoColor);

  if (showLogo) {
    const logo = document.createElement("div");
    logo.className = "nameplate-logo";
    if (!decorative) {
      logo.setAttribute("role", "img");
      logo.setAttribute("aria-label", "GitHub logo");
    }
    plate.appendChild(logo);
  }

  const gridArea = document.createElement("div");
  gridArea.className = "nameplate-grid-area";

  let columnNumbers = null;
  if (interactive || showColumnNumbers) {
    columnNumbers = document.createElement("div");
    columnNumbers.className = "nameplate-column-numbers";
    columnNumbers.setAttribute("aria-hidden", "true");
    columnNumbers.hidden = !showColumnNumbers;
    for (let column = 5; column <= cols; column += 5) {
      const label = document.createElement("span");
      label.className = "nameplate-column-number";
      label.textContent = String(column);
      label.style.setProperty("--column", column);
      columnNumbers.appendChild(label);
    }
    gridArea.appendChild(columnNumbers);
  }

  const gridElement = document.createElement("div");
  gridElement.className = "nameplate-grid";
  const cells = Array.from({ length: rows }, () => Array(cols).fill(null));
  for (let column = 0; column < cols; column++) {
    for (let row = 0; row < rows; row++) {
      const value = gridValueAt(grid, row, column);
      const cell = document.createElement(interactive ? "button" : "span");
      cell.className = "nameplate-cell";
      if (interactive) {
        cell.type = "button";
        cell.tabIndex = -1;
        cell.dataset.r = String(row);
        cell.dataset.c = String(column);
        cell.setAttribute(
          "aria-label",
          `Row ${row + 1}, column ${column + 1}`
        );
        cell.addEventListener("click", () => onCellClick?.(row, column, cell));
      } else {
        cell.setAttribute("aria-hidden", "true");
      }
      if (value !== null && palette[value]) {
        cell.classList.add("filled");
        cell.style.background = palette[value];
      }
      cells[row][column] = cell;
      gridElement.appendChild(cell);
    }
  }
  gridArea.appendChild(gridElement);
  plate.appendChild(gridArea);

  return { plate, grid: gridElement, columnNumbers, cells };
}

function fitNameplateToWidth(plate, width, zoom = 1, maxCell = Infinity) {
  if (!width || width <= 0) return null;
  const widthUnits = getNameplateMetrics(1, {
    showLogo: !plate.classList.contains("nameplate-no-logo"),
  }).width;
  const cell = Math.min(maxCell, width / widthUnits) * zoom;
  return setNameplateCellSize(plate, Math.max(1, cell));
}

const state = {
  // grid[r][c] = color index (0..n-1) or null for empty
  grid: Array.from({ length: rows }, () => Array(cols).fill(null)),
  active: 0,
  plateColor: CONFIG.defaultPlateColor,
  logoColor: CONFIG.defaultLogoColor,
  highlight: null, // { row, col } or null
  lastModified: null, // { row, col } — arrow nav starts here
  arrowStart: null, // { row, col } — set on Escape; overrides arrow-nav start
  zoom: isMobileZoomMode() ? DEFAULT_MOBILE_ZOOMS[zoomOrientation()] : 1,
  zooms: { ...DEFAULT_MOBILE_ZOOMS },
  textValue: "",
  textSize: "regular", // letter width for the write-a-word tool
  textAlign: "left",
  showColumnNumbers: false,
};

// DOM references
const el = {
  subtitle: document.getElementById("subtitle"),
  nameplateHost: document.getElementById("nameplate-host"),
  plate: null,
  grid: null,
  palette: document.getElementById("palette"),
  columnNumbers: null,
  showColumnNumbers: document.getElementById("show-column-numbers"),
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
  zoomIn: document.getElementById("zoom-in"),
  zoomOut: document.getElementById("zoom-out"),
  zoomLabel: document.getElementById("zoom-label"),
  menuBtn: document.getElementById("menu-btn"),
  drawer: document.getElementById("drawer"),
  drawerOverlay: document.getElementById("drawer-overlay"),
  drawerClose: document.getElementById("drawer-close"),
  textInput: document.getElementById("text-input"),
  saveDesignBtn: document.getElementById("save-design"),
  savedDesignsSection: document.getElementById("saved-designs-section"),
  savedDesignsGrid: document.getElementById("saved-designs-grid"),
  inspirationGrid: document.getElementById("inspiration-grid"),
};

const cellEls = []; // cellEls[r][c] -> button element

async function loadSubtitle() {
  try {
    const response = await fetch(SUBTITLES_SRC);
    if (!response.ok) throw new Error("Unable to load subtitles");
    const subtitles = await response.json();
    if (
      !Array.isArray(subtitles) ||
      !subtitles.length ||
      subtitles.some((subtitle) => typeof subtitle !== "string" || !subtitle)
    ) {
      throw new Error("Invalid subtitles");
    }
    el.subtitle.textContent =
      subtitles[Math.floor(Math.random() * subtitles.length)];
  } catch (error) {
    console.error(error);
  } finally {
    el.subtitle.classList.remove("subtitle-loading");
  }
}

/* --------------------------------------------------------------------- */
/* Build UI                                                              */
/* --------------------------------------------------------------------- */
function buildGrid() {
  cellEls.length = 0;
  const rendered = createNameplate({
    grid: state.grid,
    palette: colors.map((color) => color.color),
    plateColor: state.plateColor,
    logoColor: state.logoColor,
    interactive: true,
    showColumnNumbers: state.showColumnNumbers,
    onCellClick(row, column, cell) {
      toggleCell(row, column, state.active);
      cell.blur();
    },
  });
  el.nameplateHost.replaceChildren(rendered.plate);
  el.plate = rendered.plate;
  el.grid = rendered.grid;
  el.columnNumbers = rendered.columnNumbers;
  for (const row of rendered.cells) cellEls.push(row);
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
  setNameplateColors(el.plate, state.plateColor, state.logoColor);
  el.plateColor.value = state.plateColor;
  el.logoColor.value = state.logoColor;
}

// Size the dots so the whole plate fits the available width. Mobile starts with
// a complete overview; the zoom controls can then enlarge it for precise edits.
function fitPlate() {
  const sp = getComputedStyle(el.stage);
  const stagePadX =
    (parseFloat(sp.paddingLeft) || 0) + (parseFloat(sp.paddingRight) || 0);
  const avail = el.stage.clientWidth - stagePadX;
  fitNameplateToWidth(
    el.plate,
    avail,
    state.zoom,
    NAMEPLATE_LAYOUT.maxFittedCell
  );
  el.stage.style.height = "";
}

// Change the mobile zoom and re-fit. The − button can't go below the natural
// fit (1×); the + button grows the dots up to ZOOM_MAX.
function setZoom(z, remember = true) {
  state.zoom = validZoom(z, state.zoom);
  if (remember && isMobileZoomMode()) {
    state.zooms[zoomOrientation()] = state.zoom;
    save();
  }
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
        text: state.textValue,
        textSize: state.textSize,
        textAlign: state.textAlign,
        showColumnNumbers: state.showColumnNumbers,
        zooms: state.zooms,
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
  if (typeof data.text === "string") state.textValue = data.text;
  if (typeof data.showColumnNumbers === "boolean")
    state.showColumnNumbers = data.showColumnNumbers;
  if (data.zooms && typeof data.zooms === "object") {
    state.zooms.portrait = validZoom(
      data.zooms.portrait,
      DEFAULT_MOBILE_ZOOMS.portrait
    );
    state.zooms.landscape = validZoom(
      data.zooms.landscape,
      DEFAULT_MOBILE_ZOOMS.landscape
    );
  }
  if (isMobileZoomMode()) state.zoom = state.zooms[zoomOrientation()];
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

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.download = filename;
  link.href = url;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function canvasToPngBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("The image could not be created."));
    }, "image/png");
  });
}

function hasPngSignature(bytes) {
  return (
    bytes.length >= PNG_SIGNATURE.length &&
    PNG_SIGNATURE.every((value, index) => bytes[index] === value)
  );
}

function readUint32(bytes, offset) {
  return new DataView(
    bytes.buffer,
    bytes.byteOffset + offset,
    4
  ).getUint32(0);
}

let pngCrcTable = null;

function pngCrc32(bytes) {
  if (!pngCrcTable) {
    pngCrcTable = new Uint32Array(256);
    for (let n = 0; n < pngCrcTable.length; n++) {
      let value = n;
      for (let bit = 0; bit < 8; bit++) {
        value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      }
      pngCrcTable[n] = value >>> 0;
    }
  }

  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = pngCrcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createPngChunk(type, data) {
  const typeBytes = UTF8_ENCODER.encode(type);
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);

  const crcInput = new Uint8Array(typeBytes.length + data.length);
  crcInput.set(typeBytes);
  crcInput.set(data, typeBytes.length);
  view.setUint32(8 + data.length, pngCrc32(crcInput));
  return chunk;
}

function createDesignPngChunk(design) {
  const keyword = UTF8_ENCODER.encode(PNG_DESIGN_KEYWORD);
  const json = UTF8_ENCODER.encode(JSON.stringify(design));
  const data = new Uint8Array(keyword.length + 5 + json.length);
  data.set(keyword);

  let offset = keyword.length + 1;
  data[offset++] = 0; // Uncompressed iTXt.
  data[offset++] = 0;
  data[offset++] = 0; // Empty language tag.
  data[offset++] = 0; // Empty translated keyword.
  data.set(json, offset);
  return createPngChunk("iTXt", data);
}

function embedDesignInPng(bytes, design) {
  if (!hasPngSignature(bytes)) throw new Error("The exported PNG is invalid.");

  let offset = PNG_SIGNATURE.length;
  while (offset + 12 <= bytes.length) {
    const length = readUint32(bytes, offset);
    const chunkEnd = offset + 12 + length;
    if (chunkEnd > bytes.length) throw new Error("The exported PNG is invalid.");

    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (type === "IEND") {
      const metadata = createDesignPngChunk(design);
      const result = new Uint8Array(bytes.length + metadata.length);
      result.set(bytes.subarray(0, offset));
      result.set(metadata, offset);
      result.set(bytes.subarray(offset), offset + metadata.length);
      return result;
    }
    offset = chunkEnd;
  }

  throw new Error("The exported PNG is missing its end marker.");
}

async function downloadImage() {
  const design = createDownloadDesign();
  if (!design) {
    alert("Design downloads support up to 35 custom colors.");
    return;
  }

  const scale = 2;
  const cell = 24;
  const metrics = getNameplateMetrics(cell);
  const exportWidth = Math.ceil(metrics.width);
  const exportHeight = Math.ceil(metrics.height);

  const { canvas, ctx } = prepareExportCanvas(
    exportWidth,
    exportHeight,
    scale
  );

  ctx.fillStyle = state.plateColor;
  roundRect(ctx, 0, 0, exportWidth, exportHeight, metrics.plateRadius);
  ctx.fill();

  const gx = metrics.padding + metrics.logoSize + metrics.padding;
  const gy = metrics.padding;
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const x = gx + c * (cell + metrics.gap);
      const y = gy + r * (cell + metrics.gap);
      const v = state.grid[r][c];
      ctx.fillStyle =
        v === null ? emptyCellColor(state.plateColor) : colors[v].color;
      roundRect(ctx, x, y, cell, cell, metrics.cellRadius);
      ctx.fill();
    }

  await drawLogoOnCanvas(
    ctx,
    metrics.padding,
    metrics.padding,
    metrics.logoSize,
    state.logoColor
  );
  try {
    const blob = await canvasToPngBlob(canvas);
    const png = embedDesignInPng(
      new Uint8Array(await blob.arrayBuffer()),
      design
    );
    downloadBlob(new Blob([png], { type: "image/png" }), "nameplate.png");
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "The image could not be created.";
    alert(`Could not download design: ${message}`);
  }
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

function createDownloadDesign() {
  const grid = encodeDesignGrid();
  if (!grid) return null;

  const design = {
    name: "nameplate-design",
    plate: state.plateColor,
    logo: state.logoColor,
    grid,
  };
  const customColors = customColorValues();
  if (customColors.length) design.customColors = customColors;
  return design;
}

function downloadDesign() {
  const design = createDownloadDesign();
  if (!design) {
    alert("Design downloads support up to 35 custom colors.");
    return;
  }

  const blob = new Blob([JSON.stringify(design, null, 2) + "\n"], {
    type: "application/json",
  });
  downloadBlob(blob, "nameplate-design.json");
}

function drawLogoOnCanvas(ctx, x, y, size, logoColor) {
  return loadLogoSvg().then((svg) => {
    if (!svg) return;
    const colored = svg.replace(/fill="white"/g, `fill="${logoColor}"`);
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

function createSavedDesignId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function saveDesign() {
  const arr = loadSaved();
  arr.push({
    id: createSavedDesignId(),
    g: encodeGrid(),
    plate: state.plateColor,
    logo: state.logoColor,
    customColors: customColorValues(),
    savedAt: Date.now(),
  });
  persistSaved(arr);
  renderSavedDesigns();
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

function findNullByte(bytes, start, end) {
  for (let offset = start; offset < end; offset++) {
    if (bytes[offset] === 0) return offset;
  }
  return -1;
}

function readDesignPngChunk(data) {
  const keywordEnd = findNullByte(data, 0, data.length);
  if (keywordEnd < 0) return null;

  const keyword = UTF8_DECODER.decode(data.subarray(0, keywordEnd));
  if (keyword !== PNG_DESIGN_KEYWORD) return null;

  const compressionFlagOffset = keywordEnd + 1;
  if (compressionFlagOffset + 4 > data.length)
    throw new Error("The embedded design metadata is invalid.");
  if (data[compressionFlagOffset] !== 0)
    throw new Error("The embedded design metadata is compressed.");

  const languageEnd = findNullByte(
    data,
    compressionFlagOffset + 2,
    data.length
  );
  if (languageEnd < 0)
    throw new Error("The embedded design metadata is invalid.");
  const translatedKeywordEnd = findNullByte(
    data,
    languageEnd + 1,
    data.length
  );
  if (translatedKeywordEnd < 0)
    throw new Error("The embedded design metadata is invalid.");

  return UTF8_DECODER.decode(data.subarray(translatedKeywordEnd + 1));
}

function extractDesignFromPng(bytes) {
  if (!hasPngSignature(bytes)) throw new Error("The PNG file is invalid.");

  let offset = PNG_SIGNATURE.length;
  while (offset + 12 <= bytes.length) {
    const length = readUint32(bytes, offset);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const chunkEnd = dataEnd + 4;
    if (chunkEnd > bytes.length) throw new Error("The PNG file is invalid.");

    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (type === "iTXt") {
      const json = readDesignPngChunk(bytes.subarray(dataStart, dataEnd));
      if (json !== null) return JSON.parse(json);
    }
    if (type === "IEND") break;
    offset = chunkEnd;
  }

  throw new Error("This PNG does not contain an embedded nameplate design.");
}

async function readUploadedDesign(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const expectsPng = file.type === "image/png" || /\.png$/i.test(file.name);
  if (hasPngSignature(bytes)) return extractDesignFromPng(bytes);
  if (expectsPng) throw new Error("The PNG file is invalid.");
  return JSON.parse(UTF8_DECODER.decode(bytes));
}

async function uploadDesignFile(file) {
  try {
    const design = await readUploadedDesign(file);
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

function createDesignCard(design, grid, ariaLabel) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "inspiration-card";
  card.setAttribute("aria-label", ariaLabel);
  card.addEventListener("click", () => applyDesignData(design, grid));

  const preview = document.createElement("div");
  preview.className = "inspiration-preview";
  const designCustomColors = getDesignCustomColors(design);
  const previewColors = [
    ...colors.slice(0, BUILT_IN_COLOR_COUNT).map((color) => color.color),
    ...designCustomColors,
  ];
  const rendered = createNameplate({
    grid,
    palette: previewColors,
    plateColor: design.plate || CONFIG.defaultPlateColor,
    logoColor: design.logo || CONFIG.defaultLogoColor,
    showShadow: false,
    showCellDepth: false,
    decorative: true,
  });
  preview.appendChild(rendered.plate);
  card.appendChild(preview);
  return card;
}

function fitNameplatePreviews(root = document) {
  const previews = [...root.querySelectorAll(".inspiration-preview")]
    .map((preview) => ({
      plate: preview.querySelector(".nameplate"),
      width: preview.clientWidth,
    }))
    .filter(({ plate }) => plate);
  for (const { plate, width } of previews)
    fitNameplateToWidth(plate, width);
}

let layoutFitFrame = null;

function scheduleLayoutFit() {
  if (layoutFitFrame !== null) return;
  layoutFitFrame = requestAnimationFrame(() => {
    layoutFitFrame = null;
    fitPlate();
    fitNameplatePreviews();
  });
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
    el.inspirationGrid.appendChild(
      createDesignCard(
        design,
        grid,
        `Use ${design.name || "inspirational"} design`
      )
    );
  });
  fitNameplatePreviews(el.inspirationGrid);
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

function sameSavedDesign(left, right) {
  if (left.id && right.id) return left.id === right.id;
  return (
    left.savedAt === right.savedAt &&
    left.name === right.name &&
    JSON.stringify(left.g) === JSON.stringify(right.g)
  );
}

function deleteDesign(design) {
  const designs = loadSaved();
  const index = designs.findIndex((entry) => sameSavedDesign(entry, design));
  if (index < 0) return;
  designs.splice(index, 1);
  persistSaved(designs);
  renderSavedDesigns();
}

function renderSavedDesigns() {
  const designs = loadSaved().sort(
    (a, b) => (b.savedAt || 0) - (a.savedAt || 0)
  );
  el.savedDesignsGrid.innerHTML = "";
  for (const design of designs) {
    const grid = designGridString(design);
    if (!grid) continue;

    const item = document.createElement("div");
    item.className = "saved-design-item";
    item.appendChild(createDesignCard(design, grid, "Load saved design"));

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "saved-design-delete";
    deleteButton.setAttribute("aria-label", "Delete saved design");
    deleteButton.title = "Delete saved design";
    deleteButton.textContent = "×";
    deleteButton.addEventListener("click", () => {
      if (confirm("Delete this saved design?")) deleteDesign(design);
    });
    item.appendChild(deleteButton);
    el.savedDesignsGrid.appendChild(item);
  }
  const hasSavedDesigns = el.savedDesignsGrid.childElementCount > 0;
  el.savedDesignsSection.classList.toggle(
    "has-saved-designs",
    hasSavedDesigns
  );
  el.savedDesignsGrid.hidden = !hasSavedDesigns;
  fitNameplatePreviews(el.savedDesignsGrid);
}

function init() {
  loadSubtitle();
  loadLogoSvg(); // warm the SVG so exports are instant
  load();
  buildGrid();
  buildPalette();
  applyColors();
  fitPlate();
  repaintAll();
  updateCounts();
  setActive(state.active);
  el.columnNumbers.hidden = !state.showColumnNumbers;
  el.showColumnNumbers.checked = state.showColumnNumbers;

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
  el.showColumnNumbers.addEventListener("change", (event) => {
    state.showColumnNumbers = event.target.checked;
    el.columnNumbers.hidden = !state.showColumnNumbers;
    save();
  });
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
  el.zoomIn.addEventListener("click", () => setZoom(state.zoom + ZOOM_STEP));
  el.zoomOut.addEventListener("click", () => setZoom(state.zoom - ZOOM_STEP));
  setZoom(state.zoom, false); // initialize label + button disabled states

  renderSavedDesigns();
  loadInspiration();
  // Side menu (drawer)
  el.menuBtn.addEventListener("click", toggleMenu);
  el.drawerClose.addEventListener("click", closeMenu);
  el.drawerOverlay.addEventListener("click", closeMenu);
  // Write-a-word tool (main screen): apply live, debounced as the user types.
  let textDebounce = null;
  el.textInput.addEventListener("input", () => {
    state.textValue = el.textInput.value;
    save();
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
  el.textInput.value = state.textValue;
  el.saveDesignBtn.addEventListener("click", saveDesign);
  // Escape closes the drawer even while a menu input is focused (the color
  // shortcut handler ignores keys typed into inputs, so add a dedicated one).
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && el.drawer.classList.contains("open")) closeMenu();
  });

  document.addEventListener("keydown", onKeyDown);
  let mobileZoomMode = isMobileZoomMode();
  let mobileZoomOrientation = zoomOrientation();
  window.addEventListener("resize", () => {
    const nextMobileZoomMode = isMobileZoomMode();
    const nextZoomOrientation = zoomOrientation();
    if (!nextMobileZoomMode) {
      if (mobileZoomMode) setZoom(1, false);
    } else if (
      !mobileZoomMode ||
      nextZoomOrientation !== mobileZoomOrientation
    ) {
      setZoom(state.zooms[nextZoomOrientation], false);
    }
    scheduleLayoutFit();
    mobileZoomMode = nextMobileZoomMode;
    mobileZoomOrientation = nextZoomOrientation;
  });

  // Any click deactivates the arrow-navigation highlight.
  document.addEventListener("click", clearHighlight);
}

init();
