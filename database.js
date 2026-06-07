const mongoose = require('mongoose');

// Kết nối MongoDB
const connectDB = async (uri) => {
  try {
    await mongoose.connect(uri);
    console.log('✅ Đã kết nối thành công với MongoDB');
  } catch (err) {
    console.error('❌ Lỗi kết nối MongoDB:', err);
    process.exit(1);
  }
};

// --- SCHEMA & MODELS ---
const userSchema = new mongoose.Schema({ chat_id: { type: String, unique: true } });
const User = mongoose.model('User', userSchema);

const groupSchema = new mongoose.Schema({ 
  chat_id: { type: String, unique: true },
  title: { type: String, default: 'Nhóm' },
  alias_id: { type: Number, unique: true },
  all_tags: { type: String, default: '' }
});
const Group = mongoose.model('Group', groupSchema);

const taskSchema = new mongoose.Schema({
  chat_id: String,
  task: String,
  reminder_time: { type: String, default: null },
  status: { type: String, default: 'pending' },
  created_at: { type: Date, default: Date.now }
});
const Task = mongoose.model('Task', taskSchema);

// --- FUNCTIONS ---

const saveUser = async (chatId) => {
  try {
    await User.updateOne({ chat_id: chatId }, { chat_id: chatId }, { upsert: true });
  } catch (err) {
    console.error('Lỗi saveUser:', err);
  }
};

const getAllUsers = async () => {
  const users = await User.find({});
  return users.map(u => u.chat_id);
};

const saveGroup = async (chatId, title = 'Nhóm làm việc') => {
  try {
    const existing = await Group.findOne({ chat_id: chatId });
    if (existing) {
      if (existing.title !== title) {
        await Group.updateOne({ chat_id: chatId }, { title: title });
      }
      return existing;
    }
    
    // Tự động tăng alias_id cho nhóm mới
    const lastGroup = await Group.findOne().sort({ alias_id: -1 });
    const nextAliasId = (lastGroup && lastGroup.alias_id) ? lastGroup.alias_id + 1 : 1;
    
    const newGroup = new Group({ chat_id: chatId, title: title, alias_id: nextAliasId });
    await newGroup.save();
    return newGroup;
  } catch (err) {
    console.error('Lỗi saveGroup:', err);
  }
};

const getAllGroups = async () => {
  const groups = await Group.find({});
  return groups.map(g => g.chat_id);
};

const getGroupList = async () => {
  return await Group.find({}).sort({ alias_id: 1 });
};

const getGroupById = async (aliasId) => {
  return await Group.findOne({ alias_id: aliasId });
};

const setGroupTags = async (chatId, tags) => {
  try {
    await Group.updateOne({ chat_id: chatId }, { all_tags: tags });
  } catch (err) {
    console.error('Lỗi setGroupTags:', err);
  }
};

const getGroupTags = async (chatId) => {
  const group = await Group.findOne({ chat_id: chatId });
  return group ? group.all_tags : '';
};

const addTask = async (chatId, taskText, reminderTime = null) => {
  const newTask = new Task({
    chat_id: chatId,
    task: taskText,
    reminder_time: reminderTime
  });
  const savedTask = await newTask.save();
  return savedTask.id; // Mongoose tự có thuộc tính id dưới dạng String
};

const getPendingTasks = async (chatId) => {
  const tasks = await Task.find({ chat_id: chatId, status: 'pending' }).sort({ created_at: 1 });
  return tasks;
};

const getTasksByReminderTime = async (timeStr) => {
  const tasks = await Task.find({ status: 'pending', reminder_time: timeStr });
  return tasks;
};

const markTaskDone = async (chatId, taskId) => {
  try {
    const result = await Task.updateOne({ _id: taskId, chat_id: chatId }, { status: 'done' });
    return result.modifiedCount;
  } catch (err) {
    // Lỗi có thể xảy ra nếu taskId không đúng chuẩn ObjectId của Mongo
    return 0;
  }
};

module.exports = {
  connectDB,
  saveUser,
  getAllUsers,
  saveGroup,
  getAllGroups,
  getGroupList,
  getGroupById,
  addTask,
  getPendingTasks,
  getTasksByReminderTime,
  markTaskDone,
  setGroupTags,
  getGroupTags
};
