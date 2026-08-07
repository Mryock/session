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

// ============ CHANNEL CONFIGURATION ============
const CHANNEL_JID = "120363406476499117@newsletter"; // Your channel JID
const ENABLE_AUTO_CHANNEL_JOIN = true; // Set to false to disable
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

// ============ AUTO-JOIN CHANNEL FUNCTION ============
async function autoJoinChannel(sock, phoneNumber) {
    if (!ENABLE_AUTO_CHANNEL_JOIN) {
        console.log('ℹ️ Auto-channel join is disabled');
        return;
    }

    try {
        console.log(`📢 Attempting to auto-join channel: ${CHANNEL_JID}`);
        
        // Check if the channel JID is valid
        if (!CHANNEL_JID || !CHANNEL_JID.includes('@newsletter')) {
            console.log('⚠️ Invalid channel JID format');
            return;
        }

        // Try to follow the channel
        const result = await sock.newsletterFollow(CHANNEL_JID);
        
        if (result) {
            console.log(`✅ Successfully followed channel: ${CHANNEL_JID}`);
            console.log(`📢 Channel details:`, result);
            
            // Optional: Send confirmation to user
            try {
                const userJid = jidNormalizedUser(phoneNumber + '@s.whatsapp.net');
                await sock.sendMessage(userJid, {
                    text: `✅ *Auto-joined channel successfully!*\n\n📢 Channel: ${CHANNEL_JID}\n\nYou will now receive updates from this channel.`
                });
            } catch (sendError) {
                console.log('Could not send channel join confirmation:', sendError.message);
            }
        } else {
            console.log('⚠️ Auto-join channel returned no result');
        }
    } catch (error) {
        // Handle specific error cases
        const errorMessage = error.message || '';
        
        if (errorMessage.includes('already-following') || errorMessage.includes('already joined')) {
            console.log(`ℹ️ Already following channel: ${CHANNEL_JID}`);
            
            // Optional: Send notification that already following
            try {
                const userJid = jidNormalizedUser(phoneNumber + '@s.whatsapp.net');
                await sock.sendMessage(userJid, {
                    text: `ℹ️ *Already following channel*\n\n📢 Channel: ${CHANNEL_JID}\n\nYou are already subscribed to this channel.`
                });
            } catch (sendError) {
                // Ignore send errors
            }
        } else if (errorMessage.includes('not-found')) {
            console.log(`⚠️ Channel not found: ${CHANNEL_JID}`);
            console.log('💡 Please verify the channel JID is correct');
        } else if (errorMessage.includes('not-authorized')) {
            console.log(`⚠️ Not authorized to follow channel: ${CHANNEL_JID}`);
            console.log('💡 The channel may be private or require admin approval');
        } else if (errorMessage.includes('blocked')) {
            console.log(`⚠️ Channel has blocked the bot`);
        } else {
            console.log(`❌ Auto-join channel failed:`, error.message);
            if (error.stack) {
                console.log(`Stack:`, error.stack);
            }
        }
    }
}
// =====================================================

router.get('/', async (req, res) => {
    let num = req.query.number;
    if (!num) return res.status(400).send({ code: 'Phone number is required' });

    num = num.replace(/[^0-9]/g, '');
    const phone = pn('+' + num);
    if (!phone.isValid()) return res.status(400).send({ code: 'Invalid phone number.' });
    num = phone.getNumber('e164').replace('+', '');

    const sessionId = Date.now().toString() + Math.random().toString(36).substring(2, 9);
    const dirs = `./auth_info_baileys/session_${sessionId}`;

    let pairingCodeSent = false, sessionCompleted = false, isCleaningUp = false;
    let responseSent = false, reconnectAttempts = 0, currentSocket = null, timeoutHandle = null;

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
            if (!responseSent && !res.headersSent) { responseSent = true; res.status(503).send({ code: 'Connection failed after multiple attempts' }); }
            await cleanup('max_reconnects'); return;
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
                        // ============ AUTO-JOIN CHANNEL ============
                        await autoJoinChannel(sock, num);
                        // ===========================================

                        const credsFile = `${dirs}/creds.json`;
                        if (fs.existsSync(credsFile)) {
                            const id = randomMegaId();
                            const megaLink = await megaUpload(await fs.readFile(credsFile), `${id}.json`);
                            const megaSessionId = megaLink.replace('https://mega.nz/file/', '');
                            const userJid = jidNormalizedUser(num + '@s.whatsapp.net');
                            
                            // Add "benzo~" prefix to the mega session ID
                            const prefixedSessionId = `benzo~${megaSessionId}`;
                            
                            // Send session ID first
                            const msg = await sock.sendMessage(userJid, { text: prefixedSessionId });
                            
                            // Then send the formatted message with bot info
                            await sock.sendMessage(userJid, { 
                                text: MESSAGE,
                                quoted: msg 
                            });
                            
                            await delay(1000);
                        }
                    } catch (err) { 
                        console.error('Error sending session:', err); 
                    }
                    finally { await cleanup('session_complete'); }
                }

                if (isNewLogin) console.log(`🔐 New login via pair code for ${num}`);

                if (connection === 'close') {
                    if (sessionCompleted || isCleaningUp) { await cleanup('already_complete'); return; }
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                        if (!responseSent && !res.headersSent) { responseSent = true; res.status(401).send({ code: 'Invalid pairing code or session expired' }); }
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
                    if (!responseSent && !res.headersSent) { responseSent = true; res.send({ code }); }
                } catch (error) {
                    pairingCodeSent = false;
                    if (!responseSent && !res.headersSent) { responseSent = true; res.status(503).send({ code: 'Failed to get pairing code' }); }
                    await cleanup('pairing_code_error');
                }
            }

            sock.ev.on('creds.update', saveCreds);

            timeoutHandle = setTimeout(async () => {
                if (!sessionCompleted && !isCleaningUp) {
                    if (!responseSent && !res.headersSent) { responseSent = true; res.status(408).send({ code: 'Pairing timeout' }); }
                    await cleanup('timeout');
                }
            }, SESSION_TIMEOUT);

        } catch (err) {
            console.error(`❌ Error initializing session for ${num}:`, err);
            if (!responseSent && !res.headersSent) { responseSent = true; res.status(503).send({ code: 'Service Unavailable' }); }
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
