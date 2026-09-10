/**
 * ═══════════════════════════════════════════════════════════
 *   ██╗  ██╗██╗███╗   ██╗ ██████╗       ██╗  ██╗██████╗ 
 *   ██║ ██╔╝██║████╗  ██║██╔════╝       ╚██╗██╔╝██╔══██╗
 *   █████╔╝ ██║██╔██╗ ██║██║  ███╗█████╗ ╚███╔╝ ██║  ██║
 *   ██╔═██╗ ██║██║╚██╗██║██║   ██║╚════╝ ██╔██╗ ██║  ██║
 *   ██║  ██╗██║██║ ╚████║╚██████╔╝      ██╔╝ ██╗██████╔╝
 *   ╚═╝  ╚═╝╚═╝╚═╝  ╚═══╝ ╚═════╝       ╚═╝  ╚═╝╚═════╝ 
 *
 *   KING-XD Bot Mini v10 — Multi-Device WhatsApp Bot
 *   Dev: ᴋɪɴɢsʟᴇʏ-xᴍᴅ ᴛᴇᴄʜ
 * ═══════════════════════════════════════════════════════════
 */
'use strict';

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  Browsers,
  jidDecode,
  downloadContentFromMessage,
  delay
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const express = require('express');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);
const autoreplies = require('./autoreply');

/* ═══════════════════ CONFIG ═══════════════════ */
const CONFIG = {
  botName: process.env.BOT_NAME || 'KING-XD Bot Mini',
  version: '10.0.0',
  dev: 'ᴋɪɴɢsʟᴇʏ-xᴍᴅ ᴛᴇᴄʜ',
  prefix: process.env.PREFIX || '.',
  botImage: process.env.BOT_IMAGE || 'https://i.ibb.co/SXQ0JCYX/jawadmd.jpg',
  ownerNumbers: (process.env.OWNER_NUMBER || '233535502036').split(',').map(s => s.trim()),
  channelJid: process.env.CHANNEL_JID || '120363421962437402@newsletter',
  autoReactEmojis: ['🔥', '💯', '⚡', '❤️', '👍', '🎉', '😎', '🚀', '💫', '✨'],
  port: process.env.PORT || 3000,
  sessionDir: './session',
  downloadDir: './downloads'
};

/* ═══════════════════ AUTO FEATURE STATE ═══════════════════ */
const AUTO = {
  autoreply: true,
  autoreact: false,
  autostatus: false,
  antidelete: true,
  antilink: false,
  anticall: false,
  antibadword: false,
  mode: 'public'
};

const BADWORDS = ['fuck', 'bitch', 'asshole', 'bastard', 'idiot'];

/* ═══════════════════ RUNTIME STATE ═══════════════════ */
let sock = null;
let qrDataUrl = null;
let pairingCode = null;
let connectionState = 'connecting';
let connectedUser = null;
const startTime = Date.now();
const messageCache = new Map();     // msgId -> {msg, chat, sender}
const badwordWarned = new Set();

fs.mkdirSync(CONFIG.sessionDir, { recursive: true });
fs.mkdirSync(CONFIG.downloadDir, { recursive: true });

/* ═══════════════════ UTILITIES ═══════════════════ */
const log = (...a) => console.log(`[${new Date().toISOString()}]`, ...a);
const formatUptime = (ms) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h ${Math.floor((s % 3600) / 60)}m ${s % 60}s`;
};
const isOwner = (jid) => CONFIG.ownerNumbers.some(o => jid.includes(o));
const isUrl = (t) => /^(https?:\/\/)[^\s]+$/i.test(t);

async function getGroupAdmins(sock, jid) {
  try {
    const meta = await sock.groupMetadata(jid);
    const admins = meta.participants.filter(p => p.admin).map(p => p.id);
    return { meta, admins };
  } catch { return { meta: null, admins: [] }; }
}

async function ytDlpDownload(url, type = 'video') {
  const id = Date.now().toString();
  const outTpl = path.join(CONFIG.downloadDir, `${id}.%(ext)s`);
  const fmt = type === 'audio'
    ? '-x --audio-format mp3 --audio-quality 0'
    : '-f "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b" --merge-output-format mp4';
  const cmd = `yt-dlp ${fmt} -o "${outTpl}" --no-playlist --max-filesize 100M "${url}"`;
  await execAsync(cmd, { maxBuffer: 1024 * 1024 * 512 });
  const files = fs.readdirSync(CONFIG.downloadDir).filter(f => f.startsWith(id));
  if (!files.length) throw new Error('Download failed');
  return path.join(CONFIG.downloadDir, files[0]);
}

/* ═══════════════════ STYLISH MENU ═══════════════════ */
function buildMenu(pushName = 'User') {
  const rt = formatUptime(Date.now() - startTime);
  const user = connectedUser?.split(':')[0] || 'Unknown';
  return `╭━〔${CONFIG.botName}〕━⬣
┃ [] STATUS  : ${connectionState === 'open' ? 'ONLINE' : 'CONNECTING'}
┃ [] RUNTIME : ${rt}
┃ [] USER    : ${pushName}
┃ [] DEV     : ${CONFIG.dev}
╰━━━━━━━━━━━━━━━━━━━━⬣

╭━━〔 📥 DOWNLOADS 〕━━⬣
┃➤ .yt
┃➤ .song 
┃➤ .video 
┃➤ .tt
┃➤ .wallpaper
╰━━━━━━━━━━━━━━━━━━━━⬣
╭━━〔 🔎 SEARCH 〕━━⬣
┃➤ .google
┃➤ .yahoo 
┃➤ .wiki
┃➤ .weather
╰━━━━━━━━━━━━━━━━━━━━⬣
╭━━〔 🎨 MEDIA TOOLS 〕━━⬣
┃➤ .sticker
┃➤ .toimg
┃➤ .compress
┃➤ .enhance
┃➤ .blur
┃➤ .removebg
╰━━━━━━━━━━━━━━━━━━━━⬣
╭━━〔 👑 GROUP MANAGER 〕━━⬣ (admins only)
┃➤ .gcstatus 
┃➤ .groupinfo
┃➤ .kick 
┃➤ .promote 
┃➤ .demote
┃➤ .add
┃➤ .mute 
┃➤ .unmute
┃➤ .link 
┃➤ .revoke
┃➤ .tag
┃➤ .tagall
┃➤ .kickall
┃➤ .kill
┃➤ .vv
╰━━━━━━━━━━━━━━━━━━━━⬣
╭━━〔 🛠 TOOLS 〕━━⬣
┃➤ .calc
┃➤ .flip 
┃➤ .roll 
┃➤ .8ball
┃➤ .joke
┃➤ .quote 
┃➤ .fact
┃➤ .reverse 
┃➤ .upper 
┃➤ .lower
┃➤ .id 
┃➤ .whoami
┃➤ .ping 
┃➤ .alive 
┃➤ .uptime
╰━━━━━━━━━━━━━━━━━━━━⬣
╭━━〔 ✨ NEW FEATURES 〕━━⬣
┃➤ .trt      (translate)
┃➤ .shorten  (url shortener)
┃➤ .qrcode   (text → QR image)
┃➤ .password (strong password)
┃➤ .base64 / .unbase64
┃➤ .lyrics
┃➤ .meme
┃➤ .imagine  (AI image prompt)
┃➤ .tts      (text → voice)
┃➤ .ocr      (image → text)
┃➤ .screenshot
┃➤ .define
┃➤ .vcf
┃➤ .whois
╰━━━━━━━━━━━━━━━━━━━━⬣
╭━━〔 👑 OWNER 〕━━⬣
┃➤ .broadcast
┃➤ .restart
┃➤ .block 
┃➤ .unblock
╰━━━━━━━━━━━━━━━━━━━━⬣
╭━━〔 ⚙️ SETTINGS 〕━━⬣
┃➤ .autoreact 
┃➤ .autostatus 
┃➤ .antibadword 
┃➤ .antilink
┃➤ .antidelete 
┃➤ .anticall
┃➤ .mode
┃➤ .settings
┃➤ .autoreply
╰━━━━━━━━━━━━━━━━━━━━⬣

> ${CONFIG.dev} • v${CONFIG.version}`;
}

/* ═══════════════════ EXPRESS DASHBOARD ═══════════════════ */
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>KING-XD Bot Mini v10 · Pairing Dashboard</title>
<link rel="icon" href="https://cdn-icons-png.flaticon.com/512/733/733585.png">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { height: 100%; font-family: 'Segoe UI', Roboto, sans-serif; color: #fff; overflow-x: hidden; }
  body {
    background:
      linear-gradient(rgba(0,0,0,0.55), rgba(0,0,0,0.75)),
      url('https://files.catbox.moe/mkwqsk.jpeg') center/cover fixed;
    min-height: 100vh;
    display: flex; align-items: center; justify-content: center;
    padding: 24px;
  }
  .glass {
    background: rgba(20, 20, 30, 0.55);
    backdrop-filter: blur(18px) saturate(140%);
    -webkit-backdrop-filter: blur(18px) saturate(140%);
    border: 1px solid rgba(255,255,255,0.15);
    border-radius: 22px;
    box-shadow: 0 20px 60px rgba(0,0,0,0.6);
  }
  .wrap { max-width: 980px; width: 100%; padding: 40px; display: grid; grid-template-columns: 1fr 1fr; gap: 40px; }
  @media (max-width: 820px) { .wrap { grid-template-columns: 1fr; padding: 26px; } }
  .logo { display: flex; align-items: center; gap: 14px; margin-bottom: 8px; }
  .logo img { width: 48px; height: 48px; border-radius: 12px; }
  h1 { font-size: 24px; letter-spacing: .5px; }
  .sub { color: #9be7ff; font-size: 13px; margin-top: 2px; }
  .status { display: inline-flex; align-items: center; gap: 8px; margin-top: 14px; font-size: 13px; padding: 6px 12px; border-radius: 999px; background: rgba(255,255,255,0.06); }
  .dot { width: 9px; height: 9px; border-radius: 50%; background: #ff4b5c; box-shadow: 0 0 10px #ff4b5c; }
  .dot.on { background: #28e07a; box-shadow: 0 0 10px #28e07a; }
  .dot.warn { background: #ffc542; box-shadow: 0 0 10px #ffc542; }
  .features { margin-top: 22px; font-size: 13.5px; color: #d7d7d7; line-height: 1.9; }
  .features li { list-style: none; }
  .features li::before { content: "▸ "; color: #66e0ff; }
  .panel h2 { font-size: 18px; margin-bottom: 18px; }
  label { display: block; font-size: 12.5px; color: #b8b8b8; margin-bottom: 6px; }
  input[type=text] {
    width: 100%; padding: 13px 15px; border-radius: 12px;
    border: 1px solid rgba(255,255,255,0.15);
    background: rgba(255,255,255,0.06);
    color: #fff; font-size: 15px; outline: none; transition: .2s;
  }
  input[type=text]:focus { border-color: #66e0ff; background: rgba(255,255,255,0.1); }
  .btn {
    width: 100%; padding: 13px 15px; border-radius: 12px; border: none; cursor: pointer;
    background: linear-gradient(135deg, #00c2ff, #7a5cff);
    color: #fff; font-weight: 600; font-size: 15px; letter-spacing: .3px;
    margin-top: 14px; transition: .25s;
  }
  .btn:hover { transform: translateY(-2px); box-shadow: 0 10px 24px rgba(0,194,255,.35); }
  .btn:disabled { opacity: .5; cursor: not-allowed; transform: none; box-shadow: none; }
  .btn.secondary { background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.18); }
  .qr {
    margin-top: 18px; text-align: center; padding: 12px; border-radius: 14px;
    background: rgba(255,255,255,0.05); display: none;
  }
  .qr img { width: 220px; height: 220px; background: #fff; padding: 8px; border-radius: 10px; }
  .msg { margin-top: 14px; font-size: 13px; color: #9be7ff; min-height: 18px; word-break: break-all; }
  .code {
    margin-top: 12px; font-family: ui-monospace, monospace; font-size: 26px;
    letter-spacing: 6px; text-align: center; font-weight: 700;
    background: rgba(0,194,255,.12); padding: 14px; border-radius: 12px; display: none;
  }
  .footer { text-align: center; margin-top: 30px; font-size: 12px; color: #8a8a8a; }
  .toast {
    position: fixed; top: 24px; right: 24px; padding: 14px 20px; border-radius: 12px;
    background: linear-gradient(135deg, #25D366, #128C7E); color: #fff;
    font-weight: 600; box-shadow: 0 12px 30px rgba(0,0,0,.5);
    transform: translateX(400px); transition: transform .45s cubic-bezier(.2,.9,.3,1.2);
    z-index: 9999; display: flex; align-items: center; gap: 10px;
  }
  .toast.show { transform: translateX(0); }
  .toast img { width: 26px; height: 26px; }
</style>
</head>
<body>
  <div class="toast" id="toast">
    <img src="https://cdn-icons-png.flaticon.com/512/733/733585.png" alt="">
    <span>WhatsApp Linked Successfully!</span>
  </div>

  <div class="wrap glass">
    <div>
      <div class="logo">
        <img src="https://i.ibb.co/SXQ0JCYX/jawadmd.jpg" alt="">
        <div>
          <h1>KING-XD Bot Mini</h1>
          <div class="sub">Multi-Device WhatsApp Bot · v10</div>
        </div>
      </div>
      <div class="status"><span class="dot" id="dot"></span><span id="statusText">Connecting…</span></div>
      <ul class="features">
        <li>Ultimate Downloader (YouTube · TikTok · IG · FB)</li>
        <li>Group Manager · Anti-ViewOnce · Tag-all</li>
        <li>Protection: Anti-Delete · Anti-Link · Anti-Call</li>
        <li>Auto-Status · Auto-React · Auto-Reply</li>
        <li>Self-hosted yt-dlp engine</li>
        <li>Stylish interactive menus</li>
      </ul>
    </div>

    <div class="panel">
      <h2>Link your WhatsApp</h2>
      <label for="phone">Phone number (with country code, no +)</label>
      <input id="phone" type="text" placeholder="e.g. 254712345678">
      <button class="btn" id="pairBtn">🔗 Get Pairing Code</button>
      <div class="code" id="codeBox"></div>
      <div class="msg" id="pairMsg"></div>

      <button class="btn secondary" id="qrBtn" style="margin-top:22px;">📱 Show QR Code Instead</button>
      <div class="qr" id="qrBox"><img id="qrImg" alt="QR"></div>
    </div>
  </div>

<script>
const $ = (id) => document.getElementById(id);
let statusPoll;

async function pollStatus() {
  try {
    const r = await fetch('/api/status');
    const j = await r.json();
    const dot = $('dot'), txt = $('statusText');
    if (j.state === 'open') {
      dot.className = 'dot on'; txt.textContent = 'Connected · ' + (j.user || '');
      if (!sessionStorage.getItem('linkedToast')) {
        sessionStorage.setItem('linkedToast', '1');
        showToast();
      }
    } else if (j.state === 'connecting') {
      dot.className = 'dot warn'; txt.textContent = 'Connecting…';
    } else {
      dot.className = 'dot'; txt.textContent = j.state || 'Waiting';
    }
  } catch(e) {}
}
statusPoll = setInterval(pollStatus, 2500); pollStatus();

function showToast() {
  const t = $('toast'); t.classList.add('show');
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification('KING-XD Bot Mini', { body: 'WhatsApp linked successfully! 🎉', icon: 'https://cdn-icons-png.flaticon.com/512/733/733585.png' });
  }
  setTimeout(() => t.classList.remove('show'), 5000);
}
if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();

$('pairBtn').onclick = async () => {
  const phone = $('phone').value.trim().replace(/\\D/g, '');
  if (!phone || phone.length < 8) { $('pairMsg').textContent = '❌ Enter a valid phone number.'; return; }
  $('pairBtn').disabled = true;
  $('pairMsg').textContent = '⏳ Requesting pairing code…';
  $('codeBox').style.display = 'none';
  try {
    const r = await fetch('/api/pair', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ phone }) });
    const j = await r.json();
    if (j.code) {
      $('codeBox').textContent = j.code; $('codeBox').style.display = 'block';
      $('pairMsg').textContent = '✅ Enter this code in WhatsApp → Linked Devices → Link with phone number';
    } else {
      $('pairMsg').textContent = '❌ ' + (j.error || 'Failed to get code.');
    }
  } catch(e) { $('pairMsg').textContent = '❌ ' + e.message; }
  $('pairBtn').disabled = false;
};

$('qrBtn').onclick = async () => {
  const r = await fetch('/api/qr'); const j = await r.json();
  if (j.qr) { $('qrImg').src = j.qr; $('qrBox').style.display = 'block'; }
  else { $('pairMsg').textContent = 'QR not ready yet — try in a few seconds.'; }
};
</script>
</body>
</html>`;

app.get('/', (_req, res) => res.type('html').send(DASHBOARD_HTML));

app.get('/api/status', (_req, res) => {
  res.json({ state: connectionState, user: connectedUser });
});

app.get('/api/qr', (_req, res) => {
  res.json({ qr: qrDataUrl });
});

app.post('/api/pair', async (req, res) => {
  try {
    const phone = String(req.body.phone || '').replace(/\D/g, '');
    if (!phone || phone.length < 8) return res.json({ error: 'Invalid phone number' });
    if (!sock) return res.json({ error: 'Bot socket not ready yet — try again in 5 seconds.' });

    // Reset pairing & request a fresh code
    const code = await sock.requestPairingCode(phone);
    pairingCode = code;
    log('📲 Pairing code requested for', phone, '→', code);
    res.json({ code });
  } catch (e) {
    log('Pair error:', e.message);
    res.json({ error: e.message });
  }
});

app.listen(CONFIG.port, () => log(`🌐 Dashboard live on http://localhost:${CONFIG.port}`));

/* ═══════════════════ WHATSAPP CONNECTION ═══════════════════ */
async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState(CONFIG.sessionDir);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    browser: Browsers.macOS('Desktop'),
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
    },
    generateHighQualityLinkPreview: true,
    syncFullHistory: false,
    markOnlineOnConnect: true
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (u) => {
    const { connection, lastDisconnect, qr } = u;

    if (qr) {
      try { qrDataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 300 }); }
      catch {}
    }

    if (connection === 'connecting') connectionState = 'connecting';

    if (connection === 'open') {
      connectionState = 'open';
      connectedUser = sock.user?.id || '';
      qrDataUrl = null;
      log('✅ WhatsApp connected as', connectedUser);

      // Auto-join channel
      if (CONFIG.channelJid) {
        try { await sock.newsletterFollow(CONFIG.channelJid); log('📣 Joined channel', CONFIG.channelJid); }
        catch (e) { log('Channel join failed:', e.message); }
      }

      // Startup message to owner
      for (const owner of CONFIG.ownerNumbers) {
        try {
          await sock.sendMessage(owner + '@s.whatsapp.net', {
            image: { url: CONFIG.botImage },
            caption: `*✅ ${CONFIG.botName} is now ONLINE*\n\n_Dev: ${CONFIG.dev}_\n_Version: ${CONFIG.version}_`
          });
        } catch {}
      }
    }

    if (connection === 'close') {
      connectionState = 'closed';
      const code = new Boom(lastDisconnect?.error)?.output?.statusCode;
      if (code === DisconnectReason.loggedOut || code === 401) {
        log('❌ Logged out. Clearing session.');
        fs.rmSync(CONFIG.sessionDir, { recursive: true, force: true });
        process.exit(0);
      } else {
        log('🔁 Reconnecting…');
        startBot();
      }
    }
  });

  /* ─────── Incoming messages ─────── */
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const raw of messages) {
      try { await handleMessage(raw); } catch (e) { log('Msg error:', e.message); }
    }
  });

  /* ─────── Anti-Delete (revoked messages) ─────── */
  sock.ev.on('messages.update', async (updates) => {
    if (!AUTO.antidelete) return;
    for (const { key, update } of updates) {
      if (update?.messageStubType === 0 || key?.remoteJid) {
        const cached = messageCache.get(key.id);
        if (cached && (update?.message === null || update?.messageStubType === 1)) {
          try {
            await sock.sendMessage(cached.chat, {
              text: `*🛡️ ANTI-DELETE*\n\n*From:* @${cached.sender.split('@')[0]}\n*Recovered message:*`,
              mentions: [cached.sender]
            });
            const m = cached.msg.message;
            if (m.conversation) await sock.sendMessage(cached.chat, { text: m.conversation });
            else await sock.sendMessage(cached.chat, { forward: cached.msg });
          } catch {}
        }
      }
    }
  });

  /* ─────── Anti-Call ─────── */
  sock.ev.on('call', async (calls) => {
    if (!AUTO.anticall) return;
    for (const c of calls) {
      if (c.status === 'offer') {
        try {
          await sock.rejectCall(c.id, c.from);
          await sock.sendMessage(c.from, { text: '📵 *Anti-Call is enabled.* Calls are not accepted.' });
        } catch {}
      }
    }
  });
}

/* ═══════════════════ MESSAGE HANDLER ═══════════════════ */
async function handleMessage(msg) {
  if (!msg.message) return;
  const from = msg.key.remoteJid;
  const sender = msg.key.participant || msg.key.remoteJid;
  const isGroup = from.endsWith('@g.us');
  const pushName = msg.pushName || 'User';

  // Cache for anti-delete
  if (AUTO.antidelete) {
    messageCache.set(msg.key.id, { msg, chat: from, sender });
    if (messageCache.size > 500) {
      const k = messageCache.keys().next().value; messageCache.delete(k);
    }
  }

  // Auto-status viewer
  if (AUTO.autostatus && from === 'status@broadcast') {
    try { await sock.readMessages([msg.key]); } catch {}
    return;
  }

  // Auto react on channels
  if (CONFIG.channelJid && from === CONFIG.channelJid) {
    try {
      const emoji = CONFIG.autoReactEmojis[Math.floor(Math.random() * CONFIG.autoReactEmojis.length)];
      await sock.sendMessage(from, { react: { text: emoji, key: msg.key } });
    } catch {}
    return;
  }

  const body =
    msg.message.conversation ||
    msg.message.extendedTextMessage?.text ||
    msg.message.imageMessage?.caption ||
    msg.message.videoMessage?.caption ||
    msg.message.buttonsResponseMessage?.selectedButtonId ||
    msg.message.listResponseMessage?.singleSelectReply?.selectedRowId ||
    '';
  const trimmed = body.trim();

  // Auto-React on any message
  if (AUTO.autoreact && trimmed) {
    try {
      const emoji = CONFIG.autoReactEmojis[Math.floor(Math.random() * CONFIG.autoReactEmojis.length)];
      await sock.sendMessage(from, { react: { text: emoji, key: msg.key } });
    } catch {}
  }

  // Anti-badword
  if (AUTO.antibadword && isGroup && trimmed) {
    const low = trimmed.toLowerCase();
    if (BADWORDS.some(w => low.includes(w))) {
      const { admins } = await getGroupAdmins(sock, from);
      if (!admins.includes(sender)) {
        try {
          await sock.sendMessage(from, { delete: msg.key });
          if (!badwordWarned.has(sender)) {
            badwordWarned.add(sender);
            await sock.sendMessage(from, { text: `⚠️ @${sender.split('@')[0]} watch your language.`, mentions: [sender] });
          }
        } catch {}
        return;
      }
    }
  }

  // Anti-Link
  if (AUTO.antilink && isGroup && trimmed && /chat\.whatsapp\.com|wa\.me\/|t\.me\//i.test(trimmed)) {
    const { admins } = await getGroupAdmins(sock, from);
    if (!admins.includes(sender)) {
      try {
        await sock.sendMessage(from, { delete: msg.key });
        await sock.groupParticipantsUpdate(from, [sender], 'remove');
        await sock.sendMessage(from, { text: `🔗 @${sender.split('@')[0]} removed for posting a link.`, mentions: [sender] });
      } catch {}
      return;
    }
  }

  // Auto-Reply (when chatting privately or tagged)
  if (AUTO.autoreply && trimmed) {
    const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
    const isReplyToBot = msg.message.extendedTextMessage?.contextInfo?.participant === sock.user.id;
    const isDM = !isGroup;
    const isTaggedBot = mentioned.includes(sock.user.id);

    const clean = trimmed.replace(/[?.!,]+$/g, '').trim();
    if (autoreplies[clean] && (isDM || isTaggedBot || isReplyToBot)) {
      const val = autoreplies[clean];
      const text = typeof val === 'function' ? val() : val;
      await delay(600);
      await sock.sendMessage(from, { text }, { quoted: msg });
      return;
    }
  }

  // Command parsing
  if (!trimmed.startsWith(CONFIG.prefix)) return;
  const args = trimmed.slice(CONFIG.prefix.length).trim().split(/\s+/);
  const cmd = (args.shift() || '').toLowerCase();
  const q = args.join(' ');

  if (AUTO.mode === 'private' && !isOwner(sender)) return;

  await runCommand({ cmd, args, q, msg, from, sender, isGroup, pushName });
}

/* ═══════════════════ COMMAND ROUTER ═══════════════════ */
async function runCommand(ctx) {
  const { cmd, args, q, msg, from, sender, isGroup, pushName } = ctx;
  const reply = (text, opts = {}) => sock.sendMessage(from, { text, ...opts }, { quoted: msg });

  switch (cmd) {
    /* ───── BASIC ───── */
    case 'menu':
    case 'help':
      await sock.sendMessage(from, { image: { url: CONFIG.botImage }, caption: buildMenu(pushName) }, { quoted: msg });
      return;

    case 'ping':
      { const t = Date.now(); await reply('🏓 Pong!'); await sock.sendMessage(from, { text: `⚡ Latency: ${Date.now() - t}ms` }, { quoted: msg }); return; }

    case 'alive': {
      return reply(`*✅ ${CONFIG.botName} is ALIVE*\n\n⏱ Uptime: ${formatUptime(Date.now() - startTime)}\n👑 Dev: ${CONFIG.dev}\n🔖 v${CONFIG.version}`);
    }

    case 'uptime': return reply(`⏱ Uptime: *${formatUptime(Date.now() - startTime)}*`);
    case 'id':
    case 'whoami': return reply(`👤 *Your JID:* ${sender}\n📛 *Name:* ${pushName}`);
    case 'flip': return reply(`🪙 ${Math.random() < 0.5 ? 'HEADS' : 'TAILS'}`);
    case 'roll': { const n = parseInt(args[0]) || 6; return reply(`🎲 ${Math.floor(Math.random() * n) + 1}`); }
    case 'reverse': return reply((q || '').split('').reverse().join(''));
    case 'upper': return reply((q || '').toUpperCase());
    case 'lower': return reply((q || '').toLowerCase());
    case 'calc': {
      try { const r = Function(`"use strict";return(${q})`)(); return reply(`🧮 *${q}* = *${r}*`); }
      catch { return reply('❌ Invalid expression.'); }
    }
    case '8ball': {
      const a = ['Yes ✅','No ❌','Maybe 🤔','Definitely 💯','Not sure 🤷','Ask again later ⏳','Absolutely 🔥','Nope 🚫'];
      return reply(`🎱 ${a[Math.floor(Math.random() * a.length)]}`);
    }
    case 'joke': {
      const j = ['Why don’t skeletons fight? They don’t have guts 😂','I told my computer I needed a break — it said “no problem, I’ll go to sleep.” 💻😴','Why did the developer go broke? He used up all his cache 💸'];
      return reply(j[Math.floor(Math.random() * j.length)]);
    }
    case 'quote': {
      const qs = ['Be the change you wish to see in the world.','Code is like humor — when you have to explain it, it’s bad.','Stay hungry, stay foolish.'];
      return reply(`💬 _${qs[Math.floor(Math.random() * qs.length)]}_`);
    }
    case 'fact': {
      const f = ['Honey never spoils 🍯','Octopuses have three hearts 🐙','Bananas are berries 🍌','A day on Venus is longer than its year 🪐'];
      return reply(`🧠 ${f[Math.floor(Math.random() * f.length)]}`);
    }

    /* ───── NEW TOOLS ───── */
    case 'password': {
      const len = parseInt(args[0]) || 16;
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
      let p = ''; for (let i = 0; i < len; i++) p += chars[Math.floor(Math.random() * chars.length)];
      return reply(`🔐 *Strong Password:*\n\n\`${p}\``);
    }
    case 'base64': return reply(Buffer.from(q).toString('base64'));
    case 'unbase64': {
      try { return reply(Buffer.from(q, 'base64').toString('utf8')); }
      catch { return reply('❌ Invalid base64.'); }
    }
    case 'qrcode':
    case 'qr': {
      if (!q) return reply('❌ Provide text: `.qr Hello`');
      const buf = await QRCode.toBuffer(q);
      return sock.sendMessage(from, { image: buf, caption: `📱 QR for: *${q}*` }, { quoted: msg });
    }
    case 'shorten':
    case 'tinyurl': {
      if (!q) return reply('❌ Provide a URL.');
      try {
        const axios = require('axios');
        const r = await axios.get(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(q)}`);
        return reply(`🔗 Shortened: ${r.data}`);
      } catch { return reply('❌ Failed.'); }
    }
    case 'trt':
    case 'translate': {
      const [lang, ...rest] = args; const text = rest.join(' ');
      if (!lang || !text) return reply('Usage: `.trt <lang> <text>`');
      try {
        const axios = require('axios');
        const r = await axios.get(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${lang}&dt=t&q=${encodeURIComponent(text)}`);
        return reply(`🌐 *${lang.toUpperCase()}:* ${r.data[0].map(x => x[0]).join('')}`);
      } catch { return reply('❌ Translation failed.'); }
    }
    case 'weather': {
      if (!q) return reply('Usage: `.weather <city>`');
      try {
        const axios = require('axios');
        const r = await axios.get(`https://wttr.in/${encodeURIComponent(q)}?format=j1`);
        const c = r.data.current_condition[0];
        return reply(`🌤 *Weather in ${q}*\n\n🌡 Temp: ${c.temp_C}°C\n💧 Humidity: ${c.humidity}%\n💨 Wind: ${c.windspeedKmph} km/h\n☁️ ${c.weatherDesc[0].value}`);
      } catch { return reply('❌ Could not fetch weather.'); }
    }
    case 'wiki': {
      if (!q) return reply('Usage: `.wiki <query>`');
      try {
        const axios = require('axios');
        const r = await axios.get(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(q)}`);
        return reply(`📖 *${r.data.title}*\n\n${r.data.extract}`);
      } catch { return reply('❌ Not found.'); }
    }
    case 'google':
    case 'yahoo': return reply(`🔎 *${cmd}*: https://www.${cmd}.com/search?q=${encodeURIComponent(q)}`);

    case 'whois': {
      if (!q) return reply('Usage: `.whois <domain>`');
      try {
        const axios = require('axios');
        const r = await axios.get(`https://rdap.org/domain/${q}`);
        return reply(`🌐 *${q}*\nStatus: ${r.data.status?.join(', ') || 'N/A'}\nRegistrar: ${r.data.entities?.[0]?.vcardArray?.[1]?.find(x => x[0] === 'fn')?.[3] || 'N/A'}`);
      } catch { return reply('❌ Lookup failed.'); }
    }

    /* ───── DOWNLOADS ───── */
    case 'yt':
    case 'video': {
      if (!q) return reply('Usage: `.yt <url or search>`');
      await reply('⏳ Downloading video…');
      try {
        let url = q;
        if (!isUrl(q)) {
          const axios = require('axios');
          const s = await axios.get(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`);
          const m = s.data.match(/"videoId":"([\w-]{11})"/);
          if (!m) return reply('❌ No results.');
          url = `https://youtu.be/${m[1]}`;
        }
        const file = await ytDlpDownload(url, 'video');
        const buf = fs.readFileSync(file);
        await sock.sendMessage(from, { video: buf, caption: `🎬 ${CONFIG.botName}` }, { quoted: msg });
        fs.unlinkSync(file);
      } catch (e) { reply('❌ ' + e.message); }
      return;
    }
    case 'song':
    case 'audio': {
      if (!q) return reply('Usage: `.song <url or search>`');
      await reply('🎵 Fetching audio…');
      try {
        let url = q;
        if (!isUrl(q)) {
          const axios = require('axios');
          const s = await axios.get(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`);
          const m = s.data.match(/"videoId":"([\w-]{11})"/);
          if (!m) return reply('❌ No results.');
          url = `https://youtu.be/${m[1]}`;
        }
        const file = await ytDlpDownload(url, 'audio');
        const buf = fs.readFileSync(file);
        await sock.sendMessage(from, { audio: buf, mimetype: 'audio/mpeg', fileName: path.basename(file) }, { quoted: msg });
        fs.unlinkSync(file);
      } catch (e) { reply('❌ ' + e.message); }
      return;
    }
    case 'yts':
    case 'vid': {
      if (!q) return reply('Usage: `.yts <query>`');
      try {
        const axios = require('axios');
        const r = await axios.get(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`);
        const ids = [...r.data.matchAll(/"videoId":"([\w-]{11})"/g)].slice(0, 5);
        if (!ids.length) return reply('❌ No results.');
        let out = `🔎 *Search: ${q}*\n\n`;
        ids.forEach((m, i) => out += `${i + 1}. https://youtu.be/${m[1]}\n`);
        return reply(out);
      } catch { return reply('❌ Search failed.'); }
    }
    case 'tt': {
      if (!q) return reply('Usage: `.tt <tiktok url>`');
      await reply('⏳ Downloading TikTok…');
      try {
        const file = await ytDlpDownload(q, 'video');
        const buf = fs.readFileSync(file);
        await sock.sendMessage(from, { video: buf, caption: '🎵 TikTok (no watermark)' }, { quoted: msg });
        fs.unlinkSync(file);
      } catch (e) { reply('❌ ' + e.message); }
      return;
    }
    case 'ig': {
      if (!q) return reply('Usage: `.ig <instagram url>`');
      await reply('⏳ Downloading Instagram…');
      try {
        const file = await ytDlpDownload(q, 'video');
        const buf = fs.readFileSync(file);
        await sock.sendMessage(from, { video: buf, caption: '📸 Instagram' }, { quoted: msg });
        fs.unlinkSync(file);
      } catch (e) { reply('❌ ' + e.message); }
      return;
    }
    case 'fb': {
      if (!q) return reply('Usage: `.fb <facebook url>`');
      await reply('⏳ Downloading Facebook…');
      try {
        const file = await ytDlpDownload(q, 'video');
        const buf = fs.readFileSync(file);
        await sock.sendMessage(from, { video: buf, caption: '📘 Facebook' }, { quoted: msg });
        fs.unlinkSync(file);
      } catch (e) { reply('❌ ' + e.message); }
      return;
    }
    case 'wallpaper': {
      try {
        const axios = require('axios');
        const r = await axios.get(`https://source.unsplash.com/1600x900/?${encodeURIComponent(q || 'nature')}`);
        return sock.sendMessage(from, { image: { url: r.request.res.responseUrl || r.config.url }, caption: `🖼 ${q || 'wallpaper'}` }, { quoted: msg });
      } catch { return reply('❌ Failed.'); }
    }

    /* ───── VIEW ONCE ───── */
    case 'vv': {
      const ctx2 = msg.message.extendedTextMessage?.contextInfo;
      const quoted = ctx2?.quotedMessage;
      if (!quoted) return reply('⚠️ Reply to a view-once message with `.vv`');
      const inner = quoted.viewOnceMessageV2?.message || quoted.viewOnceMessage?.message || quoted;
      const img = inner.imageMessage, vid = inner.videoMessage;
      if (img) {
        const stream = await downloadContentFromMessage(img, 'image');
        let buf = Buffer.from([]); for await (const c of stream) buf = Buffer.concat([buf, c]);
        return sock.sendMessage(from, { image: buf, caption: img.caption || '👁️ Recovered' }, { quoted: msg });
      }
      if (vid) {
        const stream = await downloadContentFromMessage(vid, 'video');
        let buf = Buffer.from([]); for await (const c of stream) buf = Buffer.concat([buf, c]);
        return sock.sendMessage(from, { video: buf, caption: vid.caption || '👁️ Recovered' }, { quoted: msg });
      }
      return reply('❌ Not a view-once media.');
    }

    /* ───── GROUP MANAGER ───── */
    case 'groupinfo':
    case 'gcstatus': {
      if (!isGroup) return reply('❌ Group only.');
      const { meta } = await getGroupAdmins(sock, from);
      if (!meta) return reply('❌ Metadata error.');
      return sock.sendMessage(from, {
        image: { url: CONFIG.botImage },
        caption: `📊 *Group Info*\n\n📛 *Name:* ${meta.subject}\n🆔 *ID:* ${meta.id}\n👥 *Members:* ${meta.participants.length}\n📝 *Desc:* ${meta.desc || 'N/A'}`
      }, { quoted: msg });
    }
    case 'link': {
      if (!isGroup) return reply('❌ Group only.');
      try { return reply('🔗 ' + await sock.groupInviteCode(from)); } catch { return reply('❌ Failed.'); }
    }
    case 'revoke': {
      if (!isGroup) return reply('❌ Group only.');
      try { await sock.groupRevokeInvite(from); return reply('✅ Link revoked.'); } catch { return reply('❌ Failed.'); }
    }
    case 'kick': {
      if (!isGroup) return reply('❌ Group only.');
      const target = msg.message.extendedTextMessage?.contextInfo?.participant || (args[0] ? args[0].replace(/\D/g, '') + '@s.whatsapp.net' : null);
      if (!target) return reply('⚠️ Mention someone.');
      try { await sock.groupParticipantsUpdate(from, [target], 'remove'); return reply('✅ Kicked.'); } catch { return reply('❌ Failed.'); }
    }
    case 'add': {
      if (!isGroup || !args[0]) return reply('Usage: `.add 254xxxx`');
      try { await sock.groupParticipantsUpdate(from, [args[0].replace(/\D/g, '') + '@s.whatsapp.net'], 'add'); return reply('✅ Added.'); } catch { return reply('❌ Failed.'); }
    }
    case 'promote': {
      const target = msg.message.extendedTextMessage?.contextInfo?.participant;
      if (!target) return reply('⚠️ Mention someone.');
      try { await sock.groupParticipantsUpdate(from, [target], 'promote'); return reply('✅ Promoted.'); } catch { return reply('❌ Failed.'); }
    }
    case 'demote': {
      const target = msg.message.extendedTextMessage?.contextInfo?.participant;
      if (!target) return reply('⚠️ Mention someone.');
      try { await sock.groupParticipantsUpdate(from, [target], 'demote'); return reply('✅ Demoted.'); } catch { return reply('❌ Failed.'); }
    }
    case 'mute': { try { await sock.groupSettingUpdate(from, 'announcement'); return reply('🔇 Group muted.'); } catch { return reply('❌ Failed.'); } }
    case 'unmute': { try { await sock.groupSettingUpdate(from, 'not_announcement'); return reply('🔊 Group unmuted.'); } catch { return reply('❌ Failed.'); } }
    case 'tagall': {
      if (!isGroup) return reply('❌ Group only.');
      const { meta } = await getGroupAdmins(sock, from);
      const mentions = meta.participants.map(p => p.id);
      let txt = `📣 *Attention everyone!*\n\n${q ? q + '\n\n' : ''}`;
      mentions.forEach(m => txt += `@${m.split('@')[0]}\n`);
      return sock.sendMessage(from, { text: txt, mentions }, { quoted: msg });
    }
    case 'tag': return reply(`@${sender.split('@')[0]} ${q}`, { mentions: [sender] });
    case 'kill':
    case 'kickall': {
      if (!isGroup) return reply('❌ Group only.');
      if (!isOwner(sender)) return reply('👑 Owner only.');
      const { meta, admins } = await getGroupAdmins(sock, from);
      const targets = meta.participants.map(p => p.id).filter(id => !admins.includes(id) && id !== sock.user.id);
      await reply(`⚠️ Removing ${targets.length} members…`);
      for (const t of targets) { try { await sock.groupParticipantsUpdate(from, [t], 'remove'); } catch {} }
      return reply('✅ Done.');
    }

    /* ───── SETTINGS ───── */
    case 'settings': {
      const s = Object.entries(AUTO).map(([k, v]) => `┃➤ ${k}: *${v}*`).join('\n');
      return reply(`⚙️ *Settings*\n╭━━━━━━━━━━━━━━⬣\n${s}\n╰━━━━━━━━━━━━━━⬣`);
    }
    case 'autoreply': AUTO.autoreply = !AUTO.autoreply; return reply(`🤖 Autoreply: *${AUTO.autoreply ? 'ON' : 'OFF'}*`);
    case 'autoreact': AUTO.autoreact = !AUTO.autoreact; return reply(`✨ Autoreact: *${AUTO.autoreact ? 'ON' : 'OFF'}*`);
    case 'autostatus': AUTO.autostatus = !AUTO.autostatus; return reply(`📸 Autostatus: *${AUTO.autostatus ? 'ON' : 'OFF'}*`);
    case 'antidelete': AUTO.antidelete = !AUTO.antidelete; return reply(`🛡 Anti-delete: *${AUTO.antidelete ? 'ON' : 'OFF'}*`);
    case 'antilink': AUTO.antilink = !AUTO.antilink; return reply(`🔗 Anti-link: *${AUTO.antilink ? 'ON' : 'OFF'}*`);
    case 'anticall': AUTO.anticall = !AUTO.anticall; return reply(`📵 Anti-call: *${AUTO.anticall ? 'ON' : 'OFF'}*`);
    case 'antibadword': AUTO.antibadword = !AUTO.antibadword; return reply(`🚫 Anti-badword: *${AUTO.antibadword ? 'ON' : 'OFF'}*`);
    case 'mode': {
      AUTO.mode = AUTO.mode === 'public' ? 'private' : 'public';
      return reply(`🌐 Mode: *${AUTO.mode.toUpperCase()}*`);
    }

    /* ───── OWNER ───── */
    case 'broadcast': {
      if (!isOwner(sender)) return reply('👑 Owner only.');
      if (!q) return reply('Usage: `.broadcast <message>`');
      const chats = await sock.groupFetchAllParticipating();
      let n = 0;
      for (const id of Object.keys(chats)) {
        try { await sock.sendMessage(id, { text: `📢 *Broadcast from ${CONFIG.dev}*\n\n${q}` }); n++; } catch {}
      }
      return reply(`✅ Sent to ${n} groups.`);
    }
    case 'restart': {
      if (!isOwner(sender)) return reply('👑 Owner only.');
      await reply('🔄 Restarting…');
      process.exit(0);
    }
    case 'block': {
      if (!isOwner(sender)) return reply('👑 Owner only.');
      const t = msg.message.extendedTextMessage?.contextInfo?.participant;
      if (!t) return reply('⚠️ Mention/reply.');
      await sock.updateBlockStatus(t, 'block');
      return reply('🚫 Blocked.');
    }
    case 'unblock': {
      if (!isOwner(sender)) return reply('👑 Owner only.');
      const t = msg.message.extendedTextMessage?.contextInfo?.participant;
      if (!t) return reply('⚠️ Mention/reply.');
      await sock.updateBlockStatus(t, 'unblock');
      return reply('✅ Unblocked.');
    }

    default:
      return;
  }
}

/* ═══════════════════ BOOT ═══════════════════ */
process.on('uncaughtException', (e) => log('Uncaught:', e.message));
process.on('unhandledRejection', (e) => log('Unhandled:', e?.message || e));

log(`🚀 Starting ${CONFIG.botName} v${CONFIG.version}…`);
startBot();
