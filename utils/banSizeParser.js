function looksLikeCompleteBanSize(s) {
  return /^\d{2,3}\s*\/\s*\d{2,3}\s*-\s*\d{2}$/i.test(String(s).trim());
}

function looksLikeIncompleteBanSize(s) {
  return /^\d{2,3}\s*\/\s*\d{2,3}(\s*-\s*\d{2})?$/i.test(String(s).trim());
}

function parseBanSize(s) {
  const normalized = String(s).trim().replace(/\s+/g, "");
  const match = normalized.match(/^(\d{2,3}\/\d{2,3})(-(\d{2}))?$/);
  if (match) {
    return [match[1], match[3] || null];
  }
  return [null, null];
}

function normalizeBanSize(s) {
  return String(s)
    .trim()
    .replace(/\s+/g, "")
    .replace(/[/-]/g, (m) => (m === "/" ? "/" : "-"));
}

function extractRingSize(s) {
  const match = String(s).match(/(\d{2})/);
  return match ? match[1] : null;
}

function encodeUkuranForPayload(u) {
  return String(u).replace(/\//g, "_").replace(/-/g, "~");
}

function decodeUkuranFromPayload(u) {
  return String(u).replace(/_/g, "/").replace(/~/g, "-");
}

module.exports = {
  looksLikeCompleteBanSize,
  looksLikeIncompleteBanSize,
  parseBanSize,
  normalizeBanSize,
  extractRingSize,
  encodeUkuranForPayload,
  decodeUkuranFromPayload,
};
