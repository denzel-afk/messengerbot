// MessageHandler.js
const sheetsService = require("../services/sheetsService");
const facebookAPI = require("../services/facebookAPI");
const gptService = require("../services/gptService");

class MessageHandler {
  // Remove sessions inactive for over 24 hours
  cleanupSessions() {
    const now = Date.now();
    const timeout = 24 * 60 * 60 * 1000; // 24 hours
    let removed = 0;
    for (const [userId, session] of this.userSessions.entries()) {
      if (!session.lastActive || now - session.lastActive > timeout) {
        this.userSessions.delete(userId);
        removed++;
      }
    }
    if (removed > 0) {
      console.log(`[SessionCleanup] Removed ${removed} inactive sessions.`);
    }
  }

  constructor() {
    this.userSessions = new Map();
  }

  // =========================
  // ENTRYPOINT
  // =========================
  async handleMessage(senderId, messageData) {
    try {
      console.log(`Message from ${senderId}:`, messageData);
      const session = await this.getUserSession(senderId);

      if (messageData.quick_reply) {
        await this.handleQuickReply(
          senderId,
          messageData.quick_reply.payload,
          session
        );
        return;
      }

      if (messageData.text) {
        await this.handleTextMessage(senderId, messageData.text, session);
        return;
      }

      if (messageData.attachments) {
        await this.handleAttachment(senderId, messageData.attachments, session);
        return;
      }

      await this.sendTextMessage(
        senderId,
        "Maaf, saya tidak mengerti format pesan tersebut 😅"
      );
    } catch (error) {
      console.error("Error handling message:", error.message);
      await this.sendTextMessage(senderId, "Maaf, ada error. Coba lagi ya! 🙏");
    }
  }

  // =========================
  // TEXT
  // =========================
  async handleTextMessage(senderId, text, session) {
    const textLower = String(text || "")
      .toLowerCase()
      .trim();

    // BAN: start size flow
    if (textLower === "ban") {
      await this.sendUkuranBanMenu(senderId, 1, session);
      return;
    }

    // CAT: start color flow
    if (textLower === "cat") {
      session.state = "cat_ask_color";
      session.catColorQuery = null;
      session.catLastResults = null;
      await this.sendTextMessage(
        senderId,
        "🎨 Suka warna apa, juragan?\n(contoh: merah, biru, blue, silver)"
      );
      return;
    }

    // CAT: user answered color
    if (session.state === "cat_ask_color") {
      const colorQuery = String(text || "").trim();
      session.catColorQuery = colorQuery;
      session.state = "cat_show_color";
      await this.sendCatByColor(senderId, session, colorQuery, 1);
      return;
    }

    // user types ukuran directly
    if (this.looksLikeUkuranBan(textLower)) {
      const ukuran = String(text || "").trim();
      session.banUkuran = ukuran;
      session.state = "ban_show_ukuran";
      await this.sendBanByUkuran(senderId, session, ukuran, 1);
      return;
    }

    // "Tidak Yakin" flow: user replies motor name
    if (session.state === "ban_tanya_motor") {
      session.banMotorQuery = String(text || "").trim();
      session.state = "ban_tanya_posisi";
      await this.sendTextMessage(senderId, "Ban depan atau belakang?");
      return;
    }

    // Setelah user jawab posisi:
    if (session.state === "ban_tanya_posisi") {
      session.banPosisi = String(text || "").trim();
      // Panggil GPT
      let ukuran = await gptService.getUkuranBanByMotor(
        session.banMotorQuery,
        session.banPosisi
      );
      // Extract tire size pattern (e.g. 110/70-13) from GPT response
      const match = ukuran.match(/(\d{2,3}\/\d{2,3}-\d{2,3})/);
      if (match) {
        ukuran = match[1];
      }
      session.banUkuran = ukuran;
      session.state = "ban_konfirmasi_ukuran";
      await this.sendTextMessage(
        senderId,
        `Ukuran standar untuk ${session.banMotorQuery} (${session.banPosisi}): ${ukuran}\nMau cari ban ukuran ini? (balas "iya" untuk lanjut, atau ketik ukuran lain)`
      );
      return;
    }

    // Konfirmasi setelah rekomendasi ukuran
    if (session.state === "ban_konfirmasi_ukuran") {
      if (
        ["iya", "ya", "oke", "ok", "y", "sip", "lanjut"].includes(textLower)
      ) {
        session.state = "ban_show_ukuran";
        await this.sendBanByUkuran(senderId, session, session.banUkuran, 1);
        return;
      }
      if (this.looksLikeUkuranBan(textLower)) {
        const ukuran = String(text || "").trim();
        session.banUkuran = ukuran;
        session.state = "ban_show_ukuran";
        await this.sendBanByUkuran(senderId, session, ukuran, 1);
        return;
      }
      await this.sendTextMessage(
        senderId,
        `Balas "iya" untuk cari ban ukuran ${session.banUkuran}, atau ketik ukuran lain.`
      );
      return;
    }

    // selesai
    if (textLower === "selesai") {
      if (session.selectedProducts && session.selectedProducts.length > 0) {
        let summary = "📋 **Ringkasan Pilihanmu:**\n";
        session.selectedProducts.forEach((p, i) => {
          summary += `${i + 1}. ${p.name} (${p.brand || "-"})\n`;
        });
        summary += `\nSilakan screenshot daftar ini dan hubungi kami:\n☎️ WhatsApp: ${
          process.env.SUPPORT_WHATSAPP || "081273574202"
        }\n📍 Alamat: Jl. Ikan Nila V No. 30, Bumi Waras, Bandar Lampung, Lampung`;
        await this.sendTextMessage(senderId, summary);
        session.selectedProducts = [];
      } else {
        await this.sendTextMessage(
          senderId,
          "Kamu belum memilih produk apapun. Silakan pilih produk terlebih dahulu."
        );
      }
      return;
    }

    // General commands
    if (["katalog", "menu", "produk", "categories"].includes(textLower)) {
      await this.sendCategoryMenu(senderId);
      return;
    }

    if (["lampu", "oli"].includes(textLower)) {
      await this.sendCategoryProducts(senderId, textLower);
      return;
    }

    if (textLower === "bantuan" || textLower === "help") {
      await this.sendHelpMessage(senderId);
      return;
    }

    if (textLower.startsWith("cari ") || textLower.startsWith("search ")) {
      const searchTerm = String(text || "").substring(5);
      await this.searchAndSendProducts(senderId, searchTerm);
      return;
    }

    await this.searchAndSendProducts(senderId, text);
  }

  // =========================
  // QUICK REPLY
  // =========================
  async handleQuickReply(senderId, payload, session) {
    payload = String(payload || "");
    console.log(`🔘 Quick reply from ${senderId}: ${payload}`);

    // ---------- CAT: pagination ----------
    if (payload.startsWith("CAT_COLOR_PAGE_")) {
      // CAT_COLOR_PAGE_<encodedColor>_<page>
      const rest = payload.replace("CAT_COLOR_PAGE_", "");
      const parts = rest.split("_");
      const page = parseInt(parts[parts.length - 1], 10) || 1;
      const encodedColor = parts.slice(0, -1).join("_");
      const colorQuery = this.decodeTextPayload(encodedColor);

      session.state = "cat_show_color";
      session.catColorQuery = colorQuery;
      await this.sendCatByColor(senderId, session, colorQuery, page);
      return;
    }

    if (payload === "CAT_CHANGE_COLOR") {
      session.state = "cat_ask_color";
      session.catColorQuery = null;
      session.catLastResults = null;
      await this.sendTextMessage(
        senderId,
        "🎨 Oke! Suka warna apa, juragan?\n(contoh: merah, biru, blue, silver)"
      );
      return;
    }

    // ---------- BAN: PAGE SIZE MENU (MUST COME FIRST) ----------
    if (payload.startsWith("UKURAN_BAN_PAGE_")) {
      const page = parseInt(payload.replace("UKURAN_BAN_PAGE_", ""), 10) || 1;
      await this.sendUkuranBanMenu(senderId, page, session);
      return;
    }

    // ---------- BAN: PAGE PRODUCTS BY UKURAN ----------
    if (payload.startsWith("BAN_UKURAN_PAGE_")) {
      // BAN_UKURAN_PAGE_<encodedUkuran>_<page>
      const rest = payload.replace("BAN_UKURAN_PAGE_", "");
      const parts = rest.split("_");
      const page = parseInt(parts[parts.length - 1], 10) || 1;
      const encodedUkuran = parts.slice(0, -1).join("_");
      const ukuran = this.decodeUkuran(encodedUkuran);

      session.banUkuran = ukuran;
      session.state = "ban_show_ukuran";
      await this.sendBanByUkuran(senderId, session, ukuran, page);
      return;
    }

    // ---------- BAN: BACK TO UKURAN LIST ----------
    if (payload === "BAN_PILIH_UKURAN") {
      await this.sendUkuranBanMenu(senderId, 1, session);
      return;
    }

    // ---------- BAN: TIDAK YAKIN ----------
    if (payload === "UKURAN_BAN_TIDAK_YAKIN") {
      await this.sendTextMessage(
        senderId,
        "Oke, boleh beri tau motormu apa, juragan?"
      );
      session.state = "ban_tanya_motor";
      return;
    }

    // ---------- BAN: SELECT UKURAN ----------
    if (payload.startsWith("UKURAN_BAN_")) {
      const encoded = payload.replace("UKURAN_BAN_", "");
      const ukuran = this.decodeUkuran(encoded);

      session.banUkuran = ukuran;
      session.state = "ban_show_ukuran";
      await this.sendBanByUkuran(senderId, session, ukuran, 1);
      return;
    }

    // ---------- CATEGORY ----------
    if (payload.startsWith("CATEGORY_")) {
      const category = payload.replace("CATEGORY_", "").toLowerCase();
      session.currentCategory = category;

      if (category === "ban") {
        await this.sendUkuranBanMenu(senderId, 1, session);
        return;
      }

      // Untuk CAT: tampilkan menu merk cat dulu
      if (category === "cat") {
        try {
          const brands = await sheetsService.getBrandsByCategory("cat");
          if (!brands || brands.length === 0) {
            await this.sendTextMessage(
              senderId,
              "Maaf, data merk cat belum tersedia."
            );
            return;
          }
          const quickReplies = brands.slice(0, 11).map((brand) => ({
            content_type: "text",
            title: brand,
            payload: `CAT_BRAND_${brand
              .toUpperCase()
              .replace(/[^A-Z0-9]/g, "_")}`,
          }));
          await this.sendQuickReply(senderId, "Pilih merk cat:", quickReplies);
          session.state = "cat_ask_brand";
        } catch (err) {
          await this.sendTextMessage(
            senderId,
            "Maaf, gagal mengambil data merk cat."
          );
        }
        return;
      }
      // ---------- CAT: pilih merk ----------
      if (payload.startsWith("CAT_BRAND_")) {
        const brand = payload
          .replace("CAT_BRAND_", "")
          .replace(/_/g, " ")
          .trim();
        session.catBrand = brand;
        session.state = "cat_ask_color";
        session.catColorQuery = null;
        session.catLastResults = null;
        await this.sendTextMessage(
          senderId,
          `🎨 Suka warna apa untuk merk ${brand}?\n(contoh: merah, biru, blue, silver)`
        );
        return;
      }

      await this.sendBrandMenu(senderId, category, session);
      return;
    }

    // ---------- NAV ----------
    if (payload === "MAIN_MENU" || payload === "BACK_TO_CATEGORIES") {
      await this.sendCategoryMenu(senderId);
      return;
    }

    if (payload === "HELP") {
      await this.sendHelpMessage(senderId);
      return;
    }

    if (payload === "SEARCH_AGAIN") {
      await this.sendTextMessage(
        senderId,
        '🔍 Ketik nama produk yang ingin kamu cari:\n\n💡 **Contoh:**\n• "ban corsa"\n• "oli castrol"\n• "lampu LED"'
      );
      return;
    }

    // ---------- non-ban brand pagination etc ----------
    if (payload.startsWith("BRAND_PAGE_")) {
      const parts = payload.replace("BRAND_PAGE_", "").split("_");
      const category = parts[0].toLowerCase();
      const page = parseInt(parts[1], 10) || 1;
      session.currentCategory = category;
      await this.sendBrandMenu(senderId, category, session, page);
      return;
    }

    if (payload.startsWith("BRAND_")) {
      const parts = payload.replace("BRAND_", "").split("_");
      const category = parts[0].toLowerCase();
      const brand = parts.slice(1).join("_").replace(/_/g, " ");
      session.currentCategory = category;
      session.currentBrand = brand;
      await this.sendBrandProducts(senderId, category, brand, 1);
      return;
    }

    if (payload.startsWith("PRODUCT_PAGE_")) {
      const parts = payload.replace("PRODUCT_PAGE_", "").split("_");
      if (parts.length >= 3) {
        const category = parts[0].toLowerCase();
        const pageNum = parseInt(parts[parts.length - 1], 10) || 1;
        const brand = parts.slice(1, -1).join("_").replace(/_/g, " ");
        session.currentCategory = category;
        session.currentBrand = brand;
        await this.sendBrandProducts(senderId, category, brand, pageNum);
      }
      return;
    }

    if (payload.startsWith("SEARCH_")) {
      const searchTerm = payload.replace("SEARCH_", "");
      await this.searchAndSendProducts(senderId, searchTerm);
      return;
    }

    console.log("⚠️ Unknown quick reply payload:", payload);
  }

  // =========================
  // POSTBACK
  // =========================
  async handlePostback(senderId, postback) {
    const payload = String(postback?.payload || "");
    const session = await this.getUserSession(senderId);

    console.log(`🎯 Postback from ${senderId}: ${payload}`);

    if (payload.startsWith("ORDER_")) {
      const productId = payload.replace("ORDER_", "");
      await this.addProductToSelection(senderId, productId, session);
      return;
    }

    if (payload.startsWith("DETAIL_")) {
      await this.sendProductDetail(senderId, payload);
      return;
    }

    if (payload === "GET_STARTED") {
      await this.sendWelcomeMessage(senderId);
      await this.sendCategoryMenu(senderId);
      return;
    }

    if (payload.startsWith("CATEGORY_")) {
      const category = payload.replace("CATEGORY_", "").toLowerCase();
      session.currentCategory = category;

      if (category === "ban") {
        await this.sendUkuranBanMenu(senderId, 1, session);
        return;
      }

      if (category === "cat") {
        session.state = "cat_ask_color";
        session.catColorQuery = null;
        session.catLastResults = null;
        await this.sendTextMessage(
          senderId,
          "🎨 Suka warna apa, juragan?\n(contoh: merah, biru, blue, silver)"
        );
        return;
      }

      await this.sendBrandMenu(senderId, category, session);
      return;
    }
  }

  // =========================
  // CAT: SHOW PRODUCTS BY COLOR (GPT MATCH)
  // =========================
  async sendCatByColor(senderId, session, colorQuery, page = 1) {
    try {
      await this.sendTypingOn(senderId);

      const allCat = await sheetsService.getCatProducts(); // uses getProductsByCategory("cat")
      if (!allCat || allCat.length === 0) {
        await this.sendTextMessage(
          senderId,
          "Maaf juragan, produk cat belum ada di database 😅",
          [
            {
              content_type: "text",
              title: "🏠 Menu Utama",
              payload: "MAIN_MENU",
            },
          ]
        );
        return;
      }

      // GPT match => list of ids
      const gptRes = await gptService.matchCatProductsByColor(
        colorQuery,
        allCat,
        30 // collect more then paginate
      );

      const idToProduct = new Map(allCat.map((p) => [String(p.id), p]));
      const matchedProducts = (gptRes.matches || [])
        .map((m) => idToProduct.get(String(m.id)))
        .filter(Boolean);

      // Store last results in session so ORDER/DETAIL can resolve by idx
      const key = this.encodeTextPayload(colorQuery);
      session.catLastResults = {
        key,
        colorQuery,
        keywords: gptRes.keywords || [],
        products: matchedProducts,
      };

      if (!matchedProducts.length) {
        await this.sendTextMessage(
          senderId,
          `Waduh, aku belum nemu cat yang cocok untuk warna "${colorQuery}" 😅\nCoba sebutin lebih spesifik ya (misal: "dakota blue", "navy", "silver metallic")`,
          [
            {
              content_type: "text",
              title: "🎨 Ganti Warna",
              payload: "CAT_CHANGE_COLOR",
            },
            {
              content_type: "text",
              title: "🏠 Menu Utama",
              payload: "MAIN_MENU",
            },
          ]
        );
        return;
      }

      const perPage = 8; // keep carousel manageable
      const totalPages = Math.max(
        1,
        Math.ceil(matchedProducts.length / perPage)
      );
      const safePage = Math.min(Math.max(page, 1), totalPages);

      const start = (safePage - 1) * perPage;
      const show = matchedProducts.slice(start, start + perPage);

      const elements = show.map((p, i) => {
        const globalIdx = start + i;
        const encodedColor = session.catLastResults.key;

        // For CAT, show name + brand only
        const title = (p.name || "").slice(0, 80);
        const subtitle = (p.brand || "").slice(0, 80) || " ";

        return {
          title,
          subtitle,
          image_url: this.unsplashImageForPaintName(p.name),
          buttons: [
            {
              type: "postback",
              title: "📋 Detail",
              payload: `DETAIL_CAT_COLOR_${encodedColor}_${globalIdx}`,
            },
            {
              type: "postback",
              title: "🛒 Pesan",
              payload: `ORDER_CAT_COLOR_${encodedColor}_${globalIdx}`,
            },
          ],
        };
      });

      await this.sendCarousel(senderId, elements);

      const quickReplies = [];

      if (safePage > 1) {
        quickReplies.push({
          content_type: "text",
          title: "⬅️ Prev",
          payload: `CAT_COLOR_PAGE_${session.catLastResults.key}_${
            safePage - 1
          }`,
        });
      }
      if (safePage < totalPages) {
        quickReplies.push({
          content_type: "text",
          title: "Next ➡️",
          payload: `CAT_COLOR_PAGE_${session.catLastResults.key}_${
            safePage + 1
          }`,
        });
      }

      quickReplies.push(
        {
          content_type: "text",
          title: "🎨 Ganti Warna",
          payload: "CAT_CHANGE_COLOR",
        },
        { content_type: "text", title: "🏠 Menu Utama", payload: "MAIN_MENU" }
      );

      const keywordHint =
        (session.catLastResults.keywords || []).length > 0
          ? `\n🔎 Keywords: ${session.catLastResults.keywords
              .slice(0, 6)
              .join(", ")}`
          : "";

      await this.callSendAPI({
        recipient: { id: senderId },
        message: {
          text:
            `🎨 Hasil cat untuk warna: "${colorQuery}"` +
            `\n📦 Menampilkan ${show.length} dari ${matchedProducts.length}` +
            (totalPages > 1
              ? `\n📄 Halaman ${safePage} dari ${totalPages}`
              : "") +
            keywordHint +
            `\n\nKlik "Pesan" untuk tambah ke pilihan. Ketik "selesai" untuk ringkasan.`,
          quick_replies: quickReplies.slice(0, 13),
        },
      });
    } catch (e) {
      console.error("❌ sendCatByColor error:", e?.message || e);
      await this.sendTextMessage(
        senderId,
        "Maaf juragan, error saat cari cat berdasarkan warna 😅\nCoba lagi ya."
      );
    }
  }

  // =========================
  // BAN: UKURAN MENU (PAGINATED)
  // =========================
  async sendUkuranBanMenu(senderId, page = 1, session) {
    const ukuranList = (await sheetsService.getUkuranBanList()) || [];
    const perPage = 10;
    const totalPages = Math.max(1, Math.ceil(ukuranList.length / perPage));
    const safePage = Math.min(Math.max(page, 1), totalPages);

    const start = (safePage - 1) * perPage;
    const end = start + perPage;
    const show = ukuranList.slice(start, end);

    const quickReplies = [];

    if (safePage > 1) {
      quickReplies.push({
        content_type: "text",
        title: "⬅️ Prev",
        payload: `UKURAN_BAN_PAGE_${safePage - 1}`,
      });
    }

    show.forEach((u) => {
      quickReplies.push({
        content_type: "text",
        title: String(u),
        payload: `UKURAN_BAN_${this.encodeUkuran(u)}`,
      });
    });

    if (safePage < totalPages) {
      quickReplies.push({
        content_type: "text",
        title: "Next ➡️",
        payload: `UKURAN_BAN_PAGE_${safePage + 1}`,
      });
    }

    quickReplies.push(
      {
        content_type: "text",
        title: "Tidak Yakin",
        payload: "UKURAN_BAN_TIDAK_YAKIN",
      },
      {
        content_type: "text",
        title: "🏠 Menu Utama",
        payload: "MAIN_MENU",
      }
    );

    await this.sendTextMessage(
      senderId,
      `Pilih ukuran ban yang dicari:` +
        (totalPages > 1 ? `\nHalaman ${safePage} dari ${totalPages}` : ""),
      quickReplies.slice(0, 13)
    );

    session.state = "ban_choose_ukuran";
  }

  // =========================
  // BAN: SHOW ALL PRODUCTS BY UKURAN (NO BRAND)
  // =========================
  async sendBanByUkuran(senderId, session, ukuran, page = 1) {
    try {
      await this.sendTypingOn(senderId);

      let products = await sheetsService.getProductsByUkuranBan(ukuran);
      products = products.sort((a, b) => {
        const isMaxxisA = (a.brand || "").toLowerCase().includes("maxxis")
          ? -1
          : 1;
        const isMaxxisB = (b.brand || "").toLowerCase().includes("maxxis")
          ? -1
          : 1;
        return isMaxxisA - isMaxxisB;
      });

      if (!products || products.length === 0) {
        await this.sendTextMessage(
          senderId,
          `Maaf, belum ada ban ukuran **${ukuran}** 😅\n\nPilih ukuran lain ya.`,
          [
            {
              content_type: "text",
              title: "📂 Ukuran Lain",
              payload: "BAN_PILIH_UKURAN",
            },
            {
              content_type: "text",
              title: "🏠 Menu Utama",
              payload: "MAIN_MENU",
            },
          ]
        );
        return;
      }

      const maxPerPage = 10;
      const totalPages = Math.max(1, Math.ceil(products.length / maxPerPage));
      const safePage = Math.min(Math.max(page, 1), totalPages);

      const startIndex = (safePage - 1) * maxPerPage;
      const endIndex = startIndex + maxPerPage;
      const show = products.slice(startIndex, endIndex);

      const elements = show.map((p, i) => {
        const globalIndex = startIndex + i;
        const productId = `BAN_SIZE_${this.encodeUkuran(
          ukuran
        )}_${globalIndex}`;

        return {
          title: p.name,
          subtitle: this.formatProductSubtitle(p),
          image_url: p.image_url || this.getDefaultProductImage("ban"),
          buttons: [
            {
              type: "postback",
              title: "📋 Detail",
              payload: `DETAIL_${productId}`,
            },
            {
              type: "postback",
              title: "🛒 Pesan",
              payload: `ORDER_${productId}`,
            },
          ],
        };
      });

      await this.sendCarousel(senderId, elements);

      const quickReplies = [];
      if (totalPages > 1) {
        if (safePage > 1) {
          quickReplies.push({
            content_type: "text",
            title: "⬅️ Prev",
            payload: `BAN_UKURAN_PAGE_${this.encodeUkuran(ukuran)}_${
              safePage - 1
            }`,
          });
        }
        if (safePage < totalPages) {
          quickReplies.push({
            content_type: "text",
            title: "Next ➡️",
            payload: `BAN_UKURAN_PAGE_${this.encodeUkuran(ukuran)}_${
              safePage + 1
            }`,
          });
        }
      }

      quickReplies.push(
        {
          content_type: "text",
          title: "📂 Ukuran Lain",
          payload: "BAN_PILIH_UKURAN",
        },
        { content_type: "text", title: "🏠 Menu Utama", payload: "MAIN_MENU" }
      );

      await this.callSendAPI({
        recipient: { id: senderId },
        message: {
          text:
            `🛞 **Ban ukuran ${ukuran}**\n` +
            `📦 Menampilkan ${show.length} dari ${products.length} produk` +
            (totalPages > 1
              ? `\n📄 Halaman ${safePage} dari ${totalPages}`
              : "") +
            `\n\nKlik "Pesan" untuk tambah ke pilihan. Ketik "selesai" untuk ringkasan.`,
          quick_replies: quickReplies.slice(0, 13),
        },
      });

      session.state = "ban_show_ukuran";
      session.banUkuran = ukuran;
    } catch (e) {
      console.error("❌ sendBanByUkuran error:", e.message);
      await this.sendTextMessage(
        senderId,
        "Maaf, error saat ambil ban berdasarkan ukuran 😅"
      );
    }
  }

  // =========================
  // ADD TO SELECTION
  // =========================
  async addProductToSelection(senderId, productId, session) {
    let product = null;

    // CAT_COLOR flow selection:
    // ORDER_CAT_COLOR_<encodedColor>_<idx>
    if (String(productId).startsWith("CAT_COLOR_")) {
      const parts = String(productId).split("_");
      const encodedColor = parts[2];
      const idx = parseInt(parts[3], 10);

      if (
        session?.catLastResults?.key === encodedColor &&
        Array.isArray(session.catLastResults.products) &&
        session.catLastResults.products[idx]
      ) {
        product = session.catLastResults.products[idx];
      } else {
        // fallback: re-run using stored query if available
        const colorQuery =
          session?.catColorQuery || this.decodeTextPayload(encodedColor);
        await this.sendCatByColor(senderId, session, colorQuery, 1);
        await this.sendTextMessage(
          senderId,
          "Coba klik Pesan lagi ya juragan 🙏"
        );
        return;
      }

      if (!session.selectedProducts) session.selectedProducts = [];
      session.selectedProducts.push(product);

      await this.sendTextMessage(
        senderId,
        `✅ Produk ditambahkan: ${product.name} (${
          product.brand || "-"
        })\n\nMau cari warna lain?`,
        [
          {
            content_type: "text",
            title: "🎨 Ganti Warna",
            payload: "CAT_CHANGE_COLOR",
          },
          {
            content_type: "text",
            title: "🏠 Menu Utama",
            payload: "MAIN_MENU",
          },
        ]
      );
      return;
    }

    // BAN_SIZE_<encodedUkuran>_<index>
    if (String(productId).startsWith("BAN_SIZE_")) {
      const parts = String(productId).split("_");
      const encodedUkuran = parts[2];
      const idx = parseInt(parts[3], 10);
      const ukuran = this.decodeUkuran(encodedUkuran);

      const products = await sheetsService.getProductsByUkuranBan(ukuran);
      if (products && products[idx]) product = products[idx];

      if (!product) {
        await this.sendTextMessage(senderId, "❌ Produk tidak ditemukan.");
        return;
      }

      if (!session.selectedProducts) session.selectedProducts = [];
      session.selectedProducts.push(product);

      await this.sendTextMessage(
        senderId,
        `✅ Produk ditambahkan: ${product.name} (${
          product.brand || "-"
        })\n\nMau tambah lagi? Pilih ukuran lain atau ketik "selesai".`,
        [
          {
            content_type: "text",
            title: "📂 Ukuran Lain",
            payload: "BAN_PILIH_UKURAN",
          },
          {
            content_type: "text",
            title: "🏠 Menu Utama",
            payload: "MAIN_MENU",
          },
        ]
      );
      return;
    }

    // fallback old pattern CATEGORY_BRAND_INDEX (keep your legacy)
    const parts = String(productId).split("_");
    if (parts.length >= 3) {
      const category = parts[0].toLowerCase();
      const brand = parts[1];
      const index = parseInt(parts[2], 10);

      const products = await sheetsService.getProductsByBrand(category, brand);
      if (products[index]) product = products[index];

      if (!product) {
        const productResult = await sheetsService.getProductById(productId);
        if (!productResult.success) {
          await this.sendTextMessage(senderId, "❌ Produk tidak ditemukan.");
          return;
        }
        product = productResult.data;
      }

      if (!session.selectedProducts) session.selectedProducts = [];
      session.selectedProducts.push(product);

      await this.sendTextMessage(
        senderId,
        `✅ Produk ditambahkan: ${product.name} (${
          product.brand || "-"
        })\n\nKetik "katalog" untuk cari lagi, atau ketik "selesai" untuk ringkasan pilihanmu.`
      );
    }
  }

  // =========================
  // PRODUCT DETAIL
  // =========================
  async sendProductDetail(senderId, productIdWithPrefix) {
    try {
      const session = await this.getUserSession(senderId);
      const cleaned = String(productIdWithPrefix).replace("DETAIL_", "");

      // CAT detail:
      // CAT_COLOR_<encodedColor>_<idx>
      if (cleaned.startsWith("CAT_COLOR_")) {
        const parts = cleaned.split("_");
        const encodedColor = parts[2];
        const idx = parseInt(parts[3], 10);

        const p =
          session?.catLastResults?.key === encodedColor
            ? session.catLastResults.products?.[idx]
            : null;

        if (!p) {
          await this.sendTextMessage(
            senderId,
            "Maaf, detail cat tidak ditemukan 😅"
          );
          return;
        }

        const detail = `🎨 **${p.name}**\n🏷️ Merk: ${
          p.brand || "-"
        }\n💰 Harga: Rp ${this.formatRupiah(
          p.harga_jual || 0
        )}\n\n(Preview gambar dari internet ya juragan 😄)`;

        await this.sendTextMessage(senderId, detail, [
          {
            content_type: "text",
            title: "🎨 Ganti Warna",
            payload: "CAT_CHANGE_COLOR",
          },
          {
            content_type: "text",
            title: "🏠 Menu Utama",
            payload: "MAIN_MENU",
          },
        ]);
        return;
      }

      // BAN detail:
      if (cleaned.startsWith("BAN_SIZE_")) {
        const parts = cleaned.split("_");
        const encodedUkuran = parts[2];
        const idx = parseInt(parts[3], 10);
        const ukuran = this.decodeUkuran(encodedUkuran);

        const products = await sheetsService.getProductsByUkuranBan(ukuran);
        const p = products && products[idx];
        if (!p) {
          await this.sendTextMessage(
            senderId,
            "Maaf, produk tidak ditemukan 😅"
          );
          return;
        }

        const detailText = this.formatProductDetail(p);
        await this.sendTextMessage(senderId, detailText, [
          {
            content_type: "text",
            title: "📂 Ukuran Lain",
            payload: "BAN_PILIH_UKURAN",
          },
          {
            content_type: "text",
            title: "🏠 Menu Utama",
            payload: "MAIN_MENU",
          },
        ]);
        return;
      }

      await this.sendTextMessage(
        senderId,
        "Detail produk belum tersedia untuk format ini."
      );
    } catch (e) {
      console.error("❌ sendProductDetail error:", e.message);
      await this.sendTextMessage(
        senderId,
        "Maaf, ada error saat mengambil detail 😅"
      );
    }
  }

  // =========================
  // SESSION
  // =========================
  async getUserSession(senderId) {
    const SESSION_TIMEOUT = 24 * 60 * 60 * 1000;
    const now = Date.now();

    if (!this.userSessions.has(senderId)) {
      this.userSessions.set(senderId, {
        state: null,
        orderData: null,
        lastActivity: now,
        selectedProducts: [],
        banUkuran: null,
        banMotorQuery: null,
        banPosisi: null,

        catColorQuery: null,
        catLastResults: null,
      });
      return this.userSessions.get(senderId);
    }

    const s = this.userSessions.get(senderId);
    if (now - s.lastActivity > SESSION_TIMEOUT) {
      this.userSessions.set(senderId, {
        state: null,
        orderData: null,
        lastActivity: now,
        selectedProducts: [],
        banUkuran: null,
        banMotorQuery: null,
        banPosisi: null,

        catColorQuery: null,
        catLastResults: null,
      });
      return this.userSessions.get(senderId);
    }

    s.lastActivity = now;
    return s;
  }

  // =========================
  // UTIL
  // =========================
  encodeUkuran(u) {
    return String(u).replace(/\//g, "-").replace(/\s+/g, "~");
  }

  decodeUkuran(u) {
    return String(u).replace(/-/g, "/").replace(/~/g, " ");
  }

  looksLikeUkuranBan(s) {
    return /(\d{2,3}\s*\/\s*\d{2,3})(-\d{2})?/i.test(String(s));
  }

  // payload-safe encode/decode for color query (avoid "_" entirely)
  encodeTextPayload(s) {
    return Buffer.from(String(s || ""), "utf8")
      .toString("base64")
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "~");
  }

  decodeTextPayload(enc) {
    let b64 = String(enc || "")
      .replace(/-/g, "+")
      .replace(/~/g, "/");
    while (b64.length % 4 !== 0) b64 += "=";
    return Buffer.from(b64, "base64").toString("utf8");
  }

  unsplashImageForPaintName(name) {
    // no key, direct hotlink (good enough)
    const q = encodeURIComponent(
      `car paint ${String(name || "").trim()}`.slice(0, 80)
    );
    return `https://source.unsplash.com/600x400/?${q}`;
  }

  formatRupiah(n) {
    const x = parseInt(n, 10) || 0;
    return x.toLocaleString("id-ID");
  }

  // =========================
  // HELPERS
  // =========================
  formatProductSubtitle(product) {
    let subtitle = "";
    if (product.brand) subtitle += `${product.brand}`;
    if (product.specifications) subtitle += ` • ${product.specifications}`;
    return subtitle || "Informasi produk";
  }

  formatProductDetail(product) {
    let detail = `📦 **${product.name}**\n\n`;
    if (product.brand) detail += `🏷️ **Merk:** ${product.brand}\n`;
    if (product.specifications)
      detail += `📋 **Spesifikasi:** ${product.specifications}\n`;
    if (product.category) detail += `📂 **Kategori:** ${product.category}\n`;
    if (product.harga_jual)
      detail += `💰 **Harga:** Rp ${this.formatRupiah(product.harga_jual)}\n`;
    if (product.harga_pasang)
      detail += `🧰 **Pasang:** Rp ${this.formatRupiah(
        product.harga_pasang
      )}\n`;
    return detail;
  }

  getDefaultProductImage(categoryName) {
    const defaultImages = {
      ban: "https://picsum.photos/300/200?random=1",
      oli: "https://picsum.photos/300/200?random=2",
      lampu: "https://picsum.photos/300/200?random=3",
      cat: "https://picsum.photos/300/200?random=4",
    };
    return (
      defaultImages[String(categoryName || "").toLowerCase()] ||
      "https://picsum.photos/300/200?random=5"
    );
  }

  // =========================
  // FB API WRAPPERS
  // =========================
  async sendTextMessage(senderId, text, quickReplies = null) {
    return await facebookAPI.sendTextMessage(senderId, text, quickReplies);
  }

  async sendCarousel(senderId, elements) {
    return await facebookAPI.sendCarousel(senderId, elements);
  }

  async sendTypingOn(senderId) {
    return await facebookAPI.sendTypingOn(senderId);
  }

  async callSendAPI(messageData) {
    const recipientId = messageData.recipient.id;
    const message = messageData.message;
    return await facebookAPI.sendMessage(recipientId, message);
  }

  // =========================
  // PLACEHOLDERS (KEEP YOURS)
  // =========================
  async sendWelcomeMessage(senderId) {
    const welcomeText = `Halo! 👋 Selamat datang di **Ban888 Auto Parts**!

🛞 **Produk Kami:**
• Ban mobil & motor
• Lampu kendaraan  
• Oli mesin
• Cat kendaraan

💬 **Cara Order:**
• Ketik "katalog" untuk lihat semua kategori
• Atau langsung cari produk (contoh: "ban corsa")
• Klik tombol untuk order langsung!`;
    await this.sendTextMessage(senderId, welcomeText);
  }

  async sendCategoryMenu(senderId) {
    const categories = sheetsService.getAvailableCategories();
    const quickReplies = categories.map((cat) => ({
      content_type: "text",
      title: cat.display_name,
      payload: `CATEGORY_${cat.name.toUpperCase()}`,
    }));

    quickReplies.push({
      content_type: "text",
      title: "❓ Bantuan",
      payload: "HELP",
    });

    await this.callSendAPI({
      recipient: { id: senderId },
      message: {
        text: "📂 Pilih kategori produk yang dicari:",
        quick_replies: quickReplies.slice(0, 13),
      },
    });
  }

  async sendBrandMenu(senderId, categoryName, session, page = 1) {
    await this.sendTextMessage(
      senderId,
      `Menu merk untuk ${categoryName} belum dipasang di snippet ini.`
    );
  }

  async sendBrandProducts(senderId, categoryName, brandName, page = 1) {
    await this.sendTextMessage(
      senderId,
      `Produk merk ${brandName} belum dipasang di snippet ini.`
    );
  }

  async sendCategoryProducts(senderId, categoryName) {
    await this.sendTextMessage(
      senderId,
      `Produk kategori ${categoryName} belum dipasang di snippet ini.`
    );
  }

  async searchAndSendProducts(senderId, searchTerm) {
    await this.sendTextMessage(
      senderId,
      `Search "${searchTerm}" belum dipasang di snippet ini.`
    );
  }

  async sendHelpMessage(senderId) {
    await this.sendTextMessage(
      senderId,
      "Ketik 'ban' untuk pilih ukuran ban, atau 'katalog' untuk menu. Untuk cat: ketik 'cat' lalu tulis warna 😄"
    );
  }

  async handleAttachment(senderId, attachments, session) {
    await this.sendTextMessage(
      senderId,
      "Terima kasih! Untuk order, ketik 'katalog' 😊"
    );
  }
}

module.exports = new MessageHandler();
