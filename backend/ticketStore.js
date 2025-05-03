const path = require('path');
const fs = require('fs');

function loadTickets() {
  const ticketPath = path.join(__dirname, 'tickets.json'); // ✅ corrected
  try {
    const raw = fs.readFileSync(ticketPath, 'utf-8');
    const data = JSON.parse(raw);

    const valid = data.filter(t => Array.isArray(t) && t.length === 3 && t.every(r => Array.isArray(r) && r.length === 9));
    if (valid.length < data.length) {
      console.warn(`⚠️ ${data.length - valid.length} invalid ticket(s) removed (bad format).`);
    }
    return valid;
  } catch (err) {
    console.error(`❌ Failed to load tickets.json: ${err.message}`);
    return [];
  }
}

module.exports = { loadTickets };
