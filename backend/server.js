// server.js
// Location: backend/server.js
const express = require('express');
const path = require('path');
const ticketStore = require('./ticketStore.js'); // Path to ticketStore.js in the same backend directory

const app = express();
const PORT = process.env.PORT || 3000;

// --- Game State (Session Memory for a single conceptual "Room") ---
let gameState = {
    activeRooms: new Map(), // Key: roomId, Value: roomSpecificGameState
};

function getRoomState(roomId) {
    if (!gameState.activeRooms.has(roomId)) {
        gameState.activeRooms.set(roomId, {
            roomId: roomId,
            gameStarted: false,
            gameOver: false,
            currentNumber: null,
            drawnNumbers: [],
            allNumbers: Array.from({ length: 90 }, (_, i) => i + 1),
            availableNumbers: [...Array.from({ length: 90 }, (_, i) => i + 1)],
            gameMode: 'manual',
            gameConfig: { rules: {} },
            prizesClaimed: {}, 
            winners: {}, 
            players: new Map(), 
            ticketRequests: [], 
        });
        console.log(`Initialized new room state for: ${roomId}`);
    }
    return gameState.activeRooms.get(roomId);
}

function resetRoomState(roomId) {
    if (gameState.activeRooms.has(roomId)) {
        const room = gameState.activeRooms.get(roomId);
        room.gameStarted = false;
        room.gameOver = false;
        room.currentNumber = null;
        room.drawnNumbers = [];
        room.availableNumbers = [...room.allNumbers];
        // room.gameMode = 'manual'; // Keep mode or reset as per preference
        // room.gameConfig.rules are set by admin on start.
        room.prizesClaimed = {};
        room.winners = {};
        room.players.forEach(player => {
            player.claims = []; 
        });
        // room.ticketRequests = room.ticketRequests.filter(req => req.approved); 
        console.log(`Game state soft-reset for room: ${roomId}`);
    } else {
        console.warn(`Attempted to reset non-existent room: ${roomId}`);
    }
}

function fullResetServerState() { 
    console.log("Resetting ALL rooms and server state...");
    gameState.activeRooms.clear();
    ticketStore.clearAllTickets(); // Clear tickets from the store
}


app.use(express.json());
// Serve static files from the 'frontend' directory
app.use(express.static(path.join(__dirname, '../frontend')));

// --- Helper Functions ---
function generateId() {
    return Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
}

// --- HTML Serving ---
// Serve index.html for the root path
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// Serve admin.html for the /admin path
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/admin.html'));
});

// --- API Endpoints ---

// POST /api/player/join-game
app.post('/api/player/join-game', (req, res) => {
    const { playerName, roomId, playerId: existingPlayerId } = req.body;

    if (!playerName || !roomId) {
        return res.status(400).json({ message: "Player name and Room ID are required." });
    }

    const room = getRoomState(roomId); // Ensures room exists or is initialized

    let playerId = existingPlayerId;
    let player = existingPlayerId ? room.players.get(existingPlayerId) : null;

    if (!player) { 
        playerId = generateId();
        player = {
            id: playerId,
            name: playerName,
            tickets: [], 
            claims: []   
        };
        room.players.set(playerId, player);
        console.log(`New player ${playerName} (ID: ${playerId}) joined room ${roomId}.`);
    } else {
        player.name = playerName; 
        console.log(`Player ${playerName} (ID: ${playerId}) re-joined room ${roomId}.`);
    }
    
    const playerSpecificState = {
        roomId: room.roomId,
        drawnNumbers: room.drawnNumbers,
        currentNumber: room.currentNumber,
        gameStarted: room.gameStarted,
        gameOver: room.gameOver,
        winningRules: room.gameConfig.rules,
        winners: room.winners,
        playerTickets: player.tickets.map(ticketId => ticketStore.getTicketById(ticketId)).filter(t => t),
        myClaims: player.claims,
        playerId: player.id, 
        playerName: player.name
    };

    res.json({ 
        message: `Successfully joined room ${roomId} as ${playerName}.`,
        playerId: player.id,
        gameState: playerSpecificState
    });
});


// GET /api/player/state - Player gets current game state (player-specific)
app.get('/api/player/state', (req, res) => {
    const { playerId, roomId } = req.query;

    if (!playerId || !roomId) {
        return res.status(400).json({ message: "Player ID and Room ID are required." });
    }
    
    const room = gameState.activeRooms.get(roomId);
    if (!room) {
        return res.status(404).json({ message: "Room not found." });
    }

    const player = room.players.get(playerId);
    if (!player) {
        return res.status(401).json({ message: "Player not found in this room. Please rejoin." });
    }

    res.json({
        roomId: room.roomId,
        drawnNumbers: room.drawnNumbers,
        currentNumber: room.currentNumber,
        gameStarted: room.gameStarted,
        gameOver: room.gameOver,
        winningRules: room.gameConfig.rules,
        winners: room.winners,
        playerTickets: player.tickets.map(ticketId => ticketStore.getTicketById(ticketId)).filter(t => t),
        myClaims: player.claims,
    });
});

// GET /api/admin/state - Admin gets current game state (for a specific room)
app.get('/api/admin/state', (req, res) => {
    const adminViewingRoomId = req.query.roomId; 
    let roomToReport = null;

    if (adminViewingRoomId && gameState.activeRooms.has(adminViewingRoomId)) {
        roomToReport = getRoomState(adminViewingRoomId);
    } else if (gameState.activeRooms.size > 0 && !adminViewingRoomId) {
        // If admin client doesn't specify, and there's at least one room,
        // this implies admin might not have "connected" to a room yet via UI.
        // Send a generic "no room selected" or list of rooms.
        // For now, if only one room exists, default to it.
        if (gameState.activeRooms.size === 1) {
             roomToReport = gameState.activeRooms.values().next().value;
        } else {
            // It's better for admin client to always specify the room it's interested in.
            // console.log("Admin state request: No specific room ID provided by client, or multiple rooms exist.");
            // Sending a default "not connected" like state.
             return res.json({ 
                message: "Please connect to a specific room in the admin panel to see its state.", 
                gameStarted: false, drawnNumbers: [], players: [], ticketRequests: [], claims: [], winners: {},
                availableRooms: Array.from(gameState.activeRooms.keys()) // Optionally send list of rooms
            });
        }
    }


    if (!roomToReport) {
        return res.json({ 
            message: "No active game room found or specified.", 
            gameStarted: false, drawnNumbers: [], players: [], ticketRequests: [], claims: [], winners: {},
            availableRooms: Array.from(gameState.activeRooms.keys())
        });
    }
    
    let aggregatedClaims = [];
    roomToReport.players.forEach(p => {
        p.claims.forEach(c => {
            if (c.status === 'pending') { 
                aggregatedClaims.push({ ...c, playerId: p.id, playerName: p.name });
            }
        });
    });

    res.json({
        roomId: roomToReport.roomId,
        drawnNumbers: roomToReport.drawnNumbers,
        currentNumber: roomToReport.currentNumber,
        gameStarted: roomToReport.gameStarted,
        gameOver: roomToReport.gameOver,
        numbersLeft: roomToReport.availableNumbers.length,
        gameMode: roomToReport.gameMode,
        gameConfig: roomToReport.gameConfig,
        winners: roomToReport.winners,
        players: Array.from(roomToReport.players.values()).map(p => ({id: p.id, name: p.name, ticketCount: p.tickets.length })),
        ticketRequests: roomToReport.ticketRequests.filter(req => !req.approved),
        claims: aggregatedClaims, 
    });
});


// POST /api/admin/start-game - Admin starts the game
app.post('/api/admin/start-game', (req, res) => {
    const { roomId, rules, mode } = req.body;

    if (!roomId) return res.status(400).json({ message: "Room ID is required to start a game." });
    
    const room = getRoomState(roomId); 

    if (room.gameStarted && !room.gameOver) {
        return res.status(400).json({ message: "Game already in progress in this room." });
    }
    
    resetRoomState(roomId); 

    room.gameStarted = true;
    room.gameOver = false;
    room.gameMode = mode || 'manual';
    room.gameConfig.rules = rules || {};

    console.log(`Game started by admin. Room: ${room.roomId}, Mode: ${room.gameMode}, Rules:`, room.gameConfig.rules);
    res.json({ message: "Game started successfully.", roomId: room.roomId, gameStarted: room.gameStarted });
});

// POST /api/admin/draw-number
app.post('/api/admin/draw-number', (req, res) => {
    const { roomId } = req.body; 
    let room;
    if (roomId && gameState.activeRooms.has(roomId)) {
        room = getRoomState(roomId);
    } else {
        return res.status(400).json({ message: "Room ID must be specified and valid." });
    }

    if (!room.gameStarted) {
        return res.status(400).json({ message: "Game not started yet in this room." });
    }
    if (room.gameOver) {
        return res.status(400).json({ message: "Game is over in this room.", gameOver: true });
    }
    if (room.availableNumbers.length === 0) {
        room.gameOver = true;
        room.currentNumber = null;
        return res.status(400).json({ message: "All numbers drawn. Game over.", drawnNumbers: room.drawnNumbers, currentNumber: null, gameOver: true });
    }

    const randomIndex = Math.floor(Math.random() * room.availableNumbers.length);
    room.currentNumber = room.availableNumbers.splice(randomIndex, 1)[0];
    room.drawnNumbers.push(room.currentNumber);
    room.drawnNumbers.sort((a, b) => a - b);

    console.log(`Admin drew number: ${room.currentNumber} for room ${room.roomId}. Numbers left: ${room.availableNumbers.length}`);
    res.json({
        currentNumber: room.currentNumber,
        drawnNumbers: room.drawnNumbers,
        numbersLeft: room.availableNumbers.length
    });
});

// POST /api/admin/stop-game
app.post('/api/admin/stop-game', (req, res) => {
    const { roomId } = req.body; 
    let room;
     if (roomId && gameState.activeRooms.has(roomId)) {
        room = getRoomState(roomId);
    }  else {
        return res.status(400).json({ message: "Room ID must be specified and valid." });
    }

    if (!room.gameStarted) {
        return res.status(400).json({ message: "Game not started, cannot stop." });
    }
    room.gameOver = true;
    console.log(`Game stopped by admin in room ${room.roomId}.`);
    res.json({ message: "Game stopped successfully." });
});

// POST /api/admin/reset-game - Admin resets the ENTIRE SERVER state
app.post('/api/admin/reset-game', (req, res) => {
    fullResetServerState();
    console.log("Full game server state reset by admin.");
    res.json({ message: "Tambola server has been completely reset." });
});


// POST /api/player/request-ticket
app.post('/api/player/request-ticket', (req, res) => {
    const { playerId, playerName, roomId } = req.body; 
    if (!playerId || !roomId || !playerName) {
        return res.status(400).json({ message: "Player ID, Player Name, and Room ID are required." });
    }

    const room = getRoomState(roomId);
    const player = room.players.get(playerId);

    if (!player) {
        return res.status(404).json({ message: "Player not found in this room. Please rejoin." });
    }
    
    const existingTicketCount = player.tickets.length;
    const pendingRequestsForPlayer = room.ticketRequests.filter(r => r.playerId === playerId && r.roomId === roomId && !r.approved).length;

    if (existingTicketCount + pendingRequestsForPlayer >= 5) {
        return res.status(400).json({ message: `Ticket limit (5) reached or pending. You have ${existingTicketCount} tickets and ${pendingRequestsForPlayer} pending requests for this room.` });
    }

    const newRequest = {
        requestId: generateId(),
        playerId: playerId,
        playerName: player.name, // Use name from player object for consistency
        roomId: roomId,
        timestamp: Date.now(),
        approved: false
    };
    room.ticketRequests.push(newRequest);
    console.log(`Ticket request from ${player.name} (ID: ${playerId}) for room ${roomId}. Request ID: ${newRequest.requestId}`);
    res.status(201).json({ message: "Ticket requested successfully. Waiting for admin approval.", requestId: newRequest.requestId });
});

// POST /api/admin/approve-ticket
app.post('/api/admin/approve-ticket', (req, res) => {
    const { requestId, roomId } = req.body; 
    if (!roomId) return res.status(400).json({message: "Room ID is required to approve a ticket."});
    
    const room = getRoomState(roomId);
    const requestIndex = room.ticketRequests.findIndex(r => r.requestId === requestId && r.roomId === roomId && !r.approved);

    if (requestIndex === -1) {
        return res.status(404).json({ message: "Ticket request not found or already processed in this room." });
    }
    const request = room.ticketRequests[requestIndex];
    const player = room.players.get(request.playerId);

    if (!player) { // Should not happen if request is valid
        return res.status(404).json({ message: "Player associated with request not found." });
    }
    if (player.tickets.length >= 5) {
         return res.status(400).json({ message: `Player ${player.name} already has the maximum of 5 tickets.` });
    }

    try {
        const newTicket = ticketStore.getNewTicket();
        if (!newTicket || newTicket.id === "ERROR_TICKET") {
            throw new Error("Ticket generation in store failed.");
        }
        player.tickets.push(newTicket.id); 
        request.approved = true;
        request.ticketId = newTicket.id; 

        console.log(`Ticket ${newTicket.id} approved for ${request.playerName} in room ${room.roomId}`);
        res.json({ message: `Ticket approved for ${request.playerName}.`});
    } catch (error) {
        console.error("Error generating or assigning ticket during approval:", error);
        res.status(500).json({ message: "Failed to generate or assign ticket." });
    }
});


// POST /api/player/claim-prize
app.post('/api/player/claim-prize', (req, res) => {
    const { playerId, ticketId, prizeType, playerNumbers, roomId } = req.body;

    if (!playerId || !ticketId || !prizeType || !playerNumbers || !roomId) {
        return res.status(400).json({ message: "Missing required fields for claim." });
    }
    
    const room = getRoomState(roomId);
    if (!room.gameStarted || room.gameOver) {
        return res.status(400).json({ message: "Cannot claim prize: Game not active or is over." });
    }

    const player = room.players.get(playerId);
    if (!player || !player.tickets.includes(ticketId)) {
        return res.status(404).json({ message: "Player or ticket invalid for this claim." });
    }

    const ticket = ticketStore.getTicketById(ticketId); 
    if (!ticket) {
        return res.status(404).json({ message: "Ticket details not found." });
    }

    const activeRule = room.gameConfig.rules[prizeType];
    if (!activeRule || !activeRule.enabled) {
        return res.status(400).json({ message: `Prize type '${prizeType}' is not active.` });
    }
    
    const currentWinnersForPrize = room.winners[prizeType] ? room.winners[prizeType].length : 0;
    if (currentWinnersForPrize >= activeRule.maxWinners) {
         return res.status(400).json({ message: `Prize '${prizeType}' already has max ${activeRule.maxWinners} winner(s).` });
    }
    
    const existingClaim = player.claims.find(c => c.ticketId === ticketId && c.prizeType === prizeType && (c.status === 'pending' || c.status === 'accepted'));
    if(existingClaim) {
        return res.status(400).json({ message: `You've already claimed or won '${prizeType}' with this ticket.` });
    }

    const drawnNumbersSet = new Set(room.drawnNumbers);
    const claimedNumbersSet = new Set(playerNumbers.map(n => parseInt(n)));
    let isValidClaim = true;

    for (const num of claimedNumbersSet) {
        if (!drawnNumbersSet.has(num)) {
            return res.status(400).json({ message: `Invalid claim: Number ${num} not drawn.`});
        }
        if (!ticket.numbers.includes(num)) { 
            return res.status(400).json({ message: `Invalid claim: Number ${num} not on your ticket.`});
        }
    }
    // Add specific prize logic validation here (e.g. check all numbers for full house, line numbers, etc.)
    // This needs to be robust. Example for fullHouse:
    if (prizeType === 'fullHouse') {
        if (claimedNumbersSet.size !== ticket.numbers.length || !ticket.numbers.every(n => claimedNumbersSet.has(n))) {
            return res.status(400).json({ message: `Full House claim numbers do not match all numbers on ticket.` });
        }
    }
    // Example for firstLine (assuming ticket.rows[0] contains the numbers for the first line)
    else if (prizeType === 'firstLine') {
        const firstLineNumbers = ticket.rows[0].filter(n => n !== null);
        if (claimedNumbersSet.size !== firstLineNumbers.length || !firstLineNumbers.every(n => claimedNumbersSet.has(n))) {
             return res.status(400).json({ message: `First Line claim numbers do not match.` });
        }
    }
    // Add similar checks for secondLine, thirdLine, earlyFive, corners


    const newClaim = {
        claimId: generateId(),
        ticketId,
        prizeType,
        playerNumbers: Array.from(claimedNumbersSet),
        timestamp: Date.now(),
        status: 'pending' 
    };
    player.claims.push(newClaim);

    console.log(`Claim submitted in room ${roomId}: ${prizeType} by ${player.name}. Claim ID: ${newClaim.claimId}`);
    res.json({ message: `Claim for '${prizeType}' submitted. Waiting for admin.`, claimId: newClaim.claimId });
});

// POST /api/admin/process-claim
app.post('/api/admin/process-claim', (req, res) => {
    const { claimId, action, roomId } = req.body; 
    
    if (!roomId) return res.status(400).json({message: "Room ID is required to process a claim."});
    const room = getRoomState(roomId);

    let claimToProcess = null;
    let playerOfClaim = null;

    // Iterate through players in the specific room to find the claim
    for (const player of room.players.values()) {
        const foundClaim = player.claims.find(c => c.claimId === claimId && c.status === 'pending');
        if (foundClaim) {
            claimToProcess = foundClaim;
            playerOfClaim = player;
            break; 
        }
    }

    if (!claimToProcess) {
        return res.status(404).json({ message: "Pending claim not found in this room." });
    }

    if (action === 'accept') {
        const activeRule = room.gameConfig.rules[claimToProcess.prizeType];
        if (!activeRule || !activeRule.enabled) {
             claimToProcess.status = 'rejected';
             claimToProcess.reason = 'Prize type no longer active.';
            return res.status(400).json({ message: `Cannot accept: Prize type '${claimToProcess.prizeType}' is not active.` });
        }

        if (!room.winners[claimToProcess.prizeType]) room.winners[claimToProcess.prizeType] = [];
        
        if (room.winners[claimToProcess.prizeType].length >= activeRule.maxWinners) {
            claimToProcess.status = 'rejected';
            claimToProcess.reason = 'Maximum winners already reached.';
            return res.status(400).json({ message: `Cannot accept: Prize '${claimToProcess.prizeType}' has max ${activeRule.maxWinners} winner(s).` });
        }
        
        claimToProcess.status = 'accepted';
        room.winners[claimToProcess.prizeType].push({ 
            playerId: playerOfClaim.id, 
            playerName: playerOfClaim.name, 
            ticketId: claimToProcess.ticketId, 
            claimedAt: Date.now() 
        });
        
        console.log(`Claim ${claimId} (${claimToProcess.prizeType} by ${playerOfClaim.name}) accepted in room ${roomId}.`);
        res.json({ message: `Claim accepted.` });

    } else if (action === 'reject') {
        claimToProcess.status = 'rejected';
        claimToProcess.reason = req.body.reason || 'Rejected by admin.';
        console.log(`Claim ${claimId} (${claimToProcess.prizeType} by ${playerOfClaim.name}) rejected in room ${roomId}.`);
        res.json({ message: `Claim rejected.` });
    } else {
        return res.status(400).json({ message: "Invalid action." });
    }
});


app.listen(PORT, () => {
    console.log(`Tambola server running on http://localhost:${PORT}`);
    console.log(`Admin panel: http://localhost:${PORT}/admin`);
    console.log(`Player view: http://localhost:${PORT}/`);
});
