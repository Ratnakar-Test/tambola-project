// File: tambola-project/backend/server.js

// ========== BLOCK 1: Imports & Setup ==========
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');               // For room IDs
const TicketStore = require('./ticketStore');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: process.env.FRONTEND_ORIGIN || '*' }
});

// ========== BLOCK 2: State & Ticket Store ==========
const ticketStore = new TicketStore(path.join(__dirname, 'scripts', 'tickets.json'));

// Map requestId → { socketId, playerName }
const pendingTicketRequests = {};
// Map claimId   → { socketId, playerName, claimType }
const pendingClaimRequests = {};

// ========== BLOCK 3: HTTP Endpoints ==========
app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.get('/rooms/:roomId', (req, res) => {
  if (ticketStore.roomExists(req.params.roomId)) {
    return res.json({ exists: true });
  }
  res.status(404).json({ error: 'room not found' });
});

app.get('/tickets.json', (req, res) => {
  res.sendFile(path.join(__dirname, 'scripts', 'tickets.json'));
});

// ========== BLOCK 4: Socket.IO Handlers ==========
io.on('connection', (socket) => {

  // --- BLOCK 4.1: Create Room ---
  socket.on('create-room', (data, ack) => {
    try {
      const roomId = uuidv4().slice(0, 6).toUpperCase();
      ticketStore.createRoom(roomId, data.maxTicketsPerPlayer);
      socket.join(roomId);
      ack({ success: true, roomId });
      socket.emit('room-created', {
        roomId,
        adminName: data.adminName,
        maxTicketsPerPlayer: data.maxTicketsPerPlayer
      });
    } catch (err) {
      ack({ success: false, error: err.message });
    }
  });

  // --- BLOCK 4.2: Join Room ---
  socket.on('join-room', (data, ack) => {
    try {
      if (!data.roomId || !data.playerName) {
        return ack({ success: false, error: 'roomId and playerName required' });
      }
      if (!ticketStore.roomExists(data.roomId)) {
        return ack({ success: false, error: 'room not found' });
      }

      // Register player if new
      const room = ticketStore.rooms[data.roomId];
      if (!room.playerTickets[data.playerName]) {
        room.playerTickets[data.playerName] = [];
      }

      socket.join(data.roomId);
      ack({ success: true, isAdmin: false });

      // Notify everyone in room
      io.to(data.roomId).emit('player-joined', {
        roomId: data.roomId,
        playerName: data.playerName,
        players: Object.keys(room.playerTickets)
      });

+     // ←← NEW: send this player's existing tickets immediately
+     socket.emit('ticket-updated', {
+       roomId: data.roomId,
+       playerName: data.playerName,
+       tickets: room.playerTickets[data.playerName]
+     });

    } catch (err) {
      ack({ success: false, error: err.message });
    }
  });


  // --- BLOCK 4.3: Call Number ---
  socket.on('call-number', (data, ack) => {
    try {
      if (!ticketStore.roomExists(data.roomId)) {
        return ack({ success: false, error: 'room not found' });
      }
      const result = ticketStore.drawNumber(data.roomId);
      if (!result) {
        return ack({ success: false, error: 'All numbers have been drawn' });
      }
      const { number, calledNumbers } = result;

      // Broadcast to room
      io.to(data.roomId).emit('number-called', {
        roomId: data.roomId,
        number,
        calledNumbers
      });

      ack({ success: true, number, calledNumbers });
    } catch (err) {
      ack({ success: false, error: err.message });
    }
  });

  // --- BLOCK 4.4: Request Ticket ---
  socket.on('request-ticket', (data, ack) => {
    try {
      if (!ticketStore.roomExists(data.roomId)) {
        return ack({ success: false, error: 'room not found' });
      }
      const requestId = ticketStore.requestTicket(data.roomId, data.playerName);
      // Track requester
      pendingTicketRequests[requestId] = {
        socketId: socket.id,
        playerName: data.playerName
      };

      ack({ success: true, requestId });

      // Notify admin(s)
      io.to(data.roomId).emit('ticket-requested', {
        roomId: data.roomId,
        requestId,
        playerName: data.playerName
      });
    } catch (err) {
      ack({ success: false, error: err.message });
    }
  });

  // --- BLOCK 4.5: Approve / Deny Ticket ---
  socket.on('approve-ticket', (data, ack) => {
    try {
      if (!ticketStore.roomExists(data.roomId)) {
        return ack({ success: false, error: 'room not found' });
      }
      const { requestId, approved } = data;
      const { socketId, playerName } = pendingTicketRequests[requestId] || {};

      const result = ticketStore.approveTicket(data.roomId, requestId, approved);
      ack({ success: true });

      // Notify the requesting player only
      if (socketId) {
        const payload = {
          roomId: data.roomId,
          requestId,
          approved
        };
        if (approved) {
          payload.tickets = result.tickets;
        }
        io.to(socketId).emit('ticket-request-response', payload);
        delete pendingTicketRequests[requestId];
      }

      // Broadcast updated tickets list to room
      if (approved) {
        io.to(data.roomId).emit('ticket-updated', {
          roomId: data.roomId,
          playerName,
          tickets: result.tickets
        });
      }
    } catch (err) {
      ack({ success: false, error: err.message });
    }
  });

  // --- BLOCK 4.6: Submit Claim ---
  socket.on('submit-claim', (data, ack) => {
    try {
      if (!ticketStore.roomExists(data.roomId)) {
        return ack({ success: false, error: 'room not found' });
      }
      const { playerName, claimType, numbers } = data;
      const claimId = ticketStore.submitClaim(
        data.roomId,
        playerName,
        claimType,
        numbers
      );
      // Track requester
      pendingClaimRequests[claimId] = {
        socketId: socket.id,
        playerName,
        claimType
      };

      ack({ success: true, claimId });

      // Notify admin(s)
      io.to(data.roomId).emit('claim-submitted', {
        roomId: data.roomId,
        claimId,
        playerName,
        claimType,
        numbers
      });
    } catch (err) {
      ack({ success: false, error: err.message });
    }
  });

  // --- BLOCK 4.7: Approve / Deny Claim ---
  socket.on('verify-claim', (data, ack) => {
    try {
      if (!ticketStore.roomExists(data.roomId)) {
        return ack({ success: false, error: 'room not found' });
      }
      const { claimId, approved } = data;
      const { socketId, playerName, claimType } = pendingClaimRequests[claimId] || {};

      const result = ticketStore.verifyClaim(data.roomId, claimId, approved);
      ack({ success: true });

      // Notify the claiming player only
      if (socketId) {
        io.to(socketId).emit('claim-updated', {
          roomId: data.roomId,
          claimId,
          playerName,
          claimType,
          approved
        });
        delete pendingClaimRequests[claimId];
      }

      // Broadcast to room for admin’s winners list
      io.to(data.roomId).emit('claim-updated', {
        roomId: data.roomId,
        claimId,
        playerName,
        claimType,
        approved
      });
    } catch (err) {
      ack({ success: false, error: err.message });
    }
  });

  // --- BLOCK 4.8: Toggle Auto-Mark (no-op) ---
  socket.on('toggle-auto-mark', (data, ack) => {
    ack({ success: true });
  });

  // --- DISCONNECT CLEANUP ---
  socket.on('disconnect', () => {
    // (Optional) Clean up any pending requests tied to this socket
  });
});

// ========== BLOCK 5: Start Server ==========
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Tambola server listening on port ${PORT}`);
});
