// backend/server.js
// Main Express server for the Tambola game backend.
console.log("--- Tambola Server (v5 - Route Order & Debug) Starting ---"); // Version log

const express = require('express');
const path = require('path');
const cors = require('cors');
const ticketStore = require('./ticketStore.js'); 

const app = express();
const PORT = process.env.PORT || 3000; 

// --- CORS Configuration ---
const allowedOrigins = [
    'https://mytambola.netlify.app',    
    'https://3kzbl6hqlkkh8t7s5097ut5oaydnlllm9655d6162p5vx5d14z-h752753355.scf.usercontent.goog', // From previous logs
    'http://localhost:3000',           
    'http://127.0.0.1:5500',          
];

const corsOptions = {
    origin: function (origin, callback) {
        if (!origin || allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            console.warn(`CORS Error: Origin ${origin} not allowed.`);
            callback(new Error(`Origin ${origin} not allowed by CORS`));
        }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], 
    allowedHeaders: ['Content-Type', 'Authorization'], 
    credentials: true, 
    optionsSuccessStatus: 200 
};

app.use(cors(corsOptions)); 
app.use(express.json());     

// --- In-Memory Game State Storage ---
const activeRooms = new Map(); 

// --- Helper Functions ---
function getRoomState(roomId) {
    if (!activeRooms.has(roomId)) {
        activeRooms.set(roomId, {
            roomId: roomId,
            gameStarted: false,
            gameOver: false,
            currentNumber: null,
            drawnNumbers: [], 
            allPossibleNumbers: Array.from({ length: 90 }, (_, i) => i + 1), 
            availableNumbers: [...Array.from({ length: 90 }, (_, i) => i + 1)], 
            gameMode: 'manual', 
            gameConfig: { rules: {} },
            winners: {}, 
            players: new Map(), 
            ticketRequests: [], 
        });
        console.log(`Initialized new room state for: ${roomId}`);
    }
    return activeRooms.get(roomId);
}

function resetRoomForNewGame(roomId) {
    if (activeRooms.has(roomId)) {
        const room = activeRooms.get(roomId);
        room.gameStarted = false;
        room.gameOver = false;
        room.currentNumber = null;
        room.drawnNumbers = [];
        room.availableNumbers = [...room.allPossibleNumbers];
        room.winners = {}; 
        room.players.forEach(player => {
            player.claims = []; 
        });
        console.log(`Game state soft-reset for a new round in room: ${roomId}`);
    } else {
        console.warn(`Attempted to reset non-existent room: ${roomId} for a new game.`);
    }
}

function fullServerReset() { 
    console.log("!!! Resetting ENTIRE SERVER: Clearing all rooms and ticket store !!!");
    activeRooms.clear();
    if (ticketStore.clearAllTickets) { 
        ticketStore.clearAllTickets(); 
    } else {
        console.warn("ticketStore.clearAllTickets function not found. Tickets may not be cleared.");
    }
}

function generateId() {
    return Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
}

// --- API Endpoints (Define BEFORE static serving) ---

app.get('/api/health', (req, res) => { // Simple health check endpoint
    console.log(`[API] GET /api/health | Origin: ${req.get('origin')}`);
    res.status(200).json({ status: 'UP', message: 'Tambola backend is running', version: 'v5' });
});


app.post('/api/player/join-game', (req, res) => {
    console.log(`[API] POST /api/player/join-game | Origin: ${req.get('origin')}`);
    console.log("Request Body:", req.body);

    const { playerName, roomId, playerId: existingPlayerId } = req.body;

    if (!playerName || !playerName.trim() || !roomId || !roomId.trim()) {
        console.error("Join Game Error: Player name and Room ID are mandatory.");
        return res.status(400).json({ message: "Player name and Room ID are mandatory." });
    }

    const room = getRoomState(roomId); 

    let playerId = existingPlayerId;
    let player = existingPlayerId ? room.players.get(existingPlayerId) : null;

    if (player && player.name.toLowerCase() !== playerName.toLowerCase()) {
        player.name = playerName;
        console.log(`Player ${playerName} (ID: ${playerId}) re-joined room ${roomId} (name updated).`);
    } else if (!player) { 
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

app.get('/api/player/state', (req, res) => {
    const { playerId, roomId } = req.query;
    // console.log(`[API] GET /api/player/state | Origin: ${req.get('origin')}, Query:`, req.query);

    if (!playerId || !roomId) {
        return res.status(400).json({ message: "Player ID and Room ID are required." });
    }
    
    const room = activeRooms.get(roomId);
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

app.get('/api/admin/state', (req, res) => {
    // ***** SPECIFIC DEBUG LOG FOR THIS ROUTE *****
    console.log(`--- SERVER HIT: GET /api/admin/state --- ROUTE HANDLER REACHED ---`);
    // ********************************************
    const adminViewingRoomId = req.query.roomId; 
    console.log(`[API] GET /api/admin/state | Origin: ${req.get('origin')}, Query:`, req.query);
    
    if (!adminViewingRoomId) {
        console.log("[API /api/admin/state] Error: Room ID is required.");
        return res.status(400).json({ 
            message: "Room ID is required to fetch admin state.",
            availableRooms: Array.from(activeRooms.keys()) 
        });
    }
    
    const room = activeRooms.get(adminViewingRoomId);
    if (!room) {
        console.log(`[API /api/admin/state] Error: Room '${adminViewingRoomId}' not found.`);
        return res.status(404).json({ 
            message: `Room '${adminViewingRoomId}' not found.`,
            availableRooms: Array.from(activeRooms.keys())
        });
    }
    
    let aggregatedPendingClaims = [];
    room.players.forEach(p => {
        (p.claims || []).forEach(c => { 
            if (c.status === 'pending') { 
                aggregatedPendingClaims.push({ 
                    claimId: c.claimId, 
                    prizeType: c.prizeType,
                    ticketId: c.ticketId, 
                    playerId: p.id, 
                    playerName: p.name 
                });
            }
        });
    });
    console.log(`[API /api/admin/state] Successfully found room ${adminViewingRoomId}. Sending state.`);
    res.json({
        roomId: room.roomId,
        drawnNumbers: room.drawnNumbers,
        currentNumber: room.currentNumber,
        gameStarted: room.gameStarted,
        gameOver: room.gameOver,
        numbersLeft: room.availableNumbers.length,
        gameMode: room.gameMode,
        gameConfig: room.gameConfig,
        winners: room.winners,
        players: Array.from(room.players.values()).map(p => ({id: p.id, name: p.name, ticketCount: p.tickets.length })),
        ticketRequests: room.ticketRequests.filter(req => !req.approved && req.roomId === room.roomId),
        claims: aggregatedPendingClaims, 
    });
});


app.post('/api/admin/start-game', (req, res) => {
    console.log(`[API] POST /api/admin/start-game | Origin: ${req.get('origin')}, Body:`, req.body);
    const { roomId, rules, mode } = req.body;

    if (!roomId) return res.status(400).json({ message: "Room ID is required to start a game." });
    
    const room = getRoomState(roomId); 

    if (room.gameStarted && !room.gameOver) {
        return res.status(400).json({ message: "Game already in progress in this room. Stop or reset first." });
    }
    
    resetRoomForNewGame(roomId); 

    room.gameStarted = true;
    room.gameOver = false; 
    room.gameMode = mode || 'manual';
    room.gameConfig.rules = rules || {}; 

    console.log(`Game started by admin. Room: ${room.roomId}, Mode: ${room.gameMode}, Rules:`, room.gameConfig.rules);
    res.json({ message: "Game started successfully.", roomId: room.roomId, gameStarted: room.gameStarted });
});

app.post('/api/admin/draw-number', (req, res) => {
    console.log(`[API] POST /api/admin/draw-number | Origin: ${req.get('origin')}, Body:`, req.body);
    const { roomId } = req.body; 
    
    if (!roomId) return res.status(400).json({ message: "Room ID must be specified." });
    const room = activeRooms.get(roomId);
    if (!room) return res.status(404).json({ message: "Room not found." });

    if (!room.gameStarted) {
        return res.status(400).json({ message: "Game not started yet in this room." });
    }
    if (room.gameOver) {
        return res.status(400).json({ message: "Game is over in this room.", gameOver: true });
    }
    if (room.availableNumbers.length === 0) {
        room.gameOver = true;
        room.currentNumber = null; 
        console.log(`Game over in room ${room.roomId}. All numbers drawn.`);
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

app.post('/api/admin/stop-game', (req, res) => {
    console.log(`[API] POST /api/admin/stop-game | Origin: ${req.get('origin')}, Body:`, req.body);
    const { roomId } = req.body; 
    
    if (!roomId) return res.status(400).json({ message: "Room ID must be specified." });
    const room = activeRooms.get(roomId);
    if (!room) return res.status(404).json({ message: "Room not found." });

    if (!room.gameStarted) {
        return res.status(400).json({ message: "Game not started, cannot stop." });
    }
    room.gameOver = true; 
    console.log(`Game stopped by admin in room ${room.roomId}.`);
    res.json({ message: "Game stopped successfully." });
});

app.post('/api/admin/reset-game', (req, res) => {
    console.log(`[API] POST /api/admin/reset-game | Origin: ${req.get('origin')}`);
    fullServerReset(); 
    console.log("Full game server state reset by admin.");
    res.json({ message: "Tambola server has been completely reset." });
});


app.post('/api/player/request-ticket', (req, res) => {
    console.log(`[API] POST /api/player/request-ticket | Origin: ${req.get('origin')}, Body:`, req.body);
    const { playerId, playerName, roomId } = req.body; 

    if (!playerId || !roomId || !playerName) {
        return res.status(400).json({ message: "Player ID, Player Name, and Room ID are required." });
    }

    const room = getRoomState(roomId); 
    const player = room.players.get(playerId);

    if (!player) {
        return res.status(404).json({ message: "Player not found in this room. Please rejoin first." });
    }
    
    const existingTicketCount = player.tickets.length;
    const pendingRequestsForPlayerInRoom = room.ticketRequests.filter(r => r.playerId === playerId && r.roomId === roomId && !r.approved).length;

    if (existingTicketCount + pendingRequestsForPlayerInRoom >= 5) {
        return res.status(400).json({ message: `Ticket limit (5) reached or pending. You have ${existingTicketCount} tickets and ${pendingRequestsForPlayerInRoom} pending requests for this room.` });
    }

    const newRequest = {
        requestId: generateId(),
        playerId: playerId,
        playerName: player.name, 
        roomId: roomId, 
        timestamp: Date.now(),
        approved: false
    };
    room.ticketRequests.push(newRequest); 
    console.log(`Ticket request from ${player.name} (ID: ${playerId}) for room ${roomId}. Request ID: ${newRequest.requestId}`);
    res.status(201).json({ message: "Ticket requested successfully. Waiting for admin approval.", requestId: newRequest.requestId });
});

app.post('/api/admin/approve-ticket', (req, res) => {
    console.log(`[API] POST /api/admin/approve-ticket | Origin: ${req.get('origin')}, Body:`, req.body);
    const { requestId, roomId } = req.body; 

    if (!roomId) return res.status(400).json({message: "Room ID is required to approve a ticket."});
    const room = activeRooms.get(roomId);
    if (!room) return res.status(404).json({message: `Room '${roomId}' not found.`});
    
    const requestIndex = room.ticketRequests.findIndex(r => r.requestId === requestId && r.roomId === roomId && !r.approved);

    if (requestIndex === -1) {
        return res.status(404).json({ message: "Ticket request not found or already processed in this room." });
    }
    const request = room.ticketRequests[requestIndex];
    const player = room.players.get(request.playerId);

    if (!player) { 
        request.approved = false; 
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


app.post('/api/player/claim-prize', (req, res) => {
    console.log(`[API] POST /api/player/claim-prize | Origin: ${req.get('origin')}, Body:`, req.body);
    const { playerId, ticketId, prizeType, playerNumbers, roomId } = req.body;

    if (!playerId || !ticketId || !prizeType || !Array.isArray(playerNumbers) || !roomId) {
        return res.status(400).json({ message: "Missing or invalid required fields for claim (playerId, ticketId, prizeType, playerNumbers array, roomId)." });
    }
    
    const room = activeRooms.get(roomId);
    if (!room) return res.status(404).json({ message: "Room not found." });

    if (!room.gameStarted || room.gameOver) {
        return res.status(400).json({ message: "Cannot claim prize: Game not active or is over." });
    }

    const player = room.players.get(playerId);
    if (!player || !player.tickets.includes(ticketId)) {
        return res.status(404).json({ message: "Player or ticket invalid for this claim." });
    }

    const ticket = ticketStore.getTicketById(ticketId); 
    if (!ticket) {
        return res.status(404).json({ message: "Ticket details not found (may have expired)." });
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

    // --- Server-Side Validation of Claimed Numbers ---
    const drawnNumbersSet = new Set(room.drawnNumbers);
    const claimedNumbersSet = new Set(Array.isArray(playerNumbers) ? playerNumbers.map(n => parseInt(n)) : []); 

    for (const num of claimedNumbersSet) {
        if (!drawnNumbersSet.has(num)) {
            return res.status(400).json({ message: `Invalid claim: Number ${num} not drawn.`});
        }
    }
    for (const num of claimedNumbersSet) {
         if (!ticket.numbers.includes(num)) { 
            return res.status(400).json({ message: `Invalid claim: Number ${num} not on your ticket.`});
        }
    }
    
    let prizeConditionMet = false;
    if (prizeType === 'fullHouse') {
        if (ticket.numbers.every(n => claimedNumbersSet.has(n)) && claimedNumbersSet.size === ticket.numbers.length) {
            prizeConditionMet = true;
        }
    } else if (prizeType.includes('Line')) { 
        let lineIndex = -1;
        if (prizeType === 'firstLine') lineIndex = 0;
        else if (prizeType === 'secondLine') lineIndex = 1;
        else if (prizeType === 'thirdLine') lineIndex = 2;
        
        if (lineIndex !== -1 && ticket.rows[lineIndex]) {
            const lineNumbersOnTicket = ticket.rows[lineIndex].filter(n => n !== null);
            if (lineNumbersOnTicket.length > 0 && lineNumbersOnTicket.every(n => claimedNumbersSet.has(n))) {
                 prizeConditionMet = true;
            }
        }
    } else if (prizeType === 'earlyFive') {
        if (claimedNumbersSet.size >= 5) { 
             prizeConditionMet = true; 
        }
    } else if (prizeType === 'corners') {
        const r0 = ticket.rows[0];
        const r2 = ticket.rows[2];
        if (r0 && r2) { 
            const cornersOnTicket = [
                r0.find(n => n !== null), 
                r0.slice().reverse().find(n => n !== null), 
                r2.find(n => n !== null), 
                r2.slice().reverse().find(n => n !== null) 
            ].filter(n => n !== null && n !== undefined); 
            const uniqueCorners = [...new Set(cornersOnTicket)];
            if (uniqueCorners.length === 4 && uniqueCorners.every(n => claimedNumbersSet.has(n))) {
                prizeConditionMet = true;
            }
        }
    }

    if (!prizeConditionMet) {
         return res.status(400).json({ message: `Claim conditions for ${prizeType} not met based on marked numbers and drawn numbers.` });
    }
    // --- End Server-Side Validation ---

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

app.post('/api/admin/process-claim', (req, res) => {
    console.log(`[API] POST /api/admin/process-claim | Origin: ${req.get('origin')}, Body:`, req.body);
    const { claimId, action, roomId } = req.body; 
    
    if (!roomId) return res.status(400).json({message: "Room ID is required to process a claim."});
    const room = activeRooms.get(roomId);
    if (!room) return res.status(404).json({message: `Room '${roomId}' not found.`});

    let claimToProcess = null;
    let playerOfClaim = null;

    for (const player of room.players.values()) {
        const foundClaim = (player.claims || []).find(c => c.claimId === claimId && c.status === 'pending');
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
            console.warn(`Rejecting claim ${claimId}: Prize type ${claimToProcess.prizeType} not active.`);
            return res.status(400).json({ message: `Cannot accept: Prize type '${claimToProcess.prizeType}' is not active.` });
        }

        if (!room.winners[claimToProcess.prizeType]) room.winners[claimToProcess.prizeType] = [];
        
        if (room.winners[claimToProcess.prizeType].length >= activeRule.maxWinners) {
            claimToProcess.status = 'rejected';
            claimToProcess.reason = 'Maximum winners already reached.';
             console.warn(`Rejecting claim ${claimId}: Max winners reached for ${claimToProcess.prizeType}.`);
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
        console.log(`Claim ${claimId} (${claimToProcess.prizeType} by ${playerOfClaim.name}) rejected in room ${roomId}. Reason: ${claimToProcess.reason}`);
        res.json({ message: `Claim rejected.` });
    } else {
        return res.status(400).json({ message: "Invalid action specified." });
    }
});


// --- Static File Serving (AFTER API routes) ---
// This is primarily for local development convenience.
// In a typical Netlify (frontend) + Render (backend) setup,
// Netlify serves the frontend, and these routes might not be hit by external users.
app.use(express.static(path.join(__dirname, '../frontend')));

// Catch-all for frontend routes (if SPA, and for local dev)
// Ensure this is AFTER all API routes.
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});


// --- Server Listen ---
app.listen(PORT, '0.0.0.0', () => { 
    console.log(`Tambola server (v5) running on port ${PORT}`);
    console.log(`Accepting requests from origins: ${allowedOrigins.join(', ')}`);
});
