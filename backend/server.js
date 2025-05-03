// Folder: tambola-project/backend
// File: server.js

// ========== Imports & Setup ==========
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const TicketStore = require('./ticketStore'); // In-memory ticket management

// ========== Initialize App, HTTP Server & Socket.IO ==========
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: process.env.FRONTEND_ORIGIN || '*' }
});

// ========== Load Tickets into Memory ==========
const ticketStore = new TicketStore(path.resolve(__dirname, 'scripts', 'tickets.json'));

// ========== HTTP Endpoints ==========
// Health-check endpoint\ napp.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Verify room exists (optional for debugging)
app.get('/rooms/:roomId', (req, res) => {
  const exists = ticketStore.roomExists(req.params.roomId);
  if (exists) return res.json({ exists: true });
  return res.status(404).json({ error: 'room not found' });
});

// Serve tickets.json statically
app.get('/tickets.json', (req, res) => {
  res.sendFile(path.resolve(__dirname, 'scripts', 'tickets.json'));
});

// ========== Socket.IO Event Handlers ==========
io.on('connection', (socket) => {

  // --- BLOCK 1: Join or Create Room ---
  socket.on('join-room', (data, ack) => {
    // TODO: validate data (roomId, playerName)
    // TODO: join the requested room and emit player-joined
  });

  socket.on('create-room', (data, ack) => {
    // TODO: generate new roomId, initialize room state, return roomId
  });

  // --- BLOCK 2: Number Calling ---
  socket.on('call-number', (data, ack) => {
    // TODO: draw random number from 1–90, ensure no repeats, broadcast number-called
  });

  // --- BLOCK 3: Ticket Requests ---
  socket.on('request-ticket', (data, ack) => {
    // TODO: enqueue the ticket request, notify admin via ticket-requested
  });

  socket.on('approve-ticket', (data, ack) => {
    // TODO: admin approves/denies request, update player tickets, emit ticket-request-response
  });

  // --- BLOCK 4: Prize Claims ---
  socket.on('submit-claim', (data, ack) => {
    // TODO: validate claimType & numbers, add to pending claims, emit claim-submitted
  });

  socket.on('verify-claim', (data, ack) => {
    // TODO: admin approves/denies claim, emit claim-updated
  });

  // --- BLOCK 5: Auto-Mark Toggle ---
  socket.on('toggle-auto-mark', (data, ack) => {
    // Update player auto-mark preference
    // No broadcast needed; ack immediately
    ack({ success: true });
  });

  // Handle unexpected disconnects
  socket.on('disconnect', () => {
    // TODO: cleanup socket-related state if necessary
  });
});

// ========== Start Server ==========
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Tambola server listening on port ${PORT}`);
});
