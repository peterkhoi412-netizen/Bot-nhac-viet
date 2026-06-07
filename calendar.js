const { google } = require('googleapis');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
dayjs.extend(utc);
dayjs.extend(timezone);

let auth;
let calendarAPI;

const initCalendar = () => {
  if (calendarAPI) return calendarAPI;

  const credentialsBase64 = process.env.GOOGLE_CREDENTIALS_BASE64;
  if (!credentialsBase64) {
    console.error('Chưa cấu hình GOOGLE_CREDENTIALS_BASE64');
    return null;
  }

  try {
    const credentialsJson = Buffer.from(credentialsBase64, 'base64').toString('utf8');
    const credentials = JSON.parse(credentialsJson);

    auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/calendar.readonly']
    });

    calendarAPI = google.calendar({ version: 'v3', auth });
    return calendarAPI;
  } catch (error) {
    console.error('Lỗi khi khởi tạo Google Calendar API:', error);
    return null;
  }
};

const getTodaysEvents = async () => {
  const cal = initCalendar();
  if (!cal) return [];
  
  const calendarId = process.env.CALENDAR_ID;
  if (!calendarId) {
    console.error('Chưa cấu hình CALENDAR_ID');
    return [];
  }

  const todayStart = dayjs().tz('Asia/Ho_Chi_Minh').startOf('day').toISOString();
  const todayEnd = dayjs().tz('Asia/Ho_Chi_Minh').endOf('day').toISOString();

  try {
    const res = await cal.events.list({
      calendarId,
      timeMin: todayStart,
      timeMax: todayEnd,
      maxResults: 100,
      singleEvents: true, // Google API tự động bung các sự kiện lặp lại (rrule) cực kỳ chuẩn xác
      orderBy: 'startTime',
      timeZone: 'Asia/Ho_Chi_Minh'
    });

    const events = res.data.items || [];
    const formattedEvents = [];

    const escapeHtml = (text) => {
      if (!text) return '';
      return text
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n\n')
        .replace(/<[^>]*>?/gm, '') // Xóa các thẻ HTML
        .replace(/&/g, '&amp;')    // Bắt buộc cho Telegram
        .replace(/</g, '&lt;')     // Bắt buộc cho Telegram
        .replace(/>/g, '&gt;');    // Bắt buộc cho Telegram
    };

    events.forEach(ev => {
      // Xác định đây là sự kiện Cả ngày hay có giờ cụ thể
      let start, end, datetype;
      
      if (ev.start.date) {
        // Sự kiện cả ngày
        start = 'Cả ngày';
        end = 'Cả ngày';
        datetype = 'date';
      } else if (ev.start.dateTime) {
        // Sự kiện có giờ
        start = dayjs(ev.start.dateTime).tz('Asia/Ho_Chi_Minh').format('HH:mm');
        end = dayjs(ev.end.dateTime).tz('Asia/Ho_Chi_Minh').format('HH:mm');
        datetype = 'date-time';
      } else {
        return; // Bỏ qua nếu dữ liệu không hợp lệ
      }

      formattedEvents.push({
        summary: escapeHtml(ev.summary) || 'Không có tiêu đề',
        description: escapeHtml(ev.description) || '',
        location: escapeHtml(ev.location) || '',
        url: ev.htmlLink || '', // Lấy link Google Calendar chính chủ
        start,
        end,
        datetype
      });
    });

    // Sắp xếp sự kiện: "Cả ngày" lên đầu, các sự kiện khác theo giờ bắt đầu tăng dần
    formattedEvents.sort((a, b) => {
      if (a.start === 'Cả ngày' && b.start !== 'Cả ngày') return -1;
      if (a.start !== 'Cả ngày' && b.start === 'Cả ngày') return 1;
      if (a.start === 'Cả ngày' && b.start === 'Cả ngày') return a.summary.localeCompare(b.summary);
      return a.start.localeCompare(b.start);
    });

    return formattedEvents;
  } catch (error) {
    console.error('Lỗi khi lấy dữ liệu từ Google Calendar API:', error.message);
    return [];
  }
};

module.exports = {
  getTodaysEvents
};
