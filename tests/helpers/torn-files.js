/**
 * In-memory watch files that remember every operation, so a test can rebuild the disk as it
 * stood when the watch died at any character of any write.
 *
 * The platform documents no atomic rename and no fsync, so a write cut short is modelled in
 * the two ways a replaced file can end up: the new text cut short (truncate, then write), or
 * the new text written over the old one in place (old bytes left after the cut). An append cut
 * short keeps the old file plus a prefix of the new line. A removal either happened or not.
 */

export function createRecordingFiles() {
  const disk = new Map();
  const ops = [];
  const record = (kind, name, data = '') => {
    ops.push({ kind, name, data, before: disk.has(name) ? disk.get(name) : null });
  };
  return {
    disk,
    ops,
    read: (name) => (disk.has(name) ? disk.get(name) : null),
    write(name, data) {
      record('write', name, data);
      disk.set(name, data);
    },
    append(name, data) {
      record('append', name, data);
      disk.set(name, (disk.get(name) ?? '') + data);
    },
    remove(name) {
      record('remove', name);
      disk.delete(name);
    },
  };
}

/** Every way the watch can die during `op`: each cut, for both models of a replaced file. */
export function* tornVersions(op) {
  if (op.kind === 'remove') {
    yield op.before;
    return;
  }
  for (let cut = 0; cut <= op.data.length; cut++) {
    const prefix = op.data.slice(0, cut);
    if (op.kind === 'append') {
      yield (op.before ?? '') + prefix;
    } else {
      yield prefix;
      if (op.before && op.before.length > cut) yield prefix + op.before.slice(cut);
    }
  }
}

/** Files backed by `disk`, a copy of a recorded disk, for a fresh launch. */
export function filesOver(disk) {
  return {
    disk,
    read: (name) => (disk.has(name) ? disk.get(name) : null),
    write: (name, data) => { disk.set(name, data); },
    append: (name, data) => { disk.set(name, (disk.get(name) ?? '') + data); },
    remove: (name) => { disk.delete(name); },
  };
}

/** Rebuilds the disk after ops `[0, index)` and calls `visit` with each torn version of op `index`. */
export function forEachCrash(ops, index, visit) {
  const disk = new Map();
  for (const op of ops.slice(0, index)) {
    if (op.kind === 'remove') disk.delete(op.name);
    else if (op.kind === 'append') disk.set(op.name, (disk.get(op.name) ?? '') + op.data);
    else disk.set(op.name, op.data);
  }
  const op = ops[index];
  for (const content of tornVersions(op)) {
    const copy = new Map(disk);
    if (content === null) copy.delete(op.name);
    else copy.set(op.name, content);
    visit(copy);
  }
}

/**
 * Files that a test can arm to kill the watch app during one of the next writes, at a random
 * character: the torn bytes stay on disk and every later operation fails, as if the process
 * were gone, until `revive()` starts the next launch.
 */
export function createCrashableFiles(rnd) {
  const disk = new Map();
  let countdown = null;
  let dead = false;
  const tear = (name, data, kind) => {
    const before = disk.get(name) ?? '';
    const cut = rnd.int(data.length + 1);
    if (kind === 'append') disk.set(name, before + data.slice(0, cut));
    else disk.set(name, data.slice(0, cut) + (rnd.chance(0.5) ? before.slice(cut) : ''));
    dead = true;
    countdown = null;
    throw new Error('watch app killed mid-write');
  };
  const guard = (name, data, kind) => {
    if (dead) throw new Error('watch app is dead');
    if (countdown !== null && countdown-- === 0) tear(name, data, kind);
  };
  return {
    disk,
    get dead() { return dead; },
    arm(writesFromNow) { countdown = writesFromNow; },
    revive() { dead = false; countdown = null; },
    read(name) {
      if (dead) throw new Error('watch app is dead');
      return disk.has(name) ? disk.get(name) : null;
    },
    write(name, data) {
      guard(name, data, 'write');
      disk.set(name, data);
    },
    append(name, data) {
      guard(name, data, 'append');
      disk.set(name, (disk.get(name) ?? '') + data);
    },
    remove(name) {
      if (dead) throw new Error('watch app is dead');
      disk.delete(name);
    },
  };
}
