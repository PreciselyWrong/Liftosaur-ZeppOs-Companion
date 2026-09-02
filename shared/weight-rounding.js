/**
 * Loadable weight resolution.
 *
 * Liftoscript expresses warmups as percentages of the working weight
 * (`warmup: 1x8 40%`). Turning one into a number the user can actually load
 * needs the gym's equipment: the bar, the plates on hand, and how many of each.
 *
 * Behaviour was established against real `GET /history` records rather than
 * from the source description, which says "nearest". It is not nearest - it is
 * the largest achievable load **at or below** the target:
 *
 *   85% of 87.5kg = 74.375  -> 72.5, not 75   (barbell, 20kg bar)
 *   60% of 90kg   = 54      -> 52.5, not 55   (cable, 5kg bar)
 *
 * Both would round up under nearest-neighbour. See `tests/weight-rounding.test.js`,
 * which pins those cases.
 *
 * When the equipment is unknown the target is returned untouched and the caller
 * is told so, because showing an unloadable number is worse than showing none.
 */

/** `"52.5kg"` -> `{ value: 52.5, unit: 'kg' }`. Bare numbers take the fallback unit. */
export function parseWeightString(raw, fallbackUnit = 'kg') {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? { value: raw, unit: fallbackUnit } : null;
  }
  const match = String(raw).trim().match(/^(-?[0-9]*\.?[0-9]+)\s*(kg|lb|lbs)?$/i);
  if (!match) return null;
  const value = parseFloat(match[1]);
  if (!Number.isFinite(value)) return null;
  const unit = match[2] ? (match[2].toLowerCase() === 'lbs' ? 'lb' : match[2].toLowerCase()) : fallbackUnit;
  return { value, unit };
}

/** Floating point sums of 1.25 and 2.5 need a leash. */
function round5(value) {
  return Math.round(value * 100000) / 100000;
}

/**
 * Plate groups usable in this unit, one entry per pair when the multiplier is 2.
 * `num` is the total count on hand, so a barbell with `num: 2` can take one
 * plate per side, not two.
 */
function usablePlateGroups(equipment, unit) {
  const multiplier = equipment.multiplier || 1;
  const groups = [];

  for (const plate of equipment.plates || []) {
    const parsed = parseWeightString(plate.weight, unit);
    if (!parsed || parsed.unit !== unit || parsed.value <= 0) continue;

    const availableGroups = Math.floor((plate.num || 0) / multiplier);
    for (let i = 0; i < availableGroups; i++) {
      groups.push({ plateWeight: parsed.value, totalWeight: round5(parsed.value * multiplier) });
    }
  }

  return groups.sort((a, b) => b.totalWeight - a.totalWeight);
}

/**
 * Largest subset sum of `plates` that does not exceed `capacity`.
 *
 * Exhaustive over distinct values with their available counts, so it does not
 * miss a combination the way a plain greedy fill would.
 */
function bestFill(groups, capacity) {
  let best = { total: 0, plates: [] };
  const reachable = new Map([[0, []]]);

  function isPreferred(candidate, current) {
    if (!current) return true;
    if (candidate.length !== current.length) return candidate.length < current.length;
    for (let i = 0; i < candidate.length; i++) {
      if (candidate[i] !== current[i]) return candidate[i] > current[i];
    }
    return false;
  }

  for (const group of groups) {
    const additions = new Map();
    for (const [total, plates] of reachable) {
      const next = round5(total + group.totalWeight);
      if (next <= capacity + 1e-9) {
        const selected = [...plates, group.plateWeight];
        const existing = additions.get(next) || reachable.get(next);
        if (isPreferred(selected, existing)) additions.set(next, selected);
        if (next > best.total || (next === best.total && isPreferred(selected, best.plates))) {
          best = { total: next, plates: selected };
        }
      }
    }
    for (const [total, plates] of additions) reachable.set(total, plates);
  }

  return best;
}

/** Resolves both the achievable total and the exact physical loading. */
export function resolveLoadout(target, equipment, unit = 'kg') {
  if (!Number.isFinite(target) || target < 0 || !equipment) {
    return { value: target, exact: false, resolved: false };
  }

  if (equipment.isFixed) {
    const fixed = (equipment.fixed || [])
      .map((entry) => parseWeightString(entry, unit))
      .filter((parsed) => parsed && parsed.unit === unit)
      .map((parsed) => parsed.value)
      .sort((a, b) => a - b);

    if (fixed.length === 0) return { value: target, exact: false, resolved: false };

    let chosen = fixed[0];
    for (const weight of fixed) {
      if (weight <= target + 1e-9) chosen = weight;
    }
    return {
      value: round5(chosen),
      exact: Math.abs(chosen - target) < 1e-9,
      resolved: true,
      kind: 'fixed',
    };
  }

  const multiplier = equipment.multiplier || 1;
  const bar = parseWeightString(equipment.bar?.[unit], unit);
  const barWeight = bar ? bar.value : 0;

  if (target <= barWeight + 1e-9) {
    return {
      value: round5(barWeight),
      exact: Math.abs(barWeight - target) < 1e-9,
      resolved: true,
      kind: 'plates',
      barWeight: round5(barWeight),
      multiplier,
      plates: [],
    };
  }

  const fill = bestFill(usablePlateGroups(equipment, unit), target - barWeight);
  const total = round5(barWeight + fill.total);
  return {
    value: total,
    exact: Math.abs(total - target) < 1e-9,
    resolved: true,
    kind: 'plates',
    barWeight: round5(barWeight),
    multiplier,
    plates: fill.plates,
  };
}

function formatNumber(value) {
  return String(round5(value));
}

export function formatPlatesObject(platesObj, unit = 'kg') {
  if (!platesObj || typeof platesObj !== 'object') return null;
  const entries = Object.entries(platesObj).filter(([_, count]) => Number(count) > 0);
  if (entries.length === 0) return null;

  const parsed = entries.map(([plateStr, count]) => {
    const num = parseFloat(plateStr);
    return {
      weight: Number.isFinite(num) ? num : plateStr,
      count: Number(count),
    };
  });
  parsed.sort((a, b) => (typeof a.weight === 'number' && typeof b.weight === 'number' ? b.weight - a.weight : 0));

  const suffix = (unit || 'kg').toUpperCase();
  const plates = parsed
    .map((p) => `${p.count}×${Number.isFinite(p.weight) ? formatNumber(p.weight) : String(p.weight)}`)
    .join(' + ');
  return `PER SIDE · ${plates} ${suffix}`;
}

/** A compact watch label, returned only when the requested weight is exact. */
export function formatLoadoutLabel(target, equipment, unit = 'kg', plates = null, targetWeight = null) {
  if (equipment && typeof equipment === 'object') {
    if (Array.isArray(equipment.plates) || equipment.bar || equipment.isFixed) {
      const loadout = resolveLoadout(target, equipment, unit);
      if (loadout.resolved && loadout.exact) {
        const suffix = unit.toUpperCase();
        if (loadout.kind === 'fixed') return `USE ${formatNumber(loadout.value)} ${suffix}`;
        if (loadout.multiplier !== 1 && loadout.multiplier !== 2) return null;
        if (loadout.plates.length === 0) {
          return loadout.barWeight > 0 ? `EMPTY BAR · ${formatNumber(loadout.barWeight)} ${suffix}` : null;
        }

        const counts = new Map();
        for (const plate of loadout.plates) counts.set(plate, (counts.get(plate) || 0) + 1);
        const formattedPlates = [...counts.entries()]
          .sort(([a], [b]) => b - a)
          .map(([weight, count]) => `${count}×${formatNumber(weight)}`)
          .join(' + ');
        const prefix = loadout.multiplier === 2 ? 'PER SIDE' : 'LOAD';
        return `${prefix} · ${formattedPlates} ${suffix}`;
      }
    } else if (!plates && !Array.isArray(equipment.plates)) {
      plates = equipment;
    }
  }

  const directPlates = plates || (target && typeof target === 'object' ? target.plates : null);
  if (directPlates && typeof directPlates === 'object') {
    if (
      Number.isFinite(target) &&
      Number.isFinite(targetWeight) &&
      Math.abs(target - targetWeight) > 1e-9
    ) {
      return null;
    }
    return formatPlatesObject(directPlates, unit);
  }

  return null;
}

/**
 * @param {number} target        weight asked for, in `unit`
 * @param {object|null} equipment  one entry of `GET /gyms/:id/equipment`
 * @param {string} unit          'kg' or 'lb'
 * @returns {{value: number, exact: boolean, resolved: boolean}}
 *          `resolved: false` means the equipment could not answer, so `value`
 *          is the untouched target and the caller must not present it as loadable.
 */
export function roundToLoadable(target, equipment, unit = 'kg') {
  return resolveLoadout(target, equipment, unit);
}

/**
 * Floors a target onto a fixed increment, the per-exercise `rounding` setting.
 * Used only when the gym's equipment is unknown but the exercise still declares
 * a step it can be loaded in.
 */
export function roundToStep(target, step) {
  if (!Number.isFinite(target) || !Number.isFinite(step) || step <= 0) {
    return { value: target, exact: false, resolved: false };
  }
  const value = round5(Math.floor(round5(target / step) + 1e-9) * step);
  return { value, exact: Math.abs(value - target) < 1e-9, resolved: true };
}

/**
 * Resolves the equipment id an exercise uses.
 *
 * `GET /exercise-data` maps equipment per gym, so the current gym wins, then
 * the `default` entry. Failing both, the exercise key carries it as a suffix
 * (`latPulldown_cable`), and the Liftohistory line names it after the comma
 * (`Face Pull, Cable`).
 */
export function resolveEquipmentId({ exerciseData = null, exerciseKey = null, equipmentName = null, currentGymId = null } = {}) {
  const mapping = exerciseData?.equipment;
  if (mapping) {
    if (currentGymId && mapping[currentGymId]) return mapping[currentGymId];
    if (mapping.default) return mapping.default;

    // Neither the current gym nor a default is listed. When every gym maps this
    // exercise to the same equipment there is nothing to choose between, so the
    // single value is the answer rather than a guess.
    const values = Object.keys(mapping)
      .map((gymId) => mapping[gymId])
      .filter(Boolean);
    if (values.length > 0 && values.every((value) => value === values[0])) return values[0];
  }

  if (exerciseKey && exerciseKey.includes('_')) {
    return exerciseKey.slice(exerciseKey.indexOf('_') + 1);
  }

  if (equipmentName) {
    // "Cable" -> "cable", "Leverage Machine" -> "leverageMachine"
    const words = String(equipmentName).trim().split(/\s+/);
    return words
      .map((word, i) =>
        i === 0 ? word.toLowerCase() : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
      )
      .join('');
  }

  return null;
}
