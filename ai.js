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
          },
          {
            name: "addTask",
            description: "Thêm một công việc hoặc lịch nhắc nhở mới cho người dùng hiện tại (chỉ áp dụng cho user chat hiện tại). Gọi hàm này khi người dùng nhờ ghi nhớ, lên lịch, hoặc nhắc việc.",
            parameters: {
              type: "OBJECT",
              properties: {
                task: {
                  type: "STRING",
                  description: "Nội dung công việc cần nhắc (ví dụ: 'Đi lên tầng 3', 'Họp với sếp')"
                },
                reminderTime: {
                  type: "STRING",
                  description: "Thời gian nhắc nhở theo định dạng 24h HH:mm (ví dụ: '11:00', '15:30'). Nếu không có giờ cụ thể, hãy để chuỗi rỗng ''."
                }
              },
              required: ["task", "reminderTime"]
            }
          },
          {
            name: "getPendingTasks",
            description: "Lấy danh sách các công việc chưa hoàn thành (tồn đọng) của người dùng hiện tại.",
            parameters: {
              type: "OBJECT",
              properties: {},
            }
          },
          {
            name: "saveFact",
            description: "Lưu trữ một thông tin, sở thích, hoặc ghi nhớ quan trọng vào Sổ Tay Thư Ký (Database). Gọi hàm này khi người dùng dặn dò bạn nhớ một điều gì đó.",
            parameters: {
              type: "OBJECT",
              properties: {
                fact: {
                  type: "STRING",
                  description: "Nội dung cần ghi nhớ (ví dụ: 'Công thức tính Cost đã đổi sang chia cho 100', 'Sếp thích uống cafe sữa')"
                }
              },
              required: ["fact"]
            }
          },
          {
            name: "getMemories",
            description: "Lấy danh sách các ghi nhớ, sổ tay, thông tin quan trọng đã lưu trước đó của người dùng/nhóm hiện tại.",
            parameters: {
              type: "OBJECT",
              properties: {},
            }
          }
        ]
      }
    ];

    const systemInstruction = `
Bạn là "Bé Bót", một Siêu Thư Ký AI kiêm Data Analyst cao cấp, cực kỳ thông minh, sắc sảo và trung thành của Sếp Khuii.
Tính cách: Chuyên nghiệp, nhạy bén với các con số, nhưng vẫn giữ nét dễ thương, xưng hô là "em" / "Bót", gọi người trò chuyện là "Sếp" hoặc "anh/chị". 

TRÁCH NHIỆM CHÍNH (QUAN TRỌNG):
1. PHÂN TÍCH DỮ LIỆU: Khi người dùng gửi báo cáo hoặc bạn tra cứu được số liệu KTC, TUYỆT ĐỐI KHÔNG CHỈ ĐỌC LẠI CON SỐ. Bạn phải đóng vai trò Analyst:
- Nhận xét xu hướng (tăng/giảm).
- Chỉ ra các điểm bất thường (ví dụ: kho nào lệch quá cao).
- Đưa ra lời khuyên hoặc cảnh báo (ví dụ: "Sếp nên nhắc nhở kho X vì lệch quá 50%").
- Dùng tư duy phản biện để đánh giá số liệu.

2. TRỢ LÝ TOÀN NĂNG: Hãy sử dụng công cụ (Tools) một cách chủ động:
- Lấy báo cáo KTC: gọi getKTCReport.
- Xem/Đổi quản lý kho: gọi getManagerTags / setManagerTag.
- Lên lịch, nhắc việc: gọi addTask.
- Xem việc tồn đọng: gọi getPendingTasks.
- Ghi nhớ thông tin quan trọng Sếp dặn: gọi saveFact.
- Tra cứu lại sổ tay ghi nhớ: gọi getMemories.

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

    let contents = [
      { role: "user", parts: [{ text: question }] }
    ];

    let result = await model.generateContent({ contents });
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
        else if (call.name === "addTask") {
          const chatId = ctx.chat.id.toString();
          const taskText = call.args.task;
          let reminderTime = call.args.reminderTime;
          if (!reminderTime || reminderTime.trim() === '') reminderTime = null;
          
          await db.addTask(chatId, taskText, reminderTime, []);
          apiResponse = { status: "Thành công", message: `Đã lưu nhắc nhở '${taskText}' vào Database. Giờ nhắc: ${reminderTime || 'Không có'}` };
        }
        else if (call.name === "getPendingTasks") {
          const chatId = ctx.chat.id.toString();
          const tasks = await db.getPendingTasks(chatId);
          apiResponse = { tasks: tasks.map(t => ({ id: t._id, task: t.task, reminderTime: t.reminder_time })) };
        }
        else if (call.name === "saveFact") {
          const chatId = ctx.chat.id.toString();
          const fact = call.args.fact;
          await db.saveMemory(chatId, fact);
          apiResponse = { status: "Thành công", message: `Đã ghi vào sổ tay: "${fact}"` };
        }
        else if (call.name === "getMemories") {
          const chatId = ctx.chat.id.toString();
          const memories = await db.getMemories(chatId);
          apiResponse = { memories: memories };
        }

        functionResponses.push({
          functionResponse: {
            name: call.name,
            response: apiResponse || { error: "Không có dữ liệu trả về" }
          }
        });
      }

      // Lưu nguyên bản phản hồi của model vào history (để giữ lại thought_signature và text của model)
      contents.push(response.candidates[0].content);

      // Lưu functionResponse của user vào history
      contents.push({
        role: "user", // Bắt buộc dùng role user thay vì function để tránh lỗi 400
        parts: functionResponses
      });

      // Gửi lại lịch sử mới cho model
      result = await model.generateContent({ contents });
      response = result.response;
    }

    return response.text();
  } catch (error) {
    console.error("Lỗi AI:", error);
    if (error.message && (error.message.includes('429') || error.message.includes('quota') || error.message.includes('Too Many Requests'))) {
      return `⏳ Dạ Google bắt em nghỉ mệt 1 phút Sếp ơi (do mình xài gói API miễn phí nên bị giới hạn số câu hỏi mỗi phút ạ). Sếp đợi em uống miếng nước tầm 1 phút sau Sếp nhắn lại là em làm được liền nha! 💦`;
    }
    return `Dạ não AI của em đang bị kẹt xíu do lỗi: ${error.message}`;
  }
};

module.exports = { askAI };
