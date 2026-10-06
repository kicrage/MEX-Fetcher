// Theme (light / dark / auto). The resolved theme is written to <html data-theme="light|dark"> so CSS has a
// single set of dark tokens. An inline script in <head> applies it before first paint to avoid a flash.

const KEY = 'mex:theme';
export const MODES = ['auto', 'light', 'dark'];

export function storedMode() {
    try {
        const v = localStorage.getItem(KEY);
        return MODES.includes(v) ? v : 'auto';
    } catch (e) {
        return 'auto';
    }
}

const prefersDark = () => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;

export const resolve = mode => (mode === 'dark' || (mode === 'auto' && prefersDark())) ? 'dark' : 'light';

export function applyTheme(mode) {
    document.documentElement.dataset.theme = resolve(mode);
}

export function setMode(mode) {
    if (!MODES.includes(mode)) mode = 'auto';
    try { localStorage.setItem(KEY, mode); } catch (e) { /* storage unavailable: applies for this session only */ }
    applyTheme(mode);
}

/** Re-applies the theme when the OS preference changes while in auto mode. `onChange` fires after any change. */
export function watchSystemTheme(onChange) {
    if (typeof matchMedia !== 'function') return;
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if (storedMode() === 'auto') {
            applyTheme('auto');
            onChange();
        }
    });
}
