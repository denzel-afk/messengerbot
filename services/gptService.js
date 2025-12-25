// services/gptService.js
const { OpenAI } = require("openai");
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// =========================
// BAN: GPT ukuran ban (tetap)
// =========================
async function getUkuranBanByMotor(motor, posisi) {
  const prompt = `Berikan ukuran ban motor untuk motor ${motor} pada posisi ${posisi}. Jawab dengan format: "Ukuran ban motor ${motor} pada posisi ${posisi} adalah [ukuran ban]."`;
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "Kamu adalah asisten yang membantu memberikan informasi ukuran ban motor.",
        },
        { role: "user", content: prompt },
      ],
      max_tokens: 50,
      temperature: 0.7,
    });

    return response.choices[0].message.content.trim();
  } catch (error) {
    console.error("Error fetching ukuran ban:", error?.message || error);
    throw new Error("Gagal mendapatkan ukuran ban motor.");
  }
}

// =========================
// CAT: matcher (NO GPT, reliable)
// =========================
function normalizeName(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[`'"]/g, " ")
    .replace(/[*_]/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function colorKeywords(userColorRaw) {
  const c = normalizeName(userColorRaw);
  const out = [];
  const push = (...xs) => xs.forEach((x) => out.push(x));

  // map warna Indo ↔ English + variants umum
  if (/(biru|blue)/.test(c))
    push(
      "biru",
      "blue",
      "navy",
      "dark blue",
      "light blue",
      "sky blue",
      "indigo",
      "cyan",
      "aqua",
      "teal",
      "tosca",
      "azure",
      "ocean",
      "royal",
      "sapphire"
    );

  if (/(merah|red)/.test(c))
    push("merah", "red", "scarlet", "crimson", "chili", "maroon", "burgundy");

  if (/(hijau|green)/.test(c))
    push("hijau", "green", "lime", "olive", "mint", "emerald", "tosca");

  if (/(kuning|yellow)/.test(c))
    push("kuning", "yellow", "gold", "amber", "mustard");

  if (/(hitam|black)/.test(c)) push("hitam", "black");
  if (/(putih|white)/.test(c)) push("putih", "white", "ivory", "pearl");

  if (/(abu|grey|gray)/.test(c))
    push("abu", "grey", "gray", "gunmetal", "graphite", "slate", "nardo");

  if (/(silver|perak)/.test(c))
    push("silver", "perak", "alu silver", "metallic");

  if (/(coklat|brown)/.test(c))
    push("coklat", "brown", "bronze", "coffee", "chocolate");

  if (/(orange|jingga)/.test(c)) push("orange", "jingga", "tangerine");
  if (/(ungu|purple|violet)/.test(c)) push("ungu", "purple", "violet", "lilac");
  if (/(pink|merah muda|rose|magenta)/.test(c))
    push("pink", "rose", "magenta", "fuchsia");

  // always include tokens user ketik
  c.split(" ").forEach((t) => t && out.push(t));

  // uniq
  return [...new Set(out.map((x) => normalizeName(x)).filter(Boolean))].slice(
    0,
    15
  );
}

function scoreByKeywords(productName, keywords) {
  const n = normalizeName(productName);
  let score = 0;

  for (const k of keywords) {
    if (!k) continue;
    if (n.includes(k)) {
      score += 20;
      // boost whole-word-ish
      const re = new RegExp(
        `\\b${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
        "i"
      );
      if (re.test(n)) score += 10;
    }
  }

  // boosts
  if (n.includes("metallic") && keywords.includes("metallic")) score += 10;
  if (
    n.includes("doff") &&
    (keywords.includes("doff") || keywords.includes("matte"))
  )
    score += 8;
  if (
    n.includes("matte") &&
    (keywords.includes("matte") || keywords.includes("doff"))
  )
    score += 8;

  return score;
}

/**
 * @param {string} userColor
 * @param {Array<{id:string,name:string,brand?:string}>} catProducts
 * @param {number} maxReturn
 * @returns {{keywords:string[], matches:Array<{id:string,score:number,reason:string}>}}
 */
async function matchCatProductsByColor(userColor, catProducts, maxReturn = 10) {
  const keywords = colorKeywords(userColor);

  const list = (catProducts || [])
    .map((p) => ({
      id: String(p.id || p.ID || p.kode || p.KODE || "").trim(),
      name: String(p.name || p.NAMA || p.nama || "").trim(),
      brand: String(p.brand || p.MERK || p.merk || "").trim(),
    }))
    .filter((p) => p.id && p.name);

  const scored = list
    .map((p) => ({
      ...p,
      score: scoreByKeywords(p.name, keywords),
    }))
    .filter((p) => p.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxReturn);

  return {
    keywords,
    matches: scored.map((p) => ({
      id: p.id,
      score: p.score,
      reason: `matched: ${keywords.slice(0, 6).join(", ")}`,
    })),
  };
}

module.exports = {
  getUkuranBanByMotor,
  matchCatProductsByColor,
};
