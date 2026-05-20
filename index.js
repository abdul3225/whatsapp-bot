const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys')
const Groq = require('groq-sdk')
const pino = require('pino')
const readline = require('readline')

const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
const question = (text) => new Promise(resolve => rl.question(text, resolve))

// ===== بياخد المتغيرات من Railway تلقائي =====
const MY_NUMBER = process.env.MY_NUMBER
const GROQ_API_KEY = process.env.GROQ_API_KEY

const IGNORED_JIDS = [
    '13135550002@s.whatsapp.net',
    '13135550003@s.whatsapp.net',
]

const groq = new Groq({ apiKey: GROQ_API_KEY })

const conversations = {}

async function askAI(userJid, userMessage) {
    if (!conversations[userJid]) {
        conversations[userJid] = []
    }

    conversations[userJid].push({
        role: 'user',
        content: userMessage
    })

    if (conversations[userJid].length > 20) {
        conversations[userJid] = conversations[userJid].slice(-20)
    }

    try {
        const response = await groq.chat.completions.create({
            model: 'llama-3.3-70b-versatile',
            max_tokens: 500,
            messages: [
                {
                    role: 'system',
                    content: `أنت بوت واتساب ذكي وودود اسمك بوتي.
بتتكلم عربي مصري بشكل طبيعي ومحترم.
ردودك قصيرة ومختصرة ومناسبة لواتساب.
لو حد سلم عليك رد بالسلام.
لو حد قال صباح الخير رد بصباح النور.
لو حد سأل سؤال جاوبه بشكل مختصر ومفيد.
متستخدمش نجوم أو رموز تنسيق في ردودك.`
                },
                ...conversations[userJid]
            ]
        })

        const aiReply = response.choices[0].message.content

        conversations[userJid].push({
            role: 'assistant',
            content: aiReply
        })

        return aiReply

    } catch (err) {
        console.log('خطأ في Groq:', err.message)
        return 'معلش حصل خطأ، جرب تاني'
    }
}

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info')

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        generateHighQualityLinkPreview: false,
        syncFullHistory: false,
        markOnlineOnConnect: true,
        connectTimeoutMs: 10000,
        keepAliveIntervalMs: 5000,
        retryRequestDelayMs: 100,
    })

    if (!sock.authState.creds.registered) {
        const number = await question('اكتب رقمك مع كود الدولة (مثال: 201012345678): ')
        const cleanNumber = number.replace(/[^0-9]/g, '')
        const code = await sock.requestPairingCode(cleanNumber)
        console.log(`الكود هو: ${code}`)
        console.log('افتح واتساب ← الأجهزة المرتبطة ← ربط بكود ← اكتب الكود\n')
    }

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut
            console.log('الاتصال اتقطع')
            if (shouldReconnect) {
                console.log('بيتصل تاني...')
                startBot()
            }
        }
        if (connection === 'open') {
            console.log('البوت + Groq AI شغالين!')
            rl.close()
        }
    })

    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('messages.upsert', async ({ messages, type }) => {

        if (type !== 'notify') return

        const msg = messages[0]
        if (!msg?.message) return

        if (msg.message?.protocolMessage) return
        if (msg.message?.senderKeyDistributionMessage) return
        if (msg.message?.reactionMessage) return

        const from = msg.key.remoteJid

        if (from?.endsWith('@g.us')) return
        if (IGNORED_JIDS.includes(from)) return
        if (msg.key.fromMe && from !== MY_NUMBER) return

        const text = (
            msg.message?.conversation ||
            msg.message?.extendedTextMessage?.text ||
            msg.message?.imageMessage?.caption ||
            ''
        ).trim()

        if (!text) return

        console.log(`من: ${from} | النص: ${text}`)

        const reply = async (message) => {
            try {
                await sock.sendMessage(from, { text: message }, { quoted: msg })
            } catch (err) {
                console.log('خطأ في الإرسال:', err)
            }
        }

        try {
            console.log('AI بيفكر...')
            const aiReply = await askAI(from, text)
            console.log(`رد AI: ${aiReply}`)
            await reply(aiReply)
        } catch (err) {
            console.log('خطأ:', err)
            await reply('معلش حصل خطأ، جرب تاني')
        }
    })
}

startBot()
