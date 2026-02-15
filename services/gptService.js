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

// =========================
// CONVERSATIONAL GPT: Handle general messages
// =========================
async function getConversationalResponse(userMessage, context = {}) {
  const systemPrompt = `Kamu adalah asisten toko Ban888 Auto Parts yang ramah dan membantu.
Toko ini menjual: ban motor, lampu kendaraan, oli mesin, dan cat kendaraan.

PANDUAN RESPONS:
- Jika user tanya produk/harga/stock: arahkan ke menu dengan ketik "katalog" atau "menu"
- Jika user tanya cara order: jelaskan singkat bisa pilih produk dari katalog
- Jika user tanya lokasi/kontak: WhatsApp 081273574202, Alamat: Jl. Ikan Nila V No. 30, Bumi Waras, Bandar Lampung
- Jika user mau beli/order sesuatu tapi tidak spesifik: tanya lebih detail atau arahkan ke katalog
- Jika user ngobrol biasa/basa-basi: jawab singkat ramah, lalu tawarkan bantuan produk
- Selalu ramah, menggunakan bahasa Indonesia yang natural
- Maksimal 2-3 kalimat, jangan terlalu panjang
- Gunakan emoji sesekali untuk friendly

CARA CEPAT yang bisa user lakukan:
- Ketik "katalog" atau "menu" untuk lihat semua kategori
- Ketik "ban" untuk pilih ukuran ban atau langsung ketik ukuran misal "90/90-14"
- Ketik "lampu" untuk pilih jenis lampu atau langsung type misal "H4"
- Ketik "oli" untuk pilih ukuran pack
- Ketik "cat" lalu sebutkan warna yang dicari`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage }
      ],
      max_tokens: 150,
      temperature: 0.7,
    });

    return response.choices[0].message.content.trim();
  } catch (error) {
    console.error("Error getting conversational response:", error?.message || error);
    return "Maaf, saya kurang mengerti. Ketik 'katalog' untuk lihat produk atau 'bantuan' untuk panduan lengkap! 😊";
  }
}

// =========================
// BAN: GPT ukuran ban recommendations (standard + upsize)
// =========================
async function getBanRecommendationsForMotor(motor, posisi) {
  const prompt = `Berikan ukuran ban untuk motor ${motor} pada posisi ${posisi}.

1. Ukuran standar pabrikan
2. Satu opsi upsize

Jawab dengan format:
Standar: XX/XX-XX
Upsize: XX/XX-XX

Jangan kasih penjelasan lain.`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "Kamu adalah asisten yang memberikan rekomendasi ukuran ban motor. Berikan ukuran standar dan satu upsize. Format: Standar: XX/XX-XX, Upsize: XX/XX-XX",
        },
        { role: "user", content: prompt },
      ],
      max_tokens: 50,
      temperature: 0.5,
    });

    const content = response.choices[0].message.content.trim();
    
    // Extract sizes from the response
    const sizeMatches = content.match(/\d{2,3}\/\d{2,3}-\d{2}/g) || [];
    
    if (sizeMatches.length >= 2) {
      return {
        standard: { size: sizeMatches[0], label: "📏 Standar" },
        upsize: { size: sizeMatches[1], label: "⬆️ Upsize" },
        sizes: [sizeMatches[0], sizeMatches[1]]
      };
    } else if (sizeMatches.length === 1) {
      // If only one size found, use it as standard and generate upsize
      const parts = sizeMatches[0].split('-');
      const sizePart = parts[0]; // e.g., "80/90"
      const ring = parts[1]; // e.g., "14"
      const [width, aspect] = sizePart.split('/').map(Number);
      const upsizeWidth = width + 10;
      const upsizeSize = `${upsizeWidth}/${aspect}-${ring}`;
      
      return {
        standard: { size: sizeMatches[0], label: "📏 Standar" },
        upsize: { size: upsizeSize, label: "⬆️ Upsize" },
        sizes: [sizeMatches[0], upsizeSize]
      };
    }
    
    throw new Error("No sizes found in response");
  } catch (error) {
    console.error("Error fetching ban recommendations:", error?.message || error);
    
    // Fallback: return generic recommendations
    const standardSize = posisi?.toLowerCase().includes("depan") ? "70/90-14" : "80/90-14";
    const upsizeSize = posisi?.toLowerCase().includes("depan") ? "80/90-14" : "90/90-14";
    
    return {
      standard: { size: standardSize, label: "📏 Standar" },
      upsize: { size: upsizeSize, label: "⬆️ Upsize" },
      sizes: [standardSize, upsizeSize]
    };
  }
}

// =========================
// EXTRACT BAN SIZE FROM TEXT
// =========================
async function extractBanSizeFromText(text) {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `Kamu adalah asisten yang mengekstrak ukuran ban motor dari teks.
Tugas: Cari ukuran ban dalam format angka/angka (contoh: 80/90, 70/90, 100/80).
Jawab HANYA dengan ukuran ban yang ditemukan, tanpa teks lain.
Jika ada ring size (contoh: 80/90-14), sertakan juga.
Jika tidak ada ukuran ban, jawab: NONE`
        },
        { role: "user", content: text }
      ],
      max_tokens: 20,
      temperature: 0.3,
    });

    const result = response.choices[0].message.content.trim().toUpperCase();
    if (result === "NONE" || result === "" || result.length > 15) {
      return null;
    }
    
    // Validate it looks like a tire size
    if (/\d{2,3}\s*\/\s*\d{2,3}/.test(result)) {
      return result.replace(/\s+/g, ""); // Remove spaces
    }
    
    return null;
  } catch (error) {
    console.error("Error extracting ban size:", error?.message || error);
    return null;
  }
}

// =========================
// EXTRACT RING SIZE FROM TEXT
// =========================
async function extractRingSizeFromText(text) {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `Ekstrak angka ukuran ring ban dari teks (contoh: 14, 17, 10, 12).
Jawab HANYA dengan angka 2 digit. Jika tidak ada, jawab: NONE`
        },
        { role: "user", content: text }
      ],
      max_tokens: 10,
      temperature: 0.2,
    });

    const result = response.choices[0].message.content.trim();
    if (result === "NONE" || result === "") {
      return null;
    }
    
    // Validate it's a 2-digit number
    if (/^\d{2}$/.test(result)) {
      return result;
    }
    
    return null;
  } catch (error) {
    console.error("Error extracting ring size:", error?.message || error);
    return null;
  }
}

// =========================
// CHECK IF TEXT IS BAN-RELATED
// =========================
async function isBanRelated(text) {
  const normalized = String(text || "").toLowerCase().trim();
  
  // Quick check: obvious tire-related keywords
  const tireKeywords = [
    /\bb+a+n+\b/i,         // "ban" with repeatable b, a, or n only (ban, bannnn, baaan) - excludes banci, bantai, ceban, etc.
    /\bban\s+motor\b/i,    // "ban motor"
    /\bban\s+depan\b/i,    // "ban depan"
    /\bban\s+belakang\b/i, // "ban belakang"
    /\btire\b/i,
    /\btyre\b/i,
    /\bukuran\s+ban\b/i,
    /\bring\s+\d{2}\b/i,   // ring 14, ring 17
    /\btubeless\b/i,
    /\d{2,3}\s*\/\s*\d{2,3}/,  // tire size pattern like 80/90
    /\d{2,3}\s*\/\s*\d{2,3}\s*-\s*\d{2}/,  // complete tire size 80/90-14
    /\baspira\b|\bfdr\b|\bcorsa\b|\birc\b|\bpirelli\b|\bmichelin\b|\bdunlop\b|\bswallow\b/i,  // tire brands
  ];
  
  // If any keyword matches, it's definitely ban-related
  if (tireKeywords.some(regex => regex.test(normalized))) {
    return true;
  }
  
  // Use GPT for more nuanced questions
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `Tentukan apakah teks berikut berhubungan dengan ban motor atau tidak.

Ban motor termasuk:
- Pertanyaan tentang ban kendaraan (contoh: "ada ban?", "jual ban?", "cari ban")
- Ukuran ban (80/90-14, 70/90, dll)
- Ring ban (ring 14, ring 17)
- Merk ban (Aspira, FDR, Corsa, IRC, dll)
- Kata "tire" atau "tyre"
- Pertanyaan tentang harga/stock ban motor
- Motor type untuk mencari ban (Mio, Beat, Vario)

Bukan ban motor (kata-kata yang kebetulan mengandung "ban" tapi tidak ada hubungannya):
- Kata-kata seperti: banci, bantai, ceban, bangsat, bangun, bandar, bantu, bantal, bandung
- Oli, pelumas, engine oil
- Lampu (headlight, tail light, H4, LED)
- Cat, paint, warna cat
- Topik lain yang tidak ada hubungannya dengan ban kendaraan

Jawab HANYA: YES jika berhubungan dengan ban motor/kendaraan.
Jawab HANYA: NO jika tidak berhubungan dengan ban motor.`
        },
        { role: "user", content: text }
      ],
      max_tokens: 5,
      temperature: 0.1,
    });

    const result = response.choices[0].message.content.trim().toUpperCase();
    return result === "YES";
  } catch (error) {
    console.error("Error checking if ban-related:", error?.message || error);
    return false; // Default to not related if error
  }
}

module.exports = {
  getUkuranBanByMotor,
  matchCatProductsByColor,
  getConversationalResponse,
  getBanRecommendationsForMotor,
  extractBanSizeFromText,
  extractRingSizeFromText,
  isBanRelated,
};
