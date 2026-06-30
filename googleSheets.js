const { google } = require('googleapis');
const dayjs = require('dayjs');
const timezone = require('dayjs/plugin/timezone');
const utc = require('dayjs/plugin/utc');
dayjs.extend(utc);
dayjs.extend(timezone);

const checkKTCData = async (bot, db, ctx = null) => {
  try {
    let ktcTags = await db.getSetting('ktc_tags');
    if (!ktcTags) {
      ktcTags = {
        'DT': '@DatPham_2033074',
        'DX': '@DatPham_2033074',
        'HY': '@thuychu_14',
        'XA': '@PhatDao_HRBP',
        'M12': '@ThuHa_HRBP'
      };
    }

    let authOptions = {
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    };

    if (process.env.GOOGLE_CREDENTIALS_BASE64) {
      authOptions.credentials = JSON.parse(Buffer.from(process.env.GOOGLE_CREDENTIALS_BASE64, 'base64').toString('utf8'));
    } else {
      authOptions.keyFile = './google-credentials.json';
    }

    const auth = new google.auth.GoogleAuth(authOptions);

    const sheets = google.sheets({ version: 'v4', auth });
    const sheetId = (process.env.GOOGLE_SHEET_ID || '').trim();
    const sheetName = (process.env.GOOGLE_SHEET_NAME || '').trim();

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
    let anomalyHubs = [];
    let processedHubs = new Set();

    // Tìm các kho từ cột A
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const khoName = (row[0] || '').trim();
      
      if (ktcTags[khoName] && !processedHubs.has(khoName)) {
        processedHubs.add(khoName);

        // Lấy giá trị ô Cost/kg ở cột của ngày hôm qua (N-1) và ngày hôm trước nữa (N-2)
        const cellValue = (row[todayColIndex] || '').toString().trim();
        const prevValue = todayColIndex > 0 ? (row[todayColIndex - 1] || '').toString().trim() : '';
        
        // Lấy giá trị ô "So với mục tiêu" (nằm ngay dòng bên dưới dòng Cost/kg)
        const nextRow = rows[i + 1] || [];
        const nextCellValue = (nextRow[todayColIndex] || '').toString().trim();

        const errorValues = ['0', '#DIV/0!', '#N/A', '0%'];
        
        if (errorValues.includes(cellValue) || errorValues.includes(nextCellValue)) {
          missingHubs.push({
            name: khoName,
            tag: ktcTags[khoName]
          });
        } else if (cellValue !== '') {
          // Parse string to float, removing commas if any (e.g. "1,234.5")
          const currentNum = parseFloat(cellValue.replace(/,/g, ''));
          const prevNum = parseFloat(prevValue.replace(/,/g, ''));

          if (!isNaN(currentNum) && !isNaN(prevNum)) {
            let diffPercent = 0;
            if (prevNum === 0) {
              if (currentNum !== 0) diffPercent = 100; // Đi từ 0 lên số khác -> tính là lệch 100%
            } else {
              diffPercent = Math.abs((currentNum - prevNum) / prevNum) * 100;
            }

            if (diffPercent > 50) {
              anomalyHubs.push({
                name: khoName,
                tag: ktcTags[khoName],
                current: cellValue,
                prev: prevValue
              });
            }
          }
        }

        // Nếu đã quét đủ 5 kho thì dừng luôn, không quét tiếp xuống các bảng bên dưới (ví dụ bảng Monthly)
        if (processedHubs.size === Object.keys(ktcTags).length) {
          break;
        }
      }
    }

    if (missingHubs.length > 0 || anomalyHubs.length > 0) {
      let targetAliasId = await db.getSetting('ktc_target_group_alias');
      if (!targetAliasId) targetAliasId = parseInt(process.env.KTC_REPORT_GROUP_ALIAS);
      
      const targetGroup = await db.getGroupById(targetAliasId);
      if (targetGroup) {
        let msg = `🚨 COST/WEIGHT KTC 🚨\n\nHiện tại Bót phát hiện các vấn đề sau về số liệu Cost/kg ngày hôm qua (${targetDateStr1}):\n`;
        
        if (missingHubs.length > 0) {
          msg += `\n❌ CHƯA ĐIỀN\n`;
          missingHubs.forEach(hub => {
            msg += `Kho ${hub.name}: ${hub.tag}\n`;
          });
        }

        if (anomalyHubs.length > 0) {
          msg += `\n⚠️ CHÊNH LỆCH BẤT THƯỜNG (>50% so với ngày N-2):\n`;
          anomalyHubs.forEach(hub => {
            msg += `Kho ${hub.name}: ${hub.tag} (Hôm trước: ${hub.prev} ➔ Hôm qua: ${hub.current})\n`;
          });
        }
        
        const sheetUrl = `https://docs.google.com/spreadsheets/d/${process.env.GOOGLE_SHEET_ID}/edit`;
        msg += `\nCác anh/chị Quản lý kiểm tra và update số liệu giúp Bót nha!`;
        
        bot.telegram.sendMessage(targetGroup.chat_id, msg, {
          reply_markup: {
            inline_keyboard: [
              [
                { text: '📊 Mở File KTC - Daily', url: sheetUrl }
              ]
            ]
          }
        }).catch(console.error);
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
