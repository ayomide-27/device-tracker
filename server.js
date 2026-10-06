const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'devices.json');
const MAX_HISTORY_POINTS = 200; // cap per device so the file doesn't grow forever

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Storage helpers ---
// devices.json shape:
// {
//   "device_abc123": {
//     label: "FO - John",
//     lat, lng, lastUpdate,
//     history: [ { lat, lng, timestamp }, ... ]   // oldest -> newest, capped
//   }
// }
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
  const now = new Date().toISOString();
  const existing = devices[deviceId];

  const history = existing?.history ? [...existing.history] : [];
  history.push({ lat, lng, timestamp: now });
  if (history.length > MAX_HISTORY_POINTS) {
    history.splice(0, history.length - MAX_HISTORY_POINTS); // drop oldest
  }

  devices[deviceId] = {
    lat,
    lng,
    label: label || existing?.label || deviceId,
    lastUpdate: now,
    history,
  };
  writeDevices(devices);

  res.json({ success: true, saved: devices[deviceId] });
});

// Dashboard polls this to get every device's latest position + trail
app.get('/api/devices', (req, res) => {
  res.json(readDevices());
});

app.listen(PORT, () => {
  console.log(`Device tracker server running on port ${PORT}`);
});
