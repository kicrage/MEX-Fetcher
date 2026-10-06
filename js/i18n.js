// Tiny i18n layer. Dictionaries live in js/i18n/{ja,en}.js (flat key → "text with {params}").
//
// Core (DOM-free) modules never build display strings directly: they return `msg(key, params)` objects that views
// translate with `tr()` at render time, so switching language re-renders without re-fetching or re-analysing.

import ja from './i18n/ja.js';
import en from './i18n/en.js';

const dicts = { ja, en };
export const LANGS = ['ja', 'en'];

let lang = 'ja'; // overridden at startup by main.js; tests run in Japanese unless they call setLang()

export const getLang = () => lang;

export function setLang(next) {
    if (dicts[next]) lang = next;
    return lang;
}

/** Stored choice wins; otherwise the browser language (Japanese → ja, everything else → en). */
export function detectLang(stored, browserLanguage) {
    if (stored && dicts[stored]) return stored;
    return /^ja\b/i.test(String(browserLanguage || '')) ? 'ja' : 'en';
}

// A param may itself be a msg() (or an array of them, joined with " / "): nested messages stay translatable.
const paramText = v => Array.isArray(v) ? v.map(paramText).join(' / ')
    : (v && typeof v === 'object' && 'key' in v) ? t(v.key, v.params) : String(v);

function format(text, params) {
    if (!params) return text;
    return text.replace(/\{(\w+)\}/g, (whole, name) => (name in params ? paramText(params[name]) : whole));
}

/** Translates `key`; falls back to Japanese, then to the key itself so a missing entry is visible, not blank. */
export function t(key, params) {
    const text = dicts[lang][key] ?? dicts.ja[key] ?? key;
    return format(text, params);
}

/** A deferred message: translated later by `tr()`. */
export const msg = (key, params) => ({ key, params });

/** Translates a `msg()` object (plain strings pass through). */
export const tr = m => (m && typeof m === 'object' && 'key' in m) ? t(m.key, m.params) : String(m ?? '');

export const locale = () => (lang === 'ja' ? 'ja-JP' : 'en-US');
export const joinList = items => items.join(lang === 'ja' ? '、' : ', ');

/**
 * Applies translations to static markup:
 *   data-i18n="key"                        → textContent
 *   data-i18n-attr="placeholder:key;aria-label:key2" → attributes
 */
export function applyStatic(root = document) {
    document.documentElement.lang = lang;
    document.title = t('app.title');
    for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
    for (const el of root.querySelectorAll('[data-i18n-attr]')) {
        for (const pair of el.dataset.i18nAttr.split(';')) {
            const [attr, key] = pair.split(':');
            if (attr && key) el.setAttribute(attr.trim(), t(key.trim()));
        }
    }
}
