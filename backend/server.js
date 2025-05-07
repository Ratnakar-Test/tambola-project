// ========== BLOCK 1: Imports & Setup ==========
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const TicketStore = require('./ticketStore'); // Path to your ticketStore.js

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: process.env.FRONTEND_ORIGIN || '*' }
});

// ========== BLOCK 2: State & Game Management ==========
// Path to tickets.json should be relative to ticketStore.js if it's hardcoded there,
// or relative to server.js if ticketStore.js expects an absolute path or path relative to itself.
// Assuming ticketStore.js resolves 'scripts/tickets.json' relative to its own location.
const ticketStore = new TicketStore('scripts/tickets.json');

const gameRooms = {};
// Structure for gameRooms[roomId]:
// {
//   roomId: string,
//   adminName: string,
//   adminSocketId: string | null,
//   state: 'stopped' | 'running' | 'paused' | 'finished',
//   rules: { 'Top Line': boolean, ... },
//   maxPrizes: { 'Top Line': number, ... },
//   claimedPrizesCount: { 'Top Line': number, ... },
//   mode: 'Manual' | 'Auto',
//   interval: number,
//   intervalId: NodeJS.Timeout | null,
//   winners: Array<{ playerName: string, prizeType: string }>,
//   maxTicketsPerPlayer: number,
//   players: { [playerName: string]: { socketId: string, name: string, ticketsIssued: number } },
//   availableNumbers: Array<number>, // Numbers not yet called in this game instance
//   pendingTicketRequests: { [requestId: string]: { socketId: string, playerName: string, requestId: string } },
//   pendingClaimRequests: { // Claims validated by server, awaiting admin verification
//       [claimId: string]: { 
//           socketId: string, 
//           playerName: string, 
//           claimType: string, 
//           claimId: string, 
//           validatedTicketGrid?: any, // from ticketStore.isValidClaim
//           validatedNumbers?: number[]   // from ticketStore.isValidClaim
//       } 
//   }
// }

function getRoomOrAckError(roomId, socket, ack, errorMessagePrefix = "Operation failed") {
    const room = gameRooms[roomId];
    if (!room) {
        const errorMsg = `${errorMessagePrefix}: Room ${roomId} not found.`;
        if (ack) ack({ success: false, error: errorMsg });
        else socket.emit('room-error', { error: errorMsg });
        return null;
    }
    return room;
}

function isAdmin(socketId, room) {
    return room && room.adminSocketId === socketId;
}


// ========== BLOCK 3: HTTP Endpoints ==========
app.get('/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString(), activeRooms: Object.keys(gameRooms).length });
});

app.get('/api/room/:roomId/exists', (req, res) => {
    const rid = req.params.roomId.trim().toUpperCase();
    if (gameRooms[rid]) {
        res.json({ exists: true, gameState: gameRooms[rid].state, roomName: gameRooms[rid].adminName + "'s Room" });
    } else {
        res.status(404).json({ exists: false, error: 'Room not found' });
    }
});


// ========== BLOCK 4: Socket.IO Handlers ==========
io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    socket.on('create-room', (data, ack) => {
        try {
            if (!data.adminName || !data.rules || !data.maxPrizes || !data.maxTicketsPerPlayer) {
                return ack({ success: false, error: 'Missing required data for room creation.' });
            }
            if (Object.keys(data.rules).length === 0) {
                 return ack({ success: false, error: 'At least one prize rule must be selected.' });
            }

            const roomId = uuidv4().slice(0, 6).toUpperCase();
            ticketStore.createRoom(roomId, data.maxTicketsPerPlayer); // Initialize in TicketStore

            gameRooms[roomId] = {
                roomId: roomId,
                adminName: data.adminName,
                adminSocketId: socket.id,
                state: 'stopped',
                rules: data.rules,
                maxPrizes: data.maxPrizes,
                claimedPrizesCount: Object.keys(data.rules).reduce((acc, rule) => {
                    if (data.rules[rule]) acc[rule] = 0; return acc;
                }, {}),
                mode: 'Manual', interval: 5, intervalId: null,
                winners: [],
                maxTicketsPerPlayer: parseInt(data.maxTicketsPerPlayer, 10),
                players: {},
                availableNumbers: Array.from({ length: 90 }, (_, i) => i + 1),
                pendingTicketRequests: {}, pendingClaimRequests: {}
            };

            socket.join(roomId);
            ack({ success: true, roomId: roomId });
            socket.emit('room-created', { /* ... same data as before ... */ 
                roomId: roomId, adminName: data.adminName, rules: data.rules, 
                maxPrizes: data.maxPrizes, maxTicketsPerPlayer: data.maxTicketsPerPlayer
            });
            console.log(`Room ${roomId} created by admin ${data.adminName}`);
        } catch (err) {
            console.error('Create room error:', err);
            ack({ success: false, error: err.message || 'Server error creating room.' });
        }
    });

    socket.on('join-room', (data, ack) => {
        try {
            const { roomId, playerName, isAdmin: isAdminJoinAttempt } = data;
            if (!roomId || !playerName) return ack({ success: false, error: 'Room ID and Name required.' });
            
            const rid = roomId.trim().toUpperCase();
            const room = gameRooms[rid];
            if (!room) return ack({ success: false, error: `Room ${rid} not found.` });

            if (isAdminJoinAttempt && playerName === room.adminName) {
                room.adminSocketId = socket.id;
                socket.join(rid);
                ack({ success: true, isAdmin: true });
                socket.emit('admin-rejoined', {
                    roomId: rid, adminName: room.adminName,
                    gameState: { state: room.state, calledNumbers: ticketStore.getCalledNumbers(rid), rules: room.rules, maxPrizes: room.maxPrizes, mode: room.mode, interval: room.interval, winners: room.winners },
                    players: Object.values(room.players).map(p => ({ name: p.name, ticketCount: p.ticketsIssued })),
                    ticketRequests: Object.values(room.pendingTicketRequests),
                    prizeClaims: Object.values(room.pendingClaimRequests).map(c => ({claimId: c.claimId, playerName: c.playerName, claimType: c.claimType})), // Don't send full details like socketId
                    maxTicketsPerPlayer: room.maxTicketsPerPlayer
                });
                return;
            }
            
            if (room.players[playerName] && room.players[playerName].socketId !== socket.id) {
                 return ack({ success: false, error: `Player name "${playerName}" is taken.` });
            }
            if (room.state === 'finished') {
                return ack({ success: false, error: 'This game has finished. Cannot join.'});
            }

            if (!room.players[playerName]) {
                 room.players[playerName] = { socketId: socket.id, name: playerName, ticketsIssued: 0 };
            } else {
                room.players[playerName].socketId = socket.id; // Update socket on rejoin
            }

            socket.join(rid);
            const playerCurrentTickets = ticketStore.getPlayerTicketGrids(rid, playerName);
            ack({ success: true, isAdmin: false, tickets: playerCurrentTickets, calledNumbers: ticketStore.getCalledNumbers(rid), gameState: { state: room.state }, prizeTypes: Object.keys(room.rules).filter(r => room.rules[r]) });
            
            const playersList = Object.values(room.players).map(p => ({ name: p.name, ticketCount: p.ticketsIssued }));
            io.to(rid).emit('player-joined', { roomId: rid, playerName, playersList });

            // Auto-issue one ticket on first join if player has none and game not started
            if (room.players[playerName].ticketsIssued === 0 && (room.state === 'stopped' || room.state === 'running') /* Allow ticket if running too */) {
                const ticketResult = ticketStore.generateTicketsForPlayer(rid, playerName, 1);
                if (ticketResult.success && ticketResult.tickets.length > 0) {
                    room.players[playerName].ticketsIssued += ticketResult.tickets.length;
                    socket.emit('ticket-updated', { roomId: rid, playerName: playerName, tickets: ticketResult.tickets });
                    io.to(rid).emit('player-list-updated', { playersList: Object.values(room.players).map(p => ({ name: p.name, ticketCount: p.ticketsIssued })) });
                }
            }

        } catch (err) {
            console.error('Join room error:', err);
            ack({ success: false, error: err.message || 'Server error joining room.' });
        }
    });

    socket.on('start-game', (data, ack) => {
        const room = getRoomOrAckError(data.roomId, socket, ack);
        if (!room || !isAdmin(socket.id, room)) return ack({ success: false, error: 'Unauthorized.' });
        if (room.state !== 'stopped') return ack({ success: false, error: 'Game not in stopped state.' });
        if (!data.rules || Object.keys(data.rules).filter(k => data.rules[k]).length === 0) return ack({ success: false, error: 'Select prize rules.' });

        ticketStore.resetRoomForNewGame(data.roomId); // Reset TicketStore for this room
        room.state = 'running';
        room.rules = data.rules;
        room.maxPrizes = data.maxPrizes;
        room.claimedPrizesCount = Object.keys(data.rules).reduce((acc, rule) => { if (data.rules[rule]) acc[rule] = 0; return acc; }, {});
        room.mode = data.mode || 'Manual';
        room.interval = data.interval || 5;
        room.winners = [];
        room.availableNumbers = Array.from({ length: 90 }, (_, i) => i + 1); // Reset server's list too

        if (room.intervalId) clearInterval(room.intervalId);
        if (room.mode === 'Auto') {
            room.intervalId = setInterval(() => autoCallNextNumber(data.roomId), room.interval * 1000);
        }
        io.to(data.roomId).emit('game-started', { /* ... same data ... */ 
            roomId: data.roomId, rules: room.rules, maxPrizes: room.maxPrizes, mode: room.mode, interval: room.interval
        });
        ack({ success: true });
    });

    function callNextNumberLogic(roomId) {
        const room = gameRooms[roomId];
        if (!room || room.state !== 'running') return null;
        // Use room.availableNumbers, which is now managed by server.js
        const drawResult = ticketStore.drawNumber(roomId, room.availableNumbers); // Pass availableNumbers
        if (!drawResult) {
            if (room.intervalId) clearInterval(room.intervalId);
            room.intervalId = null;
            io.to(roomId).emit('auto-finished');
            if (room.state !== 'finished') emitGameSummary(roomId); // Ensure summary if all numbers drawn
            return null;
        }
        // room.availableNumbers is modified by drawNumber directly
        io.to(roomId).emit('number-called', { roomId, number: drawResult.number, calledNumbers: drawResult.calledNumbers });
        return drawResult;
    }

    function autoCallNextNumber(roomId) {
        const room = gameRooms[roomId];
        if (!room || room.state !== 'running' || room.mode !== 'Auto') {
            if (room && room.intervalId) clearInterval(room.intervalId); return;
        }
        callNextNumberLogic(roomId);
    }

    socket.on('manual-call-next', (data, ack) => {
        const room = getRoomOrAckError(data.roomId, socket, ack);
        if (!room || !isAdmin(socket.id, room)) return ack({ success: false, error: 'Unauthorized.' });
        if (room.state !== 'running' || room.mode !== 'Manual') return ack({ success: false, error: 'Not in manual running mode.' });
        
        const result = callNextNumberLogic(data.roomId);
        if (!result) ack({ success: false, error: room.availableNumbers.length === 0 ? 'All numbers drawn.' : 'Draw failed.' });
        else ack({ success: true, number: result.number, calledNumbers: result.calledNumbers });
    });
    
    socket.on('admin-toggle-number', (data, ack) => {
        const room = getRoomOrAckError(data.roomId, socket, ack);
        if (!room || !isAdmin(socket.id, room)) return ack({ success: false, error: 'Unauthorized.' });
        if (room.state !== 'running' && room.state !== 'paused') return ack({ success: false, error: 'Game not active.' });

        const { number, shouldBeCalled } = data;
        const num = parseInt(number, 10);
        if (isNaN(num) || num < 1 || num > 90) return ack({ success: false, error: 'Invalid number.' });

        const calledNumbersSet = ticketStore.getCalledNumbers(data.roomId); // Get from store
        const isCurrentlyCalled = calledNumbersSet.includes(num);
        let changed = false;

        // This logic needs to update TicketStore's calledNumbers and server.js's availableNumbers
        // For simplicity, we'll assume TicketStore's calledNumbers is the source of truth after this operation
        // And server.js availableNumbers will be re-derived if needed, or managed carefully.
        // The current ticketStore.drawNumber() already modifies the availableNumbers array passed to it.
        // For admin toggle, we need a way to "undraw" or "force draw".

        // Let's simplify: admin toggle directly manipulates the server's view, which then syncs.
        // TicketStore's calledNumbers will be updated via its draw/reset methods.
        // For admin toggle, it's more about correcting the game state.

        if (shouldBeCalled && !room.availableNumbers.includes(num)) { // Trying to call a number that's already called (or invalid)
             // No, this means it's NOT available, so it IS called.
        }


        if (shouldBeCalled && room.availableNumbers.includes(num)) { // Call it
            room.availableNumbers.splice(room.availableNumbers.indexOf(num), 1);
            ticketStore.rooms[data.roomId].calledNumbers.add(num); // Sync with store
            changed = true;
        } else if (!shouldBeCalled && !room.availableNumbers.includes(num)) { // Un-call it (it was called)
            room.availableNumbers.push(num);
            room.availableNumbers.sort((a,b) => a-b);
            ticketStore.rooms[data.roomId].calledNumbers.delete(num); // Sync with store
            changed = true;
        }
        
        if (changed) {
            const currentCalled = ticketStore.getCalledNumbers(data.roomId);
            io.to(data.roomId).emit('number-called', { roomId: data.roomId, number: num, calledNumbers: currentCalled });
        }
        ack({ success: true });
    });


    socket.on('pause-auto', (data, ack) => { /* ... same as before ... */ 
        const room = getRoomOrAckError(data.roomId, socket, ack);
        if (!room || !isAdmin(socket.id, room)) return ack({ success: false, error: 'Unauthorized.' });
        if (room.mode !== 'Auto' || room.state !== 'running' || !room.intervalId) return ack({ success: false, error: 'Not in auto-running mode or timer not active.' });
        clearInterval(room.intervalId); room.intervalId = null; room.state = 'paused';
        io.to(data.roomId).emit('auto-paused'); ack({ success: true });
    });
    socket.on('resume-auto', (data, ack) => { /* ... same as before ... */ 
        const room = getRoomOrAckError(data.roomId, socket, ack);
        if (!room || !isAdmin(socket.id, room)) return ack({ success: false, error: 'Unauthorized.' });
        if (room.mode !== 'Auto' || room.state !== 'paused') return ack({ success: false, error: 'Not in auto-paused mode.' });
        room.state = 'running'; room.intervalId = setInterval(() => autoCallNextNumber(data.roomId), room.interval * 1000);
        io.to(data.roomId).emit('auto-resumed'); ack({ success: true });
    });

    function emitGameSummary(roomId) { /* ... same as before ... */ 
        const room = gameRooms[roomId]; if (!room) return;
        if (room.intervalId) { clearInterval(room.intervalId); room.intervalId = null; }
        room.state = 'finished';
        io.to(roomId).emit('game-summary', { roomId, calledNumbers: ticketStore.getCalledNumbers(roomId), winners: room.winners });
        console.log(`Game summary for room ${roomId}. Winners: ${room.winners.length}`);
    }
    socket.on('stop-game', (data, ack) => { /* ... same as before ... */ 
        const room = getRoomOrAckError(data.roomId, socket, ack);
        if (!room || !isAdmin(socket.id, room)) return ack({ success: false, error: 'Unauthorized.' });
        if (room.state === 'stopped' || room.state === 'finished') return ack({ success: false, error: 'Game not active.' });
        emitGameSummary(data.roomId); ack({ success: true });
    });

    socket.on('request-ticket', (data, ack) => {
        const room = getRoomOrAckError(data.roomId, socket, ack);
        if (!room) return;
        if (room.state === 'finished') return ack({ success: false, error: 'Game finished, cannot request tickets.' });

        const player = room.players[data.playerName];
        if (!player || player.socketId !== socket.id) return ack({ success: false, error: 'Player mismatch.' });
        if (player.ticketsIssued >= room.maxTicketsPerPlayer) return ack({ success: false, error: `Ticket limit reached.` });

        const requestId = `TR-${uuidv4().slice(0, 8)}`;
        room.pendingTicketRequests[requestId] = { socketId: socket.id, playerName: data.playerName, requestId };
        ack({ success: true, requestId });
        if (room.adminSocketId) io.to(room.adminSocketId).emit('ticket-requested', { roomId: data.roomId, requestId, playerName: data.playerName });
    });

    socket.on('approve-ticket', (data, ack) => {
        const room = getRoomOrAckError(data.roomId, socket, ack);
        if (!room || !isAdmin(socket.id, room)) return ack({ success: false, error: 'Unauthorized.' });

        const { requestId, approved } = data;
        const requestDetails = room.pendingTicketRequests[requestId];
        if (!requestDetails) return ack({ success: false, error: 'Request not found.' });
        
        delete room.pendingTicketRequests[requestId];
        const { socketId: playerSocketId, playerName } = requestDetails;

        if (approved) {
            const player = room.players[playerName];
            if (player && player.ticketsIssued < room.maxTicketsPerPlayer) {
                const ticketResult = ticketStore.generateTicketsForPlayer(data.roomId, playerName, 1);
                if (ticketResult.success && ticketResult.tickets.length > 0) {
                    player.ticketsIssued += ticketResult.tickets.length;
                    io.to(playerSocketId).emit('ticket-request-response', { roomId: data.roomId, requestId, approved: true });
                    io.to(playerSocketId).emit('ticket-updated', { roomId: data.roomId, playerName, tickets: ticketResult.tickets });
                    socket.emit('ticket-request-resolved', {requestId, approved: true, playerName});
                    io.to(data.roomId).emit('player-list-updated', { playersList: Object.values(room.players).map(p => ({ name: p.name, ticketCount: p.ticketsIssued })) });
                } else {
                    io.to(playerSocketId).emit('ticket-request-response', { roomId: data.roomId, requestId, approved: false, error: ticketResult.error || 'Failed to get ticket.' });
                    socket.emit('ticket-request-resolved', {requestId, approved: false, error: ticketResult.error, playerName});
                }
            } else {
                 io.to(playerSocketId).emit('ticket-request-response', { roomId: data.roomId, requestId, approved: false, error: 'Player ticket limit or not found.' });
                 socket.emit('ticket-request-resolved', {requestId, approved: false, error: 'Player limit or not found.', playerName});
            }
        } else {
            io.to(playerSocketId).emit('ticket-request-response', { roomId: data.roomId, requestId, approved: false, error: 'Rejected by admin.' });
            socket.emit('ticket-request-resolved', {requestId, approved: false, playerName});
        }
        ack({ success: true });
    });

    socket.on('submit-claim', (data, ack) => {
        const room = getRoomOrAckError(data.roomId, socket, ack);
        if (!room) return;
        if (room.state !== 'running') return ack({ success: false, error: 'Game not running.' });

        const { playerName, claimType } = data; // clientTicketDetails removed, validation is server-side
        const player = room.players[playerName];
        if (!player || player.socketId !== socket.id) return ack({ success: false, error: 'Player mismatch.' });
        if (!room.rules[claimType]) return ack({ success: false, error: `Prize type "${claimType}" not active.` });
        if (room.claimedPrizesCount[claimType] >= room.maxPrizes[claimType]) return ack({ success: false, error: `Max winners for "${claimType}" reached.` });

        const calledNumbersSet = new Set(ticketStore.getCalledNumbers(data.roomId));
        const validationResult = ticketStore.isValidClaim(data.roomId, playerName, claimType, calledNumbersSet);

        if (!validationResult.isValid) {
            return ack({ success: false, error: validationResult.message || `Claim for ${claimType} is invalid.` });
        }

        const claimId = `CL-${uuidv4().slice(0, 8)}`;
        room.pendingClaimRequests[claimId] = { 
            socketId: socket.id, playerName, claimType, claimId,
            validatedTicketGrid: validationResult.validatedTicketGrid,
            validatedNumbers: validationResult.validatedNumbers
        };
        
        ack({ success: true, claimId });
        if (room.adminSocketId) {
            io.to(room.adminSocketId).emit('claim-submitted', {
                roomId: data.roomId, claimId, playerName, claimType, 
                ticket: validationResult.validatedTicketGrid, // Send ticket to admin for review
                numbers: validationResult.validatedNumbers
            });
        }
    });

    socket.on('verify-claim', (data, ack) => {
        const room = getRoomOrAckError(data.roomId, socket, ack);
        if (!room || !isAdmin(socket.id, room)) return ack({ success: false, error: 'Unauthorized.' });

        const { claimId, approved } = data;
        const claimDetails = room.pendingClaimRequests[claimId];
        if (!claimDetails) return ack({ success: false, error: 'Claim not found.' });
        
        delete room.pendingClaimRequests[claimId];
        const { socketId: playerSocketId, playerName, claimType } = claimDetails;

        let messageToPlayer = '';
        if (approved) {
            if (room.claimedPrizesCount[claimType] >= room.maxPrizes[claimType]) {
                messageToPlayer = `Max winners for ${claimType} already reached.`;
                io.to(playerSocketId).emit('claim-updated', { roomId: data.roomId, claimId, playerName, claimType, approved: false, error: messageToPlayer });
                socket.emit('claim-verified', { claimId, playerName, claimType, approved: false, error: messageToPlayer });
                return ack({ success: true, alreadyWon: true });
            }
            room.winners.push({ playerName, prizeType: claimType });
            room.claimedPrizesCount[claimType]++;
        }
        
        io.to(playerSocketId).emit('claim-updated', { roomId: data.roomId, claimId, playerName, claimType, approved });
        socket.emit('claim-verified', { claimId, playerName, claimType, approved });
        if (approved) io.to(data.roomId).emit('winner-announced', { roomId: data.roomId, playerName, prizeType: claimType, winners: room.winners });
        ack({ success: true });
    });

    socket.on('disconnect', (reason) => { /* ... same robust disconnect logic as before ... */ 
        console.log(`Socket disconnected: ${socket.id}, Reason: ${reason}`);
        for (const roomId in gameRooms) {
            const room = gameRooms[roomId];
            if (room.adminSocketId === socket.id) {
                console.log(`Admin ${room.adminName} of room ${roomId} disconnected.`);
                room.adminSocketId = null; 
                if (room.state === 'running' && room.mode === 'Auto' && room.intervalId) {
                    clearInterval(room.intervalId); room.intervalId = null; room.state = 'paused';
                    io.to(roomId).emit('auto-paused', { message: 'Admin disconnected, game paused.' });
                }
                io.to(roomId).emit('admin-disconnected', { message: 'Admin has disconnected.' });
                break; 
            }
            for (const playerName in room.players) {
                if (room.players[playerName].socketId === socket.id) {
                    const dPlayerName = room.players[playerName].name;
                    console.log(`Player ${dPlayerName} from room ${roomId} disconnected.`);
                    delete room.players[playerName];
                    const playersList = Object.values(room.players).map(p => ({ name: p.name, ticketCount: p.ticketsIssued }));
                    io.to(roomId).emit('player-left', { roomId, playerName: dPlayerName, playersList });
                    
                    Object.keys(room.pendingTicketRequests).forEach(reqId => {
                        if (room.pendingTicketRequests[reqId].socketId === socket.id) delete room.pendingTicketRequests[reqId];
                    });
                    Object.keys(room.pendingClaimRequests).forEach(cId => {
                        if (room.pendingClaimRequests[cId].socketId === socket.id) delete room.pendingClaimRequests[cId];
                    });
                    break; 
                }
            }
        }
    });
});

// ========== BLOCK 5: Start Server ==========
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Tambola server listening on port ${PORT}`);
});
