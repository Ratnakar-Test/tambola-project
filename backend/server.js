// backend/server.js
// Main Express server for the Tambola game backend.

const express = require('express');
const path = require('path');
const cors = require('cors');
const ticketStore = require('./ticketStore.js'); // Assuming ticketStore.js is in the same directory

const app = express();
const PORT = process.env.PORT || 3000; // Render will set the PORT environment variable

// --- CORS Configuration ---
// Define the origins allowed to access this backend
const allowedOrigins = [
    'https://mytambola.netlify.app',    // Your Netlify frontend URL
    'http://localhost:3000',           // For local frontend testing if served by this backend
    'http://127.0.0.1:5500',          // For VS Code Live Server local development
    // Add any other specific origins if needed, e.g., Netlify deploy preview URLs if you know them
    // Or, for more dynamic preview URLs, you might need a more complex origin function or regex.
];

const corsOptions = {
    origin: function (origin, callback) {
        // Allow requests with no origin (like mobile apps, curl, Postman) or from whitelisted origins
        if (!origin || allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            console.warn(`CORS Error: Origin ${origin} not allowed.`);
            callback(new Error(`Origin ${origin} not allowed by CORS`));
        }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], // Specify allowed methods
    allowedHeaders: ['Content-Type', 'Authorization'], // Specify allowed headers
    credentials: true, // If you need to handle cookies or authorization headers
    optionsSuccessStatus: 200 // For compatibility with older browsers
};

app.use(cors(corsOptions)); // Enable CORS with the specified options
app.use(express.json());     // Middleware to parse JSON request bodies

// --- In-Memory Game State Storage ---
// This will hold the state for all active game rooms.
// For a production app, this would ideally be a database.
const activeRooms = new Map(); // Key: roomId, Value: roomSpecificGameState

/**
 * Retrieves or initializes the state for a given room.
 * @param {string} roomId - The ID of the room.
 * @returns {object} The state object for the room.
 */
function getRoomState(roomId) {
    if (!activeRooms.has(roomId)) {
        // Initialize a new room if it doesn't exist
        activeRooms.set(roomId, {
            roomId: roomId,
            gameStarted: false,
            gameOver: false,
            currentNumber: null,
            drawnNumbers: [], // Array of numbers that have been called
            allPossibleNumbers: Array.from({ length: 90 }, (_, i) => i + 1), // Numbers 1-90
            availableNumbers: [...Array.from({ length: 90 }, (_, i) => i + 1)], // Numbers yet to be called
            gameMode: 'manual', // 'manual' or 'auto'
            gameConfig: { // Rules and settings defined by the admin for this room
                rules: { // Example: fullHouse: { enabled: true, maxWinners: 1 }
                    // This will be populated when the admin starts the game
                },
            },
            winners: {}, // Stores approved winners for each prize type for this room
                         // e.g., { fullHouse: [{ playerId, ticketId, playerName }], firstLine: [...] }
            players: new Map(), // Key: playerId, Value: { id, name, tickets: [ticketId1, ...], claims: [claimObj1, ...] }
            ticketRequests: [], // Array of pending ticket requests for this room
                                // e.g., { requestId, playerId, playerName, roomId, timestamp, approved: false }
        });
        console.log(`Initialized new room state for: ${roomId}`);
    }
    return activeRooms.get(roomId);
}

/**
 * Resets the game-specific state for a given room, keeping players and their tickets.
 * @param {string} roomId - The ID of the room to reset.
 */
function resetRoomForNewGame(roomId) {
    if (activeRooms.has(roomId)) {
        const room = activeRooms.get(roomId);
        room.gameStarted = false;
        room.gameOver = false;
        room.currentNumber = null;
        room.drawnNumbers = [];
        room.availableNumbers = [...room.allPossibleNumbers];
        // gameMode and gameConfig.rules are typically set when a new game starts.
        room.winners = {}; // Clear previous winners
        // Reset claims for all players in this room
        room.players.forEach(player => {
            player.claims = []; 
        });
        // Optionally clear pending ticket requests for this room, or handle them as needed
        // room.ticketRequests = room.ticketRequests.filter(req => req.roomId !== roomId || req.approved);
        console.log(`Game state soft-reset for a new round in room: ${roomId}`);
    } else {
        console.warn(`Attempted to reset non-existent room: ${roomId} for a new game.`);
    }
}

/**
 * Resets the entire server state, clearing all rooms and tickets.
 */
function fullServerReset() { 
    console.log("!!! Resetting ENTIRE SERVER: Clearing all rooms and ticket store !!!");
    activeRooms.clear();
    ticketStore.clearAllTickets(); // Ensure ticketStore has this function
}

/**
 * Generates a unique ID.
 * @returns {string} A unique ID string.
 */
function generateId() {
    return Math.random().toString(36).substring(2, 12) + Date.now().toString(36);
}


// --- Static File Serving (for local testing convenience) ---
// This allows serving frontend files if backend is run locally and accessed directly.
// On Render/Netlify setup, Netlify serves the frontend.
app.use(express.static(path.join(__dirname, '../frontend')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/admin.html'));
});


// --- API Endpoints ---

/**
 * Player joins a game room.
 * Registers the player to the room or updates their presence.
 * Returns initial game state relevant to the player.
 */
app.post('/api/player/join-game', (req, res) => {
    console.log(`[API] POST /api/player/join-game | Origin: ${req.get('origin')}`);
    console.log("Request Body:", req.body);

    const { playerName, roomId, playerId: existingPlayerId } = req.body;

    if (!playerName || !playerName.trim() || !roomId || !roomId.trim()) {
        console.error("Join Game Error: Player name and Room ID are mandatory.");
        return res.status(400).json({ message: "Player name and Room ID are mandatory." });
    }

    const room = getRoomState(roomId); // Ensures room object exists

    let playerId = existingPlayerId;
    let player = existingPlayerId ? room.players.get(existingPlayerId) : null;

    if (player) { // Player is rejoining or already exists
        player.name = playerName; // Allow name update on rejoin
        console.log(`Player ${playerName} (ID: ${playerId}) re-connected to room ${roomId}.`);
    } else { // New player for this room session
        playerId = generateId(); // Generate a new ID for the player
        player = {
            id: playerId,
            name: playerName,
            tickets: [], // Array of ticket IDs assigned to this player
            claims: []   // Array of claim objects submitted by this player
        };
        room.players.set(playerId, player);
        console.log(`New player ${playerName} (ID: ${playerId}) joined room ${roomId}.`);
    }
    
    // Prepare the game state to send to the player
    const playerSpecificState = {
        roomId: room.roomId,
        drawnNumbers: room.drawnNumbers,
        currentNumber: room.currentNumber,
        gameStarted: room.gameStarted,
        gameOver: room.gameOver,
        winningRules: room.gameConfig.rules, // Active winning rules for the game
        winners: room.winners,               // Current list of winners for all prizes
        playerTickets: player.tickets.map(ticketId => ticketStore.getTicketById(ticketId)).filter(t => t), // Full ticket objects
        myClaims: player.claims,             // Player's own claim history
        playerId: player.id,                 // Confirmed Player ID
        playerName: player.name              // Confirmed Player Name
    };

    res.json({ 
        message: `Successfully joined room ${roomId} as ${playerName}.`,
        playerId: player.id,
        gameState: playerSpecificState
    });
});

/**
 * Player requests the current game state.
 */
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

/**
 * Admin requests the current state of a specific game room.
 */
app.get('/api/admin/state', (req, res) => {
    const adminViewingRoomId = req.query.roomId; 
    // console.log(`[API] GET /api/admin/state | Origin: ${req.get('origin')}, Query:`, req.query);
    
    if (!adminViewingRoomId) {
        return res.status(400).json({ 
            message: "Room ID is required to fetch admin state.",
            availableRooms: Array.from(activeRooms.keys()) // Optionally inform about available rooms
        });
    }
    
    const room = activeRooms.get(adminViewingRoomId);
    if (!room) {
        return res.status(404).json({ 
            message: `Room '${adminViewingRoomId}' not found.`,
            availableRooms: Array.from(activeRooms.keys())
        });
    }
    
    // Aggregate pending claims from all players in this room for admin view
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


/**
 * Admin starts a new game in a specific room.
 */
app.post('/api/admin/start-game', (req, res) => {
    console.log(`[API] POST /api/admin/start-game | Origin: ${req.get('origin')}, Body:`, req.body);
    const { roomId, rules, mode } = req.body;

    if (!roomId) return res.status(400).json({ message: "Room ID is required to start a game." });
    
    const room = getRoomState(roomId); // Ensures room object exists

    if (room.gameStarted && !room.gameOver) {
        return res.status(400).json({ message: "Game already in progress in this room. Stop or reset first." });
    }
    
    resetRoomForNewGame(roomId); // Soft reset: clears game data, keeps players for new round

    room.gameStarted = true;
    room.gameOver = false; // Ensure game over is false
    room.gameMode = mode || 'manual';
    room.gameConfig.rules = rules || {}; // Set the rules for this specific game instance

    console.log(`Game started by admin. Room: ${room.roomId}, Mode: ${room.gameMode}, Rules:`, room.gameConfig.rules);
    res.json({ message: "Game started successfully.", roomId: room.roomId, gameStarted: room.gameStarted });
});

/**
 * Admin draws the next number for a specific room.
 */
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
        room.currentNumber = null; // No more numbers
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

/**
 * Admin stops the current game in a specific room.
 */
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

/**
 * Admin resets the ENTIRE server state (all rooms, all tickets).
 */
app.post('/api/admin/reset-game', (req, res) => {
    console.log(`[API] POST /api/admin/reset-game | Origin: ${req.get('origin')}`);
    fullServerReset(); 
    console.log("Full game server state reset by admin.");
    res.json({ message: "Tambola server has been completely reset." });
});


/**
 * Player requests a new ticket for a specific room.
 */
app.post('/api/player/request-ticket', (req, res) => {
    console.log(`[API] POST /api/player/request-ticket | Origin: ${req.get('origin')}, Body:`, req.body);
    const { playerId, playerName, roomId } = req.body; 

    if (!playerId || !roomId || !playerName) {
        return res.status(400).json({ message: "Player ID, Player Name, and Room ID are required." });
    }

    const room = getRoomState(roomId); // Ensures room exists
    const player = room.players.get(playerId);

    if (!player) {
        // This should ideally not happen if player has already joined the room.
        return res.status(404).json({ message: "Player not found in this room. Please rejoin first." });
    }
    
    const existingTicketCount = player.tickets.length;
    // Count pending requests for this player in *this* room
    const pendingRequestsForPlayerInRoom = room.ticketRequests.filter(r => r.playerId === playerId && r.roomId === roomId && !r.approved).length;

    if (existingTicketCount + pendingRequestsForPlayerInRoom >= 5) {
        return res.status(400).json({ message: `Ticket limit (5) reached or pending. You have ${existingTicketCount} tickets and ${pendingRequestsForPlayerInRoom} pending requests for this room.` });
    }

    const newRequest = {
        requestId: generateId(),
        playerId: playerId,
        playerName: player.name, // Use name from player object for consistency
        roomId: roomId, // Store roomId with the request
        timestamp: Date.now(),
        approved: false
    };
    room.ticketRequests.push(newRequest); 
    console.log(`Ticket request from ${player.name} (ID: ${playerId}) for room ${roomId}. Request ID: ${newRequest.requestId}`);
    res.status(201).json({ message: "Ticket requested successfully. Waiting for admin approval.", requestId: newRequest.requestId });
});

/**
 * Admin approves a pending ticket request for a specific room.
 */
app.post('/api/admin/approve-ticket', (req, res) => {
    console.log(`[API] POST /api/admin/approve-ticket | Origin: ${req.get('origin')}, Body:`, req.body);
    const { requestId, roomId } = req.body; 

    if (!roomId) return res.status(400).json({message: "Room ID is required to approve a ticket."});
    const room = activeRooms.get(roomId);
    if (!room) return res.status(404).json({message: `Room '${roomId}' not found.`});
    
    // Find the request within the specific room's list
    const requestIndex = room.ticketRequests.findIndex(r => r.requestId === requestId && r.roomId === roomId && !r.approved);

    if (requestIndex === -1) {
        return res.status(404).json({ message: "Ticket request not found or already processed in this room." });
    }
    const request = room.ticketRequests[requestIndex];
    const player = room.players.get(request.playerId);

    if (!player) { 
        request.approved = false; // Should not happen, but safeguard
        return res.status(404).json({ message: "Player associated with request not found." });
    }
    if (player.tickets.length >= 5) {
         return res.status(400).json({ message: `Player ${player.name} already has the maximum of 5 tickets.` });
    }

    try {
        const newTicket = ticketStore.getNewTicket();
        if (!newTicket || newTicket.id === "ERROR_TICKET") { // Check for error ticket from store
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


/**
 * Player submits a prize claim for a specific room.
 */
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
    const claimedNumbersSet = new Set(playerNumbers.map(n => parseInt(n))); 

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
    // This is a simplified validation. More complex prize rules might need more detailed checks.
    if (prizeType === 'fullHouse') {
        if (ticket.numbers.every(n => claimedNumbersSet.has(n)) && claimedNumbersSet.size === ticket.numbers.length) {
            prizeConditionMet = true;
        }
    } else if (prizeType.includes('Line')) { // Covers firstLine, secondLine, thirdLine
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
        if (claimedNumbersSet.size >= 5) { // Basic check: player has at least 5 claimed numbers
             prizeConditionMet = true; 
        }
    } else if (prizeType === 'corners') {
        const r0 = ticket.rows[0];
        const r2 = ticket.rows[2];
        if (r0 && r2) { // Ensure rows exist
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

/**
 * Admin processes a pending prize claim (accepts or rejects).
 */
app.post('/api/admin/process-claim', (req, res) => {
    console.log(`[API] POST /api/admin/process-claim | Origin: ${req.get('origin')}, Body:`, req.body);
    const { claimId, action, roomId } = req.body; 
    
    if (!roomId) return res.status(400).json({message: "Room ID is required to process a claim."});
    const room = activeRooms.get(roomId);
    if (!room) return res.status(404).json({message: `Room '${roomId}' not found.`});

    let claimToProcess = null;
    let playerOfClaim = null;

    // Find the claim within the specific room's players
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
