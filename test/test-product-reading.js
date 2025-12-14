require("dotenv").config();
const sheetsService = require("../services/sheetsService");

async function testProductReading() {
  try {
    console.log("🧪 Testing Product Reading Capabilities...\n");

    // 1. Initialize
    await sheetsService.initialize();

    // 2. Test categories
    console.log("📂 Available Categories:");
    const categories = sheetsService.getAvailableCategories();
    categories.forEach((cat) => {
      console.log(`   ${cat.emoji} ${cat.display_name} (${cat.name})`);
    });

    // 3. Test each category
    for (const category of categories) {
      console.log(`\n🔍 Testing ${category.display_name}...`);
      const products = await sheetsService.getProductsByCategory(category.name);
      console.log(`   Found: ${products.length} products`);

      if (products.length > 0) {
        const sample = products[0];
        console.log(`   Sample: ${sample.name}`);
        console.log(
          `   Price: Rp ${sample.harga_jual?.toLocaleString() || "N/A"}`
        );
        console.log(`   Specs: ${sample.specifications || "N/A"}`);

        // Show category-specific fields
        if (sample.ukuran) console.log(`   Size: ${sample.ukuran}`);
        if (sample.pattern) console.log(`   Pattern: ${sample.pattern}`);
        if (sample.type) console.log(`   Type: ${sample.type}`);
        if (sample.color) console.log(`   Color: ${sample.color}`);
        if (sample.volume) console.log(`   Volume: ${sample.volume}`);
      }
    }

    // 4. Test search
    console.log("\n🔍 Testing Search...");
    const searchTerms = ["CORSA", "ban", "90/80"];

    for (const term of searchTerms) {
      const results = await sheetsService.searchProducts(term);
      console.log(`   "${term}": ${results.length} results`);
    }

    console.log("\n✅ Product reading test complete!");
  } catch (error) {
    console.error("❌ Test failed:", error.message);
  }
}

testProductReading();
