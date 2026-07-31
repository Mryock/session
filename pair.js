import express from 'express';
import fs from 'fs-extra';
import pino from 'pino';
import pn from 'awesome-phonenumber';
import {
    makeWASocket, useMultiFileAuthState, delay,
    makeCacheableSignalKeyStore, Browsers, jidNormalizedUser,
    fetchLatestBaileysVersion, DisconnectReason
} from '@whiskeysockets/baileys';
import { upload as megaUpload } from './mega.js';

const router = express.Router();
const MAX_RECONNECT_ATTEMPTS = 3;
const SESSION_TIMEOUT = 5 * 60 * 1000;
const CLEANUP_DELAY = 5000;

// ── BENZO-MD JOKES ──
const JOKES = [
    "U want my code? Am sorry hahaha 😂",
    "Why did the developer go broke? Because he lost his cache! 💀",
    "What do you call a bot that doesn't work? A 'whatsapp-not' bot! 😂",
    "Why do programmers prefer dark mode? Because light attracts bugs! 🐛",
    "My code works... I have no idea why! 🤡",
    "Why did the QR code break up with the scanner? It found someone more attractive! 💔",
    "How many developers does it take to fix a bug? None... it's a feature! ✨",
    "Why do bots hate Mondays? Too many unread messages! 📱",
    "My code is like my life... full of errors! 💀",
    "Why did the session expire? It needed a break from all the requests! 😂",
    "What's a bot's favorite game? Hide and seek... because nobody finds the bugs! 🎮",
    "Why don't bots tell secrets? They always leak! 🔓",
];

function getRandomJoke() {
    return JOKES[Math.floor(Math.random() * JOKES.length)];
}

// ── BENZO-MD INFO ──
const CHANNEL_LINK = "https://whatsapp.com/channel/0029VbBaJvI7IUYbtCeaPh0I";
const FORK_LINK = "https://github.com/AmonTech1/BENZO-MD/fork";
const REPO_LINK = "https://github.com/AmonTech1/BENZO-MD";

// ── MESSAGES ──
const getRandomMessage = () => {
    const messages = [
        `🔥 BENZO-MD is alive! ${getRandomJoke()}`,
        `⚡ Powered by Amon! ${getRandomJoke()}`,
        `💀 Empty Folder Gang! ${getRandomJoke()}`,
        `🤡 You expected a serious message? ${getRandomJoke()}`,
        `✨ BENZO-MD - Made with chaos in Kenya! ${getRandomJoke()}`,
        `🎩 By order of the Empty Folder Gang! ${getRandomJoke()}`,
        `🔥 Fork me on GitHub: ${FORK_LINK}`,
        `📢 Join my channel: ${CHANNEL_LINK}`,
    ];
    return messages[Math.floor(Math.random() * messages.length)];
};

async function removeFile(FilePath) {
    try {
        if (!fs.existsSync(FilePath)) return false;
        await fs.remove(FilePath);
        return true;
    } catch (e) { console.error('Error removing file:', e); return false; }
}

function randomMegaId(len = 6, numLen = 4) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let out = '';
    for (let i = 0; i < len; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
    return `${out}${Math.floor(Math.random() * Math.pow(10, numLen))}`;
}

router.get('/', async (req, res) => {
    let num = req.query.number;
    if (!num) return res.status(400).send({ 
        code: 'Phone number is required',
        joke: getRandomJoke(),
        channel: CHANNEL_LINK,
        fork: FORK_LINK
    });

    num = num.replace(/[^0-9]/g, '');
    const phone = pn('+' + num);
    if (!phone.isValid()) return res.status(400).send({ 
        code: 'Invalid phone number.',
        joke: getRandomJoke(),
        channel: CHANNEL_LINK,
        fork: FORK_LINK
    });
    num = phone.getNumber('e164').replace('+', '');

    const sessionId = Date.now().toString() + Math.random().toString(36).substring(2, 9);
    const dirs = `./auth_info_baileys/session_${sessionId}`;

    let pairingCodeSent = false, sessionCompleted = false, isCleaningUp = false;
    let responseSent = false, reconnectAttempts = 0, currentSocket = null, timeoutHandle = null;

    console.log(`😂 BENZO-MD Joke for ${num}: ${getRandomJoke()}`);

    async function cleanup(reason = 'unknown') {
        if (isCleaningUp) return;
        isCleaningUp = true;
        console.log(`🧹 Cleanup ${sessionId} (${num}) - ${reason}`);
        if (timeoutHandle) { clearTimeout(timeoutHandle); timeoutHandle = null; }
        if (currentSocket) {
            try { currentSocket.ev.removeAllListeners(); await currentSocket.end(); } catch (e) {}
            currentSocket = null;
        }
        setTimeout(async () => { await removeFile(dirs); }, CLEANUP_DELAY);
    }

    async function initiateSession() {
        if (sessionCompleted || isCleaningUp) return;
        if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
            if (!responseSent && !res.headersSent) { 
                responseSent = true; 
                res.status(503).send({ 
                    code: 'Connection failed after multiple attempts',
                    joke: getRandomJoke(),
                    channel: CHANNEL_LINK,
                    fork: FORK_LINK,
                    repo: REPO_LINK
                }); 
            }
            await cleanup('max_reconnects'); 
            return;
        }
        try {
            if (!fs.existsSync(dirs)) await fs.mkdir(dirs, { recursive: true });
            const { state, saveCreds } = await useMultiFileAuthState(dirs);
            const { version } = await fetchLatestBaileysVersion();

            if (currentSocket) {
                try { currentSocket.ev.removeAllListeners(); await currentSocket.end(); } catch (e) {}
            }

            currentSocket = makeWASocket({
                version,
                auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })) },
                printQRInTerminal: false, logger: pino({ level: "silent" }),
                browser: Browsers.macOS('Chrome'), markOnlineOnConnect: false,
                generateHighQualityLinkPreview: false, defaultQueryTimeoutMs: 60000,
                connectTimeoutMs: 60000, keepAliveIntervalMs: 30000, retryRequestDelayMs: 250, maxRetries: 3,
            });

            const sock = currentSocket;

            sock.ev.on('connection.update', async (update) => {
                if (isCleaningUp) return;
                const { connection, lastDisconnect, isNewLogin } = update;

                if (connection === 'open') {
                    if (sessionCompleted) return;
                    sessionCompleted = true;
                    try {
                        const credsFile = `${dirs}/creds.json`;
                        if (fs.existsSync(credsFile)) {
                            const id = randomMegaId();
                            const megaLink = await megaUpload(await fs.readFile(credsFile), `${id}.json`);
                            const megaSessionId = megaLink.replace('https://mega.nz/file/', '');
                            const userJid = jidNormalizedUser(num + '@s.whatsapp.net');
                            
                            // ── BENZO-MD SESSION PREFIX ──
                            const prefixedSessionId = `benzo~${megaSessionId}`;
                            
                            const msg = await sock.sendMessage(userJid, { 
                                text: `🔥 *BENZO-MD SESSION*\n\n✦ *Session ID:* ${prefixedSessionId}\n\n${getRandomJoke()}\n\n📢 *Channel:* ${CHANNEL_LINK}\n🍴 *Fork:* ${FORK_LINK}\n⭐ *Repo:* ${REPO_LINK}` 
                            });
                            await sock.sendMessage(userJid, { 
                                text: `💀 ${getRandomJoke()}`,
                                quoted: msg 
                            });
                            await delay(1000);
                        }
                    } catch (err) { console.error('Error sending session:', err); }
                    finally { await cleanup('session_complete'); }
                }

                if (isNewLogin) console.log(`🔐 New login via pair code for ${num}`);

                if (connection === 'close') {
                    if (sessionCompleted || isCleaningUp) { await cleanup('already_complete'); return; }
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                        if (!responseSent && !res.headersSent) { 
                            responseSent = true; 
                            res.status(401).send({ 
                                code: 'Invalid pairing code or session expired',
                                joke: getRandomJoke(),
                                channel: CHANNEL_LINK,
                                fork: FORK_LINK
                            }); 
                        }
                        await cleanup('logged_out');
                    } else if (pairingCodeSent && !sessionCompleted) {
                        reconnectAttempts++;
                        await delay(2000); await initiateSession();
                    } else { await cleanup('connection_closed'); }
                }
            });

            if (!sock.authState.creds.registered && !pairingCodeSent && !isCleaningUp) {
                await delay(1500);
                try {
                    pairingCodeSent = true;
                    let code = await sock.requestPairingCode(num);
                    code = code?.match(/.{1,4}/g)?.join('-') || code;
                    if (!responseSent && !res.headersSent) { 
                        responseSent = true; 
                        res.send({ 
                            code,
                            joke: getRandomJoke(),
                            channel: CHANNEL_LINK,
                            fork: FORK_LINK,
                            repo: REPO_LINK,
                            message: `🔥 BENZO-MD Pairing Code Sent!`
                        }); 
                    }
                } catch (error) {
                    pairingCodeSent = false;
                    if (!responseSent && !res.headersSent) { 
                        responseSent = true; 
                        res.status(503).send({ 
                            code: 'Failed to get pairing code',
                            joke: getRandomJoke(),
                            channel: CHANNEL_LINK,
                            fork: FORK_LINK
                        }); 
                    }
                    await cleanup('pairing_code_error');
                }
            }

            sock.ev.on('creds.update', saveCreds);

            timeoutHandle = setTimeout(async () => {
                if (!sessionCompleted && !isCleaningUp) {
                    if (!responseSent && !res.headersSent) { 
                        responseSent = true; 
                        res.status(408).send({ 
                            code: 'Pairing timeout',
                            joke: getRandomJoke(),
                            channel: CHANNEL_LINK,
                            fork: FORK_LINK
                        }); 
                    }
                    await cleanup('timeout');
                }
            }, SESSION_TIMEOUT);

        } catch (err) {
            console.error(`❌ Error initializing session for ${num}:`, err);
            if (!responseSent && !res.headersSent) { 
                responseSent = true; 
                res.status(503).send({ 
                    code: 'Service Unavailable',
                    joke: getRandomJoke(),
                    channel: CHANNEL_LINK,
                    fork: FORK_LINK,
                    repo: REPO_LINK
                }); 
            }
            await cleanup('init_error');
        }
    }

    await initiateSession();
});

setInterval(async () => {
    try {
        const baseDir = './auth_info_baileys';
        if (!fs.existsSync(baseDir)) return;
        const sessions = await fs.readdir(baseDir);
        const now = Date.now();
        for (const session of sessions) {
            try {
                const stats = await fs.stat(`${baseDir}/${session}`);
                if (now - stats.mtimeMs > 10 * 60 * 1000) await fs.remove(`${baseDir}/${session}`);
            } catch (e) {}
        }
    } catch (e) { console.error('Error in cleanup interval:', e); }
}, 60000);

process.on('SIGTERM', async () => { try { await fs.remove('./auth_info_baileys'); } catch (e) {} process.exit(0); });
process.on('SIGINT', async () => { try { await fs.remove('./auth_info_baileys'); } catch (e) {} process.exit(0); });
process.on('uncaughtException', (err) => {
    const e = String(err);
    const ignore = ["conflict","not-authorized","Socket connection timeout","rate-overlimit","Connection Closed","Timed Out","Value not found","Stream Errored","Stream Errored (restart required)","statusCode: 515","statusCode: 503"];
    if (!ignore.some(x => e.includes(x))) console.log('Caught exception:', err);
});

export default router;