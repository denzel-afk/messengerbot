// MessageHandler.js
const sheetsService = require("../services/sheetsService");
const facebookAPI = require("../services/facebookAPI");

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

      // optional mapping if implemented
      const mapped = await sheetsService.getUkuranBanByMotor?.(
        session.banMotorQuery
      );

      if (mapped && mapped.success && mapped.ukuran) {
        session.banUkuran = mapped.ukuran;
        session.state = "ban_show_ukuran";
        await this.sendBanByUkuran(senderId, session, mapped.ukuran, 1);
      } else {
        await this.sendTextMessage(
          senderId,
          `Oke, saya cari ban untuk: "${session.banMotorQuery}".`
        );
        await this.searchAndSendProducts(senderId, session.banMotorQuery);
        session.state = null;
      }
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
          process.env.SUPPORT_WHATSAPP || "+628123456789"
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

    if (["lampu", "oli", "cat"].includes(textLower)) {
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
  // QUICK REPLY (FIXED ORDER!)
  // =========================
  async handleQuickReply(senderId, payload, session) {
    payload = String(payload || "");
    console.log(`🔘 Quick reply from ${senderId}: ${payload}`);

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

    // ---------- BAN: SELECT UKURAN (MUST COME AFTER PAGE CHECK) ----------
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

      await this.sendBrandMenu(senderId, category, session);
      return;
    }
  }

  // =========================
  // BAN: UKURAN MENU (PAGINATED)
  // =========================
  async sendUkuranBanMenu(senderId, page = 1, session) {
    const ukuranList = (await sheetsService.getUkuranBanList()) || [];
    const perPage = 10; // safer, leave room for nav + tidak yakin + menu utama
    const totalPages = Math.max(1, Math.ceil(ukuranList.length / perPage));
    const safePage = Math.min(Math.max(page, 1), totalPages);

    const start = (safePage - 1) * perPage;
    const end = start + perPage;
    const show = ukuranList.slice(start, end);

    const quickReplies = [];

    // Prev
    if (safePage > 1) {
      quickReplies.push({
        content_type: "text",
        title: "⬅️ Prev",
        payload: `UKURAN_BAN_PAGE_${safePage - 1}`,
      });
    }

    // Sizes
    show.forEach((u) => {
      quickReplies.push({
        content_type: "text",
        title: String(u),
        payload: `UKURAN_BAN_${this.encodeUkuran(u)}`,
      });
    });

    // Next
    if (safePage < totalPages) {
      quickReplies.push({
        content_type: "text",
        title: "Next ➡️",
        payload: `UKURAN_BAN_PAGE_${safePage + 1}`,
      });
    }

    // Tidak yakin + menu
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

      const products = await sheetsService.getProductsByUkuranBan(ukuran);

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

    // fallback old pattern CATEGORY_BRAND_INDEX
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
  // PRODUCT DETAIL (BAN_SIZE ONLY HERE)
  // =========================
  async sendProductDetail(senderId, productIdWithPrefix) {
    try {
      const cleaned = String(productIdWithPrefix).replace("DETAIL_", "");

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
    // keep it simple: avoid "_" which breaks split("_")
    // "/" -> "-", spaces -> "~"
    return String(u).replace(/\//g, "-").replace(/\s+/g, "~");
  }

  decodeUkuran(u) {
    return String(u).replace(/-/g, "/").replace(/~/g, " ");
  }

  looksLikeUkuranBan(s) {
    // Examples: 90/80, 90/80-14, 80/90-17
    return /(\d{2,3}\s*\/\s*\d{2,3})(-\d{2})?/i.test(String(s));
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
      "Ketik 'ban' untuk pilih ukuran ban, atau 'katalog' untuk menu."
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
