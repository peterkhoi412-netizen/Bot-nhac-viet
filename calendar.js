const ical = require('node-ical');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
dayjs.extend(utc);
dayjs.extend(timezone);

// Hàm lấy các sự kiện của ngày hôm nay từ iCal link
const getTodaysEvents = async (icalUrl) => {
  if (!icalUrl) return [];
  
  try {
    const events = await ical.async.fromURL(icalUrl);
    const today = dayjs().tz('Asia/Ho_Chi_Minh');
    const todayStart = today.startOf('day').toDate();
    const todayEnd = today.endOf('day').toDate();
    const todaysEvents = [];

    for (const k in events) {
      if (events.hasOwnProperty(k)) {
        const ev = events[k];
        if (ev.type === 'VEVENT') {
          // 1. Xử lý sự kiện lặp lại (Recurring Events)
          if (ev.rrule) {
            const occurrences = ev.rrule.between(todayStart, todayEnd);
            for (const occStart of occurrences) {
              // Kiểm tra xem có nằm trong danh sách loại trừ (EXDATE) không
              const occStartStrLocal = dayjs(occStart).tz('Asia/Ho_Chi_Minh').format('YYYY-MM-DD');
              const occStartStrUtc = dayjs(occStart).utc().format('YYYY-MM-DD');
              if (ev.exdate && (ev.exdate[occStartStrLocal] || ev.exdate[occStartStrUtc])) {
                continue; // Bỏ qua sự kiện bị loại trừ
              }

              const durationMs = ev.end.getTime() - ev.start.getTime();
              const occEnd = new Date(occStart.getTime() + durationMs);

              todaysEvents.push({
                summary: ev.summary || 'Không có tiêu đề',
                description: ev.description || '',
                location: ev.location || '',
                url: ev.url || '',
                start: ev.datetype === 'date' ? 'Cả ngày' : dayjs(occStart).tz('Asia/Ho_Chi_Minh').format('HH:mm'),
                end: ev.datetype === 'date' ? 'Cả ngày' : dayjs(occEnd).tz('Asia/Ho_Chi_Minh').format('HH:mm'),
                datetype: ev.datetype
              });
            }
          } 
          // 2. Xử lý sự kiện đơn lẻ (Single Events)
          else {
            const startDate = dayjs(ev.start).tz('Asia/Ho_Chi_Minh');
            const endDate = dayjs(ev.end).tz('Asia/Ho_Chi_Minh');
            
            if (today.isSame(startDate, 'day') || (today.isAfter(startDate, 'day') && today.isBefore(endDate, 'day'))) {
              todaysEvents.push({
                summary: ev.summary || 'Không có tiêu đề',
                description: ev.description || '',
                location: ev.location || '',
                url: ev.url || '',
                start: ev.datetype === 'date' ? 'Cả ngày' : startDate.format('HH:mm'),
                end: ev.datetype === 'date' ? 'Cả ngày' : endDate.format('HH:mm'),
                datetype: ev.datetype
              });
            }
          }
        }
      }
    }
    
    // Sắp xếp sự kiện: "Cả ngày" lên đầu, các sự kiện khác theo giờ bắt đầu tăng dần
    todaysEvents.sort((a, b) => {
      if (a.start === 'Cả ngày' && b.start !== 'Cả ngày') return -1;
      if (a.start !== 'Cả ngày' && b.start === 'Cả ngày') return 1;
      if (a.start === 'Cả ngày' && b.start === 'Cả ngày') return a.summary.localeCompare(b.summary);
      return a.start.localeCompare(b.start);
    });

    return todaysEvents;
  } catch (error) {
    console.error('Lỗi khi lấy dữ liệu Calendar:', error);
    return [];
  }
};

module.exports = {
  getTodaysEvents
};

