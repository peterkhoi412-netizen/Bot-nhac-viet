require('dotenv').config();
const { Telegraf } = require('telegraf');
const cron = require('node-cron');
const db = require('./database');
const calendar = require('./calendar');
const { checkKTCData } = require('./googleSheets');
const ai = require('./ai');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
dayjs.extend(utc);
dayjs.extend(timezone);

const parseRecurrence = (text) => {
  const match = text.match(/\[(.*?)\]/);
  if (!match) return { recurrence: [], cleanedText: text, label: '' };
  
  const bracketContent = match[1].toLowerCase();
  let recurrence = [];
  
  if (bracketContent.includes('daily') || bracketContent.includes('hàng ngày')) {
    recurrence = [0, 1, 2, 3, 4, 5, 6];
  } else {
    if (bracketContent.includes('chủ nhật') || bracketContent.includes('cn')) recurrence.push(0);
    if (bracketContent.includes('thứ 2') || bracketContent.includes('t2')) recurrence.push(1);
    if (bracketContent.includes('thứ 3') || bracketContent.includes('t3')) recurrence.push(2);
    if (bracketContent.includes('thứ 4') || bracketContent.includes('t4')) recurrence.push(3);
    if (bracketContent.includes('thứ 5') || bracketContent.includes('t5')) recurrence.push(4);
    if (bracketContent.includes('thứ 6') || bracketContent.includes('t6')) recurrence.push(5);
    if (bracketContent.includes('thứ 7') || bracketContent.includes('t7')) recurrence.push(6);
  }
  
  const cleanedText = text.replace(/\[.*?\]/, '').trim();
  return { recurrence, cleanedText, label: match[0] };
};

const getRecurrenceString = (arr) => {
  if (!arr || arr.length === 0) return '';
  if (arr.length === 7) return '[Daily]';
  const dayNames = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
  const names = arr.map(d => dayNames[d]);
  return `[${names.join(', ')}]`;
};

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
    // Các tin nhắn chat bình thường trong group thì cho phép đi tiếp để xài AI
    return next();
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

// Lắng nghe sự kiện Bot bị xóa khỏi nhóm hoặc tự rời nhóm
bot.on('my_chat_member', async (ctx) => {
  const status = ctx.myChatMember.new_chat_member.status;
  if (status === 'left' || status === 'kicked') {
    const chatId = ctx.chat.id.toString();
    await db.removeGroup(chatId);
    console.log(`Bot đã rời khỏi nhóm ${ctx.chat.title || chatId} và đã tự động xóa khỏi CSDL.`);
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

  // Xử lý từng dòng công việc
  let msg = `✅ Dạ Bót đã thêm các việc sau vào nhóm [${targetGroup.title}] rùi nè:\n`;
  for (let line of lines) {
    const { recurrence, cleanedText, label } = parseRecurrence(line);
    const recLabel = label ? ` ${label}` : '';
    
    // Xóa thời gian ra khỏi nội dung (dùng timeRegex đã có ở trên)
    let taskName = cleanedText.replace(timeRegex, '').trim();
    if (!taskName) taskName = "Công việc không tên";
    
    if (reminderTimes.length === 0) {
      await db.addTask(targetChatId, taskName, null, recurrence);
      msg += `- ${taskName}${recLabel}\n`;
    } else {
      for (let time of reminderTimes) {
        await db.addTask(targetChatId, taskName, time, recurrence);
        msg += `- ⏰ ${time}: ${taskName}${recLabel}\n`;
      }
    }
  }
  ctx.reply(msg);
});

// Lệnh /testktc: Chạy test kiểm tra dữ liệu Google Sheet KTC ngay lập tức
bot.command('testktc', async (ctx) => {
  ctx.reply('⏳ Bót đang chui vào Google Sheets kiểm tra dữ liệu KTC, Sếp đợi xíu nha...');
  await checkKTCData(bot, db, ctx);
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
      
      const { recurrence, cleanedText, label } = parseRecurrence(line);
      const recLabel = label ? ` ${label}` : '';
      
      // Xóa thời gian ra khỏi nội dung
      let taskName = cleanedText.replace(timeRegex, '').trim();
      if (!taskName) taskName = "Công việc không tên";

      if (times.length > 0) {
        for (const t of times) {
          await db.addTask(chatId, taskName, t, recurrence);
          replyMsg += `- ⏰ ${t} - ${taskName}${recLabel}\n`;
        }
      } else {
        await db.addTask(chatId, taskName, null, recurrence);
        replyMsg += `- ${taskName}${recLabel}\n`;
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
    let pendingTasks = await db.getPendingTasks(chatId);
    
    // Lọc bỏ task lặp lại đã làm hôm nay (Vẫn giữ các task của ngày khác để Sếp xem)
    const now = dayjs().tz('Asia/Ho_Chi_Minh');
    const todayStr = now.format('YYYY-MM-DD');
    
    pendingTasks = pendingTasks.filter(t => {
      if (t.recurrence && t.recurrence.length > 0) {
      }
      return true;
    });

    if (pendingTasks.length === 0) {
      return ctx.reply('🎉 Zéeee! Hiện tại hông có việc nào tồn đọng hết á!');
    }
    
    let msg = '📋 <b>DANH SÁCH VIỆC CHƯA LÀM</b>\n\n';
    pendingTasks.forEach((t, index) => {
      const timeStr = t.reminder_time ? ` (⏰ ${t.reminder_time})` : '';
      const recIcon = (t.recurrence && t.recurrence.length > 0) ? ` 🔁 ${getRecurrenceString(t.recurrence)}` : '';
      msg += `<b>${index + 1}.</b> ${t.task}${timeStr}${recIcon}\n`;
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
    const now = dayjs().tz('Asia/Ho_Chi_Minh');
    const todayStr = now.format('YYYY-MM-DD');
    
    // Lấy lại danh sách task đang hiển thị để map đúng số thứ tự
    let displayTasks = pendingTasks.filter(t => {
      if (t.recurrence && t.recurrence.length > 0) {
      }
      return true;
    });

    for (const idxStr of taskIndices) {
      const idx = parseInt(idxStr) - 1;
      if (idx >= 0 && idx < displayTasks.length) {
        const realId = displayTasks[idx].id;
        const changes = await db.markTaskDone(chatId, realId, todayStr);
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

// Lệnh /listto: Xem danh sách công việc của Nhóm từ chat riêng
bot.command('listto', async (ctx) => {
  if (ctx.chat.type !== 'private') return ctx.reply('Lệnh này chỉ dùng ở chat riêng nha Sếp!');
  const text = ctx.message.text.replace('/listto', '').trim();
  const targetAliasId = parseInt(text);
  
  if (isNaN(targetAliasId)) {
    return ctx.reply('Sai cú pháp! Vui lòng dùng: /listto <Mã Nhóm>\nVí dụ: /listto 1');
  }

  const targetGroup = await db.getGroupById(targetAliasId);
  if (!targetGroup) return ctx.reply(`Không tìm thấy nhóm nào có mã số ${targetAliasId}.`);

  try {
    let pendingTasks = await db.getPendingTasks(targetGroup.chat_id);
    const now = dayjs().tz('Asia/Ho_Chi_Minh');
    const todayStr = now.format('YYYY-MM-DD');
    
    pendingTasks = pendingTasks.filter(t => {
      if (t.recurrence && t.recurrence.length > 0) {
      }
      return true;
    });

    if (pendingTasks.length === 0) {
      return ctx.reply(`🎉 Nhóm [${targetGroup.title}] hiện tại không có việc nào tồn đọng!`);
    }
    
    let msg = `📋 <b>DANH SÁCH VIỆC NHÓM [${targetGroup.title}]</b>\n\n`;
    pendingTasks.forEach((t, index) => {
      const timeStr = t.reminder_time ? ` (⏰ ${t.reminder_time})` : '';
      const recIcon = (t.recurrence && t.recurrence.length > 0) ? ` 🔁 ${getRecurrenceString(t.recurrence)}` : '';
      msg += `<b>${index + 1}.</b> ${t.task}${timeStr}${recIcon}\n`;
    });
    msg += `\n👉 Gõ <code>/doneto ${targetAliasId} &lt;số&gt;</code> để gạch việc cho nhóm này.`;
    
    ctx.reply(msg, { parse_mode: 'HTML' });
  } catch (err) {
    ctx.reply('❌ Lỗi khi tải danh sách công việc của nhóm.');
  }
});

// Lệnh /doneto: Gạch việc của Nhóm từ chat riêng
bot.command('doneto', async (ctx) => {
  if (ctx.chat.type !== 'private') return ctx.reply('Lệnh này chỉ dùng ở chat riêng nha Sếp!');
  const text = ctx.message.text.replace('/doneto', '').trim();
  const match = text.match(/^(\d+)\s+(.+)$/);
  
  if (!match) {
    return ctx.reply('Sai cú pháp! Vui lòng dùng: /doneto <Mã Nhóm> <Số thứ tự>\nVí dụ: /doneto 1 1,2');
  }

  const targetAliasId = parseInt(match[1]);
  const taskIndicesStr = match[2];

  const targetGroup = await db.getGroupById(targetAliasId);
  if (!targetGroup) return ctx.reply(`Không tìm thấy nhóm nào có mã số ${targetAliasId}.`);

  const taskIndices = taskIndicesStr.split(/[, ]+/).filter(id => !isNaN(id) && id.trim() !== '');
  if (taskIndices.length === 0) return ctx.reply('Nhập số thứ tự hợp lệ (chỉ chứa số).');

  try {
    let pendingTasks = await db.getPendingTasks(targetGroup.chat_id);
    const now = dayjs().tz('Asia/Ho_Chi_Minh');
    const todayStr = now.format('YYYY-MM-DD');

    let displayTasks = pendingTasks.filter(t => {
      if (t.recurrence && t.recurrence.length > 0) {
      }
      return true;
    });

    let successIndices = [];
    let failedIndices = [];

    for (const idxStr of taskIndices) {
      const idx = parseInt(idxStr) - 1;
      if (idx >= 0 && idx < displayTasks.length) {
        const realId = displayTasks[idx].id;
        const changes = await db.markTaskDone(targetGroup.chat_id, realId, todayStr);
        if (changes > 0) successIndices.push(idxStr);
        else failedIndices.push(idxStr);
      } else {
        failedIndices.push(idxStr);
      }
    }

    if (successIndices.length > 0) {
      let successText = successIndices.map(t => `👉 <i>${t}</i>`).join('\n');
      ctx.reply(`✅ Đã gạch xong việc cho Nhóm [${targetGroup.title}]:\n${successText}`, { parse_mode: 'HTML' });
    }
    if (failedIndices.length > 0) {
      ctx.reply(`❌ Không tìm thấy các việc mang số: ${failedIndices.join(', ')} trong Nhóm [${targetGroup.title}]`);
    }
  } catch (err) {
    ctx.reply('❌ Có lỗi xảy ra, không gạch việc được.');
  }
});

// Lệnh /testcal: Kiểm tra Lịch ngay lập tức
bot.command('testcal', async (ctx) => {
  const icalUrl = process.env.CALENDAR_ICAL_URL;
  if (!icalUrl) {
    return ctx.reply('Chưa có link Lịch trong file .env');
  }
  
  ctx.reply('Đang tải dữ liệu lịch Google từ link .ics...');
  const events = await calendar.getTodaysEvents(icalUrl);
  
  if (events.length === 0) {
    return ctx.reply('Không tìm thấy sự kiện nào trong ngày hôm nay trên Lịch của bạn.');
  }

  let msg = '🛠 <b>Kiểm tra dữ liệu sự kiện hôm nay:</b>\n\n';
  events.forEach(e => {
    const timeStr = e.start === 'Cả ngày' ? 'Cả ngày' : `${e.start} - ${e.end}`;
    msg += `📌 <b>Sự kiện:</b> ${e.summary}\n`;
    msg += `🕒 <b>Thời gian:</b> ${timeStr}\n`;
    msg += `📍 <b>Địa điểm:</b> ${e.location || 'Không có'}\n`;
    msg += `🔗 <b>Link:</b> ${e.url || 'Không có'}\n`;
    msg += `📝 <b>Mô tả:</b> ${e.description ? '\n' + e.description : 'Không có'}\n\n`;
  });

  try {
    await ctx.replyWithHTML(msg);
  } catch (err) {
    console.error('Lỗi khi gửi lịch:', err.message);
    // Fallback: Gửi tin nhắn không có định dạng HTML nếu bị lỗi parse HTML
    ctx.reply('🛠 Kiểm tra dữ liệu sự kiện hôm nay (Không định dạng do lỗi ký tự đặc biệt):\n\n' + msg.replace(/<[^>]*>?/gm, ''));
  }
});

// Lệnh /setall: Cài đặt danh sách tag cho Group
bot.command('setall', async (ctx) => {
  if (ctx.chat.type === 'private') {
    return ctx.reply('Lệnh này chỉ dùng được trong Group nha Sếp!');
  }
  
  const chatId = ctx.chat.id.toString();
  const rawInput = ctx.message.text.replace(/^\/setall(?:@[a-zA-Z0-9_]+)?\s*/i, '').trim();
  
  if (!rawInput) {
    return ctx.reply('Sếp nhập danh sách tag giúp Bót nha. VD: /setall @user1 @user2');
  }

  await db.setGroupTags(chatId, rawInput);
  ctx.reply(`✅ Đã ghi nhớ:\n${rawInput}`);
});

// Lệnh /viewall: Xem danh sách tag của Group
bot.command('viewall', async (ctx) => {
  if (ctx.chat.type === 'private') {
    return ctx.reply('Lệnh này chỉ dùng được trong Group nha Sếp!');
  }
  
  const chatId = ctx.chat.id.toString();
  const tags = await db.getGroupTags(chatId);
  
  if (!tags) {
    return ctx.reply('Group này chưa cài đặt danh sách @all nào hết á. Sếp dùng lệnh /setall để cài nha!');
  }
  
  ctx.reply(`📣 Danh sách gọi hồn hiện tại của Group là:\n${tags}`);
});

// Lệnh /say: Bắt Bót phát ngôn trong Group
bot.command('say', async (ctx) => {
  if (ctx.chat.type !== 'private') {
    return ctx.reply('Sếp ơi, lệnh này chỉ dùng được ở chat riêng để tránh "lộ bài" nha!');
  }
  
  const rawInput = ctx.message.text.replace(/^\/say(?:@[a-zA-Z0-9_]+)?\s*/i, '').trim();
  const match = rawInput.match(/^(\d+)\s+(.+)/s); // Bắt mã nhóm và nội dung (hỗ trợ xuống dòng)
  
  if (!match) {
    return ctx.reply('Sai cú pháp rồi Sếp ơi. Sếp gõ theo mẫu nhé: /say 1 Alo mọi người!');
  }
  
  const aliasId = parseInt(match[1]);
  const msgContent = match[2];
  
  try {
    const targetGroup = await db.getGroupById(aliasId);
    if (!targetGroup) {
      return ctx.reply(`❌ Ỏ, Bót hông tìm thấy Nhóm nào có mã số là ${aliasId} hết á. Sếp gõ /groups để kiểm tra lại nha.`);
    }
    
    await bot.telegram.sendMessage(targetGroup.chat_id, msgContent);
    ctx.reply(`✅ Bót đã ngoan ngoãn truyền đạt thánh chỉ của Sếp vào Nhóm [${targetGroup.title}] rồi nha!`);
  } catch (err) {
    console.error('Lỗi khi thực hiện lệnh /say:', err);
    ctx.reply('❌ Bót bị lỗi khi gửi tin nhắn vào nhóm. Sếp thử lại sau nha.');
  }
});

// Bắt từ khóa @all trong tin nhắn Group
bot.on('text', async (ctx, next) => {
  if (ctx.chat.type !== 'private' && ctx.message.text.includes('@all')) {
    const chatId = ctx.chat.id.toString();
    const tags = await db.getGroupTags(chatId);
    
    if (tags) {
      // Chỉ tag trần trụi đúng như ý Sếp
      await ctx.reply(tags);
    }
  }
  // Cho phép các middleware hoặc lệnh khác tiếp tục xử lý
  return next();
});

// --- LÊN LỊCH TỰ ĐỘNG (CRON JOBS) ---
const notifiedEvents = new Set(); // Lưu trữ các sự kiện đã báo

cron.schedule('* * * * *', async () => {
  const users = await db.getAllUsers();
  const groups = await db.getAllGroups();
  
  const icalUrl = process.env.CALENDAR_ICAL_URL;
  const events = icalUrl ? await calendar.getTodaysEvents(icalUrl) : [];
  
  const now = dayjs().tz('Asia/Ho_Chi_Minh');
  const currentHHMM = now.format('HH:mm');
  const dayOfWeek = now.day(); // 0 is Sun, 1 is Mon...

  // Xóa cache các sự kiện của ngày hôm qua để giải phóng bộ nhớ (Chỉ cần làm vào ban đêm để an toàn)
  if (currentHHMM === '01:00' || currentHHMM === '02:00') {
    notifiedEvents.clear();
  }

  // --- 1. KIỂM TRA BÁO CÁO KTC TỪ GOOGLE SHEETS (11:30 T2 - T6) ---
  if (currentHHMM === '11:30' && dayOfWeek !== 0 && dayOfWeek !== 6) {
    await checkKTCData(bot, db);
  }

  // --- 2. NHẮC NHỞ BẮT ĐẦU NGÀY MỚI (08:00) ---
  if (currentHHMM === '08:00' && users.length > 0) {
    let msg = '🌅 <b>Chào buổi sáng tốt lành! Chúc A/C một ngày làm việc siêu năng suất nhen 💕</b>\n\n';
    if (events.length > 0) {
      msg += '📅 <b>Lịch trình của A/C hôm nay nè:</b>\n';
      events.forEach(e => {
        const timeStr = e.start === 'Cả ngày' ? 'Cả ngày' : `${e.start} - ${e.end}`;
        msg += `- ${timeStr}: <b>${e.summary}</b>\n`;
        if (e.location) msg += `  📍 <b>Địa điểm:</b> ${e.location}\n`;
        if (e.url) msg += `  🔗 <b>Link:</b> ${e.url}\n`;
      });
    } else {
      msg += '📅 Hôm nay A/C hông có lịch họp nào hết á.\n';
    }

    for (const chatId of users) {
      await bot.telegram.sendMessage(chatId, msg, { parse_mode: 'HTML' }).catch(console.error);
      let pendingTasks = await db.getPendingTasks(chatId);
      
      const todayStr = now.format('YYYY-MM-DD');
      pendingTasks = pendingTasks.filter(t => {
        if (t.recurrence && t.recurrence.length > 0) {
        }
        return true;
      });

      if (pendingTasks.length > 0) {
        let taskMsg = '📋 <b>Các việc Khuii cần hoàn thành hôm nay nè:</b>\n\n';
        pendingTasks.forEach((t, idx) => {
          const timeStr = t.reminder_time ? ` (⏰ ${t.reminder_time})` : '';
          const recIcon = (t.recurrence && t.recurrence.length > 0) ? ` 🔁 ${getRecurrenceString(t.recurrence)}` : '';
          taskMsg += `<b>${idx + 1}.</b> ${t.task}${timeStr}${recIcon}\n`;
        });
        await bot.telegram.sendMessage(chatId, taskMsg, { parse_mode: 'HTML' }).catch(console.error);
      }
    }
  }

  // --- 2. BÁO CÁO GROUP ĐÃ BỊ XÓA (Sếp Khuii muốn tự thiết lập giờ) ---

  // --- 3. NHẮC NHỞ CUỐI NGÀY (17:30) ---
  if (currentHHMM === '17:30' && users.length > 0) {
    users.forEach(chatId => {
      bot.telegram.sendMessage(chatId, '🌇 Đã 5h30 chiều gòi! Mọi người nhớ check lại việc trong ngày rồi gõ /done nhen. Chuẩn bị nghỉ ngơi thuii 💖').catch(console.error);
    });
  }

  // --- 4. NHẮC LÊN LỊCH NGÀY MAI (22:00) ---
  if (currentHHMM === '22:00' && users.length > 0) {
    users.forEach(chatId => {
      bot.telegram.sendMessage(chatId, '🌙 Tới 10h tối gòi nè! Khuii nhớ take note lại các lịch trình và việc cần làm cho ngày mai nha. Chúc Khuii ngủ ngon hihi 💖').catch(console.error);
    });
  }

  // --- 5. NHẮC SỰ KIỆN SÁT GIỜ (MỖI PHÚT) ---
  if (users.length > 0 && events.length > 0) {
    events.forEach(e => {
      if (e.start === 'Cả ngày') return;
      const [hours, minutes] = e.start.split(':');
      const eventTime = now.clone().hour(parseInt(hours)).minute(parseInt(minutes)).second(0).millisecond(0);
      const diffMinutes = eventTime.diff(now.second(0).millisecond(0), 'minute');
      
      // Khóa eventKey phải bao gồm ngày hiện tại để tránh lỗi trùng lặp khi lịch lặp lại vào ngày khác
      const eventDate = now.format('YYYY-MM-DD');
      const eventKey = `${eventDate}-${e.summary}-${e.start}`;

      if (diffMinutes <= 15 && diffMinutes >= 0 && !notifiedEvents.has(eventKey)) {
        notifiedEvents.add(eventKey);
        let msg = `⏰ <b>Chuẩn bị họp/sự kiện thuii (${diffMinutes} phút nữa nha)!</b>\n\n📌 <b>Sự kiện:</b> ${e.summary}\n🕒 <b>Thời gian:</b> ${e.start} - ${e.end}\n`;
        if (e.location) msg += `📍 <b>Địa điểm:</b> ${e.location}\n`;
        if (e.url) msg += `🔗 <b>Link:</b> ${e.url}\n`;
        if (e.description) msg += `📝 <b>Mô tả:</b>\n${e.description}`;

        users.forEach(chatId => {
          bot.telegram.sendMessage(chatId, msg, { parse_mode: 'HTML' }).catch(console.error);
        });
      }
    });
  }

  // --- 6. NHẮC TASK THEO GIỜ HẸN (MỖI PHÚT) ---
  try {
    let tasks = await db.getTasksByReminderTime(currentHHMM);
    if (tasks.length > 0) {
      const todayStr = now.format('YYYY-MM-DD');
      const currentDayOfWeek = now.day();
      
      // Lọc các task hợp lệ trong ngày hôm nay
      tasks = tasks.filter(t => {
        if (t.recurrence && t.recurrence.length > 0) {
          if (!t.recurrence.includes(currentDayOfWeek)) return false;
        }
        return true;
      });

      if (tasks.length === 0) return;

      const tasksByChat = {};
      tasks.forEach(t => {
        if (!tasksByChat[t.chat_id]) tasksByChat[t.chat_id] = [];
        tasksByChat[t.chat_id].push(t);
      });

      for (const chatId in tasksByChat) {
        let msg = `🔔 <b>Reng reng (${currentHHMM})</b>\n`;
        let hasAllTag = false;
        tasksByChat[chatId].forEach(t => {
          if (t.task.toLowerCase().includes('@all')) {
            hasAllTag = true;
          }
          msg += `${t.task}\n`;
        });
        
        // Nhắc tag tất cả mọi người nếu là group và có chữ @all
        if (chatId.toString().startsWith('-')) {
          if (hasAllTag) {
            const groupTags = await db.getGroupTags(chatId);
            if (groupTags) {
              msg = msg.replace(/@all/gi, groupTags);
            }
          }
        } else {
          msg += `\nĐừng quên gõ <code>/done &lt;số&gt;</code> khi làm xong nhen!`;
        }
        
        bot.telegram.sendMessage(chatId, msg, { parse_mode: 'HTML' }).catch(console.error);
      }
    }
  } catch (err) {
    console.error('Lỗi cron nhắc task:', err);
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

// --- BẢNG ĐIỀU KHIỂN HỆ THỐNG (DASHBOARD) ---
bot.command('config', async (ctx) => {
  let msg = `🛠 <b>BẢNG ĐIỀU KHIỂN HỆ THỐNG:</b>\n\n`;

  // 1. KTC Report
  const ktcTarget = await db.getSetting('ktc_target_group_alias') || process.env.KTC_REPORT_GROUP_ALIAS;
  const ktcTags = await db.getSetting('ktc_tags') || {
    'DT': '@DatPham_2033074',
    'DX': '@DatPham_2033074',
    'HY': '@thuychu_14',
    'XA': '@PhatDao_HRBP',
    'M12': '@ThuHa_HRBP'
  };

  msg += `<b>1. MÔ-ĐUN: BÁO CÁO COST/WEIGHT KTC</b>\n`;
  msg += `- Lịch chạy: 11h30 trưa mỗi ngày\n`;
  msg += `- Nơi nhận báo cáo: Nhóm ${ktcTarget}\n`;
  msg += `👉 Đổi nhóm: Gõ <code>/setreport cost/weightktc &lt;Mã_Nhóm&gt;</code>\n\n`;
  msg += `- Danh sách Quản lý:\n`;
  for (const [kho, tag] of Object.entries(ktcTags)) {
    msg += `  + Kho ${kho}: ${tag}\n`;
  }
  msg += `👉 Đổi quản lý: Gõ <code>/setmanager cost/weightktc &lt;Mã_Kho&gt; &lt;@Tag&gt;</code>\n\n`;

  // 2. Checklist
  msg += `<b>2. MÔ-ĐUN: NHẮC VIỆC (CHECKLIST)</b>\n`;
  msg += `- 👉 Xem các nhóm đang theo dõi: Gõ /groups\n`;

  ctx.reply(msg, { parse_mode: 'HTML' });
});

bot.command('setreport', async (ctx) => {
  const parts = ctx.message.text.trim().split(/\s+/);
  if (parts.length < 3) {
    return ctx.reply('Sai cú pháp! Vui lòng dùng: /setreport <tên_mô_đun> <Mã_Nhóm>\nVí dụ: /setreport cost/weightktc 3');
  }
  const moduleName = parts[1].toLowerCase();
  const aliasId = parseInt(parts[2]);

  if (isNaN(aliasId)) return ctx.reply('Mã Nhóm phải là 1 con số.');

  if (moduleName === 'cost/weightktc') {
    await db.setSetting('ktc_target_group_alias', aliasId);
    ctx.reply(`✅ Đã đổi nơi nhận Báo cáo KTC sang Nhóm ${aliasId} thành công!`);
  } else {
    ctx.reply(`❌ Hiện tại Bót chưa hỗ trợ mô-đun: ${moduleName}`);
  }
});

bot.command('setmanager', async (ctx) => {
  const parts = ctx.message.text.trim().split(/\s+/);
  if (parts.length < 4) {
    return ctx.reply('Sai cú pháp! Vui lòng dùng: /setmanager <tên_mô_đun> <Mã_Kho> <@Tag>\nVí dụ: /setmanager cost/weightktc HY @nguoi_moi');
  }
  const moduleName = parts[1].toLowerCase();
  const khoName = parts[2].toUpperCase();
  const tag = parts.slice(3).join(' ');

  if (moduleName === 'cost/weightktc') {
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
    
    ktcTags[khoName] = tag;
    await db.setSetting('ktc_tags', ktcTags);
    ctx.reply(`✅ Đã cập nhật Quản lý Kho ${khoName} thành ${tag} thành công!`);
  } else {
    ctx.reply(`❌ Hiện tại Bót chưa hỗ trợ mô-đun: ${moduleName}`);
  }
});

  // Thiết lập Menu Lệnh (Gõ / sẽ hiện ra)
  bot.telegram.setMyCommands([
    { command: 'add', description: 'Thêm việc mới cho Khuii' },
    { command: 'list', description: 'Xem các việc chưa làm' },
    { command: 'done', description: 'Đánh dấu xong việc (VD: /done 1,2)' },
    { command: 'groups', description: 'Xem mã số các Nhóm' },
    { command: 'addto', description: 'Giao việc cho Nhóm (VD: /addto 1 Giờ Việc)' },
    { command: 'listto', description: 'Xem việc của Nhóm (VD: /listto 1)' },
    { command: 'doneto', description: 'Gạch việc của Nhóm (VD: /doneto 1 1,2)' },
    { command: 'report', description: 'Ép gửi Checklist vào Nhóm (VD: /report 1)' },
    { command: 'setall', description: 'Cài đặt tag @all cho Nhóm' },
    { command: 'viewall', description: 'Xem danh sách tag @all của Nhóm' },
    { command: 'say', description: 'Bắt Bót nói trong Nhóm (VD: /say 1 Chào mn)' },
    { command: 'config', description: 'Bảng Điều Khiển Hệ Thống' },
    { command: 'testcal', description: 'Kiểm tra dữ liệu Lịch Google' },
    { command: 'myid', description: 'Xem Telegram ID của Khuii' }
  ]);

  // --- TRÍ TUỆ NHÂN TẠO (AI) ---
  const globalChatHistory = {};

  bot.on('message', async (ctx) => {
    if (!ctx.message.text && !ctx.message.photo) return; // Chỉ xử lý chữ hoặc ảnh

    let text = ctx.message.text || ctx.message.caption || '';
    const chatId = ctx.chat.id.toString();
    const userName = ctx.from.first_name || 'User';

    // Bỏ qua nếu là câu lệnh
    if (text.startsWith('/')) return;

    if (!globalChatHistory[chatId]) {
      globalChatHistory[chatId] = [];
    }
    
    // Tải ảnh xuống nếu có
    let imageBuffer = null;
    let mimeType = null;
    if (ctx.message.photo && ctx.message.photo.length > 0) {
      try {
        const photo = ctx.message.photo[ctx.message.photo.length - 1]; // Độ phân giải cao nhất
        const fileLink = await ctx.telegram.getFileLink(photo.file_id);
        const https = require('https');
        imageBuffer = await new Promise((resolve, reject) => {
          https.get(fileLink.href, (res) => {
            const data = [];
            res.on('data', (chunk) => data.push(chunk));
            res.on('end', () => resolve(Buffer.concat(data)));
          }).on('error', reject);
        });
        mimeType = 'image/jpeg';
        if (!text) text = "Hãy phân tích hình ảnh này chi tiết.";
      } catch (err) {
        console.error("Lỗi tải ảnh từ Telegram:", err);
      }
    }

    // Lưu tin nhắn vào lịch sử (tối đa 15 tin nhắn)
    globalChatHistory[chatId].push(`[${userName}]: ${text} ${imageBuffer ? '(Kèm hình ảnh)' : ''}`);
    if (globalChatHistory[chatId].length > 15) {
      globalChatHistory[chatId].shift();
    }

    const isPrivate = ctx.chat.type === 'private';
    const isReplyToBot = ctx.message.reply_to_message && ctx.message.reply_to_message.from && ctx.message.reply_to_message.from.id === ctx.botInfo.id;
    const botUsername = ctx.botInfo.username.toLowerCase();
    const isMentioningBot = text.toLowerCase().includes(`@${botUsername}`);

    // Chỉ phản hồi nếu: chat riêng, hoặc bị tag, hoặc bị reply trong group
    if (isPrivate || isReplyToBot || isMentioningBot) {
      // Dùng regex để replace không phân biệt hoa thường
      const cleanQuestion = text.replace(new RegExp(`@${botUsername}`, 'gi'), '').trim();
      if (cleanQuestion === '' && !imageBuffer) return; // Chỉ tag tên mà ko nói gì và ko có ảnh

      ctx.sendChatAction('typing');

      // Thu thập Dữ liệu (Context)
      let contextData = '';
      try {
        // 1. Thêm công việc chưa làm (Bảo mật: Nhóm nào chỉ biết việc nhóm đó, Chat riêng thì biết hết)
        if (isPrivate) {
          const allPendingTasks = await db.getAllPendingTasksGlobally();
          if (allPendingTasks && allPendingTasks.length > 0) {
            contextData += `Danh sách TẤT CẢ công việc chưa làm trên Toàn Hệ Thống:\n`;
            allPendingTasks.forEach((t, i) => {
              contextData += `${i + 1}. [Nhóm ${t.chat_id}] ${t.task} ${t.reminder_time ? '(Giờ nhắc: ' + t.reminder_time + ')' : ''}\n`;
            });
            contextData += `\n`;
          } else {
            contextData += `Hệ thống hiện tại không có công việc nào tồn đọng.\n\n`;
          }
        } else {
          const groupPendingTasks = await db.getPendingTasks(ctx.chat.id.toString());
          if (groupPendingTasks && groupPendingTasks.length > 0) {
            contextData += `Danh sách công việc chưa làm CỦA NHÓM NÀY:\n`;
            groupPendingTasks.forEach((t, i) => {
              contextData += `${i + 1}. ${t.task} ${t.reminder_time ? '(Giờ nhắc: ' + t.reminder_time + ')' : ''}\n`;
            });
            contextData += `\n`;
          } else {
            contextData += `Nhóm này hiện tại không có công việc nào tồn đọng.\n\n`;
          }
        }

        // 2. TỐI ƯU TỐC ĐỘ: Chỉ gọi Google Sheets (chạy rất chậm) nếu câu hỏi có nhắc tới KTC, cost, weight, báo cáo, kho
        const lowerQ = cleanQuestion.toLowerCase();
        const needsKTC = lowerQ.includes('cost') || lowerQ.includes('weight') || lowerQ.includes('ktc') || lowerQ.includes('báo cáo') || lowerQ.includes('kho') || lowerQ.includes('điền');
        
        if (needsKTC) {
          const ktcReportText = await checkKTCData(bot, db, null, true);
          if (ktcReportText) {
            contextData += `--- BÁO CÁO KTC ---\n${ktcReportText}\n`;
          }
        }

        // 3. Inject Conversation History
        if (globalChatHistory[chatId] && globalChatHistory[chatId].length > 0) {
          contextData += `\n--- MẠCH CÂU CHUYỆN GẦN ĐÂY NHẤT (Ngữ cảnh) ---\n`;
          contextData += globalChatHistory[chatId].join('\n');
          contextData += `\n---------------------------------------------\n`;
        }
      } catch (e) {
        console.error('Lỗi lấy context cho AI:', e);
      }

      // Chạy AI ngầm (không dùng await) để tránh lỗi Timeout 90s của Telegraf
      ai.askAI(cleanQuestion, contextData, bot, db, ctx, imageBuffer, mimeType)
        .then(answer => {
          // Lưu câu trả lời của Bót vào lịch sử
          globalChatHistory[chatId].push(`[Bé Bót]: ${answer}`);
          if (globalChatHistory[chatId].length > 15) {
            globalChatHistory[chatId].shift();
          }
          
          let formattedAnswer = answer
            .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
            .replace(/^###\s+(.*)$/gm, '<b>$1</b>')
            .replace(/^##\s+(.*)$/gm, '<b>$1</b>');

          ctx.reply(formattedAnswer, { reply_to_message_id: ctx.message.message_id, parse_mode: 'HTML' })
            .catch(err => {
              console.error('Lỗi gửi định dạng HTML, gửi lại raw text:', err);
              ctx.reply(answer, { reply_to_message_id: ctx.message.message_id }).catch(console.error);
            });
        })
        .catch(err => {
          console.error('Lỗi Gemini AI:', err);
          ctx.reply('Dạ nãy giờ đường truyền lên não Gemini bị kẹt mạng, Sếp hỏi lại giúp em nha!', { reply_to_message_id: ctx.message.message_id }).catch(console.error);
        });
    }
  });

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
