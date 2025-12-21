const { GoogleSpreadsheet } = require("google-spreadsheet");
const { JWT } = require("google-auth-library");
const fs = require("fs");

class SheetsService {
  constructor() {
    this.doc = null;
    this.connected = false;
    this.sheetsId = process.env.GOOGLE_SHEETS_ID;

    this.categoryMap = {
      Sheet_Ban: { name: "ban", display: "🛞 Ban Mobil & Motor", emoji: "🛞" },
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
        product_name: ["NAMA PRODUK", "PRODUCT", "NAME"],
        brand: ["MERK", "BRAND"],
        type: ["JENIS", "TYPE", "TIPE"],
        viscosity: ["KEKENTALAN", "VISCOSITY", "SAE"],
        volume: ["VOLUME", "ISI", "LITER"],
        harga_jual: ["HARGA JUAL", "HARGA"],
        price_list: ["PRICE LIST", "HARGA LIST"],
        image: ["GAMBAR", "FOTO"],
      },
      Sheet_Lampu: {
        product_name: ["NAMA PRODUK", "PRODUCT"],
        brand: ["MERK", "BRAND"],
        type: ["JENIS", "TYPE", "TIPE"],
        watt: ["WATT", "DAYA"],
        voltage: ["VOLTAGE", "VOLT"],
        fitting: ["FITTING", "SOCKET"],
        harga_jual: ["HARGA JUAL", "HARGA"],
        price_list: ["PRICE LIST"],
        image: ["GAMBAR", "FOTO"],
      },
      Sheet_Cat: {
        product_name: ["NAMA PRODUK", "PRODUCT"],
        brand: ["MERK", "BRAND"],
        color: ["WARNA", "COLOR"],
        type: ["JENIS", "TYPE"],
        size: ["UKURAN", "SIZE"],
        volume: ["VOLUME", "ISI"],
        harga_jual: ["HARGA JUAL", "HARGA"],
        price_list: ["PRICE LIST"],
        image: ["GAMBAR", "FOTO"],
      },
    };
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
      const sheetEntry = Object.entries(this.categoryMap).find(
        ([sheetName, info]) => info.name === categoryName.toLowerCase()
      );

      if (!sheetEntry) {
        console.log(`Category "${categoryName}" not found`);
        return [];
      }

      const [sheetName] = sheetEntry;
      const sheet = this.doc.sheetsByTitle[sheetName];

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

  // Parse products based on sheet type
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
      .filter((product) => product !== null);
  }

  // Get unique brands/merk from a category
  async getBrandsByCategory(categoryName) {
    try {
      console.log(`🏷️ Getting brands for category: ${categoryName}`);

      const products = await this.getProductsByCategory(categoryName);
      console.log(`📦 Found ${products.length} products in ${categoryName}`);

      // Extract unique brands
      const brands = [
        ...new Set(
          products
            .map((product) => product.brand)
            .filter((brand) => brand && brand.trim() !== "")
        ),
      ];

      console.log(`🏷️ Found ${brands.length} unique brands:`, brands);

      return brands.sort(); // Sort alphabetically
    } catch (error) {
      console.error(`Error getting brands for ${categoryName}:`, error.message);
      return [];
    }
  }

  // Get products by category and brand
  async getProductsByBrand(categoryName, brandName) {
    try {
      console.log(
        `🔍 Getting products for category: ${categoryName}, brand: ${brandName}`
      );

      const products = await this.getProductsByCategory(categoryName);
      const brandProducts = products.filter(
        (product) =>
          product.brand &&
          product.brand.toLowerCase() === brandName.toLowerCase()
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
      ukuran: ukuran,
      brand: merk,
      pattern: pattern || "",
      harga_jual: hargaJual,
      harga_pasang: hargaPasang,
      base_price: hargaJual,
      image_url: this.convertGoogleDriveUrl(gambar),
      is_available: true,
      row_index: index + 2,
      // Ban-specific fields
      specifications: `${ukuran} - ${pattern}`,
    };
  }

  // Oli-specific parser
  parseOliProduct(row, index, categoryName, columnMap) {
    const productName = this.getCellValue(row, columnMap.product_name);
    const brand = this.getCellValue(row, columnMap.brand);
    const type = this.getCellValue(row, columnMap.type);
    const viscosity = this.getCellValue(row, columnMap.viscosity);
    const volume = this.getCellValue(row, columnMap.volume);
    const hargaJual = this.getNumericValue(row, columnMap.harga_jual);
    const gambar = this.getCellValue(row, columnMap.image);

    if (!productName && !brand) return null;

    return {
      id: `${categoryName}_${index + 1}`,
      category: categoryName,
      name: productName || `${brand} ${type}`,
      brand: brand,
      type: type,
      viscosity: viscosity,
      volume: volume,
      harga_jual: hargaJual,
      base_price: hargaJual,
      image_url: this.convertGoogleDriveUrl(gambar),
      is_available: true,
      row_index: index + 2,
      // Oli-specific fields
      specifications: `${viscosity} - ${volume}`,
    };
  }

  // Lampu-specific parser
  parseLampuProduct(row, index, categoryName, columnMap) {
    const productName = this.getCellValue(row, columnMap.product_name);
    const brand = this.getCellValue(row, columnMap.brand);
    const type = this.getCellValue(row, columnMap.type);
    const watt = this.getCellValue(row, columnMap.watt);
    const voltage = this.getCellValue(row, columnMap.voltage);
    const fitting = this.getCellValue(row, columnMap.fitting);
    const hargaJual = this.getNumericValue(row, columnMap.harga_jual);
    const gambar = this.getCellValue(row, columnMap.image);

    if (!productName && !brand) return null;

    return {
      id: `${categoryName}_${index + 1}`,
      category: categoryName,
      name: productName || `${brand} ${type}`,
      brand: brand,
      type: type,
      watt: watt,
      voltage: voltage,
      fitting: fitting,
      harga_jual: hargaJual,
      base_price: hargaJual,
      image_url: this.convertGoogleDriveUrl(gambar),
      is_available: true,
      row_index: index + 2,
      // Lampu-specific fields
      specifications: `${watt}W - ${voltage}V - ${fitting}`,
    };
  }

  // Cat-specific parser
  parseCatProduct(row, index, categoryName, columnMap) {
    const productName = this.getCellValue(row, columnMap.product_name);
    const brand = this.getCellValue(row, columnMap.brand);
    const color = this.getCellValue(row, columnMap.color);
    const type = this.getCellValue(row, columnMap.type);
    const volume = this.getCellValue(row, columnMap.volume);
    const hargaJual = this.getNumericValue(row, columnMap.harga_jual);
    const gambar = this.getCellValue(row, columnMap.image);

    if (!productName && !brand) return null;

    return {
      id: `${categoryName}_${index + 1}`,
      category: categoryName,
      name: productName || `${brand} ${color}`,
      brand: brand,
      color: color,
      type: type,
      volume: volume,
      harga_jual: hargaJual,
      base_price: hargaJual,
      image_url: this.convertGoogleDriveUrl(gambar),
      is_available: true,
      row_index: index + 2,
      // Cat-specific fields
      specifications: `${color} - ${type} - ${volume}`,
    };
  }

  // Generic parser for unknown sheet types
  parseGenericProduct(row, index, categoryName) {
    const possibleNameColumns = [
      "NAMA PRODUK",
      "PRODUCT",
      "NAME",
      "MERK",
      "BRAND",
    ];
    const possiblePriceColumns = ["HARGA JUAL", "HARGA", "PRICE"];
    const possibleImageColumns = ["GAMBAR", "FOTO", "IMAGE"];

    const name = this.getCellValue(row, possibleNameColumns);
    const price = this.getNumericValue(row, possiblePriceColumns);
    const image = this.getCellValue(row, possibleImageColumns);

    if (!name) return null;

    return {
      id: `${categoryName}_${index + 1}`,
      category: categoryName,
      name: name,
      harga_jual: price,
      base_price: price,
      image_url: this.convertGoogleDriveUrl(image),
      is_available: true,
      row_index: index + 2,
      specifications: "Generic product",
    };
  }

  getCellValue(row, keys) {
    for (const key of keys) {
      try {
        const value = row.get(key);
        if (value && value.toString().trim() !== "") {
          return value.toString().trim();
        }
      } catch (error) {
        continue;
      }
    }
    return "";
  }

  getNumericValue(row, keys) {
    const value = this.getCellValue(row, keys);
    if (!value) return 0;
    return parseInt(value.replace(/[^\d]/g, "")) || 0;
  }

  convertGoogleDriveUrl(url) {
    if (!url || typeof url !== "string") return "";

    // Already direct non-drive url
    if (url.startsWith("http") && !url.includes("drive.google.com")) return url;

    if (!url.includes("drive.google.com")) return "";

    let fileId = null;

    // /file/d/<id>/
    let m = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
    if (m) fileId = m[1];

    // open?id=<id>
    if (!fileId) {
      m = url.match(/[?&]id=([a-zA-Z0-9-_]+)/);
      if (m) fileId = m[1];
    }

    // uc?id=<id>
    if (!fileId && url.includes("/uc?")) {
      m = url.match(/[?&]id=([a-zA-Z0-9-_]+)/);
      if (m) fileId = m[1];
    }

    if (!fileId) return "";

    // ✅ BEST for Messenger hotlink:
    return `https://lh3.googleusercontent.com/d/${fileId}=w1200`;
  }

  // ... rest of the methods remain the same (createOrder, saveCustomerInfo, etc.)
  // [Keep all the existing order management methods unchanged]

  async createOrder(orderData) {
    try {
      console.log("📝 Creating order:", orderData);

      const salesSheet = this.doc.sheetsByTitle["Sheet_Penjualan"];
      if (!salesSheet) {
        const availableSheets = Object.keys(this.doc.sheetsByTitle).join(", ");
        console.error(`❌ Sheet_Penjualan not found!`);
        console.error(`📋 Available sheets: ${availableSheets}`);
        console.error(`\n🔧 QUICK FIX:`);
        console.error(
          `   1. Open: https://docs.google.com/spreadsheets/d/${this.sheetsId}/edit`
        );
        console.error(`   2. Click "+" to add new sheet`);
        console.error(`   3. Rename to: Sheet_Penjualan`);
        console.error(
          `   4. Add headers: ORDER_ID | TANGGAL | WAKTU | CUSTOMER_NAME | CUSTOMER_PHONE | MESSENGER_ID | PRODUCT_NAME | KATEGORI | SPECIFICATIONS | QUANTITY | HARGA_SATUAN | HARGA_PASANG | TOTAL_HARGA | STATUS | NOTES | PAYMENT_STATUS | UPDATED_AT`
        );

        throw new Error(
          "Sheet_Penjualan not found! Please create it manually. See console for instructions."
        );
      }

      const orderId = `ORD_${Date.now()}`;
      const currentDate = new Date();

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
        QUANTITY: orderData.quantity || 1,
        HARGA_SATUAN: orderData.price || 0,
        HARGA_PASANG: orderData.harga_pasang * 1000 - orderData.price || 0,
        TOTAL_HARGA:
          (orderData.quantity || 1) * (orderData.price || 0) +
          (orderData.harga_pasang || 0),
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
      return {
        success: false,
        error: error.message,
      };
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

    const searchLower = searchTerm.toLowerCase();
    return allProducts.filter(
      (product) =>
        product.name.toLowerCase().includes(searchLower) ||
        (product.brand && product.brand.toLowerCase().includes(searchLower)) ||
        (product.ukuran &&
          product.ukuran.toLowerCase().includes(searchLower)) ||
        (product.type && product.type.toLowerCase().includes(searchLower)) ||
        (product.color && product.color.toLowerCase().includes(searchLower))
    );
  }

  async updateOrderStatus(orderId, newStatus) {
    try {
      const salesSheet = this.doc.sheetsByTitle["Sheet_Penjualan"];
      if (!salesSheet) {
        throw new Error("Sheet_Penjualan not found");
      }

      const rows = await salesSheet.getRows();
      const orderRow = rows.find((row) => row.get("ORDER_ID") === orderId);

      if (!orderRow) {
        throw new Error(`Order ${orderId} not found`);
      }

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
      const salesSheet = this.doc.sheetsByTitle["Sheet_Penjualan"];
      if (!salesSheet)
        return { success: false, error: "Sheet_Penjualan not found" };

      const rows = await salesSheet.getRows();
      const orderRow = rows.find((row) => row.get("ORDER_ID") === orderId);

      if (!orderRow) {
        return { success: false, error: `Order ${orderId} not found` };
      }

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
      const salesSheet = this.doc.sheetsByTitle["Sheet_Penjualan"];
      if (!salesSheet) {
        return { success: false, error: "Sheet_Penjualan not found" };
      }

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
      const [categoryName, indexStr] = productId.split("_");
      const index = parseInt(indexStr) - 1;

      const products = await this.getProductsByCategory(categoryName);

      if (index < 0 || index >= products.length) {
        return { success: false, error: `Product ${productId} not found` };
      }

      return {
        success: true,
        product: products[index],
      };
    } catch (error) {
      console.error("Error getting product by ID:", error.message);
      return { success: false, error: error.message };
    }
  }
}

module.exports = new SheetsService();

// --- ADD: Get all ban products by ukuran (size) ---
SheetsService.prototype.getProductsByUkuranBan = async function (ukuran) {
  try {
    const products = await this.getProductsByCategory("ban");
    if (!ukuran || !products) return [];
    // Normalize: replace - and / with nothing, remove spaces, lowercase
    const normalize = (s) =>
      String(s).replace(/[-/]/g, "").replace(/\s+/g, "").toLowerCase();
    const search = normalize(ukuran);
    return products.filter((p) => p.ukuran && normalize(p.ukuran) === search);
  } catch (error) {
    console.error("Error in getProductsByUkuranBan:", error.message);
    return [];
  }
};

// --- ADD: Get unique tire sizes (ukuran) for Ban ---
SheetsService.prototype.getUkuranBanList = async function () {
  try {
    const sheet = this.doc.sheetsByTitle["Sheet_Ban"];
    if (!sheet) {
      console.error("Sheet_Ban not found");
      return [];
    }
    const rows = await sheet.getRows();
    const columnMap = this.columnMappings["Sheet_Ban"];
    const sizes = rows
      .map((row) => this.getCellValue(row, columnMap.ukuran))
      .filter((ukuran) => ukuran && ukuran.trim() !== "");
    // Unique and sorted
    return [...new Set(sizes)].sort();
  } catch (error) {
    console.error("Error in getUkuranBanList:", error.message);
    return [];
  }
};
