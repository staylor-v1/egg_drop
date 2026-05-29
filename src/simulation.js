import { DEFAULTS, summarizeDesignPixels } from './materials.js';

export function runEggDropSimulation(imageData, userOptions = {}) {
  const options = { ...DEFAULTS, ...userOptions };
  const design = summarizeDesignPixels(imageData, options);
  const protectionMassKg = options.protectionMassKg ?? design.protectionMassKg;
  const assemblyMassKg = options.eggMassKg + options.payloadMassKg + protectionMassKg;
  const equivalent = design.equivalent;
  const impactVelocity = Math.sqrt(2 * options.gravity * options.dropHeightM);

  const state = {
    time: 0,
    y: options.dropHeightM,
    v: -impactVelocity,
    compression: 0,
    eggCompression: 0,
    eggVelocity: -impactVelocity,
    absorbedShearJ: 0,
    failedColumns: 0,
  };

  const records = [];
  const dt = options.timeStep;
  const eggSpringNPerM = 9500;
  const eggDampingNsPerM = 26;
  const maxSteps = Math.ceil(options.maxTimeS / dt);
  const breakForceN = options.breakThresholdG * options.eggMassKg * options.gravity;
  let peakEggForceN = 0;
  let peakAssemblyForceN = 0;
  let timeAboveThresholdS = 0;
  let floorContact = false;
  let impactTimeS = null;

  for (let step = 0; step < maxSteps; step += 1) {
    const compression = Math.max(0, -state.y);
    if (impactTimeS === null && compression > 0) impactTimeS = state.time;
    floorContact = floorContact || compression > 0;
    const strokeRatio = equivalent.strokeM > 0 ? compression / equivalent.strokeM : 1;
    const shearRatio = equivalent.shearFailureStrain > 0 ? strokeRatio / equivalent.shearFailureStrain : Infinity;
    const failed = strokeRatio > equivalent.crushStrain || shearRatio > 1;
    const failureSoftening = failed ? 0.28 : 1;
    const assemblyForceN = compression > 0
      ? failureSoftening * Math.max(0, equivalent.stiffnessNPerM * compression + equivalent.dampingNsPerM * Math.max(0, -state.v))
      : 0;

    const eggRelativeCompression = Math.max(0, compression * 0.18 + Math.max(0, -state.eggVelocity - Math.max(0, -state.v)) * 0.0015);
    const eggForceN = Math.max(0, eggSpringNPerM * eggRelativeCompression + eggDampingNsPerM * Math.max(0, -state.eggVelocity));
    const cappedEggForceN = Math.min(eggForceN, assemblyForceN + options.eggMassKg * options.gravity);

    peakAssemblyForceN = Math.max(peakAssemblyForceN, assemblyForceN);
    peakEggForceN = Math.max(peakEggForceN, cappedEggForceN);
    if (cappedEggForceN > breakForceN) timeAboveThresholdS += dt;
    if (failed) state.absorbedShearJ += Math.min(equivalent.shearEnergyJ, assemblyForceN * Math.max(0, -state.v) * dt);

    records.push({
      time: state.time,
      positionM: Math.max(0, state.y),
      compressionM: compression,
      velocityMps: state.v,
      assemblyForceN,
      eggForceN: cappedEggForceN,
      eggG: cappedEggForceN / (options.eggMassKg * options.gravity),
      failed,
    });

    const acceleration = (assemblyForceN / Math.max(0.001, assemblyMassKg)) - options.gravity;
    state.v += acceleration * dt;
    state.y += state.v * dt;
    state.eggVelocity += ((cappedEggForceN / options.eggMassKg) - options.gravity) * dt;
    state.time += dt;

    if (floorContact && state.y > 0 && state.v >= 0) {
      break;
    }
    if (floorContact && Math.abs(state.v) < 0.03 && compression < 0.001) {
      break;
    }
  }

  const peakEggG = peakEggForceN / (options.eggMassKg * options.gravity);
  const survivalMargin = options.breakThresholdG / Math.max(0.001, peakEggG);
  const finalRecord = records.at(-1) ?? null;

  return {
    options,
    design,
    summary: {
      protectionMassKg,
      assemblyMassKg,
      impactVelocityMps: impactVelocity,
      peakAssemblyForceN,
      peakEggForceN,
      peakEggG,
      breakThresholdG: options.breakThresholdG,
      survivalMargin,
      score: scoreResult(survivalMargin, design.fillRatio, protectionMassKg, timeAboveThresholdS),
      status: peakEggG <= options.breakThresholdG ? 'Egg survives' : 'Egg breaks',
      timeAboveThresholdS,
      maxCompressionM: Math.max(...records.map((record) => record.compressionM), 0),
      impactTimeS: impactTimeS ?? finalRecord?.time ?? 0,
      finalTimeS: finalRecord?.time ?? 0,
    },
    records,
  };
}

export function createBlankImageData(width = DEFAULTS.imageWidth, height = DEFAULTS.imageHeight, rgba = [84, 227, 108, 255]) {
  const data = new Uint8ClampedArray(width * height * 4);
  const centerX = width / 2;
  const top = Math.floor(height * 0.12);
  const bottom = Math.floor(height * 0.92);
  const maxRadius = width * 0.36;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const normalizedY = (y - top) / Math.max(1, bottom - top);
      const waist = maxRadius * (0.65 + 0.35 * Math.sin(Math.PI * Math.max(0, Math.min(1, normalizedY))));
      const inCapsule = y >= top && y <= bottom && Math.abs(x - centerX) <= waist;
      const strut = y >= top && y <= bottom && (Math.abs(x - centerX) < 2 || (x + y) % 17 < 2 || (x - y + 200) % 19 < 2);
      if (inCapsule && strut) {
        data.set(rgba, i);
      } else {
        data[i + 3] = 0;
      }
    }
  }
  return { width, height, data };
}

export function imageDataToCsv(result) {
  const header = 'time_s,position_m,compression_m,velocity_mps,assembly_force_N,egg_force_N,egg_g,failed';
  const rows = result.records.map((record) => [
    record.time.toFixed(5),
    record.positionM.toFixed(5),
    record.compressionM.toFixed(5),
    record.velocityMps.toFixed(5),
    record.assemblyForceN.toFixed(3),
    record.eggForceN.toFixed(3),
    record.eggG.toFixed(3),
    record.failed ? '1' : '0',
  ].join(','));
  return [header, ...rows].join('\n');
}

function scoreResult(survivalMargin, fillRatio, protectionMassKg, timeAboveThresholdS) {
  const survivalScore = Math.min(70, 70 * Math.min(1.4, survivalMargin) / 1.4);
  const lightnessScore = Math.max(0, 20 - protectionMassKg * 180);
  const sparsityScore = Math.max(0, 10 - fillRatio * 18);
  const penalty = Math.min(35, timeAboveThresholdS * 900);
  return Math.max(0, Math.round(survivalScore + lightnessScore + sparsityScore - penalty));
}
