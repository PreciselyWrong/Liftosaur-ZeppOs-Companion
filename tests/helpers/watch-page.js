/**
 * Runs a whole watch page (Workout or Companion) in a VM, its Zepp OS modules
 * replaced by an in-memory screen, a manual clock and the scripted phone link
 * of `phone-harness.js`. The screen keeps every native widget in z-order, so a
 * test reads exactly what the lifter would see and taps what they would tap.
 */

import path from 'node:path';
import vm from 'node:vm';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..', '..');
const ENTRIES = { workout: 'data-widget/common/index.js', companion: 'page/common/index.js' };
const bundles = new Map();

async function bundle(product) {
  if (!bundles.has(product)) {
    bundles.set(product, build({
      entryPoints: [path.join(root, ENTRIES[product])],
      bundle: true,
      write: false,
      format: 'esm',
      logLevel: 'silent',
      plugins: [{
        name: 'zepp-fakes',
        setup(builder) {
          builder.onResolve({ filter: /^@(zos|zeppos)\// }, (args) => ({ path: args.path, namespace: 'zepp' }));
          builder.onLoad({ filter: /.*/, namespace: 'zepp' }, (args) => ({
            contents: `module.exports = globalThis.__zepp[${JSON.stringify(args.path)}];`,
            loader: 'js',
          }));
        },
      }],
    }).then((result) => result.outputFiles[0].text));
  }
  return bundles.get(product);
}

const names = () => new Proxy({}, { get: (_, key) => (typeof key === 'string' ? key : undefined) });

/** Native widgets in z-order; `rebuilds` counts full-screen backdrops, drawn once per full rebuild. */
function createScreen(width, height, record) {
  const widgets = [];
  const stats = { creates: 0, deletes: 0, redraws: 0, rebuilds: 0, textRepaints: [] };
  const createWidget = (type, props = {}) => {
    const w = {
      type, props: { ...props }, enabled: true, visible: true,
      setProperty(key, value) {
        if (key === 'MORE') {
          if (type === 'TEXT' && ['text', 'color'].some((name) => name in value && value[name] !== w.props[name])) {
            stats.textRepaints.push({ ...value });
          }
          Object.assign(w.props, value);
        } else if (key === 'VISIBLE') w.visible = Boolean(value);
        else if (key === 'ANIM') return 1;
        return undefined;
      },
      getProperty(key) { return key === 'MORE' ? { ...w.props } : undefined; },
      setEnable(value) { w.enabled = Boolean(value); },
      addEventListener() {},
    };
    if (type === 'FILL_RECT' && props.x === 0 && props.y === 0 && props.w === width && props.h === height) {
      stats.rebuilds++;
      record({ type: 'REBUILD' });
    }
    stats.creates++;
    widgets.push(w);
    return w;
  };
  const deleteWidget = (w) => {
    const index = widgets.indexOf(w);
    if (index < 0) throw new Error('widget deleted twice');
    widgets.splice(index, 1);
    stats.deletes++;
  };
  const describe = (w) => {
    const props = Object.fromEntries(Object.entries(w.props)
      .filter(([, value]) => typeof value !== 'function' && value !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1)));
    return JSON.stringify({ type: w.type, enabled: w.enabled, visible: w.visible, ...props });
  };
  return {
    widgets, stats, createWidget, deleteWidget,
    redraw() { stats.redraws++; },
    /** Touchable widgets keep their stacking order; transparent labels draw on top in any order. */
    snapshot() {
      return {
        widgets: widgets.filter((w) => w.enabled).map(describe),
        labels: widgets.filter((w) => !w.enabled).map(describe).sort(),
      };
    },
    texts: () => widgets.filter((w) => w.visible).map((w) => w.props.text).filter((text) => typeof text === 'string'),
    find(predicate) { return widgets.find((w) => w.visible && predicate(w)); },
  };
}

function createClock(start) {
  let now = start;
  let nextId = 0;
  const timers = new Map();
  const schedule = (callback, delay, repeat) => {
    const id = ++nextId;
    timers.set(id, { callback, at: now + Math.max(0, Number(delay) || 0), every: repeat ? Math.max(1, Number(delay) || 0) : 0 });
    return id;
  };
  const clear = (id) => { timers.delete(id); };
  class FakeDate extends Date {
    constructor(...args) {
      if (args.length) super(...args);
      else super(now);
    }

    static now() { return now; }
  }
  return {
    Date: FakeDate,
    now: () => now,
    setTimeout: (callback, delay) => schedule(callback, delay, false),
    setInterval: (callback, delay) => schedule(callback, delay, true),
    clearTimeout: clear,
    clearInterval: clear,
    /** Runs every timer due within `ms`, in time order, timers they set included. */
    advance(ms) {
      const end = now + ms;
      for (;;) {
        let due = null;
        for (const [id, timer] of timers) {
          if (timer.at <= end && (!due || timer.at < due[1].at || (timer.at === due[1].at && id < due[0]))) due = [id, timer];
        }
        if (!due) break;
        const [id, timer] = due;
        now = Math.max(now, timer.at);
        if (timer.every) timer.at = now + timer.every;
        else timers.delete(id);
        timer.callback();
      }
      now = end;
    },
  };
}

function memoryStorage() {
  const values = new Map();
  return class LocalStorage {
    getItem(key, fallback = undefined) { return values.has(key) ? values.get(key) : fallback; }
    setItem(key, value) { values.set(key, value); }
    removeItem(key) { values.delete(key); }
    clear() { values.clear(); }
  };
}

/**
 * Boots `product` against `link` (a phone link from `createPhoneLink`). The page is built and its
 * launch requests are answered by the time this resolves when the link answers automatically.
 */
export async function loadWatchPage(product, { link, start = 1_700_000_000_000, width = 466, height = 466, rebuildAlways = false, fs = null } = {}) {
  const code = await bundle(product);
  const clock = createClock(start);
  // Full rebuilds and phone requests in the order they happened.
  const events = [];
  const record = (event) => events.push({ ...event, at: clock.now() });
  const screen = createScreen(width, height, record);
  const files = { on() {}, getNextFile: () => null };
  const failing = () => { throw new Error('no file system in tests'); };
  const zepp = {
    '@zos/ui': {
      createWidget: screen.createWidget, deleteWidget: screen.deleteWidget, redraw: screen.redraw,
      widget: names(), align: names(), text_style: names(), prop: names(), sport_data: names(),
      edit_widget_group_type: names(), anim_status: names(),
    },
    '@zos/utils': { px: (value) => value },
    '@zos/device': { getDeviceInfo: () => ({ width, height, screenShape: 1 }), SCREEN_SHAPE_ROUND: 1 },
    '@zos/sensor': {
      Time: class { getMinutes() { return 30; } getFormatHour() { return 10; } getHourFormat() { return 0; } getHours() { return 10; } },
      TIME_HOUR_FORMAT_12: 1,
      Vibrator: class { setMode() {} start() {} stop() {} getType() { return 0; } },
      HeartRate: class { getCurrent() { return 0; } onCurrentChange() {} offCurrentChange() {} },
      VIBRATOR_SCENE_STRONG_REMINDER: 1, VIBRATOR_SCENE_SHORT_LIGHT: 2, VIBRATOR_SCENE_DURATION: 3,
    },
    '@zos/storage': { LocalStorage: memoryStorage() },
    '@zos/app': { getPackageInfo: () => ({}), getPerformance: () => ({}) },
    '@zos/settings': { getSystemInfo: () => ({}) },
    '@zos/app-access': { getSportData: () => {} },
    '@zos/display': {
      setPageBrightTime() {}, resetPageBrightTime() {}, pauseDropWristScreenOff() {}, resetDropWristScreenOff() {},
      pausePalmScreenOff() {}, resetPalmScreenOff() {},
    },
    '@zos/interaction': {
      onGesture() {}, offGesture() {}, GESTURE_LEFT: 1, GESTURE_RIGHT: 2, GESTURE_UP: 3, GESTURE_DOWN: 4,
    },
    '@zos/fs': fs || {
      openSync: failing, writeSync: failing, closeSync: failing, readFileSync: failing, writeFileSync: failing,
      rmSync: failing, statSync: failing, O_WRONLY: 1, O_CREAT: 2, O_APPEND: 4, O_TRUNC: 8, O_RDONLY: 0,
    },
    '@zos/ble/TransferFile': class { constructor() { this.inbox = files; } },
    '@zeppos/zml/base-page': { BasePage: (definition) => definition },
  };
  let definition = null;
  const context = {
    __zepp: zepp,
    console: { log() {}, warn() {}, error() {}, info() {} },
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    setInterval: clock.setInterval, clearInterval: clock.clearInterval,
    Date: clock.Date,
    hmUI: { setStatusBarVisible() {} },
    DataWidget: (page) => { definition = page; },
    Page: (page) => { definition = page; },
  };
  vm.createContext(context);
  vm.runInContext(code, context);
  if (rebuildAlways) {
    // The reference run: every redraw deletes every widget and draws the screen again from scratch.
    if (typeof context.canPlanScreen !== 'function') throw new Error(`${product} has no canPlanScreen`);
    context.canPlanScreen = () => false;
  }
  const page = Object.assign(Object.create(definition), {
    request: (message) => {
      record({ type: message.type });
      return link.request(message.type, message.payload);
    },
  });
  page.onInit();
  page.build();
  return {
    page, screen, clock, context, events,
    tap(predicate) {
      const target = screen.find((w) => typeof w.props.click_func === 'function' && predicate(w));
      if (!target) throw new Error(`nothing to tap among ${JSON.stringify(screen.texts())}`);
      target.props.click_func(target);
      return target;
    },
    tapText(text) { return this.tap((w) => w.props.text === text); },
  };
}
