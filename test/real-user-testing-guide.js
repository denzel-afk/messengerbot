#!/usr/bin/env node

console.log("🧪 REAL FACEBOOK MESSENGER USER TESTING GUIDE");
console.log("==============================================\n");

console.log("🔗 YOUR NGROK URL: https://503d02ee0d66.ngrok-free.app");
console.log("🖥️  Server Status: RUNNING on port 80");
console.log(
  "📡 Webhook Endpoint: https://503d02ee0d66.ngrok-free.app/webhook\n"
);

console.log("📋 STEP-BY-STEP TESTING PROCESS:");
console.log("=================================\n");

console.log("1️⃣ FACEBOOK APP CONFIGURATION:");
console.log("   • Go to https://developers.facebook.com/apps");
console.log("   • Select your Messenger bot app");
console.log("   • Go to Messenger > Settings > Webhooks");
console.log(
  "   • Update webhook URL to: https://503d02ee0d66.ngrok-free.app/webhook"
);
console.log("   • Verify token should already be configured");
console.log("   • Subscribe to page events\n");

console.log("2️⃣ PAGE SUBSCRIPTION:");
console.log("   • Ensure your Facebook page is subscribed");
console.log("   • Page should have webhook events enabled");
console.log("   • Check: messages, messaging_postbacks, messaging_optins\n");

console.log("3️⃣ TESTING WITH REAL USERS:");
console.log("   📱 Option A: Test as Page Admin");
console.log("      • Go to your Facebook page");
console.log("      • Send message to your own page");
console.log("      • Bot should respond immediately");
console.log("");
console.log("   👥 Option B: Add Test Users");
console.log("      • App Dashboard > Roles > Test Users");
console.log("      • Add test users to your app");
console.log("      • Test users can message your page");
console.log("");
console.log("   🌍 Option C: Make App Live");
console.log("      • Submit app for review (if needed)");
console.log("      • Anyone can message your page");
console.log("      • Full production testing\n");

console.log("4️⃣ TESTING SCENARIOS:");
console.log(
  '   🔤 Send "hello" → Should get welcome message + category buttons'
);
console.log('   🛞 Tap "Ban Motor" → Should get 13 brand buttons');
console.log('   🏷️ Tap "ASPIRA" → Should get product carousel');
console.log('   📋 Tap "Detail" → Should get product details');
console.log('   🛒 Tap "Order" → Should start order flow (name → phone)');
console.log("   📊 Complete order → Should save to Google Sheets\n");

console.log("5️⃣ MONITORING & DEBUGGING:");
console.log("   • Watch server logs in terminal");
console.log("   • Check ngrok web interface: http://127.0.0.1:4040");
console.log("   • Monitor webhook requests in real-time");
console.log("   • Check Google Sheets for new orders\n");

console.log("📱 QUICK START - TEST NOW:");
console.log("===========================");
console.log(
  "1. Update Facebook webhook URL to: https://503d02ee0d66.ngrok-free.app/webhook"
);
console.log("2. Go to your Facebook page");
console.log('3. Send message: "hello"');
console.log("4. Bot should respond with welcome + category buttons!");
console.log("");

console.log("🎯 EXPECTED BOT RESPONSES:");
console.log("===========================");
console.log('User: "hello" or "hi"');
console.log("Bot: Welcome message + 4 category quick reply buttons");
console.log("");
console.log('User: Taps "🛞 Ban Motor"');
console.log("Bot: Brand selection message + 13 brand quick reply buttons");
console.log("");
console.log('User: Taps "ASPIRA"');
console.log(
  "Bot: Product carousel with ASPIRA products + detail/order buttons"
);
console.log("");
console.log('User: Taps "🛒 Order"');
console.log('Bot: "Silakan masukkan nama Anda:"');
console.log("");
console.log('User: Types "John Doe"');
console.log('Bot: "Silakan masukkan nomor HP Anda:"');
console.log("");
console.log('User: Types "08123456789"');
console.log("Bot: Order confirmation + saved to Google Sheets");
console.log("");

console.log("🚨 TROUBLESHOOTING:");
console.log("====================");
console.log("• No response? Check webhook URL in Facebook app");
console.log("• Error messages? Check server logs");
console.log("• Products not loading? Check Google Sheets connection");
console.log("• Webhook verification failed? Check VERIFY_TOKEN");
console.log("");

console.log("🎉 Ready to test with real Facebook Messenger users!");
console.log("Your bot is fully functional and waiting for messages! 🚀");
