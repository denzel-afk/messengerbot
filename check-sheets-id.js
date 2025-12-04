require("dotenv").config();
const { GoogleSpreadsheet } = require("google-spreadsheet");
const { JWT } = require("google-auth-library");
const fs = require("fs");

async function testGoogleSheetsConnection() {
  try {
    console.log("🧪 Testing Google Sheets Connection...\n");

    // Load credentials
    const credentials = JSON.parse(
      fs.readFileSync("./data/credentials.json", "utf8")
    );
    console.log(`📧 Service Account: ${credentials.client_email}`);
    console.log(`🆔 Project ID: ${credentials.project_id}`);

    // Initialize auth
    const serviceAccountAuth = new JWT({
      email: credentials.client_email,
      key: credentials.private_key,
      scopes: [
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/drive.readonly",
      ],
    });

    // Connect to sheet
    const doc = new GoogleSpreadsheet(
      process.env.GOOGLE_SHEETS_ID,
      serviceAccountAuth
    );

    console.log("🔗 Connecting to Google Sheet...");
    await doc.loadInfo();

    console.log("✅ Connection successful!");
    console.log(`📊 Sheet Title: "${doc.title}"`);
    console.log(`📂 Total Sheets: ${Object.keys(doc.sheetsByTitle).length}`);
    console.log(
      `📋 Available Sheets: ${Object.keys(doc.sheetsByTitle).join(", ")}`
    );

    // Test reading data from first sheet
    const firstSheetName = Object.keys(doc.sheetsByTitle)[0];
    const firstSheet = doc.sheetsByTitle[firstSheetName];
    const rows = await firstSheet.getRows();

    console.log(`\n📄 First sheet "${firstSheetName}": ${rows.length} rows`);

    if (rows.length > 0) {
      console.log("📋 Sample data:");
      const headers = firstSheet.headerValues;
      console.log(`   Headers: ${headers.join(", ")}`);
      console.log(
        `   First row: ${headers
          .map((h) => rows[5].get(h) || "(empty)")
          .join(", ")}`
      );
    }

    console.log("\n🎉 Google Sheets setup complete!");
  } catch (error) {
    console.error("❌ Connection failed:", error.message);

    if (error.message.includes("403") || error.message.includes("permission")) {
      console.log(
        "\n🔧 Fix: Share your Google Sheet with service account email:"
      );
      console.log(
        `   messengerbot-service@messenger-bot-480215.iam.gserviceaccount.com`
      );
    } else if (error.message.includes("404")) {
      console.log("\n🔧 Fix: Check your GOOGLE_SHEETS_ID in .env file");
    } else if (error.message.includes("API")) {
      console.log("\n🔧 Fix: Enable Google Sheets API in Google Cloud Console");
    }
  }
}

testGoogleSheetsConnection();
