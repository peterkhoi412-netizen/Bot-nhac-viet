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

const checkKTCData = async (bot, db) => {
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

    // Tìm cột của ngày hôm nay
    const now = dayjs().tz('Asia/Ho_Chi_Minh');
    // Sheets có thể format ngày là M/D/YYYY hoặc M/DD/YYYY
    const todayStr1 = now.format('M/D/YYYY');
    const todayStr2 = now.format('M/DD/YYYY');
    const todayStr3 = now.format('MM/DD/YYYY');
    const todayStr4 = now.format('MM/D/YYYY');
    
    // Ngày thường ở dòng 2 (index 1)
    const dateRow = rows[1]; 
    let todayColIndex = -1;
    for (let i = 0; i < dateRow.length; i++) {
      const val = (dateRow[i] || '').trim();
      if (val === todayStr1 || val === todayStr2 || val === todayStr3 || val === todayStr4) {
        todayColIndex = i;
        break;
      }
    }

    if (todayColIndex === -1) {
      console.log(`Không tìm thấy cột ngày hôm nay (${todayStr1}) trong Sheet`);
      return;
    }

    let missingHubs = [];

    // Tìm các kho từ cột A
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const khoName = (row[0] || '').trim();
      
      if (KTC_TAGS[khoName]) {
        // Lấy giá trị ô Cost/kg ở cột của ngày hôm nay
        const cellValue = (row[todayColIndex] || '').trim();
        if (!cellValue || cellValue === '#DIV/0!' || cellValue === '#N/A' || cellValue === '0%') {
          missingHubs.push({
            name: khoName,
            tag: KTC_TAGS[khoName]
          });
        }
      }
    }

    if (missingHubs.length > 0) {
      const targetAliasId = parseInt(process.env.KTC_REPORT_GROUP_ALIAS);
      const targetGroup = await db.getGroupById(targetAliasId);
      if (targetGroup) {
        let msg = `🚨 <b>BÁO ĐỘNG KTC 11h30</b> 🚨\n\n`;
        msg += `Hiện tại Bót phát hiện các Kho sau chưa điền/chưa có số liệu Cost/kg ngày hôm nay (${todayStr1}):\n\n`;
        
        missingHubs.forEach(hub => {
          msg += `- Kho <b>${hub.name}</b>: ${hub.tag}\n`;
        });
        
        msg += `\nCác anh/chị Quản lý kiểm tra và update số liệu giúp Bót nha!`;
        bot.telegram.sendMessage(targetGroup.chat_id, msg, { parse_mode: 'HTML' }).catch(console.error);
      }
    }

  } catch (error) {
    console.error('Lỗi checkKTCData:', error);
  }
};

module.exports = { checkKTCData };
