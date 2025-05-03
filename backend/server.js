// ✅ Tambola Server - Clean & Modular Version
const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');
const { Server } = require('socket.io');
const { loadTickets } = require('./ticketStore');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.static(path.join(__dirname, '..', 'frontend')));

const PORT = process.env.PORT || 10000;

// 🎯 In-memory game state
let gameRooms = {};      // roomId → { players, tickets, numbers, ... }
let claims = {};         // roomId → list of pending claims
let intervals = {};      // roomId → setInterval reference
let ticketRequests = {}; // roomId → ticket request queue

// ✅ Load validated tickets once
const availableTickets = loadTickets();

// 🎮 Core Socket Logic
io.on('connection', socket => {
  // 📍 Admin creates game room
  socket.on('admin-connect', (roomId) => {
    socket.join(roomId);
    if (!gameRooms[roomId]) {
      gameRooms[roomId] = {
        players: [],
        tickets: [...availableTickets],
        calledNumbers: [],
        rules: [],
        limits: {},
        winners: []
      };
    }
    socket.emit('update-players', gameRooms[roomId].players.map(p => ({ id: p.id, name: p.name })));
    socket.emit('update-ticket-requests', ticketRequests[roomId] || []);
  });

  // 🙋 Player joins room
  socket.on('join-room', ({ roomId, playerName }) => {
    const room = gameRooms[roomId];
    if (!room) {
      socket.emit('room-error', 'Room does not exist. Please check with host.');
      return;
    }
    socket.join(roomId);
    const ticket = room.tickets.pop();
    const player = { id: socket.id, name: playerName, tickets: [ticket], pending: [] };
    room.players.push(player);
    socket.emit('ticket-assigned', player.tickets, player.pending);
    io.to(roomId).emit('update-players', room.players.map(p => ({ id: p.id, name: p.name })));
  });

  // ➕ Ticket Request
  socket.on('request-ticket', ({ roomId, playerName }) => {
    const room = gameRooms[roomId];
    const player = room?.players.find(p => p.id === socket.id);
    if (!room || !player || player.tickets.length + player.pending.length >= 5) return;

    const ticketNo = player.tickets.length + player.pending.length + 1;
    ticketRequests[roomId] = ticketRequests[roomId] || [];
    ticketRequests[roomId].push({ playerId: socket.id, playerName, ticketNo });
    player.pending.push(ticketNo);
    io.to(roomId).emit('update-ticket-requests', ticketRequests[roomId]);
    socket.emit('ticket-assigned', player.tickets, player.pending);
  });

  // ✅ Admin approves ticket request
  socket.on('admin-approve-ticket', ({ roomId, playerId }) => {
    const room = gameRooms[roomId];
    const player = room?.players.find(p => p.id === playerId);
    if (!room || !player || player.tickets.length >= 5) return;

    const ticket = room.tickets.pop();
    player.tickets.push(ticket);
    player.pending.shift();
    ticketRequests[roomId] = ticketRequests[roomId].filter(req => req.playerId !== playerId);

    io.to(playerId).emit('ticket-assigned', player.tickets, player.pending);
    io.to(roomId).emit('update-ticket-requests', ticketRequests[roomId]);
  });

  // ▶️ Admin starts game
  socket.on('admin-start', ({ roomId, mode, interval, rules, limits }) => {
    const room = gameRooms[roomId];
    if (!room) return;
    room.calledNumbers = [];
    room.rules = rules;
    room.limits = limits;
    room.winners = [];
    claims[roomId] = [];

    io.to(roomId).emit('admin-message', `Game started with rules: ${rules.join(', ')}`);

    if (mode === 'auto') {
      clearInterval(intervals[roomId]);
      intervals[roomId] = setInterval(() => {
        const next = callNextNumber(roomId);
        if (next) io.to(roomId).emit('number-called', next);
      }, interval);
    }
  });

  socket.on('admin-call-next', (roomId) => {
    const next = callNextNumber(roomId);
    if (next) io.to(roomId).emit('number-called', next);
  });

  // 🎯 Prize claim from player
  socket.on('claim-prize', ({ roomId, playerName, claimType, ticket }) => {
    const room = gameRooms[roomId];
    if (!room || !room.rules.includes(claimType)) {
      socket.emit('claim-result', { status: 'rejected', claimType, reason: 'Invalid claim type' });
      return;
    }

    const alreadyClaimed = claims[roomId]?.some(c => c.playerId === socket.id && c.claimType === claimType);
    if (alreadyClaimed) {
      socket.emit('claim-result', { status: 'rejected', claimType, reason: `Already claimed by ${playerName}` });
      return;
    }

    const maxReached = room.winners.filter(w => w.claimType === claimType).length >= room.limits[claimType];
    if (maxReached) {
      socket.emit('claim-result', { status: 'rejected', claimType, reason: 'Max winners reached' });
      return;
    }

    if (!validateClaim(ticket, claimType, room.calledNumbers)) {
      socket.emit('claim-result', { status: 'rejected', claimType, reason: 'Invalid claim on ticket' });
      return;
    }

    claims[roomId].push({ playerId: socket.id, playerName, claimType });
    room.winners.push({ playerId: socket.id, playerName, claimType });
    socket.emit('claim-result', { status: 'accepted', claimType });
    io.to(roomId).emit('update-claims', claims[roomId]);
  });

  socket.on('admin-accept-claim', ({ roomId, playerId, claimType }) => {
    io.to(playerId).emit('claim-result', { status: 'accepted', claimType });
    claims[roomId] = claims[roomId].filter(c => !(c.playerId === playerId && c.claimType === claimType));
    io.to(roomId).emit('update-claims', claims[roomId]);
  });

  socket.on('admin-reject-claim', ({ roomId, playerId, claimType }) => {
    io.to(playerId).emit('claim-result', { status: 'rejected', claimType });
    claims[roomId] = claims[roomId].filter(c => !(c.playerId === playerId && c.claimType === claimType));
    io.to(roomId).emit('update-claims', claims[roomId]);
  });

  socket.on('admin-stop', (roomId) => {
    if (intervals[roomId]) clearInterval(intervals[roomId]);
    io.to(roomId).emit('game-summary', gameRooms[roomId].winners || []);
  });
});

// 🔁 Utility - Random Number Call
function callNextNumber(roomId) {
  const room = gameRooms[roomId];
  if (!room || room.calledNumbers.length >= 90) return null;
  let next;
  do {
    next = Math.floor(Math.random() * 90) + 1;
  } while (room.calledNumbers.includes(next));
  room.calledNumbers.push(next);
  return next;
}

// ✅ Claim Validation
function validateClaim(ticket, type, called) {
  const top = ticket[0].filter(n => n !== 0);
  const mid = ticket[1].filter(n => n !== 0);
  const bot = ticket[2].filter(n => n !== 0);
  const flat = [...top, ...mid, ...bot];
  const corners = [ticket[0][0], ticket[0][8], ticket[2][0], ticket[2][8]].filter(n => n !== 0);

  if (type === 'Full House') return flat.every(n => called.includes(n));
  if (type === 'Top Line') return top.every(n => called.includes(n));
  if (type === 'Middle Line') return mid.every(n => called.includes(n));
  if (type === 'Bottom Line') return bot.every(n => called.includes(n));
  if (type === 'Corners') return corners.every(n => called.includes(n));
  return false;
}

// 🚀 Start Server
server.listen(PORT, () => console.log(`Tambola backend running at http://localhost:${PORT}`));
