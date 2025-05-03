// ========================================
// Ticket Store Loader and Validator Module
// ========================================
const fs = require('fs');
const path = require('path');

// Path to the ticket file (copied to frontend)
const TICKET_FILE_PATH = path.join(__dirname, '..', 'frontend', 'tickets.json');

// --------------------------------------------
// Exported Function: Loads and Validates Tickets
// --------------------------------------------
function loadTickets() {
  let raw = [];

  try {
    const data = fs.readFileSync(TICKET_FILE_PATH, 'utf8');
    raw = JSON.parse(data);
  } catch (err) {
    console.error('❌ Failed to load tickets.json:', err.message);
    return [];
  }

  const valid = [];
  let invalidCount = 0;

  raw.forEach((ticket, index) => {
    if (isValidTicket(ticket)) {
      valid.push(ticket);
    } else {
      invalidCount++;
      console.warn(`⚠️ Ticket ${index + 1} is invalid and was skipped.`);
    }
  });

  console.log(`✅ Loaded ${valid.length} valid tickets (${invalidCount} skipped).`);
  return valid;
}

// --------------------------------------------
// Internal: Ticket Format Validator
// --------------------------------------------
function isValidTicket(ticket) {
  if (!Array.isArray(ticket) || ticket.length !== 3) return false;

  const flat = ticket.flat();
  if (flat.length !== 27) return false;

  // Check each row has 5 numbers (non-zero)
  for (const row of ticket) {
    const nonZero = row.filter(n => n !== 0);
    if (nonZero.length !== 5) return false;
  }

  // Check all numbers are in 1–90
  const numbers = flat.filter(n => n !== 0);
  if (!numbers.every(n => Number.isInteger(n) && n >= 1 && n <= 90)) return false;

  // Check no duplicates within ticket
  const unique = new Set(numbers);
  return unique.size === numbers.length;
}

// --------------------------------------------
// Export
// --------------------------------------------
module.exports = {
  loadTickets
};
