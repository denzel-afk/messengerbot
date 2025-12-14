require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");

// Import handlers and services
const webhookHandler = require("./handlers/webhookHandler");
const messageHandler = require("./handlers/messageHandler");
const sheetsService = require("./services/sheetsService");
const facebookAPI = require("./services/facebookAPI");

const app = express();
const PORT = process.env.PORT || 80;

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Add request logging
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.url}`);
  if (req.body && Object.keys(req.body).length > 0) {
    console.log("Body:", JSON.stringify(req.body, null, 2));
  }
  next();
});

app.get("/webhook", (req, res) => {
  webhookHandler.verifyWebhook(req, res);
});

app.post("/webhook", (req, res) => {
  webhookHandler.handleWebhook(req, res);
});

// Privacy policy page
app.get("/privacy", (req, res) => {
  res.sendFile(__dirname + "/privacy.html");
});

app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || "development",
  });
});

// Detailed system health
app.get("/health/detailed", async (req, res) => {
  try {
    const health = {
      server: {
        status: "healthy",
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        environment: process.env.NODE_ENV || "development",
      },
      facebook: facebookAPI.getHealth(),
      webhook: webhookHandler.getWebhookHealth(),
      sheets: {
        configured: !!process.env.GOOGLE_SHEETS_ID,
        credentials_path: process.env.GOOGLE_CREDENTIALS_PATH,
      },
      environment: {
        page_access_token: !!process.env.PAGE_ACCESS_TOKEN,
        verify_token: !!process.env.VERIFY_TOKEN,
        app_secret: !!process.env.APP_SECRET,
        google_sheets_id: !!process.env.GOOGLE_SHEETS_ID,
        google_credentials: !!process.env.GOOGLE_CREDENTIALS_PATH,
      },
    };

    res.json(health);
  } catch (error) {
    res.status(500).json({
      status: "error",
      error: error.message,
    });
  }
});

app.get("/test/facebook", async (req, res) => {
  try {
    const connectionTest = await facebookAPI.testConnection();

    res.json({
      success: connectionTest.success,
      data: connectionTest.success ? connectionTest.pageInfo : null,
      error: connectionTest.success ? null : connectionTest.error,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Test webhook health
app.get("/test/webhook", (req, res) => {
  try {
    const health = webhookHandler.getWebhookHealth();

    res.json({ success: true, data: health });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Test Google Sheets connection
app.get("/test/sheets", async (req, res) => {
  try {
    const products = await sheetsService.getProductsByCategory("ban", 3);

    res.json({
      success: true,
      message: `Successfully connected to Google Sheets`,
      sample_products: products.length,
      data: products.slice(0, 2),
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Test product categories
app.get("/test/categories", async (req, res) => {
  try {
    const categories = ["ban", "oli", "lampu", "cat"];
    const results = {};

    for (const category of categories) {
      try {
        const products = await sheetsService.getProductsByCategory(category, 3);
        results[category] = {
          success: true,
          count: products.length,
          sample: products.length > 0 ? products[0].nama : null,
        };
      } catch (error) {
        results[category] = {
          success: false,
          error: error.message,
        };
      }
    }

    res.json({
      success: true,
      categories: results,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Test product search
app.get("/test/search", async (req, res) => {
  try {
    const query = req.query.q || "ban";
    const category = req.query.category || null;

    const results = await sheetsService.searchProducts(query, category);

    res.json({
      success: true,
      query: query,
      category: category,
      results: results.length,
      data: results.slice(0, 5),
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Test order creation
app.post("/test/order", async (req, res) => {
  try {
    const testOrder = {
      customerName: "Test Customer",
      customerPhone: "+6512345678",
      items: [
        {
          nama: "Test Product",
          harga: 50000,
          quantity: 2,
          category: "ban",
        },
      ],
      totalAmount: 100000,
      orderDate: new Date(),
      status: "pending",
    };

    const orderId = await sheetsService.createOrder(testOrder);

    res.json({
      success: true,
      orderId: orderId,
      message: "Test order created successfully",
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Test message handler (simulate message)
app.post("/test/message", async (req, res) => {
  try {
    const { senderId, message } = req.body;

    if (!senderId || !message) {
      return res.status(400).json({
        success: false,
        error: "senderId and message are required",
      });
    }

    // Simulate message handling (without actually sending to Facebook)
    const mockMessage = {
      text: message,
      mid: "test_message_id_" + Date.now(),
    };

    console.log(`🧪 Testing message handling for ${senderId}: "${message}"`);

    // This would normally be called by webhook
    // For testing, we just validate the structure
    const session = messageHandler.getUserSession(senderId);

    res.json({
      success: true,
      senderId: senderId,
      message: message,
      sessionState: session.state,
      message_processed: true,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ADMIN ENDPOINTS (for debugging)
// ===============================

// Get active sessions
app.get("/admin/sessions", (req, res) => {
  try {
    const sessions = {};
    messageHandler.userSessions.forEach((session, senderId) => {
      sessions[senderId] = {
        state: session.state,
        lastActivity: new Date(session.lastActivity).toISOString(),
        hasOrder: !!session.currentOrder,
      };
    });

    res.json({
      success: true,
      count: messageHandler.userSessions.size,
      sessions: sessions,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Clear all sessions
app.post("/admin/sessions/clear", (req, res) => {
  try {
    const count = messageHandler.userSessions.size;
    messageHandler.userSessions.clear();

    res.json({
      success: true,
      message: `Cleared ${count} sessions`,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get recent orders
app.get("/admin/orders", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const orders = await sheetsService.getSalesReport(limit);

    res.json({
      success: true,
      count: orders.length,
      orders: orders,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// CATCH-ALL ERROR HANDLER
// =======================

app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: "Endpoint not found",
    available_endpoints: [
      "GET /webhook - Webhook verification",
      "POST /webhook - Handle messages",
      "GET /health - Basic health check",
      "GET /health/detailed - Detailed system health",
      "GET /test/facebook - Test Facebook API",
      "GET /test/webhook - Test webhook health",
      "GET /test/sheets - Test Google Sheets",
      "GET /test/categories - Test product categories",
      "GET /test/search?q=query - Test product search",
      "POST /test/order - Test order creation",
      "POST /test/message - Test message handling",
      "GET /admin/sessions - View active sessions",
      "POST /admin/sessions/clear - Clear all sessions",
      "GET /admin/orders - View recent orders",
    ],
  });
});

// GLOBAL ERROR HANDLER
app.use((error, req, res, next) => {
  console.error("Global error handler:", error.message);
  console.error("Stack:", error.stack);

  res.status(500).json({
    success: false,
    error: "Internal server error",
    message:
      process.env.NODE_ENV === "development"
        ? error.message
        : "Something went wrong",
  });
});

// START SERVER
// ============

const server = app.listen(PORT, async () => {
  console.log("\nFacebook Messenger Bot Server Started!");
  console.log("==========================================");
  console.log(`Server running on port ${PORT}`);
  console.log(`Webhook URL: http://localhost:${PORT}/webhook`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`Test endpoints: http://localhost:${PORT}/test/facebook`);
  console.log("==========================================\n");

  // Run startup checks
  console.log("Running startup checks...\n");

  // Initialize Google Sheets connection
  try {
    await sheetsService.initialize();
    console.log("✅ Google Sheets connected successfully\n");
  } catch (error) {
    console.error("❌ Failed to connect to Google Sheets:", error.message);
  }

  // Check environment variables
  const requiredVars = [
    "PAGE_ACCESS_TOKEN",
    "VERIFY_TOKEN",
    "GOOGLE_SHEETS_ID",
  ];
  let missingVars = false;

  requiredVars.forEach((varName) => {
    if (!process.env[varName]) {
      console.log(`Missing environment variable: ${varName}`);
      missingVars = true;
    } else {
      console.log(`${varName} configured`);
    }
  });

  if (missingVars) {
    console.log("\nSome environment variables are missing!");
    console.log("Please check your .env file\n");
  } else {
    console.log("\nAll required environment variables configured\n");
  }

  // Clean up sessions periodically
  setInterval(() => {
    messageHandler.cleanupSessions();
  }, 10 * 60 * 1000); // Every 10 minutes
});

// GRACEFUL SHUTDOWN
process.on("SIGTERM", () => {
  console.log("\nSIGTERM received, shutting down gracefully...");
  server.close(() => {
    console.log("Process terminated gracefully");
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  console.log("\nSIGINT received, shutting down gracefully...");
  server.close(() => {
    console.log("Process terminated gracefully");
    process.exit(0);
  });
});

module.exports = app;
