// ========== BLOCK 1: Imports & Setup ==========
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
// Assuming TicketStore is in the same directory or ./src/ticketStore.js
// Ensure the path to ticketStore.js is correct.
const TicketStore = require('./ticketStore'); // Adjust path if needed

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: process.env.FRONTEND_ORIGIN || '*' } // Allow all for dev, restrict in prod
});

// ========== BLOCK 2: State & Game Management ==========
const ticketStore = new TicketStore(path.join(__dirname, 'scripts', 'tickets.json'));

// In-memory store for game rooms. For production, consider a persistent store like Redis.
const gameRooms = {};
// Structure for gameRooms[roomId]:
// {
//   roomId: string,
//   adminName: string,
//   adminSocketId: string | null,
//   state: 'stopped' | 'running' | 'paused' | 'finished',
//   rules: { 'Top Line': boolean, ... }, // Only active rules
//   maxPrizes: { 'Top Line': number, ... }, // Max winners for active rules
//   claimedPrizesCount: { 'Top Line': number, ... }, // Current winner count for active rules
//   mode: 'Manual' | 'Auto',
//   interval: number, // seconds for Auto mode
//   intervalId: NodeJS.Timeout | null, // Timer for Auto mode
//   winners: Array<{ playerName: string, prizeType: string }>,
//   maxTicketsPerPlayer: number,
//   players: { [playerName: string]: { socketId: string, ticketsIssued: number } },
//   calledNumbers: Array<number>, // Authoritative list of called numbers for this game instance
//   availableNumbers: Array<number>, // Numbers not yet called for this game instance
//   pendingTicketRequests: { [requestId: string]: { socketId: string, playerName: string } },
//   pendingClaimRequests: { [claimId: string]: { socketId: string, playerName: string, claimType: string, ticketDetails?: any } }
// }

// Helper function to get room or send error
function getRoomOrAckError(roomId, socket, ack) {
    const room = gameRooms[roomId];
    if (!room) {
        const errorMsg = `Room ${roomId} not found.`;
        if (ack) ack({ success: false, error: errorMsg });
        else socket.emit('room-error', { error: errorMsg }); // Emit generic room error
        return null;
    }
    return room;
}

// Helper function to check if socket is admin
function isAdmin(socketId, room) {
    return room && room.adminSocketId === socketId;
}


// ========== BLOCK 3: HTTP Endpoints ==========
app.get('/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString(), activeRooms: Object.keys(gameRooms).length });
});

// Example: Check if a room exists (could be used by client before attempting to join)
app.get('/api/room/:roomId/exists', (req, res) => {
    const rid = req.params.roomId.trim().toUpperCase();
    if (gameRooms[rid]) {
        res.json({ exists: true, gameState: gameRooms[rid].state });
    } else {
        res.status(404).json({ exists: false, error: 'Room not found' });
    }
});

// Serve tickets.json if it's meant to be a public asset (consider security implications)
// If it contains all possible tickets and is large, this might not be ideal.
// app.get('/tickets.json', (req, res) => {
//   res.sendFile(path.join(__dirname, 'scripts', 'tickets.json'));
// });

// ========== BLOCK 4: Socket.IO Handlers ==========
io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    // --- BLOCK 4.1: Create Room ---
    socket.on('create-room', (data, ack) => {
        try {
            if (!data.adminName || !data.rules || !data.maxPrizes || !data.maxTicketsPerPlayer) {
                return ack({ success: false, error: 'Missing required data for room creation.' });
            }

            const roomId = uuidv4().slice(0, 6).toUpperCase();
            // Initialize available numbers for this room instance (1-90)
            const initialAvailableNumbers = Array.from({ length: 90 }, (_, i) => i + 1);

            gameRooms[roomId] = {
                roomId: roomId,
                adminName: data.adminName,
                adminSocketId: socket.id,
                state: 'stopped',
                rules: data.rules, // Expecting { 'PrizeType': true/false }
                maxPrizes: data.maxPrizes, // Expecting { 'PrizeType': count }
                claimedPrizesCount: Object.keys(data.rules).reduce((acc, rule) => {
                    if (data.rules[rule]) acc[rule] = 0;
                    return acc;
                }, {}),
                mode: 'Manual', // Default mode
                interval: 5,    // Default interval
                intervalId: null,
                winners: [],
                maxTicketsPerPlayer: parseInt(data.maxTicketsPerPlayer, 10) || 3,
                players: {},
                calledNumbers: [],
                availableNumbers: [...initialAvailableNumbers],
                pendingTicketRequests: {},
                pendingClaimRequests: {}
            };

            socket.join(roomId);
            ack({ success: true, roomId: roomId }); // Ack to admin who created

            // Emit to the creator (admin) that the room is ready
            socket.emit('room-created', {
                roomId: roomId,
                adminName: gameRooms[roomId].adminName,
                rules: gameRooms[roomId].rules,
                maxPrizes: gameRooms[roomId].maxPrizes,
                maxTicketsPerPlayer: gameRooms[roomId].maxTicketsPerPlayer
            });
            console.log(`Room ${roomId} created by admin ${data.adminName} (Socket: ${socket.id})`);

        } catch (err) {
            console.error('Create room error:', err);
            ack({ success: false, error: err.message || 'Server error creating room.' });
        }
    });

    // --- BLOCK 4.2: Join Room ---
    socket.on('join-room', (data, ack) => {
        try {
            const { roomId, playerName, isAdmin: isAdminJoinAttempt } = data;
            if (!roomId || !playerName) {
                return ack({ success: false, error: 'Room ID and Player Name are required.' });
            }
            const rid = roomId.trim().toUpperCase();
            const room = gameRooms[rid];

            if (!room) {
                return ack({ success: false, error: `Room ${rid} not found.` });
            }

            // Admin Rejoin Logic
            if (isAdminJoinAttempt && playerName === room.adminName) {
                room.adminSocketId = socket.id; // Update admin socket ID
                socket.join(rid);
                ack({ success: true, isAdmin: true });
                // Send full current game state to rejoining admin
                socket.emit('admin-rejoined', {
                    roomId: rid,
                    adminName: room.adminName,
                    gameState: {
                        state: room.state,
                        calledNumbers: room.calledNumbers,
                        rules: room.rules,
                        maxPrizes: room.maxPrizes,
                        mode: room.mode,
                        interval: room.interval,
                        winners: room.winners,
                    },
                    players: Object.values(room.players).map(p => ({ name: p.name, ticketCount: p.ticketsIssued })), // Send player list
                    ticketRequests: Object.values(room.pendingTicketRequests), // Send pending requests
                    prizeClaims: Object.values(room.pendingClaimRequests),   // Send pending claims
                    maxTicketsPerPlayer: room.maxTicketsPerPlayer
                });
                console.log(`Admin ${playerName} rejoined room ${rid} (Socket: ${socket.id})`);
                return;
            }

            // Player Join Logic
            if (room.players[playerName] && room.players[playerName].socketId !== socket.id) {
                // Player with this name already exists from a different session/socket
                // For simplicity, we can disallow this or allow rejoin if socket matches.
                // Current: if name exists but different socket, it's a conflict.
                 return ack({ success: false, error: `Player name "${playerName}" is already taken in this room.` });
            }
            
            // If player is rejoining with the same socket ID (e.g. after a brief disconnect)
            // or is a new player.
            if (!room.players[playerName]) {
                 room.players[playerName] = { socketId: socket.id, name: playerName, ticketsIssued: 0, tickets: [] };
            } else { // Rejoining
                room.players[playerName].socketId = socket.id; // Update socket ID
            }

            socket.join(rid);
            ack({ success: true, isAdmin: false });

            // Send current game state to the newly joined/rejoined player
            const playerTickets = ticketStore.getPlayerTickets(rid, playerName); // Get tickets from TicketStore
            socket.emit('player-joined-state', { // A more specific event for player join state
                roomId: rid,
                playerName: playerName,
                gameState: { state: room.state, rules: room.rules, mode: room.mode },
                calledNumbers: room.calledNumbers,
                tickets: playerTickets, // Send existing tickets if any
                prizeTypes: Object.keys(room.rules).filter(r => room.rules[r]) // Send active prize types
            });
            
            // Notify everyone in the room (including the joiner)
            const playersList = Object.values(room.players).map(p => ({ name: p.name, ticketCount: p.ticketsIssued }));
            io.to(rid).emit('player-joined', { roomId: rid, playerName, playersList });
            console.log(`Player ${playerName} joined room ${rid} (Socket: ${socket.id})`);

            // Auto-issue one ticket on first join if player has none (optional behavior)
            if (room.players[playerName].ticketsIssued === 0 && room.state === 'stopped') { // Only if game not started
                const reqId = `auto-${uuidv4().slice(0,4)}`;
                room.pendingTicketRequests[reqId] = { socketId: socket.id, playerName };
                
                // Simulate admin approval for the first ticket
                const approvalData = ticketStore.approveTicket(rid, playerName, 1); // Ask TicketStore for 1 ticket
                if (approvalData.success && approvalData.tickets.length > 0) {
                    room.players[playerName].ticketsIssued += approvalData.tickets.length;
                    room.players[playerName].tickets.push(...approvalData.tickets); // Store ticket structure if needed by server
                    delete room.pendingTicketRequests[reqId];
                    socket.emit('ticket-updated', { // Send only to the player who got the ticket
                        roomId: rid,
                        playerName: playerName,
                        tickets: approvalData.tickets // Send the actual ticket grids
                    });
                     io.to(rid).emit('player-list-updated', { playersList: Object.values(room.players).map(p => ({ name: p.name, ticketCount: p.ticketsIssued })) });
                }
            }


        } catch (err) {
            console.error('Join room error:', err);
            ack({ success: false, error: err.message || 'Server error joining room.' });
        }
    });

    // --- BLOCK 4.3: Game Controls (Admin Only) ---
    socket.on('start-game', (data, ack) => {
        const room = getRoomOrAckError(data.roomId, socket, ack);
        if (!room || !isAdmin(socket.id, room)) return ack({ success: false, error: 'Unauthorized or room not found.' });
        if (room.state !== 'stopped') return ack({ success: false, error: 'Game already started or finished.' });
        if (!Object.values(data.rules).some(v => v)) return ack({ success: false, error: 'Select at least one prize rule.' });

        room.state = 'running';
        room.rules = data.rules;
        room.maxPrizes = data.maxPrizes;
        room.claimedPrizesCount = Object.keys(data.rules).reduce((acc, rule) => {
            if (data.rules[rule]) acc[rule] = 0;
            return acc;
        }, {});
        room.mode = data.mode || 'Manual';
        room.interval = data.interval || 5;
        room.winners = [];
        room.calledNumbers = []; // Reset for new game
        room.availableNumbers = Array.from({ length: 90 }, (_, i) => i + 1); // Reset available numbers
        ticketStore.resetRoomForNewGame(data.roomId); // Tell TicketStore to reset numbers too

        if (room.intervalId) clearInterval(room.intervalId);
        room.intervalId = null;

        if (room.mode === 'Auto') {
            room.intervalId = setInterval(() => autoCallNextNumber(data.roomId), room.interval * 1000);
        }

        io.to(data.roomId).emit('game-started', {
            roomId: data.roomId,
            rules: room.rules,
            maxPrizes: room.maxPrizes,
            mode: room.mode,
            interval: room.interval
        });
        ack({ success: true });
        console.log(`Game started in room ${data.roomId} by admin ${room.adminName}`);
    });

    function callNextNumberLogic(roomId) {
        const room = gameRooms[roomId];
        if (!room || room.state !== 'running') return null;

        if (room.availableNumbers.length === 0) {
            // All numbers drawn
            if (room.intervalId) clearInterval(room.intervalId);
            room.intervalId = null;
            // room.state = 'finished'; // Game summary will set this
            io.to(roomId).emit('auto-finished'); // Specific event for auto mode completion
            // Consider emitting game-summary here if it's the definitive end
            // emitGameSummary(roomId);
            return null;
        }

        const randomIndex = Math.floor(Math.random() * room.availableNumbers.length);
        const nextNumber = room.availableNumbers.splice(randomIndex, 1)[0];
        room.calledNumbers.push(nextNumber);
        room.calledNumbers.sort((a,b) => a-b); // Keep called numbers sorted

        io.to(roomId).emit('number-called', {
            roomId: roomId,
            number: nextNumber, // The newly called number
            calledNumbers: room.calledNumbers // The full list of called numbers
        });
        return { number: nextNumber, calledNumbers: room.calledNumbers };
    }
    
    function autoCallNextNumber(roomId) {
        const room = gameRooms[roomId];
        if (!room || room.state !== 'running' || room.mode !== 'Auto') {
            if (room && room.intervalId) clearInterval(room.intervalId);
            return;
        }
        const result = callNextNumberLogic(roomId);
        if (!result && room.availableNumbers.length === 0) { // No more numbers and auto-finished was emitted
             // Game might be considered finished, emit summary
            if (room.state !== 'finished') { // Avoid double summary if stopGame is called
                emitGameSummary(roomId);
            }
        }
    }

    socket.on('manual-call-next', (data, ack) => {
        const room = getRoomOrAckError(data.roomId, socket, ack);
        if (!room || !isAdmin(socket.id, room)) return ack({ success: false, error: 'Unauthorized.' });
        if (room.state !== 'running' || room.mode !== 'Manual') return ack({ success: false, error: 'Not in manual running mode.' });

        const result = callNextNumberLogic(data.roomId);
        if (!result) {
            if(room.availableNumbers.length === 0) {
                 ack({ success: false, error: 'All numbers have been drawn.' });
                 emitGameSummary(data.roomId); // End game if all numbers drawn manually
            } else {
                 ack({ success: false, error: 'Could not draw number.' });
            }
        } else {
            ack({ success: true, number: result.number, calledNumbers: result.calledNumbers });
        }
    });
    
    socket.on('admin-toggle-number', (data, ack) => {
        const room = getRoomOrAckError(data.roomId, socket, ack);
        if (!room || !isAdmin(socket.id, room)) return ack({ success: false, error: 'Unauthorized.' });
        if (room.state !== 'running' && room.state !== 'paused') return ack({ success: false, error: 'Game not active.' });

        const { number, shouldBeCalled } = data;
        const num = parseInt(number, 10);

        if (isNaN(num) || num < 1 || num > 90) return ack({ success: false, error: 'Invalid number.' });

        const isCurrentlyCalled = room.calledNumbers.includes(num);
        let changed = false;

        if (shouldBeCalled && !isCurrentlyCalled) {
            room.calledNumbers.push(num);
            const availIndex = room.availableNumbers.indexOf(num);
            if (availIndex > -1) room.availableNumbers.splice(availIndex, 1);
            changed = true;
        } else if (!shouldBeCalled && isCurrentlyCalled) {
            const calledIndex = room.calledNumbers.indexOf(num);
            if (calledIndex > -1) room.calledNumbers.splice(calledIndex, 1);
            if (!room.availableNumbers.includes(num)) room.availableNumbers.push(num);
            changed = true;
        }
        
        if (changed) {
            room.calledNumbers.sort((a, b) => a - b);
            room.availableNumbers.sort((a, b) => a - b);
            io.to(data.roomId).emit('number-called', {
                roomId: data.roomId,
                number: num, // The number that was toggled
                calledNumbers: room.calledNumbers
            });
        }
        ack({ success: true });
    });


    socket.on('pause-auto', (data, ack) => {
        const room = getRoomOrAckError(data.roomId, socket, ack);
        if (!room || !isAdmin(socket.id, room)) return ack({ success: false, error: 'Unauthorized.' });
        if (room.mode !== 'Auto' || room.state !== 'running' || !room.intervalId) return ack({ success: false, error: 'Not in auto-running mode or timer not active.' });

        clearInterval(room.intervalId);
        room.intervalId = null;
        room.state = 'paused';
        io.to(data.roomId).emit('auto-paused');
        ack({ success: true });
    });

    socket.on('resume-auto', (data, ack) => {
        const room = getRoomOrAckError(data.roomId, socket, ack);
        if (!room || !isAdmin(socket.id, room)) return ack({ success: false, error: 'Unauthorized.' });
        if (room.mode !== 'Auto' || room.state !== 'paused') return ack({ success: false, error: 'Not in auto-paused mode.' });

        room.state = 'running';
        room.intervalId = setInterval(() => autoCallNextNumber(data.roomId), room.interval * 1000);
        io.to(data.roomId).emit('auto-resumed');
        ack({ success: true });
    });

    function emitGameSummary(roomId) {
        const room = gameRooms[roomId];
        if (!room) return;

        if (room.intervalId) {
            clearInterval(room.intervalId);
            room.intervalId = null;
        }
        room.state = 'finished';
        io.to(roomId).emit('game-summary', {
            roomId: roomId,
            calledNumbers: room.calledNumbers,
            winners: room.winners
        });
        console.log(`Game summary emitted for room ${roomId}. Winners: ${room.winners.length}`);
        // Consider archiving or cleaning up the room after a delay
        // setTimeout(() => delete gameRooms[roomId], 60 * 60 * 1000); // Example: cleanup after 1 hour
    }

    socket.on('stop-game', (data, ack) => {
        const room = getRoomOrAckError(data.roomId, socket, ack);
        if (!room || !isAdmin(socket.id, room)) return ack({ success: false, error: 'Unauthorized.' });
        if (room.state === 'stopped' || room.state === 'finished') return ack({ success: false, error: 'Game not active.' });
        
        emitGameSummary(data.roomId);
        ack({ success: true });
    });


    // --- BLOCK 4.4: Ticket Management ---
    socket.on('request-ticket', (data, ack) => {
        const room = getRoomOrAckError(data.roomId, socket, ack);
        if (!room) return; // Error handled by helper
        if (room.state !== 'running' && room.state !== 'stopped') { // Allow requests if game stopped but not started, or running
             return ack({ success: false, error: 'Game is not in a state to request tickets (must be stopped or running).' });
        }

        const player = room.players[data.playerName];
        if (!player || player.socketId !== socket.id) {
            return ack({ success: false, error: 'Player not found or mismatched session.' });
        }
        if (player.ticketsIssued >= room.maxTicketsPerPlayer) {
            return ack({ success: false, error: `Ticket limit (${room.maxTicketsPerPlayer}) reached.` });
        }

        const requestId = `TR-${uuidv4().slice(0, 8)}`;
        room.pendingTicketRequests[requestId] = { socketId: socket.id, playerName: data.playerName, requestId };
        
        ack({ success: true, requestId }); // Ack to player

        // Notify admin
        if (room.adminSocketId) {
            io.to(room.adminSocketId).emit('ticket-requested', {
                roomId: data.roomId,
                requestId,
                playerName: data.playerName
            });
        }
    });

    socket.on('approve-ticket', (data, ack) => { // Admin approves/rejects
        const room = getRoomOrAckError(data.roomId, socket, ack);
        if (!room || !isAdmin(socket.id, room)) return ack({ success: false, error: 'Unauthorized.' });

        const { requestId, approved } = data;
        const requestDetails = room.pendingTicketRequests[requestId];

        if (!requestDetails) {
            return ack({ success: false, error: 'Ticket request not found or already processed.' });
        }
        
        const { socketId: playerSocketId, playerName } = requestDetails;
        delete room.pendingTicketRequests[requestId]; // Remove from pending

        if (approved) {
            const player = room.players[playerName];
            if (player && player.ticketsIssued < room.maxTicketsPerPlayer) {
                // Use TicketStore to generate and assign tickets
                const ticketResult = ticketStore.approveTicket(data.roomId, playerName, 1); // Request 1 ticket
                
                if (ticketResult.success && ticketResult.tickets.length > 0) {
                    player.ticketsIssued += ticketResult.tickets.length;
                    player.tickets.push(...ticketResult.tickets); // Store ticket structure if needed by server

                    // Notify the specific player their request was approved + send ticket
                    io.to(playerSocketId).emit('ticket-request-response', { roomId: data.roomId, requestId, approved: true });
                    io.to(playerSocketId).emit('ticket-updated', {
                        roomId: data.roomId,
                        playerName: playerName,
                        tickets: ticketResult.tickets // Send the actual ticket grids
                    });
                     // Notify admin it was resolved
                    socket.emit('ticket-request-resolved', {requestId, approved: true, playerName});
                    // Update player list for everyone
                    io.to(data.roomId).emit('player-list-updated', { playersList: Object.values(room.players).map(p => ({ name: p.name, ticketCount: p.ticketsIssued })) });

                } else {
                     ack({ success: false, error: ticketResult.error || 'Failed to generate ticket from store.' });
                     io.to(playerSocketId).emit('ticket-request-response', { roomId: data.roomId, requestId, approved: false, error: 'Admin approved, but failed to get ticket.' });
                     socket.emit('ticket-request-resolved', {requestId, approved: false, error: 'Failed to get ticket for player.', playerName});
                     return; // Important: stop further execution
                }
            } else {
                 ack({ success: false, error: 'Player ticket limit reached or player not found.' });
                 io.to(playerSocketId).emit('ticket-request-response', { roomId: data.roomId, requestId, approved: false, error: 'Ticket limit reached or player issue.' });
                 socket.emit('ticket-request-resolved', {requestId, approved: false, error: 'Player ticket limit reached.', playerName});
                 return;
            }
        } else { // Rejected
            io.to(playerSocketId).emit('ticket-request-response', { roomId: data.roomId, requestId, approved: false, error: 'Ticket request rejected by admin.' });
            socket.emit('ticket-request-resolved', {requestId, approved: false, playerName});
        }
        ack({ success: true }); // Admin's action was processed
    });


    // --- BLOCK 4.5: Claim Management ---
    socket.on('submit-claim', (data, ack) => {
        const room = getRoomOrAckError(data.roomId, socket, ack);
        if (!room) return;
        if (room.state !== 'running') return ack({ success: false, error: 'Game is not running.' });

        const { playerName, claimType, ticketDetails } = data; // ticketDetails might be player's current marked numbers
        const player = room.players[playerName];

        if (!player || player.socketId !== socket.id) {
            return ack({ success: false, error: 'Player not recognized or session mismatch.' });
        }
        if (!room.rules[claimType]) { // Check if this prize is active for the game
            return ack({ success: false, error: `Prize type "${claimType}" is not active in this game.` });
        }
        if (room.claimedPrizesCount[claimType] >= room.maxPrizes[claimType]) {
            return ack({ success: false, error: `Max winners for "${claimType}" already reached.` });
        }

        // Server-side validation of the claim using TicketStore
        // TicketStore needs access to player's tickets and all called numbers for the room.
        const validationResult = ticketStore.isValidClaim(data.roomId, playerName, claimType, room.calledNumbers);

        if (!validationResult.isValid) {
            return ack({ success: false, error: validationResult.error || `Claim for ${claimType} is not valid.` });
        }

        const claimId = `CL-${uuidv4().slice(0, 8)}`;
        room.pendingClaimRequests[claimId] = { socketId: socket.id, playerName, claimType, claimId, ticketDetails: validationResult.ticketDetails || ticketDetails };
        
        ack({ success: true, claimId }); // Ack to player

        // Notify admin of the new claim
        if (room.adminSocketId) {
            io.to(room.adminSocketId).emit('claim-submitted', {
                roomId: data.roomId,
                claimId,
                playerName,
                claimType,
                // Optionally send numbers from validationResult.ticketDetails for admin to see
            });
        }
        // Notify room a claim was submitted (optional, could be noisy)
        // io.to(data.roomId).emit('player-claimed', { playerName, claimType });
    });

    socket.on('verify-claim', (data, ack) => { // Admin verifies/rejects
        const room = getRoomOrAckError(data.roomId, socket, ack);
        if (!room || !isAdmin(socket.id, room)) return ack({ success: false, error: 'Unauthorized.' });

        const { claimId, approved } = data;
        const claimDetails = room.pendingClaimRequests[claimId];

        if (!claimDetails) {
            return ack({ success: false, error: 'Claim not found or already processed.' });
        }
        
        const { socketId: playerSocketId, playerName, claimType } = claimDetails;
        delete room.pendingClaimRequests[claimId];

        let messageToPlayer = '';
        if (approved) {
            // Double check winner limits before final approval
            if (room.claimedPrizesCount[claimType] >= room.maxPrizes[claimType]) {
                messageToPlayer = `Sorry, max winners for ${claimType} was reached just before your approval.`;
                 io.to(playerSocketId).emit('claim-updated', { roomId: data.roomId, claimId, playerName, claimType, approved: false, error: messageToPlayer });
                 socket.emit('claim-verified', { claimId, playerName, claimType, approved: false, error: `Max winners for ${claimType} already reached.` }); // Notify admin
                 return ack({ success: true, alreadyWon: true }); // Indicate it was processed but limit hit
            }

            room.winners.push({ playerName, prizeType: claimType });
            room.claimedPrizesCount[claimType]++;
            messageToPlayer = `Your claim for ${claimType} has been APPROVED! Congratulations!`;
        } else {
            messageToPlayer = `Your claim for ${claimType} has been REJECTED by the admin.`;
        }

        // Notify the specific player about their claim status
        io.to(playerSocketId).emit('claim-updated', { roomId: data.roomId, claimId, playerName, claimType, approved });
        
        // Notify admin that claim was verified
        socket.emit('claim-verified', { claimId, playerName, claimType, approved });

        // If approved, notify the entire room about the winner (optional, can be part of game summary)
        if (approved) {
            io.to(data.roomId).emit('winner-announced', { roomId: data.roomId, playerName, prizeType: claimType, winners: room.winners });
        }
        ack({ success: true });
    });


    // --- BLOCK 4.6: Disconnect Handling ---
    socket.on('disconnect', (reason) => {
        console.log(`Socket disconnected: ${socket.id}, Reason: ${reason}`);
        // Find which room and player this socket belonged to
        for (const roomId in gameRooms) {
            const room = gameRooms[roomId];
            if (room.adminSocketId === socket.id) {
                console.log(`Admin ${room.adminName} of room ${roomId} disconnected.`);
                room.adminSocketId = null; // Mark admin as disconnected
                // Optionally pause the game or notify players
                if (room.state === 'running' && room.mode === 'Auto' && room.intervalId) {
                    clearInterval(room.intervalId);
                    room.intervalId = null;
                    room.state = 'paused';
                    io.to(roomId).emit('auto-paused', { message: 'Game paused due to admin disconnection.' });
                }
                io.to(roomId).emit('admin-disconnected', { message: 'Admin has disconnected. Game controls might be limited.' });
                break; // Found admin
            }

            for (const playerName in room.players) {
                if (room.players[playerName].socketId === socket.id) {
                    console.log(`Player ${playerName} from room ${roomId} disconnected.`);
                    // Keep player data for potential rejoin, or remove them:
                    // delete room.players[playerName]; // Option 1: Remove player fully
                    
                    // Option 2: Mark as disconnected, allow rejoin
                    // room.players[playerName].socketId = null; // Or some other indicator

                    // For simplicity, let's remove them for now and notify
                    const disconnectedPlayerName = room.players[playerName].name;
                    delete room.players[playerName];

                    const playersList = Object.values(room.players).map(p => ({ name: p.name, ticketCount: p.ticketsIssued }));
                    io.to(roomId).emit('player-left', { roomId, playerName: disconnectedPlayerName, playersList });
                    
                    // Clean up pending requests for this player
                    Object.keys(room.pendingTicketRequests).forEach(reqId => {
                        if (room.pendingTicketRequests[reqId].socketId === socket.id) {
                            delete room.pendingTicketRequests[reqId];
                        }
                    });
                    Object.keys(room.pendingClaimRequests).forEach(claimId => {
                        if (room.pendingClaimRequests[claimId].socketId === socket.id) {
                            delete room.pendingClaimRequests[claimId];
                        }
                    });
                    break; // Found player
                }
            }
        }
    });
});

// ========== BLOCK 5: Start Server ==========
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Tambola server listening on port ${PORT}`);
    console.log(`Frontend probably at http://localhost:${PORT} (if serving static files) or your frontend dev server address.`);
});

// Basic static file serving (optional, if you want to serve frontend from same origin)
// app.use(express.static(path.join(__dirname, '..', 'frontend'))); // Adjust path to your frontend build/HTML files
// app.get('/', (req, res) => {
//    res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
// });
// app.get('/admin', (req, res) => {
//    res.sendFile(path.join(__dirname, '..', 'frontend', 'admin.html'));
// });
