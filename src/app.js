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
    input.addEventListener('change', updateDesignerHint);
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
    lineStart = null;
    dragStart = null;
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
  lineStart = null;
  dragStart = null;
  renderDesignerCanvas(editorImageData);
  updateDesignerHint();
}

function handleDesignerPointerDown(event) {
  event.preventDefault();
  const point = canvasPoint(event, designerCanvas);
  const tool = selectedTool();

  if (tool === 'line') {
    if (!lineStart) {
      lineStart = point;
      updateDesignerHint(`Line start set at ${point.x}, ${point.y}. Click another pixel to draw.`);
      renderDesignerCanvas(editorImageData, (ctxForOverlay) => drawHandle(ctxForOverlay, point));
      return;
    }
    drawLine(editorImageData, lineStart, point, currentColor());
    lineStart = null;
    renderDesignerCanvas(editorImageData);
    updateDesignerHint();
    return;
  }

  dragStart = point;
  designerCanvas.setPointerCapture(event.pointerId);
  if (tool === 'erase') {
    eraseAt(editorImageData, point, 3);
    renderDesignerCanvas(editorImageData);
  }
}

function handleDesignerPointerMove(event) {
  if (!dragStart) return;
  const point = canvasPoint(event, designerCanvas);
  const tool = selectedTool();

  if (tool === 'erase') {
    eraseLine(editorImageData, dragStart, point, 3);
    dragStart = point;
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
  if (!dragStart) return;
  const point = canvasPoint(event, designerCanvas);
  const tool = selectedTool();

  if (tool === 'box') {
    drawBox(editorImageData, normalizedRect(dragStart, point), currentColor(), boxFilledInput.checked, numericInput(boxThicknessInput, 2));
  } else if (tool === 'lattice') {
    drawLattice(editorImageData, normalizedRect(dragStart, point), currentColor(), latticeOptions());
  } else if (tool === 'erase') {
    eraseLine(editorImageData, dragStart, point, 3);
  }

  dragStart = null;
  designerCanvas.releasePointerCapture(event.pointerId);
  renderDesignerCanvas(editorImageData);
}

function handleDesignerPointerLeave(event) {
  if (!dragStart || selectedTool() === 'erase') return;
  designerCanvas.releasePointerCapture(event.pointerId);
  dragStart = null;
  renderDesignerCanvas(editorImageData);
}

function updateDesignerHint(message = null) {
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
  const duration = Math.max(1, result.summary.finalTimeS) * 1000;
  const protectionHeightPx = 170;

  function frame(now) {
    const t = ((now - start) % duration) / 1000;
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
