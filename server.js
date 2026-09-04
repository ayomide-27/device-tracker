const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'devices.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Storage helpers ---
// devices.json shape: { "device_1": { lat, lng, label, lastUpdate } }
function readDevices() {
  if (!fs.existsSync(DATA_FILE)) return {};
  const raw = fs.readFileSync(DATA_FILE, 'utf-8');
  return raw ? JSON.parse(raw) : {};
}

function writeDevices(devices) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(devices, null, 2));
}

// --- Routes ---

// A device (FO's phone) reports its location here
app.post('/api/location', (req, res) => {
  const { deviceId, lat, lng, label } = req.body;

  if (!deviceId || lat === undefined || lng === undefined) {
    return res.status(400).json({ error: 'deviceId, lat, and lng are required' });
  }

  const devices = readDevices();
  devices[deviceId] = {
    lat,
    lng,
    label: label || deviceId,
    lastUpdate: new Date().toISOString(),
  };
  writeDevices(devices);

  res.json({ success: true, saved: devices[deviceId] });
});

// Dashboard polls this to get every device's latest position
app.get('/api/devices', (req, res) => {
  res.json(readDevices());
});

app.listen(PORT, () => {
  console.log(`Device tracker server running on port ${PORT}`);
});
