import assert from 'node:assert/strict';
import {
  EARTH_RADIUS_KM,
  EQUATORIAL_SURFACE_FIELD_T,
  arcLengthPerLatitudeKm,
  equatorialFieldT,
  fieldLineRadiusKm,
  fieldMagnitudeT,
  fieldRatio,
  footLatitudeRad,
  ovalLatitudeDeg,
  traceFieldLine,
} from '../../src/lib/aurora/dipole.ts';
import {
  ATMOSPHERE_TOP_KM,
  bouncePeriodS,
  isInLossCone,
  lossConeAngleRad,
  magneticMoment,
  mirrorFieldT,
  mirrorLatitudeRad,
  parallelVelocityFraction,
  stepGuidingCentre,
  type GuidingCentreState,
} from '../../src/lib/aurora/mirroring.ts';
import {
  columnDensityAbove,
  massDensity,
  numberDensity,
  speciesFraction,
  totalNumberDensity,
} from '../../src/lib/aurora/atmosphere.ts';
import {
  AURORAL_LINES,
  columnBrightness,
  emissionProfile,
  getLine,
  quenchCrossoverAltitudeKm,
  quenchEfficiency,
  volumeEmissionRate,
} from '../../src/lib/aurora/emission.ts';
import {
  depositionProfile,
  electronRangeGCm2,
  peakDepositionAltitudeKm,
  stoppingAltitudeKm,
} from '../../src/lib/aurora/penetration.ts';
import {
  colourMatch,
  compositeColour,
  wavelengthToHex,
  wavelengthToRgb,
} from '../../src/lib/aurora/spectrum.ts';

const DEG = 180 / Math.PI;
const toDeg = (radians: number): number => radians * DEG;
const toRad = (degrees: number): number => degrees / DEG;

// --- Dipole geometry: the auroral oval falls out of the field line shape ---
{
  // r = L R_E cos^2(lat); at the equator the line is L Earth radii out.
  assert.equal(fieldLineRadiusKm(6, 0), 6 * EARTH_RADIUS_KM);

  // Setting r = R_E gives lat = arccos(1/sqrt(L)). Magnetotail shells at
  // L = 6-10 land on the observed auroral oval, 66-72 degrees.
  assert.ok(Math.abs(ovalLatitudeDeg(6) - 65.91) < 0.02);
  assert.ok(Math.abs(ovalLatitudeDeg(10) - 71.57) < 0.02);
  assert.ok(ovalLatitudeDeg(4) < ovalLatitudeDeg(6));
  assert.ok(ovalLatitudeDeg(6) < ovalLatitudeDeg(10));

  // A shell that never reaches the ground has no foot point.
  assert.ok(Number.isNaN(footLatitudeRad(0.5, 0)));

  // Field magnitude: B_eq = B0 / L^3, and the ratio is 1 at the equator.
  assert.equal(equatorialFieldT(1), EQUATORIAL_SURFACE_FIELD_T);
  assert.ok(
    Math.abs(equatorialFieldT(6) - EQUATORIAL_SURFACE_FIELD_T / 216) < 1e-12,
  );
  assert.ok(Math.abs(fieldRatio(0) - 1) < 1e-12);
  assert.ok(Math.abs(fieldMagnitudeT(6, 0) - equatorialFieldT(6)) < 1e-15);

  // B rises monotonically from the equator toward the pole.
  let previous = 0;
  for (let latDeg = 0; latDeg <= 70; latDeg += 5) {
    const value = fieldMagnitudeT(6, toRad(latDeg));
    assert.ok(value > previous, `B should rise by ${latDeg} degrees`);
    previous = value;
  }

  // Tracing spans both hemispheres and never dips below the requested floor.
  const line = traceFieldLine(6, { minAltitudeKm: 100, samples: 41 });
  assert.equal(line.length, 41);
  for (const point of line) {
    assert.ok(point.altitudeKm >= 100 - 1e-6);
  }
  assert.ok(line[0]!.latRad < 0 && line[line.length - 1]!.latRad > 0);
  // The equatorial crossing is the highest point on the line.
  const apex = line.reduce((a, b) => (a.altitudeKm > b.altitudeKm ? a : b));
  assert.ok(Math.abs(apex.latRad) < 0.05);

  // Northern-only traces start at the equator.
  const half = traceFieldLine(6, { northOnly: true, samples: 20 });
  assert.equal(half[0]!.latRad, 0);

  // Arc length per radian is largest at the equator and shrinks poleward.
  assert.ok(
    arcLengthPerLatitudeKm(6, 0) > arcLengthPerLatitudeKm(6, toRad(60)),
  );
}

// --- Mirroring and the loss cone ---
{
  // B_m = B_eq / sin^2(alpha). A 90-degree particle mirrors where it already
  // is, so its mirror latitude is the equator.
  assert.ok(
    Math.abs(mirrorFieldT(6, Math.PI / 2) - equatorialFieldT(6)) < 1e-15,
  );
  assert.ok(Math.abs(toDeg(mirrorLatitudeRad(Math.PI / 2))) < 1e-6);

  // Smaller equatorial pitch angle means mirroring further poleward.
  const pitches = [80, 60, 45, 30, 20, 10].map(toRad);
  let previous = -1;
  for (const pitch of pitches) {
    const latitude = mirrorLatitudeRad(pitch);
    assert.ok(latitude > previous, 'mirror point moves poleward');
    previous = latitude;
  }
  assert.ok(Math.abs(toDeg(mirrorLatitudeRad(toRad(30))) - 33.15) < 0.05);

  // The mirror latitude is where the parallel velocity vanishes.
  const pitch = toRad(30);
  const mirrorLat = mirrorLatitudeRad(pitch);
  assert.ok(parallelVelocityFraction(mirrorLat, pitch) < 1e-6);
  assert.ok(parallelVelocityFraction(0, pitch) > 0.86); // cos(30) = 0.866
  assert.ok(
    Math.abs(parallelVelocityFraction(0, pitch) - Math.cos(pitch)) < 1e-9,
  );

  // Loss cone: sin^2(alpha_lc) = B_eq / B_atm. Only a few degrees wide, and it
  // narrows as the shell moves out.
  assert.ok(Math.abs(toDeg(lossConeAngleRad(6)) - 2.92) < 0.05);
  assert.ok(Math.abs(toDeg(lossConeAngleRad(10)) - 1.34) < 0.05);
  assert.ok(lossConeAngleRad(4) > lossConeAngleRad(6));
  assert.ok(lossConeAngleRad(6) > lossConeAngleRad(10));

  assert.ok(isInLossCone(6, toRad(1)));
  assert.ok(!isInLossCone(6, toRad(20)));

  // Bounce period: faster particles bounce sooner, and the fit is in the tens
  // of seconds for a 10 keV electron (v ~ 5.9e7 m/s) at L = 6.
  const fast = bouncePeriodS(6, 5.9e7, toRad(45));
  const slow = bouncePeriodS(6, 2.9e7, toRad(45));
  assert.ok(slow > fast);
  assert.ok(fast > 1 && fast < 10, `bounce period was ${fast}`);
}

// --- Guiding-centre stepping conserves the first adiabatic invariant ---
{
  const electronMass = 9.109e-31;
  const pitch = toRad(45);
  const state: GuidingCentreState = {
    L: 6,
    latRad: 0,
    equatorialPitchRad: pitch,
    speedMs: 5.9e7,
    direction: 1,
    precipitated: false,
  };

  const initialMu = magneticMoment(6, 0, pitch, state.speedMs, electronMass);

  let current = state;
  let reversals = 0;
  let previousDirection = current.direction;
  let maxLat = 0;

  for (let step = 0; step < 4000; step += 1) {
    current = stepGuidingCentre(current, 0.002);
    if (current.direction !== previousDirection) {
      reversals += 1;
      previousDirection = current.direction;
    }
    maxLat = Math.max(maxLat, Math.abs(current.latRad));

    const mu = magneticMoment(
      6,
      current.latRad,
      pitch,
      current.speedMs,
      electronMass,
    );
    assert.ok(
      Math.abs(mu - initialMu) / initialMu < 1e-9,
      'mu must stay invariant along the bounce',
    );
  }

  // A 45-degree particle is trapped: it mirrors rather than precipitating, and
  // it turns around repeatedly.
  assert.equal(current.precipitated, false);
  assert.ok(reversals >= 2, `expected bounces, saw ${reversals} reversals`);

  // It never gets past its mirror latitude.
  const mirrorLat = mirrorLatitudeRad(pitch);
  assert.ok(maxLat <= mirrorLat + 1e-6);

  // A particle inside the loss cone reaches the atmosphere instead.
  let losing: GuidingCentreState = {
    L: 6,
    latRad: 0,
    equatorialPitchRad: toRad(1),
    speedMs: 5.9e7,
    direction: 1,
    precipitated: false,
  };
  for (let step = 0; step < 4000 && !losing.precipitated; step += 1) {
    losing = stepGuidingCentre(losing, 0.002);
  }
  assert.equal(losing.precipitated, true);
  const atmosphereLat = footLatitudeRad(6, ATMOSPHERE_TOP_KM);
  assert.ok(Math.abs(Math.abs(losing.latRad) - atmosphereLat) < 1e-9);

  // A precipitated particle is inert on further steps.
  assert.equal(stepGuidingCentre(losing, 0.002), losing);
}

// --- Atmosphere: everything thins with altitude, but not at the same rate ---
{
  let previousTotal = Number.POSITIVE_INFINITY;
  let previousColumn = Number.POSITIVE_INFINITY;

  for (let z = 90; z <= 500; z += 10) {
    const densities = numberDensity(z);
    assert.ok(densities.n2 > 0 && densities.o2 > 0 && densities.o > 0);

    const total = totalNumberDensity(z);
    assert.ok(total < previousTotal, `density must fall by ${z} km`);
    previousTotal = total;

    const column = columnDensityAbove(z);
    assert.ok(column < previousColumn, `column must fall by ${z} km`);
    previousColumn = column;
  }

  // The thermosphere becomes atomic-oxygen dominated: O/N2 rises throughout.
  const ratioAt = (z: number): number => {
    const densities = numberDensity(z);
    return densities.o / densities.n2;
  };
  assert.ok(ratioAt(100) < ratioAt(200));
  assert.ok(ratioAt(200) < ratioAt(400));

  // Below ~150 km the air is mostly N2; by 300 km atomic O dominates.
  assert.ok(speciesFraction(100, 'n2') > 0.7);
  assert.ok(speciesFraction(300, 'o') > 0.9);

  // Mass density is consistent with the number densities, and falls off too.
  assert.ok(massDensity(100) > massDensity(300));
  assert.ok(massDensity(300) > 0);

  // Extrapolation outside the table stays positive and monotonic.
  assert.ok(numberDensity(520).o > 0);
  assert.ok(numberDensity(520).o < numberDensity(500).o);
  assert.ok(numberDensity(70).n2 > numberDensity(80).n2);

  // Nothing is above the top of the integration range.
  assert.equal(columnDensityAbove(600), 0);
}

// --- Emission: lifetime sets the altitude at which a line survives ---
{
  const green = getLine('green');
  const red = getLine('red');
  const blue = getLine('blue');

  assert.equal(AURORAL_LINES.length, 3);
  assert.throws(() => getLine('violet' as never));

  // The wavelengths are the ones a spectrometer would actually read.
  assert.equal(green.wavelengthNm, 557.7);
  assert.equal(red.wavelengthNm, 630.0);
  assert.equal(blue.wavelengthNm, 427.8);

  // Ten orders of magnitude separate the radiative rates, which is the whole
  // reason the lines stratify.
  assert.ok(red.einsteinA < green.einsteinA);
  assert.ok(green.einsteinA < blue.einsteinA);

  // Quench crossovers. Red is destroyed below ~276 km, green survives to
  // ~111 km, and blue is effectively unquenchable anywhere in range.
  const redCrossover = quenchCrossoverAltitudeKm(red);
  const greenCrossover = quenchCrossoverAltitudeKm(green);
  const blueCrossover = quenchCrossoverAltitudeKm(blue);

  assert.ok(
    redCrossover > 230 && redCrossover < 330,
    `red crossover was ${redCrossover}`,
  );
  assert.ok(
    greenCrossover > 95 && greenCrossover < 140,
    `green crossover was ${greenCrossover}`,
  );
  assert.equal(blueCrossover, 80);
  assert.ok(greenCrossover < redCrossover);

  // Efficiency rises with altitude and is bounded to 0-1.
  for (const line of AURORAL_LINES) {
    for (const z of [100, 150, 200, 300, 400]) {
      const efficiency = quenchEfficiency(line, z);
      assert.ok(efficiency >= 0 && efficiency <= 1);
    }
    assert.ok(quenchEfficiency(line, 400) >= quenchEfficiency(line, 120));
  }

  // The headline fact: at 200 km red is mostly quenched while green is not.
  assert.ok(quenchEfficiency(red, 200) < 0.15);
  assert.ok(quenchEfficiency(green, 200) > 0.95);
  // And by 400 km red has recovered.
  assert.ok(quenchEfficiency(red, 400) > 0.9);
  // Blue never cares.
  assert.ok(quenchEfficiency(blue, 90) > 0.99);

  // No deposition means no light.
  assert.equal(volumeEmissionRate(green, 200, 0), 0);
}

// --- Penetration: harder electrons stop lower ---
{
  // Range grows with energy.
  assert.ok(electronRangeGCm2(10) > electronRangeGCm2(1));
  assert.ok(electronRangeGCm2(0) > 0);

  // Stopping altitude falls monotonically with energy, and hits the values
  // auroral physics quotes: ~1 keV near 200 km, ~10 keV near 105 km.
  let previous = Number.POSITIVE_INFINITY;
  for (const energy of [0.5, 1, 3, 10, 30, 100]) {
    const altitude = stoppingAltitudeKm(energy);
    assert.ok(altitude < previous, `must stop lower at ${energy} keV`);
    previous = altitude;
  }
  assert.ok(Math.abs(stoppingAltitudeKm(1) - 192) < 12);
  assert.ok(Math.abs(stoppingAltitudeKm(10) - 104) < 10);

  // The deposition peak tracks the stopping altitude.
  assert.ok(peakDepositionAltitudeKm(1) > peakDepositionAltitudeKm(10));

  // Profiles are peak-normalised, non-negative, and vanish at the top.
  const profile = depositionProfile(5, { samples: 64 });
  assert.equal(profile.length, 64);
  assert.ok(Math.abs(Math.max(...profile.map((s) => s.rate)) - 1) < 1e-9);
  for (const sample of profile) assert.ok(sample.rate >= 0);
  assert.ok(profile[profile.length - 1]!.rate < 0.1);
}

// --- Emission profile: the stratification the renderer draws ---
{
  // Shared normalisation is the default, because per-line normalisation would
  // destroy the ratios between the lines and wash out the layering.
  const profile = emissionProfile(1.5, { samples: 96 });
  const peakAltitude = (key: 'green' | 'red' | 'blue'): number =>
    profile.reduce((a, b) => (a[key] > b[key] ? a : b)).altitudeKm;

  // Blue lowest, green in the middle, red on top - the observed ordering.
  assert.ok(peakAltitude('blue') < peakAltitude('green'));
  assert.ok(peakAltitude('green') < peakAltitude('red'));

  // Under shared normalisation exactly one channel touches 1.
  const peak = Math.max(
    ...profile.flatMap((s) => [s.green, s.red, s.blue]),
  );
  assert.ok(Math.abs(peak - 1) < 1e-9);

  // Per-line normalisation instead pushes all three to 1.
  const perLine = emissionProfile(1.5, {
    samples: 96,
    normalisation: 'per-line',
  });
  for (const key of ['green', 'red', 'blue'] as const) {
    assert.ok(
      Math.abs(Math.max(...perLine.map((s) => s[key])) - 1) < 1e-9,
      `${key} should reach 1 under per-line normalisation`,
    );
  }

  // Raw rates are left alone.
  const raw = emissionProfile(1.5, { samples: 16, normalisation: 'none' });
  assert.ok(raw.every((s) => s.green >= 0 && s.red >= 0 && s.blue >= 0));

  // Soft precipitation is red-dominant; hard precipitation is blue-dominant.
  const soft = columnBrightness(0.3);
  const hard = columnBrightness(20);
  assert.ok(soft.red > soft.green, 'soft aurora should be red-dominant');
  assert.ok(hard.blue > hard.green, 'hard aurora should be blue-dominant');
  assert.ok(soft.red / soft.blue > hard.red / hard.blue);
}

// --- Spectrum: colour derived from the lines, not art-directed ---
{
  // The luminous efficiency function peaks near 555 nm, so y should be ~1 at
  // the green auroral line. This is the sharpest check on the CIE fit.
  const green = colourMatch(557.7);
  assert.ok(Math.abs(green.y - 1) < 0.02, `y(557.7) was ${green.y}`);

  // Each line renders as the colour its wavelength implies.
  const greenRgb = wavelengthToRgb(557.7);
  assert.ok(greenRgb.g > greenRgb.r && greenRgb.g > greenRgb.b);

  const redRgb = wavelengthToRgb(630.0);
  assert.ok(redRgb.r > redRgb.g && redRgb.r > redRgb.b);

  const blueRgb = wavelengthToRgb(427.8);
  assert.ok(blueRgb.b > blueRgb.g);
  assert.ok(blueRgb.b > 0.9);

  // Channels stay in range and the hex form is well shaped.
  for (const rgb of [greenRgb, redRgb, blueRgb]) {
    for (const channel of [rgb.r, rgb.g, rgb.b]) {
      assert.ok(channel >= 0 && channel <= 1);
    }
  }
  assert.match(wavelengthToHex(557.7), /^#[0-9a-f]{6}$/);

  // Compositing: a green-only mix reads green, a red-only mix reads red.
  const greenOnly = compositeColour({ green: 1 });
  assert.ok(greenOnly.g > greenOnly.r && greenOnly.g > greenOnly.b);

  const redOnly = compositeColour({ red: 1 });
  assert.ok(redOnly.r > redOnly.g && redOnly.r > redOnly.b);

  // Nothing in means black out.
  const dark = compositeColour({});
  assert.deepEqual(dark, { r: 0, g: 0, b: 0 });

  // Exposure scales brightness without inverting the hue ordering.
  const dim = compositeColour({ green: 1 }, 0.25);
  const bright = compositeColour({ green: 1 }, 1);
  assert.ok(dim.g < bright.g);
  assert.ok(dim.g > dim.r && dim.g > dim.b);

  // A violet-dominant mix must not blow out to white: peak normalisation is
  // what keeps this correct where luminance normalisation would not.
  const violet = compositeColour({ blue: 1, green: 0.02 }, 1);
  assert.ok(violet.b > violet.g, 'violet mixes must stay blue-dominant');
}

console.log('aurora: all tests passed');
