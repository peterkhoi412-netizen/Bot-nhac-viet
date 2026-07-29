const { GoogleGenerativeAI } = require("@google/generative-ai");
const { checkKTCData } = require('./googleSheets');

const askAI = async (question, contextData, bot, db, ctx) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return "Em chưa được nạp não AI (Sếp quên gắn GEMINI_API_KEY rồi ạ) nên em chưa biết suy nghĩ đâu Sếp ơi!";
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);

    const tools = [
      {
        functionDeclarations: [
          {
            name: "getKTCReport",
            description: "Lấy báo cáo Cost/Weight KTC của ngày hôm qua, bao gồm các kho chưa điền, lệch bất thường (>50%), và lịch sử lỗi (>80%). Gọi hàm này khi người dùng hỏi về tình hình báo cáo, kho nào chưa điền, kho nào bị lệch.",
            parameters: {
              type: "OBJECT",
              properties: {},
            },
          },
          {
            name: "getManagerTags",
            description: "Lấy danh sách các thẻ Tag Telegram của Quản lý các kho hiện tại.",
            parameters: {
              type: "OBJECT",
              properties: {},
            },
          },
          {
            name: "setManagerTag",
            description: "Cập nhật thẻ Tag Telegram cho Quản lý của một kho cụ thể.",
            parameters: {
              type: "OBJECT",
              properties: {
                khoName: {
                  type: "STRING",
                  description: "Mã kho (ví dụ: DT, DX, HY, XA, M12)"
                },
                tag: {
                  type: "STRING",
                  description: "Thẻ tag Telegram (ví dụ: @DatPham_2033074)"
                }
              },
              required: ["khoName", "tag"]
            },
          }
        ]
      }
    ];

    const systemInstruction = `
Bạn là "Bé Bót", trợ lý ảo cá nhân dễ thương, ngoan ngoãn, và rất trung thành của Sếp Khuii.
Tính cách: Lễ phép, nhanh nhẹn, hay dùng icon dễ thương, xưng hô là "em" / "Bót", gọi người trò chuyện là "Sếp" hoặc "anh/chị".
Tuyệt đối không dùng những từ ngữ khô khan như một cái máy. Luôn trả lời ngắn gọn, súc tích.

Bạn là một AI Agent có khả năng sử dụng công cụ (Tools). Hãy TỰ ĐỘNG gọi các công cụ được cung cấp để tra cứu dữ liệu thực tế trước khi trả lời người dùng.
- Nếu người dùng hỏi về báo cáo Cost/kg, KTC, kho nào chưa điền, hãy gọi công cụ getKTCReport.
- Nếu người dùng hỏi ai đang quản lý kho nào, hãy gọi công cụ getManagerTags.
- Nếu người dùng yêu cầu đổi quản lý kho, hãy gọi công cụ setManagerTag.

Dưới đây là một số thông tin nền tảng về hệ thống:
--- BẮT ĐẦU DỮ LIỆU NỀN ---
${contextData}
--- KẾT THÚC DỮ LIỆU NỀN ---
    `;

    const model = genAI.getGenerativeModel({ 
      model: "gemini-flash-latest",
      tools: tools,
      systemInstruction: systemInstruction
    });

    const chat = model.startChat({});

    let result = await chat.sendMessage(question);
    let response = result.response;
    
    // Vòng lặp xử lý Function Calling
    while (true) {
      let calls;
      if (typeof response.functionCalls === 'function') {
        calls = response.functionCalls();
      } else {
        calls = response.functionCalls;
      }
      
      if (!calls || calls.length === 0) break;

      const functionResponses = [];

      for (const call of calls) {
        let apiResponse = null;
        console.log(`[AI Agent] Đang gọi hàm: ${call.name}`, call.args);

        if (call.name === "getKTCReport") {
          // Gọi hàm checkKTCData có sẵn với isForAI = true
          apiResponse = await checkKTCData(bot, db, null, true);
        } 
        else if (call.name === "getManagerTags") {
          const defaultTags = {
            'DT': '@DatPham_2033074',
            'DX': '@DatPham_2033074',
            'HY': '@thuychu_14',
            'XA': '@PhatDao_HRBP',
            'M12': '@ThuHa_HRBP'
          };
          let ktcTags = await db.getSetting('ktc_tags');
          if (!ktcTags || typeof ktcTags !== 'object') ktcTags = {};
          apiResponse = { tags: { ...defaultTags, ...ktcTags } };
        }
        else if (call.name === "setManagerTag") {
          const defaultTags = {
            'DT': '@DatPham_2033074',
            'DX': '@DatPham_2033074',
            'HY': '@thuychu_14',
            'XA': '@PhatDao_HRBP',
            'M12': '@ThuHa_HRBP'
          };
          let ktcTags = await db.getSetting('ktc_tags');
          if (!ktcTags || typeof ktcTags !== 'object') ktcTags = { ...defaultTags };
          else ktcTags = { ...defaultTags, ...ktcTags };
          
          const kho = (call.args.khoName || '').toUpperCase();
          if (ktcTags.hasOwnProperty(kho)) {
            ktcTags[kho] = call.args.tag;
            await db.setSetting('ktc_tags', ktcTags);
            apiResponse = { status: "Thành công", message: `Đã cập nhật quản lý kho ${kho} thành ${call.args.tag}` };
          } else {
            apiResponse = { status: "Thất bại", message: `Không tìm thấy mã kho: ${kho}` };
          }
        }

        functionResponses.push({
          functionResponse: {
            name: call.name,
            response: apiResponse || { error: "Không có dữ liệu trả về" }
          }
        });
      }

      // Gửi kết quả của hàm trả lại cho Gemini
      result = await chat.sendMessage(functionResponses);
      response = result.response;
    }

    return response.text();
  } catch (error) {
    console.error("Lỗi Gemini AI Agent:", error);
    return `Dạ não AI của em đang bị kẹt xíu do lỗi: ${error.message}`;
  }
};

module.exports = { askAI };
