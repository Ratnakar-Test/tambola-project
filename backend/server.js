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
    cors: { origin: process.env.FRONTEND_ORIGIN || '*' } // Restrict in production
});

// ========== BLOCK 2: State & Game Management ==========
// Instantiate TicketStore, providing the path to the tickets file relative to ticketStore.js
// If server.js and ticketStore.js are in the same directory, and scripts is a subdir:
const ticketStore = new TicketStore('scripts/tickets.json');
// If ticketStore.js is in lib/ and scripts/ is at the same level as lib/:
// const ticketStore = new TicketStore('../scripts/tickets.json');

const gameRooms = {};
// Structure for gameRooms[roomId]:
// {
//   roomId: string,
//   adminName: string,
//   adminSocketId: string | null,
//   state: 'stopped' | 'running' | 'paused' | 'finished',
//   rules: { 'Prize Name': boolean, ... }, // Active rules
//   maxPrizes: { 'Prize Name': number, ... }, // Max winners per rule
//   claimedPrizesCount: { 'Prize Name': number, ... }, // Current winners per rule
//   mode: 'Manual' | 'Auto',
//   interval: number, // Auto mode interval in seconds
//   intervalId: NodeJS.Timeout | null, // Auto mode timer
//   winners: Array<{ playerName: string, prizeType: string }>,
//   maxTicketsPerPlayer: number,
//   players: { [playerName: string]: { socketId: string, name: string, ticketsIssued: number } },
//   availableNumbers: Array<number>, // Numbers 1-90 not yet called in this game instance
//   pendingTicketRequests: { [requestId: string]: { socketId: string, playerName: string, requestId: string } },
//   pendingClaimRequests: { // Claims validated by server, awaiting admin verification
//       [claimId: string]: {
//           socketId: string, playerName: string, claimType: string, claimId: string,
//           validatedTicketGrid?: any, validatedNumbers?: number[]
//       }
//   }
// }

// Helper Functions
function getRoomOrAckError(roomId, socket, ack, errorMessagePrefix = "Operation failed") {
    const room = gameRooms[roomId];
    if (!room) {
        const errorMsg = `${errorMessagePrefix}: Room ${roomId} not found.`;
        if (ack) ack({ success: false, error: errorMsg });
        else socket.emit('room-error', { error: errorMsg }); // Use a specific event for room errors
        return null;
    }
    return room;
}

function isAdmin(socketId, room) {
    return room && room.adminSocketId === socketId;
}

function getPlayerInfo(room, playerName) {
    return room ? room.players[playerName] : null;
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

    // --- Room Creation ---
    socket.on('create-room', (data, ack) => {
        try {
            // Basic validation
            if (!data.adminName?.trim()) return ack({ success: false, error: 'Admin name is required.' });
            if (!data.rules || Object.keys(data.rules).length === 0) return ack({ success: false, error: 'At least one prize rule must be selected.' });
            if (!data.maxPrizes) return ack({ success: false, error: 'Max prizes configuration is missing.' });
            if (!data.maxTicketsPerPlayer || parseInt(data.maxTicketsPerPlayer, 10) < 1) return ack({ success: false, error: 'Max tickets per player must be at least 1.' });

            const roomId = uuidv4().slice(0, 6).toUpperCase();
            const maxTickets = parseInt(data.maxTicketsPerPlayer, 10);

            // Initialize room in TicketStore first
            ticketStore.createRoom(roomId, maxTickets);

            // Initialize room in server's state
            gameRooms[roomId] = {
                roomId: roomId,
                adminName: data.adminName.trim(),
                adminSocketId: socket.id,
                state: 'stopped',
                rules: data.rules, // Assuming client sends validated rules object
                maxPrizes: data.maxPrizes, // Assuming client sends validated maxPrizes object
                claimedPrizesCount: Object.keys(data.rules).reduce((acc, rule) => {
                    if (data.rules[rule]) acc[rule] = 0; return acc;
                }, {}),
                mode: 'Manual', interval: 5, intervalId: null,
                winners: [],
                maxTicketsPerPlayer: maxTickets,
                players: {},
                availableNumbers: Array.from({ length: 90 }, (_, i) => i + 1), // Fresh list for this game
                pendingTicketRequests: {},
                pendingClaimRequests: {}
            };

            socket.join(roomId);
            ack({ success: true, roomId: roomId });
            // Emit confirmation back to the admin creator
            socket.emit('room-created', {
                roomId: roomId, adminName: gameRooms[roomId].adminName, rules: gameRooms[roomId].rules,
                maxPrizes: gameRooms[roomId].maxPrizes, maxTicketsPerPlayer: gameRooms[roomId].maxTicketsPerPlayer
            });
            console.log(`Room ${roomId} created by admin ${data.adminName}`);

        } catch (err) {
            console.error('Create room error:', err);
            ack({ success: false, error: err.message || 'Server error creating room.' });
        }
    });

    // --- Joining / Rejoining ---
    socket.on('join-room', (data, ack) => {
        try {
            const { roomId, playerName, isAdmin: isAdminJoinAttempt } = data;
            if (!roomId?.trim() || !playerName?.trim()) return ack({ success: false, error: 'Room ID and Name required.' });

            const rid = roomId.trim().toUpperCase();
            const room = gameRooms[rid];
            if (!room) return ack({ success: false, error: `Room ${rid} not found.` });

            // --- Admin Rejoin ---
            if (isAdminJoinAttempt && playerName === room.adminName) {
                console.log(`Admin ${playerName} attempting to rejoin room ${rid}...`);
                room.adminSocketId = socket.id;
                socket.join(rid);
                ack({ success: true, isAdmin: true });
                // Send comprehensive state to rejoining admin
                socket.emit('admin-rejoined', {
                    roomId: rid, adminName: room.adminName,
                    gameState: { state: room.state, calledNumbers: ticketStore.getCalledNumbersArray(rid), rules: room.rules, maxPrizes: room.maxPrizes, mode: room.mode, interval: room.interval, winners: room.winners },
                    players: Object.values(room.players).map(p => ({ name: p.name, ticketCount: p.ticketsIssued })),
                    ticketRequests: Object.values(room.pendingTicketRequests),
                    prizeClaims: Object.values(room.pendingClaimRequests).map(c => ({claimId: c.claimId, playerName: c.playerName, claimType: c.claimType})),
                    maxTicketsPerPlayer: room.maxTicketsPerPlayer
                });
                console.log(`Admin ${playerName} rejoined successfully.`);
                return;
            }

            // --- Player Join/Rejoin ---
            if (room.state === 'finished') return ack({ success: false, error: 'Game finished. Cannot join.'});
            if (room.players[playerName] && room.players[playerName].socketId !== socket.id) {
                 return ack({ success: false, error: `Player name "${playerName}" is taken.` });
            }

            let isRejoin = !!room.players[playerName];
            if (!isRejoin) {
                 room.players[playerName] = { socketId: socket.id, name: playerName, ticketsIssued: 0 };
            } else {
                room.players[playerName].socketId = socket.id; // Update socket ID
            }

            socket.join(rid);
            const playerCurrentTickets = ticketStore.getPlayerTicketGrids(rid, playerName);
            const currentCalledNums = ticketStore.getCalledNumbersArray(rid);
            const activePrizeTypes = Object.keys(room.rules).filter(r => room.rules[r]);

            // Acknowledge join success and send initial state
            ack({ success: true, isAdmin: false, tickets: playerCurrentTickets, calledNumbers: currentCalledNums, gameState: { state: room.state }, prizeTypes: activePrizeTypes });

            // Notify room including the new/rejoining player
            const playersList = Object.values(room.players).map(p => ({ name: p.name, ticketCount: p.ticketsIssued }));
            io.to(rid).emit('player-joined', { roomId: rid, playerName, playersList });
            console.log(`Player ${playerName} ${isRejoin ? 'rejoined' : 'joined'} room ${rid}.`);

            // Auto-issue one ticket ONLY on first join if none issued and game allows
            if (!isRejoin && room.players[playerName].ticketsIssued === 0 && (room.state === 'stopped' || room.state === 'running')) {
                const ticketResult = ticketStore.generateTicketsForPlayer(rid, playerName, 1);
                if (ticketResult.success && ticketResult.tickets.length > 0) {
                    room.players[playerName].ticketsIssued += ticketResult.tickets.length;
                    // Send ticket update specifically to the player
                    socket.emit('ticket-updated', { roomId: rid, playerName: playerName, tickets: ticketResult.tickets });
                    // Update player list for everyone
                    const updatedPlayersList = Object.values(room.players).map(p => ({ name: p.name, ticketCount: p.ticketsIssued }));
                    io.to(rid).emit('player-list-updated', { playersList: updatedPlayersList });
                } else {
                    console.warn(`Failed to auto-issue first ticket to ${playerName} in room ${rid}: ${ticketResult.error}`);
                    // Optionally notify player of the failure
                    socket.emit('room-error', { error: `Could not automatically assign initial ticket: ${ticketResult.error}` });
                }
            }

        } catch (err) {
            console.error(`Join room error for ${data.playerName} in ${data.roomId}:`, err);
            ack({ success: false, error: err.message || 'Server error joining room.' });
        }
    });

    // --- Game Flow Controls (Admin Only) ---
    socket.on('start-game', (data, ack) => {
        const room = getRoomOrAckError(data.roomId, socket, ack);
        if (!room || !isAdmin(socket.id, room)) return ack({ success: false, error: 'Unauthorized.' });
        if (room.state !== 'stopped') return ack({ success: false, error: 'Game not in stopped state.' });
        if (!data.rules || Object.keys(data.rules).filter(k => data.rules[k]).length === 0) return ack({ success: false, error: 'Select prize rules.' });

        try {
            ticketStore.resetRoomForNewGame(data.roomId); // Reset called numbers and player tickets in store
            room.state = 'running';
            room.rules = data.rules;
            room.maxPrizes = data.maxPrizes;
            room.claimedPrizesCount = Object.keys(data.rules).reduce((acc, rule) => { if (data.rules[rule]) acc[rule] = 0; return acc; }, {});
            room.mode = data.mode || 'Manual';
            room.interval = data.interval || 5;
            room.winners = [];
            room.availableNumbers = Array.from({ length: 90 }, (_, i) => i + 1); // Reset server's available list
            room.pendingClaimRequests = {}; // Clear pending claims from previous game
            room.pendingTicketRequests = {}; // Clear pending tickets from previous game

            if (room.intervalId) clearInterval(room.intervalId);
            if (room.mode === 'Auto') {
                room.intervalId = setInterval(() => autoCallNextNumber(data.roomId), room.interval * 1000);
            }

            io.to(data.roomId).emit('game-started', {
                roomId: data.roomId, rules: room.rules, maxPrizes: room.maxPrizes, mode: room.mode, interval: room.interval
            });
            ack({ success: true });
            console.log(`Game started in room ${data.roomId}`);
        } catch (err) {
            console.error(`Start game error in room ${data.roomId}:`, err);
            ack({ success: false, error: 'Failed to start game: ' + err.message });
        }
    });

    function callNextNumberLogic(roomId) {
        const room = gameRooms[roomId];
        if (!room || room.state !== 'running') return null;
        if (room.availableNumbers.length === 0) {
            console.log(`No more numbers available in room ${roomId}.`);
            if (room.intervalId) clearInterval(room.intervalId);
            room.intervalId = null;
            io.to(roomId).emit('auto-finished'); // Let clients know numbers are done
            if (room.state !== 'finished') emitGameSummary(roomId);
            return null;
        }

        const randomIndex = Math.floor(Math.random() * room.availableNumbers.length);
        const nextNumber = room.availableNumbers.splice(randomIndex, 1)[0]; // Remove from server's available list

        ticketStore.recordCalledNumber(roomId, nextNumber); // Record in TicketStore
        const calledNumbersArray = ticketStore.getCalledNumbersArray(roomId); // Get sorted list from store

        io.to(roomId).emit('number-called', { roomId, number: nextNumber, calledNumbers: calledNumbersArray });
        return { number: nextNumber, calledNumbers: calledNumbersArray };
    }

    function autoCallNextNumber(roomId) {
        const room = gameRooms[roomId];
        // Extra checks for safety within interval callback
        if (!room || room.state !== 'running' || room.mode !== 'Auto') {
            if (room && room.intervalId) {
                console.log(`Stopping auto-call timer for room ${roomId} due to state/mode change.`);
                clearInterval(room.intervalId);
                room.intervalId = null;
            }
            return;
        }
        callNextNumberLogic(roomId);
    }

    socket.on('manual-call-next', (data, ack) => {
        const room = getRoomOrAckError(data.roomId, socket, ack);
        if (!room || !isAdmin(socket.id, room)) return ack({ success: false, error: 'Unauthorized.' });
        if (room.state !== 'running' || room.mode !== 'Manual') return ack({ success: false, error: 'Not in manual running mode.' });

        const result = callNextNumberLogic(data.roomId);
        if (!result) ack({ success: false, error: room.availableNumbers.length === 0 ? 'All numbers have been drawn.' : 'Failed to draw number.' });
        else ack({ success: true, number: result.number, calledNumbers: result.calledNumbers });
    });

    socket.on('admin-toggle-number', (data, ack) => {
        const room = getRoomOrAckError(data.roomId, socket, ack);
        if (!room || !isAdmin(socket.id, room)) return ack({ success: false, error: 'Unauthorized.' });
        if (room.state !== 'running' && room.state !== 'paused') return ack({ success: false, error: 'Game not active.' });

        const { number, shouldBeCalled } = data;
        const num = parseInt(number, 10);
        if (isNaN(num) || num < 1 || num > 90) return ack({ success: false, error: 'Invalid number.' });

        const calledNumbersSet = ticketStore.getCalledNumbersSet(data.roomId);
        const isCurrentlyCalled = calledNumbersSet.has(num);
        let changed = false;

        if (shouldBeCalled && !isCurrentlyCalled) { // Trying to call a number that wasn't called
            const availIndex = room.availableNumbers.indexOf(num);
            if (availIndex > -1) {
                room.availableNumbers.splice(availIndex, 1); // Remove from available
                ticketStore.recordCalledNumber(data.roomId, num); // Add to called in store
                changed = true;
            } else {
                return ack({ success: false, error: `Number ${num} was already called (not in available list).` });
            }
        } else if (!shouldBeCalled && isCurrentlyCalled) { // Trying to un-call a number that was called
            calledNumbersSet.delete(num); // Remove from store's set (mutates the Set object from getCalledNumbersSet)
            if (!room.availableNumbers.includes(num)) { // Add back to available if not already there
                room.availableNumbers.push(num);
                room.availableNumbers.sort((a, b) => a - b); // Keep sorted
            }
            changed = true;
        }

        if (changed) {
            const currentCalledArray = ticketStore.getCalledNumbersArray(data.roomId);
            io.to(data.roomId).emit('number-called', { roomId: data.roomId, number: num, calledNumbers: currentCalledArray });
            console.log(`Admin toggled number ${num} in room ${data.roomId}. Should be called: ${shouldBeCalled}`);
        }
        ack({ success: true });
    });


    socket.on('pause-auto', (data, ack) => {
        const room = getRoomOrAckError(data.roomId, socket, ack);
        if (!room || !isAdmin(socket.id, room)) return ack({ success: false, error: 'Unauthorized.' });
        if (room.mode !== 'Auto' || room.state !== 'running' || !room.intervalId) return ack({ success: false, error: 'Not in auto-running mode.' });
        clearInterval(room.intervalId); room.intervalId = null; room.state = 'paused';
        io.to(data.roomId).emit('auto-paused'); ack({ success: true });
    });
    socket.on('resume-auto', (data, ack) => {
        const room = getRoomOrAckError(data.roomId, socket, ack);
        if (!room || !isAdmin(socket.id, room)) return ack({ success: false, error: 'Unauthorized.' });
        if (room.mode !== 'Auto' || room.state !== 'paused') return ack({ success: false, error: 'Not in auto-paused mode.' });
        room.state = 'running'; room.intervalId = setInterval(() => autoCallNextNumber(data.roomId), room.interval * 1000);
        io.to(data.roomId).emit('auto-resumed'); ack({ success: true });
    });

    function emitGameSummary(roomId) {
        const room = gameRooms[roomId]; if (!room) return;
        if (room.state === 'finished') return; // Avoid double summary

        console.log(`Emitting game summary for room ${roomId}`);
        if (room.intervalId) { clearInterval(room.intervalId); room.intervalId = null; }
        room.state = 'finished';
        io.to(roomId).emit('game-summary', { roomId, calledNumbers: ticketStore.getCalledNumbersArray(roomId), winners: room.winners });
        // Consider cleanup after a delay
        // setTimeout(() => { delete gameRooms[roomId]; ticketStore.deleteRoom(roomId); }, 60 * 60 * 1000);
    }
    socket.on('stop-game', (data, ack) => {
        const room = getRoomOrAckError(data.roomId, socket, ack);
        if (!room || !isAdmin(socket.id, room)) return ack({ success: false, error: 'Unauthorized.' });
        if (room.state === 'stopped' || room.state === 'finished') return ack({ success: false, error: 'Game not active.' });
        emitGameSummary(data.roomId); ack({ success: true });
    });

    // --- Ticket Management ---
    socket.on('request-ticket', (data, ack) => {
        const room = getRoomOrAckError(data.roomId, socket, ack);
        if (!room) return;
        if (room.state === 'finished') return ack({ success: false, error: 'Game finished.' });

        const player = getPlayerInfo(room, data.playerName);
        if (!player || player.socketId !== socket.id) return ack({ success: false, error: 'Player mismatch.' });
        if (player.ticketsIssued >= room.maxTicketsPerPlayer) return ack({ success: false, error: `Ticket limit (${room.maxTicketsPerPlayer}) reached.` });

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
        if (!requestDetails) return ack({ success: false, error: 'Request not found or already processed.' });

        delete room.pendingTicketRequests[requestId]; // Processed
        const { socketId: playerSocketId, playerName } = requestDetails;
        const player = getPlayerInfo(room, playerName);

        if (!player) { // Player might have disconnected
             socket.emit('ticket-request-resolved', {requestId, approved: false, error: 'Player disconnected before approval.', playerName});
             return ack({ success: true, warning: 'Player disconnected.' });
        }

        if (approved) {
            if (player.ticketsIssued < room.maxTicketsPerPlayer) {
                const ticketResult = ticketStore.generateTicketsForPlayer(data.roomId, playerName, 1);
                if (ticketResult.success && ticketResult.tickets.length > 0) {
                    player.ticketsIssued += ticketResult.tickets.length;
                    io.to(playerSocketId).emit('ticket-request-response', { roomId: data.roomId, requestId, approved: true });
                    io.to(playerSocketId).emit('ticket-updated', { roomId: data.roomId, playerName, tickets: ticketResult.tickets });
                    socket.emit('ticket-request-resolved', {requestId, approved: true, playerName});
                    // Update player list for everyone
                    const updatedPlayersList = Object.values(room.players).map(p => ({ name: p.name, ticketCount: p.ticketsIssued }));
                    io.to(data.roomId).emit('player-list-updated', { playersList: updatedPlayersList });
                } else { // Failed to generate ticket
                    io.to(playerSocketId).emit('ticket-request-response', { roomId: data.roomId, requestId, approved: false, error: ticketResult.error || 'Failed to generate ticket.' });
                    socket.emit('ticket-request-resolved', {requestId, approved: false, error: ticketResult.error, playerName});
                }
            } else { // Ticket limit hit between request and approval
                 io.to(playerSocketId).emit('ticket-request-response', { roomId: data.roomId, requestId, approved: false, error: 'Ticket limit reached.' });
                 socket.emit('ticket-request-resolved', {requestId, approved: false, error: 'Player ticket limit reached.', playerName});
            }
        } else { // Rejected by admin
            io.to(playerSocketId).emit('ticket-request-response', { roomId: data.roomId, requestId, approved: false, error: 'Rejected by admin.' });
            socket.emit('ticket-request-resolved', {requestId, approved: false, playerName});
        }
        ack({ success: true }); // Admin action processed
    });

    // --- Claim Management ---
    socket.on('submit-claim', (data, ack) => {
        const room = getRoomOrAckError(data.roomId, socket, ack);
        if (!room) return;
        if (room.state !== 'running') return ack({ success: false, error: 'Game not running.' });

        const { playerName, claimType } = data;
        const player = getPlayerInfo(room, playerName);
        if (!player || player.socketId !== socket.id) return ack({ success: false, error: 'Player mismatch.' });
        if (!room.rules[claimType]) return ack({ success: false, error: `Prize type "${claimType}" not active.` });
        if (room.claimedPrizesCount[claimType] >= room.maxPrizes[claimType]) return ack({ success: false, error: `Max winners for "${claimType}" reached.` });

        // Perform validation using TicketStore
        const validationResult = ticketStore.isValidClaim(data.roomId, playerName, claimType);

        if (!validationResult.isValid) {
            return ack({ success: false, error: validationResult.message || `Claim for ${claimType} is invalid.` });
        }

        // Claim is valid, add to pending for admin verification
        const claimId = `CL-${uuidv4().slice(0, 8)}`;
        room.pendingClaimRequests[claimId] = {
            socketId: socket.id, playerName, claimType, claimId,
            validatedTicketGrid: validationResult.validatedTicketGrid,
            validatedNumbers: validationResult.validatedNumbers
        };

        ack({ success: true, claimId }); // Ack to player that claim is submitted for verification
        // Notify admin
        if (room.adminSocketId) {
            io.to(room.adminSocketId).emit('claim-submitted', {
                roomId: data.roomId, claimId, playerName, claimType,
                ticket: validationResult.validatedTicketGrid, // Send validated ticket grid
                numbers: validationResult.validatedNumbers   // Send validated numbers
            });
        }
        // Notify room (optional)
        // io.to(data.roomId).emit('player-claimed-pending', { playerName, claimType });
    });

    socket.on('verify-claim', (data, ack) => {
        const room = getRoomOrAckError(data.roomId, socket, ack);
        if (!room || !isAdmin(socket.id, room)) return ack({ success: false, error: 'Unauthorized.' });

        const { claimId, approved } = data;
        const claimDetails = room.pendingClaimRequests[claimId];
        if (!claimDetails) return ack({ success: false, error: 'Claim not found or already processed.' });

        delete room.pendingClaimRequests[claimId]; // Processed
        const { socketId: playerSocketId, playerName, claimType } = claimDetails;

        if (approved) {
            // Final check on winner limits before awarding
            if (room.claimedPrizesCount[claimType] >= room.maxPrizes[claimType]) {
                const limitMsg = `Max winners for ${claimType} already reached.`;
                io.to(playerSocketId).emit('claim-updated', { roomId: data.roomId, claimId, playerName, claimType, approved: false, error: limitMsg });
                socket.emit('claim-verified', { claimId, playerName, claimType, approved: false, error: limitMsg });
                return ack({ success: true, alreadyWon: true });
            }
            // Award the prize
            room.winners.push({ playerName, prizeType: claimType });
            room.claimedPrizesCount[claimType]++;
            io.to(playerSocketId).emit('claim-updated', { roomId: data.roomId, claimId, playerName, claimType, approved: true });
            socket.emit('claim-verified', { claimId, playerName, claimType, approved: true });
            io.to(data.roomId).emit('winner-announced', { roomId: data.roomId, playerName, prizeType: claimType, winners: room.winners });
            console.log(`Claim approved for ${playerName} (${claimType}) in room ${data.roomId}`);
        } else { // Rejected by admin
            io.to(playerSocketId).emit('claim-updated', { roomId: data.roomId, claimId, playerName, claimType, approved: false });
            socket.emit('claim-verified', { claimId, playerName, claimType, approved: false });
             console.log(`Claim rejected for ${playerName} (${claimType}) in room ${data.roomId}`);
        }
        ack({ success: true }); // Admin action processed
    });


    // --- Disconnect Handling ---
    socket.on('disconnect', (reason) => {
        console.log(`Socket disconnected: ${socket.id}, Reason: ${reason}`);
        let disconnectedPlayerName = null;
        let disconnectedRoomId = null;

        for (const roomId in gameRooms) {
            const room = gameRooms[roomId];
            // Check if admin disconnected
            if (room.adminSocketId === socket.id) {
                console.log(`Admin ${room.adminName} of room ${roomId} disconnected.`);
                room.adminSocketId = null;
                if (room.state === 'running' && room.mode === 'Auto' && room.intervalId) {
                    clearInterval(room.intervalId); room.intervalId = null; room.state = 'paused';
                    io.to(roomId).emit('auto-paused', { message: 'Admin disconnected, game paused.' });
                }
                io.to(roomId).emit('admin-disconnected', { message: 'Admin has disconnected.' });
                disconnectedRoomId = roomId; // Mark room for potential cleanup later if needed
                break;
            }
            // Check if a player disconnected
            for (const playerName in room.players) {
                if (room.players[playerName].socketId === socket.id) {
                    disconnectedPlayerName = room.players[playerName].name;
                    disconnectedRoomId = roomId;
                    console.log(`Player ${disconnectedPlayerName} from room ${roomId} disconnected.`);
                    delete room.players[playerName]; // Remove player from server state

                    // Clean up pending requests/claims associated with this socket ID
                    Object.keys(room.pendingTicketRequests)
                        .filter(reqId => room.pendingTicketRequests[reqId].socketId === socket.id)
                        .forEach(reqId => delete room.pendingTicketRequests[reqId]);
                    Object.keys(room.pendingClaimRequests)
                        .filter(cId => room.pendingClaimRequests[cId].socketId === socket.id)
                        .forEach(cId => delete room.pendingClaimRequests[cId]);

                    break; // Found player, exit inner loop
                }
            }
            if (disconnectedPlayerName) break; // Exit outer loop if player found
        }

        // If a player disconnected, notify the room
        if (disconnectedPlayerName && disconnectedRoomId && gameRooms[disconnectedRoomId]) {
             const room = gameRooms[disconnectedRoomId];
             const playersList = Object.values(room.players).map(p => ({ name: p.name, ticketCount: p.ticketsIssued }));
             io.to(disconnectedRoomId).emit('player-left', { roomId: disconnectedRoomId, playerName: disconnectedPlayerName, playersList });
        }
        // Add logic here if room should be deleted when admin disconnects and no players are left
    });
});

// ========== BLOCK 5: Start Server ==========
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Tambola server listening on port ${PORT}`);
});
