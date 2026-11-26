/**
 * A stand-in for `@zos/fs` with the failures its typings allow: `writeFileSync` returns nothing,
 * `writeSync` and `closeSync` promise no result, `readFileSync` returns `undefined` when a file
 * "failed to be read", and `rmSync` reports a failure only by its result.
 *
 * `fault(op)` is asked before every write, append and removal with `{kind, path, index}` and
 * returns null or one fault name:
 * - the app dies: `crash` (nothing written), `torn` (a prefix of the new bytes), `zero` (the file
 *   left empty), `oldSuffix` (new bytes over the old ones in place, old bytes left after them);
 * - the call throws and the app lives: `throw` (nothing written), `throwPartial` (a prefix);
 * - the call returns as if it worked: `twice` (an append lands twice), `noop` (nothing written),
 *   `short` (a prefix of an append);
 * - a removal: `rmFails` (the file stays and rmSync says so), `rmLies` (the file stays and
 *   statSync says it is gone until it is written again).
 * After a death every call throws until `reboot()`. `ignoreAppendFlag` and `ignorePosition` model a
 * firmware that honours neither O_APPEND nor the `position` option of writeSync.
 */

const CRASHES = new Set(['crash', 'torn', 'zero', 'oldSuffix']);

export function createFakeZosFs({ rnd = Math.random, ignoreAppendFlag = false, ignorePosition = false } = {}) {
  const files = new Map();
  const ghosts = new Set();
  const unreadable = new Set();
  const handles = new Map();
  let dead = false;
  let ops = 0;
  const fs = {
    O_RDONLY: 0, O_WRONLY: 1, O_RDWR: 2, O_APPEND: 8, O_CREAT: 64, O_TRUNC: 512,
    files,
    unreadable,
    fault: () => null,
    get dead() { return dead; },
    get ops() { return ops; },
    reboot() {
      dead = false;
      handles.clear();
    },
  };
  const alive = () => {
    if (dead) throw new Error('watch app is dead');
  };
  const cut = (text) => text.slice(0, Math.floor(rnd() * (text.length + 1)));
  const ask = (kind, path) => {
    alive();
    ops += 1;
    return fs.fault({ kind, path, index: ops }) || null;
  };
  const die = () => {
    dead = true;
    throw new Error('watch app killed mid-write');
  };
  const land = (path, text) => {
    files.set(path, text);
    ghosts.delete(path);
  };

  /** Replaces or extends `path` with `next`, the full intended content, under `fault`. */
  function apply(path, fault, next, { append, data, old }) {
    switch (fault) {
      case null: land(path, next); return;
      case 'crash': die(); return;
      case 'torn': land(path, append ? old + cut(data) : cut(next)); die(); return;
      case 'zero': if (!append) land(path, ''); die(); return;
      case 'oldSuffix': {
        const head = append ? old + cut(data) : cut(next);
        land(path, head + old.slice(head.length));
        die();
        return;
      }
      case 'throw': throw new Error('ENOSPC');
      case 'throwPartial': land(path, append ? old + cut(data) : cut(next)); throw new Error('short write');
      case 'twice': land(path, append ? next + data : next); return;
      case 'noop': return;
      case 'short': land(path, append ? old + cut(data) : cut(next)); return;
      default: land(path, next);
    }
  }

  fs.readFileSync = ({ path }) => {
    alive();
    if (unreadable.has(path) && files.has(path)) return undefined;
    return files.has(path) ? files.get(path) : undefined;
  };
  fs.statSync = ({ path }) => {
    alive();
    return files.has(path) && !ghosts.has(path) ? { size: files.get(path).length } : undefined;
  };
  fs.writeFileSync = ({ path, data }) => {
    const fault = ask('write', path);
    const old = files.get(path) ?? '';
    apply(path, fault, data, { append: false, data, old });
  };
  fs.openSync = ({ path, flag }) => {
    alive();
    const fd = handles.size + 3;
    handles.set(fd, { path, append: Boolean(flag & fs.O_APPEND) });
    if ((flag & fs.O_CREAT) && !files.has(path)) land(path, '');
    return fd;
  };
  fs.writeSync = ({ fd, buffer, options = {} }) => {
    const handle = handles.get(fd);
    if (!handle) throw new Error('bad fd');
    const data = String.fromCharCode(...new Uint8Array(buffer));
    const fault = ask('append', handle.path);
    const old = files.get(handle.path) ?? '';
    const at = handle.append && !ignoreAppendFlag ? old.length : (ignorePosition ? 0 : Math.min(options.position ?? 0, old.length));
    if (at === old.length) apply(handle.path, fault, old + data, { append: true, data, old });
    else apply(handle.path, fault, old.slice(0, at) + data + old.slice(at + data.length), { append: false, data, old });
    return undefined;
  };
  fs.closeSync = ({ fd }) => {
    handles.delete(fd);
    return undefined;
  };
  fs.rmSync = ({ path }) => {
    const fault = ask('remove', path);
    if (fault === 'rmFails') return -1;
    if (fault === 'rmLies') {
      if (files.has(path)) ghosts.add(path);
      return 0;
    }
    if (CRASHES.has(fault)) die();
    if (fault === 'throw' || fault === 'throwPartial') throw new Error('EBUSY');
    if (!files.has(path)) return -1;
    files.delete(path);
    ghosts.delete(path);
    return 0;
  };
  return fs;
}

/** A seeded xorshift generator in [0, 1). */
export function seeded(seed) {
  let state = (seed >>> 0) || 1;
  return () => {
    state ^= state << 13; state >>>= 0;
    state ^= state >> 17;
    state ^= state << 5; state >>>= 0;
    return state / 4294967296;
  };
}
