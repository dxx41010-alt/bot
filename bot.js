require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { ethers } = require('ethers');

const TOKEN = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const RPC_URL = process.env.RPC_URL || 'https://polygon-rpc.com';
const ADMIN_PRIVATE_KEY = process.env.ADMIN_PRIVATE_KEY;

if (!TOKEN || !ADMIN_CHAT_ID || !ADMIN_PRIVATE_KEY) {
    console.error("❌ خطأ: يرجى التأكد من تعبئة كافة المتغيرات في إعدادات المنصة");
    process.exit(1);
}

const provider = new ethers.JsonRpcProvider(RPC_URL);
const adminWallet = new ethers.Wallet(ADMIN_PRIVATE_KEY, provider);

const USDT_ADDRESS = '0xc2132d05d31c914a87c6611c10748aeb04b58e8f';
const ERC20_ABI = [
    "function transfer(address to, uint256 value) public returns (bool)",
    "function balanceOf(address owner) view returns (uint256)"
];
const usdtContract = new ethers.Contract(USDT_ADDRESS, ERC20_ABI, adminWallet);

const bot = new TelegramBot(TOKEN, { polling: true });
const pendingRequests = {};

console.log("🤖 بوت تلغرام يعمل الآن ويراقب الطلبات...");

bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const welcomeMessage = 
        "مرحباً بك في خدمة التحويل الفوري إلى العملات الرقمية.\n\n" +
        "لتقديم طلب إرسال USDT مقابل شام كاش، استخدم الأمر بالشكل التالي:\n" +
        "`/pay [المبلغ] [عنوان_المحفظة]`\n\n" +
        "مثال:\n`/pay 10 0xYourWalletAddressHere`";
    bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown' });
});

bot.onText(/\/pay (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const args = match[1].trim().split(/\s+/);

    if (args.length < 2) {
        return bot.sendMessage(chatId, "⚠️ صيغة غير صحيحة. استخدم الأمر هكذا:\n`/pay [المبلغ] [عنوان_المحفظة]`", { parse_mode: 'Markdown' });
    }

    const amountUSD = args[0];
    const userWallet = args[1];

    if (!ethers.isAddress(userWallet)) {
        return bot.sendMessage(chatId, "❌ عنوان المحفظة المدخل غير صالح.");
    }

    const requestId = Date.now().toString();
    pendingRequests[requestId] = { chatId, amountUSD, userWallet };

    const adminMsg = 
        `📥 **طلب إيداع وتحويل جديد!**\n\n` +
        `👤 المستخدم: ${msg.from.first_name} (ID: \`${chatId}\`)\n` +
        `💵 المبلغ: \`${amountUSD} USDT\`\n` +
        `📍 العنوان: \`${userWallet}\``;

    bot.sendMessage(ADMIN_CHAT_ID, adminMsg, {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [[
                { text: '✅ تأكيد وإرسال', callback_data: `approve_${requestId}` },
                { text: '❌ رفض', callback_data: `reject_${requestId}` }
            ]]
        }
    });

    bot.sendMessage(chatId, "✅ تم استلام طلبك بنجاح وتحويله للمراجعة.");
});

bot.on('callback_query', async (query) => {
    const action = query.data;
    const [type, requestId] = action.split('_');
    const reqData = pendingRequests[requestId];

    if (!reqData) {
        return bot.answerCallbackQuery(query.id, { text: "⚠️ الطلب غير موجود." });
    }

    if (type === 'approve') {
        bot.answerCallbackQuery(query.id, { text: "جاري التنفيذ..." });
        try {
            const amountToSend = ethers.parseUnits(reqData.amountUSD.toString(), 6);
            const tx = await usdtContract.transfer(reqData.userWallet, amountToSend);
            bot.sendMessage(ADMIN_CHAT_ID, `🔄 قيد المعالجة... Tx: \`${tx.hash}\``, { parse_mode: 'Markdown' });
            await tx.wait();
            bot.sendMessage(ADMIN_CHAT_ID, `✅ تم تأكيد وصول التحويل بنجاح!`);
            bot.sendMessage(reqData.chatId, `🎉 تم تأكيد طلبك وإرسال الرصيد!\n🔗 المعاملة: \`${tx.hash}\``, { parse_mode: 'Markdown' });
        } catch (error) {
            bot.sendMessage(ADMIN_CHAT_ID, `❌ خطأ في التحويل: \`${error.message}\``, { parse_mode: 'Markdown' });
            bot.sendMessage(reqData.chatId, "❌ حدث خطأ تقني أثناء محاولة تحويل العملات.");
        }
        delete pendingRequests[requestId];
    } else if (type === 'reject') {
        bot.answerCallbackQuery(query.id, { text: "تم رفض الطلب." });
        bot.sendMessage(ADMIN_CHAT_ID, `❌ تم رفض الطلب.`);
        bot.sendMessage(reqData.chatId, "عذراً، تم رفض طلبك من قبل الإدارة.");
        delete pendingRequests[requestId];
    }
});
