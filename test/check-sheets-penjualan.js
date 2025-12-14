require("dotenv").config();
const sheetsService = require("../services/sheetsService");

async function checkPenjualanSheet() {
  try {
    console.log("🔍 Checking Sheet_Penjualan setup...\n");

    await sheetsService.initialize();

    const availableSheets = Object.keys(sheetsService.doc.sheetsByTitle);
    console.log(`📂 Available sheets: ${availableSheets.join(", ")}`);

    if (availableSheets.includes("Sheet_Penjualan")) {
      console.log("✅ Sheet_Penjualan found!");

      // Check headers
      const penjualanSheet = sheetsService.doc.sheetsByTitle["Sheet_Penjualan"];
      const rows = await penjualanSheet.getRows();

      console.log(`📋 Current orders in Sheet_Penjualan: ${rows.length}`);

      if (rows.length > 0) {
        console.log("📝 Sample order:");
        console.log(`   Order ID: ${rows[0].get("ORDER_ID") || "N/A"}`);
        console.log(`   Customer: ${rows[0].get("CUSTOMER_NAME") || "N/A"}`);
        console.log(`   Product: ${rows[0].get("PRODUCT_NAME") || "N/A"}`);
      }

      console.log("\n🎉 Sheet_Penjualan is ready for orders!");
    } else {
      console.log("❌ Sheet_Penjualan NOT found!");
      console.log("\n🔧 CREATE SHEET MANUALLY:");
      console.log(
        `   1. Open: https://docs.google.com/spreadsheets/d/${process.env.GOOGLE_SHEETS_ID}/edit`
      );
      console.log(`   2. Click "+" button at bottom to add new sheet`);
      console.log(`   3. Rename new sheet to: Sheet_Penjualan`);
      console.log(`   4. Add these headers in Row 1:`);
      console.log(
        `      ORDER_ID | TANGGAL | WAKTU | CUSTOMER_NAME | CUSTOMER_PHONE | MESSENGER_ID | PRODUCT_NAME | KATEGORI | SPECIFICATIONS | QUANTITY | HARGA_SATUAN | HARGA_PASANG | TOTAL_HARGA | STATUS | NOTES | PAYMENT_STATUS | UPDATED_AT`
      );
      console.log("\n   Then run this script again to verify! ✨");
    }
  } catch (error) {
    console.error("❌ Error:", error.message);
  }
}

checkPenjualanSheet();
