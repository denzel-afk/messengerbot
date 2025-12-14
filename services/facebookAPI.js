const axios = require("axios");

class FacebookAPI {
  constructor() {
    this.pageAccessToken = process.env.PAGE_ACCESS_TOKEN;
    this.apiVersion = "v18.0";
    this.baseURL = `https://graph.facebook.com/${this.apiVersion}`;

    if (!this.pageAccessToken) {
      console.error("PAGE_ACCESS_TOKEN not found in environment variables");
    }
  }

  // Send a simple text message
  async sendTextMessage(recipientId, text, quickReplies = null) {
    const message = { text };

    if (quickReplies) {
      message.quick_replies = quickReplies.map((reply) => ({
        content_type: "text",
        title: reply.title,
        payload: reply.payload,
      }));
    }

    return await this.sendMessage(recipientId, message);
  }

  // Send a generic template (carousel)
  async sendCarousel(recipientId, elements) {
    const message = {
      attachment: {
        type: "template",
        payload: {
          template_type: "generic",
          elements: elements,
        },
      },
    };

    return await this.sendMessage(recipientId, message);
  }

  // Send a button template
  async sendButtonTemplate(recipientId, text, buttons) {
    const message = {
      attachment: {
        type: "template",
        payload: {
          template_type: "button",
          text: text,
          buttons: buttons,
        },
      },
    };

    return await this.sendMessage(recipientId, message);
  }

  // Send typing indicator
  async sendTypingOn(recipientId) {
    return await this.sendAction(recipientId, "typing_on");
  }

  async sendTypingOff(recipientId) {
    return await this.sendAction(recipientId, "typing_off");
  }

  // Mark as seen
  async markSeen(recipientId) {
    return await this.sendAction(recipientId, "mark_seen");
  }

  // Core send message method
  async sendMessage(recipientId, message) {
    try {
      const requestBody = {
        recipient: { id: recipientId },
        message: message,
        messaging_type: "RESPONSE",
      };

      console.log(
        `Sending message to ${recipientId}:`,
        JSON.stringify(message, null, 2)
      );

      const response = await axios.post(
        `${this.baseURL}/me/messages`,
        requestBody,
        {
          params: { access_token: this.pageAccessToken },
          headers: { "Content-Type": "application/json" },
        }
      );

      console.log("Message sent successfully:", response.data);
      return response.data;
    } catch (error) {
      console.error("Error sending message:", error.message);
      if (error.response) {
        console.error("Facebook API Error:", error.response.data);
        console.error("Status:", error.response.status);
      }
      throw error;
    }
  }

  // Send sender action (typing, mark_seen)
  async sendAction(recipientId, action) {
    try {
      const requestBody = {
        recipient: { id: recipientId },
        sender_action: action,
      };

      console.log(`⚡ Sending action to ${recipientId}: ${action}`);

      const response = await axios.post(
        `${this.baseURL}/me/messages`,
        requestBody,
        {
          params: { access_token: this.pageAccessToken },
          headers: { "Content-Type": "application/json" },
        }
      );

      return response.data;
    } catch (error) {
      console.error(`Error sending action ${action}:`, error.message);
      if (error.response) {
        console.error("Facebook API Error:", error.response.data);
      }
      throw error;
    }
  }

  // Get user profile info
  async getUserProfile(userId, fields = "first_name,last_name,profile_pic") {
    try {
      console.log(`Getting profile for user ${userId}`);

      const response = await axios.get(`${this.baseURL}/${userId}`, {
        params: {
          fields: fields,
          access_token: this.pageAccessToken,
        },
      });

      console.log("Profile retrieved:", response.data);
      return response.data;
    } catch (error) {
      console.error("Error getting user profile:", error.message);
      if (error.response) {
        console.error("Facebook API Error:", error.response.data);
      }
      throw error;
    }
  }

  // Get page info
  async getPageInfo(fields = "name,about,picture") {
    try {
      const response = await axios.get(`${this.baseURL}/me`, {
        params: {
          fields: fields,
          access_token: this.pageAccessToken,
        },
      });

      return response.data;
    } catch (error) {
      console.error("Error getting page info:", error.message);
      throw error;
    }
  }

  // Set persistent menu
  async setPersistentMenu(menuItems) {
    try {
      const requestBody = {
        persistent_menu: [
          {
            locale: "default",
            composer_input_disabled: false,
            call_to_actions: menuItems,
          },
        ],
      };

      const response = await axios.post(
        `${this.baseURL}/me/messenger_profile`,
        requestBody,
        {
          params: { access_token: this.pageAccessToken },
          headers: { "Content-Type": "application/json" },
        }
      );

      console.log("Persistent menu set successfully");
      return response.data;
    } catch (error) {
      console.error("Error setting persistent menu:", error.message);
      throw error;
    }
  }

  // Set get started button
  async setGetStartedButton(payload = "GET_STARTED") {
    try {
      const requestBody = {
        get_started: { payload: payload },
      };

      const response = await axios.post(
        `${this.baseURL}/me/messenger_profile`,
        requestBody,
        {
          params: { access_token: this.pageAccessToken },
          headers: { "Content-Type": "application/json" },
        }
      );

      console.log("Get Started button set successfully");
      return response.data;
    } catch (error) {
      console.error("Error setting get started button:", error.message);
      throw error;
    }
  }

  // Set greeting text
  async setGreeting(greetingText) {
    try {
      const requestBody = {
        greeting: [
          {
            locale: "default",
            text: greetingText,
          },
        ],
      };

      const response = await axios.post(
        `${this.baseURL}/me/messenger_profile`,
        requestBody,
        {
          params: { access_token: this.pageAccessToken },
          headers: { "Content-Type": "application/json" },
        }
      );

      console.log("Greeting text set successfully");
      return response.data;
    } catch (error) {
      console.error("Error setting greeting text:", error.message);
      throw error;
    }
  }

  // Helper method to create quick reply buttons
  createQuickReplies(options) {
    return options.map((option) => ({
      title: typeof option === "string" ? option : option.title,
      payload:
        typeof option === "string"
          ? option.toUpperCase().replace(" ", "_")
          : option.payload,
    }));
  }

  // Helper method to create postback buttons
  createPostbackButtons(options) {
    return options.map((option) => ({
      type: "postback",
      title: typeof option === "string" ? option : option.title,
      payload:
        typeof option === "string"
          ? option.toUpperCase().replace(" ", "_")
          : option.payload,
    }));
  }

  // Helper method to create web URL buttons
  createWebUrlButtons(options) {
    return options.map((option) => ({
      type: "web_url",
      title: option.title,
      url: option.url,
      webview_height_ratio: option.height_ratio || "tall",
    }));
  }

  // Test API connection
  async testConnection() {
    try {
      const pageInfo = await this.getPageInfo();
      console.log("Facebook API connection test successful");
      console.log("Page Info:", pageInfo);
      return { success: true, pageInfo };
    } catch (error) {
      console.error("Facebook API connection test failed:", error.message);
      return { success: false, error: error.message };
    }
  }

  // Health check
  getHealth() {
    return {
      status: "healthy",
      page_access_token_configured: !!this.pageAccessToken,
      api_version: this.apiVersion,
      base_url: this.baseURL,
    };
  }
}

module.exports = new FacebookAPI();
