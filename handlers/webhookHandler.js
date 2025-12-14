const messageHandler = require("./messageHandler");

class WebhookHandler {
  constructor() {
    this.verifyToken = process.env.VERIFY_TOKEN;
  }

  // GET /webhook - Facebook webhook verification
  verifyWebhook(req, res) {
    console.log("🔍 Webhook verification request received");

    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    console.log("Verification details:", { mode, token, challenge });
    console.log(`Expected token: ${this.verifyToken}`);

    if (mode === "subscribe" && token === this.verifyToken) {
      console.log("Webhook verification successful");
      res.status(200).send(challenge);
    } else {
      console.log("Webhook verification failed");
      console.log(`Expected token: ${this.verifyToken}`);
      console.log(`Received token: ${token}`);
      res.status(403).send("Forbidden");
    }
  }

  // POST /webhook - Handle incoming messages
  async handleWebhook(req, res) {
    try {
      console.log("Webhook payload received");

      const body = req.body;

      // Check if this is a page subscription
      if (body.object !== "page") {
        console.log("Not a page subscription");
        return res.status(404).send("Not Found");
      }

      // Log webhook stats
      this.logWebhookStats(body);

      // Process each entry in the webhook payload
      for (const entry of body.entry || []) {
        console.log(`Processing entry for page ${entry.id}`);

        // Handle messaging events
        if (entry.messaging) {
          for (const messagingEvent of entry.messaging) {
            await this.processMessagingEvent(messagingEvent);
          }
        }

        // Handle feed events (optional - for page posts, likes, etc.)
        if (entry.changes) {
          console.log("Page changes detected:", entry.changes.length);
          // We can implement page change handling here if needed
        }
      }

      // Always respond with 200 OK to Facebook
      res.status(200).send("EVENT_RECEIVED");
    } catch (error) {
      console.error("Webhook handling error:", error.message);
      console.error("Stack:", error.stack);

      // Still respond OK to Facebook to avoid retries
      res.status(200).send("EVENT_RECEIVED");
    }
  }

  async processMessagingEvent(event) {
    const senderId = event.sender?.id;
    const pageId = event.recipient?.id;
    const timestamp = event.timestamp;

    if (!senderId) {
      console.log("No sender ID in messaging event");
      return;
    }

    console.log(
      `👤 Message event from ${senderId} to page ${pageId} at ${new Date(
        timestamp
      )}`
    );

    try {
      // Handle different types of messaging events
      if (event.message) {
        await this.handleMessage(senderId, event.message);
      } else if (event.postback) {
        await this.handlePostback(senderId, event.postback);
      } else if (event.delivery) {
        await this.handleDelivery(senderId, event.delivery);
      } else if (event.read) {
        await this.handleRead(senderId, event.read);
      } else if (event.optin) {
        await this.handleOptin(senderId, event.optin);
      } else if (event.referral) {
        await this.handleReferral(senderId, event.referral);
      } else {
        console.log("🤷‍♂️ Unknown messaging event type:", Object.keys(event));
      }
    } catch (error) {
      console.error(`Error processing event from ${senderId}:`, error.message);

      // Try to send error message to user
      try {
        await messageHandler.sendTextMessage(
          senderId,
          "Maaf, ada error. Coba lagi ya! 🙏"
        );
      } catch (sendError) {
        console.error("Failed to send error message:", sendError.message);
      }
    }
  }

  async handleMessage(senderId, message) {
    console.log(`Message from ${senderId}:`, message);

    // Skip if message has delivery/read receipt
    if (message.is_echo) {
      console.log("Skipping echo message (sent by our bot)");
      return;
    }

    // Log message details
    if (message.text) {
      console.log(`Text: "${message.text}"`);
    }
    if (message.quick_reply) {
      console.log(`Quick Reply: ${message.quick_reply.payload}`);
    }
    if (message.attachments) {
      console.log(`Attachments: ${message.attachments.length}`);
      message.attachments.forEach((attachment, i) => {
        console.log(
          `   ${i + 1}. Type: ${attachment.type}, URL: ${
            attachment.payload?.url || "N/A"
          }`
        );
      });
    }

    // Route to messageHandler
    await messageHandler.handleMessage(senderId, message);
  }

  async handlePostback(senderId, postback) {
    console.log(`Postback from ${senderId}:`, postback);
    console.log(`   Title: "${postback.title}"`);
    console.log(`   Payload: "${postback.payload}"`);

    // Route to messageHandler
    await messageHandler.handlePostback(senderId, postback);
  }

  async handleDelivery(senderId, delivery) {
    console.log(`Delivery confirmation from ${senderId}:`, delivery);
    // Message delivery confirmation - usually just log
    const messageIds = delivery.mids || [];
    console.log(`   Delivered messages: ${messageIds.join(", ")}`);
  }

  async handleRead(senderId, read) {
    console.log(`👁️ Read receipt from ${senderId}:`, read);
    // Message read confirmation - usually just log
    console.log(`   Read watermark: ${read.watermark}`);
  }

  async handleOptin(senderId, optin) {
    console.log(`🔐 Opt-in from ${senderId}:`, optin);
    // User opted in via plugin or checkbox
    console.log(`   Ref: ${optin.ref}`);

    // Send welcome message for new opt-ins
    await messageHandler.sendWelcomeMessage(senderId);
  }

  async handleReferral(senderId, referral) {
    console.log(`🔗 Referral from ${senderId}:`, referral);
    // User came from m.me link or ad
    console.log(`   Ref: ${referral.ref}`);
    console.log(`   Source: ${referral.source}`);
    console.log(`   Type: ${referral.type}`);

    // Send welcome message for referrals
    await messageHandler.sendWelcomeMessage(senderId);
  }

  // Utility methods
  validateWebhookPayload(body) {
    // Basic validation
    if (!body.object) {
      throw new Error("Missing object in webhook payload");
    }

    if (!body.entry || !Array.isArray(body.entry)) {
      throw new Error("Missing or invalid entry in webhook payload");
    }

    return true;
  }

  logWebhookStats(body) {
    const stats = {
      object: body.object,
      entries: body.entry?.length || 0,
      messaging_events: 0,
      changes: 0,
    };

    if (body.entry) {
      for (const entry of body.entry) {
        if (entry.messaging) stats.messaging_events += entry.messaging.length;
        if (entry.changes) stats.changes += entry.changes.length;
      }
    }

    console.log("📊 Webhook stats:", stats);
    return stats;
  }

  // Health check for webhooks
  getWebhookHealth() {
    return {
      status: "healthy",
      verify_token_configured: !!this.verifyToken,
      handlers: {
        message: "active",
        postback: "active",
        delivery: "active",
        read: "active",
        optin: "active",
        referral: "active",
      },
      last_activity: new Date().toISOString(),
    };
  }
}

module.exports = new WebhookHandler();
