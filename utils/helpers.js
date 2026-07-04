// Address the user by name once known, falling back to "juragan"
function addressName(session) {
  const name = session && session.userName;
  return name ? `kak ${name}` : "juragan";
}

// Pull a name out of a casual reply like "Dia budi" or "nama saya Budi Santoso"
function extractUserName(text) {
  let t = String(text || "").trim();
  if (!t) return "";

  const fillerPrefixes = [
    /^nama\s+(saya|aku|gue|gw|ku)\s+/i,
    /^namaku\s+/i,
    /^panggil\s+(saya|aku|gue|gw)?\s*/i,
    /^perkenalkan\s+/i,
    /^kenalin\s+/i,
    /^saya\s+/i,
    /^aku\s+/i,
    /^gue\s+/i,
    /^gw\s+/i,
    /^ini\s+/i,
    /^itu\s+/i,
    /^dia\s+/i,
  ];

  let changed = true;
  while (changed) {
    changed = false;
    for (const re of fillerPrefixes) {
      const stripped = t.replace(re, "").trim();
      if (stripped !== t) {
        t = stripped;
        changed = true;
      }
    }
  }

  t = t.replace(/[.,!?]+$/g, "").trim();
  if (!t) return "";

  return t
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

// Interpret a free-text reply to "Tubeless atau tidak tubeless?"
function normalizeTubelessAnswer(text) {
  const t = String(text || "").toLowerCase();
  if (!/tub/.test(t)) return null;
  const isNegative = /\b(non|tidak|bukan|ga|gak|nggak|enggak)\b/.test(t);
  return isNegative ? "non_tubeless" : "tubeless";
}

// Match a product's TYPE BAN cell against the user's tubeless preference
function matchesTubelessType(typeBanValue, wanted) {
  const v = String(typeBanValue || "").toLowerCase();
  if (!v) return false;
  const isTubeless = /tub/.test(v) && !/\b(non|tidak|bukan)\b/.test(v);
  return wanted === "tubeless" ? isTubeless : !isTubeless;
}

module.exports = {
  addressName,
  extractUserName,
  normalizeTubelessAnswer,
  matchesTubelessType,
};
