const UNIT_WORDS = ['箱', '個', '枚', '本', 'ロール', '袋', 'セット', 'ケース', 'パック', '巻', '双', '膳', '冊', '缶', '束'];
const ORDER_VERBS = ['発注', '注文', 'オーダー', 'お願いします', 'お願いね', 'お願い', 'してください', 'して下さい', 'して', 'します', 'する', 'です', 'ます'];

function toHalfWidthDigits(str) {
  return str.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
}

function itemAliasNames(item) {
  const names = [item.name];
  if (item.aliases) {
    item.aliases
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((a) => names.push(a));
  }
  return names;
}

// Finds the item whose name/alias appears in the text, preferring the longest match.
function findItemMatch(text, items) {
  let best = null;
  for (const item of items) {
    for (const name of itemAliasNames(item)) {
      const idx = text.indexOf(name);
      if (idx !== -1 && (!best || name.length > best.matchedName.length)) {
        best = { item, matchedName: name, index: idx };
      }
    }
  }
  return best;
}

// Finds the first "<number><optional unit>" occurrence in the text.
function findQuantity(text) {
  const unitPattern = UNIT_WORDS.join('|');
  const re = new RegExp(`([0-9]+(?:\\.[0-9]+)?)\\s*(${unitPattern})?`);
  const m = re.exec(text);
  if (!m) return null;
  return { quantity: parseFloat(m[1]), unit: m[2] || null, raw: m[0] };
}

function findSupplier(text, suppliers) {
  for (const s of suppliers) {
    if (text.includes(s.name)) {
      return { supplier: s, raw: s.name, matchedName: s.name };
    }
  }
  return null;
}

// Best-effort extraction of a free-text supplier name from what's left after
// removing the recognized item name and quantity, e.g. "...をコクヨに発注して".
function guessSupplierFromRemainder(text, itemMatch, qtyMatch) {
  let remainder = text;
  if (itemMatch) remainder = remainder.replace(itemMatch.matchedName, '');
  if (qtyMatch) remainder = remainder.replace(qtyMatch.raw, '');

  const verbPattern = ORDER_VERBS.join('|');
  remainder = remainder.replace(new RegExp(`(${verbPattern})`, 'g'), ' ');

  const m = remainder.match(/([^\sをはにへ、,]+)\s*[にへ]\s*$/) || remainder.match(/([^\sをはにへ、,]+)\s*[にへ]/);
  if (m && m[1] && m[1].length <= 20) {
    return m[1].trim();
  }
  return null;
}

function parseMessage(text, items, suppliers) {
  const normalized = toHalfWidthDigits(text);
  const itemMatch = findItemMatch(normalized, items);
  const qtyMatch = findQuantity(normalized);
  let supplierMatch = findSupplier(normalized, suppliers);
  let supplierRaw = supplierMatch ? supplierMatch.raw : null;

  if (!supplierMatch) {
    const guessed = guessSupplierFromRemainder(normalized, itemMatch, qtyMatch);
    if (guessed) supplierRaw = guessed;
  }

  return {
    item: itemMatch ? itemMatch.item : null,
    quantity: qtyMatch ? qtyMatch.quantity : null,
    unit: (qtyMatch && qtyMatch.unit) || (itemMatch ? itemMatch.item.unit : null),
    supplier: supplierMatch ? supplierMatch.supplier : null,
    supplierRaw,
  };
}

module.exports = { parseMessage, findItemMatch, findQuantity, toHalfWidthDigits, UNIT_WORDS };
