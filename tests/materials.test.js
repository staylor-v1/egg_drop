import test from 'node:test';
import assert from 'node:assert/strict';
import { hexToRgb, materialLegendRows, pixelToMaterial, summarizeDesignPixels } from '../src/materials.js';
import { createBlankImageData, imageDataToCsv, runEggDropSimulation } from '../src/simulation.js';

test('transparent pixels are ignored while opaque pixels contribute to geometry', () => {
  const data = new Uint8ClampedArray([
    255, 0, 0, 255,
    0, 255, 0, 0,
    0, 0, 255, 255,
    255, 255, 255, 0,
  ]);
  const summary = summarizeDesignPixels({ width: 2, height: 2, data });
  assert.equal(summary.activePixels, 2);
  assert.deepEqual(summary.boundingBox, { minX: 0, maxX: 0, minY: 0, maxY: 1 });
});

test('RGB channels map to independent material parameters', () => {
  const soft = pixelToMaterial({ r: 0, g: 0, b: 0, a: 255 });
  const stiff = pixelToMaterial({ r: 255, g: 0, b: 0, a: 255 });
  const damped = pixelToMaterial({ r: 0, g: 255, b: 0, a: 255 });
  const shearTough = pixelToMaterial({ r: 0, g: 0, b: 255, a: 255 });

  assert.equal(pixelToMaterial({ r: 255, g: 255, b: 255, a: 0 }), null);
  assert.ok(stiff.stiffnessNPerM > soft.stiffnessNPerM);
  assert.ok(damped.dampingNsPerM > soft.dampingNsPerM);
  assert.ok(shearTough.shearFailureStrain > soft.shearFailureStrain);
});

test('material legend publishes valid six digit hex codes', () => {
  const rows = materialLegendRows();
  assert.ok(rows.length >= 5);
  for (const row of rows) {
    const rgb = hexToRgb(row.hex);
    assert.equal(typeof rgb.r, 'number');
    assert.ok(row.material.stiffnessNPerM > 0);
  }
});

test('simulation produces score, force histories, and CSV export rows', () => {
  const imageData = createBlankImageData(64, 256);
  const result = runEggDropSimulation(imageData, { dropHeightM: 2, breakThresholdG: 50 });
  assert.ok(result.summary.score >= 0 && result.summary.score <= 100);
  assert.ok(result.records.length > 10);
  assert.ok(result.summary.peakAssemblyForceN >= result.summary.peakEggForceN || result.summary.peakAssemblyForceN > 0);
  const csv = imageDataToCsv(result);
  assert.match(csv, /^time_s,position_m,compression_m/m);
  assert.equal(csv.split('\n').length, result.records.length + 1);
});
