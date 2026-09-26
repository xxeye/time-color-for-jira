'use strict';
// Finds East Asian text in JavaScript code or HTML markup while ignoring comments.
// Used to keep user-facing text in _locales instead of hardcoded strings.
const CJK = /[぀-ヿ㐀-鿿가-힯！-～　-〿]/;
const BACKSLASH = 92;
const NEWLINE = 10;
const REGEX_PREFIX = '(,=:[!&|?{};+-*%<>~^';

function scanJs(src) {
  const found = [];
  const n = src.length;
  let i = 0;
  let line = 1;
  let prev = '';
  const record = (start, text) => {
    if (CJK.test(text)) found.push({ line: start, text: text.replace(/\s+/g, ' ').trim().slice(0, 100) });
  };
  const escaped = () => src.charCodeAt(i) === BACKSLASH;
  const newline = () => src.charCodeAt(i) === NEWLINE;

  function quoted(quote) {
    const start = line;
    let text = '';
    i++;
    while (i < n && src[i] !== quote) {
      if (escaped()) {
        text += src.slice(i, i + 2);
        i += 2;
        continue;
      }
      if (newline()) line++;
      text += src[i++];
    }
    i++;
    record(start, text);
  }

  function template() {
    const start = line;
    let text = '';
    i++;
    while (i < n && src[i] !== '`') {
      if (escaped()) {
        text += src.slice(i, i + 2);
        i += 2;
        continue;
      }
      if (src[i] === '$' && src[i + 1] === '{') {
        i += 2;
        code(true);
        text += ' ';
        continue;
      }
      if (newline()) line++;
      text += src[i++];
    }
    i++;
    record(start, text);
  }

  function regex() {
    const start = line;
    let text = '';
    let inClass = false;
    i++;
    while (i < n && !newline()) {
      const ch = src[i];
      if (escaped()) {
        text += src.slice(i, i + 2);
        i += 2;
        continue;
      }
      if (ch === '[') inClass = true;
      else if (ch === ']') inClass = false;
      else if (ch === '/' && !inClass) break;
      text += ch;
      i++;
    }
    i++;
    record(start, text);
  }

  function code(inTemplate) {
    let depth = 0;
    while (i < n) {
      const ch = src[i];
      const next = src[i + 1];
      if (newline()) {
        line++;
        i++;
        continue;
      }
      if (ch === '/' && next === '/') {
        while (i < n && !newline()) i++;
        continue;
      }
      if (ch === '/' && next === '*') {
        i += 2;
        while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
          if (newline()) line++;
          i++;
        }
        i += 2;
        continue;
      }
      if (ch === '"' || ch === "'") {
        quoted(ch);
        prev = ch;
        continue;
      }
      if (ch === '`') {
        template();
        prev = ch;
        continue;
      }
      if (ch === '/' && (prev === '' || REGEX_PREFIX.includes(prev))) {
        regex();
        prev = '/';
        continue;
      }
      if (inTemplate && ch === '{') depth++;
      if (inTemplate && ch === '}') {
        if (depth === 0) {
          i++;
          return;
        }
        depth--;
      }
      if (!/\s/.test(ch)) {
        if (CJK.test(ch)) found.push({ line, text: src.slice(i, i + 40).trim() });
        prev = ch;
      }
      i++;
    }
  }

  code(false);
  return found;
}

function scanHtml(src) {
  const withoutComments = src.replace(/<!--[\s\S]*?-->/g, (comment) => comment.replace(/[^\n]/g, ' '));
  return withoutComments
    .split('\n')
    .map((text, index) => ({ line: index + 1, text: text.trim().slice(0, 100) }))
    .filter((entry) => CJK.test(entry.text));
}

module.exports = { CJK, scanJs, scanHtml };
