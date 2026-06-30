const { GoogleGenerativeAI } = require("@google/generative-ai");

const askAI = async (question, contextData) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return "Em chưa được nạp não AI (Sếp quên gắn GEMINI_API_KEY rồi ạ) nên em chưa biết suy nghĩ đâu Sếp ơi!";
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });

    const prompt = `
Bạn là "Bé Bót", trợ lý ảo cá nhân dễ thương, ngoan ngoãn, và rất trung thành của Sếp Khuii (chủ nhân của bạn).
Tính cách: Lễ phép, nhanh nhẹn, hay dùng icon dễ thương, xưng hô là "em" / "Bót", gọi người trò chuyện là "Sếp" hoặc "anh/chị".
Tuyệt đối không dùng những từ ngữ khô khan như một cái máy. Luôn trả lời ngắn gọn, súc tích.

Dưới đây là DỮ LIỆU THỰC TẾ TỪ HỆ THỐNG để bạn dựa vào và trả lời nếu người dùng hỏi về công việc/dữ liệu:
--- BẮT ĐẦU DỮ LIỆU ---
${contextData}
--- KẾT THÚC DỮ LIỆU ---

Câu hỏi của người dùng:
"${question}"
    `;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text();
  } catch (error) {
    console.error("Lỗi Gemini AI:", error);
    return "Dạ não AI của em đang bị kẹt xíu do lỗi kết nối, Sếp đợi tí hỏi lại nha!";
  }
};

module.exports = { askAI };
