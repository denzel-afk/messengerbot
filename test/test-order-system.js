require("dotenv").config();
const sheetsService = require("../services/sheetsService");

async function testOrderSystem() {
  try {
    console.log("🧪 Testing Order Management System...\n");

    await sheetsService.initialize();

    // 1. Create a test order
    console.log("📝 Creating test order...");
    const orderResult = await sheetsService.createOrder({
      customer_name: "John Doe",
      customer_phone: "+628123456789",
      messenger_id: "FB_TEST_" + Date.now(),
      product_name: "CORSA R46 90/80-17",
      category: "ban",
      specifications: "90/80-17 - R46",
      quantity: 2,
      price: 421500,
      harga_pasang: 25000,
      notes: "Test order from automated test",
    });

    if (orderResult.success) {
      console.log("✅ Order created successfully!");
      console.log(`   Order ID: ${orderResult.order_id}`);
      console.log(`   Total: Rp ${orderResult.total_amount.toLocaleString()}`);

      // 2. Retrieve the order
      console.log("\n📋 Retrieving order...");
      const orderInfo = await sheetsService.getOrderById(orderResult.order_id);
      if (orderInfo.success) {
        console.log("✅ Order retrieved:");
        console.log(`   Customer: ${orderInfo.order.customer_name}`);
        console.log(`   Phone: ${orderInfo.order.customer_phone}`);
        console.log(`   Product: ${orderInfo.order.product_name}`);
        console.log(`   Status: ${orderInfo.order.status}`);
      }

      // 3. Update order status
      console.log("\n🔄 Updating order status...");
      const statusUpdate = await sheetsService.updateOrderStatus(
        orderResult.order_id,
        "CONFIRMED"
      );
      if (statusUpdate.success) {
        console.log("✅ Status updated to CONFIRMED");

        // Verify update
        const updatedOrder = await sheetsService.getOrderById(
          orderResult.order_id
        );
        if (updatedOrder.success) {
          console.log(`   New status: ${updatedOrder.order.status}`);
        }
      }
    } else {
      console.log("❌ Order creation failed:", orderResult.error);
    }

    // 4. Generate sales report
    console.log("\n📊 Generating sales report...");
    const report = await sheetsService.getSalesReport(5);
    if (report.success) {
      console.log("✅ Sales Report:");
      console.log(`   Total Orders: ${report.summary.total_orders}`);
      console.log(
        `   Total Revenue: Rp ${report.summary.total_revenue.toLocaleString()}`
      );
      console.log(`   Recent Orders: ${report.summary.recent_orders.length}`);

      if (report.summary.recent_orders.length > 0) {
        console.log("\n   Latest Order:");
        const latest = report.summary.recent_orders[0];
        console.log(`     ID: ${latest.order_id}`);
        console.log(`     Customer: ${latest.customer_name}`);
        console.log(`     Product: ${latest.product_name}`);
        console.log(
          `     Total: Rp ${parseInt(latest.total).toLocaleString()}`
        );
      }
    }

    console.log("\n✅ Order system test complete!");
  } catch (error) {
    console.error("❌ Test failed:", error.message);
  }
}

testOrderSystem();
