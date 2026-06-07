require('dotenv').config();
const { Telegraf } = require('telegraf');
const cron = require('node-cron');
const db = require('./database');
const calendar = require('./calendar');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
dayjs.extend(utc);
dayjs.extend(timezone);

const bot = new Telegraf(process.env.BOT_TOKEN);

// --- XÁC THỰC QUYỀN TRUY CẬP (CHỈ ADMIN) ---
bot.use(async (ctx, next) => {
  const adminId = process.env.ADMIN_ID;
  
  // Cho phép dùng lệnh /myid để xem ID dù chưa cấu hình ADMIN_ID
  if (ctx.message && ctx.message.text && ctx.message.text.startsWith('/myid')) {
    return next();
  }

  // Nếu chưa cấu hình ADMIN_ID, tạm thời cho phép tất cả để setup
  if (!adminId) {
    return next();
  }

  // Nếu người nhắn KHÔNG PHẢI là Admin
  if (ctx.from && ctx.from.id.toString() !== adminId) {
    // Chỉ chặn nếu họ cố tình gõ lệnh (bắt đầu bằng /)
    if (ctx.message && ctx.message.text && ctx.message.text.startsWith('/')) {
      return ctx.reply('Em là Bót ngoan xink iu của anh Khui và chỉ nghe nời ảnh thoi ạ hihi <3');
    }
    // Các tin nhắn chat bình thường trong group thì bơ đi
    return;
  }

  return next();
});

// Lệnh hỗ trợ Admin lấy ID
bot.command('myid', (ctx) => {
  ctx.reply(`Telegram ID của anh là: ${ctx.from.id}\nAnh hãy copy dãy số này và thêm vào file .env nhé:\nADMIN_ID=${ctx.from.id}`);
});

// --- CÁC LỆNH CỦA BOT ---

// Lệnh /start: Lưu người dùng hoặc group vào danh sách nhận thông báo
bot.start(async (ctx) => {
  const chatId = ctx.chat.id.toString();
  const chatType = ctx.chat.type;

  if (chatType === 'private') {
    await db.saveUser(chatId);
    ctx.reply('Dạ e chào A/C Khuii ạ! E là Bé Bót Nhắc Việc xink xắn đây. \n\nCác lệnh nè:\n- /add <việc>: Thêm việc\n- /list: Xem việc chưa làm\n- /done <số>: Đánh dấu xong\n- /groups: Xem danh sách Nhóm\n- /addto <mã> <giờ> <việc>: Giao việc vào Nhóm\n- /report <mã>: Quăng checklist vào Nhóm\n\nE sẽ nhắc lịch cho A/C mỗi ngày nhen 💕');
  } else {
    const groupData = await db.saveGroup(chatId, ctx.chat.title);
    ctx.reply(`Bé Bót xin chào cả nhà ạ! Bót đã nhớ Group ${ctx.chat.title || 'này'} rồi nhen.\nMã số của Nhóm là: ${groupData.alias_id}`);
  }
});

// Lệnh /groups: Xem danh sách các nhóm đã kết nối
bot.command('groups', async (ctx) => {
  const groups = await db.getGroupList();
  if (groups.length === 0) return ctx.reply('Dạ hiện tại chưa có nhóm nào được kết nối ạ.');
  let msg = '🏢 <b>DANH SÁCH NHÓM CỦA KHUII</b>\n\n';
  groups.forEach(g => {
    msg += `Mã số: <b>${g.alias_id}</b> - Tên: ${g.title}\n`;
  });
  msg += '\n👉 Để giao việc, A/C dùng lệnh:\n<code>/addto &lt;Mã số&gt; &lt;Giờ&gt; &lt;Nội dung&gt;</code>';
  ctx.replyWithHTML(msg);
});

// Lệnh /addto: Thêm task vào group khác
bot.command('addto', async (ctx) => {
  const text = ctx.message.text.replace('/addto', '').trim();
  const match = text.match(/^(\d+)\s+(.+)$/s); // match group ID and the rest (including newlines)
  if (!match) {
    return ctx.reply('Sai cú pháp! Vui lòng dùng: /addto <Mã Nhóm> <Nội dung>\nVí dụ: /addto 1 16:00 Báo cáo');
  }

  const targetAliasId = parseInt(match[1]);
  const restText = match[2];

  const targetGroup = await db.getGroupById(targetAliasId);
  if (!targetGroup) {
    return ctx.reply(`Không tìm thấy nhóm nào có mã số ${targetAliasId}. Gõ /groups để xem danh sách mã nhóm.`);
  }

  const targetChatId = targetGroup.chat_id;

  // Lọc ra tất cả các thời gian (vd: 16:00, 16h00) có trong tin nhắn
  const timeRegex = /\b([01]?[0-9]|2[0-3])[:hH]([0-5][0-9])\b/g;
  let reminderTimes = [];
  let matchTime;
  while ((matchTime = timeRegex.exec(restText)) !== null) {
    const hh = matchTime[1].padStart(2, '0');
    const mm = matchTime[2];
    reminderTimes.push(`${hh}:${mm}`);
  }

  // Chia tin nhắn thành nhiều dòng, mỗi dòng là một công việc
  const lines = restText.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  // Nếu không có thời gian nào được ghi ra, lưu task không hẹn giờ
  if (reminderTimes.length === 0) {
    for (let line of lines) {
      await db.addTask(targetChatId, line, null);
    }
    return ctx.reply(`✅ Dạ Bót đã thêm ${lines.length} việc rùi ạ. (Hông hẹn giờ nhắc)`);
  }

  // Nếu có hẹn giờ, tạo task riêng cho từng mốc thời gian
  let msg = `✅ Dạ Bót đã thêm các việc sau vào nhóm [${targetGroup.title}] rùi nè:\n`;
  for (let time of reminderTimes) {
    for (let line of lines) {
      await db.addTask(targetChatId, line, time);
    }
    msg += `- ⏰ ${time}: ${lines.join(', ')}\n`;
  }
  ctx.reply(msg);
});

// Lệnh /report: Ép Bot gửi Checklist vào Group ngay lập tức (dùng cho T7, CN hoặc bất cứ lúc nào)
bot.command('report', async (ctx) => {
  const text = ctx.message.text.replace('/report', '').trim();
  const targetAliasId = parseInt(text);
  
  if (isNaN(targetAliasId)) {
    return ctx.reply('Sai cú pháp! Vui lòng dùng: /report <Mã Nhóm>\nVí dụ: /report 1');
  }

  const targetGroup = await db.getGroupById(targetAliasId);
  if (!targetGroup) {
    return ctx.reply(`Không tìm thấy nhóm nào có mã số ${targetAliasId}.`);
  }

  const pendingTasks = await db.getPendingTasks(targetGroup.chat_id);
  
  let reportMsg = '📊 <b>Checklist Công Việc Tăng Cường</b>\n\nTuy là cuối tuần, nhưng có 1 số task gấp A/C cố gắng hoàn thành giúp em ọ\n\n';
  
  if (pendingTasks.length === 0) {
    return ctx.reply('Dạ hiện tại nhóm chưa có việc nào nên hông cần ép báo cáo đâu ạ.');
  } else {
    pendingTasks.forEach((t, idx) => {
      const timeStr = t.reminder_time ? ` (⏰ ${t.reminder_time})` : '';
      reportMsg += `<b>${idx + 1}.</b> ${t.task}${timeStr}\n`;
    });
  }

  bot.telegram.sendMessage(targetGroup.chat_id, reportMsg, { parse_mode: 'HTML' })
    .then(() => ctx.reply(`✅ Đã "quăng" Checklist vào nhóm [${targetGroup.title}] thành công!`))
    .catch(e => {
      console.error(e);
      ctx.reply('❌ Có lỗi xảy ra khi gửi tin nhắn vào nhóm.');
    });
});

// Lệnh /add: Thêm task mới (hỗ trợ nhiều thời gian và nhiều dòng)
bot.command('add', async (ctx) => {
  const chatId = ctx.chat.id.toString();
  const rawText = ctx.message.text.replace(/^\/add(?:@[a-zA-Z0-9_]+)?\s*/i, '').trim();
  
  if (!rawText) {
    return ctx.reply('Vui lòng nhập nội dung công việc. Ví dụ: /add 15:30 Gửi báo cáo');
  }
  
  const lines = rawText.split('\n').filter(l => l.trim() !== '');
  let replyMsg = '✅ <b>Dạ Bót đã ghi nhận các việc sau:</b>\n';

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
    const pendingTasks = await db.getPendingTasks(chatId);
    if (pendingTasks.length === 0) {
      return ctx.reply('🎉 Zéeee! Hiện tại hông có việc nào tồn đọng hết á!');
    }
    
    let msg = '📋 <b>DANH SÁCH VIỆC CHƯA LÀM</b>\n\n';
    pendingTasks.forEach((t, index) => {
      const timeStr = t.reminder_time ? ` (⏰ ${t.reminder_time})` : '';
      msg += `<b>${index + 1}.</b> ${t.task}${timeStr}\n`;
    });
    msg += '\n👉 A/C gõ <code>/done &lt;số&gt;</code> để đánh dấu xong nha!';
    
    ctx.reply(msg, { parse_mode: 'HTML' });
  } catch (err) {
    ctx.reply('❌ Lỗi khi tải danh sách công việc.');
  }
});

// Lệnh /done: Đánh dấu hoàn thành
bot.command('done', async (ctx) => {
  const chatId = ctx.chat.id.toString();
  const rawInput = ctx.message.text.replace(/^\/done(?:@[a-zA-Z0-9_]+)?\s*/i, '').trim();
  
  if (!rawInput) {
    return ctx.reply('Dạ A/C nhập số thứ tự giúp Bót nha. Ví dụ: /done 1 hoặc /done 1,2,3');
  }
  
  const pendingTasks = await db.getPendingTasks(chatId);
  const taskIndices = rawInput.split(/[, ]+/).filter(id => !isNaN(id) && id.trim() !== '');

  if (taskIndices.length === 0) {
    return ctx.reply('Dạ A/C nhập số thứ tự hợp lệ giúp Bót nha (chỉ chứa số). Ví dụ: /done 1,2,3');
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

    if (successIndices.length > 0) {
      let successText = successIndices.map(t => `👉 <i>${t}</i>`).join('\n');
      ctx.reply(`✅ Giỏi quá ta! Đã gạch xong việc nè:\n${successText}`, { parse_mode: 'HTML' });
    }
    
    if (failedIndices.length > 0) {
      ctx.reply(`❌ Ỏ, hông tìm thấy các công việc mang số: ${failedIndices.join(', ')}`);
    }
  } catch (err) {
    ctx.reply('❌ Có lỗi xảy ra, hông gạch việc được ạ.');
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
  
  let msg = '🌅 <b>Chào buổi sáng tốt lành! Chúc A/C một ngày làm việc siêu năng suất nhen 💕</b>\n\n';
  
  if (events.length > 0) {
    msg += '📅 <b>Lịch trình của A/C hôm nay nè:</b>\n';
    events.forEach(e => {
      msg += `- ${e.start} - ${e.end}: <b>${e.summary}</b>\n`;
      if (e.location) msg += `  📍 <b>Địa điểm:</b> ${e.location}\n`;
      if (e.url) msg += `  🔗 <b>Link:</b> ${e.url}\n`;
    });
  } else {
    msg += '📅 Hôm nay A/C hông có lịch họp nào hết á.\n';
  }

  // Gửi 2 thông báo: 1 lịch sự kiện, 1 danh sách task
  for (const chatId of users) {
    // Gửi Lịch
    await bot.telegram.sendMessage(chatId, msg, { parse_mode: 'HTML' })
      .catch(e => console.error(`Failed to send morning msg to ${chatId}`));

    // Gửi Danh sách Task
    const pendingTasks = await db.getPendingTasks(chatId);
    if (pendingTasks.length > 0) {
      let taskMsg = '📋 <b>Các việc Khuii cần hoàn thành hôm nay nè:</b>\n\n';
      pendingTasks.forEach((t, idx) => {
        const timeStr = t.reminder_time ? ` (⏰ ${t.reminder_time})` : '';
        taskMsg += `<b>${idx + 1}.</b> ${t.task}${timeStr}\n`;
      });
      await bot.telegram.sendMessage(chatId, taskMsg, { parse_mode: 'HTML' })
        .catch(e => console.error(`Failed to send morning tasks to ${chatId}`));
    }
  }
}, { timezone: 'Asia/Ho_Chi_Minh' });

// 2. Nhắc nhở cuối ngày làm việc (17:30 chiều mỗi ngày)
cron.schedule('30 17 * * *', async () => {
  const users = await db.getAllUsers();
  
  users.forEach(chatId => {
    bot.telegram.sendMessage(chatId, '🌇 Đã 5h30 chiều gòi! Mọi người nhớ check lại việc trong ngày rồi gõ /done nhen. Chuẩn bị nghỉ ngơi thuii 💖')
      .catch(e => console.error(`Failed to send evening msg to ${chatId}`));
  });
}, { timezone: 'Asia/Ho_Chi_Minh' });

const notifiedEvents = new Set(); // Lưu trữ các sự kiện đã báo để không báo lại

// 3. Nhắc nhở sự kiện sát giờ (chạy kiểm tra mỗi phút)
cron.schedule('* * * * *', async () => {
  const users = await db.getAllUsers();
  if (users.length === 0) return;

  const icalUrl = process.env.CALENDAR_ICAL_URL;
  if (!icalUrl) return;

  const events = await calendar.getTodaysEvents(icalUrl);
  const now = dayjs().tz('Asia/Ho_Chi_Minh');

  // Xóa cache các sự kiện của ngày hôm qua để giải phóng bộ nhớ
  if (now.format('HH:mm') === '00:00') {
    notifiedEvents.clear();
  }

  events.forEach(e => {
    const [hours, minutes] = e.start.split(':');
    const eventTime = now.clone().hour(parseInt(hours)).minute(parseInt(minutes)).second(0).millisecond(0);
    const diffMinutes = eventTime.diff(now.second(0).millisecond(0), 'minute');

    const eventKey = `${e.summary}-${e.start}`;

    // Nếu thời gian còn lại từ 0 đến 15 phút VÀ chưa từng báo
    if (diffMinutes <= 15 && diffMinutes >= 0 && !notifiedEvents.has(eventKey)) {
      notifiedEvents.add(eventKey);
      
      let msg = `⏰ <b>Chuẩn bị họp/sự kiện thuii (${diffMinutes} phút nữa nha)!</b>\n\n📌 <b>Sự kiện:</b> ${e.summary}\n🕒 <b>Thời gian:</b> ${e.start} - ${e.end}\n`;
      if (e.location) msg += `📍 <b>Địa điểm:</b> ${e.location}\n`;
      if (e.url) msg += `🔗 <b>Link:</b> ${e.url}\n`;
      if (e.description) msg += `📝 <b>Mô tả:</b>\n${e.description}`;

      users.forEach(chatId => {
        bot.telegram.sendMessage(chatId, msg, { parse_mode: 'HTML' })
          .catch(err => console.error('Lỗi khi gửi nhắc lịch sát giờ:', err));
      });
    }
  });
}, { timezone: 'Asia/Ho_Chi_Minh' });

// 4. Báo cáo tự động vào Group (9:00 sáng từ Thứ 2 - Thứ 6)
cron.schedule('0 9 * * 1-5', async () => {
  const groups = await db.getAllGroups();
  if (groups.length === 0) return;

  for (const chatId of groups) {
    const pendingTasks = await db.getPendingTasks(chatId);
    
    let reportMsg = '📊 <b>Checklist Công Việc Hôm Nay</b>\n\nChào buổi sáng cả nhà! Chúc mọi người làm việc siêu hiệu quả nhé. Dưới đây là list việc hôm nay ạ:\n\n';
    
    if (pendingTasks.length === 0) {
      continue; // Hông có việc thì hông gửi luôn
    } else {
      pendingTasks.forEach((t, idx) => {
        const timeStr = t.reminder_time ? ` (⏰ ${t.reminder_time})` : '';
        reportMsg += `<b>${idx + 1}.</b> ${t.task}${timeStr}\n`;
      });
    }

    bot.telegram.sendMessage(chatId, reportMsg, { parse_mode: 'HTML' })
      .catch(e => console.error('Lỗi khi gửi báo cáo vào group:', e));
  }
}, { timezone: 'Asia/Ho_Chi_Minh' });

// 5. Nhắc nhở Task theo mốc giờ hẹn (chạy mỗi phút)
cron.schedule('* * * * *', async () => {
  const now = dayjs().tz('Asia/Ho_Chi_Minh');
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

      let msg = `🔔 <b>Tới giờ làm việc rùi nè! (${currentHHMM})</b>\n\n`;
      tasksByChat[chatId].forEach(t => {
        const displayIdx = allPending.findIndex(pt => pt.id === t.id) + 1;
        msg += `<b>${displayIdx}.</b> ${t.task}\n`;
      });
      
      // Chỉ hiện hướng dẫn /done nếu là chat cá nhân (ID không bắt đầu bằng dấu trừ)
      if (!chatId.toString().startsWith('-')) {
        msg += `\nĐừng quên gõ <code>/done &lt;số&gt;</code> khi làm xong nhen!`;
      }

      bot.telegram.sendMessage(chatId, msg, { parse_mode: 'HTML' })
        .catch(err => console.error('Lỗi khi gửi nhắc task:', err));
    }
  } catch (err) {
    console.error('Lỗi cron nhắc task theo giờ:', err);
  }
}, { timezone: 'Asia/Ho_Chi_Minh' });

// 6. Nhắc nhở lên lịch ngày mai (22:00 mỗi ngày)
cron.schedule('0 22 * * *', async () => {
  const users = await db.getAllUsers();
  users.forEach(chatId => {
    bot.telegram.sendMessage(chatId, '🌙 Tới 10h tối gòi nè! Khuii nhớ take note lại các lịch trình và việc cần làm cho ngày mai nha. Chúc Khuii ngủ ngon hihi 💖')
      .catch(e => console.error(`Failed to send 22:00 msg to ${chatId}`));
  });
}, { timezone: 'Asia/Ho_Chi_Minh' });

// --- CHẠY BOT ---
const startBot = async () => {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    console.error('❌ Lỗi: Chưa cung cấp MONGODB_URI trong file .env');
    console.error('Vui lòng thêm MONGODB_URI=... vào file .env của bạn.');
    process.exit(1);
  }
  
  await db.connectDB(mongoUri);

  // Thiết lập Menu Lệnh (Gõ / sẽ hiện ra)
  bot.telegram.setMyCommands([
    { command: 'add', description: 'Thêm việc mới cho Khuii' },
    { command: 'list', description: 'Xem các việc chưa làm' },
    { command: 'done', description: 'Đánh dấu xong việc (VD: /done 1,2)' },
    { command: 'groups', description: 'Xem mã số các Nhóm' },
    { command: 'addto', description: 'Giao việc cho Nhóm (VD: /addto 1 Giờ Việc)' },
    { command: 'report', description: 'Ép gửi Checklist vào Nhóm (VD: /report 1)' },
    { command: 'testcal', description: 'Kiểm tra dữ liệu Lịch Google' },
    { command: 'myid', description: 'Xem Telegram ID của Khuii' }
  ]);

  bot.launch().then(() => {
    console.log('Bot is running...');
  });
};

// --- MÁY CHỦ ẢO CHO RENDER ---
const http = require('http');
http.createServer((req, res) => {
  res.writeHead(200);
  res.end('Bot is running 24/7');
}).listen(process.env.PORT || 3000);

startBot();

// Bắt lỗi để bot không bị crash (tùy chọn)
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
