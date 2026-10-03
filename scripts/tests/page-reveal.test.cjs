const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { parseHTML } = require('linkedom');
const { addPageReveal } = require('../../build.js');

const source = fs.readFileSync(path.join(__dirname, '../../app.js'), 'utf8');

function setup({ fetchImpl = async () => ({ json: async () => ({ ready: true }) }), reducedMotion = false, readyState = 'loading' } = {}) {
  let now = 0;
  let nextTimer = 0;
  const timers = new Map();
  const classes = new Set();
  const attributes = new Map();
  const documentListeners = new Map();
  const windowListeners = new Map();
  const listen = (listeners, event, callback) => {
    if (!listeners.has(event)) listeners.set(event, []);
    listeners.get(event).push(callback);
  };
  const root = {
    classList: { add: value => classes.add(value), remove: value => classes.delete(value) },
    setAttribute: (name, value) => attributes.set(name, value),
    removeAttribute: name => attributes.delete(name)
  };
  const context = vm.createContext({
    document: { documentElement: root, readyState, getElementById: () => null, addEventListener: (event, callback) => listen(documentListeners, event, callback) },
    window: { fetch: fetchImpl, matchMedia: () => ({ matches: reducedMotion }), addEventListener: (event, callback) => listen(windowListeners, event, callback) },
    performance: { now: () => now },
    setTimeout: (callback, delay) => { const timer = ++nextTimer; timers.set(timer, { callback, time: now + delay }); return timer; },
    clearTimeout: timer => timers.delete(timer),
    HTMLElement: class {}, customElements: { get: () => false, define() {} }, console
  });
  vm.runInContext(source, context);
  function advance(duration) {
    const target = now + duration;
    for (;;) {
      const next = [...timers.entries()].filter(([, timer]) => timer.time <= target).sort((first, second) => first[1].time - second[1].time)[0];
      if (!next) break;
      now = next[1].time;
      timers.delete(next[0]);
      next[1].callback();
    }
    now = target;
  }
  const domReady = () => { for (const callback of documentListeners.get('DOMContentLoaded') || []) callback(); };
  return { context, classes, attributes, advance, domReady, windowListeners, nativeFetch: fetchImpl, documentListeners };
}

test('static pages remain covered briefly, then reveal and restore native fetch', () => {
  const page = setup();
  assert.ok(page.classes.has('site-loading'));
  assert.equal(page.attributes.get('aria-busy'), 'true');
  page.advance(1000);
  assert.ok(page.classes.has('site-loading'));
  page.domReady();
  page.advance(179);
  assert.ok(page.classes.has('site-loading'));
  page.advance(1);
  assert.ok(!page.classes.has('site-loading'));
  assert.ok(page.classes.has('site-revealed'));
  assert.ok(!page.attributes.has('aria-busy'));
  assert.equal(page.context.window.fetch, page.nativeFetch);
});

test('initial loading waits for response body consumption, not just response headers', async () => {
  let finishBody;
  const page = setup({ fetchImpl: async () => ({ json: () => new Promise(resolve => { finishBody = resolve; }) }) });
  page.domReady();
  const response = await page.context.window.fetch('/profile.json');
  const body = response.json();
  page.advance(1000);
  assert.ok(page.classes.has('site-loading'));
  finishBody({ name: 'Ready profile' });
  assert.equal((await body).name, 'Ready profile');
  page.advance(180);
  assert.ok(page.classes.has('site-revealed'));
});

test('sequential requests cancel the reveal until the last body is ready', async () => {
  const page = setup();
  page.domReady();
  const first = await page.context.window.fetch('/settings.json');
  await first.json();
  page.advance(100);
  const second = await page.context.window.fetch('/profile.json');
  await second.json();
  page.advance(299);
  assert.ok(page.classes.has('site-loading'));
  page.advance(1);
  assert.ok(page.classes.has('site-revealed'));
});

test('request failures settle cleanly and slow requests cannot trap the loading cover', async () => {
  const failed = setup({ fetchImpl: async () => { throw new Error('Offline'); } });
  failed.domReady();
  await assert.rejects(failed.context.window.fetch('/failed.json'), /Offline/);
  failed.advance(400);
  assert.ok(failed.classes.has('site-revealed'));
  const stalled = setup({ fetchImpl: () => new Promise(() => {}) });
  stalled.domReady();
  stalled.context.window.fetch('/stalled.json');
  stalled.advance(8000);
  assert.ok(!stalled.classes.has('site-loading'));
  assert.equal(stalled.context.window.fetch, stalled.nativeFetch);
});

test('Back-cache restoration reveals immediately and no navigation clicks are intercepted', () => {
  const page = setup();
  page.windowListeners.get('pageshow')[0]({ persisted: true });
  assert.ok(!page.classes.has('site-loading'));
  assert.equal(page.documentListeners.get('click'), undefined);
  page.context.initPageReveal();
  assert.equal(page.context.window.fetch, page.nativeFetch);
});

test('reduced motion removes the minimum animation delay', () => {
  const page = setup({ reducedMotion: true });
  page.domReady();
  page.advance(180);
  assert.ok(page.classes.has('site-revealed'));
});

test('build activates the cover before page scripts and preserves charset and no-JavaScript visibility', () => {
  const original = '<!doctype html><html><head><meta charset="UTF-8"><link rel="stylesheet" href="/styles.css"></head><body><main>Content</main><script src="/app.js"></script></body></html>';
  const result = addPageReveal(original);
  const { document } = parseHTML(result);
  assert.equal(document.head.firstElementChild.getAttribute('charset'), 'UTF-8');
  assert.ok(document.querySelector('#site-loading-critical'));
  assert.ok(document.querySelector('script[src="/app.js?v=20261003-profile-article-hero"]'));
  assert.ok(document.querySelector('link[href="/styles.css?v=20261003-profile-article-hero"]'));
  assert.ok(result.indexOf("classList.add('site-loading')") < result.indexOf('<body'));
  assert.ok(!document.documentElement.classList.contains('site-loading'));
  assert.equal(addPageReveal('<html><head></head><body>Standalone</body></html>'), '<html><head></head><body>Standalone</body></html>');
  const external = '<html><head></head><body><script src="https://example.com/app.js"></script></body></html>';
  assert.equal(addPageReveal(external), external);
});

test('missing portal scripts have an independent bootstrap failsafe', () => {
  const output = addPageReveal('<html><head></head><body><script src="../app.js"></script></body></html>');
  const { document } = parseHTML(output);
  let failsafe;
  const classes = new Set();
  vm.runInNewContext(document.head.querySelector('script').textContent, {
    window: {}, performance: { now: () => 1 },
    document: { documentElement: { classList: { add: name => classes.add(name), remove: name => classes.delete(name) }, removeAttribute() {} } },
    setTimeout: callback => { failsafe = callback; }
  });
  assert.ok(classes.has('site-loading'));
  failsafe();
  assert.ok(!classes.has('site-loading'));
});