// 日本語の文字列リテラルを t() で包む（feature/i18n の一括変換）。
//  'テキスト' → t('テキスト')、`現在 ${n} 台` → t('現在 {0} 台', n)
//  すでに t( の中にあるもの、import 文、コメント、正規表現、テストは触らない。
// 使い方: node scripts/wrap-strings.mjs [--check]  （--check は未訳キーの一覧だけ出す）
import fs from 'node:fs';
import path from 'node:path';

const JA = /[぀-ヿ一-鿿！-｠]/;
const roots = ['src/game', 'src/pages'];
const check = process.argv.includes('--check');
const files = [];
for (const r of roots) walk(r);
function walk(d) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (/\.ts$/.test(p) && !/\.test\.ts$/.test(p) && !p.includes('/i18n/') && !p.includes('icons/lucide')) files.push(p);
  }
}

const keys = new Set();
let changedFiles = 0;
for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  const out = transform(src, keys, file);
  if (out !== src && !check) {
    fs.writeFileSync(file, out);
    changedFiles++;
  }
}
// 未訳キー
const enSrc = fs.readFileSync('src/game/i18n/en.ts', 'utf8');
const have = new Set([...enSrc.matchAll(/^\s*'((?:[^'\\]|\\.)*)':/gm)].map((m) => m[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\')));
const missing = [...keys].filter((k) => !have.has(k));
console.log(`files changed: ${changedFiles}, keys: ${keys.size}, missing in en.ts: ${missing.length}`);
if (process.argv.includes('--list')) for (const k of missing) console.log(JSON.stringify(k));
if (process.argv.includes('--write-missing')) {
  const lines = missing.map((k) => `  ${q(k)}: '',`).join('\n');
  fs.writeFileSync('scripts/missing-en.txt', lines + '\n');
}

function q(s) {
  return "'" + s.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
}

/** 1 ファイル変換。文字列・テンプレート・コメント・正規表現を字句単位で歩く */
function transform(src, keys, file = '') {
  let out = '';
  let i = 0;
  let needImport = false;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const two = src.slice(i, i + 2);
    if (two === '//') {
      const j = src.indexOf('\n', i);
      const end = j < 0 ? n : j;
      out += src.slice(i, end);
      i = end;
      continue;
    }
    if (two === '/*') {
      const j = src.indexOf('*/', i + 2);
      const end = j < 0 ? n : j + 2;
      out += src.slice(i, end);
      i = end;
      continue;
    }
    if (c === "'" || c === '"') {
      const j = scanString(src, i, c);
      const raw = src.slice(i, j);
      const inner = raw.slice(1, -1);
      if (JA.test(inner) && !insideT(out) && !isImport(out)) {
        const key = unescape(inner, c);
        keys.add(key);
        out += `tr(${q(key)})`;
        needImport = true;
      } else {
        // すでに tr( の中にあるキーも未訳チェックの対象にする
        if (JA.test(inner) && insideT(out)) keys.add(unescape(inner, c));
        out += raw;
      }
      i = j;
      continue;
    }
    if (c === '`') {
      const j = scanTemplate(src, i);
      const raw = src.slice(i, j);
      const res = convertTemplate(raw, keys);
      if (res && !insideT(out)) {
        out += res;
        needImport = true;
      } else out += raw;
      i = j;
      continue;
    }
    if (c === '/' && isRegexStart(out)) {
      const j = scanRegex(src, i);
      out += src.slice(i, j);
      i = j;
      continue;
    }
    out += c;
    i++;
  }
  if (file && needImport && !/\bimport \{[^}]*\btr\b[^}]*\} from '[^']*i18n'/.test(out)) {
    const rel = path.relative(path.dirname(file), 'src/game/i18n').replace(/\\/g, '/');
    out = insertImport(out, rel.startsWith('.') ? rel : './' + rel);
  }
  return out;
}

function insertImport(out, rel) {
  const lines = out.split('\n');
  let last = -1;
  for (let k = 0; k < lines.length; k++) if (/^import /.test(lines[k])) last = k;
  // 複数行 import の終わりまで進める
  if (last >= 0) {
    while (last < lines.length - 1 && !/;\s*$/.test(lines[last]) ) last++;
  }
  lines.splice(last + 1, 0, `import { tr } from '${rel}';`);
  return lines.join('\n');
}

function scanString(s, i, qc) {
  let j = i + 1;
  while (j < s.length) {
    if (s[j] === '\\') j += 2;
    else if (s[j] === qc) return j + 1;
    else if (s[j] === '\n') return j; // 壊れた文字列: そのまま
    else j++;
  }
  return j;
}
function scanTemplate(s, i) {
  let j = i + 1;
  let depth = 0;
  while (j < s.length) {
    if (s[j] === '\\') j += 2;
    else if (depth === 0 && s[j] === '`') return j + 1;
    else if (s.slice(j, j + 2) === '${') { depth++; j += 2; }
    else if (depth > 0 && s[j] === '}') { depth--; j++; }
    else if (depth > 0 && (s[j] === "'" || s[j] === '"')) j = scanString(s, j, s[j]);
    else if (depth > 0 && s[j] === '`') j = scanTemplate(s, j);
    else j++;
  }
  return j;
}
function scanRegex(s, i) {
  let j = i + 1;
  let cls = false;
  while (j < s.length) {
    if (s[j] === '\\') j += 2;
    else if (s[j] === '[') { cls = true; j++; }
    else if (s[j] === ']') { cls = false; j++; }
    else if (s[j] === '/' && !cls) { j++; while (/[a-z]/.test(s[j] || '')) j++; return j; }
    else if (s[j] === '\n') return i + 1;
    else j++;
  }
  return j;
}
function isRegexStart(out) {
  const m = out.match(/(\S)\s*$/);
  if (!m) return true;
  return /[(,=:[!&|?{};+\-*%<>~^]/.test(m[1]) || /\b(return|typeof|case)\s*$/.test(out);
}
function insideT(out) {
  // t( と tr( の両方（包む関数は tr。以前は t( だけ見ていたので、再実行のたびに tr(tr('…')) と二重に包んでいた）
  return /\btr?\(\s*$/.test(out) || /\btr?\(\s*'[^']*$/.test(out);
}
function isImport(out) {
  const line = out.slice(out.lastIndexOf('\n') + 1);
  return /^\s*import\b/.test(line) || /\bfrom\s*$/.test(out);
}
function unescape(inner, qc) {
  return inner.replace(/\\(.)/g, (m, ch) => (ch === 'n' ? '\n' : ch === 't' ? '\t' : ch));
}
/** テンプレートを t('… {0} …', expr0, …) に。日本語が無ければ null */
function convertTemplate(raw, keys) {
  const body = raw.slice(1, -1);
  if (!JA.test(body)) return null;
  const parts = [];
  const args = [];
  let i = 0;
  let text = '';
  while (i < body.length) {
    if (body[i] === '\\') { text += body[i + 1] === 'n' ? '\n' : body[i + 1]; i += 2; continue; }
    if (body.slice(i, i + 2) === '${') {
      let depth = 1;
      let j = i + 2;
      while (j < body.length && depth > 0) {
        if (body[j] === '{') depth++;
        else if (body[j] === '}') depth--;
        else if (body[j] === "'" || body[j] === '"') { j = scanString(body, j, body[j]); continue; }
        else if (body[j] === '`') { j = scanTemplate(body, j); continue; }
        j++;
      }
      const expr = body.slice(i + 2, j - 1);
      // 式の中の日本語リテラルも包む
      args.push(transformExpr(expr, keys));
      text += `{${args.length - 1}}`;
      i = j;
      continue;
    }
    text += body[i];
    i++;
  }
  if (!JA.test(text)) return null; // 日本語は式の中だけ → テンプレート自体は変えない
  keys.add(text);
  return `tr(${q(text)}${args.map((a) => ', ' + a).join('')})`;
}
function transformExpr(expr, keys) {
  return transform(expr, keys);
}
