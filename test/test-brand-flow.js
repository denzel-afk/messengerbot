require("dotenv").config();

const sheetsService = require("../services/sheetsService");

async function testBrandFlow() {
  console.log("🧪 Testing New Brand-Based Flow...\n");

  try {
    // Initialize sheets service first
    console.log("🔧 Initializing Google Sheets connection...");
    await sheetsService.initialize();
    console.log("✅ Google Sheets connected\n");

    // Test 1: Get brands for each category
    console.log("1️⃣ Testing getBrandsByCategory...");

    const categories = ["ban", "oli", "lampu", "cat"];

    for (const category of categories) {
      console.log(`\n📂 Category: ${category.toUpperCase()}`);

      const brands = await sheetsService.getBrandsByCategory(category);
      console.log(`🏷️ Found ${brands.length} brands:`, brands.slice(0, 5));

      if (brands.length > 0) {
        // Test getting products for first brand
        const firstBrand = brands[0];
        console.log(`\n   Testing products for brand: "${firstBrand}"`);

        const products = await sheetsService.getProductsByBrand(
          category,
          firstBrand
        );
        console.log(
          `   📦 Found ${products.length} products for "${firstBrand}"`
        );

        if (products.length > 0) {
          const sampleProduct = products[0];
          console.log("Sample product:", {
            name: sampleProduct.name,
            brand: sampleProduct.brand,
            category: sampleProduct.category,
            price: sampleProduct.harga_jual || sampleProduct.base_price,
          });
        }
      }
    }

    console.log("\nBrand flow test completed!\n");
  } catch (error) {
    console.error("Test failed:", error.message);
  }
}

// Run the test
testBrandFlow();

module.exports = { testBrandFlow };
