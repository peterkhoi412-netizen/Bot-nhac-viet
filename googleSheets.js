const { google } = require('googleapis');
const dayjs = require('dayjs');
const timezone = require('dayjs/plugin/timezone');
const utc = require('dayjs/plugin/utc');
dayjs.extend(utc);
dayjs.extend(timezone);

const checkKTCData = async (bot, db, ctx = null, isForAI = false, requestedDateStr = null) => {
  try {
    const defaultTags = {
      'DT': '@DatPham_2033074',
      'DX': '@DatPham_2033074',
      'HY': '@thuychu_14',
      'XA': '@PhatDao_HRBP',
      'M12': '@ThuHa_HRBP'
    };

    let ktcTags = await db.getSetting('ktc_tags');
    if (!ktcTags || typeof ktcTags !== 'object') {
      ktcTags = { ...defaultTags };
    } else {
      ktcTags = { ...defaultTags, ...ktcTags };
    }

    let rows = [];

    // Ưu tiên đọc dữ liệu KTC được cache trong MongoDB (do Sheet tự push sang)
    try {
      const cachedData = await db.getSetting('cached_ktc_values');
      if (cachedData && Array.isArray(cachedData) && cachedData.length > 0) {
        rows = cachedData;
        console.log('📖 Đã đọc dữ liệu KTC thành công từ MongoDB Cache!');
      }
    } catch (cacheErr) {
      console.warn('Cảnh báo: Không thể đọc cache KTC từ DB, thử dùng Web App / Service Account...', cacheErr.message);
    }

    // Nếu không có cache, thử đọc bằng Web App (GOOGLE_SCRIPT_URL) hoặc Service Account (Dự phòng)
    if (rows.length === 0) {
      if (process.env.GOOGLE_SCRIPT_URL) {
        console.log('Fetching sheet data via Google Apps Script Web App...');
        const scriptUrl = `${process.env.GOOGLE_SCRIPT_URL.trim()}?token=Minkhuii_Secure_Token_123`;
        const res = await fetch(scriptUrl);
        if (!res.ok) throw new Error(`HTTP error! Status: ${res.status}`);
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        rows = data.values;
      } else {
        const fs = require('fs');
        let authOptions = {
          scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
        };

        if (fs.existsSync('./google-credentials.json')) {
          authOptions.keyFile = './google-credentials.json';
        } else if (process.env.GOOGLE_CREDENTIALS_BASE64) {
          const creds = JSON.parse(Buffer.from(process.env.GOOGLE_CREDENTIALS_BASE64, 'base64').toString('utf8'));
          if (creds.private_key) {
            creds.private_key = creds.private_key.replace(/\\n/g, '\n');
          }
          authOptions.credentials = creds;
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
        rows = response.data.values;
      }
    }

    if (!rows || rows.length === 0) return;

    // Tìm cột của ngày tra cứu (mặc định là hôm qua)
    let targetDay = dayjs().tz('Asia/Ho_Chi_Minh').subtract(1, 'day');
    if (requestedDateStr) {
      // Ví dụ requestedDateStr = "2026-07-28"
      const parsed = dayjs(requestedDateStr).tz('Asia/Ho_Chi_Minh');
      if (parsed.isValid()) {
        targetDay = parsed;
      }
    }

    // Sheets có thể format ngày là M/D/YYYY hoặc M/DD/YYYY
    const targetDateStr1 = targetDay.format('M/D/YYYY');
    const targetDateStr2 = targetDay.format('M/DD/YYYY');
    const targetDateStr3 = targetDay.format('MM/DD/YYYY');
    const targetDateStr4 = targetDay.format('MM/D/YYYY');
    const targetDateStr5 = targetDay.format('D/M/YYYY');
    const targetDateStr6 = targetDay.format('DD/M/YYYY');
    const targetDateStr7 = targetDay.format('DD/MM/YYYY');
    const targetDateStr8 = targetDay.format('D/MM/YYYY');
    const displayTargetDate = targetDay.format('DD/MM/YYYY');
    
    // Ngày thường ở dòng 2 (index 1)
    const dateRow = rows[1]; 
    let todayColIndex = -1;
    let foundDateStr = "";
    // Search from right to left to avoid matching older dates (e.g. March 8 vs August 3)
    for (let i = dateRow.length - 1; i >= 0; i--) {
      const val = (dateRow[i] || '').trim();
      if ([targetDateStr1, targetDateStr2, targetDateStr3, targetDateStr4, targetDateStr5, targetDateStr6, targetDateStr7, targetDateStr8].includes(val)) {
        todayColIndex = i;
        foundDateStr = val;
        break;
      }
    }

    if (todayColIndex === -1) {
      console.log(`Không tìm thấy cột ngày (${displayTargetDate}) trong Sheet`);
      if (isForAI) {
        return { error: `Không tìm thấy dữ liệu của ngày ${displayTargetDate} trong hệ thống báo cáo KTC. Sếp kiểm tra lại ngày nha.` };
      }
      return;
    }

    const prevDateStr = todayColIndex > 0 ? (dateRow[todayColIndex - 1] || '').trim() : '';


    let missingHubs = [];
    let anomalyHubs = [];
    let historicalAnomalyHubs = {};
    let history30Days = {}; // Lưu trữ toàn bộ dữ liệu thô của 30 ngày qua
    let processedHubs = new Set();
    let allHubsData = []; // Mảng chứa toàn bộ dữ liệu thô của tất cả các kho

    // Tìm các kho từ cột A
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const khoName = (row[0] || '').trim();
      
      if (ktcTags.hasOwnProperty(khoName) && !processedHubs.has(khoName)) {
        processedHubs.add(khoName);

        // Lấy giá trị ô Cost/kg ở cột của ngày hôm qua (N-1) và ngày hôm trước nữa (N-2)
        const cellValue = (row[todayColIndex] || '').toString().trim();
        const prevValue = todayColIndex > 0 ? (row[todayColIndex - 1] || '').toString().trim() : '';
        
        // Lấy giá trị ô "So với mục tiêu" (nằm ngay dòng bên dưới dòng Cost/kg)
        const nextRow = rows[i + 1] || [];
        const nextCellValue = (nextRow[todayColIndex] || '').toString().trim();

        const errorValues = ['0', '#DIV/0!', '#N/A', '0%', '-', '—'];
        
        if (cellValue === '' || nextCellValue === '' || errorValues.includes(cellValue) || errorValues.includes(nextCellValue)) {
          missingHubs.push({
            name: khoName,
            tag: ktcTags[khoName]
          });
        } else {
          // Parse string to float aggressively
          const cleanCurrent = cellValue.replace(/[^0-9.-]+/g, "");
          const cleanPrev = prevValue.replace(/[^0-9.-]+/g, "");
          const currentNum = parseFloat(cleanCurrent);
          const prevNum = parseFloat(cleanPrev);

          if (!isNaN(currentNum) && !isNaN(prevNum)) {
            let diffPercent = 0;
            if (prevNum === 0 && currentNum === 0) {
              diffPercent = 0;
            } else if (prevNum === 0 || currentNum === 0) {
              diffPercent = 100;
            } else {
              // Sếp muốn tính độ lệch theo tỷ lệ Số lớn / Số bé
              diffPercent = (Math.max(currentNum, prevNum) / Math.min(currentNum, prevNum) - 1) * 100;
            }
            
            // Lưu dữ liệu thô vào mảng allHubsData
            allHubsData.push({
              name: khoName,
              tag: ktcTags[khoName],
              cost_hom_nay: currentNum,
              cost_hom_qua: prevNum,
              diff_percent: Math.round(diffPercent)
            });

            if (diffPercent >= 50) {
              anomalyHubs.push({
                name: khoName,
                tag: ktcTags[khoName],
                current: cellValue,
                prev: prevValue
              });
            }
          }
        }

        // --- GOM DỮ LIỆU THÔ 30 NGÀY CHO AI ---
        if (!history30Days[khoName]) {
          history30Days[khoName] = [];
        }
        for (let col = todayColIndex; col >= Math.max(1, todayColIndex - 30); col--) {
          const valStr = (row[col] || '').toString().trim();
          let dateStr = (rows[1][col] || '').toString().trim();
          if (dateStr && valStr !== '') {
             const cleanVal = valStr.replace(/[^0-9.-]+/g, "");
             const valNum = parseFloat(cleanVal);
             if (!isNaN(valNum)) {
                history30Days[khoName].push({ date: dateStr, cost: valNum });
             }
          }
        }

        // Quét lịch sử 30 ngày (từ N-2 lùi về N-31) để tìm lỗi >80%
        const startCol = Math.max(1, todayColIndex - 30);
        for (let col = todayColIndex - 1; col >= startCol; col--) {
          const histCellVal = (row[col] || '').toString().trim();
          const histPrevVal = (row[col - 1] || '').toString().trim();
          
          if (histCellVal !== '' && histPrevVal !== '') {
            const cleanHistCurr = histCellVal.replace(/[^0-9.-]+/g, "");
            const cleanHistPrev = histPrevVal.replace(/[^0-9.-]+/g, "");
            const histCurrNum = parseFloat(cleanHistCurr);
            const histPrevNum = parseFloat(cleanHistPrev);

            if (!isNaN(histCurrNum) && !isNaN(histPrevNum)) {
              let diffPercent = 0;
              if (histPrevNum === 0 && histCurrNum === 0) {
                diffPercent = 0;
              } else if (histPrevNum === 0 || histCurrNum === 0) {
                diffPercent = 100;
              } else {
                diffPercent = (Math.max(histCurrNum, histPrevNum) / Math.min(histCurrNum, histPrevNum) - 1) * 100;
              }

              if (diffPercent > 80) {
                if (!historicalAnomalyHubs[khoName]) {
                  historicalAnomalyHubs[khoName] = {
                    tag: ktcTags[khoName],
                    anomalies: []
                  };
                }
                
                // Format ngày (từ rows[1])
                let dateStr = (rows[1][col] || '').toString().trim();
                const dateParts = dateStr.split('/');
                if (dateParts.length >= 2) {
                  dateStr = `${dateParts[1].padStart(2, '0')}/${dateParts[0]}`; // MM/DD -> DD/MM
                }
                
                historicalAnomalyHubs[khoName].anomalies.push({
                  date: dateStr,
                  current: histCellVal,
                  prev: histPrevVal
                });
              }
            }
          }
        }

        // Nếu đã quét đủ 5 kho thì dừng luôn, không quét tiếp xuống các bảng bên dưới (ví dụ bảng Monthly)
        if (processedHubs.size === Object.keys(ktcTags).length) {
          break;
        }
      }
    }

    if (isForAI) {
      return {
        target_date: displayTargetDate,
        actual_date_in_sheet: foundDateStr || targetDateStr1,
        prev_date_in_sheet: prevDateStr,
        all_hubs_data: allHubsData,
        missing_hubs: missingHubs,
        anomaly_hubs: anomalyHubs,
        historical_anomalies: historicalAnomalyHubs,
        history_30_days: history30Days
      };
    }

    if (missingHubs.length > 0 || anomalyHubs.length > 0 || Object.keys(historicalAnomalyHubs).length > 0) {
      let targetAliasId = await db.getSetting('ktc_target_group_alias');
      if (!targetAliasId) targetAliasId = parseInt(process.env.KTC_REPORT_GROUP_ALIAS);
      
      const targetGroup = await db.getGroupById(targetAliasId);
      if (targetGroup) {
        let msg = `🚨 COST/WEIGHT KTC 🚨\n\nHiện tại Bót phát hiện các vấn đề sau về số liệu Cost/kg ngày hôm qua (${displayTargetDate}):\n`;
        
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

        if (Object.keys(historicalAnomalyHubs).length > 0) {
          msg += `\n🕰 LỊCH SỬ LỖI CHÊNH LỆCH (trong 30 ngày qua):\n`;
          for (const kho of Object.keys(historicalAnomalyHubs)) {
            const data = historicalAnomalyHubs[kho];
            msg += `Kho ${kho}: ${data.tag}\n`;
            const reversedAnomalies = [...data.anomalies].reverse();
            reversedAnomalies.forEach(a => {
              msg += ` - Ngày ${a.date} (Hôm trước: ${a.prev} ➔ Hôm đó: ${a.current})\n`;
            });
          }
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
      if (ctx) ctx.reply(`✅ Đã check xong! Quá đỉnh, tất cả các kho đều đã có số liệu Cost/kg của ngày hôm qua (${displayTargetDate})!`);
    }

  } catch (error) {
    console.error('Lỗi checkKTCData:', error);
    if (ctx) {
      ctx.reply(`❌ Á á, Bót bị vấp té lúc chui vào Google Sheets rùi Sếp ơi!\nLỗi: ${error.message}\n(Sếp kiểm tra lại file Service Account xem có copy thiếu chữ nào không nha)`);
    }
  }
};

module.exports = { checkKTCData };
