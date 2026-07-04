const gptService = require("../services/gptService");
const facebookAPI = require("../services/facebookAPI");
const { encodeUkuranForPayload } = require("../utils/banSizeParser");
const { addressName } = require("../utils/helpers");

async function showMotorRecommendations(senderId, session) {
  const motorType = session.motorType;
  const position = session.motorPosition;

  try {
    await facebookAPI.sendTypingOn(senderId);

    const result = await gptService.getBanRecommendationsForMotor(
      motorType,
      position,
    );

    const standardSize = result?.standard?.size || null;
    if (!standardSize) {
      throw new Error("No standard motor recommendation returned");
    }

    session.recommendedStandardSize = standardSize;

    const addr = addressName(session);
    const text = `🏍️ Rekomendasi ban ${position} untuk ${motorType}:\n\nUkuran standar: ${standardSize}\n\nApakah ini ukuran yang ${addr} mau atau ${addr} ada ukuran lain?`;
    const quickReplies = [
      {
        content_type: "text",
        title: `📏 ${standardSize}`,
        payload: `MOTOR_CHOOSE_${encodeUkuranForPayload(standardSize)}`,
      },
      {
        content_type: "text",
        title: "Ada ukuran lain",
        payload: "OTHER_SIZE",
      },
    ];

    session.state = "showing_motor_recommendations";
    await facebookAPI.sendTextMessage(senderId, text, quickReplies);
  } catch (error) {
    console.error("Error in showMotorRecommendations:", error);
    session.state = null;
    session.motorType = null;
    session.motorPosition = null;
    await facebookAPI.sendTextMessage(
      senderId,
      `Maaf, ada error saat mengecek rekomendasi 😔\n\nBisa ketik ukuran ban langsung? Contoh: 80/90-14`,
    );
  }
}

module.exports = { showMotorRecommendations };
