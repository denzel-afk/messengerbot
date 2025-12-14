const sheetsService = require("../services/sheetsService");
const facebookAPI = require("../services/facebookAPI");

class MessageHandler {
  constructor() {
    this.userSessions = new Map();
  }

  async handleMessage(senderId, messageData) {
    try {
      console.log(`Message from ${senderId}:`, messageData);

      const session = this.getUserSession(senderId);

      if (messageData.quick_reply) {
        await this.handleQuickReply(
          senderId,
          messageData.quick_reply.payload,
          session
        );
      } else if (messageData.text) {
        await this.handleTextMessage(senderId, messageData.text, session);
      } else if (messageData.attachments) {
        await this.handleAttachment(senderId, messageData.attachments, session);
      } else {
        await this.sendTextMessage(
          senderId,
          "Maaf, saya tidak mengerti format pesan tersebut 😅"
        );
      }
    } catch (error) {
      console.error("Error handling message:", error.message);
      await this.sendTextMessage(senderId, "Maaf, ada error. Coba lagi ya! 🙏");
    }
  }

  async handleTextMessage(senderId, text, session) {
    const textLower = text.toLowerCase().trim();

    // Check if user is in ordering process
    if (session.state === "awaiting_name") {
      return await this.handleNameInput(senderId, text, session);
    } else if (session.state === "awaiting_phone") {
      return await this.handlePhoneInput(senderId, text, session);
    }

    // Handle general commands
    if (["hi", "hello", "halo", "hey", "start"].includes(textLower)) {
      await this.sendWelcomeMessage(senderId);
    } else if (
      ["katalog", "menu", "produk", "categories"].includes(textLower)
    ) {
      await this.sendCategoryMenu(senderId);
    } else if (["ban", "lampu", "oli", "cat"].includes(textLower)) {
      await this.sendCategoryProducts(senderId, textLower);
    } else if (textLower === "bantuan" || textLower === "help") {
      await this.sendHelpMessage(senderId);
    } else if (
      textLower.startsWith("cari ") ||
      textLower.startsWith("search ")
    ) {
      const searchTerm = text.substring(5);
      await this.searchAndSendProducts(senderId, searchTerm);
    } else {
      await this.searchAndSendProducts(senderId, text);
    }
  }

  async handleQuickReply(senderId, payload, session) {
    console.log(`🔘 Quick reply from ${senderId}: ${payload}`);

    if (payload.startsWith("CATEGORY_")) {
      const category = payload.replace("CATEGORY_", "").toLowerCase();
      session.currentCategory = category;
      await this.sendBrandMenu(senderId, category, session);
    } else if (payload.startsWith("BRAND_PAGE_")) {
      // Handle brand pagination: BRAND_PAGE_BAN_2
      const parts = payload.replace("BRAND_PAGE_", "").split("_");
      const category = parts[0].toLowerCase();
      const page = parseInt(parts[1]);
      session.currentCategory = category;
      await this.sendBrandMenu(senderId, category, session, page);
    } else if (payload.startsWith("BRAND_")) {
      const parts = payload.replace("BRAND_", "").split("_");
      const category = parts[0].toLowerCase();
      const brand = parts.slice(1).join("_").replace(/_/g, " ");
      session.currentCategory = category;
      session.currentBrand = brand;
      await this.sendBrandProducts(senderId, category, brand, 1);
    } else if (payload.startsWith("PRODUCT_PAGE_")) {
      // Handle product pagination: PRODUCT_PAGE_BAN_BRAND_2
      const parts = payload.replace("PRODUCT_PAGE_", "").split("_");
      if (parts.length >= 3) {
        const category = parts[0].toLowerCase();
        const pageNum = parseInt(parts[parts.length - 1]);
        const brand = parts.slice(1, -1).join("_").replace(/_/g, " ");
        session.currentCategory = category;
        session.currentBrand = brand;
        await this.sendBrandProducts(senderId, category, brand, pageNum);
      }
    } else if (payload.startsWith("SEARCH_")) {
      const searchTerm = payload.replace("SEARCH_", "");
      await this.searchAndSendProducts(senderId, searchTerm);
    } else if (payload === "MAIN_MENU") {
      await this.sendCategoryMenu(senderId);
    } else if (payload === "BACK_TO_CATEGORIES") {
      await this.sendCategoryMenu(senderId);
    } else if (payload === "BACK_TO_BRANDS" && session.currentCategory) {
      // Reset to first page when going back to brands
      await this.sendBrandMenu(senderId, session.currentCategory, session, 1);
    } else if (payload === "HELP") {
      await this.sendHelpMessage(senderId);
    } else if (payload === "SEARCH_AGAIN") {
      await this.sendTextMessage(
        senderId,
        '🔍 Ketik nama produk yang ingin kamu cari:\n\n💡 **Contoh:**\n• "ban corsa"\n• "oli castrol"\n• "lampu LED"'
      );
    }
  }

  async handlePostback(senderId, postback) {
    const payload = postback.payload;
    console.log(`🎯 Postback from ${senderId}: ${payload}`);

    const session = this.getUserSession(senderId);

    if (payload.startsWith("ORDER_")) {
      const productId = payload.replace("ORDER_", "");
      await this.startOrderProcess(senderId, productId, session);
    } else if (payload.startsWith("DETAIL_")) {
      const productId = payload.replace("DETAIL_", "");
      await this.sendProductDetail(senderId, productId);
    } else if (payload === "GET_STARTED") {
      await this.sendWelcomeMessage(senderId);
    } else if (payload.startsWith("CATEGORY_")) {
      const category = payload.replace("CATEGORY_", "").toLowerCase();
      session.currentCategory = category;
      await this.sendBrandMenu(senderId, category, session);
    }
  }

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
• Klik tombol untuk order langsung!

🔍 **Tips:** Coba ketik "ban 90/80" atau "oli castrol"`;

    await this.sendTextMessage(senderId, welcomeText);

    // Send category quick replies
    setTimeout(async () => {
      await this.sendCategoryMenu(senderId);
    }, 1000);
  }

  async sendCategoryMenu(senderId) {
    const categories = sheetsService.getAvailableCategories();

    const quickReplies = categories.map((cat) => ({
      content_type: "text",
      title: cat.display_name,
      payload: `CATEGORY_${cat.name.toUpperCase()}`,
    }));

    // Add help option
    quickReplies.push({
      content_type: "text",
      title: "❓ Bantuan",
      payload: "HELP",
    });

    // Facebook allows max 13 quick replies, ensure we don't exceed
    const limitedQuickReplies = quickReplies.slice(0, 13);

    console.log(`🔘 Sending ${limitedQuickReplies.length} quick replies`);

    const message = {
      recipient: { id: senderId },
      message: {
        text: "📂 Pilih kategori produk yang dicari:",
        quick_replies: limitedQuickReplies,
      },
    };

    await this.callSendAPI(message);
  }

  async sendBrandMenu(senderId, categoryName, session, page = 1) {
    try {
      console.log(`🏷️ Getting brands for ${categoryName} (page ${page})`);

      const brands = await sheetsService.getBrandsByCategory(categoryName);

      if (brands.length === 0) {
        await this.sendTextMessage(
          senderId,
          `Maaf, belum ada produk ${categoryName} tersedia 😅\n\nKetik "katalog" untuk lihat kategori lain.`
        );
        return;
      }

      const categoryInfo = sheetsService
        .getAvailableCategories()
        .find((cat) => cat.name === categoryName);

      const categoryDisplay = categoryInfo
        ? categoryInfo.display_name
        : categoryName.toUpperCase();

      // Pagination settings
      const itemsPerPage = 10; // Leave room for navigation buttons
      const totalPages = Math.ceil(brands.length / itemsPerPage);
      const startIndex = (page - 1) * itemsPerPage;
      const endIndex = startIndex + itemsPerPage;
      const currentBrands = brands.slice(startIndex, endIndex);

      // Create quick replies for current page brands
      const quickReplies = currentBrands.map((brand) => ({
        content_type: "text",
        title: brand.length > 20 ? brand.substring(0, 17) + "..." : brand,
        payload: `BRAND_${categoryName.toUpperCase()}_${brand.replace(
          / /g,
          "_"
        )}`,
      }));

      // Add navigation buttons if needed
      if (totalPages > 1) {
        if (page > 1) {
          quickReplies.push({
            content_type: "text",
            title: "⬅️ Previous Page",
            payload: `BRAND_PAGE_${categoryName.toUpperCase()}_${page - 1}`,
          });
        }

        if (page < totalPages) {
          quickReplies.push({
            content_type: "text",
            title: "Next Pages ➡️",
            payload: `BRAND_PAGE_${categoryName.toUpperCase()}_${page + 1}`,
          });
        }
      }

      // Add back button
      quickReplies.push(
        {
          content_type: "text",
          title: "⬅️ Kembali",
          payload: "BACK_TO_CATEGORIES",
        },
        {
          content_type: "text",
          title: "🏠 Menu Utama",
          payload: "MAIN_MENU",
        }
      );

      console.log(
        `🏷️ Sending ${quickReplies.length} brand quick replies for ${categoryName} (page ${page}/${totalPages})`
      );

      let messageText = `🏷️ **${categoryDisplay}** - Pilih Merk:\n\nDitemukan ${brands.length} merk tersedia`;

      if (totalPages > 1) {
        messageText += `\n📄 Halaman ${page} dari ${totalPages}`;
      }

      messageText += ":";

      const message = {
        recipient: { id: senderId },
        message: {
          text: messageText,
          quick_replies: quickReplies,
        },
      };

      await this.callSendAPI(message);

      // Store current state
      session.state = "selecting_brand";
      session.currentCategory = categoryName;
    } catch (error) {
      console.error(
        `Error sending brand menu for ${categoryName}:`,
        error.message
      );
      await this.sendTextMessage(
        senderId,
        "Maaf, ada error saat mengambil data merk. Coba lagi ya! 🙏"
      );
    }
  }

  async sendBrandProducts(senderId, categoryName, brandName, page = 1) {
    try {
      console.log(
        `📦 Getting products for ${categoryName} - ${brandName} (page ${page})`
      );

      const products = await sheetsService.getProductsByBrand(
        categoryName,
        brandName
      );

      if (products.length === 0) {
        await this.sendTextMessage(
          senderId,
          `Maaf, produk ${brandName} di kategori ${categoryName} belum tersedia 😅`
        );
        return;
      }

      await this.sendTypingOn(senderId);

      // Pagination setup
      const maxProducts = 10;
      const totalPages = Math.ceil(products.length / maxProducts);
      const startIndex = (page - 1) * maxProducts;
      const endIndex = startIndex + maxProducts;
      const productsToShow = products.slice(startIndex, endIndex);

      const elements = productsToShow.map((product, pageIndex) => {
        const globalIndex = startIndex + pageIndex; // Use global index across all pages
        return {
          title: product.name,
          subtitle: this.formatProductSubtitle(product),
          image_url:
            product.image_url || this.getDefaultProductImage(categoryName),
          buttons: [
            {
              type: "postback",
              title: "📋 Detail",
              payload: `DETAIL_${categoryName.toUpperCase()}_${brandName}_${globalIndex}`,
            },
            {
              type: "postback",
              title: "🛒 Pesan",
              payload: `ORDER_${categoryName.toUpperCase()}_${brandName}_${globalIndex}`,
            },
          ],
        };
      });

      await this.sendCarousel(senderId, elements);

      // Send summary and navigation options with pagination
      let summaryText = `🏷️ **${brandName}** - ${categoryName.toUpperCase()}\n`;
      summaryText += `📦 Menampilkan ${productsToShow.length} dari ${products.length} produk`;

      if (totalPages > 1) {
        summaryText += `\n📄 Halaman ${page} dari ${totalPages}`;
      }

      summaryText += `\n\n💡 **Tips:**\n`;
      summaryText += `• Klik "Detail" untuk info lengkap\n`;
      summaryText += `• Klik "Pesan" untuk langsung order`;

      const quickReplies = [];

      // Add pagination buttons
      if (totalPages > 1) {
        if (page > 1) {
          quickReplies.push({
            content_type: "text",
            title: "⬅️ Prev Pages",
            payload: `PRODUCT_PAGE_${categoryName.toUpperCase()}_${brandName}_${
              page - 1
            }`,
          });
        }
        if (page < totalPages) {
          quickReplies.push({
            content_type: "text",
            title: "Next Pages ➡️",
            payload: `PRODUCT_PAGE_${categoryName.toUpperCase()}_${brandName}_${
              page + 1
            }`,
          });
        }
      }

      // Add navigation buttons
      quickReplies.push(
        {
          content_type: "text",
          title: "⬅️ Pilih Merk Lain",
          payload: "BACK_TO_BRANDS",
        },
        {
          content_type: "text",
          title: "📂 Kategori Lain",
          payload: "BACK_TO_CATEGORIES",
        },
        {
          content_type: "text",
          title: "🏠 Menu Utama",
          payload: "MAIN_MENU",
        }
      );

      const message = {
        recipient: { id: senderId },
        message: {
          text: summaryText,
          quick_replies: quickReplies,
        },
      };

      await this.callSendAPI(message);

      // Store current state
      const session = this.getUserSession(senderId);
      session.state = "browsing_products";
      session.currentCategory = categoryName;
      session.currentBrand = brandName;
    } catch (error) {
      console.error(`Error sending brand products:`, error.message);
      await this.sendTextMessage(
        senderId,
        "Maaf, ada error saat mengambil produk. Coba lagi ya! 🙏"
      );
    }
  }

  async sendCategoryProducts(senderId, categoryName) {
    try {
      console.log(`📋 Getting ${categoryName} products for user ${senderId}`);

      const products = await sheetsService.getProductsByCategory(categoryName);

      if (products.length === 0) {
        await this.sendTextMessage(
          senderId,
          `Maaf, produk ${categoryName} belum tersedia 😅\n\nKetik "katalog" untuk lihat kategori lain.`
        );
        return;
      }

      const categoryInfo = sheetsService
        .getAvailableCategories()
        .find((c) => c.name === categoryName);
      await this.sendTextMessage(
        senderId,
        `${categoryInfo.emoji} **${categoryInfo.display_name}**\nDitemukan ${products.length} produk:`
      );

      // Send first 10 products as cards (Facebook limit)
      const productCards = products.slice(0, 10).map((product) => {
        const subtitle = this.formatProductSubtitle(product);
        const imageUrl =
          product.image_url || this.getDefaultImage(categoryName);

        // Generate consistent ID format: CATEGORY_BRAND_INDEX
        const productIndex = products.findIndex((p) => p.name === product.name);
        const consistentId = `${categoryName.toUpperCase()}_${
          product.brand
        }_${productIndex}`;

        return {
          title: product.name,
          subtitle: subtitle,
          image_url: imageUrl,
          buttons: [
            {
              type: "postback",
              title: "📋 Detail",
              payload: `DETAIL_${consistentId}`,
            },
            {
              type: "postback",
              title: "🛒 Order",
              payload: `ORDER_${consistentId}`,
            },
          ],
        };
      });

      await this.sendCarousel(senderId, productCards);

      // If more than 10 products, show search suggestion
      if (products.length > 10) {
        await this.sendTextMessage(
          senderId,
          `📝 Menampilkan 10 dari ${products.length} produk.\n\nCoba cari spesifik: "${categoryName} [merk/ukuran]"`
        );
      }
    } catch (error) {
      console.error(
        `❌ Error sending ${categoryName} products:`,
        error.message
      );
      await this.sendTextMessage(
        senderId,
        "Maaf, ada error saat mengambil data produk 😅"
      );
    }
  }

  async searchAndSendProducts(senderId, searchTerm) {
    try {
      console.log(`🔍 Searching products for "${searchTerm}"`);

      const results = await sheetsService.searchProducts(searchTerm);

      if (results.length === 0) {
        const noResultsMessage = {
          recipient: { id: senderId },
          message: {
            text: `🔍 Tidak ada produk ditemukan untuk "${searchTerm}" 😅\n\n💡 **Tips:**\n• Coba kata kunci lain\n• Ketik "katalog" untuk lihat semua kategori\n• Contoh: "ban corsa", "oli castrol"`,
            quick_replies: [
              {
                content_type: "text",
                title: "🔍 Cari Lagi",
                payload: "SEARCH_AGAIN",
              },
              {
                content_type: "text",
                title: "📂 Lihat Katalog",
                payload: "MAIN_MENU",
              },
            ],
          },
        };

        await this.callSendAPI(noResultsMessage);
        return;
      }

      await this.sendTextMessage(
        senderId,
        `🔍 Ditemukan **${results.length} produk** untuk "${searchTerm}":`
      );

      // Send top 5 search results
      const topResults = results.slice(0, 5).map((product, index) => {
        const subtitle = this.formatProductSubtitle(product);
        const imageUrl =
          product.image_url || this.getDefaultImage(product.category);

        // Generate consistent ID format: CATEGORY_BRAND_INDEX
        const consistentId = `${product.category.toUpperCase()}_${
          product.brand
        }_${index}`;

        return {
          title: product.name,
          subtitle: subtitle,
          image_url: imageUrl,
          buttons: [
            {
              type: "postback",
              title: "📋 Detail",
              payload: `DETAIL_${consistentId}`,
            },
            {
              type: "postback",
              title: "🛒 Order",
              payload: `ORDER_${consistentId}`,
            },
          ],
        };
      });

      await this.sendCarousel(senderId, topResults);

      if (results.length > 5) {
        await this.sendTextMessage(
          senderId,
          `📝 Menampilkan 5 teratas dari ${results.length} hasil.\n\nCari lebih spesifik untuk hasil yang lebih tepat!`
        );
      }

      // Add navigation options after search results
      const navMessage = {
        recipient: { id: senderId },
        message: {
          text: "🔍 Pencarian selesai! Apa yang ingin kamu lakukan selanjutnya?",
          quick_replies: [
            {
              content_type: "text",
              title: "� Cari Lagi",
              payload: "SEARCH_AGAIN",
            },
            {
              content_type: "text",
              title: "�📂 Lihat Katalog",
              payload: "MAIN_MENU",
            },
          ],
        },
      };

      await this.callSendAPI(navMessage);
    } catch (error) {
      console.error("❌ Search error:", error.message);
      await this.sendTextMessage(
        senderId,
        "Maaf, ada error saat mencari produk 😅"
      );
    }
  }

  async sendProductDetail(senderId, productId) {
    try {
      console.log(`📋 Getting product detail for ${productId}`);

      // Parse new ID format: CATEGORY_BRAND_INDEX
      const parts = productId.replace("DETAIL_", "").split("_");
      if (parts.length >= 3) {
        const category = parts[0].toLowerCase();
        const brand = parts[1];
        const index = parseInt(parts[2]);

        const products = await sheetsService.getProductsByBrand(
          category,
          brand
        );
        if (products[index]) {
          const product = products[index];
          const detailText = this.formatProductDetail(product);
          await this.sendTextMessage(senderId, detailText);

          // Send instruction untuk order
          const instructionMessage = {
            recipient: { id: senderId },
            message: {
              text: '💡 **Cara Order:**\nScroll ke atas untuk lihat daftar produk, lalu klik tombol **🛒 Pesan** pada produk yang diinginkan.\n\nAtau ketik "menu" untuk kembali ke kategori.',
              quick_replies: [
                {
                  content_type: "text",
                  title: "� Menu Utama",
                  payload: "MAIN_MENU",
                },
                {
                  content_type: "text",
                  title: "� Kategori Lain",
                  payload: "BACK_TO_CATEGORIES",
                },
              ],
            },
          };
          await this.callSendAPI(instructionMessage);
          return;
        }
      }

      // Fallback to old system
      const productResult = await sheetsService.getProductById(productId);
      if (!productResult.success) {
        await this.sendTextMessage(senderId, "Maaf, produk tidak ditemukan 😅");
        return;
      }

      const product = productResult.product;
      const detailText = this.formatProductDetail(product);
      await this.sendTextMessage(senderId, detailText);

      // Send instruction untuk order
      const instructionMessage = {
        recipient: { id: senderId },
        message: {
          text: '💡 **Cara Order:**\nScroll ke atas untuk lihat daftar produk, lalu klik tombol **🛒 Pesan** pada produk yang diinginkan.\n\nAtau ketik "menu" untuk kembali ke kategori.',
          quick_replies: [
            {
              content_type: "text",
              title: "🔙 Menu Utama",
              payload: "MAIN_MENU",
            },
          ],
        },
      };

      await this.callSendAPI(instructionMessage);
    } catch (error) {
      console.error("❌ Error getting product detail:", error.message);
      await this.sendTextMessage(
        senderId,
        "Maaf, ada error saat mengambil detail produk 😅"
      );
    }
  }

  async startOrderProcess(senderId, productId, session) {
    try {
      console.log(`🛒 Starting order process for ${productId}`);

      let product = null;

      // Parse new ID format: CATEGORY_BRAND_INDEX
      const parts = productId.split("_");
      if (parts.length >= 3) {
        const category = parts[0].toLowerCase();
        const brand = parts[1];
        const index = parseInt(parts[2]);

        const products = await sheetsService.getProductsByBrand(
          category,
          brand
        );
        if (products[index]) {
          product = products[index];
        }
      }

      // Fallback to old system if new format fails
      if (!product) {
        const productResult = await sheetsService.getProductById(productId);
        if (!productResult.success) {
          await this.sendTextMessage(
            senderId,
            "Maaf, produk tidak ditemukan 😅"
          );
          return;
        }
        product = productResult.product;
      }

      // Save product to session
      session.orderData = {
        product_id: productId,
        product: product,
        messenger_id: senderId,
      };
      session.state = "awaiting_name";

      const orderText = `🛒 **ORDER PRODUK**\n\n📦 ${
        product.name
      }\n💰 ${this.formatPrice(product.harga_jual)}${
        product.harga_pasang
          ? `\n🔧 + Pasang: ${this.formatPrice(product.harga_pasang)}`
          : ""
      }\n\n👤 **Untuk melanjutkan order, saya butuh info Anda:**\n\nSilakan ketik **nama lengkap** Anda:`;

      await this.sendTextMessage(senderId, orderText);
    } catch (error) {
      console.error("❌ Error starting order:", error.message);
      await this.sendTextMessage(
        senderId,
        "Maaf, ada error saat memproses order 😅"
      );
    }
  }

  async handleNameInput(senderId, name, session) {
    if (!name || name.trim().length < 2) {
      await this.sendTextMessage(
        senderId,
        "Mohon masukkan nama lengkap yang valid (minimal 2 karakter):"
      );
      return;
    }

    session.orderData.customer_name = name.trim();
    session.state = "awaiting_phone";

    await this.sendTextMessage(
      senderId,
      `Terima kasih ${name.trim()}! 👍\n\nSekarang masukkan **nomor WhatsApp** untuk konfirmasi order:\n\n📱 Format: 08xxx atau +628xxx`
    );
  }

  async handlePhoneInput(senderId, phone, session) {
    const cleanPhone = phone.replace(/[^\d+]/g, "");

    if (!this.isValidPhone(cleanPhone)) {
      await this.sendTextMessage(
        senderId,
        "Nomor WhatsApp tidak valid 😅\n\nContoh format yang benar:\n• 08123456789\n• +628123456789\n\nSilakan masukkan ulang:"
      );
      return;
    }

    const formattedPhone = this.formatPhone(cleanPhone);
    session.orderData.customer_phone = formattedPhone;
    session.state = "processing_order";

    await this.processOrder(senderId, session);
  }

  async processOrder(senderId, session) {
    try {
      console.log("📝 Processing order for", senderId);

      const orderData = {
        customer_name: session.orderData.customer_name,
        customer_phone: session.orderData.customer_phone,
        messenger_id: senderId,
        product_name: session.orderData.product.name,
        category: session.orderData.product.category,
        specifications: session.orderData.product.specifications || "",
        quantity: 1,
        price: session.orderData.product.harga_jual || 0,
        harga_pasang: session.orderData.product.harga_pasang || 0,
        notes: "Order via Facebook Messenger Bot",
      };

      const result = await sheetsService.createOrder(orderData);

      if (result.success) {
        // Clear session
        session.state = null;
        session.orderData = null;

        const confirmationText = `✅ **ORDER BERHASIL!**\n\n📋 **Order ID:** ${
          result.order_id
        }\n👤 **Nama:** ${orderData.customer_name}\n📱 **HP:** ${
          orderData.customer_phone
        }\n📦 **Produk:** ${
          orderData.product_name
        }\n💰 **Total:** ${this.formatPrice(
          result.total_amount
        )}\n\n🎉 **Terima kasih!** Tim kami akan segera menghubungi Anda via WhatsApp untuk konfirmasi dan pengiriman.\n\n📞 **Customer Service:** ${
          process.env.SUPPORT_WHATSAPP || "+628123456789"
        }`;

        await this.sendTextMessage(senderId, confirmationText);

        // Send main menu again
        setTimeout(async () => {
          await this.sendTextMessage(senderId, "Mau order produk lain? 😊");
          await this.sendCategoryMenu(senderId);
        }, 3000);
      } else {
        session.state = null;
        session.orderData = null;
        await this.sendTextMessage(
          senderId,
          `❌ Maaf, order gagal diproses: ${result.error}\n\nSilakan coba lagi atau hubungi customer service.`
        );
      }
    } catch (error) {
      console.error("❌ Error processing order:", error.message);
      session.state = null;
      session.orderData = null;
      await this.sendTextMessage(
        senderId,
        "❌ Maaf, ada error saat memproses order. Silakan coba lagi! 🙏"
      );
    }
  }

  async sendHelpMessage(senderId) {
    const helpText = `❓ **BANTUAN MENGGUNAKAN BOT**\n\n🔍 **Cara Cari Produk:**\n• Ketik "katalog" → pilih kategori\n• Ketik langsung: "ban corsa"\n• Cari spesifik: "oli 20W-50"\n\n🛒 **Cara Order:**\n• Klik tombol "Order" pada produk\n• Isi nama dan nomor WhatsApp\n• Tim kami akan konfirmasi\n\n📋 **Kategori Tersedia:**\n🛞 Ban mobil & motor\n💡 Lampu kendaraan\n🛢️ Oli mesin\n🎨 Cat kendaraan\n\n📞 **Customer Service:**\n${
      process.env.SUPPORT_WHATSAPP || "+628123456789"
    }\n\nKetik "katalog" untuk mulai belanja! 🛒`;

    await this.sendTextMessage(senderId, helpText);
  }

  async handleAttachment(senderId, attachments, session) {
    console.log(
      `📎 Received ${attachments.length} attachment(s) from ${senderId}`
    );

    for (const attachment of attachments) {
      console.log(
        `   Type: ${attachment.type}, URL: ${attachment.payload?.url || "N/A"}`
      );
    }

    await this.sendTextMessage(
      senderId,
      'Terima kasih sudah mengirim attachment! 😊\n\nUntuk order produk, ketik "katalog" atau cari langsung dengan nama produk.'
    );
  }

  // Helper methods
  getUserSession(senderId) {
    if (!this.userSessions.has(senderId)) {
      this.userSessions.set(senderId, {
        state: null,
        orderData: null,
        lastActivity: Date.now(),
      });
    }

    const session = this.userSessions.get(senderId);
    session.lastActivity = Date.now();
    return session;
  }

  formatProductSubtitle(product) {
    let subtitle = "";

    if (product.brand) subtitle += `${product.brand}`;
    if (product.specifications) subtitle += ` • ${product.specifications}`;
    if (product.harga_jual)
      subtitle += `\n💰 ${this.formatPrice(product.harga_jual)}`;
    if (product.harga_pasang)
      subtitle += ` + Pasang ${this.formatPrice(product.harga_pasang)}`;

    return subtitle || "Informasi produk";
  }

  getDefaultProductImage(categoryName) {
    // Using more reliable image service for Facebook Messenger
    const defaultImages = {
      ban: "https://picsum.photos/300/200?random=1",
      oli: "https://picsum.photos/300/200?random=2",
      lampu: "https://picsum.photos/300/200?random=3",
      cat: "https://picsum.photos/300/200?random=4",
    };

    return (
      defaultImages[categoryName.toLowerCase()] ||
      "https://picsum.photos/300/200?random=5"
    );
  }

  getDefaultImage(categoryName) {
    // Alias for getDefaultProductImage for backward compatibility
    return this.getDefaultProductImage(categoryName);
  }

  formatProductDetail(product) {
    let detail = `📦 **${product.name}**\n\n`;

    if (product.brand) detail += `🏷️ **Merk:** ${product.brand}\n`;
    if (product.specifications)
      detail += `📋 **Spesifikasi:** ${product.specifications}\n`;
    if (product.category) detail += `📂 **Kategori:** ${product.category}\n`;
    if (product.harga_jual)
      detail += `💰 **Harga:** ${this.formatPrice(product.harga_jual)}\n`;
    if (product.harga_pasang)
      detail += `🔧 **Harga Pasang:** ${this.formatPrice(
        product.harga_pasang
      )}\n`;

    return detail;
  }

  formatPrice(price) {
    if (!price || price === 0) return "Call";
    return `Rp ${price.toLocaleString("id-ID")}`;
  }

  isValidPhone(phone) {
    // Indonesian phone number validation
    const phoneRegex = /^(\+62|62|08)[0-9]{8,12}$/;
    return phoneRegex.test(phone);
  }

  formatPhone(phone) {
    if (phone.startsWith("08")) {
      return "+62" + phone.substring(1);
    } else if (phone.startsWith("62") && !phone.startsWith("+62")) {
      return "+" + phone;
    } else if (phone.startsWith("+62")) {
      return phone;
    }
    return phone;
  }

  getDefaultImage(category) {
    const defaultImages = {
      ban: "https://via.placeholder.com/300x200/007bff/ffffff?text=🛞+Ban",
      lampu: "https://via.placeholder.com/300x200/ffc107/000000?text=💡+Lampu",
      oli: "https://via.placeholder.com/300x200/28a745/ffffff?text=🛢️+Oli",
      cat: "https://via.placeholder.com/300x200/dc3545/ffffff?text=🎨+Cat",
    };
    return (
      defaultImages[category] ||
      "https://via.placeholder.com/300x200/6c757d/ffffff?text=Product"
    );
  }

  // Facebook API methods
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
    // Extract recipient and message from messageData
    const recipientId = messageData.recipient.id;
    const message = messageData.message;

    return await facebookAPI.sendMessage(recipientId, message);
  }

  // Clean up old sessions (call periodically)
  cleanupSessions() {
    const now = Date.now();
    const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes

    for (const [senderId, session] of this.userSessions.entries()) {
      if (now - session.lastActivity > SESSION_TIMEOUT) {
        this.userSessions.delete(senderId);
        console.log(`🧹 Cleaned up session for ${senderId}`);
      }
    }
  }
}

module.exports = new MessageHandler();
