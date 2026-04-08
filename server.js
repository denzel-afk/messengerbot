require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");

const webhookHandler = require("./handlers/webhookHandler");
const messageHandler = require("./handlers/messageHandler");
const sheetsService = require("./services/sheetsService");
const facebookAPI = require("./services/facebookAPI");

const app = express();
const PORT = parseInt(process.env.PORT, 10) || 3000;
const HOST = "0.0.0.0";

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.url}`);
  if (req.body && Object.keys(req.body).length > 0) {
    console.log("Body:", JSON.stringify(req.body, null, 2));
  }
  next();
});

// ... semua route tetap ...

const server = app.listen(PORT, HOST, async () => {
  console.log("\nFacebook Messenger Bot Server Started!");
  console.log("==========================================");
  console.log(`Server running on http://${HOST}:${PORT}`);
  console.log(`Webhook path: /webhook`);
  console.log(`Health check: /health`);
  console.log("==========================================\n");

  console.log("Running startup checks...\n");

  try {
    await sheetsService.initialize();
    console.log("✅ Google Sheets connected successfully\n");
  } catch (error) {
    console.error("❌ Failed to connect to Google Sheets:", error.message);
  }

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
  } else {
    console.log("\nAll required environment variables configured\n");
  }

  setInterval(
    () => {
      messageHandler.cleanupSessions();
    },
    10 * 60 * 1000,
  );
});
