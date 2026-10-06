import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// theme.js touches document / localStorage / matchMedia, so provide minimal stand-ins.
let store, listeners, osDark, storageBroken;

beforeEach(() => {
    store = {};
    listeners = [];
    osDark = false;
    storageBroken = false;
    globalThis.document = { documentElement: { dataset: {} } };
    globalThis.localStorage = {
        getItem: k => { if (storageBroken) throw new Error('blocked'); return k in store ? store[k] : null; },
        setItem: (k, v) => { if (storageBroken) throw new Error('blocked'); store[k] = String(v); }
    };
    globalThis.matchMedia = () => ({
        get matches() { return osDark; },
        addEventListener: (type, fn) => { if (type === 'change') listeners.push(fn); }
    });
});

const theme = () => import('../js/theme.js');
const html = () => document.documentElement.dataset.theme;

test('storedMode defaults to auto and ignores junk', async () => {
    const { storedMode } = await theme();
    assert.equal(storedMode(), 'auto');
    store['mex:theme'] = 'dark';
    assert.equal(storedMode(), 'dark');
    store['mex:theme'] = 'purple';
    assert.equal(storedMode(), 'auto');
});

test('resolve: explicit modes ignore the OS, auto follows it', async () => {
    const { resolve } = await theme();
    osDark = true;
    assert.equal(resolve('light'), 'light');
    assert.equal(resolve('dark'), 'dark');
    assert.equal(resolve('auto'), 'dark');
    osDark = false;
    assert.equal(resolve('auto'), 'light');
    assert.equal(resolve('dark'), 'dark');
});

test('setMode persists and applies; unknown modes fall back to auto', async () => {
    const { setMode } = await theme();
    setMode('dark');
    assert.equal(store['mex:theme'], 'dark');
    assert.equal(html(), 'dark');
    osDark = true;
    setMode('bogus');
    assert.equal(store['mex:theme'], 'auto');
    assert.equal(html(), 'dark');
});

test('still applies for this session when storage is blocked', async () => {
    const { setMode, storedMode } = await theme();
    storageBroken = true;
    assert.equal(storedMode(), 'auto');
    assert.doesNotThrow(() => setMode('dark'));
    assert.equal(html(), 'dark');
});

test('watchSystemTheme: follows OS changes only in auto mode, and notifies', async () => {
    const { watchSystemTheme, setMode } = await theme();
    let notified = 0;
    watchSystemTheme(() => { notified++; });
    assert.equal(listeners.length, 1);

    setMode('auto');
    osDark = true;
    listeners[0]();
    assert.equal(html(), 'dark');
    assert.equal(notified, 1);

    osDark = false;
    listeners[0]();
    assert.equal(html(), 'light');
    assert.equal(notified, 2);

    setMode('dark'); // explicit choice: OS changes must not override it
    osDark = false;
    listeners[0]();
    assert.equal(html(), 'dark');
    assert.equal(notified, 2);
});
