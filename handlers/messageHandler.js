const sheetsService = require("../services/sheetsService");
const facebookAPI = require("../services/facebookAPI");
const gptService = require("../services/gptService");
const { askForRingSize, showBanProducts } = require("./banFlow");
const { showMotorRecommendations } = require("./motorFlow");
const {
  looksLikeCompleteBanSize,
  looksLikeIncompleteBanSize,
  parseBanSize,
  normalizeBanSize,
  extractRingSize,
} = require("../utils/banSizeParser");

class MessageHandler {
  constructor() {
    this.userSessions = new Map();
  }

  getWhatsAppNumber() {
    return process.env.SUPPORT_WHATSAPP || "081273574202";
  }

  getWhatsAppLink() {
    const number = this.getWhatsAppNumber();
    const internationalNumber = number.startsWith("0")
      ? "62" + number.substring(1)
      : number;
    return `https://wa.me/${internationalNumber}`;
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
          session,
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
        "Maaf, Bella tidak mengerti format pesan tersebut 😅",
      );
    } catch (error) {
      console.error("❌ Error handling message:");
      console.error("Error name:", error?.name);
      console.error("Error message:", error?.message);
      console.error("Error stack:", error?.stack);

      const session = this.userSessions.get(senderId);
      if (session) {
        session.state = null;
        session.banSize = null;
        session.banRing = null;
        session.banUkuran = null;
        session.banBrandPattern = null;
        session.banSearchQuery = null;
        session.motorType = null;
        session.motorPosition = null;
      }
      await this.sendTextMessage(
        senderId,
        "Maaf, ada error. Coba lagi ya! 🙏\n\nKetik ukuran ban atau tipe motor untuk mulai lagi.",
      );
    }
  }

  // =========================
  // TEXT
  // =========================
  async handleTextMessage(senderId, text, session) {
    const rawText = String(text || "");
    const textLower = rawText.toLowerCase().trim();

    // If user was asked to provide manual size, process it here
    if (session && session.state === "awaiting_manual_size") {
      if (looksLikeCompleteBanSize(rawText)) {
        session.banUkuran = normalizeBanSize(rawText);
        session.state = "show_products";
        await showBanProducts(senderId, session);
        return;
      }

      if (looksLikeIncompleteBanSize(rawText)) {
        const [size, ring] = parseBanSize(rawText);
        session.banSize = size;
        session.banRing = ring;
        if (!ring) {
          session.state = "waiting_ring";
          await askForRingSize(senderId, session);
          return;
        } else {
          session.banUkuran = `${size}-${ring}`;
          session.state = "show_products";
          await showBanProducts(senderId, session);
          return;
        }
      }

      await this.sendTextMessage(
        senderId,
        "Maaf, formatnya belum pas. Contoh format: 80/90-14 atau cuma lebar: 80",
      );
      return;
    }

    // First message in a new session — send welcome
    if (session && session.isNew) {
      await this.sendTextMessage(
        senderId,
        "Hallo juragan, dengan Bella Gudang Ban. Cari ban apa?",
      );
      session.isNew = false;
      return;
    }

    // ========== STATE: WAITING FOR BRAND NAME ==========
    if (session && session.state === "waiting_brand_name") {
      const brand = rawText.toLowerCase().trim();
      session.banBrandPattern = brand;

      if (session.banUkuran || session.banSize) {
        session.state = "show_products";
        await showBanProducts(senderId, session);
        return;
      }

      session.state = "waiting_brand_size";
      const displayName = brand.charAt(0).toUpperCase() + brand.slice(1);
      await this.sendTextMessage(
        senderId,
        `Ah mau ban ${displayName}, ukuran berapa juragan?\n\nContoh: 80/90-14`,
      );
      return;
    }

    // ========== DIRECT BAN SIZE INPUT (COMPLETE) ==========
    if (looksLikeCompleteBanSize(rawText)) {
      session.banUkuran = normalizeBanSize(rawText);
      session.state = "show_products";
      await showBanProducts(senderId, session);
      return;
    }

    // ========== MOTOR TYPE DETECTION ==========
    try {
      const carPattern =
        /\bmobil\b|\bcar\b|\bban mobil\b|\bavanza\b|\binnova\b|\bxenia\b|\bbrio\b|\bcity\b|\bjazz\b|\byaris\b|\bcorolla\b|\bfortuner\b|\bpajero\b|\bmobilio\b|\btoyota\b|\bmitsubishi\b/i;
      if (carPattern.test(rawText)) {
        await this.sendTextMessage(
          senderId,
          "Ga tau, kalo soal ban mobil Bella nggak ngerti.",
        );
        return;
      }

      const isMotorcycle = await gptService.isMotorcycleRelated(rawText);
      if (isMotorcycle) {
        session.motorType = rawText.trim();
        session.state = "waiting_motor_position";
        await this.sendTextMessage(senderId, "Ban depan atau belakang?", [
          { content_type: "text", title: "Depan", payload: "MOTOR_DEPAN" },
          {
            content_type: "text",
            title: "Belakang",
            payload: "MOTOR_BELAKANG",
          },
        ]);
        return;
      }
    } catch (error) {
      console.error("Error in GPT motorcycle detection:", error);
    }

    // ========== DIRECT BAN SIZE INPUT (INCOMPLETE - NO RING) ==========
    if (looksLikeIncompleteBanSize(rawText)) {
      const [size, ring] = parseBanSize(rawText);
      session.banSize = size;
      session.banRing = ring;

      if (!ring) {
        session.state = "waiting_ring";
        await askForRingSize(senderId, session);
        return;
      } else {
        session.banUkuran = `${size}-${ring}`;
        session.state = "show_products";
        await showBanProducts(senderId, session);
        return;
      }
    }

    // ========== WIDTH-ONLY INPUT ==========
    let extractedWidth = null;
    let invalidWidth = false;

    const singleWidthMatch = rawText.match(/^\s*(\d{2,3})\s*$/);
    if (singleWidthMatch) {
      const widthNum = parseInt(singleWidthMatch[1]);
      if (widthNum >= 60 && widthNum <= 140) {
        extractedWidth = singleWidthMatch[1];
      } else {
        invalidWidth = true;
      }
    }

    // If text contains "/" it likely embeds a ban size (e.g. "ban 70/90-14 ada?")
    if (!extractedWidth && !invalidWidth && rawText.includes("/")) {
      try {
        const extractedSize = await gptService.extractBanSizeFromText(rawText);
        if (extractedSize) {
          if (looksLikeCompleteBanSize(extractedSize)) {
            session.banUkuran = normalizeBanSize(extractedSize);
            session.state = "show_products";
            await showBanProducts(senderId, session);
            return;
          } else if (looksLikeIncompleteBanSize(extractedSize)) {
            const [size, ring] = parseBanSize(extractedSize);
            session.banSize = size;
            session.banRing = ring;
            if (!ring) {
              session.state = "waiting_ring";
              await askForRingSize(senderId, session);
              return;
            } else {
              session.banUkuran = `${size}-${ring}`;
              session.state = "show_products";
              await showBanProducts(senderId, session);
              return;
            }
          }
        }
      } catch (error) {
        console.error("Error extracting ban size from natural language:", error);
      }
    }

    // If simple match fails, try GPT width extraction
    if (!extractedWidth && !invalidWidth) {
      try {
        const gptWidth = await gptService.extractWidthFromText(rawText);
        if (gptWidth) {
          const widthNum = parseInt(gptWidth);
          if (widthNum >= 60 && widthNum <= 140) {
            extractedWidth = gptWidth;
          } else {
            invalidWidth = true;
          }
        }
      } catch (error) {
        console.error("Error extracting width from text:", error);
      }
    }

    if (invalidWidth) {
      await this.sendTextMessage(
        senderId,
        "Hmm, Bella kurang paham dengan ukuran tersebut 😅\n\nBoleh kasih ukuran ban yang lebih jelas?\n\nContoh:\n• 80/90-14\n• 100/80-17\n• atau tipe motor: Yamaha Mio, Honda Beat",
      );
      return;
    }

    if (extractedWidth) {
      try {
        await facebookAPI.sendTypingOn(senderId);
        const recommendedSizes =
          await gptService.getCompleteBanSizeFromWidth(extractedWidth);

        // Ask user to confirm the outer size (width/aspect) — don't speculate
        const quickReplies = recommendedSizes.slice(0, 3).map((size) => ({
          content_type: "text",
          title: size,
          payload: `SIZE_${size}`,
        }));
        quickReplies.push({
          content_type: "text",
          title: "Ukuran lain",
          payload: "OTHER_SIZE",
        });

        const hint =
          recommendedSizes.length > 0
            ? `\n\nBiasanya untuk lebar ${extractedWidth}: ${recommendedSizes.join(", ")}`
            : "";

        await this.sendTextMessage(
          senderId,
          `Ban lebar ${extractedWidth} ya juragan! Outer size-nya berapa?${hint}`,
          quickReplies,
        );
        return;
      } catch (error) {
        console.error("Error getting complete ban size:", error);
        await this.sendTextMessage(
          senderId,
          `Ban lebar ${extractedWidth} ya juragan! Boleh ketik ukuran lengkap?\n\nContoh: ${extractedWidth}/90-14`,
        );
        return;
      }
    }

    // ========== SELESAI ==========
    if (textLower === "selesai") {
      await this.sendFinishMessage(senderId);
      this.userSessions.delete(senderId);
      return;
    }

    // ========== LIAT LAGI ==========
    if (["liat lagi", "lihat lagi", "cari lagi", "ulang"].includes(textLower)) {
      session.state = null;
      session.banSize = null;
      session.banRing = null;
      session.banUkuran = null;
      session.banBrandPattern = null;
      session.banSearchQuery = null;
      session.motorType = null;
      session.motorPosition = null;
      await this.sendTextMessage(
        senderId,
        "Oke juragan, mau cari ban apa lagi?",
      );
      return;
    }

    // ========== CONFUSION/UNCERTAINTY DETECTION ==========
    const confusionPatterns = [
      /\b(ga?\s*tau|gak\s*tau|tidak\s*tau|gatau|gaktau|gk\s*tau|g\s*tau)\b/i,
      /\b(entah|bingung|dunno|don'?t\s*know|idk|nda\s*tau|ndak\s*tau)\b/i,
      /\b(kurang\s*paham|gak\s*ngerti|ga\s*ngerti|nggak\s*ngerti|tidak\s*tahu)\b/i,
      /\b(gimana|bagaimana|apa\s*ya|yang\s*mana|mana\s*ya)\b/i,
    ];

    let isConfused = confusionPatterns.some((pattern) =>
      pattern.test(textLower),
    );

    if (!isConfused) {
      try {
        isConfused = await gptService.isConfused(rawText);
      } catch (error) {
        console.error("Error in GPT confusion detection:", error);
      }
    }

    if (isConfused) {
      session.state = null;
      session.banSize = null;
      session.banRing = null;
      session.banUkuran = null;
      session.banBrandPattern = null;
      session.banSearchQuery = null;
      session.motorType = null;
      session.motorPosition = null;
      await this.sendTextMessage(
        senderId,
        "Gak apa-apa juragan! Kalau bingung ukuran ban nya, bisa kasih tau nama motornya aja 😊\n\nContoh:\n• Honda Beat\n• Yamaha Mio\n• Suzuki Nex\n• atau motor lainnya",
      );
      return;
    }

    // ========== STATE: WAITING FOR RING SIZE ==========
    if (session.state === "waiting_ring") {
      let extractedNumber = extractRingSize(rawText);

      if (!extractedNumber) {
        try {
          extractedNumber = await gptService.extractRingSizeFromText(rawText);
          if (extractedNumber) {
            console.log(
              `GPT extracted ring number: ${extractedNumber} from "${rawText}"`,
            );
          }
        } catch (error) {
          console.error("Error in GPT ring size extraction:", error);
        }
      }

      if (extractedNumber) {
        try {
          const allBanProducts =
            await sheetsService.getProductsByCategory("ban");
          const availableRings = new Set();

          allBanProducts.forEach((product) => {
            const spec = String(
              product.specifications || product.SPESIFIKASI || "",
            );
            if (spec.includes(session.banSize)) {
              const match = spec.match(
                new RegExp(
                  `${session.banSize.replace(/\//g, "\\/")}-(\\d{2})`,
                ),
              );
              if (match) {
                availableRings.add(match[1]);
              }
            }
          });

          const availableRingsArray = Array.from(availableRings);
          const matchedRing = availableRingsArray.includes(extractedNumber)
            ? extractedNumber
            : null;

          if (matchedRing) {
            session.banRing = matchedRing;
            session.banUkuran = `${session.banSize}-${matchedRing}`;
            session.state = "show_products";
            await showBanProducts(senderId, session);
            return;
          } else {
            if (availableRingsArray.length > 0) {
              const ringList = availableRingsArray.join(", ");
              await this.sendTextMessage(
                senderId,
                `Maaf, ring ${extractedNumber} tidak tersedia untuk ban ${session.banSize} 😔\n\nRing yang tersedia: ${ringList}\n\nSilakan pilih salah satu atau ketik ring yang benar.`,
              );
              return;
            } else {
              await this.sendTextMessage(
                senderId,
                `Maaf, tidak ada ring yang tersedia untuk ban ${session.banSize} 😔\n\nKetik ulang ukuran ban atau tipe motor yang juragan cari.`,
              );
              session.state = null;
              session.banSize = null;
              return;
            }
          }
        } catch (error) {
          console.error("Error matching ring size:", error);
          await this.sendTextMessage(
            senderId,
            "Maaf, ada error. Boleh ketik ukuran ring lagi? Contoh: 14, 17, 10",
          );
          return;
        }
      } else {
        try {
          const isMotorcycle = await gptService.isMotorcycleRelated(rawText);
          if (isMotorcycle) {
            session.motorType = rawText.trim();
            session.banSize = null;
            session.banRing = null;

            const positionKeywords = {
              depan: ["depan", "front", "ban depan", "roda depan"],
              belakang: [
                "belakang",
                "back",
                "rear",
                "ban belakang",
                "roda belakang",
              ],
            };

            let detectedPosition = null;
            for (const [pos, keywords] of Object.entries(positionKeywords)) {
              if (keywords.some((kw) => textLower.includes(kw))) {
                detectedPosition = pos;
                break;
              }
            }

            if (detectedPosition) {
              session.motorPosition = detectedPosition;
              session.state = "showing_motor_recommendations";
              await showMotorRecommendations(senderId, session);
              return;
            } else {
              session.state = "waiting_motor_position";
              await this.sendTextMessage(senderId, "Ban depan atau belakang?", [
                {
                  content_type: "text",
                  title: "Depan",
                  payload: "MOTOR_DEPAN",
                },
                {
                  content_type: "text",
                  title: "Belakang",
                  payload: "MOTOR_BELAKANG",
                },
              ]);
              return;
            }
          }
        } catch (error) {
          console.error("Error in motorcycle detection for ring size:", error);
        }

        await this.sendTextMessage(
          senderId,
          "Maaf, Bella kurang paham. Boleh ketik ukuran ring saja? Contoh: 14, 17, 10",
        );
        return;
      }
    }

    // ========== STATE: WAITING FOR BRAND SIZE ==========
    if (session.state === "waiting_brand_size") {
      if (looksLikeCompleteBanSize(rawText)) {
        session.banUkuran = normalizeBanSize(rawText);
        session.banSearchQuery = session.banBrandPattern;
        session.state = "show_products";
        await showBanProducts(senderId, session);
        return;
      } else if (looksLikeIncompleteBanSize(rawText)) {
        const [size, ring] = parseBanSize(rawText);
        session.banSize = size;
        session.banRing = ring;

        if (!ring) {
          session.state = "waiting_ring";
          await askForRingSize(senderId, session);
          return;
        } else {
          session.banUkuran = `${size}-${ring}`;
          session.banSearchQuery = session.banBrandPattern;
          session.state = "show_products";
          await showBanProducts(senderId, session);
          return;
        }
      } else {
        try {
          const extractedSize =
            await gptService.extractBanSizeFromText(rawText);
          if (extractedSize) {
            console.log(
              `GPT extracted ban size: ${extractedSize} from "${rawText}"`,
            );

            if (looksLikeCompleteBanSize(extractedSize)) {
              session.banUkuran = normalizeBanSize(extractedSize);
              session.banSearchQuery = session.banBrandPattern;
              session.state = "show_products";
              await showBanProducts(senderId, session);
              return;
            } else if (looksLikeIncompleteBanSize(extractedSize)) {
              const [size, ring] = parseBanSize(extractedSize);
              session.banSize = size;
              session.banRing = ring;
              if (!ring) {
                session.state = "waiting_ring";
                await askForRingSize(senderId, session);
                return;
              } else {
                session.banUkuran = `${size}-${ring}`;
                session.banSearchQuery = session.banBrandPattern;
                session.state = "show_products";
                await showBanProducts(senderId, session);
                return;
              }
            }
          }
        } catch (error) {
          console.error("Error in GPT extraction for brand size:", error);
        }

        try {
          const isMotorcycle = await gptService.isMotorcycleRelated(rawText);
          if (isMotorcycle) {
            session.motorType = rawText.trim();

            const positionKeywords = {
              depan: ["depan", "front", "ban depan", "roda depan"],
              belakang: [
                "belakang",
                "back",
                "rear",
                "ban belakang",
                "roda belakang",
              ],
            };

            let detectedPosition = null;
            for (const [pos, keywords] of Object.entries(positionKeywords)) {
              if (keywords.some((kw) => textLower.includes(kw))) {
                detectedPosition = pos;
                break;
              }
            }

            if (detectedPosition) {
              session.motorPosition = detectedPosition;
              session.state = "showing_motor_recommendations";
              await showMotorRecommendations(senderId, session);
              return;
            } else {
              session.state = "waiting_motor_position";
              await this.sendTextMessage(senderId, "Ban depan atau belakang?", [
                {
                  content_type: "text",
                  title: "Depan",
                  payload: "MOTOR_DEPAN",
                },
                {
                  content_type: "text",
                  title: "Belakang",
                  payload: "MOTOR_BELAKANG",
                },
              ]);
              return;
            }
          }
        } catch (error) {
          console.error(
            "Error in motorcycle detection for brand size:",
            error,
          );
        }

        await this.sendTextMessage(
          senderId,
          "Maaf, Bella kurang paham. Bisa ketik ukuran ban? Contoh: 80/90-14",
        );
        return;
      }
    }

    // ========== STATE: MOTOR TYPE INPUT ==========
    if (session.state === "waiting_motor_type") {
      session.motorType = rawText.trim();
      session.state = "waiting_motor_position";
      await this.sendTextMessage(senderId, "Ban depan atau belakang?", [
        { content_type: "text", title: "Depan", payload: "MOTOR_DEPAN" },
        { content_type: "text", title: "Belakang", payload: "MOTOR_BELAKANG" },
      ]);
      return;
    }

    // ========== STATE: MOTOR POSITION INPUT ==========
    if (session.state === "waiting_motor_position") {
      const pos = textLower.includes("depan")
        ? "depan"
        : textLower.includes("belakang")
          ? "belakang"
          : null;
      if (pos) {
        session.motorPosition = pos;
        session.state = "showing_motor_recommendations";
        await showMotorRecommendations(senderId, session);
        return;
      } else {
        await this.sendTextMessage(
          senderId,
          "Pilih 'depan' atau 'belakang' ya juragan",
          [
            { content_type: "text", title: "Depan", payload: "MOTOR_DEPAN" },
            {
              content_type: "text",
              title: "Belakang",
              payload: "MOTOR_BELAKANG",
            },
          ],
        );
        return;
      }
    }

    // ========== STATE: USER CHOOSES SIZE AFTER MOTOR RECOMMENDATION ==========
    if (session.state === "showing_motor_recommendations") {
      if (looksLikeCompleteBanSize(rawText)) {
        session.banUkuran = normalizeBanSize(rawText);
        session.state = "show_products";
        await showBanProducts(senderId, session);
        return;
      } else if (looksLikeIncompleteBanSize(rawText)) {
        const [size, ring] = parseBanSize(rawText);
        session.banSize = size;
        session.banRing = ring;
        if (!ring) {
          session.state = "waiting_ring";
          await askForRingSize(senderId, session);
          return;
        } else {
          session.banUkuran = `${size}-${ring}`;
          session.state = "show_products";
          await showBanProducts(senderId, session);
          return;
        }
      } else {
        try {
          const extractedSize =
            await gptService.extractBanSizeFromText(rawText);
          if (extractedSize) {
            console.log(
              `GPT extracted ban size in motor recommendations: ${extractedSize} from "${rawText}"`,
            );

            if (looksLikeCompleteBanSize(extractedSize)) {
              session.banUkuran = normalizeBanSize(extractedSize);
              session.state = "show_products";
              await showBanProducts(senderId, session);
              return;
            } else if (looksLikeIncompleteBanSize(extractedSize)) {
              const [size, ring] = parseBanSize(extractedSize);
              session.banSize = size;
              session.banRing = ring;
              if (!ring) {
                session.state = "waiting_ring";
                await askForRingSize(senderId, session);
                return;
              } else {
                session.banUkuran = `${size}-${ring}`;
                session.state = "show_products";
                await showBanProducts(senderId, session);
                return;
              }
            }
          }
        } catch (error) {
          console.error(
            "Error in GPT extraction in motor recommendations:",
            error,
          );
        }

        await this.sendTextMessage(
          senderId,
          "Bella kurang paham, bisa ketik ukuran ban yang juragan mau? Contoh: 80/90-14 atau pilih dari rekomendasi di atas",
        );
        return;
      }
    }

    // ========== STATE: AFTER SHOWING PRODUCTS ==========
    if (session.state === "after_products") {
      if (["liat lagi", "lihat lagi", "cari lagi"].includes(textLower)) {
        session.state = null;
        await this.sendWelcomeMessage(senderId);
        return;
      }
      if (textLower === "selesai") {
        await this.sendFinishMessage(senderId);
        this.userSessions.delete(senderId);
        return;
      }

      const negativePatterns = [
        /^(gak\s*mau|ga\s*mau|tidak\s*mau|bukan|selain|lain|nggak\s*mau)$/i,
        /(^tidak|^enggak|^gak)\b/i,
      ];

      if (session.onlyPreferredShown) {
        const isNegative = negativePatterns.some((r) => r.test(textLower));
        if (isNegative) {
          try {
            const preferredOrder = ["maxxis", "irc", "fdr"];
            const others = (session.fullMatchedProducts || []).filter((p) => {
              const brand = String(p.brand || p.MERK || "").toLowerCase();
              return !preferredOrder.some((pref) => brand.includes(pref));
            });

            if (others.length > 0) {
              session.allProducts = others;
              session.onlyPreferredShown = false;
              session.currentPage = 1;
              session.totalPages = Math.ceil(others.length / 10);
              session.state = "show_products";
              await showBanProducts(senderId, session);
              return;
            }
          } catch (error) {
            console.error("Error finding non-preferred products:", error);
          }

          session.state = "waiting_brand_name";
          await this.sendTextMessage(
            senderId,
            "Oke juragan, merk apa yang juragan mau? Ketik nama merk-nya saja, misal: Michelin, Pirelli",
          );
          return;
        }
      }

      const looksLikeBrandInput =
        textLower.length <= 30 &&
        !textLower.includes("/") &&
        !textLower.includes("-") &&
        /[a-z]/.test(textLower);

      if (looksLikeBrandInput) {
        try {
          const allBanProducts =
            await sheetsService.getProductsByCategory("ban");
          const allBrands = new Set();
          allBanProducts.forEach((product) => {
            const brand = String(product.brand || product.MERK || "")
              .toLowerCase()
              .trim();
            if (brand) allBrands.add(brand);
          });

          const matchedBrand = Array.from(allBrands).find(
            (b) => textLower.includes(b) || b.includes(textLower),
          );

          if (matchedBrand) {
            session.banBrandPattern = matchedBrand;

            if (session.banUkuran || session.banSize) {
              session.state = "show_products";
              await showBanProducts(senderId, session);
              return;
            } else {
              session.state = "waiting_brand_size";
              const displayName =
                matchedBrand.charAt(0).toUpperCase() + matchedBrand.slice(1);
              await this.sendTextMessage(
                senderId,
                `Ah mau ban ${displayName}, ukuran berapa juragan?\n\nContoh: 80/90-14`,
              );
              return;
            }
          }
        } catch (error) {
          console.error("Error matching brand in after_products:", error);
        }
      }

      if (session.motorType) {
        if (["depan lagi", "liat depan lagi"].includes(textLower)) {
          session.motorPosition = "depan";
          session.state = "showing_motor_recommendations";
          await showMotorRecommendations(senderId, session);
          return;
        }
        if (
          ["belakang", "liat belakang", "yang belakang"].includes(textLower)
        ) {
          session.motorPosition = "belakang";
          session.state = "showing_motor_recommendations";
          await showMotorRecommendations(senderId, session);
          return;
        }
      }
    }

    // ========== STATE: AFTER PRICE CHECK ==========
    if (session.state === "after_price_check") {
      if (
        ["liat lagi", "lihat lagi", "liat-liat lagi", "cari lagi"].includes(
          textLower,
        )
      ) {
        session.state = null;
        await this.sendWelcomeMessage(senderId);
        return;
      }
      if (textLower === "selesai") {
        await this.sendFinishMessage(senderId);
        this.userSessions.delete(senderId);
        return;
      }
    }

    // ========== TRY GPT EXTRACTION FOR BAN SIZE ==========
    if (
      !looksLikeCompleteBanSize(rawText) &&
      !looksLikeIncompleteBanSize(rawText)
    ) {
      try {
        const extractedSize = await gptService.extractBanSizeFromText(rawText);
        if (extractedSize) {
          console.log(
            `GPT extracted ban size: ${extractedSize} from "${rawText}"`,
          );

          if (looksLikeCompleteBanSize(extractedSize)) {
            session.banUkuran = normalizeBanSize(extractedSize);
            session.state = "show_products";
            await showBanProducts(senderId, session);
            return;
          } else if (looksLikeIncompleteBanSize(extractedSize)) {
            const [size, ring] = parseBanSize(extractedSize);
            session.banSize = size;
            session.banRing = ring;

            if (!ring) {
              session.state = "waiting_ring";
              await askForRingSize(senderId, session);
              return;
            } else {
              session.banUkuran = `${size}-${ring}`;
              session.state = "show_products";
              await showBanProducts(senderId, session);
              return;
            }
          }
        }
      } catch (error) {
        console.error("Error in GPT ban size extraction:", error);
      }
    }

    // ========== BRAND/PATTERN DETECTION ==========
    const brandPatternKeywords = [
      "aspira", "fdr", "corsa", "irc", "maxxis", "michelin", "pirelli",
      "dunlop", "swallow", "zeneos", "mizzle",
      "platinum", "diamond", "sportivo", "strada", "evoluzion", "battlax",
      "tubeless", "r46", "r26", "r93", "victra", "pilot", "city", "scooter",
      "sport", "touring",
    ];
    const containsBrandPattern = brandPatternKeywords.some((kw) =>
      textLower.includes(kw),
    );

    if (containsBrandPattern) {
      const mentioned = brandPatternKeywords.find((kw) =>
        textLower.includes(kw),
      );
      session.banBrandPattern = mentioned;
      session.state = "waiting_brand_size";
      const displayName =
        mentioned.charAt(0).toUpperCase() + mentioned.slice(1);
      await this.sendTextMessage(
        senderId,
        `Ah mau ban ${displayName}, ukuran berapa juragan?\n\nContoh: 80/90-14`,
      );
      return;
    }

    // ========== GPT-BASED BRAND/PATTERN DETECTION ==========
    if (
      textLower.length <= 20 &&
      !textLower.includes("/") &&
      !textLower.includes("-")
    ) {
      try {
        const allBanProducts = await sheetsService.getProductsByCategory("ban");
        const allBrands = new Set();
        const allPatterns = new Set();

        allBanProducts.forEach((product) => {
          const brand = String(product.brand || product.MERK || "")
            .toLowerCase()
            .trim();
          const pattern = String(product.pattern || product.PATTERN || "")
            .toLowerCase()
            .trim();
          if (brand) allBrands.add(brand);
          if (pattern) allPatterns.add(pattern);
        });

        const matchedBrand = Array.from(allBrands).find(
          (b) => textLower.includes(b) || b.includes(textLower),
        );
        const matchedPattern = Array.from(allPatterns).find(
          (p) => textLower.includes(p) || p.includes(textLower),
        );

        if (matchedBrand || matchedPattern) {
          const matched = matchedBrand || matchedPattern;
          session.banBrandPattern = matched;
          session.state = "waiting_brand_size";
          const displayName =
            matched.charAt(0).toUpperCase() + matched.slice(1);
          await this.sendTextMessage(
            senderId,
            `Ah mau ban ${displayName}, ukuran berapa juragan?\n\nContoh: 80/90-14`,
          );
          return;
        }
      } catch (error) {
        console.error("Error in brand/pattern detection:", error);
      }
    }

    // ========== GREETING DETECTION ==========
    const greetings = [
      "halo", "hello", "hai", "hi", "hey", "hallo", "helo",
      "selamat pagi", "pagi", "selamat siang", "siang",
      "selamat sore", "sore", "selamat malam", "malam",
      "assalamualaikum", "assalamu'alaikum", "salam",
      "permisi", "gan", "juragan", "bro", "sis", "start", "mulai",
    ];

    if (greetings.includes(textLower)) {
      await this.sendWelcomeMessage(senderId);
      return;
    }

    try {
      const isGreeting = await gptService.isGreeting(rawText);
      if (isGreeting) {
        await this.sendWelcomeMessage(senderId);
        return;
      }
    } catch (error) {
      console.error("Error in GPT greeting detection:", error);
    }

    // ========== DEFAULT: DON'T UNDERSTAND ==========
    try {
      const isBanRelated = await gptService.isBanRelated(rawText);

      if (isBanRelated) {
        await this.sendTextMessage(
          senderId,
          `Ah iya, kita menyediakan ban! Mau ban apa?\n\n• Ketik ukuran ban (contoh: 80/90-14)\n• Atau ketik tipe motor (contoh: Yamaha Mio)`,
        );
      } else {
        await this.sendTextMessage(
          senderId,
          `Maaf, Bella kurang paham. Untuk info lebih lanjut klik link:\n📞 ${this.getWhatsAppLink()}`,
        );
      }
    } catch (error) {
      console.error("Error checking ban-related:", error);
      await this.sendTextMessage(
        senderId,
        `Maaf, Bella kurang paham. Untuk info lebih lanjut klik link:\n📞 ${this.getWhatsAppLink()}`,
      );
    }
  }

  // =========================
  // QUICK REPLY
  // =========================
  async handleQuickReply(senderId, payload, session) {
    payload = String(payload || "");
    console.log(`🔘 Quick reply from ${senderId}: ${payload}`);

    if (payload.startsWith("BAN_SIZE_")) {
      const size = payload
        .replace("BAN_SIZE_", "")
        .replace(/_/g, "/")
        .replace(/~/g, "-");
      session.banUkuran = size;
      session.state = "show_products";
      await showBanProducts(senderId, session);
      return;
    }

    if (payload.startsWith("SIZE_")) {
      const size = payload.replace("SIZE_", "");
      session.banSize = size;
      session.state = "waiting_ring";
      await askForRingSize(senderId, session);
      return;
    }

    if (payload === "OTHER_SIZE") {
      session.state = "awaiting_manual_size";
      await this.sendTextMessage(
        senderId,
        "Oke juragan, ketik ukuran lengkap yang juragan mau (contoh: 80/90-14) atau hanya lebar (contoh: 80)",
      );
      return;
    }

    if (payload.startsWith("RING_")) {
      const ring = payload.replace("RING_", "");
      session.banRing = ring;
      session.banUkuran = `${session.banSize}-${ring}`;
      session.state = "show_products";
      await showBanProducts(senderId, session);
      return;
    }

    if (payload === "MOTOR_DEPAN") {
      session.motorPosition = "depan";
      session.state = "showing_motor_recommendations";
      await showMotorRecommendations(senderId, session);
      return;
    }

    if (payload === "MOTOR_BELAKANG") {
      session.motorPosition = "belakang";
      session.state = "showing_motor_recommendations";
      await showMotorRecommendations(senderId, session);
      return;
    }

    if (payload.startsWith("MOTOR_CHOOSE_")) {
      const size = payload
        .replace("MOTOR_CHOOSE_", "")
        .replace(/_/g, "/")
        .replace(/~/g, "-");
      session.banUkuran = size;
      session.state = "show_products";
      await showBanProducts(senderId, session);
      return;
    }

    if (payload === "NEXT_PAGE") {
      if (session.currentPage < session.totalPages) {
        session.currentPage++;
        await showBanProducts(senderId, session);
      }
      return;
    }

    if (payload === "PREV_PAGE") {
      if (session.currentPage > 1) {
        session.currentPage--;
        await showBanProducts(senderId, session);
      }
      return;
    }

    if (payload === "LIAT_LAGI") {
      session.state = null;
      session.banSize = null;
      session.banRing = null;
      session.banUkuran = null;
      session.banBrandPattern = null;
      session.banSearchQuery = null;
      session.motorType = null;
      session.motorPosition = null;
      session.currentPage = 1;
      session.totalPages = 1;
      session.allProducts = [];
      await this.sendTextMessage(
        senderId,
        "Oke juragan, mau cari ban apa lagi?",
      );
      return;
    }

    if (payload === "SELESAI") {
      await this.sendFinishMessage(senderId);
      this.userSessions.delete(senderId);
      return;
    }

    if (payload === "OTHER_MERK") {
      session.state = "waiting_brand_name";
      await this.sendTextMessage(
        senderId,
        "Oke juragan, merk apa yang juragan mau? Ketik nama merk-nya ya (contoh: Michelin, Pirelli)",
      );
      return;
    }

    if (payload === "MOTOR_DEPAN_LAGI") {
      session.motorPosition = "depan";
      session.state = "showing_motor_recommendations";
      await showMotorRecommendations(senderId, session);
      return;
    }

    if (payload === "MOTOR_BELAKANG_NOW") {
      session.motorPosition = "belakang";
      session.state = "showing_motor_recommendations";
      await showMotorRecommendations(senderId, session);
      return;
    }

    if (payload === "INPUT_TIPE_MOTOR") {
      session.state = "waiting_motor_type";
      await this.sendTextMessage(
        senderId,
        "Boleh tau tipe motornya apa, juragan? Contoh: Yamaha Mio, Honda Beat",
      );
      return;
    }

    await this.sendWelcomeMessage(senderId);
  }

  // =========================
  // POSTBACK
  // =========================
  async handlePostback(senderId, postback) {
    const payload = String(postback?.payload || "");
    const session = await this.getUserSession(senderId);

    console.log(`🎯 Postback from ${senderId}: ${payload}`);

    if (payload === "GET_STARTED") {
      await this.sendWelcomeMessage(senderId);
      return;
    }

    if (payload.startsWith("CEK_HARGA_")) {
      try {
        const base64Data = payload.replace("CEK_HARGA_", "");
        const productData = JSON.parse(
          Buffer.from(base64Data, "base64").toString("utf8"),
        );

        let priceText = `💰 **${productData.name}**\n`;
        if (productData.brand) priceText += `🏷️ Merk: ${productData.brand}\n`;
        if (productData.spec)
          priceText += `📋 Spesifikasi: ${productData.spec}\n`;

        if (productData.harga_pasang) {
          const hargaPasangDisplay = productData.harga_pasang * 1000;
          priceText += `\n🔧 **Harga Pasang: Rp ${hargaPasangDisplay.toLocaleString("id-ID")}**\n`;
          priceText += `\n🛒 Untuk menanyakan ketersediaan stok, hubungi nomor di bawah:\n📞 ${this.getWhatsAppLink()}\n`;
        } else {
          priceText += `\n💬 Untuk info harga terbaru, klik link:\n📞 ${this.getWhatsAppLink()}\n`;
        }

        await this.sendTextMessage(senderId, priceText, [
          {
            content_type: "text",
            title: "🔍 Liat-liat Lagi",
            payload: "LIAT_LAGI",
          },
          { content_type: "text", title: "✅ Selesai", payload: "SELESAI" },
        ]);

        session.state = "after_price_check";
      } catch (error) {
        console.error("Error handling CEK_HARGA:", error);
        session.state = null;
        await this.sendTextMessage(
          senderId,
          `Maaf, ada error saat mengecek harga 😔\n\nUntuk info harga, klik link:\n📞 ${this.getWhatsAppLink()}`,
        );
      }
      return;
    }

    await this.handleQuickReply(senderId, payload, session);
  }

  // =========================
  // SESSION
  // =========================
  async getUserSession(senderId) {
    const SESSION_TIMEOUT = 24 * 60 * 60 * 1000;
    const now = Date.now();

    const fresh = () => ({
      state: null,
      lastActivity: now,
      isNew: true,
      banSize: null,
      banRing: null,
      banUkuran: null,
      motorType: null,
      motorPosition: null,
      currentPage: 1,
      totalPages: 1,
      allProducts: [],
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
    s.isNew = false;
    return s;
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

  // =========================
  // WELCOME & FINISH
  // =========================
  async sendWelcomeMessage(senderId) {
    await this.sendTextMessage(
      senderId,
      "Hallo juragan, dengan Bella Gudang Ban. Cari ban apa?",
    );
  }

  async sendFinishMessage(senderId) {
    const finishText = `Terima kasih sudah menggunakan layanan Bella! 😊

Untuk order atau info lebih lanjut, klik link:
📞 ${this.getWhatsAppLink()}
📍 **Alamat:** https://maps.app.goo.gl/DCjy76XTXcPyKWdH9

Sampai jumpa lagi, juragan! 👋`;

    await this.sendTextMessage(senderId, finishText);
  }

  async handleAttachment(senderId, attachments, session) {
    await this.sendTextMessage(
      senderId,
      `Terima kasih! Untuk order, klik link WhatsApp di bawah 😊\n\n📞 ${this.getWhatsAppLink()}`,
      [{ content_type: "text", title: "🔍 Lihat Ban", payload: "LIAT_LAGI" }],
    );
  }
}

module.exports = new MessageHandler();
