// Folder: tambola-project/backend
// File: ticketStore.js

// ========== Imports ==========
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid'); // Ensure 'uuid' is in dependencies

// ========== TicketStore Class ==========
class TicketStore {
  /**
   * Initialize TicketStore with a pool of tickets loaded from JSON.
   * @param {string} ticketsFilePath - Path to tickets.json
   */
  constructor(ticketsFilePath) {
    const fullPath = path.resolve(__dirname, ticketsFilePath);
    this.tickets = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
    this.rooms = {}; // In-memory rooms state
  }

  /**
   * Create a new game room with initial settings.
   */
  createRoom(roomId, maxTicketsPerPlayer) {
    this.rooms[roomId] = {
      maxTicketsPerPlayer,
      calledNumbers: new Set(),        // Numbers drawn so far
      playerTickets: {},               // { playerName: [ticket, ...] }
      ticketRequests: [],              // [{ requestId, playerName }]
      claims: []                       // [{ claimId, playerName, claimType, numbers, approved|null }]
    };
  }

  /**
   * Check if a room exists.
   */
  roomExists(roomId) {
    return !!this.rooms[roomId];
  }

  /**
   * Draw a random number (1-90) that hasn't been called yet.
   */
  drawNumber(roomId) {
    const room = this.rooms[roomId];
    if (!room) throw new Error('Room not found');
    const allNumbers = Array.from({ length: 90 }, (_, i) => i + 1);
    const available = allNumbers.filter(n => !room.calledNumbers.has(n));
    if (available.length === 0) return null; // All numbers drawn
    const idx = Math.floor(Math.random() * available.length);
    const number = available[idx];
    room.calledNumbers.add(number);
    return { number, calledNumbers: Array.from(room.calledNumbers) };
  }

  /**
   * Enqueue a ticket request for approval by the admin.
   */
  requestTicket(roomId, playerName) {
    const room = this.rooms[roomId];
    if (!room) throw new Error('Room not found');
    const requestId = uuidv4();
    room.ticketRequests.push({ requestId, playerName });
    return requestId;
  }

  /**
   * Approve or deny a pending ticket request.
   */
  approveTicket(roomId, requestId, approved) {
    const room = this.rooms[roomId];
    if (!room) throw new Error('Room not found');
    const idx = room.ticketRequests.findIndex(r => r.requestId === requestId);
    if (idx === -1) throw new Error('Request not found');
    const { playerName } = room.ticketRequests.splice(idx, 1)[0];
    if (!approved) return { approved: false };

    // Ensure player hasn't exceeded ticket limit
    const current = room.playerTickets[playerName] || [];
    if (current.length >= room.maxTicketsPerPlayer) {
      throw new Error('Ticket limit reached for player');
    }

    // Assign next available ticket
    const ticket = this.tickets.shift();
    room.playerTickets[playerName] = [...current, ticket];
    return { approved: true, tickets: room.playerTickets[playerName] };
  }

  /**
   * Submit a prize claim for admin verification.
   */
  submitClaim(roomId, playerName, claimType, numbers) {
    const room = this.rooms[roomId];
    if (!room) throw new Error('Room not found');
    const claimId = uuidv4();
    room.claims.push({ claimId, playerName, claimType, numbers, approved: null });
    return claimId;
  }

  /**
   * Verify (approve/deny) a pending claim.
   */
  verifyClaim(roomId, claimId, approved) {
    const room = this.rooms[roomId];
    if (!room) throw new Error('Room not found');
    const claim = room.claims.find(c => c.claimId === claimId);
    if (!claim) throw new Error('Claim not found');
    claim.approved = approved;
    return { claimId, approved, playerName: claim.playerName, claimType: claim.claimType };
  }
}

module.exports = TicketStore;
