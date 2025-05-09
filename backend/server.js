// server.js
// Location: backend/server.js
const express = require('express');
const path = require('path');
const cors = require('cors'); // Import CORS package
const ticketStore = require('./ticketStore.js'); 

const app = express();
const PORT = process.env.PORT || 3000; // Render will set PORT environment variable

// --- CORS Configuration ---
const allowedOrigins = [
    'https://mytambola.netlify.app', // Your main Netlify frontend URL
    'https://3kzbl6hqlkkh8t7s5097ut5oaydnlllm9655d6162p5vx5d14z-h752753355.scf.usercontent.goog', // The new origin from the error log
    'http://localhost:3000',        // For local frontend development (if needed)
    'http://127.0.0.1:5500',       // For VS Code Live Server (if needed)
    // Add any other origins if necessary (e.g., custom domains)
];

const corsOptions = {
    origin: function (origin, callback) {
        // Allow requests with no origin OR from allowed origins
        // `!origin` allows server-to-server requests or tools like Postman/curl
        if (!origin || allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            console.warn(`CORS Error: Origin ${origin} not allowed.`); // Log blocked origins
            callback(new Error('Not allowed by CORS'));
        }
    },
    optionsSuccessStatus: 200 // For compatibility with older browsers
};

app.use(cors(corsOptions)); // Use CORS middleware *before* your API routes

// --- Game State (Session Memory) ---
let gameState = {
    activeRooms: new Map(), // Key: roomId, Value: roomSpecificGameState
};

// --- Helper Functions ---
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
        room.prizesClaimed = {};
        room.winners = {};
        room.players.forEach(player => {
            player.claims = []; 
        });
        console.log(`Game state soft-reset for room: ${roomId}`);
    } else {
        console.warn(`Attempted to reset non-existent room: ${roomId}`);
    }
}

function fullResetServerState() { 
    console.log("Resetting ALL rooms and server state...");
    gameState.activeRooms.clear();
    if (ticketStore.clearAllTickets) { 
        ticketStore.clearAllTickets(); 
    } else {
        console.warn("ticketStore.clearAllTickets function not found. Tickets may not be cleared.");
    }
}

function generateId() {
    return Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
}

// --- Middleware ---
app.use(express.json()); 
app.use(express.static(path.join(__dirname, '../frontend'))); 

// --- HTML Serving (for local testing) ---
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/admin.html'));
});

// --- API Endpoints ---

// POST /api/player/join-game
app.post('/api/player/join-game', (req, res) => {
    console.log(`--- SERVER HIT: POST /api/player/join-game ---`);
    console.log("Request Origin:", req.get('origin')); // Log the origin for debugging CORS
    console.log("Request Body:", req.body);

    const { playerName, roomId, playerId: existingPlayerId } = req.body;

    if (!playerName || !roomId) {
        console.error("/api/player/join-game: Missing playerName or roomId");
        return res.status(400).json({ message: "Player name and Room ID are required." });
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


// GET /api/player/state 
app.get('/api/player/state', (req, res) => {
    const { playerId, roomId } = req.query;
    console.log(`--- SERVER HIT: GET /api/player/state --- Origin: ${req.get('origin')}, Query:`, req.query);
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

// GET /api/admin/state
app.get('/api/admin/state', (req, res) => {
    const adminViewingRoomId = req.query.roomId; 
    console.log(`--- SERVER HIT: GET /api/admin/state --- Origin: ${req.get('origin')}, Query:`, req.query);
    let roomToReport = null;

    if (adminViewingRoomId && gameState.activeRooms.has(adminViewingRoomId)) {
        roomToReport = getRoomState(adminViewingRoomId);
    } else if (gameState.activeRooms.size > 0 && !adminViewingRoomId) {
        if (gameState.activeRooms.size === 1) {
             roomToReport = gameState.activeRooms.values().next().value;
        } else {
             return res.json({ 
                message: "Please connect to a specific room in the admin panel to see its state.", 
                gameStarted: false, drawnNumbers: [], players: [], ticketRequests: [], claims: [], winners: {},
                availableRooms: Array.from(gameState.activeRooms.keys()) 
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
        (p.claims || []).forEach(c => { 
            if (c.status === 'pending') { 
                aggregatedClaims.push({ 
                    claimId: c.claimId, 
                    prizeType: c.prizeType,
                    ticketId: c.ticketId, 
                    playerId: p.id, 
                    playerName: p.name 
                });
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
        ticketRequests: roomToReport.ticketRequests.filter(req => !req.approved && req.roomId === roomToReport.roomId), // Filter by room
        claims: aggregatedClaims, 
    });
});


// POST /api/admin/start-game
app.post('/api/admin/start-game', (req, res) => {
    console.log(`--- SERVER HIT: POST /api/admin/start-game --- Origin: ${req.get('origin')}, Body:`, req.body);
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
    console.log(`--- SERVER HIT: POST /api/admin/draw-number --- Origin: ${req.get('origin')}, Body:`, req.body);
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

// POST /api/admin/stop-game
app.post('/api/admin/stop-game', (req, res) => {
    console.log(`--- SERVER HIT: POST /api/admin/stop-game --- Origin: ${req.get('origin')}, Body:`, req.body);
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

// POST /api/admin/reset-game
app.post('/api/admin/reset-game', (req, res) => {
    console.log(`--- SERVER HIT: POST /api/admin/reset-game --- Origin: ${req.get('origin')}`);
    fullResetServerState(); 
    console.log("Full game server state reset by admin.");
    res.json({ message: "Tambola server has been completely reset." });
});


// POST /api/player/request-ticket
app.post('/api/player/request-ticket', (req, res) => {
    console.log(`--- SERVER HIT: POST /api/player/request-ticket --- Origin: ${req.get('origin')}, Body:`, req.body);
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
        playerName: player.name, 
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
    console.log(`--- SERVER HIT: POST /api/admin/approve-ticket --- Origin: ${req.get('origin')}, Body:`, req.body);
    const { requestId, roomId } = req.body; 
    if (!roomId) return res.status(400).json({message: "Room ID is required to approve a ticket."});
    
    const room = getRoomState(roomId);
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


// POST /api/player/claim-prize
app.post('/api/player/claim-prize', (req, res) => {
    console.log(`--- SERVER HIT: POST /api/player/claim-prize --- Origin: ${req.get('origin')}, Body:`, req.body);
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

    // --- Server-Side Validation ---
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
    } else if (prizeType === 'firstLine') {
        const lineNumbers = ticket.rows[0].filter(n => n !== null);
        if (lineNumbers.every(n => claimedNumbersSet.has(n)) && claimedNumbersSet.size >= lineNumbers.length) { 
             prizeConditionMet = true;
        }
    } else if (prizeType === 'secondLine') {
         const lineNumbers = ticket.rows[1].filter(n => n !== null);
        if (lineNumbers.every(n => claimedNumbersSet.has(n)) && claimedNumbersSet.size >= lineNumbers.length) {
             prizeConditionMet = true;
        }
    } else if (prizeType === 'thirdLine') {
         const lineNumbers = ticket.rows[2].filter(n => n !== null);
        if (lineNumbers.every(n => claimedNumbersSet.has(n)) && claimedNumbersSet.size >= lineNumbers.length) {
             prizeConditionMet = true;
        }
    } else if (prizeType === 'earlyFive') {
        if (claimedNumbersSet.size >= 5) {
             prizeConditionMet = true; 
        }
    } else if (prizeType === 'corners') {
        const r0 = ticket.rows[0];
        const r2 = ticket.rows[2];
        const corners = [
            r0.find(n => n !== null), 
            r0.slice().reverse().find(n => n !== null), 
            r2.find(n => n !== null), 
            r2.slice().reverse().find(n => n !== null) 
        ].filter(n => n !== null && n !== undefined); 
        const uniqueCorners = [...new Set(corners)];
        if (uniqueCorners.length === 4 && uniqueCorners.every(n => claimedNumbersSet.has(n))) {
            prizeConditionMet = true;
        }
    }

    if (!prizeConditionMet) {
         return res.status(400).json({ message: `Claim conditions for ${prizeType} not met based on marked numbers.` });
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

// POST /api/admin/process-claim
app.post('/api/admin/process-claim', (req, res) => {
    console.log(`--- SERVER HIT: POST /api/admin/process-claim --- Origin: ${req.get('origin')}, Body:`, req.body);
    const { claimId, action, roomId } = req.body; 
    
    if (!roomId) return res.status(400).json({message: "Room ID is required to process a claim."});
    const room = getRoomState(roomId);

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


// --- Server Listen ---
app.listen(PORT, '0.0.0.0', () => { 
    console.log(`Tambola server running on port ${PORT}`);
    console.log(`Accepting requests from origins: ${allowedOrigins.join(', ')}`);
});
