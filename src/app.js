import { DEFAULTS, materialLegendRows } from './materials.js';
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

let currentImageData = createBlankImageData();
let currentResult = null;
let forceChart = null;
let animationHandle = 0;

initialize();

function initialize() {
  populateDefaults();
  renderSwatches();
  drawDesignPreview(currentImageData);
  runSimulation();

  form.addEventListener('input', debounce(runSimulation, 150));
  runButton.addEventListener('click', runSimulation);
  exampleButton.addEventListener('click', () => {
    currentImageData = createBlankImageData();
    drawDesignPreview(currentImageData);
    statusText.textContent = 'Loaded generated foam lattice example.';
    runSimulation();
  });
  exportButton.addEventListener('click', exportCsv);
  fileInput.addEventListener('change', loadDesignFile);
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
  drawDesignPreview(currentImageData);
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
