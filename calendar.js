const ical = require('node-ical');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
dayjs.extend(utc);
dayjs.extend(timezone);

const getTodaysEvents = async (icalUrl) => {
  if (!icalUrl) return [];

  try {
    const data = await ical.async.fromURL(icalUrl);
    const events = [];
    const now = dayjs().tz('Asia/Ho_Chi_Minh');
    const todayStart = now.startOf('day');
    const todayEnd = now.endOf('day');

    const escapeHtml = (text) => {
      if (!text) return '';
      return text
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n\n')
        .replace(/<[^>]*>?/gm, '') // Xóa các thẻ HTML không hợp lệ
        .replace(/&/g, '&amp;')    // Bắt buộc cho Telegram
        .replace(/</g, '&lt;')     // Bắt buộc cho Telegram
        .replace(/>/g, '&gt;');    // Bắt buộc cho Telegram
    };

    for (const k in data) {
      if (!Object.hasOwn(data, k)) continue;
      const ev = data[k];
      if (ev.type !== 'VEVENT') continue;

      let isToday = false;
      let startStr = '';
      let endStr = '';
      let datetype = '';

      if (ev.rrule) {
        // Xử lý sự kiện lặp lại (Recurring events)
        const dates = ev.rrule.between(todayStart.toDate(), todayEnd.toDate(), true);
        
        // Kiểm tra xem sự kiện lặp lại có bị hủy vào ngày hôm nay không (EXDATE)
        let isExcluded = false;
        if (ev.exdate && Object.keys(ev.exdate).length > 0) {
          for (const exKey in ev.exdate) {
            if (dayjs(ev.exdate[exKey]).tz('Asia/Ho_Chi_Minh').isSame(todayStart, 'day')) {
              isExcluded = true;
              break;
            }
          }
        }

        if (dates.length > 0 && !isExcluded) {
          isToday = true;
          // Sự kiện lặp lại thường dùng giờ của sự kiện gốc
          if (ev.datetype === 'date') {
            startStr = 'Cả ngày';
            endStr = 'Cả ngày';
            datetype = 'date';
          } else {
            startStr = dayjs(ev.start).tz('Asia/Ho_Chi_Minh').format('HH:mm');
            endStr = dayjs(ev.end).tz('Asia/Ho_Chi_Minh').format('HH:mm');
            datetype = 'date-time';
          }
        }
      } else {
        // Sự kiện đơn lẻ
        const eventStart = dayjs(ev.start).tz('Asia/Ho_Chi_Minh');
        
        if (ev.datetype === 'date') {
          // Sự kiện cả ngày
          if (eventStart.isSame(todayStart, 'day') || (eventStart.isBefore(todayEnd) && dayjs(ev.end).tz('Asia/Ho_Chi_Minh').isAfter(todayStart))) {
            isToday = true;
            startStr = 'Cả ngày';
            endStr = 'Cả ngày';
            datetype = 'date';
          }
        } else {
          // Sự kiện có giờ cụ thể
          if (eventStart.isSame(todayStart, 'day')) {
            isToday = true;
            startStr = eventStart.format('HH:mm');
            endStr = dayjs(ev.end).tz('Asia/Ho_Chi_Minh').format('HH:mm');
            datetype = 'date-time';
          }
        }
      }

      if (isToday) {
        events.push({
          summary: escapeHtml(ev.summary) || 'Không có tiêu đề',
          description: escapeHtml(ev.description) || '',
          location: escapeHtml(ev.location) || '',
          url: ev.url || '',
          start: startStr,
          end: endStr,
          datetype: datetype
        });
      }
    }

    // Sắp xếp sự kiện: "Cả ngày" lên đầu, các sự kiện khác theo giờ bắt đầu tăng dần
    events.sort((a, b) => {
      if (a.start === 'Cả ngày' && b.start !== 'Cả ngày') return -1;
      if (a.start !== 'Cả ngày' && b.start === 'Cả ngày') return 1;
      if (a.start === 'Cả ngày' && b.start === 'Cả ngày') return a.summary.localeCompare(b.summary);
      return a.start.localeCompare(b.start);
    });

    return events;
  } catch (err) {
    console.error('Lỗi lấy Lịch iCal:', err);
    return [];
  }
};

module.exports = {
  getTodaysEvents
};
