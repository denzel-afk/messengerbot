const sheetsService = require("../services/sheetsService");
const facebookAPI = require("../services/facebookAPI");
const gptService = require("../services/gptService");
const { addressName, matchesTubelessType } = require("../utils/helpers");
const { looksLikeCompleteBanSize, normalizeBanSize } = require("../utils/banSizeParser");

function getWhatsAppLink() {
  const number = process.env.SUPPORT_WHATSAPP || "081273574202";
  const intl = number.startsWith("0") ? "62" + number.substring(1) : number;
  return `https://wa.me/${intl}`;
}

// If the user already names both a specific brand and a specific size in
// one message (e.g. "Corsa 80/90-14"), skip the guided flow entirely and
// answer immediately with the product's photo + price. Returns true if it
// handled the message.
async function tryDirectBanAnswer(senderId, session, rawText) {
  let size = null;
  if (looksLikeCompleteBanSize(rawText)) {
    size = normalizeBanSize(rawText);
  } else {
    const sizeMatch = rawText.match(/\d{2,3}\s*\/\s*\d{2,3}\s*-\s*\d{2}/);
    if (sizeMatch) size = normalizeBanSize(sizeMatch[0]);
  }
  if (!size) return false;

  const sameSizeProducts = await sheetsService.getProductsByUkuranBan(size);
  if (sameSizeProducts.length === 0) return false;

  const textLower = rawText.toLowerCase();
  const knownBrands = [
    ...new Set(
      sameSizeProducts.map((p) => String(p.brand || "").toLowerCase().trim()),
    ),
  ].filter(Boolean);
  const matchedBrand = knownBrands.find((b) => textLower.includes(b));
  if (!matchedBrand) return false;

  const matches = sameSizeProducts.filter(
    (p) => String(p.brand || "").toLowerCase().trim() === matchedBrand,
  );
  if (matches.length === 0) return false;

  await facebookAPI.sendTypingOn(senderId);

  const elements = matches.slice(0, 10).map((product) => {
    const price = product.harga_pasang ? product.harga_pasang * 1000 : null;
    return {
      title: product.name,
      subtitle: `${product.brand}\n${product.specifications}${product.type_ban ? " - " + product.type_ban : ""}${price ? `\nHarga Pasang: Rp ${price.toLocaleString("id-ID")}` : ""}`,
      image_url:
        product.image_url ||
        "https://via.placeholder.com/300x300.png?text=Ban",
    };
  });

  await facebookAPI.sendCarousel(senderId, elements);
  await facebookAPI.sendTextMessage(
    senderId,
    `🛒 Untuk ketersediaan barang klik link di bawah ini:\n📞 WhatsApp: ${getWhatsAppLink()}\n\nLangsung gas aja ${addressName(session)}, ke 88Motor, klik link untuk share lokasi:\n📍 https://maps.app.goo.gl/tKmS8ZuXCbhLvcZN6?g_st=ac`,
  );
  await facebookAPI.sendTextMessage(
    senderId,
    `Masih ada lagi yg bella bisa bantu, ${addressName(session)}?`,
    [
      { content_type: "text", title: "🔍 Liat Lagi", payload: "LIAT_LAGI" },
      { content_type: "text", title: "✅ Selesai", payload: "SELESAI" },
    ],
  );

  session.state = "after_price_check";
  return true;
}

async function askForRingSize(senderId, session) {
  const banSize = session.banSize;

  try {
    const gptRecommendedRings =
      await gptService.getRecommendedRingSizes(banSize);
    const allBanProducts = await sheetsService.getProductsByCategory("ban");
    const availableRings = new Set();

    allBanProducts.forEach((product) => {
      const spec = String(product.specifications || product.SPESIFIKASI || "");
      if (spec.includes(banSize)) {
        const match = spec.match(
          new RegExp(`${banSize.replace(/\//g, "\\/")}-(\\d{2})`),
        );
        if (match) {
          availableRings.add(match[1]);
        }
      }
    });

    const availableRingsArray = Array.from(availableRings).sort();
    const priorityRings = gptRecommendedRings.filter((r) =>
      availableRingsArray.includes(r),
    );
    const otherRings = availableRingsArray.filter(
      (r) => !priorityRings.includes(r),
    );
    const displayRings = [...priorityRings, ...otherRings].slice(0, 6);

    if (displayRings.length === 0) {
      await facebookAPI.sendTextMessage(
        senderId,
        `Maaf, Bella tidak menemukan ring untuk ban ${banSize} 😔\n\nCoba kasih tau tipe motor aja yuk! Nanti Bella bantu carikan.\n\nContoh: Yamaha Mio, Honda Beat, Suzuki Nex`,
      );
      session.state = null;
      session.banSize = null;
      session.banRing = null;
      session.banUkuran = null;
      return;
    }

    const gptRingText =
      gptRecommendedRings.length > 0
        ? `\n\nBiasanya untuk ${banSize}: ring ${gptRecommendedRings.join(" atau ")}`
        : "";

    const quickReplies = displayRings.map((ring) => ({
      content_type: "text",
      title: `Ring ${ring}`,
      payload: `RING_${ring}`,
    }));

    await facebookAPI.sendTextMessage(
      senderId,
      `Ring berapa, ${addressName(session)}?${gptRingText}`,
      quickReplies,
    );
  } catch (error) {
    console.error("Error in askForRingSize:", error);
    await facebookAPI.sendTextMessage(
      senderId,
      `Ring berapa, ${addressName(session)}? Contoh: 14, 17`,
    );
  }
}

async function askForTubelessType(senderId, session) {
  const addr = addressName(session);
  await facebookAPI.sendTextMessage(
    senderId,
    `Baik ${addr}, ${addr} mau yg Tubeless atau tidak tubeless?`,
    [
      { content_type: "text", title: "Tubeless", payload: "TUBELESS_YES" },
      { content_type: "text", title: "Non-Tubeless", payload: "TUBELESS_NO" },
    ],
  );
}

function matchBanProducts(allBanProducts, session) {
  const searchQuery = session.banSearchQuery || session.banUkuran;
  const brandPattern = session.banBrandPattern;

  return allBanProducts.filter((product) => {
    const spec = String(
      product.specifications || product.SPESIFIKASI || "",
    ).toLowerCase();
    const brand = String(product.brand || product.MERK || "").toLowerCase();
    const pattern = String(
      product.pattern || product.PATTERN || "",
    ).toLowerCase();
    const name = String(product.name || product.NAMA || "").toLowerCase();

    const searchLower = String(searchQuery).toLowerCase().replace(/\s+/g, "");
    const isSizeSearch = searchLower.includes("/") || searchLower.includes("-");
    const specMatch = spec.replace(/\s+/g, "").includes(searchLower);

    let brandMatch = false;
    let patternMatch = false;
    let nameMatch = false;

    if (!isSizeSearch) {
      brandMatch = brand.includes(searchLower);
      patternMatch = pattern.includes(searchLower);
      nameMatch = name.includes(searchLower);
    }

    const baseMatch = specMatch || brandMatch || patternMatch || nameMatch;

    if (brandPattern) {
      const brandPatternMatch =
        brand.includes(brandPattern) ||
        pattern.includes(brandPattern) ||
        name.includes(brandPattern);
      return baseMatch && brandPatternMatch;
    }

    return baseMatch;
  });
}

// Gate every fresh ukuran with the tubeless question, but only when that
// ukuran actually stocks both kinds — otherwise there's no real choice to
// make, so skip straight to the products. Reuse the answer if the ukuran
// hasn't changed since it was last asked (e.g. switching brand/page).
async function handleUkuranReady(senderId, session) {
  if (
    session.banTubeless &&
    session.banTubelessForUkuran === session.banUkuran
  ) {
    session.state = "show_products";
    await showBanProducts(senderId, session);
    return;
  }

  session.banTubeless = null;

  try {
    const allBanProducts = await sheetsService.getProductsByCategory("ban");
    const matched = matchBanProducts(allBanProducts, session);
    const hasTubeless = matched.some((p) =>
      matchesTubelessType(p.type_ban, "tubeless"),
    );
    const hasNonTubeless = matched.some((p) =>
      matchesTubelessType(p.type_ban, "non_tubeless"),
    );

    if (hasTubeless && hasNonTubeless) {
      session.state = "waiting_tubeless";
      await askForTubelessType(senderId, session);
      return;
    }
  } catch (error) {
    console.error("Error checking tubeless availability:", error);
  }

  session.banTubelessForUkuran = session.banUkuran;
  session.state = "show_products";
  await showBanProducts(senderId, session);
}

async function showBanProducts(senderId, session) {
  const ukuran = session.banUkuran;
  const searchQuery = session.banSearchQuery || ukuran;

  try {
    await facebookAPI.sendTypingOn(senderId);

    if (session.state !== "after_products") {
      session.currentPage = 1;
    }

    const allBanProducts = await sheetsService.getProductsByCategory("ban");

    let matchedProducts;
    if (session.state === "after_products" && session.allProducts.length > 0) {
      matchedProducts = session.allProducts;
    } else {
      matchedProducts = matchBanProducts(allBanProducts, session);

      session.tubelessFallbackNotice = false;
      if (session.banTubeless) {
        const tubelessFiltered = matchedProducts.filter((p) =>
          matchesTubelessType(p.type_ban, session.banTubeless),
        );
        if (tubelessFiltered.length > 0) {
          matchedProducts = tubelessFiltered;
        } else if (matchedProducts.length > 0) {
          session.tubelessFallbackNotice = true;
        }
      }

      session.fullMatchedProducts = matchedProducts;

      const preferredOrder = ["maxxis", "irc", "fdr"];
      const preferredProducts = matchedProducts.filter((p) => {
        const brand = String(p.brand || p.MERK || "").toLowerCase();
        return preferredOrder.some((pref) => brand.includes(pref));
      });

      if (preferredProducts.length > 0) {
        session.allProducts = preferredProducts;
        session.onlyPreferredShown = true;
      } else {
        session.allProducts = matchedProducts;
        session.onlyPreferredShown = false;
      }
    }

    if (matchedProducts.length === 0) {
      await facebookAPI.sendTextMessage(
        senderId,
        `Maaf, Bella tidak menemukan ban ${searchQuery} 😔\n\nKetik ulang ukuran ban yang ${addressName(session)} cari atau ketik tipe motor.\n\nContoh: 80/90-14 atau Yamaha Mio`,
      );
      session.state = null;
      session.banSize = null;
      session.banRing = null;
      session.banUkuran = null;
      session.banBrandPattern = null;
      session.banSearchQuery = null;
      return;
    }

    const preferredOrder = ["maxxis", "irc", "fdr"];
    matchedProducts.sort((a, b) => {
      const aBrand = String(a.brand || a.MERK || "").toLowerCase();
      const bBrand = String(b.brand || b.MERK || "").toLowerCase();
      const aIdx = preferredOrder.findIndex((p) => aBrand.includes(p));
      const bIdx = preferredOrder.findIndex((p) => bBrand.includes(p));
      if (aIdx === -1 && bIdx === -1) return 0;
      if (aIdx === -1) return 1;
      if (bIdx === -1) return -1;
      return aIdx - bIdx;
    });

    const MAX_CAROUSEL_ITEMS = 10;
    session.currentPage = session.currentPage || 1;
    session.totalPages = Math.ceil(matchedProducts.length / MAX_CAROUSEL_ITEMS);

    const startIdx = (session.currentPage - 1) * MAX_CAROUSEL_ITEMS;
    const endIdx = startIdx + MAX_CAROUSEL_ITEMS;
    const productsToShow = matchedProducts.slice(startIdx, endIdx);

    let text = "";
    if (session.tubelessFallbackNotice && session.currentPage === 1) {
      const wanted =
        session.banTubeless === "tubeless" ? "Tubeless" : "Non-Tubeless";
      text += `⚠️ Maaf, tidak ada tipe ${wanted} untuk ukuran ini, Bella tampilkan semua tipe yang tersedia:\n\n`;
    }
    text += `📦 Halaman ${session.currentPage}/${session.totalPages}\n`;
    if (session.onlyPreferredShown) {
      text += `Menampilkan ${productsToShow.length} ban yang tersedia:\n\n`;
    } else {
      text += `Menampilkan ${productsToShow.length} dari ${session.allProducts.length} ban yang tersedia:\n\n`;
    }

    await facebookAPI.sendTextMessage(senderId, text);

    const elements = productsToShow.map((product) => ({
      title: product.name || product.NAMA,
      subtitle: `${product.brand || product.MERK || ""}\n${product.specifications || product.SPESIFIKASI || ""}${product.type_ban ? " - " + product.type_ban : ""}`,
      image_url:
        product.image_url ||
        product.IMAGE_URL ||
        "https://via.placeholder.com/300x300.png?text=Ban",
      buttons: [
        {
          type: "postback",
          title: "💰 Cek Harga?",
          payload: `CEK_HARGA_${Buffer.from(
            JSON.stringify({
              name: product.name || product.NAMA,
              harga_jual: product.harga_jual || product.HARGA_JUAL,
              harga_pasang: product.harga_pasang || product.HARGA_PASANG,
              brand: product.brand || product.MERK,
              spec: product.specifications || product.SPESIFIKASI,
            }),
          ).toString("base64")}`,
        },
      ],
    }));

    await facebookAPI.sendCarousel(senderId, elements);

    await facebookAPI.sendTextMessage(
      senderId,
      `🛒 Untuk ketersediaan barang klik link di bawah ini:\n📞 WhatsApp: ${getWhatsAppLink()}\n\nLangsung gas aja ${addressName(session)} ke 88Motor, klik link untuk ke lokasi:\n📍 https://maps.app.goo.gl/tKmS8ZuXCbhLvcZN6?g_st=ac`,
    );

    if (session.motorType) {
      const quickReplies = [];
      if (session.currentPage > 1) {
        quickReplies.push({
          content_type: "text",
          title: "◀️ Sebelumnya",
          payload: "PREV_PAGE",
        });
      }
      if (session.currentPage < session.totalPages) {
        quickReplies.push({
          content_type: "text",
          title: "▶️ Selanjutnya",
          payload: "NEXT_PAGE",
        });
      }

      if (session.motorPosition === "depan") {
        quickReplies.push(
          {
            content_type: "text",
            title: "🔽 Lihat Belakang",
            payload: "MOTOR_BELAKANG_NOW",
          },
          { content_type: "text", title: "✅ Selesai", payload: "SELESAI" },
        );
        await facebookAPI.sendTextMessage(
          senderId,
          "Udah liat ban depan. Mau liat yang belakang untuk motor yang sama atau masih mau lihat2 ban depan (bisa klik selanjutnya)?",
          quickReplies,
        );
      } else {
        quickReplies.push(
          {
            content_type: "text",
            title: "🔼 Lihat Depan",
            payload: "MOTOR_DEPAN_LAGI",
          },
          { content_type: "text", title: "✅ Selesai", payload: "SELESAI" },
        );
        await facebookAPI.sendTextMessage(
          senderId,
          "Udah liat ban belakang. Mau liat depannya atau cari merk lain (klik selanjutnya)?",
          quickReplies,
        );
      }
    } else {
      const quickReplies = [];
      if (session.currentPage > 1) {
        quickReplies.push({
          content_type: "text",
          title: "◀️ Sebelumnya",
          payload: "PREV_PAGE",
        });
      }
      if (session.currentPage < session.totalPages) {
        quickReplies.push({
          content_type: "text",
          title: "▶️ Selanjutnya",
          payload: "NEXT_PAGE",
        });
      }
      quickReplies.push(
        {
          content_type: "text",
          title: "🔍 Liat Lagi",
          payload: "LIAT_LAGI",
        },
        { content_type: "text", title: "✅ Selesai", payload: "SELESAI" },
        { content_type: "text", title: "🔁 Merk lain", payload: "OTHER_MERK" },
      );

      if (session.onlyPreferredShown) {
        await facebookAPI.sendTextMessage(
          senderId,
          `Tampilkan merk lain? ${addressName(session)} boleh ketik nama merk yang diinginkan, atau pilih 'Liat Lagi' untuk cari sesuatu yang lain.`,
        );
      }

      await facebookAPI.sendTextMessage(
        senderId,
        `Masih ada lagi yg bella bisa bantu, ${addressName(session)}?`,
        quickReplies,
      );
    }

    session.state = "after_products";
  } catch (error) {
    console.error("❌ Error in showBanProducts:");
    console.error("Error name:", error?.name);
    console.error("Error message:", error?.message);
    console.error("Error stack:", error?.stack);
    console.error("Session data:", {
      ukuran: session.banUkuran,
      searchQuery: session.banSearchQuery,
      brandPattern: session.banBrandPattern,
    });
    session.state = null;
    session.banSize = null;
    session.banRing = null;
    session.banUkuran = null;
    session.banBrandPattern = null;
    session.banSearchQuery = null;
    await facebookAPI.sendTextMessage(
      senderId,
      `Maaf, ada error saat menampilkan produk 😔\n\nKetik ulang ukuran ban atau tipe motor yang ${addressName(session)} cari.`,
    );
  }
}

module.exports = {
  askForRingSize,
  showBanProducts,
  askForTubelessType,
  handleUkuranReady,
  tryDirectBanAnswer,
};
