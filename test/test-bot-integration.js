require("dotenv").config();

const facebookAPI = require("../services/facebookAPI");
const messageHandler = require("../handlers/messageHandler");
const webhookHandler = require("../handlers/webhookHandler");

async function testBotComponents() {
  console.log("🧪 Testing Bot Components...\n");

  // Test 1: Facebook API Connection
  console.log("1️⃣ Testing Facebook API Connection...");
  try {
    const connectionTest = await facebookAPI.testConnection();
    if (connectionTest.success) {
      console.log("✅ Facebook API connected successfully");
      console.log(`   Page: ${connectionTest.pageInfo.name}`);
    } else {
      console.log("❌ Facebook API connection failed:", connectionTest.error);
    }
  } catch (error) {
    console.log("❌ Facebook API test error:", error.message);
  }

  console.log();

  // Test 2: Webhook Handler Health
  console.log("2️⃣ Testing Webhook Handler...");
  try {
    const webhookHealth = webhookHandler.getWebhookHealth();
    console.log("✅ Webhook Handler Health:", webhookHealth);
  } catch (error) {
    console.log("❌ Webhook handler error:", error.message);
  }

  console.log();

  // Test 3: Facebook API Health
  console.log("3️⃣ Testing Facebook API Health...");
  try {
    const apiHealth = facebookAPI.getHealth();
    console.log("✅ Facebook API Health:", apiHealth);
  } catch (error) {
    console.log("❌ Facebook API health error:", error.message);
  }

  console.log();

  // Test 4: Message Handler Session Management
  console.log("4️⃣ Testing Message Handler Session Management...");
  try {
    // Simulate a user interaction
    const testUserId = "12345";

    // Create a session
    const session = messageHandler.getUserSession(testUserId);
    console.log("✅ Created user session:", {
      userId: testUserId,
      state: session.state,
      hasSession: messageHandler.userSessions.has(testUserId),
    });

    // Update session
    session.state = "browsing_category";
    session.currentCategory = "ban";
    console.log("✅ Updated session state to browsing_category");

    // Check session cleanup
    console.log(`✅ Active sessions: ${messageHandler.userSessions.size}`);
  } catch (error) {
    console.log("❌ Message handler session error:", error.message);
  }

  console.log();

  // Test 5: Environment Variables
  console.log("5️⃣ Checking Environment Variables...");
  const requiredVars = [
    "PAGE_ACCESS_TOKEN",
    "VERIFY_TOKEN",
    "APP_SECRET",
    "GOOGLE_SHEETS_ID",
    "GOOGLE_CREDENTIALS_PATH",
  ];

  requiredVars.forEach((varName) => {
    const value = process.env[varName];
    if (value) {
      // Mask sensitive values
      const masked =
        varName.includes("TOKEN") || varName.includes("SECRET")
          ? `${value.substring(0, 10)}...`
          : value;
      console.log(`✅ ${varName}: ${masked}`);
    } else {
      console.log(`❌ ${varName}: NOT SET`);
    }
  });

  console.log("\n🎯 Bot Component Tests Complete!\n");
}

// Run the tests
testBotComponents().catch((error) => {
  console.error("❌ Test runner error:", error.message);
});

module.exports = { testBotComponents };
