// ========== BLOCK 1: Imports & Setup ==========
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const TicketStore = require('./ticketStore');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// ========== BLOCK 2: State ==========
const ticketStore = new TicketStore(path.join(__dirname, 'scripts', 'tickets.json'));
const pendingTicketRequests = {};
const pendingClaimRequests = {};

// ========== BLOCK 3: HTTP Endpoints ==========
app.get('/health', (req, res) => res.json({ status:'ok', time:new Date().toISOString() }));
app.get('/rooms/:roomId', (req, res) => {
  const rid = req.params.roomId.toUpperCase();
  ticketStore.roomExists(rid)? res.json({exists:true}) : res.status(404).json({error:'room not found'});
});
app.get('/tickets.json', (req, res) => res.sendFile(path.join(__dirname,'scripts','tickets.json')));

// ========== BLOCK 4: Socket.IO Handlers ==========
io.on('connection', socket => {

  // Create Room
  socket.on('create-room', (data, ack) => {
    try {
      const roomId = uuidv4().slice(0,6).toUpperCase();
      ticketStore.createRoom(roomId, data.maxTicketsPerPlayer);
      socket.join(roomId);
      ack({success:true, roomId});
      socket.emit('room-created', { roomId, adminName:data.adminName, maxTicketsPerPlayer:data.maxTicketsPerPlayer });
    } catch(err) { ack({success:false, error:err.message}); }
  });

  // Join Room
  socket.on('join-room', (data, ack) => {
    try {
      data.roomId = data.roomId.trim().toUpperCase();
      if(!data.roomId||!data.playerName) return ack({success:false,error:'roomId and playerName required'});
      if(!ticketStore.roomExists(data.roomId)) return ack({success:false,error:'room not found'});

      const room = ticketStore.rooms[data.roomId];
      if(!room.playerTickets[data.playerName]) room.playerTickets[data.playerName]=[];

      socket.join(data.roomId);
      ack({success:true,isAdmin:false});

      io.to(data.roomId).emit('player-joined', {
        roomId:data.roomId,
        playerName:data.playerName,
        players:Object.keys(room.playerTickets)
      });

      // Issue and auto-approve one ticket
      const reqId = ticketStore.requestTicket(data.roomId,data.playerName);
      const result = ticketStore.approveTicket(data.roomId,reqId,true);
      socket.emit('ticket-updated', {
        roomId:data.roomId,
        playerName:data.playerName,
        tickets:result.tickets
      });

    } catch(err){ ack({success:false,error:err.message}); }
  });

  // Call Number
  socket.on('call-number', (data, ack) => {
    try {
      data.roomId = data.roomId.trim().toUpperCase();
      if(!ticketStore.roomExists(data.roomId)) return ack({success:false,error:'room not found'});
      const result = ticketStore.drawNumber(data.roomId);
      if(!result) return ack({success:false,error:'All numbers have been drawn'});
      io.to(data.roomId).emit('number-called', { roomId:data.roomId, number:result.number, calledNumbers:result.calledNumbers });
      ack({success:true,number:result.number,calledNumbers:result.calledNumbers});
    } catch(err){ ack({success:false,error:err.message}); }
  });

  // Request Ticket
  socket.on('request-ticket', (data, ack) => {
    try {
      data.roomId = data.roomId.trim().toUpperCase();
      if(!ticketStore.roomExists(data.roomId)) return ack({success:false,error:'room not found'});
      const requestId = ticketStore.requestTicket(data.roomId, data.playerName);
      pendingTicketRequests[requestId] = { socketId:socket.id, playerName:data.playerName };
      ack({success:true,requestId});
      io.to(data.roomId).emit('ticket-requested', { roomId:data.roomId, requestId, playerName:data.playerName });
    } catch(err){ ack({success:false,error:err.message}); }
  });

  // Approve/Deny Ticket
  socket.on('approve-ticket', (data, ack) => {
    try {
      data.roomId = data.roomId.trim().toUpperCase();
      if(!ticketStore.roomExists(data.roomId)) return ack({success:false,error:'room not found'});
      const {requestId,approved} = data;
      const {socketId,playerName} = pendingTicketRequests[requestId]||{};
      const result = ticketStore.approveTicket(data.roomId,requestId,approved);
      ack({success:true});

      if(socketId){
        const payload = { roomId:data.roomId, requestId, approved };
        if(approved) payload.tickets = result.tickets;
        io.to(socketId).emit('ticket-request-response', payload);
        delete pendingTicketRequests[requestId];
      }

      // Broadcast updated tickets
      io.to(data.roomId).emit('ticket-updated', {
        roomId:data.roomId,
        playerName,
        tickets:result.tickets
      });

    } catch(err){ ack({success:false,error:err.message}); }
  });

  // Submit Claim
  socket.on('submit-claim', (data, ack) => {
    try {
      data.roomId = data.roomId.trim().toUpperCase();
      if(!ticketStore.roomExists(data.roomId)) return ack({success:false,error:'room not found'});
      const claimId = ticketStore.submitClaim(data.roomId,data.playerName,data.claimType,data.numbers);
      pendingClaimRequests[claimId] = { socketId:socket.id, playerName:data.playerName, claimType:data.claimType };
      ack({success:true,claimId});
      io.to(data.roomId).emit('claim-submitted', { roomId:data.roomId, claimId, playerName:data.playerName, claimType:data.claimType });
    } catch(err){ ack({success:false,error:err.message}); }
  });

  // Verify Claim
  socket.on('verify-claim', (data, ack) => {
    try {
      data.roomId = data.roomId.trim().toUpperCase();
      if(!ticketStore.roomExists(data.roomId)) return ack({success:false,error:'room not found'});
      const {socketId,playerName,claimType} = pendingClaimRequests[data.claimId]||{};
      const result = ticketStore.verifyClaim(data.roomId,data.claimId,data.approved);
      ack({success:true});
      if(socketId){
        io.to(socketId).emit('claim-updated',{ roomId:data.roomId,claimId:data.claimId,playerName,claimType,approved:data.approved });
        delete pendingClaimRequests[data.claimId];
      }
      io.to(data.roomId).emit('claim-updated',{ roomId:data.roomId,claimId:data.claimId,playerName,claimType,approved:data.approved });
    } catch(err){ ack({success:false,error:err.message}); }
  });

  // Auto-Mark toggle (no-op)
  socket.on('toggle-auto-mark',(data,ack)=>ack({success:true}));

});

// ========== BLOCK 5: Start Server ==========
const PORT = process.env.PORT||3000;
server.listen(PORT,()=>console.log(`Listening on ${PORT}`));
