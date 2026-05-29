import { DEFAULTS, hexToRgb, materialLegendRows } from './materials.js';
import { createBlankImageData, imageDataToCsv, runEggDropSimulation } from './simulation.js';

const canvas = document.querySelector('#simCanvas');
const designCanvas = document.querySelector('#designCanvas');
const ctx = canvas.getContext('2d');
const designCtx = designCanvas.getContext('2d');
const form = document.querySelector('#controls');
const fileInput = document.querySelector('#designFile');
const runButton = document.querySelector('#runButton');
const exportButton = document.querySelector('#exportButton');
const exampleButton = document.querySelector('#exampleButton');
const metrics = document.querySelector('#metrics');
const swatches = document.querySelector('#swatches');
const assumptions = document.querySelector('#assumptions');
const statusText = document.querySelector('#statusText');
const designerCanvas = document.querySelector('#designerCanvas');
const designerCtx = designerCanvas.getContext('2d', { willReadFrequently: true });
const designerMaterials = document.querySelector('#designerMaterials');
const designerHint = document.querySelector('#designerHint');
const designerOpenButton = document.querySelector('#designerOpenButton');
const designerOpenPreviewButton = document.querySelector('#designerOpenPreviewButton');
const designerApplyButton = document.querySelector('#designerApplyButton');
const designerClearButton = document.querySelector('#designerClearButton');
const boxFilledInput = document.querySelector('#boxFilled');
const boxThicknessInput = document.querySelector('#boxThickness');
const latticePatternInput = document.querySelector('#latticePattern');
const latticeSpacingInput = document.querySelector('#latticeSpacing');
const latticeThicknessInput = document.querySelector('#latticeThickness');
const selectedElementParameters = document.querySelector('#selectedElementParameters');
const selectedElementForm = document.querySelector('#selectedElementForm');
const modeTabs = document.querySelectorAll('.mode-tab');
const modeViews = document.querySelectorAll('.mode-view');

let currentImageData = createBlankImageData();
let currentResult = null;
let forceChart = null;
let animationHandle = 0;
let editorImageData = cloneImageData(currentImageData);
let selectedMaterial = materialLegendRows()[0];
let lineStart = null;
let dragStart = null;
let baseEditorImageData = new ImageData(DEFAULTS.imageWidth, DEFAULTS.imageHeight);
let designElements = [];
let selectedElementId = null;
let activeEdit = null;
let nextElementId = 1;

initialize();

function initialize() {
  populateDefaults();
  renderSwatches();
  initializeDesigner();
  drawDesignPreview(currentImageData);
  runSimulation();

  form.addEventListener('input', debounce(runSimulation, 150));
  runButton.addEventListener('click', runSimulation);
  exampleButton.addEventListener('click', () => {
    currentImageData = createBlankImageData();
    editorImageData = cloneImageData(currentImageData);
    baseEditorImageData = new ImageData(DEFAULTS.imageWidth, DEFAULTS.imageHeight);
    designElements = [];
    selectedElementId = null;
    drawDesignPreview(currentImageData);
    renderDesignerCanvas(editorImageData);
    statusText.textContent = 'Loaded generated foam lattice example.';
    runSimulation();
  });
  exportButton.addEventListener('click', exportCsv);
  fileInput.addEventListener('change', loadDesignFile);
  designerOpenButton.addEventListener('click', () => switchMode('design', { refreshEditor: true }));
  designerOpenPreviewButton.addEventListener('click', () => switchMode('design', { refreshEditor: true }));
  modeTabs.forEach((tab) => tab.addEventListener('click', () => switchMode(tab.dataset.mode)));
  designerApplyButton.addEventListener('click', applyDesigner);
  designerClearButton.addEventListener('click', clearDesigner);
  designerCanvas.addEventListener('pointerdown', handleDesignerPointerDown);
  designerCanvas.addEventListener('pointermove', handleDesignerPointerMove);
  designerCanvas.addEventListener('pointerup', handleDesignerPointerUp);
  designerCanvas.addEventListener('pointerleave', handleDesignerPointerLeave);
  document.querySelectorAll('input[name="designerTool"]').forEach((input) => {
    input.addEventListener('change', () => {
      lineStart = null;
      dragStart = null;
      updateToolSelection();
      updateDesignerHint();
      renderDesignerCanvas(editorImageData);
    });
  });
  [boxFilledInput, boxThicknessInput, latticePatternInput, latticeSpacingInput, latticeThicknessInput].forEach((input) => {
    input.addEventListener('input', () => {
      updateSelectedElementFromToolParameters();
      updateDesignerHint();
    });
    input.addEventListener('change', () => {
      updateSelectedElementFromToolParameters();
      updateDesignerHint();
    });
  });
}

function populateDefaults() {
  for (const [key, value] of Object.entries({
    dropHeightM: DEFAULTS.dropHeightM,
    gravity: DEFAULTS.gravity,
    eggMassKg: DEFAULTS.eggMassKg,
    payloadMassKg: DEFAULTS.payloadMassKg,
    breakThresholdG: DEFAULTS.breakThresholdG,
    pixelScaleM: DEFAULTS.pixelScaleM,
    nominalDensityKgM3: DEFAULTS.nominalDensityKgM3,
    impactPlaybackSpeed: DEFAULTS.impactPlaybackSpeed,
  })) {
    const input = form.elements.namedItem(key);
    if (input) input.value = value;
  }
}

function formOptions() {
  return Object.fromEntries(new FormData(form).entries().map(([key, value]) => [key, Number(value)]));
}

async function loadDesignFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const bitmap = await createImageBitmap(file);
  const offscreen = document.createElement('canvas');
  offscreen.width = DEFAULTS.imageWidth;
  offscreen.height = DEFAULTS.imageHeight;
  const offscreenCtx = offscreen.getContext('2d', { willReadFrequently: true });
  offscreenCtx.clearRect(0, 0, offscreen.width, offscreen.height);
  offscreenCtx.imageSmoothingEnabled = false;
  offscreenCtx.drawImage(bitmap, 0, 0, offscreen.width, offscreen.height);
  currentImageData = offscreenCtx.getImageData(0, 0, offscreen.width, offscreen.height);
  editorImageData = cloneImageData(currentImageData);
  baseEditorImageData = cloneImageData(editorImageData);
  designElements = [];
  selectedElementId = null;
  drawDesignPreview(currentImageData);
  renderDesignerCanvas(editorImageData);
  statusText.textContent = `Loaded ${file.name}; transparent pixels are ignored.`;
  runSimulation();
}

function runSimulation() {
  currentResult = runEggDropSimulation(currentImageData, formOptions());
  renderMetrics(currentResult);
  renderChart(currentResult);
  renderAssumptions(currentResult);
  animate(currentResult);
}

function renderMetrics(result) {
  const summary = result.summary;
  const statusClass = summary.status === 'Egg survives' ? 'good' : 'bad';
  metrics.innerHTML = `
    <article class="metric ${statusClass}"><span>Status</span><strong>${summary.status}</strong></article>
    <article class="metric"><span>Score</span><strong>${summary.score}/100</strong></article>
    <article class="metric"><span>Peak egg g</span><strong>${summary.peakEggG.toFixed(1)} g</strong></article>
    <article class="metric"><span>Peak assembly force</span><strong>${summary.peakAssemblyForceN.toFixed(0)} N</strong></article>
    <article class="metric"><span>Survival margin</span><strong>${summary.survivalMargin.toFixed(2)}×</strong></article>
    <article class="metric"><span>Protection mass</span><strong>${(summary.protectionMassKg * 1000).toFixed(1)} g</strong></article>
    <article class="metric"><span>Impact time</span><strong>${summary.impactTimeS.toFixed(3)} s</strong></article>
  `;
}

function renderChart(result) {
  const labels = result.records.map((record) => record.time.toFixed(3));
  const data = {
    labels,
    datasets: [
      {
        label: 'Assembly force (N)',
        data: result.records.map((record) => record.assemblyForceN),
        borderColor: '#2f80ed',
        backgroundColor: 'rgba(47,128,237,0.12)',
        tension: 0.2,
        pointRadius: 0,
      },
      {
        label: 'Egg force (N)',
        data: result.records.map((record) => record.eggForceN),
        borderColor: '#f2994a',
        backgroundColor: 'rgba(242,153,74,0.12)',
        tension: 0.2,
        pointRadius: 0,
      },
    ],
  };

  if (forceChart) {
    forceChart.data = data;
    forceChart.update('none');
    return;
  }

  if (!window.Chart) return;

  forceChart = new Chart(document.querySelector('#forceChart'), {
    type: 'line',
    data,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: { title: { display: true, text: 'time (s)' }, ticks: { maxTicksLimit: 8 } },
        y: { title: { display: true, text: 'force (N)' }, beginAtZero: true },
      },
    },
  });
}

function renderAssumptions(result) {
  const eq = result.design.equivalent;
  assumptions.innerHTML = `
    <li>64 × 256 input pixels define the initial geometry; alpha = 0 is ignored.</li>
    <li>Red maps to stiffness (${eq.stiffnessNPerM.toFixed(0)} N/m equivalent).</li>
    <li>Green maps to damping and crush stroke (${eq.dampingNsPerM.toFixed(0)} Ns/m, ${eq.strokeM.toFixed(3)} m stroke).</li>
    <li>Blue maps to shear failure strain and shear energy absorption (${eq.shearFailureStrain.toFixed(2)} strain, ${eq.shearEnergyJ.toFixed(2)} J reserve).</li>
    <li>The animation runs at 1× before impact, then uses the configured ${normalizedImpactPlaybackSpeed(result.options).toFixed(2)}× impact playback speed after floor contact.</li>
    <li>The current build is a one-axis floor impact model with a circular egg and rigid floor.</li>
  `;
}


function initializeDesigner() {
  const rows = materialLegendRows();
  selectedMaterial = rows[0];
  designerMaterials.innerHTML = rows.map((row, index) => `
    <button
      type="button"
      class="material-choice${index === 0 ? ' active' : ''}"
      data-hex="${row.hex}"
      style="--material-color:${row.hex}"
      aria-pressed="${index === 0 ? 'true' : 'false'}"
    >
      <span class="chip" style="background:${row.hex}"></span>
      <span>${row.name}</span>
    </button>
  `).join('');
  designerMaterials.addEventListener('click', (event) => {
    const button = event.target.closest('.material-choice');
    if (!button) return;
    selectedMaterial = rows.find((row) => row.hex === button.dataset.hex) ?? rows[0];
    designerMaterials.querySelectorAll('.material-choice').forEach((choice) => {
      const active = choice === button;
      choice.classList.toggle('active', active);
      choice.setAttribute('aria-pressed', String(active));
    });
  });
  updateDesignerHint();
}

function switchMode(mode, { refreshEditor = false } = {}) {
  modeTabs.forEach((tab) => {
    const active = tab.dataset.mode === mode;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-pressed', String(active));
  });
  modeViews.forEach((view) => {
    const active = view.dataset.mode === mode;
    view.classList.toggle('active', active);
    view.hidden = !active;
  });

  if (mode === 'design' && refreshEditor) {
    editorImageData = cloneImageData(currentImageData);
    baseEditorImageData = cloneImageData(editorImageData);
    designElements = [];
    selectedElementId = null;
    lineStart = null;
    dragStart = null;
    activeEdit = null;
    renderDesignerCanvas(editorImageData);
    updateDesignerHint();
  }

  if (mode === 'simulate') {
    runSimulation();
    forceChart?.resize();
  }
}

function applyDesigner() {
  currentImageData = cloneImageData(editorImageData);
  drawDesignPreview(currentImageData);
  statusText.textContent = 'Applied hand-drawn design. Switch to Simulate to test the current structure.';
  runSimulation();
}

function clearDesigner() {
  editorImageData = new ImageData(DEFAULTS.imageWidth, DEFAULTS.imageHeight);
  baseEditorImageData = cloneImageData(editorImageData);
  designElements = [];
  selectedElementId = null;
  lineStart = null;
  dragStart = null;
  activeEdit = null;
  renderDesignerCanvas(editorImageData);
  updateDesignerHint();
}

function handleDesignerPointerDown(event) {
  event.preventDefault();
  const point = canvasPoint(event, designerCanvas);
  const tool = selectedTool();
  const selectedElement = currentSelectedElement();
  const handle = selectedElement ? handleAtPoint(selectedElement, point) : null;

  if (handle) {
    activeEdit = { type: 'handle', elementId: selectedElement.id, handle };
    designerCanvas.setPointerCapture(event.pointerId);
    updateDesignerHint(`Drag the highlighted ${handle} handle to reshape the selected ${selectedElement.type}.`);
    return;
  }

  const hitElement = elementAtPoint(point);
  if (hitElement) {
    selectElement(hitElement.id);
    activeEdit = { type: 'move', elementId: hitElement.id, lastPoint: point };
    designerCanvas.setPointerCapture(event.pointerId);
    updateDesignerHint(`Selected ${hitElement.type}. Drag highlighted points or change its parameters.`);
    return;
  }

  selectedElementId = null;
  renderSelectedElementParameters();

  if (tool === 'line') {
    if (!lineStart) {
      lineStart = point;
      updateDesignerHint(`Line start set at ${point.x}, ${point.y}. Click another pixel to draw.`);
      renderDesignerCanvas(editorImageData, (ctxForOverlay) => drawHandle(ctxForOverlay, point));
      return;
    }
    addDesignElement({ type: 'line', start: lineStart, end: point, color: currentColor(), hex: selectedMaterial.hex, thickness: 1 });
    lineStart = null;
    updateDesignerHint();
    return;
  }

  dragStart = point;
  designerCanvas.setPointerCapture(event.pointerId);
  if (tool === 'erase') {
    eraseAt(editorImageData, point, 3);
    baseEditorImageData = cloneImageData(editorImageData);
    renderDesignerCanvas(editorImageData);
  }
}

function handleDesignerPointerMove(event) {
  const point = canvasPoint(event, designerCanvas);
  const tool = selectedTool();

  if (activeEdit) {
    editSelectedElement(point);
    return;
  }

  if (tool === 'line' && lineStart && !dragStart) {
    renderDesignerCanvas(editorImageData, (ctxForOverlay) => drawLineOverlay(ctxForOverlay, lineStart, point));
    updateDesignerHint(`Line preview: release/click at ${point.x}, ${point.y} to place the second point.`);
    return;
  }

  if (!dragStart) return;

  if (tool === 'erase') {
    eraseLine(editorImageData, dragStart, point, 3);
    dragStart = point;
    baseEditorImageData = cloneImageData(editorImageData);
    renderDesignerCanvas(editorImageData);
    return;
  }

  renderDesignerCanvas(editorImageData, (ctxForOverlay) => {
    ctxForOverlay.globalAlpha = 0.85;
    ctxForOverlay.fillStyle = currentHex();
    ctxForOverlay.strokeStyle = currentHex();
    ctxForOverlay.lineWidth = 1;
    const rect = normalizedRect(dragStart, point);
    if (tool === 'box') drawBoxOverlay(ctxForOverlay, rect);
    if (tool === 'lattice') drawLatticeOverlay(ctxForOverlay, rect);
    ctxForOverlay.globalAlpha = 1;
  });
}

function handleDesignerPointerUp(event) {
  const point = canvasPoint(event, designerCanvas);

  if (activeEdit) {
    editSelectedElement(point);
    activeEdit = null;
    designerCanvas.releasePointerCapture(event.pointerId);
    renderDesignerCanvas(editorImageData);
    updateDesignerHint();
    return;
  }

  if (!dragStart) return;
  const tool = selectedTool();

  if (tool === 'box') {
    addDesignElement({
      type: 'box',
      rect: normalizedRect(dragStart, point),
      color: currentColor(),
      hex: selectedMaterial.hex,
      filled: boxFilledInput.checked,
      thickness: numericInput(boxThicknessInput, 2),
    });
  } else if (tool === 'lattice') {
    addDesignElement({
      type: 'lattice',
      rect: normalizedRect(dragStart, point),
      color: currentColor(),
      hex: selectedMaterial.hex,
      options: latticeOptions(),
    });
  } else if (tool === 'erase') {
    eraseLine(editorImageData, dragStart, point, 3);
    baseEditorImageData = cloneImageData(editorImageData);
  }

  dragStart = null;
  designerCanvas.releasePointerCapture(event.pointerId);
  renderDesignerCanvas(editorImageData);
}

function handleDesignerPointerLeave(event) {
  if (activeEdit || !dragStart || selectedTool() === 'erase') return;
  designerCanvas.releasePointerCapture(event.pointerId);
  dragStart = null;
  renderDesignerCanvas(editorImageData);
}

function addDesignElement(element) {
  const newElement = { id: nextElementId++, ...element };
  designElements.push(newElement);
  selectElement(newElement.id);
  rebuildEditorImageData();
}

function selectElement(id) {
  selectedElementId = id;
  const element = currentSelectedElement();
  syncToolParametersFromElement(element);
  renderSelectedElementParameters();
  renderDesignerCanvas(editorImageData);
}

function currentSelectedElement() {
  return designElements.find((element) => element.id === selectedElementId) ?? null;
}

function rebuildEditorImageData() {
  editorImageData = cloneImageData(baseEditorImageData);
  for (const element of designElements) drawElement(editorImageData, element);
  renderSelectedElementParameters();
  renderDesignerCanvas(editorImageData);
}

function drawElement(imageData, element) {
  if (element.type === 'line') drawThickLine(imageData, element.start, element.end, element.color, element.thickness ?? 1);
  if (element.type === 'box') drawBox(imageData, element.rect, element.color, element.filled, element.thickness);
  if (element.type === 'lattice') drawLattice(imageData, element.rect, element.color, element.options);
}

function elementAtPoint(point) {
  for (const element of [...designElements].reverse()) {
    if (element.type === 'line' && distanceToSegment(point, element.start, element.end) <= Math.max(3, element.thickness ?? 1)) return element;
    if ((element.type === 'box' || element.type === 'lattice') && pointInRect(point, element.rect)) return element;
  }
  return null;
}

function handleAtPoint(element, point) {
  const handles = elementHandles(element);
  for (const [name, handlePoint] of Object.entries(handles)) {
    if (Math.abs(point.x - handlePoint.x) <= 2 && Math.abs(point.y - handlePoint.y) <= 2) return name;
  }
  return null;
}

function elementHandles(element) {
  if (element.type === 'line') return { start: element.start, end: element.end };
  const { x, y, width, height } = element.rect;
  return {
    nw: { x, y },
    ne: { x: x + width - 1, y },
    se: { x: x + width - 1, y: y + height - 1 },
    sw: { x, y: y + height - 1 },
  };
}

function editSelectedElement(point) {
  const element = currentSelectedElement();
  if (!element || !activeEdit) return;

  if (activeEdit.type === 'move') {
    const dx = point.x - activeEdit.lastPoint.x;
    const dy = point.y - activeEdit.lastPoint.y;
    moveElement(element, dx, dy);
    activeEdit.lastPoint = point;
  } else if (element.type === 'line') {
    element[activeEdit.handle] = point;
  } else {
    resizeRectElement(element, activeEdit.handle, point);
  }

  rebuildEditorImageData();
}

function moveElement(element, dx, dy) {
  if (!dx && !dy) return;
  if (element.type === 'line') {
    element.start = clampPoint({ x: element.start.x + dx, y: element.start.y + dy });
    element.end = clampPoint({ x: element.end.x + dx, y: element.end.y + dy });
    return;
  }
  element.rect = {
    ...element.rect,
    x: clamp(element.rect.x + dx, 0, DEFAULTS.imageWidth - element.rect.width),
    y: clamp(element.rect.y + dy, 0, DEFAULTS.imageHeight - element.rect.height),
  };
}

function resizeRectElement(element, handle, point) {
  const rect = element.rect;
  const left = handle.includes('w') ? point.x : rect.x;
  const right = handle.includes('e') ? point.x : rect.x + rect.width - 1;
  const top = handle.includes('n') ? point.y : rect.y;
  const bottom = handle.includes('s') ? point.y : rect.y + rect.height - 1;
  element.rect = normalizedRect({ x: left, y: top }, { x: right, y: bottom });
}

function renderSelectionOverlay(ctxForOverlay) {
  const element = currentSelectedElement();
  if (!element) return;
  ctxForOverlay.save();
  ctxForOverlay.strokeStyle = '#ffffff';
  ctxForOverlay.fillStyle = '#f2994a';
  ctxForOverlay.lineWidth = 1;
  if (element.type === 'line') {
    ctxForOverlay.beginPath();
    ctxForOverlay.moveTo(element.start.x + 0.5, element.start.y + 0.5);
    ctxForOverlay.lineTo(element.end.x + 0.5, element.end.y + 0.5);
    ctxForOverlay.stroke();
  } else {
    ctxForOverlay.strokeRect(element.rect.x + 0.5, element.rect.y + 0.5, element.rect.width - 1, element.rect.height - 1);
  }
  for (const point of Object.values(elementHandles(element))) drawHandle(ctxForOverlay, point);
  ctxForOverlay.restore();
}

function renderSelectedElementParameters() {
  const element = currentSelectedElement();
  selectedElementParameters.hidden = !element;
  if (!element) {
    selectedElementForm.innerHTML = '';
    return;
  }

  if (element.type === 'line') {
    selectedElementForm.innerHTML = `
      <div class="two-col">
        <label>Start X<input data-element-field="start.x" type="number" min="0" max="${DEFAULTS.imageWidth - 1}" value="${element.start.x}" /></label>
        <label>Start Y<input data-element-field="start.y" type="number" min="0" max="${DEFAULTS.imageHeight - 1}" value="${element.start.y}" /></label>
        <label>End X<input data-element-field="end.x" type="number" min="0" max="${DEFAULTS.imageWidth - 1}" value="${element.end.x}" /></label>
        <label>End Y<input data-element-field="end.y" type="number" min="0" max="${DEFAULTS.imageHeight - 1}" value="${element.end.y}" /></label>
      </div>
      <label>Line thickness (px)<input data-element-field="thickness" type="number" min="1" max="8" value="${element.thickness ?? 1}" /></label>
      <button type="button" class="secondary compact" data-delete-element>Delete element</button>
    `;
  } else if (element.type === 'box') {
    selectedElementForm.innerHTML = rectFields(element.rect) + `
      <label><input data-element-field="filled" type="checkbox" ${element.filled ? 'checked' : ''} /> Filled box</label>
      <label>Wall thickness (px)<input data-element-field="thickness" type="number" min="1" max="16" value="${element.thickness}" /></label>
      <button type="button" class="secondary compact" data-delete-element>Delete element</button>
    `;
  } else {
    selectedElementForm.innerHTML = rectFields(element.rect) + `
      <label>Pattern
        <select data-element-field="options.pattern">
          ${['cross', 'diagonal', 'square', 'triangle'].map((pattern) => `<option value="${pattern}" ${element.options.pattern === pattern ? 'selected' : ''}>${pattern}</option>`).join('')}
        </select>
      </label>
      <label>Cell size (px)<input data-element-field="options.spacing" type="number" min="3" max="32" value="${element.options.spacing}" /></label>
      <label>Strut thickness (px)<input data-element-field="options.thickness" type="number" min="1" max="8" value="${element.options.thickness}" /></label>
      <button type="button" class="secondary compact" data-delete-element>Delete element</button>
    `;
  }

  selectedElementForm.querySelectorAll('[data-element-field]').forEach((input) => {
    input.addEventListener('input', updateSelectedElementFromForm);
    input.addEventListener('change', updateSelectedElementFromForm);
  });
  selectedElementForm.querySelector('[data-delete-element]')?.addEventListener('click', () => {
    designElements = designElements.filter((item) => item.id !== selectedElementId);
    selectedElementId = null;
    rebuildEditorImageData();
  });
}

function rectFields(rect) {
  return `
    <div class="two-col">
      <label>X<input data-element-field="rect.x" type="number" min="0" max="${DEFAULTS.imageWidth - 1}" value="${rect.x}" /></label>
      <label>Y<input data-element-field="rect.y" type="number" min="0" max="${DEFAULTS.imageHeight - 1}" value="${rect.y}" /></label>
      <label>Width<input data-element-field="rect.width" type="number" min="1" max="${DEFAULTS.imageWidth}" value="${rect.width}" /></label>
      <label>Height<input data-element-field="rect.height" type="number" min="1" max="${DEFAULTS.imageHeight}" value="${rect.height}" /></label>
    </div>`;
}

function updateSelectedElementFromForm(event) {
  const element = currentSelectedElement();
  if (!element) return;
  setNestedValue(element, event.target.dataset.elementField, event.target.type === 'checkbox' ? event.target.checked : event.target.value);
  normalizeElement(element);
  rebuildEditorImageData();
}

function updateSelectedElementFromToolParameters() {
  const element = currentSelectedElement();
  if (!element) return;
  if (element.type === 'box' && selectedTool() === 'box') {
    element.filled = boxFilledInput.checked;
    element.thickness = numericInput(boxThicknessInput, 2);
  }
  if (element.type === 'lattice' && selectedTool() === 'lattice') element.options = latticeOptions();
  normalizeElement(element);
  rebuildEditorImageData();
}

function syncToolParametersFromElement(element) {
  if (!element) return;
  if (element.type === 'box') {
    boxFilledInput.checked = element.filled;
    boxThicknessInput.value = element.thickness;
  }
  if (element.type === 'lattice') {
    latticePatternInput.value = element.options.pattern;
    latticeSpacingInput.value = element.options.spacing;
    latticeThicknessInput.value = element.options.thickness;
  }
}

function setNestedValue(object, path, rawValue) {
  const parts = path.split('.');
  let target = object;
  while (parts.length > 1) target = target[parts.shift()];
  const key = parts[0];
  target[key] = typeof rawValue === 'boolean' ? rawValue : Number.isNaN(Number(rawValue)) ? rawValue : Number(rawValue);
}

function normalizeElement(element) {
  if (element.type === 'line') {
    element.start = clampPoint(element.start);
    element.end = clampPoint(element.end);
    element.thickness = clamp(Math.round(element.thickness ?? 1), 1, 8);
    return;
  }
  element.rect = {
    x: clamp(Math.round(element.rect.x), 0, DEFAULTS.imageWidth - 1),
    y: clamp(Math.round(element.rect.y), 0, DEFAULTS.imageHeight - 1),
    width: clamp(Math.round(element.rect.width), 1, DEFAULTS.imageWidth),
    height: clamp(Math.round(element.rect.height), 1, DEFAULTS.imageHeight),
  };
  element.rect.width = Math.min(element.rect.width, DEFAULTS.imageWidth - element.rect.x);
  element.rect.height = Math.min(element.rect.height, DEFAULTS.imageHeight - element.rect.y);
  if (element.type === 'box') element.thickness = clamp(Math.round(element.thickness ?? 2), 1, 16);
  if (element.type === 'lattice') element.options = { ...element.options, spacing: clamp(Math.round(element.options.spacing), 3, 32), thickness: clamp(Math.round(element.options.thickness), 1, 8) };
}

function updateToolSelection() {
  const tool = selectedTool();
  document.querySelectorAll('.tool-choice').forEach((choice) => choice.classList.toggle('active', choice.querySelector('input').value === tool));
  document.querySelectorAll('[data-tool-parameters]').forEach((panel) => { panel.hidden = panel.dataset.toolParameters !== tool; });
}

function pointInRect(point, rect) {
  return point.x >= rect.x && point.x < rect.x + rect.width && point.y >= rect.y && point.y < rect.y + rect.height;
}

function distanceToSegment(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared, 0, 1);
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

function clampPoint(point) {
  return { x: clamp(Math.round(point.x), 0, DEFAULTS.imageWidth - 1), y: clamp(Math.round(point.y), 0, DEFAULTS.imageHeight - 1) };
}

function updateDesignerHint(message = null) {
  updateToolSelection();
  if (message) {
    designerHint.textContent = message;
    return;
  }
  const hints = {
    line: 'Line tool: click once to set the start, then click again to draw.',
    box: 'Box tool: drag a rectangle; use Filled box for a solid box or uncheck it for hollow walls.',
    lattice: 'Lattice tool: drag a rectangle and it will be filled with the selected lattice pattern.',
    erase: 'Eraser: drag across pixels to make them transparent.',
  };
  designerHint.textContent = hints[selectedTool()];
}

function renderDesignerCanvas(imageData, overlay = null) {
  designerCanvas.width = imageData.width;
  designerCanvas.height = imageData.height;
  designerCtx.putImageData(cloneImageData(imageData), 0, 0);
  drawPixelGrid(designerCtx, imageData.width, imageData.height);
  renderSelectionOverlay(designerCtx);
  if (overlay) overlay(designerCtx);
}

function selectedTool() {
  return document.querySelector('input[name="designerTool"]:checked')?.value ?? 'line';
}

function currentHex() {
  return selectedTool() === 'erase' ? '#00000000' : selectedMaterial.hex;
}

function currentColor() {
  if (selectedTool() === 'erase') return [0, 0, 0, 0];
  const { r, g, b } = hexToRgb(selectedMaterial.hex);
  return [r, g, b, 255];
}

function latticeOptions() {
  return {
    pattern: latticePatternInput.value,
    spacing: numericInput(latticeSpacingInput, 10),
    thickness: numericInput(latticeThicknessInput, 1),
  };
}

function numericInput(input, fallback) {
  const value = Number(input.value);
  return Number.isFinite(value) ? value : fallback;
}

function canvasPoint(event, targetCanvas) {
  const rect = targetCanvas.getBoundingClientRect();
  return {
    x: clamp(Math.floor(((event.clientX - rect.left) / rect.width) * targetCanvas.width), 0, targetCanvas.width - 1),
    y: clamp(Math.floor(((event.clientY - rect.top) / rect.height) * targetCanvas.height), 0, targetCanvas.height - 1),
  };
}

function normalizedRect(a, b) {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x) + 1,
    height: Math.abs(a.y - b.y) + 1,
  };
}

function drawBox(imageData, rect, color, filled, thickness) {
  const wall = Math.max(1, Math.round(thickness));
  for (let y = rect.y; y < rect.y + rect.height; y += 1) {
    for (let x = rect.x; x < rect.x + rect.width; x += 1) {
      const onWall = x < rect.x + wall || x >= rect.x + rect.width - wall || y < rect.y + wall || y >= rect.y + rect.height - wall;
      if (filled || onWall) setPixel(imageData, x, y, color);
    }
  }
}

function drawLattice(imageData, rect, color, { pattern, spacing, thickness }) {
  const cell = Math.max(3, Math.round(spacing));
  const strut = Math.max(1, Math.round(thickness));
  if (pattern === 'square' || pattern === 'cross' || pattern === 'triangle') {
    for (let x = rect.x; x < rect.x + rect.width; x += cell) drawThickLine(imageData, { x, y: rect.y }, { x, y: rect.y + rect.height - 1 }, color, strut);
    for (let y = rect.y; y < rect.y + rect.height; y += cell) drawThickLine(imageData, { x: rect.x, y }, { x: rect.x + rect.width - 1, y }, color, strut);
  }
  if (pattern === 'diagonal' || pattern === 'cross' || pattern === 'triangle') {
    for (let x = rect.x - rect.height; x < rect.x + rect.width; x += cell) {
      drawClippedLine(imageData, rect, { x, y: rect.y }, { x: x + rect.height + rect.width, y: rect.y + rect.height + rect.width }, color, strut);
    }
  }
  if (pattern === 'cross' || pattern === 'triangle') {
    for (let x = rect.x; x < rect.x + rect.width + rect.height; x += cell) {
      drawClippedLine(imageData, rect, { x, y: rect.y }, { x: x - rect.height - rect.width, y: rect.y + rect.height + rect.width }, color, strut);
    }
  }
  if (pattern === 'triangle') {
    for (let y = rect.y; y < rect.y + rect.height; y += cell) {
      for (let x = rect.x; x < rect.x + rect.width; x += cell) {
        drawThickLine(imageData, { x, y }, { x: x + cell, y }, color, strut);
        drawThickLine(imageData, { x, y }, { x: x + Math.floor(cell / 2), y: y + cell }, color, strut);
        drawThickLine(imageData, { x: x + cell, y }, { x: x + Math.floor(cell / 2), y: y + cell }, color, strut);
      }
    }
  }
}

function drawLine(imageData, start, end, color) {
  drawThickLine(imageData, start, end, color, 1);
}

function drawThickLine(imageData, start, end, color, thickness) {
  const radius = Math.max(0, Math.floor((thickness - 1) / 2));
  traceLine(start, end, (x, y) => {
    for (let yy = y - radius; yy <= y + radius; yy += 1) {
      for (let xx = x - radius; xx <= x + radius; xx += 1) setPixel(imageData, xx, yy, color);
    }
  });
}

function drawClippedLine(imageData, rect, start, end, color, thickness) {
  const radius = Math.max(0, Math.floor((thickness - 1) / 2));
  traceLine(start, end, (x, y) => {
    if (x < rect.x || x >= rect.x + rect.width || y < rect.y || y >= rect.y + rect.height) return;
    for (let yy = y - radius; yy <= y + radius; yy += 1) {
      for (let xx = x - radius; xx <= x + radius; xx += 1) {
        if (xx >= rect.x && xx < rect.x + rect.width && yy >= rect.y && yy < rect.y + rect.height) setPixel(imageData, xx, yy, color);
      }
    }
  });
}

function eraseAt(imageData, point, radius) {
  for (let y = point.y - radius; y <= point.y + radius; y += 1) {
    for (let x = point.x - radius; x <= point.x + radius; x += 1) {
      if ((x - point.x) ** 2 + (y - point.y) ** 2 <= radius ** 2) setPixel(imageData, x, y, [0, 0, 0, 0]);
    }
  }
}

function eraseLine(imageData, start, end, radius) {
  traceLine(start, end, (x, y) => eraseAt(imageData, { x, y }, radius));
}

function traceLine(start, end, visit) {
  let x0 = start.x;
  let y0 = start.y;
  const x1 = end.x;
  const y1 = end.y;
  const dx = Math.abs(x1 - x0);
  const sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0);
  const sy = y0 < y1 ? 1 : -1;
  let error = dx + dy;

  while (true) {
    visit(x0, y0);
    if (x0 === x1 && y0 === y1) break;
    const doubleError = 2 * error;
    if (doubleError >= dy) {
      error += dy;
      x0 += sx;
    }
    if (doubleError <= dx) {
      error += dx;
      y0 += sy;
    }
  }
}

function setPixel(imageData, x, y, color) {
  if (x < 0 || y < 0 || x >= imageData.width || y >= imageData.height) return;
  const index = (y * imageData.width + x) * 4;
  imageData.data.set(color, index);
}

function drawPixelGrid(ctxForGrid, width, height) {
  ctxForGrid.save();
  ctxForGrid.strokeStyle = 'rgba(255,255,255,0.08)';
  ctxForGrid.lineWidth = 0.08;
  for (let x = 0; x <= width; x += 8) {
    ctxForGrid.beginPath();
    ctxForGrid.moveTo(x, 0);
    ctxForGrid.lineTo(x, height);
    ctxForGrid.stroke();
  }
  for (let y = 0; y <= height; y += 8) {
    ctxForGrid.beginPath();
    ctxForGrid.moveTo(0, y);
    ctxForGrid.lineTo(width, y);
    ctxForGrid.stroke();
  }
  ctxForGrid.restore();
}

function drawHandle(ctxForOverlay, point) {
  ctxForOverlay.save();
  ctxForOverlay.strokeStyle = '#ffffff';
  ctxForOverlay.lineWidth = 1;
  ctxForOverlay.strokeRect(point.x - 1, point.y - 1, 3, 3);
  ctxForOverlay.restore();
}

function drawLineOverlay(ctxForOverlay, start, end) {
  ctxForOverlay.save();
  ctxForOverlay.globalAlpha = 0.85;
  ctxForOverlay.strokeStyle = currentHex();
  ctxForOverlay.lineWidth = Math.max(1, Number(currentSelectedElement()?.thickness) || 1);
  ctxForOverlay.beginPath();
  ctxForOverlay.moveTo(start.x + 0.5, start.y + 0.5);
  ctxForOverlay.lineTo(end.x + 0.5, end.y + 0.5);
  ctxForOverlay.stroke();
  drawHandle(ctxForOverlay, start);
  drawHandle(ctxForOverlay, end);
  ctxForOverlay.restore();
}

function drawBoxOverlay(ctxForOverlay, rect) {
  if (boxFilledInput.checked) {
    ctxForOverlay.fillRect(rect.x, rect.y, rect.width, rect.height);
  } else {
    ctxForOverlay.lineWidth = Math.max(1, numericInput(boxThicknessInput, 2));
    ctxForOverlay.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.width - 1, rect.height - 1);
  }
}

function drawLatticeOverlay(ctxForOverlay, rect) {
  const temp = new ImageData(DEFAULTS.imageWidth, DEFAULTS.imageHeight);
  drawLattice(temp, rect, currentColor(), latticeOptions());
  const overlayCanvas = document.createElement('canvas');
  overlayCanvas.width = temp.width;
  overlayCanvas.height = temp.height;
  overlayCanvas.getContext('2d').putImageData(temp, 0, 0);
  ctxForOverlay.drawImage(overlayCanvas, 0, 0);
}

function cloneImageData(imageData) {
  return new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function renderSwatches() {
  swatches.innerHTML = materialLegendRows().map((row) => `
    <li>
      <span class="chip" style="background:${row.hex}"></span>
      <code>${row.hex}</code>
      <div><strong>${row.name}</strong><small>${row.note}</small></div>
    </li>
  `).join('');
}

function drawDesignPreview(imageData) {
  const preview = new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);
  designCanvas.width = imageData.width;
  designCanvas.height = imageData.height;
  designCtx.putImageData(preview, 0, 0);
}

function animate(result) {
  cancelAnimationFrame(animationHandle);
  const planckWorld = window.planck ? new window.planck.World({ gravity: window.planck.Vec2(0, -result.options.gravity) }) : null;
  const eggBody = planckWorld?.createBody({ type: 'dynamic', position: window.planck.Vec2(0, result.options.dropHeightM + 0.3) });
  eggBody?.createFixture(window.planck.Circle(0.08), { density: 1, friction: 0.3 });
  planckWorld?.createBody().createFixture(window.planck.Edge(window.planck.Vec2(-1, 0), window.planck.Vec2(1, 0)));

  const start = performance.now();
  const impactPlaybackSpeed = normalizedImpactPlaybackSpeed(result.options);
  const impactTimeS = Math.min(result.summary.impactTimeS, result.summary.finalTimeS);
  const postImpactTimeS = Math.max(0, result.summary.finalTimeS - impactTimeS);
  const playbackDurationS = Math.max(1, impactTimeS + (postImpactTimeS / impactPlaybackSpeed));
  const duration = playbackDurationS * 1000;
  const protectionHeightPx = 170;

  function frame(now) {
    const playbackTimeS = ((now - start) % duration) / 1000;
    const t = playbackTimeS <= impactTimeS
      ? playbackTimeS
      : impactTimeS + ((playbackTimeS - impactTimeS) * impactPlaybackSpeed);
    const record = nearestRecord(result.records, t);
    if (planckWorld) planckWorld.step(1 / 60);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawScene(record, result, protectionHeightPx);
    animationHandle = requestAnimationFrame(frame);
  }

  animationHandle = requestAnimationFrame(frame);
}

function drawScene(record, result, protectionHeightPx) {
  const w = canvas.width;
  const h = canvas.height;
  const floorY = h - 34;
  const pxPerM = 75;
  const x = w / 2;
  const y = floorY - record.positionM * pxPerM - 35;
  const compressionPx = record.compressionM * pxPerM;

  ctx.fillStyle = '#0d1220';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#29354f';
  ctx.lineWidth = 1;
  for (let gy = 20; gy < floorY; gy += 30) {
    ctx.beginPath();
    ctx.moveTo(0, gy);
    ctx.lineTo(w, gy);
    ctx.stroke();
  }

  ctx.fillStyle = '#5b647a';
  ctx.fillRect(0, floorY, w, 16);
  ctx.fillStyle = '#2f80ed';
  ctx.fillRect(x - 45, y + 20 + compressionPx, 90, protectionHeightPx - compressionPx);
  ctx.globalAlpha = 0.92;
  ctx.drawImage(designCanvas, x - 45, y + 20 + compressionPx, 90, protectionHeightPx - compressionPx);
  ctx.globalAlpha = 1;

  ctx.beginPath();
  ctx.arc(x, y, 20, 0, Math.PI * 2);
  ctx.fillStyle = '#fff2cc';
  ctx.fill();
  ctx.strokeStyle = record.eggG > result.options.breakThresholdG ? '#eb5757' : '#6fcf97';
  ctx.lineWidth = 4;
  ctx.stroke();

  ctx.fillStyle = '#ffffff';
  ctx.font = '14px system-ui, sans-serif';
  ctx.fillText(`t = ${record.time.toFixed(3)} s`, 16, 26);
  ctx.fillText(`egg = ${record.eggG.toFixed(1)} g`, 16, 48);
  ctx.fillText(`impact playback = ${normalizedImpactPlaybackSpeed(result.options).toFixed(2)}×`, 16, 70);
}

function normalizedImpactPlaybackSpeed(options) {
  const speed = Number(options.impactPlaybackSpeed);
  return clamp(Number.isFinite(speed) && speed > 0 ? speed : DEFAULTS.impactPlaybackSpeed, 0.05, 2);
}

function nearestRecord(records, time) {
  if (!records.length) return { time: 0, positionM: 0, compressionM: 0, eggG: 0 };
  const index = Math.min(records.length - 1, Math.max(0, Math.floor((time / records.at(-1).time) * records.length)));
  return records[index];
}

function exportCsv() {
  if (!currentResult) return;
  const blob = new Blob([imageDataToCsv(currentResult)], { type: 'text/csv' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'egg-drop-report.csv';
  link.click();
  URL.revokeObjectURL(link.href);
}

function debounce(fn, wait) {
  let timeout = 0;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), wait);
  };
}
