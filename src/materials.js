export const DEFAULTS = Object.freeze({
  imageWidth: 64,
  imageHeight: 256,
  eggMassKg: 0.057,
  payloadMassKg: 0.02,
  dropHeightM: 3,
  gravity: 9.80665,
  breakThresholdG: 50,
  pixelScaleM: 0.003,
  nominalDensityKgM3: 120,
  impactPlaybackSpeed: 0.25,
  timeStep: 1 / 240,
  maxTimeS: 3.5,
});

export const MATERIAL_SWATCHES = Object.freeze([
  {
    name: 'Balsa / light wood',
    hex: '#C89A35',
    note: 'moderate stiffness, modest damping, good shear fiber bridging',
  },
  {
    name: 'Toothpicks / skewers',
    hex: '#F0CF77',
    note: 'high axial stiffness, low damping, moderate shear toughness',
  },
  {
    name: 'Plastic straws',
    hex: '#5FC8FF',
    note: 'flexible shell response, strong crush stroke, medium shear resistance',
  },
  {
    name: 'Paper / card webbing',
    hex: '#D9D9A8',
    note: 'soft-to-medium stiffness and damping with low shear reserve',
  },
  {
    name: 'Foam / sponge padding',
    hex: '#54E36C',
    note: 'soft, high damping, high crush stroke, low shear strength',
  },
  {
    name: 'Rubber bands / elastomer',
    hex: '#3A3A80',
    note: 'low stiffness, very high damping, high shear strain capacity',
  },
]);

export function hexToRgb(hex) {
  const normalized = hex.replace('#', '').trim();
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    throw new Error(`Expected a 6 digit hex color, got ${hex}`);
  }
  const value = Number.parseInt(normalized, 16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

export function pixelToMaterial({ r, g, b, a = 255 }) {
  if (a === 0) {
    return null;
  }

  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;

  return {
    stiffnessNPerM: lerp(120, 16000, rn ** 1.35),
    dampingNsPerM: lerp(1.5, 260, gn ** 1.1),
    shearFailureStrain: lerp(0.04, 0.85, bn),
    crushStrain: lerp(0.12, 0.9, gn),
    shearEnergyJPerKg: lerp(8, 420, bn ** 1.2),
    massFactor: lerp(0.55, 1.3, (rn + gn + bn) / 3),
  };
}

export function summarizeDesignPixels(imageData, options = {}) {
  const width = imageData.width;
  const height = imageData.height;
  const data = imageData.data;
  const columnStats = Array.from({ length: width }, () => ({
    active: 0,
    stiffness: 0,
    damping: 0,
    shear: 0,
    crush: 0,
    shearEnergy: 0,
    massFactor: 0,
  }));
  let activePixels = 0;
  let totalMassFactor = 0;
  let minX = width;
  let maxX = -1;
  let minY = height;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const material = pixelToMaterial({
        r: data[i],
        g: data[i + 1],
        b: data[i + 2],
        a: data[i + 3],
      });
      if (!material) continue;

      const column = columnStats[x];
      column.active += 1;
      column.stiffness += material.stiffnessNPerM;
      column.damping += material.dampingNsPerM;
      column.shear += material.shearFailureStrain;
      column.crush += material.crushStrain;
      column.shearEnergy += material.shearEnergyJPerKg;
      column.massFactor += material.massFactor;
      activePixels += 1;
      totalMassFactor += material.massFactor;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }

  const activeColumns = columnStats.filter((column) => column.active > 0);
  const pixelAreaM2 = (options.pixelScaleM ?? DEFAULTS.pixelScaleM) ** 2;
  const density = options.nominalDensityKgM3 ?? DEFAULTS.nominalDensityKgM3;
  const thicknessM = options.outOfPlaneThicknessM ?? 0.025;
  const protectionMassKg = activePixels * pixelAreaM2 * thicknessM * density * (activePixels ? totalMassFactor / activePixels : 0);

  return {
    width,
    height,
    activePixels,
    fillRatio: activePixels / (width * height),
    activeColumns: activeColumns.length,
    boundingBox: activePixels ? { minX, maxX, minY, maxY } : null,
    protectionMassKg,
    equivalent: combineColumns(activeColumns, options.pixelScaleM ?? DEFAULTS.pixelScaleM),
    columns: columnStats.map((column) => averageColumn(column)),
  };
}

export function materialLegendRows() {
  return MATERIAL_SWATCHES.map((swatch) => {
    const rgb = hexToRgb(swatch.hex);
    return {
      ...swatch,
      material: pixelToMaterial({ ...rgb, a: 255 }),
    };
  });
}

function combineColumns(columns, pixelScaleM = DEFAULTS.pixelScaleM) {
  if (!columns.length) {
    return {
      stiffnessNPerM: 0,
      dampingNsPerM: 0,
      shearFailureStrain: 0,
      crushStrain: 0,
      shearEnergyJ: 0,
      strokeM: 0,
    };
  }

  let stiffness = 0;
  let damping = 0;
  let shear = 0;
  let crush = 0;
  let shearEnergy = 0;
  let heightPixels = 0;

  for (const column of columns) {
    const averaged = averageColumn(column);
    const columnHeight = column.active;
    stiffness += averaged.stiffnessNPerM / Math.max(1, columnHeight / 8);
    damping += averaged.dampingNsPerM / Math.max(1, columnHeight / 8);
    shear += averaged.shearFailureStrain;
    crush += averaged.crushStrain;
    shearEnergy += averaged.shearEnergyJPerKg * columnHeight * 0.00025;
    heightPixels += columnHeight;
  }

  const count = columns.length;
  const averageHeight = heightPixels / count;
  return {
    stiffnessNPerM: stiffness,
    dampingNsPerM: damping,
    shearFailureStrain: shear / count,
    crushStrain: crush / count,
    shearEnergyJ: shearEnergy,
    strokeM: Math.max(0.01, averageHeight * pixelScaleM * (crush / count)),
  };
}

function averageColumn(column) {
  if (!column.active) {
    return {
      active: 0,
      stiffnessNPerM: 0,
      dampingNsPerM: 0,
      shearFailureStrain: 0,
      crushStrain: 0,
      shearEnergyJPerKg: 0,
      massFactor: 0,
    };
  }

  return {
    active: column.active,
    stiffnessNPerM: column.stiffness / column.active,
    dampingNsPerM: column.damping / column.active,
    shearFailureStrain: column.shear / column.active,
    crushStrain: column.crush / column.active,
    shearEnergyJPerKg: column.shearEnergy / column.active,
    massFactor: column.massFactor / column.active,
  };
}

function lerp(min, max, t) {
  return min + (max - min) * Math.min(1, Math.max(0, t));
}
