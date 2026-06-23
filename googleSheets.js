const { google } = require('googleapis');
const dayjs = require('dayjs');
const timezone = require('dayjs/plugin/timezone');
const utc = require('dayjs/plugin/utc');
dayjs.extend(utc);
dayjs.extend(timezone);

const KTC_TAGS = {
  'DT': '@DatPham_2033074',
  'DX': '@DatPham_2033074',
  'HY': '@thuychu_14',
  'XA': '@PhatDao_HRBP',
  'M12': '@ThuHa_HRBP'
};

const checkKTCData = async (bot, db, ctx = null) => {
  try {
    const auth = new google.auth.GoogleAuth({
      keyFile: './google-credentials.json',
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    const sheets = google.sheets({ version: 'v4', auth });
    const sheetId = process.env.GOOGLE_SHEET_ID;
    const sheetName = process.env.GOOGLE_SHEET_NAME;

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `${sheetName}!A1:ZZ50`,
      valueRenderOption: 'FORMATTED_VALUE',
    });

    const rows = response.data.values;
    if (!rows || rows.length === 0) return;

    // Tìm cột của ngày hôm qua (N-1) vì báo cáo KTC chốt số liệu của ngày hôm trước
    const yesterday = dayjs().tz('Asia/Ho_Chi_Minh').subtract(1, 'day');
    // Sheets có thể format ngày là M/D/YYYY hoặc M/DD/YYYY
    const targetDateStr1 = yesterday.format('M/D/YYYY');
    const targetDateStr2 = yesterday.format('M/DD/YYYY');
    const targetDateStr3 = yesterday.format('MM/DD/YYYY');
    const targetDateStr4 = yesterday.format('MM/D/YYYY');
    
    // Ngày thường ở dòng 2 (index 1)
    const dateRow = rows[1]; 
    let todayColIndex = -1;
    for (let i = 0; i < dateRow.length; i++) {
      const val = (dateRow[i] || '').trim();
      if (val === targetDateStr1 || val === targetDateStr2 || val === targetDateStr3 || val === targetDateStr4) {
        todayColIndex = i;
        break;
      }
    }

    if (todayColIndex === -1) {
      console.log(`Không tìm thấy cột ngày hôm qua (${targetDateStr1}) trong Sheet`);
      return;
    }

    let missingHubs = [];
    let processedHubs = new Set();

    // Tìm các kho từ cột A
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const khoName = (row[0] || '').trim();
      
      if (KTC_TAGS[khoName] && !processedHubs.has(khoName)) {
        processedHubs.add(khoName);

        // Lấy giá trị ô Cost/kg ở cột của ngày hôm qua
        const cellValue = (row[todayColIndex] || '').trim();
        if (cellValue === '0' || cellValue === '#DIV/0!' || cellValue === '#N/A' || cellValue === '0%') {
          missingHubs.push({
            name: khoName,
            tag: KTC_TAGS[khoName]
          });
        }

        // Nếu đã quét đủ 5 kho thì dừng luôn, không quét tiếp xuống các bảng bên dưới (ví dụ bảng Monthly)
        if (processedHubs.size === Object.keys(KTC_TAGS).length) {
          break;
        }
      }
    }

    if (missingHubs.length > 0) {
      const targetAliasId = parseInt(process.env.KTC_REPORT_GROUP_ALIAS);
      const targetGroup = await db.getGroupById(targetAliasId);
      if (targetGroup) {
        let msg = `🚨 COST/WEIGHT KTC 🚨\n\n`;
        msg += `Hiện tại Bót phát hiện các Kho sau chưa điền/chưa có số liệu Cost/kg ngày hôm qua (${targetDateStr1}):\n\n`;
        
        missingHubs.forEach(hub => {
          msg += `Kho ${hub.name}: ${hub.tag}\n`;
        });
        
        msg += `\nCác anh/chị Quản lý kiểm tra và update số liệu giúp Bót nha!`;
        bot.telegram.sendMessage(targetGroup.chat_id, msg).catch(console.error);
        if (ctx) ctx.reply('✅ Đã check xong! Phát hiện có kho chưa điền và Bót đã bắn thông báo vào Nhóm báo cáo rồi nha!');
      } else {
        if (ctx) ctx.reply('❌ Lỗi: Không tìm thấy Nhóm báo cáo KTC. Sếp kiểm tra lại Mã nhóm trong cấu hình nhé!');
      }
    } else {
      if (ctx) ctx.reply(`✅ Đã check xong! Quá đỉnh, tất cả các kho đều đã có số liệu Cost/kg của ngày hôm qua (${targetDateStr1})!`);
    }

  } catch (error) {
    console.error('Lỗi checkKTCData:', error);
    if (ctx) {
      ctx.reply(`❌ Á á, Bót bị vấp té lúc chui vào Google Sheets rùi Sếp ơi!\nLỗi: ${error.message}\n(Sếp kiểm tra lại file Service Account xem có copy thiếu chữ nào không nha)`);
    }
  }
};

module.exports = { checkKTCData };
