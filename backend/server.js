// ========== BLOCK 1: Imports & Setup ==========
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const TicketStore = require('./ticketStore');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: process.env.FRONTEND_ORIGIN || '*' }
});

// ========== BLOCK 2: State & Game Management ==========
const ticketStore = new TicketStore(path.join(__dirname, 'scripts', 'tickets.json'));

// Pending maps for ticket/claim flows
const pendingTicketRequests = {};
const pendingClaimRequests   = {};

// Per‐room game state
const gameRooms = {};  
// Structure:
// gameRooms[roomId] = {
//   state:    'stopped'|'running'|'paused',
//   rules:    { 'Top Line':bool, 'Two Lines':bool, 'Full House':bool },
//   maxPrizes:{ 'Top Line':number, … },
//   mode:     'Manual'|'Auto',
//   interval: seconds,
//   intervalId: NodeJS.Timer|null,
//   winners:  [ { playerName, prizeType }, … ]
// }

// ========== BLOCK 3: HTTP Endpoints ==========
app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.get('/rooms/:roomId', (req, res) => {
  const rid = req.params.roomId.toUpperCase();
  if (ticketStore.roomExists(rid)) return res.json({ exists: true });
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

      // initialize game state
      gameRooms[roomId] = {
        state: 'stopped',
        rules: { 'Top Line': false, 'Two Lines': false, 'Full House': false },
        maxPrizes: { 'Top Line': 1, 'Two Lines': 1, 'Full House': 1 },
        mode: 'Manual',
        interval: 3,
        intervalId: null,
        winners: []
      };

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
      data.roomId = data.roomId.trim().toUpperCase();
      if (!data.roomId || !data.playerName) {
        return ack({ success: false, error: 'roomId and playerName required' });
      }
      if (!ticketStore.roomExists(data.roomId)) {
        return ack({ success: false, error: 'room not found' });
      }

      const room = ticketStore.rooms[data.roomId];
      if (!room.playerTickets[data.playerName]) {
        room.playerTickets[data.playerName] = [];
      }

      socket.join(data.roomId);
      ack({ success: true, isAdmin: false });

      io.to(data.roomId).emit('player-joined', {
        roomId: data.roomId,
        playerName: data.playerName,
        players: Object.keys(room.playerTickets)
      });

      // issue + auto‐approve one ticket
      const reqId = ticketStore.requestTicket(data.roomId, data.playerName);
      const result = ticketStore.approveTicket(data.roomId, reqId, true);
      socket.emit('ticket-updated', {
        roomId: data.roomId,
        playerName: data.playerName,
        tickets: result.tickets
      });

    } catch (err) {
      ack({ success: false, error: err.message });
    }
  });

  // --- BLOCK 4.3: Call Number (Manual) ---
  socket.on('call-number', (data, ack) => {
    try {
      data.roomId = data.roomId.trim().toUpperCase();
      if (!ticketStore.roomExists(data.roomId)) {
        return ack({ success: false, error: 'room not found' });
      }
      const result = ticketStore.drawNumber(data.roomId);
      if (!result) {
        return ack({ success: false, error: 'All numbers have been drawn' });
      }

      io.to(data.roomId).emit('number-called', {
        roomId: data.roomId,
        number: result.number,
        calledNumbers: result.calledNumbers
      });

      ack({ success: true, number: result.number, calledNumbers: result.calledNumbers });
    } catch (err) {
      ack({ success: false, error: err.message });
    }
  });

  // --- BLOCK 4.4: Auto-Caller Pause/Resume Controls ---
  socket.on('pause-auto', (data, ack) => {
    const rid = data.roomId.trim().toUpperCase();
    const gr = gameRooms[rid];
    if (gr && gr.intervalId) {
      clearInterval(gr.intervalId);
      gr.intervalId = null;
      gr.state = 'paused';
      io.to(rid).emit('auto-paused');
      return ack({ success: true });
    }
    ack({ success: false, error: 'not running' });
  });

  socket.on('resume-auto', (data, ack) => {
    const rid = data.roomId.trim().toUpperCase();
    const gr = gameRooms[rid];
    if (gr && gr.state === 'paused') {
      gr.state = 'running';
      gr.intervalId = setInterval(() => {
        const result = ticketStore.drawNumber(rid);
        if (!result) {
          clearInterval(gr.intervalId);
          gr.intervalId = null;
          io.to(rid).emit('auto-finished');
          return;
        }
        io.to(rid).emit('number-called', {
          roomId: rid,
          number: result.number,
          calledNumbers: result.calledNumbers
        });
      }, gr.interval * 1000);
      io.to(rid).emit('auto-resumed');
      return ack({ success: true });
    }
    ack({ success: false, error: 'not paused' });
  });

  // --- BLOCK 4.5: Start-Game & Stop-Game ---
  socket.on('start-game', (data, ack) => {
    try {
      const rid = data.roomId.trim().toUpperCase();
      if (!ticketStore.roomExists(rid)) {
        return ack({ success: false, error: 'room not found' });
      }
      const gr = gameRooms[rid];
      // validate at least one rule
      const any = Object.values(data.rules).some(v => v);
      if (!any) return ack({ success: false, error: 'select at least one prize rule' });

      // apply settings
      gr.rules     = data.rules;
      gr.maxPrizes = data.maxPrizes;
      gr.mode      = data.mode;
      gr.interval  = data.interval;
      gr.state     = 'running';
      gr.winners   = [];

      // clear any prior timer
      if (gr.intervalId) clearInterval(gr.intervalId);

      // start auto‐caller if needed
      if (gr.mode === 'Auto') {
        gr.intervalId = setInterval(() => {
          const result = ticketStore.drawNumber(rid);
          if (!result) {
            clearInterval(gr.intervalId);
            gr.intervalId = null;
            io.to(rid).emit('auto-finished');
            return;
          }
          io.to(rid).emit('number-called', {
            roomId: rid,
            number: result.number,
            calledNumbers: result.calledNumbers
          });
        }, gr.interval * 1000);
      }

      io.to(rid).emit('game-started', {
        roomId: rid,
        rules: data.rules,
        maxPrizes: data.maxPrizes,
        mode: data.mode,
        interval: data.interval
      });
      ack({ success: true });
    } catch (err) {
      ack({ success: false, error: err.message });
    }
  });

  socket.on('stop-game', (data, ack) => {
    try {
      const rid = data.roomId.trim().toUpperCase();
      const gr = gameRooms[rid];
      if (!gr) return ack({ success: false, error: 'room not found' });

      // clear any auto timer
      if (gr.intervalId) {
        clearInterval(gr.intervalId);
        gr.intervalId = null;
      }
      gr.state = 'stopped';

      // gather summary
      const calledNumbers = ticketStore.rooms[rid].calledNumbers || [];
      const winners = gr.winners;

      io.to(rid).emit('game-summary', { roomId: rid, calledNumbers, winners });
      return ack({ success: true });
    } catch (err) {
      ack({ success: false, error: err.message });
    }
  });

  // --- BLOCK 4.6: Request Ticket ---
  socket.on('request-ticket', (data, ack) => {
    try {
      const rid = data.roomId.trim().toUpperCase();
      if (!ticketStore.roomExists(rid)) {
        return ack({ success: false, error: 'room not found' });
      }
      const requestId = ticketStore.requestTicket(rid, data.playerName);
      pendingTicketRequests[requestId] = {
        socketId: socket.id,
        playerName: data.playerName
      };
      ack({ success: true, requestId });
      io.to(rid).emit('ticket-requested', {
        roomId: rid,
        requestId,
        playerName: data.playerName
      });
    } catch (err) {
      ack({ success: false, error: err.message });
    }
  });

  // --- BLOCK 4.7: Approve / Deny Ticket ---
  socket.on('approve-ticket', (data, ack) => {
    try {
      const rid = data.roomId.trim().toUpperCase();
      if (!ticketStore.roomExists(rid)) {
        return ack({ success: false, error: 'room not found' });
      }
      const { requestId, approved } = data;
      const { socketId, playerName } = pendingTicketRequests[requestId] || {};

      const result = ticketStore.approveTicket(rid, requestId, approved);
      ack({ success: true });

      if (socketId) {
        const payload = { roomId: rid, requestId, approved };
        if (approved) payload.tickets = result.tickets;
        io.to(socketId).emit('ticket-request-response', payload);
        delete pendingTicketRequests[requestId];
      }

      if (approved) {
        io.to(rid).emit('ticket-updated', {
          roomId: rid,
          playerName,
          tickets: result.tickets
        });
      }
    } catch (err) {
      ack({ success: false, error: err.message });
    }
  });

  // --- BLOCK 4.8: Submit Claim ---
  socket.on('submit-claim', (data, ack) => {
    try {
      const rid = data.roomId.trim().toUpperCase();
      if (!ticketStore.roomExists(rid)) {
        return ack({ success: false, error: 'room not found' });
      }
      const { playerName, claimType, numbers } = data;
      const claimId = ticketStore.submitClaim(rid, playerName, claimType, numbers);
      pendingClaimRequests[claimId] = { socketId: socket.id, playerName, claimType };
      ack({ success: true, claimId });
      io.to(rid).emit('claim-submitted', {
        roomId: rid,
        claimId,
        playerName,
        claimType,
        numbers
      });
    } catch (err) {
      ack({ success: false, error: err.message });
    }
  });

  // --- BLOCK 4.9: Approve / Deny Claim ---
  socket.on('verify-claim', (data, ack) => {
    try {
      const rid = data.roomId.trim().toUpperCase();
      if (!ticketStore.roomExists(rid)) {
        return ack({ success: false, error: 'room not found' });
      }
      const { claimId, approved } = data;
      const { socketId, playerName, claimType } = pendingClaimRequests[claimId] || {};

      const result = ticketStore.verifyClaim(rid, claimId, approved);
      ack({ success: true });

      // record winner if approved
      if (approved) {
        gameRooms[rid].winners.push({ playerName, prizeType: claimType });
      }

      if (socketId) {
        io.to(socketId).emit('claim-updated', {
          roomId: rid,
          claimId,
          playerName,
          claimType,
          approved
        });
        delete pendingClaimRequests[claimId];
      }

      io.to(rid).emit('claim-updated', {
        roomId: rid,
        claimId,
        playerName,
        claimType,
        approved
      });
    } catch (err) {
      ack({ success: false, error: err.message });
    }
  });

  // --- DISCONNECT CLEANUP ---
  socket.on('disconnect', () => {
    // optional: remove any pending requests tied to this socket
  });
});

// ========== BLOCK 5: Start Server ==========
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Tambola server listening on port ${PORT}`);
});
