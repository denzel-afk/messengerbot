const { GoogleSpreadsheet } = require("google-spreadsheet");
const { JWT } = require("google-auth-library");
const fs = require("fs");

class SheetsService {
  constructor() {
    this.doc = null;
    this.connected = false;
    this.sheetsId = process.env.GOOGLE_SHEETS_ID;

    this.categoryMap = {
      Sheet_Ban: { name: "ban", display: "🛞 Ban Motor", emoji: "🛞" },
      Sheet_Lampu: {
        name: "lampu",
        display: "💡 Lampu Kendaraan",
        emoji: "💡",
      },
      Sheet_Oli: { name: "oli", display: "🛢️ Oli Mesin", emoji: "🛢️" },
      Sheet_Cat: { name: "cat", display: "🎨 Cat Kendaraan", emoji: "🎨" },
    };

    this.columnMappings = {
      Sheet_Ban: {
        ukuran: ["UKURAN"],
        brand: ["MERK"],
        pattern: ["PATTERN"],
        harga_jual: ["HARGA JUAL"],
        harga_pasang: ["HARGA PASANG"],
        price_list: ["PRICE LIST"],
        image: ["GAMBAR"],
        het_baru: ["HET BARU"],
      },
      Sheet_Oli: {
        // Columns in sheet: NO. PRODUCT MERK SAE PACK HARGA JUAL GROSIR GAMBAR
        product_name: ["PRODUCT", "NAMA PRODUK", "NAME", "PRODUCT"],
        brand: ["MERK", "BRAND"],
        // SAE (viscosity) and PACK (package/volume)
        sae: ["SAE"],
        pack: ["PACK"],
        // Prices
        harga_jual: ["HARGA JUAL", "HARGA"],
        grosir: ["GROSIR"],
        price_list: ["PRICE LIST", "HARGA LIST"],
        image: ["GAMBAR", "FOTO", "IMAGE"],
      },
      Sheet_Lampu: {
        no: ["NO", "No", "no"],
        product_name: ["TYPE", "NAMA PRODUK", "PRODUCT", "NAME"],
        brand: ["MERK", "BRAND"],
        type: ["TYPE LAMPU", "JENIS", "TIPE", "TYPE"],
        harga_jual: ["RETAIL", "HARGA JUAL", "HARGA"],
        price_list: ["PRICE LIST"],
        image: ["GAMBAR", "FOTO", "IMAGE"],
      },
      // CAT: NAMA, MERK, JUAL, IMAGE
      Sheet_Cat: {
        product_name: ["NAMA", "NAMA PRODUK", "PRODUCT", "NAME"],
        brand: ["MERK", "BRAND"],
        harga_jual: ["JUAL", "HARGA JUAL", "HARGA"],
        image: ["IMAGE", "GAMBAR", "FOTO"],
      },
    };
  }

  // Optional: auto-init guard if you ever forget to call initialize()
  async ensureConnected() {
    if (this.connected && this.doc) return;
    await this.initialize();
  }

  async initialize() {
    try {
      const credentials = JSON.parse(
        fs.readFileSync("./data/credentials.json", "utf8")
      );

      const serviceAccountAuth = new JWT({
        email: credentials.client_email,
        key: credentials.private_key,
        scopes: [
          "https://www.googleapis.com/auth/spreadsheets",
          "https://www.googleapis.com/auth/drive",
        ],
      });

      this.doc = new GoogleSpreadsheet(this.sheetsId, serviceAccountAuth);
      await this.doc.loadInfo();

      console.log(`Connected to: "${this.doc.title}"`);
      console.log(
        `Available sheets: ${Object.keys(this.doc.sheetsByTitle).join(", ")}`
      );

      this.connected = true;
      return true;
    } catch (error) {
      console.error("Sheets initialization failed:", error.message);
      this.connected = false;
      throw error;
    }
  }

  isConnected() {
    return this.connected;
  }

  getAvailableCategories() {
    return Object.entries(this.categoryMap).map(([sheetName, info]) => ({
      id: info.name,
      name: info.name,
      display_name: info.display,
      emoji: info.emoji,
      sheet_name: sheetName,
      is_active: true,
    }));
  }

  async getProductsByCategory(categoryName) {
    try {
      await this.ensureConnected();

      const sheetEntry = Object.entries(this.categoryMap).find(
        ([, info]) => info.name === String(categoryName || "").toLowerCase()
      );

      if (!sheetEntry) {
        console.log(`Category "${categoryName}" not found`);
        return [];
      }

      const [sheetName] = sheetEntry;
      const sheet = this.doc?.sheetsByTitle?.[sheetName];

      if (!sheet) {
        console.log(`Sheet "${sheetName}" not found`);
        return [];
      }

      const rows = await sheet.getRows();
      console.log(`Found ${rows.length} rows in ${sheetName}`);

      return this.parseProductsBySheetType(rows, categoryName, sheetName);
    } catch (error) {
      console.error(`Error getting ${categoryName} products:`, error.message);
      return [];
    }
  }

  parseProductsBySheetType(rows, categoryName, sheetName) {
    const columnMap = this.columnMappings[sheetName];

    if (!columnMap) {
      console.warn(
        `No column mapping found for ${sheetName}, using generic parser`
      );
      return this.parseGenericProducts(rows, categoryName);
    }

    return rows
      .map((row, index) => {
        try {
          switch (sheetName) {
            case "Sheet_Ban":
              return this.parseBanProduct(row, index, categoryName, columnMap);
            case "Sheet_Oli":
              return this.parseOliProduct(row, index, categoryName, columnMap);
            case "Sheet_Lampu":
              return this.parseLampuProduct(
                row,
                index,
                categoryName,
                columnMap
              );
            case "Sheet_Cat":
              return this.parseCatProduct(row, index, categoryName, columnMap);
            default:
              return this.parseGenericProduct(row, index, categoryName);
          }
        } catch (error) {
          console.warn(
            `Error parsing row ${index + 1} in ${sheetName}:`,
            error.message
          );
          return null;
        }
      })
      .filter(Boolean);
  }

  parseGenericProducts(rows, categoryName) {
    return rows
      .map((row, idx) => this.parseGenericProduct(row, idx, categoryName))
      .filter(Boolean);
  }

  async getBrandsByCategory(categoryName) {
    try {
      console.log(`🏷️ Getting brands for category: ${categoryName}`);
      const products = await this.getProductsByCategory(categoryName);
      console.log(`📦 Found ${products.length} products in ${categoryName}`);

      const brands = [
        ...new Set(
          products
            .map((p) => p.brand)
            .filter((b) => b && String(b).trim() !== "")
            .map((b) => String(b).trim())
        ),
      ];

      console.log(`🏷️ Found ${brands.length} unique brands:`, brands);
      return brands.sort();
    } catch (error) {
      console.error(`Error getting brands for ${categoryName}:`, error.message);
      return [];
    }
  }

  async getProductsByBrand(categoryName, brandName) {
    try {
      console.log(
        `🔍 Getting products for category: ${categoryName}, brand: ${brandName}`
      );

      const products = await this.getProductsByCategory(categoryName);
      const target = String(brandName || "").toLowerCase();

      const brandProducts = products.filter(
        (p) => p.brand && String(p.brand).toLowerCase() === target
      );

      console.log(
        `📦 Found ${brandProducts.length} products for brand "${brandName}"`
      );
      return brandProducts;
    } catch (error) {
      console.error(
        `Error getting products for brand ${brandName}:`,
        error.message
      );
      return [];
    }
  }

  parseBanProduct(row, index, categoryName, columnMap) {
    const ukuran = this.getCellValue(row, columnMap.ukuran);
    const merk = this.getCellValue(row, columnMap.brand);
    const pattern = this.getCellValue(row, columnMap.pattern);
    const hargaJual = this.getNumericValue(row, columnMap.harga_jual);
    const hargaPasang = this.getNumericValue(row, columnMap.harga_pasang);
    const gambar = this.getCellValue(row, columnMap.image);

    if (!ukuran || !merk) return null;

    return {
      id: `${categoryName}_${index + 1}`,
      category: categoryName,
      name: `${merk} ${ukuran}`,
      ukuran,
      brand: merk,
      pattern: pattern || "",
      harga_jual: hargaJual,
      harga_pasang: hargaPasang,
      base_price: hargaJual,
      image_url: this.convertGoogleDriveUrl(gambar),
      is_available: true,
      row_index: index + 2,
      specifications: `${ukuran}${pattern ? " - " + pattern : ""}`,
    };
  }

  parseOliProduct(row, index, categoryName, columnMap) {
    const productName = this.getCellValue(row, columnMap.product_name);
    const brand = this.getCellValue(row, columnMap.brand);
    const sae = this.getCellValue(row, columnMap.sae || columnMap.viscosity);
    const pack = this.getCellValue(row, columnMap.pack || columnMap.volume);
    const hargaJual = this.getNumericValue(row, columnMap.harga_jual);
    const grosir = this.getCellValue(row, columnMap.grosir);
    const gambar = this.getCellValue(row, columnMap.image);

    if (!productName && !brand) return null;

    return {
      id: `${categoryName}_${index + 1}`,
      category: categoryName,
      name: productName || `${brand} ${sae || ""}`.trim(),
      brand,
      sae,
      pack,
      harga_jual: hargaJual,
      grosir_price: grosir || "",
      base_price: hargaJual,
      image_url: this.convertGoogleDriveUrl(gambar),
      is_available: true,
      row_index: index + 2,
      specifications: [sae, pack].filter(Boolean).join(" - "),
    };
  }

  parseLampuProduct(row, index, categoryName, columnMap) {
    const no = this.getCellValue(row, columnMap.no);
    const productName = this.getCellValue(row, columnMap.product_name);
    const brand = this.getCellValue(row, columnMap.brand);
    const type = this.getCellValue(row, columnMap.type);
    const hargaJual = this.getNumericValue(row, columnMap.harga_jual);
    const gambar = this.getCellValue(row, columnMap.image);

    if (!productName && !brand) return null;
    const displayName = productName || [brand, type].filter(Boolean).join(" ");

    return {
      id: `${categoryName}_${index + 1}`,
      category: categoryName,
      no: no || "",
      name: displayName.trim(),
      brand,
      type,
      harga_jual: hargaJual,
      base_price: hargaJual,
      image_url: this.convertGoogleDriveUrl(gambar),
      is_available: true,
      row_index: index + 2,
      specifications: [type].filter(Boolean).join(" - "),
    };
  }

  // CAT: only NAMA, MERK, JUAL (no image from sheet)
  parseCatProduct(row, index, categoryName, columnMap) {
    const productName = this.getCellValue(row, columnMap.product_name);
    const brand = this.getCellValue(row, columnMap.brand);
    const hargaJual = this.getNumericValue(row, columnMap.harga_jual);
    const gambar = this.getCellValue(row, ["IMAGE", "GAMBAR", "FOTO"]);

    if (!productName && !brand) return null;

    return {
      id: `${categoryName}_${index + 1}`,
      category: categoryName,
      name: productName || `${brand} Cat`.trim(),
      brand,
      harga_jual: hargaJual,
      base_price: hargaJual,
      image_url: this.convertGoogleDriveUrl(gambar) || gambar || "",
      is_available: true,
      row_index: index + 2,
      specifications: `${productName || ""} ${brand || ""}`.trim(),
    };
  }

  parseGenericProduct(row, index, categoryName) {
    const possibleNameColumns = [
      "NAMA PRODUK",
      "PRODUCT",
      "NAME",
      "NAMA",
      "MERK",
      "BRAND",
    ];
    const possiblePriceColumns = ["HARGA JUAL", "HARGA", "PRICE", "JUAL"];
    const possibleImageColumns = ["GAMBAR", "FOTO", "IMAGE"];

    const name = this.getCellValue(row, possibleNameColumns);
    const price = this.getNumericValue(row, possiblePriceColumns);
    const image = this.getCellValue(row, possibleImageColumns);

    if (!name) return null;

    return {
      id: `${categoryName}_${index + 1}`,
      category: categoryName,
      name,
      harga_jual: price,
      base_price: price,
      image_url: this.convertGoogleDriveUrl(image),
      is_available: true,
      row_index: index + 2,
      specifications: "Generic product",
    };
  }

  getCellValue(row, keys) {
    const arr = Array.isArray(keys) ? keys : [keys];
    for (const key of arr) {
      try {
        const value = row.get(key);
        if (
          value !== undefined &&
          value !== null &&
          String(value).trim() !== ""
        ) {
          return String(value).trim();
        }
      } catch (e) {
        continue;
      }
    }
    return "";
  }

  getNumericValue(row, keys) {
    const value = this.getCellValue(row, keys);
    if (!value) return 0;
    return parseInt(String(value).replace(/[^\d]/g, "")) || 0;
  }

  convertGoogleDriveUrl(url) {
    const u = String(url || "").trim();
    if (!u) return "";

    // Handle Google Drive URLs - extract file ID and convert to direct link
    if (u.includes("drive.google.com")) {
      let fileId = null;

      // Match /d/{fileId} pattern
      let m = u.match(/\/d\/([a-zA-Z0-9-_]+)/);
      if (m) fileId = m[1];

      // Match /file/d/{fileId} pattern
      if (!fileId) {
        m = u.match(/\/file\/d\/([a-zA-Z0-9-_]+)/);
        if (m) fileId = m[1];
      }

      // Match ?id={fileId} pattern
      if (!fileId) {
        m = u.match(/[?&]id=([a-zA-Z0-9-_]+)/);
        if (m) fileId = m[1];
      }

      if (fileId) {
        // Use thumbnail endpoint that works better with Facebook
        return `https://drive.google.com/thumbnail?id=${fileId}&sz=w1000`;
      }
    }

    // Handle Dropbox URLs
    if (u.includes("dropbox.com")) {
      return u
        .replace("www.dropbox.com", "dl.dropboxusercontent.com")
        .replace("?dl=0", "")
        .replace("?dl=1", "");
    }

    // Handle Imgur URLs - ensure direct link
    if (u.includes("imgur.com") && !u.includes("i.imgur.com")) {
      const imgurId = u.match(/imgur\.com\/(\w+)/);
      if (imgurId) return `https://i.imgur.com/${imgurId[1]}.jpg`;
    }

    // If it's already a direct HTTP/HTTPS URL, return as-is
    if (u.startsWith("http://") || u.startsWith("https://")) {
      return u;
    }

    // If nothing matched, return empty (invalid URL)
    return "";
  }

  // ===== Orders =====
  async createOrder(orderData) {
    try {
      await this.ensureConnected();
      console.log("📝 Creating order:", orderData);

      const salesSheet = this.doc.sheetsByTitle["Sheet_Penjualan"];
      if (!salesSheet) {
        const availableSheets = Object.keys(this.doc.sheetsByTitle).join(", ");
        console.error(`❌ Sheet_Penjualan not found!`);
        console.error(`📋 Available sheets: ${availableSheets}`);
        throw new Error(
          "Sheet_Penjualan not found! Please create it manually."
        );
      }

      const orderId = `ORD_${Date.now()}`;
      const currentDate = new Date();

      const qty = orderData.quantity || 1;
      const price = orderData.price || 0;
      const pasang = orderData.harga_pasang || 0;

      const orderRow = {
        ORDER_ID: orderId,
        TANGGAL: currentDate.toLocaleDateString("id-ID"),
        WAKTU: currentDate.toLocaleTimeString("id-ID"),
        CUSTOMER_NAME: orderData.customer_name,
        CUSTOMER_PHONE: orderData.customer_phone,
        MESSENGER_ID: orderData.messenger_id || "",
        PRODUCT_NAME: orderData.product_name,
        KATEGORI: orderData.category,
        SPECIFICATIONS: orderData.specifications || "",
        QUANTITY: qty,
        HARGA_SATUAN: price,
        HARGA_PASANG: pasang,
        TOTAL_HARGA: qty * price + pasang,
        STATUS: "PENDING",
        NOTES: orderData.notes || "",
        PAYMENT_STATUS: "UNPAID",
      };

      await salesSheet.addRow(orderRow);
      console.log("Order saved to Sheet_Penjualan");

      return {
        success: true,
        order_id: orderId,
        total_amount: orderRow.TOTAL_HARGA,
        message: `Order ${orderId} berhasil dicatat!`,
      };
    } catch (error) {
      console.error("Error creating order:", error.message);
      return { success: false, error: error.message };
    }
  }

  async searchProducts(searchTerm) {
    const allProducts = [];
    const categories = this.getAvailableCategories();

    for (const category of categories) {
      try {
        const products = await this.getProductsByCategory(category.name);
        allProducts.push(...products);
      } catch (error) {
        console.warn(`Skipping ${category.name}:`, error.message);
      }
    }

    const searchLower = String(searchTerm || "").toLowerCase();
    return allProducts.filter(
      (product) =>
        product.name?.toLowerCase().includes(searchLower) ||
        product.brand?.toLowerCase().includes(searchLower) ||
        product.ukuran?.toLowerCase().includes(searchLower) ||
        product.type?.toLowerCase().includes(searchLower) ||
        product.color?.toLowerCase().includes(searchLower)
    );
  }

  async updateOrderStatus(orderId, newStatus) {
    try {
      await this.ensureConnected();
      const salesSheet = this.doc.sheetsByTitle["Sheet_Penjualan"];
      if (!salesSheet) throw new Error("Sheet_Penjualan not found");

      const rows = await salesSheet.getRows();
      const orderRow = rows.find((row) => row.get("ORDER_ID") === orderId);
      if (!orderRow) throw new Error(`Order ${orderId} not found`);

      orderRow.set("STATUS", newStatus);
      orderRow.set("UPDATED_AT", new Date().toLocaleString("id-ID"));
      await orderRow.save();

      console.log(`Order ${orderId} status updated to: ${newStatus}`);
      return { success: true, message: `Status updated to ${newStatus}` };
    } catch (error) {
      console.error("Error updating order status:", error.message);
      return { success: false, error: error.message };
    }
  }

  async getOrderById(orderId) {
    try {
      await this.ensureConnected();
      const salesSheet = this.doc.sheetsByTitle["Sheet_Penjualan"];
      if (!salesSheet)
        return { success: false, error: "Sheet_Penjualan not found" };

      const rows = await salesSheet.getRows();
      const orderRow = rows.find((row) => row.get("ORDER_ID") === orderId);
      if (!orderRow)
        return { success: false, error: `Order ${orderId} not found` };

      return {
        success: true,
        order: {
          order_id: orderRow.get("ORDER_ID"),
          customer_name: orderRow.get("CUSTOMER_NAME"),
          customer_phone: orderRow.get("CUSTOMER_PHONE"),
          product_name: orderRow.get("PRODUCT_NAME"),
          total_amount: orderRow.get("TOTAL_HARGA"),
          status: orderRow.get("STATUS"),
          created_at: `${orderRow.get("TANGGAL")} ${orderRow.get("WAKTU")}`,
        },
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async getSalesReport(limit = 10) {
    try {
      await this.ensureConnected();
      const salesSheet = this.doc.sheetsByTitle["Sheet_Penjualan"];
      if (!salesSheet)
        return { success: false, error: "Sheet_Penjualan not found" };

      const rows = await salesSheet.getRows();

      const totalOrders = rows.length;
      const totalRevenue = rows.reduce((sum, row) => {
        const total = parseInt(row.get("TOTAL_HARGA")) || 0;
        return sum + total;
      }, 0);

      const recentOrders = rows
        .slice(-limit)
        .reverse()
        .map((row) => ({
          order_id: row.get("ORDER_ID"),
          customer_name: row.get("CUSTOMER_NAME"),
          product_name: row.get("PRODUCT_NAME"),
          total: row.get("TOTAL_HARGA"),
          status: row.get("STATUS"),
          date: row.get("TANGGAL"),
        }));

      return {
        success: true,
        summary: {
          total_orders: totalOrders,
          total_revenue: totalRevenue,
          recent_orders: recentOrders,
        },
      };
    } catch (error) {
      console.error("Error getting sales report:", error.message);
      return { success: false, error: error.message };
    }
  }

  async getProductById(productId) {
    try {
      // safer split: allow category names with underscores
      const parts = String(productId || "").split("_");
      const indexStr = parts.pop();
      const categoryName = parts.join("_");
      const index = parseInt(indexStr, 10) - 1;

      const products = await this.getProductsByCategory(categoryName);

      if (index < 0 || index >= products.length) {
        return { success: false, error: `Product ${productId} not found` };
      }

      return { success: true, product: products[index] };
    } catch (error) {
      console.error("Error getting product by ID:", error.message);
      return { success: false, error: error.message };
    }
  }
}

const sheetsService = new SheetsService();
module.exports = sheetsService;

// ===========================
// Prototype extensions
// ===========================

// Get all cat products
SheetsService.prototype.getCatProducts = async function () {
  try {
    return await this.getProductsByCategory("cat");
  } catch (error) {
    console.error("Error in getCatProducts:", error.message);
    return [];
  }
};

// Get unique PACK values for Oli (normalized to numbers like '0.8', '1')
SheetsService.prototype.getPackOliList = async function () {
  try {
    await this.ensureConnected();
    const sheet = this.doc?.sheetsByTitle?.["Sheet_Oli"];
    if (!sheet) return [];
    const rows = await sheet.getRows();
    const columnMap = this.columnMappings["Sheet_Oli"];

    const normalizePack = (s) => {
      if (!s) return null;
      let t = String(s || "")
        .trim()
        .toLowerCase();
      // common forms: '0.8L', '1 L', '1L', '1ltr', '800ml'
      t = t.replace(/,/g, ".");
      // convert ml to liters if present
      const mlMatch = t.match(/(\d+(?:\.\d+)?)\s*ml/);
      if (mlMatch) return String(parseFloat(mlMatch[1]) / 1000);
      const numMatch = t.match(/(\d+(?:\.\d+)?)/);
      if (!numMatch) return t;
      return String(parseFloat(numMatch[1]));
    };

    const packs = rows
      .map((r) => this.getCellValue(r, columnMap.pack))
      .map((v) => normalizePack(v))
      .filter((v) => v !== null && v !== undefined && String(v).trim() !== "");

    // unique and sort numerically
    const uniq = [...new Set(packs)].sort(
      (a, b) => parseFloat(a) - parseFloat(b)
    );
    return uniq;
  } catch (error) {
    console.error("Error in getPackOliList:", error.message);
    return [];
  }
};

// Get all Oli products by PACK (normalized match)
SheetsService.prototype.getProductsByPackOli = async function (pack) {
  try {
    const products = await this.getProductsByCategory("oli");
    if (!pack || !products) return [];
    const normalizePack = (s) => {
      if (!s) return null;
      let t = String(s || "")
        .trim()
        .toLowerCase();
      t = t.replace(/,/g, ".");
      const mlMatch = t.match(/(\d+(?:\.\d+)?)\s*ml/);
      if (mlMatch) return String(parseFloat(mlMatch[1]) / 1000);
      const numMatch = t.match(/(\d+(?:\.\d+)?)/);
      if (!numMatch) return t;
      return String(parseFloat(numMatch[1]));
    };

    const target = normalizePack(pack);
    return products.filter((p) => {
      const pPack = p.pack || p.volume || "";
      return normalizePack(pPack) === target;
    });
  } catch (error) {
    console.error("Error in getProductsByPackOli:", error.message);
    return [];
  }
};

// Get all ban products by ukuran (size)
SheetsService.prototype.getProductsByUkuranBan = async function (ukuran) {
  try {
    const products = await this.getProductsByCategory("ban");
    if (!ukuran || !products) return [];
    const normalize = (s) =>
      String(s).replace(/[-/]/g, "").replace(/\s+/g, "").toLowerCase();
    const search = normalize(ukuran);
    return products.filter((p) => p.ukuran && normalize(p.ukuran) === search);
  } catch (error) {
    console.error("Error in getProductsByUkuranBan:", error.message);
    return [];
  }
};

// Get unique tire sizes (ukuran) for Ban
SheetsService.prototype.getUkuranBanList = async function () {
  try {
    await this.ensureConnected();
    const sheet = this.doc?.sheetsByTitle?.["Sheet_Ban"];
    if (!sheet) {
      console.error("Sheet_Ban not found");
      return [];
    }
    const rows = await sheet.getRows();
    const columnMap = this.columnMappings["Sheet_Ban"];
    const sizes = rows
      .map((row) => this.getCellValue(row, columnMap.ukuran))
      .filter((u) => u && u.trim() !== "");
    return [...new Set(sizes)].sort();
  } catch (error) {
    console.error("Error in getUkuranBanList:", error.message);
    return [];
  }
};

// Get unique type lampu for Lampu
SheetsService.prototype.getTypeLampuList = async function () {
  try {
    await this.ensureConnected();
    const sheet = this.doc?.sheetsByTitle?.["Sheet_Lampu"];
    if (!sheet) {
      console.error("Sheet_Lampu not found");
      return [];
    }
    const rows = await sheet.getRows();
    const columnMap = this.columnMappings["Sheet_Lampu"];
    const types = rows
      .map((row) => this.getCellValue(row, columnMap.type))
      .filter((t) => t && t.trim() !== "");
    return [...new Set(types)].sort();
  } catch (error) {
    console.error("Error in getTypeLampuList:", error.message);
    return [];
  }
};

// Get all lampu products by type lampu
SheetsService.prototype.getLampuByTypeLampu = async function (typeLampu) {
  try {
    const products = await this.getProductsByCategory("lampu");
    if (!typeLampu || !products) return [];
    const normalize = (s) =>
      String(s || "")
        .trim()
        .toLowerCase();
    const search = normalize(typeLampu);
    return products.filter((p) => p.type && normalize(p.type) === search);
  } catch (error) {
    console.error("Error in getLampuByTypeLampu:", error.message);
    return [];
  }
};
