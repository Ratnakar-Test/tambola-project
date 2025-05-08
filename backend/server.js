// ========== BLOCK 1: Imports & Setup ==========
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const TicketStore = require('./ticketStore'); // Ensure path is correct

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: process.env.FRONTEND_ORIGIN || '*' }, // Restrict in production
    // Increase ping timeout/interval for potentially less stable connections (e.g., free hosting)
    pingTimeout: 60000, // 60 seconds
    pingInterval: 25000 // 25 seconds
});

// ========== BLOCK 2: State & Game Management ==========
// Instantiate TicketStore
const ticketStore = new TicketStore('scripts/tickets.json'); // Adjust path if needed

const gameRooms = {};
// Structure for gameRooms[roomId]:
// {
//   roomId: string,
//   adminName: string,
//   adminSocketId: string | null,
//   state: 'stopped' | 'running' | 'paused' | 'finished',
//   rules: { 'Prize Name': boolean, ... },
//   maxPrizes: { 'Prize Name': number, ... },
//   claimedPrizesCount: { 'Prize Name': number, ... },
//   mode: 'Manual' | 'Auto',
//   interval: number,
//   intervalId: NodeJS.Timeout | null,
//   winners: Array<{ playerName: string, prizeType: string }>,
//   maxTicketsPerPlayer: number,
//   players: { [playerName: string]: { socketId: string, name: string, ticketsIssued: number } },
//   availableNumbers: Array<number>, // Numbers 1-90 not yet called in this game instance
//   pendingTicketRequests: { [requestId: string]: { socketId: string, playerName: string, requestId: string } },
//   pendingClaimRequests: { [claimId: string]: { socketId: string, playerName: string, claimType: string, claimId: string, validatedTicketGrid?: any, validatedNumbers?: number[] } }
// }

// Helper Functions
function getRoomOrAckError(roomId, socket, ack, errorMessagePrefix = "Operation failed") {
    if (!roomId) { // Basic check if roomId is provided
        const errorMsg = `${errorMessagePrefix}: Room ID is missing.`;
         if (ack) ack({ success: false, error: errorMsg });
         else socket?.emit('room-error', { error: errorMsg }); // Use optional chaining for socket
         return null;
    }
    const room = gameRooms[roomId];
    if (!room) {
        const errorMsg = `${errorMessagePrefix}: Room ${roomId} not found.`;
        if (ack) ack({ success: false, error: errorMsg });
        else socket?.emit('room-error', { error: errorMsg });
        return null;
    }
    return room;
}

function isAdmin(socketId, room) {
    return room && room.adminSocketId === socketId;
}

function getPlayerInfo(room, playerName) {
    return room?.players?.[playerName]; // Use optional chaining
}

// ========== BLOCK 3: HTTP Endpoints ==========
app.get('/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString(), activeRooms: Object.keys(gameRooms).length });
});

app.get('/api/room/:roomId/exists', (req, res) => {
    const rid = req.params.roomId?.trim().toUpperCase(); // Optional chaining
    if (!rid) return res.status(400).json({ exists: false, error: 'Room ID required' });

    if (gameRooms[rid]) {
        res.json({ exists: true, gameState: gameRooms[rid].state, roomName: gameRooms[rid].adminName + "'s Room" });
    } else {
        res.status(404).json({ exists: false, error: 'Room not found' });
    }
});

// ========== BLOCK 4: Socket.IO Handlers ==========
io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    // --- Room Creation ---
    socket.on('create-room', (data, ack) => {
        console.log(`Received create-room request from ${socket.id}`, data);
        try {
            if (!data?.adminName?.trim()) return ack?.({ success: false, error: 'Admin name required.' });
            if (!data.rules || Object.keys(data.rules).length === 0) return ack?.({ success: false, error: 'Prize rules required.' });
            const maxTickets = parseInt(data.maxTicketsPerPlayer, 10);
            if (isNaN(maxTickets) || maxTickets < 1) return ack?.({ success: false, error: 'Invalid max tickets.' });

            const roomId = uuidv4().slice(0, 6).toUpperCase();
            ticketStore.createRoom(roomId, maxTickets);

            gameRooms[roomId] = {
                roomId, adminName: data.adminName.trim(), adminSocketId: socket.id, state: 'stopped',
                rules: data.rules, maxPrizes: data.maxPrizes || {}, // Default if missing
                claimedPrizesCount: Object.keys(data.rules).reduce((acc, rule) => { if (data.rules[rule]) acc[rule] = 0; return acc; }, {}),
                mode: 'Manual', interval: 5, intervalId: null, winners: [], maxTicketsPerPlayer: maxTickets,
                players: {}, availableNumbers: Array.from({ length: 90 }, (_, i) => i + 1),
                pendingTicketRequests: {}, pendingClaimRequests: {}
            };

            socket.join(roomId);
            ack?.({ success: true, roomId });
            socket.emit('room-created', { roomId, adminName: gameRooms[roomId].adminName, rules: gameRooms[roomId].rules, maxPrizes: gameRooms[roomId].maxPrizes, maxTicketsPerPlayer: gameRooms[roomId].maxTicketsPerPlayer });
            console.log(`Room ${roomId} created by admin ${data.adminName}`);
        } catch (err) {
            console.error(`Create room error for socket ${socket.id}:`, err);
            ack?.({ success: false, error: err.message || 'Server error creating room.' });
        }
    });

    // --- Joining / Rejoining ---
    socket.on('join-room', (data, ack) => {
        const { roomId, playerName, isAdmin: isAdminJoinAttempt } = data || {};
        console.log(`Received join-room request from ${socket.id}: Room ${roomId}, Player ${playerName}, Admin? ${isAdminJoinAttempt}`);
        try {
            if (!roomId?.trim() || !playerName?.trim()) return ack?.({ success: false, error: 'Room ID and Name required.' });
            const rid = roomId.trim().toUpperCase();
            const room = gameRooms[rid]; // No ack needed here, check below
            if (!room) return ack?.({ success: false, error: `Room ${rid} not found.` });

            // --- Admin Rejoin ---
            if (isAdminJoinAttempt && playerName === room.adminName) {
                console.log(`Admin ${playerName} attempting rejoin for room ${rid}`);
                room.adminSocketId = socket.id;
                socket.join(rid);
                ack?.({ success: true, isAdmin: true });
                // Send comprehensive state
                socket.emit('admin-rejoined', { /* ... state data ... */
                     roomId: rid, adminName: room.adminName,
                    gameState: { state: room.state, calledNumbers: ticketStore.getCalledNumbersArray(rid), rules: room.rules, maxPrizes: room.maxPrizes, mode: room.mode, interval: room.interval, winners: room.winners },
                    players: Object.values(room.players).map(p => ({ name: p.name, ticketCount: p.ticketsIssued })),
                    ticketRequests: Object.values(room.pendingTicketRequests),
                    prizeClaims: Object.values(room.pendingClaimRequests).map(c => ({claimId: c.claimId, playerName: c.playerName, claimType: c.claimType})),
                    maxTicketsPerPlayer: room.maxTicketsPerPlayer
                });
                console.log(`Admin ${playerName} rejoined room ${rid}`);
                return;
            }

            // --- Player Join/Rejoin ---
            if (room.state === 'finished') return ack?.({ success: false, error: 'Game finished.'});
            if (room.players[playerName] && room.players[playerName].socketId !== socket.id) {
                 return ack?.({ success: false, error: `Player name "${playerName}" taken.` });
            }

            let isRejoin = !!room.players[playerName];
            if (!isRejoin) room.players[playerName] = { socketId: socket.id, name: playerName, ticketsIssued: 0 };
            else room.players[playerName].socketId = socket.id; // Update socket

            socket.join(rid);
            const playerTickets = ticketStore.getPlayerTicketGrids(rid, playerName);
            const currentCalledNums = ticketStore.getCalledNumbersArray(rid);
            const activePrizeTypes = Object.keys(room.rules).filter(r => room.rules[r]);
            ack?.({ success: true, isAdmin: false, tickets: playerTickets, calledNumbers: currentCalledNums, gameState: { state: room.state }, prizeTypes: activePrizeTypes });

            const playersList = Object.values(room.players).map(p => ({ name: p.name, ticketCount: p.ticketsIssued }));
            io.to(rid).emit('player-joined', { roomId: rid, playerName, playersList });
            console.log(`Player ${playerName} ${isRejoin ? 'rejoined' : 'joined'} room ${rid}.`);

            // Auto-issue first ticket if needed
            if (!isRejoin && room.players[playerName].ticketsIssued === 0 && (room.state === 'stopped' || room.state === 'running')) {
                const ticketResult = ticketStore.generateTicketsForPlayer(rid, playerName, 1);
                if (ticketResult.success && ticketResult.tickets.length > 0) {
                    room.players[playerName].ticketsIssued += ticketResult.tickets.length;
                    socket.emit('ticket-updated', { roomId: rid, playerName: playerName, tickets: ticketResult.tickets });
                    const updatedPlayersList = Object.values(room.players).map(p => ({ name: p.name, ticketCount: p.ticketsIssued }));
                    io.to(rid).emit('player-list-updated', { playersList: updatedPlayersList });
                } else {
                    console.warn(`Failed auto-issue ticket: ${ticketResult.error}`);
                    socket.emit('room-error', { error: `Could not assign initial ticket: ${ticketResult.error}` });
                }
            }
        } catch (err) {
            console.error(`Join room error for socket ${socket.id}:`, err);
            ack?.({ success: false, error: err.message || 'Server error joining room.' });
        }
    });

    // --- Game Flow Controls ---
    socket.on('start-game', (data, ack) => {
        const room = getRoomOrAckError(data?.roomId, socket, ack);
        if (!room) return; // Error handled by helper
        if (!isAdmin(socket.id, room)) return ack?.({ success: false, error: 'Unauthorized.' });
        if (room.state !== 'stopped') return ack?.({ success: false, error: 'Game not stopped.' });
        if (!data.rules || Object.keys(data.rules).filter(k => data.rules[k]).length === 0) return ack?.({ success: false, error: 'Select rules.' });

        try {
            console.log(`Starting game in room ${data.roomId} by admin ${room.adminName}`);
            ticketStore.resetRoomForNewGame(data.roomId);
            room.state = 'running';
            room.rules = data.rules;
            room.maxPrizes = data.maxPrizes || {};
            room.claimedPrizesCount = Object.keys(data.rules).reduce((acc, rule) => { if (data.rules[rule]) acc[rule] = 0; return acc; }, {});
            room.mode = data.mode || 'Manual';
            room.interval = data.interval || 5;
            room.winners = [];
            room.availableNumbers = Array.from({ length: 90 }, (_, i) => i + 1);
            room.pendingClaimRequests = {};
            room.pendingTicketRequests = {};

            if (room.intervalId) clearInterval(room.intervalId);
            if (room.mode === 'Auto') {
                room.intervalId = setInterval(() => autoCallNextNumber(data.roomId), room.interval * 1000);
            }
            io.to(data.roomId).emit('game-started', { roomId: data.roomId, rules: room.rules, maxPrizes: room.maxPrizes, mode: room.mode, interval: room.interval });
            ack?.({ success: true });
        } catch (err) {
            console.error(`Start game error in room ${data.roomId}:`, err);
            ack?.({ success: false, error: 'Failed to start game: ' + err.message });
        }
    });

    function callNextNumberLogic(roomId) {
        // This function now assumes room exists and state is 'running'
        const room = gameRooms[roomId];
        try {
            if (room.availableNumbers.length === 0) {
                console.log(`No more numbers available in room ${roomId}.`);
                if (room.intervalId) clearInterval(room.intervalId);
                room.intervalId = null;
                io.to(roomId).emit('auto-finished'); // Specific event
                if (room.state !== 'finished') emitGameSummary(roomId); // Ensure summary
                return null;
            }

            const randomIndex = Math.floor(Math.random() * room.availableNumbers.length);
            const nextNumber = room.availableNumbers.splice(randomIndex, 1)[0];

            ticketStore.recordCalledNumber(roomId, nextNumber);
            const calledNumbersArray = ticketStore.getCalledNumbersArray(roomId);

            io.to(roomId).emit('number-called', { roomId, number: nextNumber, calledNumbers: calledNumbersArray });
            return { number: nextNumber, calledNumbers: calledNumbersArray };
        } catch (err) {
             console.error(`Error in callNextNumberLogic for room ${roomId}:`, err);
             // Attempt to recover state or notify admin/players
             io.to(roomId).emit('room-error', { error: 'Error drawing number. Game might be paused.' });
             if(room) { // If room still exists
                if (room.intervalId) clearInterval(room.intervalId);
                room.intervalId = null;
                room.state = 'paused'; // Pause on error
                io.to(roomId).emit('auto-paused', { message: 'Game paused due to internal error.' });
             }
             return null;
        }
    }

    function autoCallNextNumber(roomId) {
        const room = gameRooms[roomId]; // Check room exists *inside* interval
        if (!room || room.state !== 'running' || room.mode !== 'Auto') {
            if (room && room.intervalId) { clearInterval(room.intervalId); room.intervalId = null; }
            return;
        }
        callNextNumberLogic(roomId);
    }

    socket.on('manual-call-next', (data, ack) => {
        const room = getRoomOrAckError(data?.roomId, socket, ack);
        if (!room) return;
        if (!isAdmin(socket.id, room)) return ack?.({ success: false, error: 'Unauthorized.' });
        if (room.state !== 'running' || room.mode !== 'Manual') return ack?.({ success: false, error: 'Not in manual running mode.' });

        const result = callNextNumberLogic(data.roomId);
        if (!result) ack?.({ success: false, error: room.availableNumbers.length === 0 ? 'All numbers drawn.' : 'Draw failed.' });
        else ack?.({ success: true, number: result.number, calledNumbers: result.calledNumbers });
    });

    socket.on('admin-toggle-number', (data, ack) => {
        const room = getRoomOrAckError(data?.roomId, socket, ack);
        if (!room) return;
        if (!isAdmin(socket.id, room)) return ack?.({ success: false, error: 'Unauthorized.' });
        if (room.state !== 'running' && room.state !== 'paused') return ack?.({ success: false, error: 'Game not active.' });

        try {
            const { number, shouldBeCalled } = data;
            const num = parseInt(number, 10);
            if (isNaN(num) || num < 1 || num > 90) return ack?.({ success: false, error: 'Invalid number.' });

            const calledNumbersSet = ticketStore.getCalledNumbersSet(data.roomId);
            const isCurrentlyCalled = calledNumbersSet.has(num);
            let changed = false;

            if (shouldBeCalled && !isCurrentlyCalled) {
                const availIndex = room.availableNumbers.indexOf(num);
                if (availIndex > -1) {
                    room.availableNumbers.splice(availIndex, 1);
                    ticketStore.recordCalledNumber(data.roomId, num);
                    changed = true;
                } else { return ack?.({ success: false, error: `Cannot call ${num}, it was already called.` }); }
            } else if (!shouldBeCalled && isCurrentlyCalled) {
                calledNumbersSet.delete(num); // Mutates the set from TicketStore
                if (!room.availableNumbers.includes(num)) {
                    room.availableNumbers.push(num);
                    room.availableNumbers.sort((a, b) => a - b);
                }
                changed = true;
            }

            if (changed) {
                const currentCalledArray = ticketStore.getCalledNumbersArray(data.roomId);
                io.to(data.roomId).emit('number-called', { roomId: data.roomId, number: num, calledNumbers: currentCalledArray });
                console.log(`Admin toggled number ${num} in room ${data.roomId}. Should be called: ${shouldBeCalled}`);
            }
            ack?.({ success: true });
        } catch (err) {
             console.error(`Admin toggle number error in room ${data.roomId}:`, err);
             ack?.({ success: false, error: 'Error toggling number: ' + err.message });
        }
    });

    socket.on('pause-auto', (data, ack) => {
        const room = getRoomOrAckError(data?.roomId, socket, ack);
        if (!room || !isAdmin(socket.id, room)) return ack?.({ success: false, error: 'Unauthorized.' });
        if (room.mode !== 'Auto' || room.state !== 'running' || !room.intervalId) return ack?.({ success: false, error: 'Not auto-running.' });
        clearInterval(room.intervalId); room.intervalId = null; room.state = 'paused';
        io.to(data.roomId).emit('auto-paused'); ack?.({ success: true });
    });
    socket.on('resume-auto', (data, ack) => {
        const room = getRoomOrAckError(data?.roomId, socket, ack);
        if (!room || !isAdmin(socket.id, room)) return ack?.({ success: false, error: 'Unauthorized.' });
        if (room.mode !== 'Auto' || room.state !== 'paused') return ack?.({ success: false, error: 'Not auto-paused.' });
        room.state = 'running'; room.intervalId = setInterval(() => autoCallNextNumber(data.roomId), room.interval * 1000);
        io.to(data.roomId).emit('auto-resumed'); ack?.({ success: true });
    });

    function emitGameSummary(roomId) {
        const room = gameRooms[roomId]; if (!room) return;
        if (room.state === 'finished') return; // Avoid double summary
        console.log(`Emitting game summary for room ${roomId}`);
        if (room.intervalId) { clearInterval(room.intervalId); room.intervalId = null; }
        room.state = 'finished';
        io.to(roomId).emit('game-summary', { roomId, calledNumbers: ticketStore.getCalledNumbersArray(roomId), winners: room.winners });
    }
    socket.on('stop-game', (data, ack) => {
        const room = getRoomOrAckError(data?.roomId, socket, ack);
        if (!room || !isAdmin(socket.id, room)) return ack?.({ success: false, error: 'Unauthorized.' });
        if (room.state === 'stopped' || room.state === 'finished') return ack?.({ success: false, error: 'Game not active.' });
        emitGameSummary(data.roomId); ack?.({ success: true });
    });

    // --- Ticket Management ---
    socket.on('request-ticket', (data, ack) => {
        const room = getRoomOrAckError(data?.roomId, socket, ack);
        if (!room) return;
        if (room.state === 'finished') return ack?.({ success: false, error: 'Game finished.' });

        try {
            const player = getPlayerInfo(room, data.playerName);
            if (!player || player.socketId !== socket.id) return ack?.({ success: false, error: 'Player mismatch.' });
            if (player.ticketsIssued >= room.maxTicketsPerPlayer) return ack?.({ success: false, error: `Ticket limit reached.` });

            const requestId = `TR-${uuidv4().slice(0, 8)}`;
            room.pendingTicketRequests[requestId] = { socketId: socket.id, playerName: data.playerName, requestId };
            ack?.({ success: true, requestId });
            if (room.adminSocketId) io.to(room.adminSocketId).emit('ticket-requested', { roomId: data.roomId, requestId, playerName: data.playerName });
        } catch (err) {
             console.error(`Request ticket error for ${data?.playerName} in room ${data?.roomId}:`, err);
             ack?.({ success: false, error: 'Server error processing ticket request.' });
        }
    });

    socket.on('approve-ticket', (data, ack) => {
        const room = getRoomOrAckError(data?.roomId, socket, ack);
        if (!room || !isAdmin(socket.id, room)) return ack?.({ success: false, error: 'Unauthorized.' });

        const { requestId, approved } = data;
        const requestDetails = room.pendingTicketRequests[requestId];
        if (!requestDetails) return ack?.({ success: false, error: 'Request not found.' });

        // Remove regardless of outcome
        delete room.pendingTicketRequests[requestId];
        const { socketId: playerSocketId, playerName } = requestDetails;
        const player = getPlayerInfo(room, playerName);

        // Check if player still exists and is connected
        const playerSocket = io.sockets.sockets.get(playerSocketId);
        if (!player || !playerSocket) {
            console.log(`Player ${playerName} not found or disconnected during ticket approval.`);
            socket.emit('ticket-request-resolved', {requestId, approved: false, error: 'Player disconnected.', playerName});
            return ack?.({ success: true, warning: 'Player disconnected.' });
        }

        if (approved) {
            if (player.ticketsIssued < room.maxTicketsPerPlayer) {
                 try {
                    const ticketResult = ticketStore.generateTicketsForPlayer(data.roomId, playerName, 1);
                    if (ticketResult.success && ticketResult.tickets.length > 0) {
                        player.ticketsIssued += ticketResult.tickets.length;
                        playerSocket.emit('ticket-request-response', { roomId: data.roomId, requestId, approved: true });
                        playerSocket.emit('ticket-updated', { roomId: data.roomId, playerName, tickets: ticketResult.tickets });
                        socket.emit('ticket-request-resolved', {requestId, approved: true, playerName});
                        const updatedPlayersList = Object.values(room.players).map(p => ({ name: p.name, ticketCount: p.ticketsIssued }));
                        io.to(data.roomId).emit('player-list-updated', { playersList: updatedPlayersList });
                    } else { // Failed to generate ticket
                        playerSocket.emit('ticket-request-response', { roomId: data.roomId, requestId, approved: false, error: ticketResult.error || 'Failed to generate ticket.' });
                        socket.emit('ticket-request-resolved', {requestId, approved: false, error: ticketResult.error, playerName});
                    }
                 } catch (genError) {
                      console.error(`Error generating ticket for ${playerName} in ${data.roomId}:`, genError);
                      playerSocket.emit('ticket-request-response', { roomId: data.roomId, requestId, approved: false, error: 'Server error generating ticket.' });
                      socket.emit('ticket-request-resolved', {requestId, approved: false, error: 'Server error generating ticket.', playerName});
                 }
            } else { // Limit reached
                 playerSocket.emit('ticket-request-response', { roomId: data.roomId, requestId, approved: false, error: 'Ticket limit reached.' });
                 socket.emit('ticket-request-resolved', {requestId, approved: false, error: 'Player ticket limit reached.', playerName});
            }
        } else { // Rejected
            playerSocket.emit('ticket-request-response', { roomId: data.roomId, requestId, approved: false, error: 'Rejected by admin.' });
            socket.emit('ticket-request-resolved', {requestId, approved: false, playerName});
        }
        ack?.({ success: true });
    });

    // --- Claim Management ---
    socket.on('submit-claim', (data, ack) => {
        const room = getRoomOrAckError(data?.roomId, socket, ack);
        if (!room) return;
        if (room.state !== 'running') return ack?.({ success: false, error: 'Game not running.' });

        try {
            const { playerName, claimType } = data;
            const player = getPlayerInfo(room, playerName);
            if (!player || player.socketId !== socket.id) return ack?.({ success: false, error: 'Player mismatch.' });
            if (!room.rules[claimType]) return ack?.({ success: false, error: `Prize type "${claimType}" not active.` });
            if (room.claimedPrizesCount[claimType] >= room.maxPrizes[claimType]) return ack?.({ success: false, error: `Max winners for "${claimType}" reached.` });

            // Perform validation using TicketStore
            const validationResult = ticketStore.isValidClaim(data.roomId, playerName, claimType);

            if (!validationResult.isValid) {
                return ack?.({ success: false, error: validationResult.message || `Claim for ${claimType} is invalid.` });
            }

            // Claim is valid, add to pending
            const claimId = `CL-${uuidv4().slice(0, 8)}`;
            room.pendingClaimRequests[claimId] = {
                socketId: socket.id, playerName, claimType, claimId,
                validatedTicketGrid: validationResult.validatedTicketGrid,
                validatedNumbers: validationResult.validatedNumbers
            };

            ack?.({ success: true, claimId });
            // Notify admin
            if (room.adminSocketId) {
                io.to(room.adminSocketId).emit('claim-submitted', {
                    roomId: data.roomId, claimId, playerName, claimType,
                    ticket: validationResult.validatedTicketGrid, // Send details for verification
                    numbers: validationResult.validatedNumbers
                });
            }
        } catch (err) {
             console.error(`Submit claim error for ${data?.playerName} in room ${data?.roomId}:`, err);
             ack?.({ success: false, error: 'Server error processing claim: ' + err.message });
        }
    });

    socket.on('verify-claim', (data, ack) => {
        const room = getRoomOrAckError(data?.roomId, socket, ack);
        if (!room || !isAdmin(socket.id, room)) return ack?.({ success: false, error: 'Unauthorized.' });

        const { claimId, approved } = data;
        const claimDetails = room.pendingClaimRequests[claimId];
        if (!claimDetails) return ack?.({ success: false, error: 'Claim not found.' });

        // Remove from pending
        delete room.pendingClaimRequests[claimId];
        const { socketId: playerSocketId, playerName, claimType } = claimDetails;

        // Find player socket
        const playerSocket = io.sockets.sockets.get(playerSocketId);
        if (!playerSocket) {
             console.log(`Player ${playerName} disconnected before claim verification.`);
             // Notify admin it couldn't be delivered fully
             socket.emit('claim-verified', { claimId, playerName, claimType, approved: false, error: 'Player disconnected.' });
             return ack?.({ success: true, warning: 'Player disconnected.' });
        }


        if (approved) {
            if (room.claimedPrizesCount[claimType] >= room.maxPrizes[claimType]) {
                const limitMsg = `Max winners for ${claimType} already reached.`;
                playerSocket.emit('claim-updated', { roomId: data.roomId, claimId, playerName, claimType, approved: false, error: limitMsg });
                socket.emit('claim-verified', { claimId, playerName, claimType, approved: false, error: limitMsg });
                return ack?.({ success: true, alreadyWon: true });
            }
            // Award prize
            room.winners.push({ playerName, prizeType: claimType });
            room.claimedPrizesCount[claimType]++;
            playerSocket.emit('claim-updated', { roomId: data.roomId, claimId, playerName, claimType, approved: true });
            socket.emit('claim-verified', { claimId, playerName, claimType, approved: true });
            io.to(data.roomId).emit('winner-announced', { roomId: data.roomId, playerName, prizeType: claimType, winners: room.winners });
            console.log(`Claim approved: ${playerName}/${claimType} in ${data.roomId}`);
        } else { // Rejected
            playerSocket.emit('claim-updated', { roomId: data.roomId, claimId, playerName, claimType, approved: false });
            socket.emit('claim-verified', { claimId, playerName, claimType, approved: false });
             console.log(`Claim rejected: ${playerName}/${claimType} in ${data.roomId}`);
        }
        ack?.({ success: true });
    });


    // --- Disconnect Handling ---
    socket.on('disconnect', (reason) => {
        console.log(`Socket disconnected: ${socket.id}, Reason: ${reason}`);
        let disconnectedPlayerName = null;
        let disconnectedRoomId = null;

        // Iterate through rooms to find where this socket was active
        for (const roomId in gameRooms) {
            const room = gameRooms[roomId];
            // Check if admin disconnected
            if (room.adminSocketId === socket.id) {
                console.log(`Admin ${room.adminName} of room ${roomId} disconnected.`);
                room.adminSocketId = null;
                // Pause auto-game if running
                if (room.state === 'running' && room.mode === 'Auto' && room.intervalId) {
                    clearInterval(room.intervalId); room.intervalId = null; room.state = 'paused';
                    io.to(roomId).emit('auto-paused', { message: 'Admin disconnected, game paused.' });
                }
                io.to(roomId).emit('admin-disconnected', { message: 'Admin has disconnected.' });
                disconnectedRoomId = roomId; // Mark room
                break;
            }
            // Check if a player disconnected
            for (const playerName in room.players) {
                if (room.players[playerName].socketId === socket.id) {
                    disconnectedPlayerName = room.players[playerName].name;
                    disconnectedRoomId = roomId;
                    console.log(`Player ${disconnectedPlayerName} from room ${roomId} disconnected.`);
                    // Remove player from server state
                    delete room.players[playerName];

                    // Clean up pending requests/claims associated with this socket ID
                    Object.keys(room.pendingTicketRequests)
                        .filter(reqId => room.pendingTicketRequests[reqId].socketId === socket.id)
                        .forEach(reqId => delete room.pendingTicketRequests[reqId]);
                    Object.keys(room.pendingClaimRequests)
                        .filter(cId => room.pendingClaimRequests[cId].socketId === socket.id)
                        .forEach(cId => delete room.pendingClaimRequests[cId]);

                    break; // Found player
                }
            }
            if (disconnectedPlayerName) break; // Exit outer loop
        }

        // If a player disconnected, notify the room
        if (disconnectedPlayerName && disconnectedRoomId && gameRooms[disconnectedRoomId]) {
             const room = gameRooms[disconnectedRoomId];
             const playersList = Object.values(room.players).map(p => ({ name: p.name, ticketCount: p.ticketsIssued }));
             io.to(disconnectedRoomId).emit('player-left', { roomId: disconnectedRoomId, playerName: disconnectedPlayerName, playersList });
        }
        // Consider adding logic to delete empty rooms or rooms inactive for a long time
    });

    // Generic error handler for socket errors not caught elsewhere
    socket.on('error', (err) => {
        console.error(`Socket Error for ${socket.id}:`, err);
        // Optionally notify the client if possible/appropriate
        socket.emit('server-error', { message: 'An unexpected server error occurred.' });
    });

});

// ========== BLOCK 5: Start Server ==========
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Tambola server listening on port ${PORT}`);
});

// Graceful shutdown handling (optional but good practice)
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    // Add any other cleanup here (e.g., saving state if needed)
    process.exit(0);
  });
});
process.on('SIGINT', () => {
  console.log('SIGINT signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});
