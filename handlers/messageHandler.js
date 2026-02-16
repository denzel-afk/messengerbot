// MessageHandler.js - Simplified BAN-only version
const sheetsService = require("../services/sheetsService");
const facebookAPI = require("../services/facebookAPI");
const gptService = require("../services/gptService");

class MessageHandler {
  constructor() {
    this.userSessions = new Map();
  }

  getWhatsAppNumber() {
    return process.env.SUPPORT_WHATSAPP || "081273574202";
  }

  getWhatsAppLink() {
    const number = this.getWhatsAppNumber();
    // Convert 08xxx to 628xxx for international format
    const internationalNumber = number.startsWith('0') ? '62' + number.substring(1) : number;
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
        "Maaf, Bella tidak mengerti format pesan tersebut 😅"
      );
    } catch (error) {
      console.error("❌ Error handling message:");
      console.error("Error name:", error?.name);
      console.error("Error message:", error?.message);
      console.error("Error stack:", error?.stack);
      
      // Reset session on error
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
      await this.sendTextMessage(senderId, "Maaf, ada error. Coba lagi ya! 🙏\n\nKetik ukuran ban atau tipe motor untuk mulai lagi.");
    }
  }

  // =========================
  // TEXT
  // =========================
  async handleTextMessage(senderId, text, session) {
    const rawText = String(text || "");
    const textLower = rawText.toLowerCase().trim();

    // ========== DIRECT BAN SIZE INPUT (COMPLETE) - CHECK FIRST ==========
    if (this.looksLikeCompleteBanSize(rawText)) {
      session.banUkuran = this.normalizeBanSize(rawText);
      session.state = "show_products";
      await this.showBanProducts(senderId, session);
      return;
    }

    // ========== DIRECT BAN SIZE INPUT (INCOMPLETE - NO RING) ==========
    if (this.looksLikeIncompleteBanSize(rawText)) {
      const [size, ring] = this.parseBanSize(rawText);
      session.banSize = size;
      session.banRing = ring;
      
      if (!ring) {
        session.state = "waiting_ring";
        await this.askForRingSize(senderId, session);
        return;
      } else {
        session.banUkuran = `${size}-${ring}`;
        session.state = "show_products";
        await this.showBanProducts(senderId, session);
        return;
      }
    }

    // ========== WIDTH-ONLY INPUT (flexible detection) ==========
    // Try simple pattern first: "80", "90", "100"
    let extractedWidth = null;
    let invalidWidth = false;
    
    const singleWidthMatch = rawText.match(/^\s*(\d{2,3})\s*$/);
    if (singleWidthMatch) {
      const widthNum = parseInt(singleWidthMatch[1]);
      if (widthNum >= 60 && widthNum <= 140) {
        extractedWidth = singleWidthMatch[1];
      } else {
        // Width out of reasonable range
        invalidWidth = true;
      }
    }
    
    // If simple match fails, try GPT extraction from natural language
    if (!extractedWidth && !invalidWidth) {
      try {
        // Try to extract width from phrases like "saya mau ban 120", "cari ban 80"
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
    
    // Handle invalid width
    if (invalidWidth) {
      await this.sendTextMessage(
        senderId,
        "Hmm, Bella kurang paham dengan ukuran tersebut 😅\n\nBoleh kasih ukuran ban yang lebih jelas?\n\nContoh:\n• 80/90-14\n• 100/80-17\n• atau tipe motor: Yamaha Mio, Honda Beat"
      );
      return;
    }
    
    // If width is extracted and valid, show recommendations
    if (extractedWidth) {
      try {
        await this.sendTypingOn(senderId);
        
        // Get GPT recommendations for complete sizes
        const recommendedSizes = await gptService.getCompleteBanSizeFromWidth(extractedWidth);
        
        if (recommendedSizes.length > 0) {
          const sizeButtons = recommendedSizes.map(size => ({
            content_type: "text",
            title: size,
            payload: `SIZE_${size}`
          }));
          
          await this.sendTextMessage(
            senderId, 
            `Oh ban ${extractedWidth} ya! Biasanya ukuran ban dengan lebar luar ${extractedWidth} adalah:\n\n${recommendedSizes.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n\nPilih salah satu atau ketik ukuran lengkap:`,
            sizeButtons
          );
          return;
        } else {
          // No recommendations found for this width
          await this.sendTextMessage(
            senderId,
            `Maaf, Bella tidak menemukan ukuran ban untuk lebar ${extractedWidth} 😔\n\nBoleh coba ketik ukuran lengkap atau tipe motor?\n\nContoh:\n• 80/90-14\n• Yamaha Mio\n• Honda Beat`
          );
          return;
        }
      } catch (error) {
        console.error("Error getting complete ban size:", error);
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
      await this.sendWelcomeMessage(senderId);
      return;
    }

    // ========== MOTOR TYPE DETECTION (GPT-POWERED) - PRIORITIZE ==========
    try {
      const isMotorcycle = await gptService.isMotorcycleRelated(rawText);
      if (isMotorcycle) {
        session.motorType = rawText.trim();
        session.state = "waiting_motor_position";
        await this.sendTextMessage(senderId, "Ban depan atau belakang?", [
          { content_type: "text", title: "Depan", payload: "MOTOR_DEPAN" },
          { content_type: "text", title: "Belakang", payload: "MOTOR_BELAKANG" },
        ]);
        return;
      }
    } catch (error) {
      console.error("Error in GPT motorcycle detection:", error);
      // Continue to confusion detection if motor detection fails
    }

    // ========== CONFUSION/UNCERTAINTY DETECTION ==========
    const confusionPatterns = [
      /\b(ga?\s*tau|gak\s*tau|tidak\s*tau|gatau|gaktau|gk\s*tau|g\s*tau)\b/i,
      /\b(entah|bingung|dunno|don'?t\s*know|idk|nda\s*tau|ndak\s*tau)\b/i,
      /\b(kurang\s*paham|gak\s*ngerti|ga\s*ngerti|nggak\s*ngerti|tidak\s*tahu)\b/i,
      /\b(gimana|bagaimana|apa\s*ya|yang\s*mana|mana\s*ya)\b/i,
    ];
    
    let isConfused = confusionPatterns.some(pattern => pattern.test(textLower));
    
    // If pattern doesn't match, try GPT for nuanced confusion detection
    if (!isConfused) {
      try {
        isConfused = await gptService.isConfused(rawText);
      } catch (error) {
        console.error("Error in GPT confusion detection:", error);
        // Continue if GPT fails
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
        "Gak apa-apa juragan! Kalau bingung ukuran ban nya, bisa kasih tau nama motornya aja 😊\n\nContoh:\n• Honda Beat\n• Yamaha Mio\n• Suzuki Nex\n• atau motor lainnya"
      );
      return;
    }

    // ========== STATE: WAITING FOR RING SIZE ==========
    if (session.state === "waiting_ring") {
      // Extract number from user's message
      let extractedNumber = this.extractRingSize(rawText);
      
      // If direct extraction fails, try GPT
      if (!extractedNumber) {
        try {
          extractedNumber = await gptService.extractRingSizeFromText(rawText);
          if (extractedNumber) {
            console.log(`GPT extracted ring number: ${extractedNumber} from "${rawText}"`);
          }
        } catch (error) {
          console.error("Error in GPT ring size extraction:", error);
        }
      }
      
      if (extractedNumber) {
        // Get available ring sizes for this ban size
        try {
          const allBanProducts = await sheetsService.getProductsByCategory("ban");
          const availableRings = new Set();
          
          allBanProducts.forEach(product => {
            const spec = String(product.specifications || product.SPESIFIKASI || "");
            if (spec.includes(session.banSize)) {
              const match = spec.match(new RegExp(`${session.banSize.replace(/\//g, "\\/")}-(\\d{2})`));
              if (match) {
                availableRings.add(match[1]);
              }
            }
          });

          const availableRingsArray = Array.from(availableRings);
          
          // Match extracted number with available rings - EXACT MATCH ONLY
          let matchedRing = null;
          
          if (availableRingsArray.includes(extractedNumber)) {
            // Exact match found
            matchedRing = extractedNumber;
          }
          
          if (matchedRing) {
            session.banRing = matchedRing;
            session.banUkuran = `${session.banSize}-${matchedRing}`;
            session.state = "show_products";
            await this.showBanProducts(senderId, session);
            return;
          } else {
            // No exact match - ask for correct ring size
            if (availableRingsArray.length > 0) {
              const ringList = availableRingsArray.join(", ");
              await this.sendTextMessage(senderId, `Maaf, ring ${extractedNumber} tidak tersedia untuk ban ${session.banSize} 😔\n\nRing yang tersedia: ${ringList}\n\nSilakan pilih salah satu atau ketik ring yang benar.`);
              return;
            } else {
              // No available rings at all
              await this.sendTextMessage(senderId, `Maaf, tidak ada ring yang tersedia untuk ban ${session.banSize} 😔\n\nKetik ulang ukuran ban atau tipe motor yang juragan cari.`);
              session.state = null;
              session.banSize = null;
              return;
            }
          }
        } catch (error) {
          console.error("Error matching ring size:", error);
          // On error, ask user to try again
          await this.sendTextMessage(senderId, "Maaf, ada error. Boleh ketik ukuran ring lagi? Contoh: 14, 17, 10");
          return;
        }
      } else {
        // Check if user provided motorcycle info instead of ring size
        try {
          const isMotorcycle = await gptService.isMotorcycleRelated(rawText);
          if (isMotorcycle) {
            session.motorType = rawText.trim();
            session.banSize = null;  // Reset ban size
            session.banRing = null;
            
            // Check if position is mentioned in the text
            const positionKeywords = {
              depan: ["depan", "front", "ban depan", "roda depan"],
              belakang: ["belakang", "back", "rear", "ban belakang", "roda belakang"]
            };
            
            let detectedPosition = null;
            for (const [pos, keywords] of Object.entries(positionKeywords)) {
              if (keywords.some(kw => textLower.includes(kw))) {
                detectedPosition = pos;
                break;
              }
            }
            
            if (detectedPosition) {
              // Position detected, go directly to show recommendations
              session.motorPosition = detectedPosition;
              session.state = "showing_motor_recommendations";
              await this.showMotorRecommendations(senderId, session);
              return;
            } else {
              // Ask for position
              session.state = "waiting_motor_position";
              await this.sendTextMessage(senderId, "Ban depan atau belakang?", [
                { content_type: "text", title: "Depan", payload: "MOTOR_DEPAN" },
                { content_type: "text", title: "Belakang", payload: "MOTOR_BELAKANG" },
              ]);
              return;
            }
          }
        } catch (error) {
          console.error("Error in motorcycle detection for ring size:", error);
        }
        
        await this.sendTextMessage(senderId, "Maaf, Bella kurang paham. Boleh ketik ukuran ring saja? Contoh: 14, 17, 10");
        return;
      }
    }

    // ========== STATE: WAITING FOR BRAND SIZE ==========
    if (session.state === "waiting_brand_size") {
      // Check if user provided complete or incomplete size
      if (this.looksLikeCompleteBanSize(rawText)) {
        session.banUkuran = this.normalizeBanSize(rawText);
        session.banSearchQuery = session.banBrandPattern; // Use brand pattern for filtering
        session.state = "show_products";
        await this.showBanProducts(senderId, session);
        return;
      } else if (this.looksLikeIncompleteBanSize(rawText)) {
        const [size, ring] = this.parseBanSize(rawText);
        session.banSize = size;
        session.banRing = ring;
        
        if (!ring) {
          session.state = "waiting_ring";
          await this.askForRingSize(senderId, session);
          return;
        } else {
          session.banUkuran = `${size}-${ring}`;
          session.banSearchQuery = session.banBrandPattern;
          session.state = "show_products";
          await this.showBanProducts(senderId, session);
          return;
        }
      } else {
        // Try GPT extraction
        try {
          const extractedSize = await gptService.extractBanSizeFromText(rawText);
          if (extractedSize) {
            console.log(`GPT extracted ban size: ${extractedSize} from "${rawText}"`);
            
            if (this.looksLikeCompleteBanSize(extractedSize)) {
              session.banUkuran = this.normalizeBanSize(extractedSize);
              session.banSearchQuery = session.banBrandPattern;
              session.state = "show_products";
              await this.showBanProducts(senderId, session);
              return;
            } else if (this.looksLikeIncompleteBanSize(extractedSize)) {
              const [size, ring] = this.parseBanSize(extractedSize);
              session.banSize = size;
              session.banRing = ring;
              if (!ring) {
                session.state = "waiting_ring";
                await this.askForRingSize(senderId, session);
                return;
              } else {
                session.banUkuran = `${size}-${ring}`;
                session.banSearchQuery = session.banBrandPattern;
                session.state = "show_products";
                await this.showBanProducts(senderId, session);
                return;
              }
            }
          }
        } catch (error) {
          console.error("Error in GPT extraction for brand size:", error);
        }
        
        // Check if user provided motorcycle info instead of ban size
        try {
          const isMotorcycle = await gptService.isMotorcycleRelated(rawText);
          if (isMotorcycle) {
            session.motorType = rawText.trim();
            
            // Check if position is mentioned in the text
            const positionKeywords = {
              depan: ["depan", "front", "ban depan", "roda depan"],
              belakang: ["belakang", "back", "rear", "ban belakang", "roda belakang"]
            };
            
            let detectedPosition = null;
            for (const [pos, keywords] of Object.entries(positionKeywords)) {
              if (keywords.some(kw => textLower.includes(kw))) {
                detectedPosition = pos;
                break;
              }
            }
            
            if (detectedPosition) {
              // Position detected, go directly to show recommendations
              session.motorPosition = detectedPosition;
              session.state = "showing_motor_recommendations";
              // Preserve brand pattern if it was set
              await this.showMotorRecommendations(senderId, session);
              return;
            } else {
              // Ask for position
              session.state = "waiting_motor_position";
              await this.sendTextMessage(senderId, "Ban depan atau belakang?", [
                { content_type: "text", title: "Depan", payload: "MOTOR_DEPAN" },
                { content_type: "text", title: "Belakang", payload: "MOTOR_BELAKANG" },
              ]);
              return;
            }
          }
        } catch (error) {
          console.error("Error in motorcycle detection for brand size:", error);
        }
        
        await this.sendTextMessage(senderId, "Maaf, Bella kurang paham. Bisa ketik ukuran ban? Contoh: 80/90-14");
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
      const pos = textLower.includes("depan") ? "depan" : textLower.includes("belakang") ? "belakang" : null;
      if (pos) {
        session.motorPosition = pos;
        session.state = "showing_motor_recommendations";
        await this.showMotorRecommendations(senderId, session);
        return;
      } else {
        await this.sendTextMessage(senderId, "Pilih 'depan' atau 'belakang' ya juragan", [
          { content_type: "text", title: "Depan", payload: "MOTOR_DEPAN" },
          { content_type: "text", title: "Belakang", payload: "MOTOR_BELAKANG" },
        ]);
        return;
      }
    }

    // ========== STATE: USER CHOOSES SIZE AFTER MOTOR RECOMMENDATION ==========
    if (session.state === "showing_motor_recommendations") {
      if (this.looksLikeCompleteBanSize(rawText)) {
        session.banUkuran = this.normalizeBanSize(rawText);
        session.state = "show_products";
        await this.showBanProducts(senderId, session);
        return;
      } else if (this.looksLikeIncompleteBanSize(rawText)) {
        const [size, ring] = this.parseBanSize(rawText);
        session.banSize = size;
        session.banRing = ring;
        if (!ring) {
          session.state = "waiting_ring";
          await this.askForRingSize(senderId, session);
          return;
        } else {
          session.banUkuran = `${size}-${ring}`;
          session.state = "show_products";
          await this.showBanProducts(senderId, session);
          return;
        }
      } else {
        // Try GPT extraction before giving up
        try {
          const extractedSize = await gptService.extractBanSizeFromText(rawText);
          if (extractedSize) {
            console.log(`GPT extracted ban size in motor recommendations: ${extractedSize} from "${rawText}"`);
            
            if (this.looksLikeCompleteBanSize(extractedSize)) {
              session.banUkuran = this.normalizeBanSize(extractedSize);
              session.state = "show_products";
              await this.showBanProducts(senderId, session);
              return;
            } else if (this.looksLikeIncompleteBanSize(extractedSize)) {
              const [size, ring] = this.parseBanSize(extractedSize);
              session.banSize = size;
              session.banRing = ring;
              if (!ring) {
                session.state = "waiting_ring";
                await this.askForRingSize(senderId, session);
                return;
              } else {
                session.banUkuran = `${size}-${ring}`;
                session.state = "show_products";
                await this.showBanProducts(senderId, session);
                return;
              }
            }
          }
        } catch (error) {
          console.error("Error in GPT extraction in motor recommendations:", error);
        }
        
        await this.sendTextMessage(senderId, "Bella kurang paham, bisa ketik ukuran ban yang juragan mau? Contoh: 80/90-14 atau pilih dari rekomendasi di atas");
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
      
      // If from motor flow, offer depan lagi/belakang/selesai
      if (session.motorType) {
        if (["depan lagi", "liat depan lagi"].includes(textLower)) {
          session.motorPosition = "depan";
          session.state = "showing_motor_recommendations";
          await this.showMotorRecommendations(senderId, session);
          return;
        }
        if (["belakang", "liat belakang", "yang belakang"].includes(textLower)) {
          session.motorPosition = "belakang";
          session.state = "showing_motor_recommendations";
          await this.showMotorRecommendations(senderId, session);
          return;
        }
      }
    }

    // ========== STATE: AFTER PRICE CHECK ==========
    if (session.state === "after_price_check") {
      if (["liat lagi", "lihat lagi", "liat-liat lagi", "cari lagi"].includes(textLower)) {
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
    // If text doesn't match direct patterns but might contain a size like "ban 90/90" or "saya cari 80/90"
    if (!this.looksLikeCompleteBanSize(rawText) && !this.looksLikeIncompleteBanSize(rawText)) {
      try {
        const extractedSize = await gptService.extractBanSizeFromText(rawText);
        if (extractedSize) {
          console.log(`GPT extracted ban size: ${extractedSize} from "${rawText}"`);
          
          // Check if it's complete or incomplete
          if (this.looksLikeCompleteBanSize(extractedSize)) {
            session.banUkuran = this.normalizeBanSize(extractedSize);
            session.state = "show_products";
            await this.showBanProducts(senderId, session);
            return;
          } else if (this.looksLikeIncompleteBanSize(extractedSize)) {
            const [size, ring] = this.parseBanSize(extractedSize);
            session.banSize = size;
            session.banRing = ring;
            
            if (!ring) {
              session.state = "waiting_ring";
              await this.askForRingSize(senderId, session);
              return;
            } else {
              session.banUkuran = `${size}-${ring}`;
              session.state = "show_products";
              await this.showBanProducts(senderId, session);
              return;
            }
          }
        }
      } catch (error) {
        console.error("Error in GPT ban size extraction:", error);
        // Continue to brand/pattern detection
      }
    }

    // ========== BRAND/PATTERN DETECTION ==========
    const brandPatternKeywords = [
      // Brands
      "aspira", "fdr", "corsa", "irc", "maxxis", "michelin", 
      "pirelli", "dunlop", "swallow", "zeneos", "mizzle",
      // Patterns
      "platinum", "diamond", "sportivo", "strada", "evoluzion",
      "battlax", "tubeless", "r46", "r26", "r93", "victra", 
      "pilot", "city", "scooter", "sport", "touring"
    ];
    const containsBrandPattern = brandPatternKeywords.some(kw => textLower.includes(kw));
    
    if (containsBrandPattern) {
      // Find which brand/pattern was mentioned
      const mentioned = brandPatternKeywords.find(kw => textLower.includes(kw));
      session.banBrandPattern = mentioned;
      session.state = "waiting_brand_size";
      
      // Capitalize first letter for display
      const displayName = mentioned.charAt(0).toUpperCase() + mentioned.slice(1);
      await this.sendTextMessage(senderId, `Ah mau ban ${displayName}, ukuran berapa juragan?\n\nContoh: 80/90-14`);
      return;
    }
    
    // ========== GPT-BASED BRAND/PATTERN DETECTION (FALLBACK) ==========
    // If text doesn't match known patterns, try GPT to detect if it's a brand/pattern name
    if (textLower.length <= 20 && !textLower.includes('/') && !textLower.includes('-')) {
      try {
        const allBanProducts = await sheetsService.getProductsByCategory("ban");
        const allBrands = new Set();
        const allPatterns = new Set();
        
        allBanProducts.forEach(product => {
          const brand = String(product.brand || product.MERK || "").toLowerCase().trim();
          const pattern = String(product.pattern || product.PATTERN || "").toLowerCase().trim();
          
          if (brand) allBrands.add(brand);
          if (pattern) allPatterns.add(pattern);
        });
        
        // Check if user's text matches any brand or pattern from sheets
        const matchedBrand = Array.from(allBrands).find(b => 
          textLower.includes(b) || b.includes(textLower)
        );
        const matchedPattern = Array.from(allPatterns).find(p => 
          textLower.includes(p) || p.includes(textLower)
        );
        
        if (matchedBrand || matchedPattern) {
          const matched = matchedBrand || matchedPattern;
          session.banBrandPattern = matched;
          session.state = "waiting_brand_size";
          
          // Capitalize first letter for display
          const displayName = matched.charAt(0).toUpperCase() + matched.slice(1);
          await this.sendTextMessage(senderId, `Ah mau ban ${displayName}, ukuran berapa juragan?\n\nContoh: 80/90-14`);
          return;
        }
      } catch (error) {
        console.error("Error in brand/pattern detection:", error);
        // Continue to greeting detection
      }
    }

    // ========== GREETING DETECTION ==========
    const greetings = [
      "halo", "hello", "hai", "hi", "hey", "hallo", "helo",
      "selamat pagi", "pagi", "selamat siang", "siang",
      "selamat sore", "sore", "selamat malam", "malam",
      "assalamualaikum", "assalamu'alaikum", "salam",
      "permisi", "gan", "juragan", "bro", "sis",
      "start", "mulai"
    ];
    
    if (greetings.includes(textLower)) {
      await this.sendWelcomeMessage(senderId);
      return;
    }

    // ========== GPT GREETING DETECTION (FALLBACK) ==========
    // For greeting variations not in the hardcoded list
    try {
      const isGreeting = await gptService.isGreeting(rawText);
      if (isGreeting) {
        await this.sendWelcomeMessage(senderId);
        return;
      }
    } catch (error) {
      console.error("Error in GPT greeting detection:", error);
      // Continue to next checks
    }

    // ========== DEFAULT: DON'T UNDERSTAND ==========
    // Check if message is related to tires/ban
    try {
      const isBanRelated = await gptService.isBanRelated(rawText);
      
      if (isBanRelated) {
        // Ban-related but we don't understand - friendly response
        await this.sendTextMessage(
          senderId,
          `Ah iya, kita menyediakan ban! Mau ban apa?\n\n• Ketik ukuran ban (contoh: 80/90-14)\n• Atau ketik tipe motor (contoh: Yamaha Mio)`
        );
      } else {
        // Not ban-related - simple don't understand
        await this.sendTextMessage(
          senderId,
          `Maaf, Bella kurang paham. Untuk info lebih lanjut klik link:\n📞 ${this.getWhatsAppLink()}`
        );
      }
    } catch (error) {
      console.error("Error checking ban-related:", error);
      // Fallback: simple don't understand
      await this.sendTextMessage(
        senderId,
        `Maaf, Bella kurang paham. Untuk info lebih lanjut klik link:\n📞 ${this.getWhatsAppLink()}`
      );
    }
  }

  // =========================
  // QUICK REPLY
  // =========================
  async handleQuickReply(senderId, payload, session) {
    payload = String(payload || "");
    console.log(`🔘 Quick reply from ${senderId}: ${payload}`);

    // ---------- BAN SIZE FROM RECOMMENDATIONS ----------
    if (payload.startsWith("BAN_SIZE_")) {
      const size = payload.replace("BAN_SIZE_", "").replace(/_/g, "/").replace(/~/g, "-");
      session.banUkuran = size;
      session.state = "show_products";
      await this.showBanProducts(senderId, session);
      return;
    }

    // ---------- SIZE FROM WIDTH RECOMMENDATION (e.g., SIZE_80/90) ----------
    if (payload.startsWith("SIZE_")) {
      const size = payload.replace("SIZE_", "");
      session.banSize = size;
      session.state = "waiting_ring";
      await this.askForRingSize(senderId, session);
      return;
    }

    // ---------- RING SIZE FROM RECOMMENDATIONS ----------
    if (payload.startsWith("RING_")) {
      const ring = payload.replace("RING_", "");
      session.banRing = ring;
      session.banUkuran = `${session.banSize}-${ring}`;
      session.state = "show_products";
      await this.showBanProducts(senderId, session);
      return;
    }

    // ---------- MOTOR POSITION ----------
    if (payload === "MOTOR_DEPAN") {
      session.motorPosition = "depan";
      session.state = "showing_motor_recommendations";
      await this.showMotorRecommendations(senderId, session);
      return;
    }

    if (payload === "MOTOR_BELAKANG") {
      session.motorPosition = "belakang";
      session.state = "showing_motor_recommendations";
      await this.showMotorRecommendations(senderId, session);
      return;
    }

    // ---------- MOTOR SIZE CHOICE ----------
    if (payload.startsWith("MOTOR_CHOOSE_")) {
      const size = payload.replace("MOTOR_CHOOSE_", "").replace(/_/g, "/").replace(/~/g, "-");
      session.banUkuran = size;
      session.state = "show_products";
      await this.showBanProducts(senderId, session);
      return;
    }

    // ---------- PAGINATION ----------
    if (payload === "NEXT_PAGE") {
      if (session.currentPage < session.totalPages) {
        session.currentPage++;
        await this.showBanProducts(senderId, session);
      }
      return;
    }

    if (payload === "PREV_PAGE") {
      if (session.currentPage > 1) {
        session.currentPage--;
        await this.showBanProducts(senderId, session);
      }
      return;
    }

    // ---------- AFTER PRODUCTS OPTIONS ----------
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
      await this.sendWelcomeMessage(senderId);
      return;
    }

    if (payload === "SELESAI") {
      await this.sendFinishMessage(senderId);
      this.userSessions.delete(senderId);
      return;
    }

    // ---------- MOTOR FLOW: DEPAN LAGI ----------
    if (payload === "MOTOR_DEPAN_LAGI") {
      session.motorPosition = "depan";
      session.state = "showing_motor_recommendations";
      await this.showMotorRecommendations(senderId, session);
      return;
    }

    // ---------- MOTOR FLOW: BELAKANG ----------
    if (payload === "MOTOR_BELAKANG_NOW") {
      session.motorPosition = "belakang";
      session.state = "showing_motor_recommendations";
      await this.showMotorRecommendations(senderId, session);
      return;
    }

    // ---------- TIPE MOTOR ----------
    if (payload === "INPUT_TIPE_MOTOR") {
      session.state = "waiting_motor_type";
      await this.sendTextMessage(senderId, "Boleh tau tipe motornya apa, juragan? Contoh: Yamaha Mio, Honda Beat");
      return;
    }

    // Default: unknown payload
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

    // Handle CEK_HARGA
    if (payload.startsWith("CEK_HARGA_")) {
      try {
        const base64Data = payload.replace("CEK_HARGA_", "");
        const productData = JSON.parse(Buffer.from(base64Data, 'base64').toString('utf8'));
        
        let priceText = `💰 **${productData.name}**\n`;
        if (productData.brand) priceText += `🏷️ Merk: ${productData.brand}\n`;
        if (productData.spec) priceText += `📋 Spesifikasi: ${productData.spec}\n`;
        
        if (productData.harga_pasang) {
          const hargaPasangDisplay = productData.harga_pasang * 1000;
          priceText += `\n🔧 **Harga Pasang: Rp ${hargaPasangDisplay.toLocaleString('id-ID')}**\n`;
          priceText += `\n🛒 Untuk pembelian, klik link:\n📞 ${this.getWhatsAppLink()}\n`;
        } else {
          priceText += `\n💬 Untuk info harga terbaru, klik link:\n📞 ${this.getWhatsAppLink()}\n`;
        }
        
        await this.sendTextMessage(senderId, priceText, [
          { content_type: "text", title: "🔍 Liat-liat Lagi", payload: "LIAT_LAGI" },
          { content_type: "text", title: "✅ Selesai", payload: "SELESAI" },
        ]);
        
        session.state = "after_price_check";
      } catch (error) {
        console.error("Error handling CEK_HARGA:", error);
        // Reset session on error
        session.state = null;
        await this.sendTextMessage(senderId, `Maaf, ada error saat mengecek harga 😔\n\nUntuk info harga, klik link:\n📞 ${this.getWhatsAppLink()}`);
      }
      return;
    }

    // Handle via quick reply handler
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
      banSize: null,        // e.g., "80/90"
      banRing: null,        // e.g., "14"
      banUkuran: null,      // complete e.g., "80/90-14"
      motorType: null,      // e.g., "Yamaha Mio"
      motorPosition: null,  // "depan" or "belakang"
      currentPage: 1,       // for pagination
      totalPages: 1,        // total pages for pagination
      allProducts: [],      // all matched products for pagination
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
  looksLikeCompleteBanSize(s) {
    // Matches: 80/90-14, 100/80-17, etc (with ring size)
    return /^\d{2,3}\s*\/\s*\d{2,3}\s*-\s*\d{2}$/i.test(String(s).trim());
  }

  looksLikeIncompleteBanSize(s) {
    // Matches: 80/90, 100/80, or 80/90-14 (with or without ring)
    return /^\d{2,3}\s*\/\s*\d{2,3}(\s*-\s*\d{2})?$/i.test(String(s).trim());
  }

  parseBanSize(s) {
    // Returns [size, ring] e.g., ["80/90", "14"] or ["80/90", null]
    const normalized = String(s).trim().replace(/\s+/g, "");
    const match = normalized.match(/^(\d{2,3}\/\d{2,3})(-(\d{2}))?$/);
    if (match) {
      return [match[1], match[3] || null];
    }
    return [null, null];
  }

  normalizeBanSize(s) {
    // Normalize to format: 80/90-14
    return String(s).trim().replace(/\s+/g, "").replace(/[\/\-]/g, (m) => m === "/" ? "/" : "-");
  }

  extractRingSize(s) {
    // Extract just ring number from input like "14", "ring 14", "17"
    const match = String(s).match(/(\d{2})/);
    return match ? match[1] : null;
  }

  encodeUkuranForPayload(u) {
    return String(u).replace(/\//g, "_").replace(/-/g, "~");
  }

  decodeUkuranFromPayload(u) {
    return String(u).replace(/_/g, "/").replace(/~/g, "-");
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
  // WELCOME & FINISH MESSAGES
  // =========================
  async sendWelcomeMessage(senderId) {
    const welcomeText = `Hallo juragan, dengan Bella Gudang Ban. Cari ban apa?`;
    
    await this.sendTextMessage(senderId, welcomeText);
  }

  async sendFinishMessage(senderId) {
    const finishText = `Terima kasih sudah menggunakan layanan Bella! 😊

Untuk order atau info lebih lanjut, klik link:
📞 ${this.getWhatsAppLink()}
📍 **Alamat:** Jl. Ikan Nila V No. 30, Bumi Waras, Bandar Lampung, Lampung

Sampai jumpa lagi, juragan! 👋`;
    
    await this.sendTextMessage(senderId, finishText);
  }

  // =========================
  // BAN FLOW METHODS
  // =========================
  async askForRingSize(senderId, session) {
    const banSize = session.banSize;
    
    try {
      // Get GPT recommendations for common ring sizes
      const gptRecommendedRings = await gptService.getRecommendedRingSizes(banSize);
      
      // Also get available ring sizes from sheets for this ban size
      const allBanProducts = await sheetsService.getProductsByCategory("ban");
      const availableRings = new Set();
      
      allBanProducts.forEach(product => {
        const spec = String(product.specifications || product.SPESIFIKASI || "");
        if (spec.includes(banSize)) {
          const match = spec.match(new RegExp(`${banSize.replace(/\//g, "\\/")}-(\\d{2})`));
          if (match) {
            availableRings.add(match[1]);
          }
        }
      });

      const availableRingsArray = Array.from(availableRings).sort();
      
      // Combine GPT recommendations with actual stock
      // Prioritize rings that are both recommended AND in stock
      const priorityRings = gptRecommendedRings.filter(r => availableRingsArray.includes(r));
      const otherRings = availableRingsArray.filter(r => !priorityRings.includes(r));
      
      // Combine: priority first, then others (max 6 total for quick replies)
      const displayRings = [...priorityRings, ...otherRings].slice(0, 6);
      
      if (displayRings.length === 0) {
        // No ring sizes found - suggest using motor type instead
        await this.sendTextMessage(
          senderId, 
          `Maaf, Bella tidak menemukan ring untuk ban ${banSize} 😔\n\nCoba kasih tau tipe motor aja yuk! Nanti Bella bantu carikan.\n\nContoh: Yamaha Mio, Honda Beat, Suzuki Nex`
        );
        
        session.state = null;
        session.banSize = null;
        session.banRing = null;
        session.banUkuran = null;
        return;
      }
      
      // Create simple message with GPT recommendations
      const gptRingText = gptRecommendedRings.length > 0 
        ? `\n\nBiasanya untuk ${banSize}: ring ${gptRecommendedRings.join(" atau ")}`
        : "";
      
      const quickReplies = displayRings.map(ring => ({
        content_type: "text",
        title: `Ring ${ring}`,
        payload: `RING_${ring}`
      }));

      const text = `Ring berapa juragan?${gptRingText}`;
      await this.sendTextMessage(senderId, text, quickReplies);
    } catch (error) {
      console.error("Error in askForRingSize:", error);
      await this.sendTextMessage(senderId, "Ring berapa juragan? Contoh: 14, 17");
    }
  }

  async showBanProducts(senderId, session) {
    const ukuran = session.banUkuran;
    const searchQuery = session.banSearchQuery || ukuran; // Support custom search queries
    const brandPattern = session.banBrandPattern; // Brand/pattern filter if set
    
    try {
      await this.sendTypingOn(senderId);
      
      // Reset to page 1 for new searches (not for pagination)
      if (session.state !== "after_products") {
        session.currentPage = 1;
      }
      
      const allBanProducts = await sheetsService.getProductsByCategory("ban");
      
      // Use cached products if paginating, otherwise do fresh search
      let matchedProducts;
      if (session.state === "after_products" && session.allProducts.length > 0) {
        // Paginating through existing results
        matchedProducts = session.allProducts;
      } else {
        // New search - filter products
        matchedProducts = allBanProducts.filter(product => {
        const spec = String(product.specifications || product.SPESIFIKASI || "").toLowerCase();
        const brand = String(product.brand || product.MERK || "").toLowerCase();
        const pattern = String(product.pattern || product.PATTERN || "").toLowerCase();
        const name = String(product.name || product.NAMA || "").toLowerCase();
        
        const searchLower = String(searchQuery).toLowerCase().replace(/\s+/g, "");
        
        // Check if searching by size (contains / or -)
        const isSizeSearch = searchLower.includes('/') || searchLower.includes('-');
        
        // Match by size in spec (exact substring match)
        const specMatch = spec.replace(/\s+/g, "").includes(searchLower);
        
        // Only do brand/pattern/name matching if NOT searching by size
        let brandMatch = false;
        let patternMatch = false;
        let nameMatch = false;
        
        if (!isSizeSearch) {
          // Searching by brand/pattern name
          brandMatch = brand.includes(searchLower);
          patternMatch = pattern.includes(searchLower);
          nameMatch = name.includes(searchLower);
        }
        
        const baseMatch = specMatch || brandMatch || patternMatch || nameMatch;
        
        // If brand/pattern filter is active, also check that
        if (brandPattern) {
          const brandPatternMatch = brand.includes(brandPattern) || pattern.includes(brandPattern) || name.includes(brandPattern);
          return baseMatch && brandPatternMatch;
        }
        
        return baseMatch;
        });
        
        // Store results for pagination
        session.allProducts = matchedProducts;
      }

      if (matchedProducts.length === 0) {
        await this.sendTextMessage(senderId, `Maaf, Bella tidak menemukan ban ${searchQuery} 😔\n\nKetik ulang ukuran ban yang juragan cari atau ketik tipe motor.\n\nContoh: 80/90-14 atau Yamaha Mio`);
        
        // Reset state so user can type new input
        session.state = null;
        session.banSize = null;
        session.banRing = null;
        session.banUkuran = null;
        session.banBrandPattern = null;
        session.banSearchQuery = null;
        return;
      }

      // Facebook Messenger carousel limit is 10 elements
      const MAX_CAROUSEL_ITEMS = 10;
      
      // Calculate pagination
      session.currentPage = session.currentPage || 1;
      session.totalPages = Math.ceil(matchedProducts.length / MAX_CAROUSEL_ITEMS);
      
      // Get products for current page
      const startIdx = (session.currentPage - 1) * MAX_CAROUSEL_ITEMS;
      const endIdx = startIdx + MAX_CAROUSEL_ITEMS;
      const productsToShow = matchedProducts.slice(startIdx, endIdx);
      
      let text = `📦 Halaman ${session.currentPage}/${session.totalPages}\n`;
      text += `Menampilkan ${productsToShow.length} dari ${matchedProducts.length} ban yang tersedia:\n\n`;
      
      await this.sendTextMessage(senderId, text);

      // Send up to 10 products in carousel
      const elements = productsToShow.map((product, idx) => ({
        title: product.name || product.NAMA,
        subtitle: `${product.brand || product.MERK || ""}\n${product.specifications || product.SPESIFIKASI || ""}`,
        image_url: product.image_url || product.IMAGE_URL || "https://via.placeholder.com/300x300.png?text=Ban",
        buttons: [
          {
            type: "postback",
            title: "💰 Cek Harga?",
            payload: `CEK_HARGA_${Buffer.from(JSON.stringify({
              name: product.name || product.NAMA,
              harga_jual: product.harga_jual || product.HARGA_JUAL,
              harga_pasang: product.harga_pasang || product.HARGA_PASANG,
              brand: product.brand || product.MERK,
              spec: product.specifications || product.SPESIFIKASI
            })).toString('base64')}`
          }
        ]
      }));

      await this.sendCarousel(senderId, elements);

      // Send purchase info
      await this.sendTextMessage(
        senderId,
        `🛒 Untuk pembelian, klik link di bawah:\n📞 WhatsApp: ${this.getWhatsAppLink()}`
      );

      // Ask what's next
      if (session.motorType) {
        // User came from motor flow
        const quickReplies = [];
        
        // Add pagination buttons if needed
        if (session.currentPage > 1) {
          quickReplies.push({ content_type: "text", title: "◀️ Sebelumnya", payload: "PREV_PAGE" });
        }
        if (session.currentPage < session.totalPages) {
          quickReplies.push({ content_type: "text", title: "▶️ Selanjutnya", payload: "NEXT_PAGE" });
        }
        
        if (session.motorPosition === "depan") {
          quickReplies.push(
            { content_type: "text", title: "🔄 Depan Lagi", payload: "MOTOR_DEPAN_LAGI" },
            { content_type: "text", title: "🔽 Lihat Belakang", payload: "MOTOR_BELAKANG_NOW" }
          );
        } else {
          quickReplies.push(
            { content_type: "text", title: "🔼 Lihat Depan", payload: "MOTOR_DEPAN_LAGI" },
            { content_type: "text", title: "🔄 Belakang Lagi", payload: "MOTOR_BELAKANG_NOW" }
          );
        }
        quickReplies.push({ content_type: "text", title: "✅ Selesai", payload: "SELESAI" });

        await this.sendTextMessage(senderId, "Mau lihat lagi atau sudah selesai?", quickReplies);
      } else {
        // Direct size input flow
        const quickReplies = [];
        
        // Add pagination buttons if needed
        if (session.currentPage > 1) {
          quickReplies.push({ content_type: "text", title: "◀️ Sebelumnya", payload: "PREV_PAGE" });
        }
        if (session.currentPage < session.totalPages) {
          quickReplies.push({ content_type: "text", title: "▶️ Selanjutnya", payload: "NEXT_PAGE" });
        }
        
        quickReplies.push(
          { content_type: "text", title: "🔍 Liat Lagi", payload: "LIAT_LAGI" },
          { content_type: "text", title: "✅ Selesai", payload: "SELESAI" }
        );

        await this.sendTextMessage(senderId, "Mau lihat lagi atau sudah selesai?", quickReplies);
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
        brandPattern: session.banBrandPattern
      });
      
      // Reset session on error
      session.state = null;
      session.banSize = null;
      session.banRing = null;
      session.banUkuran = null;
      session.banBrandPattern = null;
      session.banSearchQuery = null;
      await this.sendTextMessage(senderId, "Maaf, ada error saat menampilkan produk 😔\n\nKetik ulang ukuran ban atau tipe motor yang juragan cari.");
    }
  }

  async showMotorRecommendations(senderId, session) {
    const motorType = session.motorType;
    const position = session.motorPosition;

    try {
      await this.sendTypingOn(senderId);

      // Use GPT to get standard + upsize recommendations
      const result = await gptService.getBanRecommendationsForMotor(motorType, position);

      // Show both recommendations
      const text = `🏍️ Rekomendasi ban ${position} untuk ${motorType}:\n\n${result.standard.label}: ${result.standard.size}\n${result.upsize.label}: ${result.upsize.size}\n\nPilih ukuran yang juragan mau:`;

      const quickReplies = [
        {
          content_type: "text",
          title: `📏 ${result.standard.size}`,
          payload: `MOTOR_CHOOSE_${this.encodeUkuranForPayload(result.standard.size)}`
        },
        {
          content_type: "text",
          title: `⬆️ ${result.upsize.size}`,
          payload: `MOTOR_CHOOSE_${this.encodeUkuranForPayload(result.upsize.size)}`
        }
      ];

      session.state = "showing_motor_recommendations";
      await this.sendTextMessage(senderId, text, quickReplies);
    } catch (error) {
      console.error("Error in showMotorRecommendations:", error);
      // Reset session on error
      session.state = null;
      session.motorType = null;
      session.motorPosition = null;
      await this.sendTextMessage(senderId, `Maaf, ada error saat mengecek rekomendasi 😔\n\nBisa ketik ukuran ban langsung? Contoh: 80/90-14`);
    }
  }

  async handleAttachment(senderId, attachments, session) {
    await this.sendTextMessage(
      senderId,
      `Terima kasih! Untuk order, klik link WhatsApp di bawah 😊\n\n📞 ${this.getWhatsAppLink()}`,
      [
        { content_type: "text", title: "🔍 Lihat Ban", payload: "LIAT_LAGI" },
      ]
    );
  }
}

module.exports = new MessageHandler();
