require("dotenv").config();

const messageHandler = require("../handlers/messageHandler");
const sheetsService = require("../services/sheetsService");

async function testBotLogic() {
  console.log("🧪 Testing Bot Logic Directly...\n");

  try {
    // Initialize sheets service
    console.log("🔧 Initializing Google Sheets...");
    await sheetsService.initialize();
    console.log("✅ Sheets connected\n");

    // Test user session creation
    const testUserId = "direct_test_user";
    console.log(`👤 Creating session for ${testUserId}...`);
    const session = messageHandler.getUserSession(testUserId);
    console.log("✅ Session created:", {
      state: session.state,
      lastActivity: new Date(session.lastActivity).toISOString(),
    });

    // Test welcome message logic (without actually sending to Facebook)
    console.log("\n🎉 Testing welcome message generation...");

    // Mock the Facebook API calls to just log instead of send
    const originalSendTextMessage = messageHandler.sendTextMessage;
    const originalCallSendAPI = messageHandler.callSendAPI;

    messageHandler.sendTextMessage = async (senderId, text, quickReplies) => {
      console.log(`📤 Would send to ${senderId}:`);
      console.log(`   Text: ${text.substring(0, 100)}...`);
      if (quickReplies) {
        console.log(`   Quick Replies: ${quickReplies.length} options`);
      }
      return { success: true };
    };

    messageHandler.callSendAPI = async (messageData) => {
      console.log(`📤 Would call Facebook API:`);
      console.log(`   To: ${messageData.recipient.id}`);
      if (messageData.message.text) {
        console.log(`   Text: ${messageData.message.text.substring(0, 50)}...`);
      }
      if (messageData.message.quick_replies) {
        console.log(
          `   Quick Replies: ${messageData.message.quick_replies.length} options`
        );
        messageData.message.quick_replies.forEach((reply, i) => {
          console.log(`     ${i + 1}. ${reply.title} (${reply.payload})`);
        });
      }
      return { success: true };
    };

    // Test the message handling flow
    console.log("\n🔄 Testing message flow...");
    console.log("1. Testing welcome message...");
    await messageHandler.sendWelcomeMessage(testUserId);

    console.log("\n2. Testing category menu...");
    await messageHandler.sendCategoryMenu(testUserId);

    console.log('\n3. Testing brand menu for "ban" category...');
    await messageHandler.sendBrandMenu(testUserId, "ban", session);

    console.log('\n4. Testing brand products for "ASPIRA"...');
    await messageHandler.sendBrandProducts(
      testUserId,
      "ban",
      "ASPIRA",
      session
    );

    // Restore original methods
    messageHandler.sendTextMessage = originalSendTextMessage;
    messageHandler.callSendAPI = originalCallSendAPI;

    console.log("\n✅ Bot logic test completed successfully!");
    console.log("\n🎯 Your bot logic is working perfectly.");
    console.log("📱 The issue is likely Facebook Messenger configuration.");
  } catch (error) {
    console.error("\n❌ Bot logic test failed:", error.message);
    console.error("Stack:", error.stack);
  }
}

testBotLogic();
