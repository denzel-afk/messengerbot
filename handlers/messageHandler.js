// MessageHandler.js
const sheetsService = require("../services/sheetsService");
const facebookAPI = require("../services/facebookAPI");
const gptService = require("../services/gptService");

class MessageHandler {
  constructor() {
    this.userSessions = new Map();
  }

  cleanupSessions() {
    const now = Date.now();
    const timeout = 24 * 60 * 60 * 1000;
    let removed = 0;
    for (const [userId, session] of this.userSessions.entries()) {
      const last = session.lastActivity || session.lastActive || 0;
      if (!last || now - last > timeout) {
        this.userSessions.delete(userId);
        removed++;
      }
    }
    if (removed > 0) {
      console.log(`[SessionCleanup] Removed ${removed} inactive sessions.`);
    }
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
      console.error("Error handling message:", error?.message || error);
      await this.sendTextMessage(senderId, "Maaf, ada error. Coba lagi ya! 🙏");
    }
  }

  // =========================
  // TEXT
  // =========================
  async handleTextMessage(senderId, text, session) {
    const rawText = String(text || "");
    const textLower = rawText.toLowerCase().trim();

    // katalog/menu/produk/categories (ALWAYS check first)
    if (["katalog", "menu", "produk", "categories"].includes(textLower)) {
      await this.sendCategoryMenu(senderId);
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
        // Reset session after selesai
        this.userSessions.delete(senderId);
      } else {
        await this.sendTextMessage(
          senderId,
          "Kamu belum memilih produk apapun. Silakan pilih produk terlebih dahulu."
        );
      }
      return;
    }

    // BAN: start size flow
    if (textLower === "ban") {
      await this.sendUkuranBanMenu(senderId, 1, session);
      return;
    }

    // ✅ LAMPU: start TYPE LAMPU flow (simple pick-pick)
    if (textLower === "lampu") {
      await this.sendTypeLampuMenu(senderId, 1, session);
      return;
    }

    // ✅ OLI: start PACK flow
    if (textLower === "oli") {
      await this.sendPackOliMenu(senderId, 1, session);
      return;
    }

    // CAT: allow direct typing "cat"
    if (textLower === "cat") {
      session.state = "cat_ask_color";
      await this.sendTextMessage(
        senderId,
        "🎨 Suka warna apa, juragan? (contoh: merah, biru, blue, silver, abu)"
      );
      return;
    }

    // ✅ CAT: user answers color after we asked
    if (session.state === "cat_ask_color") {
      const color = rawText.trim();
      if (!color) {
        await this.sendTextMessage(
          senderId,
          "Warna nya apa, juragan? (contoh: biru / navy / silver)"
        );
        return;
      }
      session.catColorQuery = color;
      session.state = "cat_show_color";
      await this.sendCatByColor(senderId, session, color, 1);
      return;
    }

    // user types ukuran directly
    if (this.looksLikeUkuranBan(textLower)) {
      const ukuran = rawText.trim();
      session.banUkuran = ukuran;
      session.state = "ban_show_ukuran";
      await this.sendBanByUkuran(senderId, session, ukuran, 1);
      return;
    }

    // "Tidak Yakin" flow: user replies motor name
    if (session.state === "ban_tanya_motor") {
      session.banMotorQuery = rawText.trim();
      session.state = "ban_tanya_posisi";
      await this.sendTextMessage(senderId, "Ban depan atau belakang?");
      return;
    }

    // Setelah user jawab posisi:
    if (session.state === "ban_tanya_posisi") {
      session.banPosisi = rawText.trim();

      let ukuran = await gptService.getUkuranBanByMotor(
        session.banMotorQuery,
        session.banPosisi
      );

      const match = String(ukuran || "").match(/(\d{2,3}\/\d{2,3}-\d{2,3})/);
      if (match) ukuran = match[1];

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
        const ukuran = rawText.trim();
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

    // General commands
    if (textLower === "bantuan" || textLower === "help") {
      await this.sendHelpMessage(senderId);
      return;
    }

    if (textLower.startsWith("cari ") || textLower.startsWith("search ")) {
      const searchTerm = rawText.substring(5);
      await this.searchAndSendProducts(senderId, searchTerm);
      return;
    }

    await this.searchAndSendProducts(senderId, rawText);
  }

  // =========================
  // QUICK REPLY
  // =========================
  async handleQuickReply(senderId, payload, session) {
    payload = String(payload || "");
    console.log(`🔘 Quick reply from ${senderId}: ${payload}`);

    // ---------- CAT: PAGINATION (NEXT/PREV) ----------
    if (payload.startsWith("CAT_COLOR_PAGE_")) {
      // Format: CAT_COLOR_PAGE_<b64Color>_<page>
      const rest = payload.replace("CAT_COLOR_PAGE_", "");
      const parts = rest.split("_");
      const page = parseInt(parts[parts.length - 1], 10) || 1;
      const b64Color = parts.slice(0, -1).join("_");
      const colorQuery = this.decodeTextPayload(b64Color);

      session.state = "cat_show_color";
      session.catColorQuery = colorQuery;
      await this.sendCatByColor(senderId, session, colorQuery, page);
      return;
    }

    // ---------- BAN: PAGE SIZE MENU ----------
    if (payload.startsWith("UKURAN_BAN_PAGE_")) {
      const page = parseInt(payload.replace("UKURAN_BAN_PAGE_", ""), 10) || 1;
      await this.sendUkuranBanMenu(senderId, page, session);
      return;
    }

    // ---------- BAN: PAGE PRODUCTS BY UKURAN ----------
    if (payload.startsWith("BAN_UKURAN_PAGE_")) {
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

    // =========================
    // ✅ LAMPU: TYPE FLOW
    // =========================

    // paginate type list
    if (payload.startsWith("TYPE_LAMPU_PAGE_")) {
      const page = parseInt(payload.replace("TYPE_LAMPU_PAGE_", ""), 10) || 1;
      await this.sendTypeLampuMenu(senderId, page, session);
      return;
    }

    // select type
    if (payload.startsWith("TYPE_LAMPU_")) {
      const encoded = payload.replace("TYPE_LAMPU_", "");
      const typeLampu = this.decodeTextPayload(encoded);

      session.lampuType = typeLampu;
      session.state = "lampu_show_type";
      await this.sendLampuByType(senderId, session, typeLampu, 1);
      return;
    }

    // paginate products by type
    if (payload.startsWith("LAMPU_TYPE_PAGE_")) {
      // Format: LAMPU_TYPE_PAGE_<b64Type>_<page>
      const rest = payload.replace("LAMPU_TYPE_PAGE_", "");
      const parts = rest.split("_");
      const page = parseInt(parts[parts.length - 1], 10) || 1;
      const b64Type = parts.slice(0, -1).join("_");
      const typeLampu = this.decodeTextPayload(b64Type);

      session.lampuType = typeLampu;
      session.state = "lampu_show_type";
      await this.sendLampuByType(senderId, session, typeLampu, page);
      return;
    }

    // back to type list
    if (payload === "LAMPU_PILIH_TYPE") {
      await this.sendTypeLampuMenu(senderId, 1, session);
      return;
    }

    // =========================
    // ✅ OLI: PACK FLOW
    // =========================

    // paginate pack list
    if (payload.startsWith("PACK_OLI_PAGE_")) {
      const page = parseInt(payload.replace("PACK_OLI_PAGE_", ""), 10) || 1;
      await this.sendPackOliMenu(senderId, page, session);
      return;
    }

    // select pack
    if (payload.startsWith("PACK_OLI_")) {
      const encoded = payload.replace("PACK_OLI_", "");
      const pack = this.decodeTextPayload(encoded);

      session.oliPack = pack;
      session.state = "oli_show_pack";
      await this.sendOliByPack(senderId, session, pack, 1);
      return;
    }

    // paginate products by pack
    if (payload.startsWith("OLI_PACK_PAGE_")) {
      // Format: OLI_PACK_PAGE_<b64Pack>_<page>
      const rest = payload.replace("OLI_PACK_PAGE_", "");
      const parts = rest.split("_");
      const page = parseInt(parts[parts.length - 1], 10) || 1;
      const b64Pack = parts.slice(0, -1).join("_");
      const pack = this.decodeTextPayload(b64Pack);

      session.oliPack = pack;
      session.state = "oli_show_pack";
      await this.sendOliByPack(senderId, session, pack, page);
      return;
    }

    // back to pack list
    if (payload === "OLI_PILIH_PACK") {
      await this.sendPackOliMenu(senderId, 1, session);
      return;
    }

    // ---------- CATEGORY ----------
    if (payload.startsWith("CATEGORY_")) {
      const category = payload.replace("CATEGORY_", "").toLowerCase();
      session.currentCategory = category;

      // ✅ CAT SPECIAL: ask color first (NO brand menu)
      if (category === "cat") {
        session.state = "cat_ask_color";
        await this.sendTextMessage(
          senderId,
          "🎨 Mau warna apa, juragan? (contoh: biru / blue / navy / silver / abu)"
        );
        return;
      }

      // ✅ BAN SPECIAL
      if (category === "ban") {
        await this.sendUkuranBanMenu(senderId, 1, session);
        return;
      }

      // ✅ OLI SPECIAL: ask PACK first (NO brand menu)
      if (category === "oli") {
        await this.sendPackOliMenu(senderId, 1, session);
        return;
      }

      // ✅ LAMPU SPECIAL: ask TYPE first (NO brand menu)
      if (category === "lampu") {
        await this.sendTypeLampuMenu(senderId, 1, session);
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
        '🔍 Ketik nama produk yang ingin kamu cari:\n\n💡 **Contoh:**\n• "ban corsa"\n• "oli castrol"\n• "lampu LED"\n• "cat biru"'
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

      // ✅ CAT SPECIAL: ask color first
      if (category === "cat") {
        session.state = "cat_ask_color";
        await this.sendTextMessage(
          senderId,
          "🎨 Mau warna apa, juragan? (contoh: biru / blue / navy / silver / abu)"
        );
        return;
      }

      // ✅ BAN SPECIAL
      if (category === "ban") {
        await this.sendUkuranBanMenu(senderId, 1, session);
        return;
      }

      // ✅ OLI SPECIAL
      if (category === "oli") {
        await this.sendPackOliMenu(senderId, 1, session);
        return;
      }

      // ✅ LAMPU SPECIAL
      if (category === "lampu") {
        await this.sendTypeLampuMenu(senderId, 1, session);
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
    const perPage = 10;
    const totalPages = Math.max(1, Math.ceil(ukuranList.length / perPage));
    const safePage = Math.min(Math.max(page, 1), totalPages);

    const start = (safePage - 1) * perPage;
    const show = ukuranList.slice(start, start + perPage);

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

    // Place 'Tidak Yakin' as the first quick reply so user can choose it immediately
    const tidakYakinQR = {
      content_type: "text",
      title: "Tidak Yakin",
      payload: "UKURAN_BAN_TIDAK_YAKIN",
    };

    // Add Next if needed
    if (safePage < totalPages) {
      quickReplies.push({
        content_type: "text",
        title: "Next ➡️",
        payload: `UKURAN_BAN_PAGE_${safePage + 1}`,
      });
    }

    // Ensure 'Tidak Yakin' is first
    quickReplies.unshift(tidakYakinQR);

    // Always add Main Menu at the end
    quickReplies.push({
      content_type: "text",
      title: "🏠 Menu Utama",
      payload: "MAIN_MENU",
    });

    await this.sendTextMessage(
      senderId,
      `Pilih ukuran ban yang dicari:` +
        (totalPages > 1 ? `\nHalaman ${safePage} dari ${totalPages}` : ""),
      quickReplies.slice(0, 13)
    );

    session.state = "ban_choose_ukuran";
  }

  // =========================
  // ✅ LAMPU: TYPE LAMPU MENU (PAGINATED)
  // =========================
  async sendTypeLampuMenu(senderId, page = 1, session) {
    const typeList = (await sheetsService.getTypeLampuList()) || [];
    const perPage = 10;
    const totalPages = Math.max(1, Math.ceil(typeList.length / perPage));
    const safePage = Math.min(Math.max(page, 1), totalPages);

    const start = (safePage - 1) * perPage;
    const show = typeList.slice(start, start + perPage);

    const quickReplies = [];

    if (safePage > 1) {
      quickReplies.push({
        content_type: "text",
        title: "⬅️ Prev",
        payload: `TYPE_LAMPU_PAGE_${safePage - 1}`,
      });
    }

    show.forEach((t) => {
      quickReplies.push({
        content_type: "text",
        title: String(t).slice(0, 20),
        payload: `TYPE_LAMPU_${this.encodeTextPayload(t)}`,
      });
    });

    if (safePage < totalPages) {
      quickReplies.push({
        content_type: "text",
        title: "Next ➡️",
        payload: `TYPE_LAMPU_PAGE_${safePage + 1}`,
      });
    }

    quickReplies.push({
      content_type: "text",
      title: "🏠 Menu Utama",
      payload: "MAIN_MENU",
    });

    await this.sendTextMessage(
      senderId,
      `💡 Pilih TYPE LAMPU yang dicari:` +
        (totalPages > 1 ? `\nHalaman ${safePage} dari ${totalPages}` : ""),
      quickReplies.slice(0, 13)
    );

    session.state = "lampu_choose_type";
  }

  // =========================
  // ✅ OLI: PACK MENU (PAGINATED)
  // =========================
  async sendPackOliMenu(senderId, page = 1, session) {
    const packList = (await sheetsService.getPackOliList()) || [];
    const perPage = 10;
    const totalPages = Math.max(1, Math.ceil(packList.length / perPage));
    const safePage = Math.min(Math.max(page, 1), totalPages);

    const start = (safePage - 1) * perPage;
    const show = packList.slice(start, start + perPage);

    const quickReplies = [];

    if (safePage > 1) {
      quickReplies.push({
        content_type: "text",
        title: "⬅️ Prev",
        payload: `PACK_OLI_PAGE_${safePage - 1}`,
      });
    }

    show.forEach((p) => {
      const label = String(p).length ? `${p}L` : String(p);
      quickReplies.push({
        content_type: "text",
        title: label.slice(0, 20),
        payload: `PACK_OLI_${this.encodeTextPayload(p)}`,
      });
    });

    if (safePage < totalPages) {
      quickReplies.push({
        content_type: "text",
        title: "Next ➡️",
        payload: `PACK_OLI_PAGE_${safePage + 1}`,
      });
    }

    quickReplies.push({
      content_type: "text",
      title: "🏠 Menu Utama",
      payload: "MAIN_MENU",
    });

    await this.sendTextMessage(
      senderId,
      `🛢️ Pilih **PACK** oli yang dicari:` +
        (totalPages > 1 ? `\nHalaman ${safePage} dari ${totalPages}` : ""),
      quickReplies.slice(0, 13)
    );

    session.state = "oli_choose_pack";
  }

  // =========================
  // ✅ LAMPU: SHOW PRODUCTS BY TYPE (PAGINATED)
  // =========================
  async sendLampuByType(senderId, session, typeLampu, page = 1) {
    try {
      await this.sendTypingOn(senderId);

      const products =
        (await sheetsService.getLampuByTypeLampu(typeLampu)) || [];
      if (!products.length) {
        await this.sendTextMessage(
          senderId,
          `Maaf, belum ada lampu untuk TYPE LAMPU **${typeLampu}** 😅\n\nPilih type lain ya.`,
          [
            {
              content_type: "text",
              title: "📂 Type Lain",
              payload: "LAMPU_PILIH_TYPE",
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
      const show = products.slice(startIndex, startIndex + maxPerPage);

      const elements = show.map((p, i) => {
        const globalIndex = startIndex + i;
        const productId = `LAMPU_TYPE_${this.encodeTextPayload(
          typeLampu
        )}_${globalIndex}`;

        return {
          title: String(p.name || "").slice(0, 80),
          subtitle: this.formatProductSubtitle(p),
          image_url:
            this.normalizeImageUrl(p.image_url) ||
            this.getDefaultProductImage("lampu"),
          buttons: [
            {
              type: "postback",
              title: "🛒 Tertarik",
              payload: `ORDER_${productId}`,
            },
          ],
        };
      });

      await this.sendCarousel(senderId, elements);

      const b64Type = this.encodeTextPayload(typeLampu);
      const quickReplies = [];

      if (totalPages > 1 && safePage > 1) {
        quickReplies.push({
          content_type: "text",
          title: "⬅️ Prev",
          payload: `LAMPU_TYPE_PAGE_${b64Type}_${safePage - 1}`,
        });
      }
      if (totalPages > 1 && safePage < totalPages) {
        quickReplies.push({
          content_type: "text",
          title: "Next ➡️",
          payload: `LAMPU_TYPE_PAGE_${b64Type}_${safePage + 1}`,
        });
      }

      quickReplies.push(
        {
          content_type: "text",
          title: "📂 Type Lain",
          payload: "LAMPU_PILIH_TYPE",
        },
        { content_type: "text", title: "🏠 Menu Utama", payload: "MAIN_MENU" }
      );

      await this.sendTextMessage(
        senderId,
        `💡 **Lampu TYPE ${typeLampu}**\n` +
          `📦 Menampilkan ${show.length} dari ${products.length}` +
          (totalPages > 1
            ? `\n📄 Halaman ${safePage} dari ${totalPages}`
            : "") +
          `\n\nKlik "Tertarik" untuk simpan pilihan. Ketik "selesai" untuk ringkasan.`,
        quickReplies.slice(0, 13)
      );

      session.state = "lampu_show_type";
      session.lampuType = typeLampu;
    } catch (e) {
      console.error("❌ sendLampuByType error:", e?.message || e);
      await this.sendTextMessage(
        senderId,
        "Maaf, error saat ambil lampu berdasarkan TYPE 😅"
      );
    }
  }

  // =========================
  // ✅ OLI: SHOW PRODUCTS BY PACK (PAGINATED)
  // =========================
  async sendOliByPack(senderId, session, pack, page = 1) {
    try {
      await this.sendTypingOn(senderId);

      const products = (await sheetsService.getProductsByPackOli(pack)) || [];
      if (!products.length) {
        await this.sendTextMessage(
          senderId,
          `Maaf, belum ada oli untuk PACK **${pack}** 😅\n\nPilih pack lain ya.`,
          [
            {
              content_type: "text",
              title: "📂 Pack Lain",
              payload: "OLI_PILIH_PACK",
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
      const show = products.slice(startIndex, startIndex + maxPerPage);

      const elements = show.map((p, i) => {
        const globalIndex = startIndex + i;
        const productId = `OLI_PACK_${this.encodeTextPayload(
          pack
        )}_${globalIndex}`;

        return {
          title: String(p.name || "").slice(0, 80),
          subtitle: this.formatProductSubtitle(p),
          image_url:
            this.normalizeImageUrl(p.image_url) ||
            this.getDefaultProductImage("oli"),
          buttons: [
            {
              type: "postback",
              title: "🛒 Tertarik",
              payload: `ORDER_${productId}`,
            },
          ],
        };
      });

      await this.sendCarousel(senderId, elements);

      const b64Pack = this.encodeTextPayload(pack);
      const quickReplies = [];

      if (totalPages > 1 && safePage > 1) {
        quickReplies.push({
          content_type: "text",
          title: "⬅️ Prev",
          payload: `OLI_PACK_PAGE_${b64Pack}_${safePage - 1}`,
        });
      }
      if (totalPages > 1 && safePage < totalPages) {
        quickReplies.push({
          content_type: "text",
          title: "Next ➡️",
          payload: `OLI_PACK_PAGE_${b64Pack}_${safePage + 1}`,
        });
      }

      quickReplies.push(
        {
          content_type: "text",
          title: "📂 Pack Lain",
          payload: "OLI_PILIH_PACK",
        },
        { content_type: "text", title: "🏠 Menu Utama", payload: "MAIN_MENU" }
      );

      await this.sendTextMessage(
        senderId,
        `🛢️ **Oli PACK ${pack}**\n` +
          `📦 Menampilkan ${show.length} dari ${products.length}` +
          (totalPages > 1
            ? `\n📄 Halaman ${safePage} dari ${totalPages}`
            : "") +
          `\n\nKlik "Tertarik" untuk simpan pilihan. Ketik "selesai" untuk ringkasan.`,
        quickReplies.slice(0, 13)
      );

      session.state = "oli_show_pack";
      session.oliPack = pack;
    } catch (e) {
      console.error("❌ sendOliByPack error:", e?.message || e);
      await this.sendTextMessage(
        senderId,
        "Maaf, error saat ambil oli berdasarkan PACK 😅"
      );
    }
  }

  // =========================
  // BAN: SHOW ALL PRODUCTS BY UKURAN (NO BRAND)
  // =========================
  async sendBanByUkuran(senderId, session, ukuran, page = 1) {
    try {
      await this.sendTypingOn(senderId);

      let products = await sheetsService.getProductsByUkuranBan(ukuran);
      products = (products || []).sort((a, b) => {
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
      const show = products.slice(startIndex, startIndex + maxPerPage);

      const elements = show.map((p, i) => {
        const globalIndex = startIndex + i;
        const productId = `BAN_SIZE_${this.encodeUkuran(
          ukuran
        )}_${globalIndex}`;
        return {
          title: p.name,
          subtitle: this.formatProductSubtitle(p),
          image_url:
            this.normalizeImageUrl(p.image_url) ||
            this.getDefaultProductImage("ban"),
          buttons: [
            {
              type: "postback",
              title: "📋 Detail",
              payload: `DETAIL_${productId}`,
            },
            {
              type: "postback",
              title: "🛒 TERTARIK",
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
            `\n\nKlik "Tertarik" untuk tambah ke pilihan. Ketik "selesai" untuk ringkasan.`,
          quick_replies: quickReplies.slice(0, 13),
        },
      });

      session.state = "ban_show_ukuran";
      session.banUkuran = ukuran;
    } catch (e) {
      console.error("❌ sendBanByUkuran error:", e?.message || e);
      await this.sendTextMessage(
        senderId,
        "Maaf, error saat ambil ban berdasarkan ukuran 😅"
      );
    }
  }

  // =========================
  // ✅ CAT: MATCH BY COLOR (GPT) + PAGINATION
  // =========================
  async sendCatByColor(senderId, session, userColor, page = 1) {
    try {
      await this.sendTypingOn(senderId);

      const pageSize = 10;

      const catProducts = await this.getAllCatProductsNormalized();
      if (!catProducts.length) {
        await this.sendTextMessage(
          senderId,
          "Maaf, produk cat belum tersedia 😅",
          [
            {
              content_type: "text",
              title: "🏠 Menu Utama",
              payload: "MAIN_MENU",
            },
          ]
        );
        session.state = "cat_ask_color";
        return;
      }

      let matchIds = [];
      let keywords = [];

      const cacheOk =
        session.catLastResults &&
        session.catLastResults.colorQuery === userColor &&
        Array.isArray(session.catLastResults.matchIds);

      if (!cacheOk) {
        const res = await gptService.matchCatProductsByColor(
          userColor,
          catProducts,
          1000
        );
        matchIds = (res.matches || []).map((m) => String(m.id));
        keywords = res.keywords || [];
        session.catLastResults = { matchIds, keywords, colorQuery: userColor };
        session.catColorQuery = userColor;
      } else {
        matchIds = session.catLastResults.matchIds || [];
        keywords = session.catLastResults.keywords || [];
      }

      const matched = matchIds
        .map((id) => catProducts.find((p) => String(p.id) === id))
        .filter(Boolean);

      if (!matched.length) {
        await this.sendTextMessage(
          senderId,
          `Waduh, aku belum nemu cat yang cocok buat warna "${userColor}" 😅\nCoba sebutin versi lain ya (contoh: "navy", "sky blue", "silver metallic").`,
          [
            {
              content_type: "text",
              title: "🏠 Menu Utama",
              payload: "MAIN_MENU",
            },
          ]
        );
        session.state = "cat_ask_color";
        return;
      }

      const totalPages = Math.max(1, Math.ceil(matched.length / pageSize));
      const safePage = Math.min(Math.max(page, 1), totalPages);

      const startIdx = (safePage - 1) * pageSize;
      const show = matched.slice(startIdx, startIdx + pageSize);

      const elements = show.map((p) => {
        const productId = `CAT_${String(p.id)}`;
        return {
          title: String(p.name || "").slice(0, 80),
          subtitle: String(p.brand || "-").slice(0, 80),
          image_url:
            this.normalizeImageUrl(p.image_url) ||
            this.getDefaultProductImage("cat"),
          buttons: [
            {
              type: "postback",
              title: "🛒 TERTARIK",
              payload: `ORDER_${productId}`,
            },
          ],
        };
      });

      await this.sendCarousel(senderId, elements);

      const b64Color = this.encodeTextPayload(userColor);
      const quickReplies = [];

      if (safePage > 1) {
        quickReplies.push({
          content_type: "text",
          title: "⬅️ Prev",
          payload: `CAT_COLOR_PAGE_${b64Color}_${safePage - 1}`,
        });
      }
      if (safePage < totalPages) {
        quickReplies.push({
          content_type: "text",
          title: "Next ➡️",
          payload: `CAT_COLOR_PAGE_${b64Color}_${safePage + 1}`,
        });
      }

      quickReplies.push(
        {
          content_type: "text",
          title: "🎨 Ganti Warna",
          payload: "CATEGORY_CAT",
        },
        { content_type: "text", title: "🏠 Menu Utama", payload: "MAIN_MENU" }
      );

      const kw = (keywords || []).slice(0, 8);
      const kwLine = kw.length
        ? `\n🔎 Aku cari yang mirip: ${kw.join(", ")}`
        : "";

      await this.sendTextMessage(
        senderId,
        `🎨 Hasil cat untuk warna **${userColor}** (${safePage}/${totalPages})${kwLine}\n\nKlik "Tertarik" untuk simpan pilihan. Ketik "selesai" untuk ringkasan.`,
        quickReplies.slice(0, 13)
      );

      session.state = "cat_show_color";
    } catch (e) {
      console.error(
        "❌ sendCatByColor error:",
        e?.message || e,
        e?.stack || ""
      );
      await this.sendTextMessage(
        senderId,
        "Maaf, error saat cari cat berdasarkan warna 😅\nCoba ketik warna lagi ya."
      );
      session.state = "cat_ask_color";
    }
  }

  // =========================
  // ADD PRODUCT TO SELECTION
  // =========================
  async addProductToSelection(senderId, productId, session) {
    let product = null;

    // ✅ LAMPU_TYPE_<b64Type>_<index>
    if (String(productId).startsWith("LAMPU_TYPE_")) {
      const parts = String(productId).split("_");
      const b64Type = parts[2];
      const idx = parseInt(parts[3], 10);
      const typeLampu = this.decodeTextPayload(b64Type);

      const products = await sheetsService.getLampuByTypeLampu(typeLampu);
      if (products && products[idx]) product = products[idx];

      if (!product) {
        await this.sendTextMessage(
          senderId,
          "❌ Produk lampu tidak ditemukan."
        );
        return;
      }

      if (!session.selectedProducts) session.selectedProducts = [];
      session.selectedProducts.push(product);

      await this.sendTextMessage(
        senderId,
        `✅ Produk ditambahkan: ${product.name} (${
          product.brand || "-"
        })\n\nMau tambah lagi? Pilih type lain atau ketik "selesai".`,
        [
          {
            content_type: "text",
            title: "📂 Type Lain",
            payload: "LAMPU_PILIH_TYPE",
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

    // ✅ OLI_PACK_<b64Pack>_<index>
    if (String(productId).startsWith("OLI_PACK_")) {
      const parts = String(productId).split("_");
      const b64Pack = parts[2];
      const idx = parseInt(parts[3], 10);
      const pack = this.decodeTextPayload(b64Pack);

      const products = await sheetsService.getProductsByPackOli(pack);
      if (products && products[idx]) product = products[idx];

      if (!product) {
        await this.sendTextMessage(senderId, "❌ Produk oli tidak ditemukan.");
        return;
      }

      if (!session.selectedProducts) session.selectedProducts = [];
      session.selectedProducts.push(product);

      await this.sendTextMessage(
        senderId,
        `✅ Ditambahkan: ${product.name} (${
          product.brand || "-"
        })\n\nMau tambah lagi? Pilih pack lain atau ketik "selesai".`,
        [
          {
            content_type: "text",
            title: "📂 Pack Lain",
            payload: "OLI_PILIH_PACK",
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

    // ✅ CAT_<id>
    if (String(productId).startsWith("CAT_")) {
      const id = String(productId).replace("CAT_", "");
      const catProducts = await this.getAllCatProductsNormalized();
      product = catProducts.find((p) => String(p.id) === String(id));

      if (!product) {
        await this.sendTextMessage(senderId, "❌ Produk cat tidak ditemukan.");
        return;
      }

      if (!session.selectedProducts) session.selectedProducts = [];
      session.selectedProducts.push(product);

      await this.sendTextMessage(
        senderId,
        `✅ Ditambahkan: ${product.name} (${
          product.brand || "-"
        })\n\nMau tambah lagi? Ketik warna lain, atau ketik "selesai".`
      );

      session.state = "cat_ask_color";
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

    // fallback old pattern CATEGORY_BRAND_INDEX
    const parts = String(productId).split("_");
    if (parts.length >= 3) {
      const category = parts[0].toLowerCase();
      const brand = parts[1];
      const index = parseInt(parts[2], 10);

      const products = await sheetsService.getProductsByBrand(category, brand);
      if (products && products[index]) product = products[index];

      if (!product) {
        const productResult = await sheetsService.getProductById(productId);
        if (!productResult?.success) {
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
  // PRODUCT DETAIL (BAN ONLY HERE)
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
      console.error("❌ sendProductDetail error:", e?.message || e);
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

    const fresh = () => ({
      state: null,
      orderData: null,
      lastActivity: now,
      selectedProducts: [],
      banUkuran: null,
      banMotorQuery: null,
      banPosisi: null,
      lampuType: null,
      oliPack: null, // ✅ add this
      catColorQuery: null,
      catLastResults: null,
    });

    if (!this.userSessions.has(senderId)) {
      this.userSessions.set(senderId, fresh());
      return this.userSessions.get(senderId);
    }

    const s = this.userSessions.get(senderId);
    const last = s.lastActivity || s.lastActive || 0;
    if (now - last > SESSION_TIMEOUT) {
      this.userSessions.set(senderId, fresh());
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

  encodeTextPayload(s) {
    return Buffer.from(String(s || ""), "utf8")
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
  }

  decodeTextPayload(b64) {
    let s = String(b64 || "")
      .replace(/-/g, "+")
      .replace(/_/g, "/");
    while (s.length % 4) s += "=";
    return Buffer.from(s, "base64").toString("utf8");
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
      ban: "https://picsum.photos/1200/628?random=1",
      oli: "https://picsum.photos/1200/628?random=2",
      lampu: "https://picsum.photos/1200/628?random=3",
      cat: "https://picsum.photos/1080/1080?random=4",
    };
    return (
      defaultImages[String(categoryName || "").toLowerCase()] ||
      "https://picsum.photos/1200/628?random=5"
    );
  }

  normalizeImageUrl(url) {
    const u = String(url || "").trim();
    if (!u) return "";

    let directUrl = u;
    const m1 = u.match(/drive\.google\.com\/file\/d\/([^/]+)/i);
    if (m1)
      directUrl = `https://drive.google.com/uc?export=download&id=${m1[1]}`;
    const m2 = u.match(/drive\.google\.com\/open\?id=([^&]+)/i);
    if (m2)
      directUrl = `https://drive.google.com/uc?export=download&id=${m2[1]}`;
    const m3 = u.match(/drive\.google\.com\/uc\?id=([^&]+)/i);
    if (m3)
      directUrl = `https://drive.google.com/uc?export=download&id=${m3[1]}`;
    if (u.includes("dropbox.com")) {
      directUrl = u
        .replace("www.dropbox.com", "dl.dropboxusercontent.com")
        .replace("?dl=0", "");
    }

    const encoded = encodeURIComponent(directUrl);
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME || "demo";
    return `https://res.cloudinary.com/${cloudName}/image/fetch/c_pad,b_white,w_800,h_418/${encoded}`;
  }

  // =========================
  // ✅ CAT: get all cat products (robust)
  // =========================
  async getAllCatProductsNormalized() {
    try {
      if (typeof sheetsService.getProductsByCategory === "function") {
        const rows = await sheetsService.getProductsByCategory("cat");
        return this.normalizeCatRows(rows);
      }

      let brands = [];
      if (typeof sheetsService.getBrandsByCategory === "function") {
        brands = (await sheetsService.getBrandsByCategory("cat")) || [];
      } else if (typeof sheetsService.getBrandsForCategory === "function") {
        brands = (await sheetsService.getBrandsForCategory("cat")) || [];
      }

      const out = [];
      for (const b of brands) {
        const rows = await sheetsService.getProductsByBrand("cat", b);
        out.push(...(rows || []));
      }
      return this.normalizeCatRows(out);
    } catch (e) {
      console.error("getAllCatProductsNormalized error:", e?.message || e);
      return [];
    }
  }

  normalizeCatRows(rows) {
    const arr = Array.isArray(rows) ? rows : [];
    return arr
      .map((r, idx) => {
        const name = r?.name || r?.NAMA || r?.Nama || r?.nama || "";
        const brand = r?.brand || r?.MERK || r?.Merk || r?.merk || "";
        const id =
          r?.id ||
          r?.ID ||
          r?.Id ||
          (name
            ? `${String(name).trim()}__${String(brand).trim()}__${idx}`
            : `${idx}`);

        return {
          id: String(id),
          name: String(name).trim(),
          brand: String(brand).trim(),
          image_url: r?.image_url || r?.IMAGE_URL || r?.img || null,
          category: "cat",
          specifications:
            r?.specifications || r?.SPESIFIKASI || r?.spec || null,
        };
      })
      .filter((p) => p.id && p.name);
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
        text: "📂 Pilih kategori produk yang dicari: (lihat bagian di atas kolom chat dan klik mana yang juragan tertarik)",
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
      "Ketik 'ban' untuk pilih ukuran ban, atau 'katalog' untuk menu. Ketik 'lampu' untuk pilih TYPE LAMPU. Ketik 'oli' untuk pilih PACK."
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
