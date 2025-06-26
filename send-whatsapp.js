const { default: makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const express = require('express');
const fs = require('fs');
const QRCode = require('qrcode');
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

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`API server running on http://localhost:${PORT}`);
  start();
});