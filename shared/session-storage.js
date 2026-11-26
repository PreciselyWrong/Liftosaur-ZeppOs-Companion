/**
 * Durable session state in watch files.
 *
 * A session is only recoverable if the plan is stored with the journal: the journal alone is
 * a list of taps with no exercises to replay them against. The plan (about 19 KB) changes only
 * when a workout is loaded, started or adopted, while a tap changes about a hundred bytes:
 *
 * - `<prefix>-plan-a` / `-b`: a whole state with its plan, written when the plan changes;
 * - `<prefix>-a` / `-b`: a whole state without the plan, naming the plan copy it uses by
 *   sequence number and checksum, written when the log is folded;
 * - `<prefix>-log`: one appended line per other save, naming the state it extends and its index
 *   after it: how many journal events survive, the events after them, and the sync state or
 *   start time when they changed.
 *
 * The platform has no fsync and no documented atomic rename, and LocalStorage rewrites every key
 * on each save. So nothing is ever written over the newest restorable copy: a new one goes into
 * the other slot of its pair with a higher sequence number, and the newest valid copy wins.
 * Every stored text carries its length and FNV-1a checksum, and is ASCII so a byte cut is a
 * character cut. A copy or line whose length or checksum does not match is ignored, so a watch
 * dying at any byte of any write leaves either the state before that save or the one it was
 * writing. A clear first writes a newer copy that says the session is gone, so no older copy can
 * come back while the files are removed.
 *
 * Up to 0.5.15 the whole snapshot was one LocalStorage value. It is read when no file holds a
 * session, and removed only after the first file save was read back.
 */

const LEGACY_VERSION = 2;
const FORMAT = 3;
// A longer log is folded into a new state copy: every launch replays the log, and a fold costs
// about one journal.
const LOG_LIMIT = 6_000;
const HEADER = /^([A-Z])(\d{1,9}):([0-9a-f]{8}):/;

function checksum(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

const NON_ASCII = /[^\x00-\x7f]/g;
const ascii = (json) => json.replace(NON_ASCII, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);

function encode(tag, body, sum = checksum(body)) {
  return `${tag}${body.length}:${sum}:${body}`;
}

/** The checked body of a stored text, or null when it is torn, corrupted or another kind of text. */
function verified(text, tag) {
  if (typeof text !== 'string') return null;
  const header = HEADER.exec(text);
  if (!header || header[1] !== tag) return null;
  const body = text.slice(header[0].length);
  if (body.length !== Number(header[2]) || checksum(body) !== header[3]) return null;
  return { sum: header[3], body };
}

function parsed(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// Every copy starts this way, so its sequence number is read without parsing a 19 KB plan.
const COPY_START = new RegExp(`^\\{"v":${FORMAT},"seq":(\\d{1,15}),`);

const defaultSync = (plan) => ({ mode: plan?.source === 'WORKOUT_API' ? 'DIRECT' : 'LEGACY' });

/** In-memory watch files, for tests. */
export function createMemoryStorageAdapter() {
  const files = new Map();
  return {
    files,
    read: (name) => (files.has(name) ? files.get(name) : null),
    write: (name, data) => { files.set(name, data); },
    append: (name, data) => { files.set(name, (files.get(name) ?? '') + data); },
    remove: (name) => { files.delete(name); },
  };
}

function asciiBuffer(text) {
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index++) bytes[index] = text.charCodeAt(index);
  return bytes.buffer;
}

/**
 * Files in the app's `/data` directory through `@zos/fs`, injected so Node tests never load it.
 * The store only hands it ASCII, so a string length is a byte count.
 */
export function createWatchFileAdapter(fs, { onWrite = null } = {}) {
  const timed = (bytes, write) => {
    const startedAt = Date.now();
    write();
    if (typeof onWrite === 'function') onWrite(Date.now() - startedAt, bytes);
  };
  return {
    read(name) {
      const text = fs.readFileSync({ path: name, options: { encoding: 'utf8' } });
      return typeof text === 'string' ? text : null;
    },
    write(name, data) {
      timed(data.length, () => fs.writeFileSync({ path: name, data, options: { encoding: 'utf8' } }));
    },
    append(name, data) {
      timed(data.length, () => {
        const fd = fs.openSync({ path: name, flag: fs.O_WRONLY | fs.O_CREAT | fs.O_APPEND });
        if (!Number.isInteger(fd) || fd < 0) throw new Error(`open ${name} failed`);
        try {
          const written = fs.writeSync({ fd, buffer: asciiBuffer(data) });
          if (typeof written === 'number' && written !== data.length) throw new Error(`short write to ${name}`);
        } finally {
          fs.closeSync({ fd });
        }
      });
    },
    remove(name) {
      // rmSync reports a failure only by its result, which is not 0 for a missing file either.
      fs.rmSync({ path: name });
      if (fs.statSync({ path: name })) throw new Error(`remove ${name} failed`);
    },
  };
}

function parseLegacy(raw) {
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!parsed || (parsed.version !== 1 && parsed.version !== LEGACY_VERSION)) return null;
  if (!parsed.plan || !Array.isArray(parsed.journal)) return null;
  return {
    plan: parsed.plan,
    journal: parsed.journal,
    startedAt: parsed.startedAt ?? null,
    sync: parsed.version === 1 ? { mode: 'LEGACY' } : (parsed.sync || defaultSync(parsed.plan)),
  };
}

/**
 * `files`: `{read(name), write(name, text), append(name, text), remove(name)}`.
 * `legacy`: `{read(), remove()}`, the LocalStorage value older builds wrote.
 */
export function createSessionStore(files, { legacy = null, prefix = 'lifto-session' } = {}) {
  const names = {
    state: [`${prefix}-a.dat`, `${prefix}-b.dat`],
    plan: [`${prefix}-plan-a.dat`, `${prefix}-plan-b.dat`],
    log: `${prefix}-log.dat`,
  };
  // What the files hold, as this run last wrote or read them; null until it knows.
  let disk = null;
  // The newest session as JSON while the files could not store it.
  let memory = null;
  let legacyGone = !legacy;

  function readText(name) {
    try {
      return files.read(name);
    } catch {
      return null;
    }
  }

  function readCopies() {
    const copies = [];
    for (const kind of ['P', 'S']) {
      for (const slot of [0, 1]) {
        const copy = verified(readText((kind === 'P' ? names.plan : names.state)[slot]), kind);
        const seq = copy && COPY_START.exec(copy.body);
        if (seq) copies.push({ kind, slot, sum: copy.sum, seq: Number(seq[1]), body: copy.body });
      }
    }
    return copies.sort((a, b) => b.seq - a.seq);
  }

  // Only the copy that is restored, and its plan, are parsed.
  const valueOf = (copy) => {
    if (!('value' in copy)) copy.value = parsed(copy.body);
    return copy.value;
  };

  /** The newest restorable state in the files, and which slots must not be written over. */
  function readDisk() {
    const copies = readCopies();
    const log = readText(names.log);
    const lines = typeof log === 'string' ? log.split('\n') : [];
    const found = {
      copies: copies.map(({ kind, slot }) => ({ kind, slot })),
      logLength: typeof log === 'string' ? log.length : 0,
      maxSeq: copies.length ? copies[0].seq : 0,
      stateSeqs: [0, 1].map((slot) => copies.find((copy) => copy.kind === 'S' && copy.slot === slot)?.seq ?? -1),
      newest: null,
      planSlot: null,
      session: null,
    };
    for (const copy of copies) {
      const value = valueOf(copy);
      if (value?.cleared) {
        found.newest = copy;
        return found;
      }
      const plan = copy.kind === 'P'
        ? copy
        : copies.find((other) => other.kind === 'P' && other.seq === value?.p && other.sum === value?.ph);
      if (!plan || !valueOf(plan)?.plan || !Array.isArray(value.j)) continue;
      const events = value.j.map((event) => JSON.stringify(event));
      let { s: sync, t: startedAt } = value;
      let index = 0;
      for (const line of lines) {
        const checked = verified(line, 'R');
        const record = checked && parsed(checked.body);
        if (!record || record.b !== copy.seq || record.h !== copy.sum || record.i !== index) continue;
        if (!Number.isSafeInteger(record.k) || record.k < 0 || record.k > events.length || !Array.isArray(record.a)) continue;
        events.length = record.k;
        for (const event of record.a) events.push(JSON.stringify(event));
        if ('s' in record) sync = record.s;
        if ('t' in record) startedAt = record.t;
        index += 1;
      }
      Object.assign(found, {
        newest: copy,
        planSlot: plan.slot,
        session: {
          seq: copy.seq,
          sum: copy.sum,
          planSeq: plan.seq,
          planSum: plan.sum,
          plan: plan.value.plan,
          events,
          sync: JSON.stringify(sync ?? null),
          startedAt: JSON.stringify(startedAt ?? null),
          logIndex: index,
        },
      });
      return found;
    }
    return found;
  }

  /** A state slot holding neither the newest restorable state nor anything newer. */
  function freeStateSlot(found) {
    if (found.newest?.kind === 'S') return 1 - found.newest.slot;
    return found.stateSeqs[0] <= found.stateSeqs[1] ? 0 : 1;
  }

  const snapshotOf = (session) => ({
    plan: session.plan,
    journal: session.events.map((event) => JSON.parse(event)),
    startedAt: JSON.parse(session.startedAt),
    sync: JSON.parse(session.sync) || defaultSync(session.plan),
  });

  function readLegacy() {
    if (!legacy) return null;
    try {
      const raw = legacy.read();
      return raw ? parseLegacy(raw) : null;
    } catch (err) {
      console.log('[session-store] old snapshot unreadable:', err?.message || String(err));
      return null;
    }
  }

  function removeLegacy() {
    if (legacyGone) return;
    try {
      if (legacy.read() != null) legacy.remove();
      legacyGone = true;
    } catch (err) {
      console.log('[session-store] old snapshot not removed:', err?.message || String(err));
    }
  }

  /**
   * Stores the whole state in one write: with the plan in the free plan slot when the plan
   * changed, else in the free state slot with a reference to the plan copy.
   */
  function writeState(plan, events, sync, startedAt) {
    const known = disk.session && disk.session.plan === plan ? disk.session : null;
    const seq = disk.maxSeq + 1;
    const state = `"j":[${events.join(',')}],"s":${sync},"t":${startedAt}`;
    const stateSeqs = [...disk.stateSeqs];
    let planSlot = disk.planSlot;
    let newest;
    let planCopy;
    let body;
    let sum;
    if (known) {
      const slot = freeStateSlot(disk);
      body = ascii(`{"v":${FORMAT},"seq":${seq},"p":${known.planSeq},"ph":"${known.planSum}",${state}}`);
      sum = checksum(body);
      files.write(names.state[slot], encode('S', body, sum));
      stateSeqs[slot] = seq;
      newest = { kind: 'S', slot };
      planCopy = { planSeq: known.planSeq, planSum: known.planSum };
    } else {
      planSlot = disk.planSlot === null ? 0 : 1 - disk.planSlot;
      body = ascii(`{"v":${FORMAT},"seq":${seq},"plan":${JSON.stringify(plan)},${state}}`);
      sum = checksum(body);
      files.write(names.plan[planSlot], encode('P', body, sum));
      newest = { kind: 'P', slot: planSlot };
      planCopy = { planSeq: seq, planSum: sum };
    }
    // Lines name the copy they extend, so older lines may stay: a plan change, one write, empties
    // the log only when it is half full; a fold empties it.
    let logLength = disk.logLength;
    if (logLength > 0 && (known || logLength > LOG_LIMIT / 2)) {
      files.write(names.log, '');
      logLength = 0;
    }
    disk = {
      copies: [newest],
      logLength,
      maxSeq: seq,
      stateSeqs,
      newest,
      planSlot,
      session: { ...planCopy, seq, sum, plan, events, sync, startedAt, logIndex: 0 },
    };
    if (!legacyGone) {
      // The old value goes only once the files give back what was just written.
      const check = readDisk().session;
      if (!check || check.seq !== seq || check.events.join(',') !== events.join(',')) {
        throw new Error('stored session did not read back');
      }
      removeLegacy();
    }
  }

  function save({ plan, journal, startedAt = null, sync = null }) {
    if (!plan || !Array.isArray(journal)) return false;
    const events = journal.map((event) => JSON.stringify(event));
    const syncText = JSON.stringify(sync || defaultSync(plan));
    const startedText = JSON.stringify(startedAt);
    try {
      if (!disk) disk = readDisk();
      const current = memory === null && disk.session?.plan === plan ? disk.session : null;
      if (current) {
        let keep = 0;
        while (keep < current.events.length && keep < events.length && current.events[keep] === events[keep]) keep += 1;
        const syncChanged = syncText !== current.sync;
        const startChanged = startedText !== current.startedAt;
        if (keep === current.events.length && keep === events.length && !syncChanged && !startChanged) return true;
        const line = `\n${encode('R', ascii(
          `{"b":${current.seq},"h":"${current.sum}","i":${current.logIndex},"k":${keep},"a":[${events.slice(keep).join(',')}]`
          + `${syncChanged ? `,"s":${syncText}` : ''}${startChanged ? `,"t":${startedText}` : ''}}`
        ))}`;
        if (disk.logLength + line.length <= LOG_LIMIT) {
          files.append(names.log, line);
          disk.logLength += line.length;
          Object.assign(current, { events, sync: syncText, startedAt: startedText, logIndex: current.logIndex + 1 });
          return true;
        }
      }
      writeState(plan, events, syncText, startedText);
      memory = null;
      return true;
    } catch (err) {
      console.log('[session-store] write failed:', err?.message || String(err));
      // A write may have landed partly: the next save writes a whole state to a free slot.
      memory = JSON.stringify({ plan, journal, startedAt, sync: sync || defaultSync(plan) });
      return false;
    }
  }

  function load() {
    if (memory !== null) return JSON.parse(memory);
    const found = readDisk();
    // Keeps the plan this run wrote, so the next save still knows it is unchanged.
    if (!(disk?.session && found.session && disk.session.seq === found.session.seq
      && disk.session.logIndex === found.session.logIndex)) {
      disk = found;
    }
    if (found.session) return snapshotOf(disk.session);
    // A cleared or damaged session in the files is newer than any value older builds left.
    if (found.copies.length) return null;
    return readLegacy();
  }

  function remove(name) {
    try {
      files.remove(name);
      return true;
    } catch (err) {
      console.log('[session-store] file not removed:', err?.message || String(err));
      return false;
    }
  }

  function clear() {
    memory = null;
    disk = null;
    legacyGone = !legacy;
    const found = readDisk();
    // A newer copy saying the session is gone outranks every older one while files are removed.
    let tombstone = null;
    if (found.copies.length) {
      tombstone = freeStateSlot(found);
      try {
        files.write(names.state[tombstone], encode('S', `{"v":${FORMAT},"seq":${found.maxSeq + 1},"cleared":true}`));
      } catch (err) {
        console.log('[session-store] clear marker not written:', err?.message || String(err));
        tombstone = null;
      }
    }
    if (tombstone === null) {
      // Without the marker, oldest first, so a dead watch never finds an older state than before.
      removeLegacy();
      const newestLast = [...found.copies].reverse().map((copy) => (copy.kind === 'P' ? names.plan : names.state)[copy.slot]);
      for (const name of [...names.plan, ...names.state]) if (!newestLast.includes(name)) remove(name);
      for (const name of newestLast) remove(name);
      remove(names.log);
      return;
    }
    const removed = [names.state[1 - tombstone], ...names.plan, names.log].map(remove);
    removeLegacy();
    // A file left behind stays outranked by the marker, and the next session numbers above it.
    if (removed.every(Boolean) && legacyGone) remove(names.state[tombstone]);
  }

  return {
    /** Returns `{plan, journal, startedAt, sync}` or null when there is nothing to resume. */
    load,
    save,
    hasSession: () => load() !== null,
    clear,
  };
}
