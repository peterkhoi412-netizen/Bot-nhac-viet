const ical = require('node-ical');
const dayjs = require('dayjs');

// Hàm lấy các sự kiện của ngày hôm nay từ iCal link
const getTodaysEvents = async (icalUrl) => {
  if (!icalUrl) return [];
  
  try {
    const events = await ical.async.fromURL(icalUrl);
    const today = dayjs();
    const todaysEvents = [];

    for (const k in events) {
      if (events.hasOwnProperty(k)) {
        const ev = events[k];
        if (ev.type === 'VEVENT') {
          const startDate = dayjs(ev.start);
          const endDate = dayjs(ev.end);
          
          // Kiểm tra xem sự kiện có diễn ra trong ngày hôm nay không
          if (today.isSame(startDate, 'day') || (today.isAfter(startDate, 'day') && today.isBefore(endDate, 'day'))) {
            todaysEvents.push({
              summary: ev.summary || 'Không có tiêu đề',
              description: ev.description || '',
              location: ev.location || '',
              url: ev.url || '',
              start: startDate.format('HH:mm'),
              end: endDate.format('HH:mm')
            });
          }
        }
      }
    }
    
    // Sắp xếp sự kiện theo thời gian bắt đầu
    todaysEvents.sort((a, b) => a.start.localeCompare(b.start));
    return todaysEvents;
  } catch (error) {
    console.error('Lỗi khi lấy dữ liệu Calendar:', error);
    return [];
  }
};

module.exports = {
  getTodaysEvents
};
