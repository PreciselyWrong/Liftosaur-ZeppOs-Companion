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
 *   after it: how many journal events survive, the events after them, and the parts of the sync
 *   state or the start time that changed.
 *
 * The platform has no fsync and no documented atomic rename, and LocalStorage rewrites every key
 * on each save. So nothing is ever written over the newest restorable copy: a new one goes into
 * the other slot of its pair with a higher sequence number, and the newest valid copy wins.
 * Every stored text carries its length and FNV-1a checksum, and is ASCII so a byte cut is a
 * character cut. A copy or line whose length or checksum does not match is ignored, so a watch
 * dying at any byte of any write leaves either the state before that save or the one it was
 * writing. A clear first writes a newer copy that says the session is gone, so no older copy can
 * come back while the files are removed, and that marker goes last, once every other file reads
 * as missing.
 *
 * A file that exists but cannot be read may hold the newest state. Then load() throws an error
 * with code SESSION_UNREADABLE, and until a read shows no session this run has not handed out,
 * no file is written over or removed: saves stay in memory and report failure.
 *
 * Up to 0.5.15 the whole snapshot was one LocalStorage value. When the files also hold a session,
 * the value wins unless the files say they replaced it or extend its journal (a build that wrote
 * it after the files did can only be 0.5.15 after a downgrade). It is removed only when it is the
 * value this run read, once a file save holding its journal was read back.
 */

export const SESSION_UNREADABLE = 'SESSION_UNREADABLE';

const LEGACY_VERSION = 2;
const FORMAT = 3;
// The log is folded into a new state copy once it outgrows the journal of the copy it extends,
// so a fold, about one journal, comes ever less often and every save costs the same over a long
// workout. A launch replays at most about one journal of lines.
const LOG_MIN = 6_000;
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

/** The sync state as one JSON text per top-level field, so a save stores only the fields that changed. */
function syncParts(sync) {
  const parts = {};
  if (sync && typeof sync === 'object' && !Array.isArray(sync)) {
    for (const key of Object.keys(sync)) {
      if (sync[key] !== undefined) parts[key] = JSON.stringify(sync[key]);
    }
  }
  return parts;
}

const syncText = (parts) => `{${Object.keys(parts).map((key) => `${JSON.stringify(key)}:${parts[key]}`).join(',')}}`;

/** The line fields that turn `parts` into `next`, or '' when nothing changed: `u` sets fields, `r` removes them. */
function syncChange(parts, next) {
  const update = Object.keys(next).filter((key) => parts[key] !== next[key]).map((key) => `${JSON.stringify(key)}:${next[key]}`);
  const removed = Object.keys(parts).filter((key) => !(key in next)).map((key) => JSON.stringify(key));
  return `${update.length ? `,"u":{${update.join(',')}}` : ''}${removed.length ? `,"r":[${removed.join(',')}]` : ''}`;
}

function applySyncChange(parts, record) {
  // Lines written before fields were stored apart carried the whole sync state.
  if ('s' in record) return syncParts(record.s);
  const next = { ...parts, ...syncParts(record.u) };
  if (Array.isArray(record.r)) for (const key of record.r) delete next[key];
  return next;
}

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
 *
 * `read` returns null only for a missing file and throws for one that exists but did not read.
 * The API promises no result from writeFileSync, writeSync or closeSync, so every write is checked
 * by the file size afterwards (one stat per append), and a mismatch is a failed write.
 */
export function createWatchFileAdapter(fs, { onWrite = null } = {}) {
  // File sizes this run read or checked, so an append needs one stat.
  const sizes = new Map();
  const sizeOf = (name) => {
    const stat = fs.statSync({ path: name });
    return stat ? stat.size : null;
  };
  const readRaw = (name) => {
    try {
      return fs.readFileSync({ path: name, options: { encoding: 'utf8' } });
    } catch (err) {
      return err;
    }
  };
  const timed = (bytes, write) => {
    const startedAt = Date.now();
    write();
    if (typeof onWrite === 'function') onWrite(Date.now() - startedAt, bytes);
  };
  return {
    read(name) {
      // Read first: a stat that wrongly says a file is gone must not hide its content.
      const text = readRaw(name);
      if (typeof text === 'string') {
        sizes.set(name, text.length);
        return text;
      }
      // undefined means missing or "failed to be read"; only stat tells which.
      const size = sizeOf(name);
      sizes.set(name, size ?? 0);
      if (size === null) return null;
      if (size === 0) return '';
      throw new Error(`${name} not read: ${message(text)}`);
    },
    write(name, data) {
      timed(data.length, () => {
        sizes.delete(name);
        const before = sizeOf(name);
        fs.writeFileSync({ path: name, data, options: { encoding: 'utf8' } });
        // A file of the same size before could be untouched: only its content tells.
        if (sizeOf(name) !== data.length || (before === data.length && data.length > 0 && readRaw(name) !== data)) {
          throw new Error(`write to ${name} did not land`);
        }
        sizes.set(name, data.length);
      });
    },
    append(name, data) {
      timed(data.length, () => {
        const start = sizes.has(name) ? sizes.get(name) : (sizeOf(name) ?? 0);
        sizes.delete(name);
        const fd = fs.openSync({ path: name, flag: fs.O_WRONLY | fs.O_CREAT | fs.O_APPEND });
        if (!Number.isInteger(fd) || fd < 0) throw new Error(`open ${name} failed`);
        try {
          // The position lands the line at the end even where O_APPEND is not honoured.
          fs.writeSync({ fd, buffer: asciiBuffer(data), options: { position: start } });
        } finally {
          fs.closeSync({ fd });
        }
        if (sizeOf(name) !== start + data.length) throw new Error(`append to ${name} did not land`);
        sizes.set(name, start + data.length);
      });
    },
    remove(name) {
      sizes.delete(name);
      // rmSync reports a failure only by its result, which is not 0 for a missing file either.
      fs.rmSync({ path: name });
      if (fs.statSync({ path: name })) throw new Error(`remove ${name} failed`);
      sizes.set(name, 0);
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

const isPrefix = (short, long) => short.length <= long.length && short.every((event, index) => event === long[index]);

const message = (err) => err?.message || String(err);
const note = (...parts) => console.log('[session-store]', ...parts);
const rawSum = (raw) => checksum(typeof raw === 'string' ? raw : JSON.stringify(raw));

/**
 * `files`: `{read(name), write(name, text), append(name, text), remove(name)}`; `read` returns
 * null for a missing file, and throws or returns a non-string for one that exists but did not read.
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
  // Set when a session file did not read: until a read shows no session this run has not handed
  // out, nothing is written over or removed.
  let blocked = false;
  // The 0.5.15 value this run read: `{sum, events}`, the only one it may remove.
  let legacySeen = null;
  // The highest sequence number this run wrote, so no copy is written twice under one number.
  let lastSeq = 0;

  function readText(name, unreadable) {
    let text;
    try {
      text = files.read(name);
    } catch (err) {
      unreadable.push(`${name} (${message(err)})`);
      return null;
    }
    if (text === null || typeof text === 'string') return text;
    unreadable.push(name);
    return null;
  }

  function readCopies(unreadable) {
    const copies = [];
    for (const kind of ['P', 'S']) {
      for (const slot of [0, 1]) {
        const copy = verified(readText((kind === 'P' ? names.plan : names.state)[slot], unreadable), kind);
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
    const unreadable = [];
    const copies = readCopies(unreadable);
    const log = readText(names.log, unreadable);
    const found = {
      unreadable,
      copies: copies.map(({ kind, slot }) => ({ kind, slot })),
      logLength: typeof log === 'string' ? log.length : 0,
      maxSeq: copies.length ? copies[0].seq : 0,
      stateSeqs: [0, 1].map((slot) => copies.find((copy) => copy.kind === 'S' && copy.slot === slot)?.seq ?? -1),
      newest: null,
      cleared: null,
      planSlot: null,
      session: null,
    };
    if (unreadable.length) return found;
    const lines = typeof log === 'string' ? log.split('\n') : [];
    for (const copy of copies) {
      const value = valueOf(copy);
      if (value?.cleared) {
        found.newest = copy;
        found.cleared = value;
        return found;
      }
      const plan = copy.kind === 'P'
        ? copy
        : copies.find((other) => other.kind === 'P' && other.seq === value?.p && other.sum === value?.ph);
      if (!plan || !valueOf(plan)?.plan || !Array.isArray(value.j)) continue;
      const events = value.j.map((event) => JSON.stringify(event));
      const baseSize = events.join(',').length;
      let sync = syncParts(value.s);
      let { t: startedAt } = value;
      let index = 0;
      for (const line of lines) {
        const checked = verified(line, 'R');
        const record = checked && parsed(checked.body);
        if (!record || record.b !== copy.seq || record.h !== copy.sum || record.i !== index) continue;
        if (!Number.isSafeInteger(record.k) || record.k < 0 || record.k > events.length || !Array.isArray(record.a)) continue;
        events.length = record.k;
        for (const event of record.a) events.push(JSON.stringify(event));
        sync = applySyncChange(sync, record);
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
          // The journal objects last saved, so an unchanged event is found without serialising it.
          refs: [],
          sync,
          startedAt: JSON.stringify(startedAt ?? null),
          logIndex: index,
          baseSize,
          legacySum: value.l,
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
    sync: Object.keys(session.sync).length ? JSON.parse(syncText(session.sync)) : defaultSync(session.plan),
  });

  /** The old value with its checksum, or null when there is none or it is not a session. */
  function readLegacy() {
    if (!legacy) return null;
    try {
      const raw = legacy.read();
      if (!raw) return null;
      const snapshot = parseLegacy(raw);
      if (!snapshot) return null;
      const events = snapshot.journal.map((event) => JSON.stringify(event));
      return { snapshot, sum: rawSum(raw), events };
    } catch (err) {
      note('old snapshot unreadable:', message(err));
      return null;
    }
  }

  /** Removes the old value when it is still the one this run read. */
  function removeLegacy() {
    if (!legacySeen) return;
    try {
      const raw = legacy.read();
      if (raw == null) {
        legacySeen = null;
        return;
      }
      if (rawSum(raw) !== legacySeen.sum) {
        note('old snapshot changed since it was read, kept');
        legacySeen = null;
        return;
      }
      legacy.remove();
      legacySeen = null;
    } catch (err) {
      note('old snapshot not removed:', message(err));
    }
  }

  /**
   * Reads the files when this run does not know them. False while they hold what must not be
   * written over: a file that did not read, or, after one did not, a session not handed out.
   */
  function writable() {
    if (disk && !blocked) return true;
    disk = readDisk();
    if (disk.unreadable.length) {
      note('read failed:', disk.unreadable.join(', '));
      blocked = true;
      disk = null;
      return false;
    }
    if (blocked && disk.session) {
      note('unread session kept');
      disk = null;
      return false;
    }
    blocked = false;
    return true;
  }

  /**
   * Stores the whole state in one write: with the plan in the free plan slot when the plan
   * changed, else in the free state slot with a reference to the plan copy.
   */
  function writeState(plan, events, refs, sync, startedAt) {
    const known = disk.session && disk.session.plan === plan ? disk.session : null;
    const seq = Math.max(disk.maxSeq, lastSeq) + 1;
    lastSeq = seq;
    const journalText = events.join(',');
    const state = `"j":[${journalText}],"s":${syncText(sync)},"t":${startedAt}`
      + `${legacySeen ? `,"l":"${legacySeen.sum}"` : ''}`;
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
    if (logLength > 0 && (known || logLength > LOG_MIN / 2)) {
      files.write(names.log, '');
      logLength = 0;
    }
    disk = {
      unreadable: [],
      copies: [newest],
      logLength,
      maxSeq: seq,
      stateSeqs,
      newest,
      cleared: null,
      planSlot,
      session: {
        ...planCopy, seq, sum, plan, events, refs, sync, startedAt, logIndex: 0, baseSize: journalText.length, legacySum: null,
      },
    };
    if (legacySeen) {
      // The old value goes only once the files give back what was just written, and it with it.
      const check = readDisk().session;
      if (!check || check.seq !== seq || check.events.join(',') !== journalText) {
        throw new Error('stored session did not read back');
      }
      if (legacySeen) legacySeen.replaced = true;
      removeLegacy();
    }
  }

  function save({ plan, journal, startedAt = null, sync = null }) {
    if (!plan || !Array.isArray(journal)) return false;
    const parts = syncParts(sync || defaultSync(plan));
    const startedText = JSON.stringify(startedAt);
    try {
      if (!writable()) {
        memory = JSON.stringify({ plan, journal, startedAt, sync: sync || defaultSync(plan) });
        return false;
      }
      // While an old value is still on the watch, a whole copy first says the files replace it.
      const current = memory === null && !(legacySeen && !legacySeen.replaced) && disk.session?.plan === plan
        ? disk.session
        : null;
      let events;
      if (current) {
        // Events are replaced, never edited, so an event saved before is found by identity; one
        // that is not is compared by its text.
        let keep = 0;
        const limit = Math.min(journal.length, current.events.length);
        while (keep < limit) {
          const event = journal[keep];
          if (current.refs[keep] !== event) {
            if (JSON.stringify(event) !== current.events[keep]) break;
            current.refs[keep] = event;
          }
          keep += 1;
        }
        const added = journal.slice(keep).map((event) => JSON.stringify(event));
        const syncFields = syncChange(current.sync, parts);
        const startChanged = startedText !== current.startedAt;
        if (keep === current.events.length && added.length === 0 && !syncFields && !startChanged) return true;
        const line = `\n${encode('R', ascii(
          `{"b":${current.seq},"h":"${current.sum}","i":${current.logIndex},"k":${keep},"a":[${added.join(',')}]`
          + `${syncFields}${startChanged ? `,"t":${startedText}` : ''}}`
        ))}`;
        if (disk.logLength + line.length <= Math.max(LOG_MIN, current.baseSize)) {
          files.append(names.log, line);
          disk.logLength += line.length;
          current.events.length = keep;
          current.events.push(...added);
          current.refs.length = keep;
          current.refs.push(...journal.slice(keep));
          Object.assign(current, { sync: parts, startedAt: startedText, logIndex: current.logIndex + 1 });
          return true;
        }
        events = [...current.events.slice(0, keep), ...added];
      } else {
        events = journal.map((event) => JSON.stringify(event));
      }
      writeState(plan, events, journal.slice(), parts, startedText);
      memory = null;
      return true;
    } catch (err) {
      note('write failed:', message(err));
      // A write may have landed partly or not at all: the next save reads the files again and
      // writes a whole state to a slot that holds nothing newer.
      disk = null;
      memory = JSON.stringify({ plan, journal, startedAt, sync: sync || defaultSync(plan) });
      return false;
    }
  }

  function load() {
    if (memory !== null && !blocked) return JSON.parse(memory);
    const found = readDisk();
    if (found.unreadable.length) {
      note('read failed:', found.unreadable.join(', '));
      blocked = true;
      disk = null;
      const err = new Error(`session files not read: ${found.unreadable.join(', ')}`);
      err.code = SESSION_UNREADABLE;
      throw err;
    }
    // Whatever this returns is what the caller now holds, so later saves may write over it.
    blocked = false;
    memory = null;
    // Keeps the plan this run wrote, so the next save still knows it is unchanged.
    if (!(disk?.session && found.session && disk.session.seq === found.session.seq
      && disk.session.logIndex === found.session.logIndex)) {
      disk = found;
    }
    const old = readLegacy();
    if (old) {
      const replacedBy = found.session ? found.session.legacySum : found.cleared?.l;
      if (replacedBy === old.sum || (found.session && isPrefix(old.events, found.session.events))) {
        // The files hold this value's gestures or cleared them: it goes with the next copy or clear.
        legacySeen = { ...old, replaced: replacedBy === old.sum };
      } else {
        if (found.session || found.cleared) note('old snapshot is newer than the files');
        legacySeen = old;
        return old.snapshot;
      }
    }
    return found.session ? snapshotOf(disk.session) : null;
  }

  function remove(name) {
    try {
      files.remove(name);
      return true;
    } catch (err) {
      note('file not removed:', message(err));
      return false;
    }
  }

  /** True once no file or old value can bring the session back. */
  function clear() {
    memory = null;
    if (!blocked) disk = null;
    if (!writable()) {
      disk = null;
      return false;
    }
    const found = disk;
    disk = null;
    // A newer copy saying the session is gone outranks every older one while files are removed.
    let tombstone = null;
    if (found.copies.length) {
      tombstone = freeStateSlot(found);
      const seq = Math.max(found.maxSeq, lastSeq) + 1;
      lastSeq = seq;
      try {
        files.write(names.state[tombstone], encode('S',
          `{"v":${FORMAT},"seq":${seq},"cleared":true${legacySeen ? `,"l":"${legacySeen.sum}"` : ''}}`));
      } catch (err) {
        note('clear marker not written:', message(err));
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
      const left = [];
      return !legacySeen && [...names.plan, ...names.state, names.log].every((name) => readText(name, left) === null)
        && !left.length;
    }
    const others = [names.state[1 - tombstone], ...names.plan, names.log];
    others.forEach(remove);
    removeLegacy();
    // The marker outlives every other file: a removal can report success and leave the file.
    const unreadable = [];
    if (!legacySeen && others.every((name) => readText(name, unreadable) === null) && !unreadable.length) {
      remove(names.state[tombstone]);
    }
    return true;
  }

  return {
    /**
     * Returns `{plan, journal, startedAt, sync}` or null when there is nothing to resume; throws
     * an error with code SESSION_UNREADABLE when a session file exists but did not read.
     */
    load,
    save,
    hasSession: () => load() !== null,
    clear,
  };
}
