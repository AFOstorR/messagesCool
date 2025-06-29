const { default: makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const express = require('express');
const fs = require('fs');
const multer = require('multer');
const upload = multer({ dest: 'uploads/' }); // Temporary upload folder
const QRCode = require('qrcode');
const path = require('path');
const app = express();
app.use(express.json());

let sock;
let qrString = null;
let isConnected = false;

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info');
  sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
  });

  sock.ev.on('creds.update', saveCreds);

 sock.ev.on('connection.update', (update) => {
  const { qr, connection } = update;
  if (qr) {
    qrString = qr; // Always update with the latest QR
    // Remove or comment out the next line if you don't want QR in the terminal
    // qrcode.generate(qr, { small: true });
  }
  if (connection === 'open') {
    isConnected = true;
    qrString = null;
    console.log('Connected!');
  }
  if (connection === 'close') {
    isConnected = false;
    console.log('Connection closed, restarting...');
    setTimeout(start, 2000); // Try to reconnect after 2s
  }
});
}

app.get('/qr', async (req, res) => {
  if (isConnected) {
    return res.json({ status: 'connected' });
  }
  if (qrString) {
    // Generate QR code as a data URL (PNG image)
    try {
      const qrImage = await QRCode.toDataURL(qrString);
      return res.json({ qr: qrString, qrImage });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to generate QR image' });
    }
  }
  return res.json({ status: 'waiting' });
});

app.post('/send', async (req, res) => {
  if (!isConnected) {
    return res.status(400).json({ error: 'WhatsApp not connected' });
  }
  const { number, message } = req.body;
  if (!number || !message) {
    return res.status(400).json({ error: 'number and message required' });
  }
  try {
    const jid = number + '@s.whatsapp.net';
    await sock.sendMessage(jid, { text: message });
    res.json({ status: 'sent', number });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/reset-auth', async (req, res) => {
  const authDir = path.join(__dirname, 'auth_info');
  try {
    if (fs.existsSync(authDir)) {
      fs.readdirSync(authDir).forEach(file => {
        fs.unlinkSync(path.join(authDir, file));
      });
    }
    // Optionally, restart the WhatsApp connection
    if (sock && sock.ws && sock.ws.close) {
      sock.ws.close();
    }
    isConnected = false;
    qrString = null;
    res.json({ status: 'auth_info cleared' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to clear auth_info', details: err.message });
  }
});
app.post('/send-image', upload.single('image'), async (req, res) => {
  if (!isConnected) {
    return res.status(400).json({ error: 'WhatsApp not connected' });
  }
  const { number, caption } = req.body;
  if (!number || !req.file) {
    return res.status(400).json({ error: 'number and image required' });
  }
  try {
    const jid = number + '@s.whatsapp.net';
    const buffer = fs.readFileSync(req.file.path);
    await sock.sendMessage(jid, {
      image: buffer,
      caption: caption || ''
    });
    fs.unlinkSync(req.file.path); // Clean up uploaded file
    res.json({ status: 'image sent', number });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// GET all groups you participate in
app.get('/groups', async (req, res) => {
  if (!isConnected) {
    return res.status(400).json({ error: 'WhatsApp not connected' });
  }
  try {
    const groups = await sock.groupFetchAllParticipating();
    // Format: array of { id, name }
    const groupList = Object.values(groups).map(g => ({
      id: g.id,
      name: g.subject
    }));
    res.json({ groups: groupList });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST send image to group
app.post('/send-group-image', upload.single('image'), async (req, res) => {
  if (!isConnected) {
    return res.status(400).json({ error: 'WhatsApp not connected' });
  }
  const groupJid = req.body ? req.body.groupJid : undefined;
  const caption = req.body ? req.body.caption : undefined;
  if (!groupJid) {
    return res.status(400).json({ error: 'groupJid required' });
  }
  try {
    if (req.file) {
      const buffer = fs.readFileSync(req.file.path);
      await sock.sendMessage(groupJid, {
        image: buffer,
        caption: caption || ''
      });
      fs.unlinkSync(req.file.path); // Clean up uploaded file
      res.json({ status: 'image sent', groupJid });
    } else if (caption) {
      await sock.sendMessage(groupJid, { text: caption });
      res.json({ status: 'text sent', groupJid });
    } else {
      res.status(400).json({ error: 'Either image or caption required' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// POST send text to group
app.post('/send-group-text', async (req, res) => {
  if (!isConnected) {
    return res.status(400).json({ error: 'WhatsApp not connected' });
  }
  const { groupJid, message } = req.body;
  if (!groupJid || !message) {
    return res.status(400).json({ error: 'groupJid and message required' });
  }
  try {
    await sock.sendMessage(groupJid, { text: message });
    res.json({ status: 'text sent', groupJid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`API server running on http://localhost:${PORT}`);
  start();
});