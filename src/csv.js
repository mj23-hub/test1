const iconv = require('iconv-lite');

// Excel（Windows）から書き出したCSVはShift_JIS(CP932)になることが多いため、
// UTF-8として妥当に解釈できない場合はCP932として読み直す
function decodeCsvBuffer(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.slice(3).toString('utf8');
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return iconv.decode(buffer, 'cp932');
  }
}

// RFC4180ベースの簡易CSVパーサー（ダブルクオート囲み・カンマ含みフィールドに対応）
function parseCsv(text) {
  // BOM除去
  const src = text.replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];

    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch === '\r') {
      // 次のLFはループ側で処理される
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v.trim() !== ''));
}

const NAME_HEADERS = ['氏名', '名前', 'name'];
const ROLE_HEADERS = ['役職名', '役職', 'role'];
const COMPANY_HEADERS = ['事業所名', '会社名', 'company'];
const STATUS_HEADERS = ['出席', '回答状況', 'status', 'present'];

const PRESENT_VALUES = new Set(['○', '◯', '〇', '出席', '参加', '済', '1', 'true', 'yes', 'y']);
const ABSENT_PREFIXES = ['不参加', '欠席'];

function findColumnIndex(headers, candidates) {
  const normalized = headers.map((h) => h.trim().toLowerCase());
  for (const candidate of candidates) {
    const idx = normalized.indexOf(candidate.toLowerCase());
    if (idx !== -1) return idx;
  }
  return -1;
}

function isPresent(raw) {
  const value = (raw || '').trim();
  if (value === '') return false;
  if (ABSENT_PREFIXES.some((p) => value.startsWith(p))) return false;
  if (PRESENT_VALUES.has(value)) return true;
  // 「委員会○ 懇親会○」のようにステータス文字列内に含まれるケースも許容
  return value.includes('○') || value.includes('◯');
}

// CSVテキストから出欠インポート用のレコード一覧を作る
// 戻り値: [{ name, role, company, present }]
function parseAttendanceCsv(text) {
  const rows = parseCsv(text);
  if (rows.length === 0) {
    throw new Error('CSVにデータがありません');
  }
  const headers = rows[0];
  const nameIdx = findColumnIndex(headers, NAME_HEADERS);
  if (nameIdx === -1) {
    throw new Error(`氏名の列が見つかりません（${NAME_HEADERS.join(' / ')} のいずれかの見出しが必要です）`);
  }
  const roleIdx = findColumnIndex(headers, ROLE_HEADERS);
  const companyIdx = findColumnIndex(headers, COMPANY_HEADERS);
  const statusIdx = findColumnIndex(headers, STATUS_HEADERS);
  if (statusIdx === -1) {
    throw new Error(`出欠の列が見つかりません（${STATUS_HEADERS.join(' / ')} のいずれかの見出しが必要です）`);
  }

  const records = [];
  for (let i = 1; i < rows.length; i++) {
    const cols = rows[i];
    const name = (cols[nameIdx] || '').trim();
    if (!name) continue;
    records.push({
      name,
      role: roleIdx !== -1 ? (cols[roleIdx] || '').trim() : '',
      company: companyIdx !== -1 ? (cols[companyIdx] || '').trim() : '',
      present: isPresent(cols[statusIdx]),
    });
  }
  return records;
}

// ファイル名から開催日を推測する（例: "0818_出席.csv" → 8月18日、"20260818.csv" → 2026年8月18日）
// year: ファイル名に年が無い場合に使う年（通常は現在の年）
function parseDateFromFilename(filename, year) {
  const base = (filename || '').replace(/\.[^.]+$/, '');
  const digitRuns = base.match(/\d+/g) || [];

  for (const run of digitRuns) {
    if (run.length >= 8) {
      const y = Number(run.slice(0, 4));
      const m = Number(run.slice(4, 6));
      const d = Number(run.slice(6, 8));
      if (isValidDate(y, m, d)) return formatDate(y, m, d);
    }
  }
  for (const run of digitRuns) {
    if (run.length === 4) {
      const m = Number(run.slice(0, 2));
      const d = Number(run.slice(2, 4));
      if (isValidDate(year, m, d)) return formatDate(year, m, d);
    }
  }
  return null;
}

function isValidDate(y, m, d) {
  if (!(m >= 1 && m <= 12)) return false;
  if (!(d >= 1 && d <= 31)) return false;
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

function formatDate(y, m, d) {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

module.exports = {
  parseCsv,
  parseAttendanceCsv,
  isPresent,
  decodeCsvBuffer,
  parseDateFromFilename,
};
