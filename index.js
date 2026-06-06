require('dotenv').config();
const { Telegraf } = require('telegraf');
const cron = require('node-cron');
const db = require('./database');
const calendar = require('./calendar');

const bot = new Telegraf(process.env.BOT_TOKEN);

// --- CÁC LỆNH CỦA BOT ---

// Lệnh /start: Lưu người dùng hoặc group vào danh sách nhận thông báo
bot.start(async (ctx) => {
  const chatId = ctx.chat.id.toString();
  const chatType = ctx.chat.type;

  if (chatType === 'private') {
    await db.saveUser(chatId);
    ctx.reply('Chào bạn! Tôi là Bot Nhắc Việc. \n\nCác lệnh khả dụng:\n- /add <nội dung>: Thêm công việc\n- /list: Xem việc chưa làm\n- /done <id>: Đánh dấu xong\n\nTôi sẽ tự động nhắc lịch và báo giờ làm việc hàng ngày nhé!');
  } else {
    await db.saveGroup(chatId);
    ctx.reply('Chào cả nhà! Bot đã ghi nhận Group này để gửi báo cáo định kỳ (Các lịch cá nhân sẽ không bị gửi vào đây).');
  }
});

// Lệnh /add: Thêm task mới (hỗ trợ nhiều thời gian và nhiều dòng)
bot.command('add', async (ctx) => {
  const chatId = ctx.chat.id.toString();
  const rawText = ctx.message.text.replace(/^\/add(?:@[a-zA-Z0-9_]+)?\s*/i, '').trim();
  
  if (!rawText) {
    return ctx.reply('Vui lòng nhập nội dung công việc. Ví dụ: /add 15:30 Gửi báo cáo');
  }
  
  const lines = rawText.split('\n').filter(l => l.trim() !== '');
  let replyMsg = '✅ <b>Đã thêm các công việc sau:</b>\n';

  try {
    for (const line of lines) {
      // Tìm tất cả các cụm HH:mm hoặc HHhmm trong dòng
      const timeRegex = /\b([01]?[0-9]|2[0-3])[:hH]([0-5][0-9])\b/g;
      const times = [];
      let match;
      while ((match = timeRegex.exec(line)) !== null) {
        let h = match[1].padStart(2, '0');
        let m = match[2];
        times.push(`${h}:${m}`);
      }
      
      // Xóa thời gian ra khỏi nội dung
      let taskName = line.replace(timeRegex, '').trim();
      if (!taskName) taskName = "Công việc không tên";

      if (times.length > 0) {
        for (const t of times) {
          await db.addTask(chatId, taskName, t);
          replyMsg += `- ⏰ ${t} - ${taskName}\n`;
        }
      } else {
        await db.addTask(chatId, taskName, null);
        replyMsg += `- ${taskName}\n`;
      }
    }
    ctx.reply(replyMsg, { parse_mode: 'HTML' });
  } catch (err) {
    ctx.reply('❌ Lỗi khi thêm công việc.');
  }
});

// Lệnh /list: Xem danh sách công việc
bot.command('list', async (ctx) => {
  const chatId = ctx.chat.id.toString();
  try {
    const tasks = await db.getPendingTasks(chatId);
    if (tasks.length === 0) {
      return ctx.reply('🎉 Bạn không có công việc nào đang chờ!');
    }
    
    let message = '📋 <b>Danh sách công việc chưa làm:</b>\n\n';
    tasks.forEach((t, index) => {
      const timeStr = t.reminder_time ? `[⏰ ${t.reminder_time}] ` : '';
      message += `<b>${index + 1}.</b> ${timeStr}${t.task}\n`;
    });
    message += '\nDùng lệnh <code>/done &lt;số&gt;</code> để đánh dấu hoàn thành.';
    
    ctx.reply(message, { parse_mode: 'HTML' });
  } catch (err) {
    ctx.reply('❌ Lỗi khi tải danh sách công việc.');
  }
});

// Lệnh /done: Đánh dấu hoàn thành
bot.command('done', async (ctx) => {
  const chatId = ctx.chat.id.toString();
  const rawInput = ctx.message.text.replace(/^\/done(?:@[a-zA-Z0-9_]+)?\s*/i, '').trim();
  
  if (!rawInput) {
    return ctx.reply('Vui lòng nhập số thứ tự hợp lệ. Ví dụ: /done 1 hoặc /done 1,2,3');
  }
  
  const pendingTasks = await db.getPendingTasks(chatId);
  const taskIndices = rawInput.split(/[, ]+/).filter(id => !isNaN(id) && id.trim() !== '');

  if (taskIndices.length === 0) {
    return ctx.reply('Vui lòng nhập số thứ tự hợp lệ (chỉ chứa số). Ví dụ: /done 1,2,3');
  }

  try {
    let successIndices = [];
    let failedIndices = [];

    for (const idxStr of taskIndices) {
      const idx = parseInt(idxStr) - 1;
      if (idx >= 0 && idx < pendingTasks.length) {
        const realId = pendingTasks[idx].id;
        const changes = await db.markTaskDone(chatId, realId);
        if (changes > 0) {
          successIndices.push(idxStr);
        } else {
          failedIndices.push(idxStr);
        }
      } else {
        failedIndices.push(idxStr);
      }
    }

    let replyMsg = '';
    if (successIndices.length > 0) {
      replyMsg += `✅ Đã hoàn thành công việc số: <b>${successIndices.join(', ')}</b>\n`;
    }
    if (failedIndices.length > 0) {
      replyMsg += `⚠️ Không tìm thấy hoặc đã xong số: <b>${failedIndices.join(', ')}</b>`;
    }
    
    ctx.reply(replyMsg.trim(), { parse_mode: 'HTML' });
  } catch (err) {
    ctx.reply('❌ Lỗi khi cập nhật công việc.');
  }
});

// Lệnh /testcal: Kiểm tra Lịch ngay lập tức
bot.command('testcal', async (ctx) => {
  const icalUrl = process.env.CALENDAR_ICAL_URL;
  if (!icalUrl) {
    return ctx.reply('Chưa có link Lịch trong file .env');
  }
  
  ctx.reply('Đang tải dữ liệu lịch Google...');
  const events = await calendar.getTodaysEvents(icalUrl);
  
  if (events.length === 0) {
    return ctx.reply('Không tìm thấy sự kiện nào trong ngày hôm nay trên Lịch của bạn.');
  }

  let msg = '🛠 <b>Kiểm tra dữ liệu sự kiện hôm nay:</b>\n\n';
  events.forEach(e => {
    msg += `📌 <b>Sự kiện:</b> ${e.summary}\n`;
    msg += `🕒 <b>Thời gian:</b> ${e.start} - ${e.end}\n`;
    msg += `📍 <b>Địa điểm:</b> ${e.location || 'Không có'}\n`;
    msg += `🔗 <b>Link:</b> ${e.url || 'Không có'}\n`;
    msg += `📝 <b>Mô tả:</b> ${e.description ? '\\n' + e.description : 'Không có'}\n\n`;
  });

  ctx.replyWithHTML(msg);
});

// --- LÊN LỊCH TỰ ĐỘNG (CRON JOBS) ---
// 1. Nhắc nhở bắt đầu ngày mới và tổng hợp Lịch (8:00 sáng mỗi ngày)
cron.schedule('0 8 * * *', async () => {
  const users = await db.getAllUsers();
  if (users.length === 0) return;

  const icalUrl = process.env.CALENDAR_ICAL_URL;
  const events = await calendar.getTodaysEvents(icalUrl);
  
  let msg = '🌅 <b>Chào buổi sáng! Bắt đầu ngày làm việc mới năng suất nhé!</b>\n\n';
  
  if (events.length > 0) {
    msg += '📅 <b>Lịch trình của bạn hôm nay:</b>\n';
    events.forEach(e => {
      msg += `- ${e.start} - ${e.end}: <b>${e.summary}</b>\n`;
      if (e.location) msg += `  📍 <b>Địa điểm:</b> ${e.location}\n`;
      if (e.url) msg += `  🔗 <b>Link:</b> ${e.url}\n`;
    });
  } else {
    msg += '📅 Bạn không có lịch họp nào hôm nay.\n';
  }

  // Gửi thông báo cho tất cả người dùng
  users.forEach(chatId => {
    bot.telegram.sendMessage(chatId, msg, { parse_mode: 'HTML' })
      .catch(e => console.error(`Failed to send morning msg to ${chatId}`));
  });
});

// 2. Nhắc nhở cuối ngày làm việc (17:30 chiều mỗi ngày)
cron.schedule('30 17 * * *', async () => {
  const users = await db.getAllUsers();
  
  users.forEach(chatId => {
    bot.telegram.sendMessage(chatId, '🌇 Đã 5h30 chiều! Bạn nhớ tổng kết lại các công việc trong ngày và đánh dấu xong (lệnh /done) nhé. Nghỉ ngơi thôi nào!')
      .catch(e => console.error(`Failed to send evening msg to ${chatId}`));
  });
});

// 3. Nhắc nhở sự kiện sát giờ (chạy kiểm tra mỗi phút)
cron.schedule('* * * * *', async () => {
  const users = await db.getAllUsers();
  if (users.length === 0) return;

  const icalUrl = process.env.CALENDAR_ICAL_URL;
  if (!icalUrl) return;

  const events = await calendar.getTodaysEvents(icalUrl);
  const now = require('dayjs')();

  events.forEach(e => {
    // Tách giờ và phút của sự kiện
    const [hours, minutes] = e.start.split(':');
    const eventTime = now.clone().hour(parseInt(hours)).minute(parseInt(minutes)).second(0).millisecond(0);
    
    // Tính khoảng thời gian còn lại (bằng phút)
    const diffMinutes = eventTime.diff(now.second(0).millisecond(0), 'minute');

    // Bắn thông báo nếu thời gian còn lại ĐÚNG BẰNG 10 phút
    if (diffMinutes === 10) {
      let msg = `⏰ <b>Sắp tới sự kiện (10 phút nữa)!</b>\n\n📌 <b>Sự kiện:</b> ${e.summary}\n🕒 <b>Thời gian:</b> ${e.start} - ${e.end}\n`;
      if (e.location) msg += `📍 <b>Địa điểm:</b> ${e.location}\n`;
      if (e.url) msg += `🔗 <b>Link:</b> ${e.url}\n`;
      if (e.description) msg += `📝 <b>Mô tả:</b>\n${e.description}`;

      users.forEach(chatId => {
        bot.telegram.sendMessage(chatId, msg, { parse_mode: 'HTML' })
          .catch(err => console.error('Lỗi khi gửi nhắc lịch sát giờ:', err));
      });
    }
  });
});

// 4. Báo cáo tự động vào Group (9:00 sáng mỗi ngày)
cron.schedule('0 9 * * *', async () => {
  const groups = await db.getAllGroups();
  if (groups.length === 0) return;

  const reportMsg = '📊 <b>Báo Cáo Buổi Sáng</b>\n\nĐây là thông báo tự động dành riêng cho Group! Chúc mọi người ngày làm việc hiệu quả.';

  groups.forEach(chatId => {
    bot.telegram.sendMessage(chatId, reportMsg, { parse_mode: 'HTML' })
      .catch(e => console.error('Lỗi khi gửi báo cáo vào group:', e));
  });
});

// 5. Nhắc nhở Task theo mốc giờ hẹn (chạy mỗi phút)
cron.schedule('* * * * *', async () => {
  const now = require('dayjs')();
  const currentHHMM = now.format('HH:mm');

  try {
    const tasks = await db.getTasksByReminderTime(currentHHMM);
    if (tasks.length === 0) return;

    // Phân nhóm task theo chat_id để gửi 1 tin nhắn gộp nếu có nhiều task
    const tasksByChat = {};
    tasks.forEach(t => {
      if (!tasksByChat[t.chat_id]) tasksByChat[t.chat_id] = [];
      tasksByChat[t.chat_id].push(t);
    });

    for (const chatId in tasksByChat) {
      const allPending = await db.getPendingTasks(chatId);

      let msg = `🔔 <b>Tới giờ làm việc rồi! (${currentHHMM})</b>\n\n`;
      tasksByChat[chatId].forEach(t => {
        const displayIdx = allPending.findIndex(pt => pt.id === t.id) + 1;
        msg += `<b>${displayIdx}.</b> ${t.task}\n`;
      });
      msg += `\nĐừng quên gõ <code>/done &lt;số&gt;</code> khi làm xong nhé!`;

      bot.telegram.sendMessage(chatId, msg, { parse_mode: 'HTML' })
        .catch(err => console.error('Lỗi khi gửi nhắc task:', err));
    }
  } catch (err) {
    console.error('Lỗi cron nhắc task theo giờ:', err);
  }
});

// --- CHẠY BOT ---
const startBot = async () => {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    console.error('❌ Lỗi: Chưa cung cấp MONGODB_URI trong file .env');
    console.error('Vui lòng thêm MONGODB_URI=... vào file .env của bạn.');
    process.exit(1);
  }
  
  await db.connectDB(mongoUri);

  bot.launch().then(() => {
    console.log('Bot is running...');
  });
};

startBot();

// Bắt lỗi để bot không bị crash (tùy chọn)
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
