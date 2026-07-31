import express from 'express';
import fs from 'fs-extra';
import pino from 'pino';
import QRCode from 'qrcode';
import {
    makeWASocket, useMultiFileAuthState, makeCacheableSignalKeyStore,
    Browsers, jidNormalizedUser, fetchLatestBaileysVersion, delay, DisconnectReason
} from '@whiskeysockets/baileys';
import { upload as megaUpload } from './mega.js';

const router = express.Router();
const MAX_RECONNECT_ATTEMPTS = 3;
const SESSION_TIMEOUT = 60000;

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
    } catch (e) {
        console.error('Error removing file:', e);
        return false;
    }
}

function randomMegaId(len = 6, numLen = 4) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let out = '';
    for (let i = 0; i < len; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
    return `${out}${Math.floor(Math.random() * Math.pow(10, numLen))}`;
}

router.get('/', async (req, res) => {
    // ── BENZO-MD SESSION PREFIX ──
    const sessionId = 'benzo~' + Date.now().toString() + Math.random().toString(36).substring(2, 9);
    const dirs = `./qr_sessions/session_${sessionId}`;
    if (!fs.existsSync('./qr_sessions')) await fs.mkdir('./qr_sessions', { recursive: true });

    let qrGenerated = false;
    let sessionCompleted = false;
    let responseSent = false;
    let reconnectAttempts = 0;
    let currentSocket = null;
    let timeoutHandle = null;
    let isCleaningUp = false;

    // ── JOKE ──
    const joke = getRandomJoke();
    console.log(`😂 BENZO-MD Joke: ${joke}`);

    async function cleanup(reason = 'unknown') {
        if (isCleaningUp) return;
        isCleaningUp = true;

        console.log(`🧹 Cleaning up session ${sessionId} - Reason: ${reason}`);

        if (timeoutHandle) {
            clearTimeout(timeoutHandle);
            timeoutHandle = null;
        }

        if (currentSocket) {
            try {
                currentSocket.ev.removeAllListeners();
                await currentSocket.end();
            } catch (e) {
                console.error('Error closing socket:', e);
            }
            currentSocket = null;
        }

        setTimeout(async () => {
            await removeFile(dirs);
        }, 5000);
    }

    async function initiateSession() {
        if (sessionCompleted || isCleaningUp) {
            console.log('⚠️ Session already completed or cleaning up');
            return;
        }

        if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
            console.log('❌ Max reconnection attempts reached');
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

        if (!fs.existsSync(dirs)) await fs.mkdir(dirs, { recursive: true });
        const { state, saveCreds } = await useMultiFileAuthState(dirs);

        try {
            const { version } = await fetchLatestBaileysVersion();

            if (currentSocket) {
                try {
                    currentSocket.ev.removeAllListeners();
                    await currentSocket.end();
                } catch (e) {}
            }

            currentSocket = makeWASocket({
                version,
                logger: pino({ level: 'silent' }),
                browser: Browsers.macOS('Chrome'),
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
                },
                printQRInTerminal: false,
                markOnlineOnConnect: false,
                generateHighQualityLinkPreview: false,
                defaultQueryTimeoutMs: 60000,
                connectTimeoutMs: 60000,
                keepAliveIntervalMs: 30000,
                retryRequestDelayMs: 250,
                maxRetries: 3,
            });

            const sock = currentSocket;

            const handleQRCode = async (qr) => {
                if (qrGenerated || responseSent || sessionCompleted || isCleaningUp) return;
                qrGenerated = true;

                try {
                    const qrDataURL = await QRCode.toDataURL(qr, { errorCorrectionLevel: 'M' });
                    if (!responseSent && !res.headersSent) {
                        responseSent = true;
                        res.send({
                            qr: qrDataURL,
                            message: '🔥 BENZO-MD QR Code Generated! Scan with WhatsApp app.',
                            joke: getRandomJoke(),
                            channel: CHANNEL_LINK,
                            fork: FORK_LINK,
                            repo: REPO_LINK,
                            instructions: [
                                '1. Open WhatsApp on your phone',
                                '2. Go to Settings > Linked Devices',
                                '3. Tap "Link a Device"',
                                '4. Scan the QR code above',
                                `5. ${getRandomJoke()}`
                            ]
                        });
                        console.log('📱 QR Code sent to client');
                    }
                } catch (err) {
                    console.error('Error generating QR code:', err);
                    if (!responseSent && !res.headersSent) {
                        responseSent = true;
                        res.status(500).send({ 
                            code: 'Failed to generate QR code',
                            joke: getRandomJoke(),
                            channel: CHANNEL_LINK
                        });
                    }
                    await cleanup('qr_error');
                }
            };

            sock.ev.on('connection.update', async (update) => {
                if (isCleaningUp) return;

                const { connection, lastDisconnect, qr, isNewLogin } = update;

                if (qr && !qrGenerated && !sessionCompleted) {
                    await handleQRCode(qr);
                }

                if (connection === 'open') {
                    if (sessionCompleted) return;
                    sessionCompleted = true;

                    try {
                        const credsFile = `${dirs}/creds.json`;
                        if (fs.existsSync(credsFile)) {
                            console.log('📄 Uploading creds.json to MEGA...');
                            const id = randomMegaId();
                            const megaLink = await megaUpload(await fs.readFile(credsFile), `${id}.json`);
                            const megaSessionId = megaLink.replace('https://mega.nz/file/', '');
                            console.log('✅ Session uploaded to MEGA, ID:', megaSessionId);

                            // ── BENZO-MD SESSION PREFIX ──
                            const prefixedSessionId = `benzo~${megaSessionId}`;

                            const userJid = Object.keys(sock.authState.creds.me || {}).length > 0
                                ? jidNormalizedUser(sock.authState.creds.me.id)
                                : null;

                            if (userJid) {
                                const msg = await sock.sendMessage(userJid, { 
                                    text: `🔥 *BENZO-MD SESSION*\n\n✦ *Session ID:* ${prefixedSessionId}\n\n${getRandomJoke()}\n\n📢 *Channel:* ${CHANNEL_LINK}\n🍴 *Fork:* ${FORK_LINK}\n⭐ *Repo:* ${REPO_LINK}` 
                                });
                                await sock.sendMessage(userJid, { 
                                    text: `💀 ${getRandomJoke()}`,
                                    quoted: msg 
                                });
                            }

                            await delay(1000);
                        }
                    } catch (err) {
                        console.error('Error sending session:', err);
                    } finally {
                        await cleanup('session_complete');
                    }
                }

                if (isNewLogin) console.log('🔐 New login via QR code');

                if (connection === 'close') {
                    if (sessionCompleted || isCleaningUp) {
                        console.log('✅ Session completed, not reconnecting');
                        await cleanup('already_complete');
                        return;
                    }

                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    const reason = lastDisconnect?.error?.output?.payload?.error;

                    console.log(`❌ Connection closed - Status: ${statusCode}, Reason: ${reason}`);

                    if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                        console.log('❌ Logged out or invalid session');
                        if (!responseSent && !res.headersSent) {
                            responseSent = true;
                            res.status(401).send({ 
                                code: 'Invalid QR scan or session expired',
                                joke: getRandomJoke(),
                                channel: CHANNEL_LINK
                            });
                        }
                        await cleanup('logged_out');
                    } else if (qrGenerated && !sessionCompleted) {
                        reconnectAttempts++;
                        console.log(`🔁 Reconnection attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}`);
                        await delay(2000);
                        await initiateSession();
                    } else {
                        await cleanup('connection_closed');
                    }
                }
            });

            sock.ev.on('creds.update', saveCreds);

            timeoutHandle = setTimeout(async () => {
                if (!sessionCompleted && !isCleaningUp) {
                    console.log('⏰ QR generation timeout');
                    if (!responseSent && !res.headersSent) {
                        responseSent = true;
                        res.status(408).send({ 
                            code: 'QR generation timeout',
                            joke: getRandomJoke(),
                            channel: CHANNEL_LINK,
                            fork: FORK_LINK
                        });
                    }
                    await cleanup('timeout');
                }
            }, SESSION_TIMEOUT);

        } catch (err) {
            console.error('❌ Error initializing session:', err);
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
        if (!fs.existsSync('./qr_sessions')) return;
        const sessions = await fs.readdir('./qr_sessions');
        const now = Date.now();
        for (const session of sessions) {
            const sessionPath = `./qr_sessions/${session}`;
            try {
                const stats = await fs.stat(sessionPath);
                if (now - stats.mtimeMs > 300000) {
                    console.log(`🗑️ Removing old session: ${session}`);
                    await fs.remove(sessionPath);
                }
            } catch (e) {}
        }
    } catch (e) {
        console.error('Error in cleanup interval:', e);
    }
}, 60000);

process.on('uncaughtException', (err) => {
    const e = String(err);
    const ignore = [
        "conflict", "not-authorized", "Socket connection timeout",
        "rate-overlimit", "Connection Closed", "Timed Out",
        "Value not found", "Stream Errored", "Stream Errored (restart required)",
        "statusCode: 515", "statusCode: 503"
    ];
    if (!ignore.some(x => e.includes(x))) {
        console.log('Caught exception:', err);
    }
});

export default router;