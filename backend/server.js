// server.js
// Tambola Game Backend
// Uses Express for basic HTTP and 'ws' for WebSockets

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors'); // For handling Cross-Origin Resource Sharing

const PORT = process.env.PORT || 3000; // Port for Render or local development

const app = express();
app.use(cors()); // Enable CORS for all routes
app.use(express.json()); // Middleware to parse JSON bodies

// In-memory storage
let rooms = {};
// playerConnections: ws -> { roomId, playerId, type: 'admin'/'player', ws }
let playerConnections = new Map();

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

console.log(`Tambola backend server starting on port ${PORT}...`);

// --- Helper Functions ---

function generateUniqueId() {
    return Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
}

function generateTambolaTicket() {
    let ticket = Array(3).fill(null).map(() => Array(9).fill(null));
    const numbersOnTicket = new Set();
    const colRanges = [
        { min: 1, max: 9 }, { min: 10, max: 19 }, { min: 20, max: 29 },
        { min: 30, max: 39 }, { min: 40, max: 49 }, { min: 50, max: 59 },
        { min: 60, max: 69 }, { min: 70, max: 79 }, { min: 80, max: 90 }
    ];

    let colNumberCounts = Array(9).fill(0);
    let rowNumberCounts = Array(3).fill(0);

    // Try to place 15 numbers
    let placedCount = 0;
    let attemptsToPlaceAll = 0;

    while (placedCount < 15 && attemptsToPlaceAll < 1000) {
        attemptsToPlaceAll++;
        let r = Math.floor(Math.random() * 3);
        let c = Math.floor(Math.random() * 9);

        if (ticket[r][c] === null && rowNumberCounts[r] < 5 && colNumberCounts[c] < 3) {
            // Ensure column has numbers (e.g. no more than 2 empty cells in a col with 1 number, 1 with 2)
            let numbersInCol = 0;
            for(let i=0; i<3; i++) if(ticket[i][c] !== null) numbersInCol++;
            if(numbersInCol >= colRanges[c].max - colRanges[c].min + 1) continue; // Column full for range

            let num;
            let attemptsToFindNum = 0;
            do {
                num = Math.floor(Math.random() * (colRanges[c].max - colRanges[c].min + 1)) + colRanges[c].min;
                attemptsToFindNum++;
            } while (numbersOnTicket.has(num) && attemptsToFindNum < 20);

            if (!numbersOnTicket.has(num)) {
                ticket[r][c] = num;
                numbersOnTicket.add(num);
                rowNumberCounts[r]++;
                colNumberCounts[c]++;
                placedCount++;
            }
        }
    }

    // If not 15 numbers, try to fill remaining, respecting constraints
    if (placedCount < 15) {
        for (let r_fill = 0; r_fill < 3; r_fill++) {
            while (rowNumberCounts[r_fill] < 5 && placedCount < 15) {
                let filledThisIteration = false;
                // Find an empty column slot for this row
                let availableCols = [];
                for (let c_fill = 0; c_fill < 9; c_fill++) {
                    if (ticket[r_fill][c_fill] === null && colNumberCounts[c_fill] < 3) {
                        availableCols.push(c_fill);
                    }
                }
                if (availableCols.length === 0) break; // No place in this row

                let c_fill_choice = availableCols[Math.floor(Math.random() * availableCols.length)];
                let num;
                let attemptsToFindNum = 0;
                do {
                    num = Math.floor(Math.random() * (colRanges[c_fill_choice].max - colRanges[c_fill_choice].min + 1)) + colRanges[c_fill_choice].min;
                    attemptsToFindNum++;
                } while (numbersOnTicket.has(num) && attemptsToFindNum < 20);

                if (!numbersOnTicket.has(num)) {
                    ticket[r_fill][c_fill_choice] = num;
                    numbersOnTicket.add(num);
                    rowNumberCounts[r_fill]++;
                    colNumberCounts[c_fill_choice]++;
                    placedCount++;
                    filledThisIteration = true;
                }
                if (!filledThisIteration && attemptsToPlaceAll > 100) break; // Safety break
            }
        }
    }


    // Sort numbers within each column
    for (let c = 0; c < 9; c++) {
        let colVals = [];
        for (let r_sort = 0; r_sort < 3; r_sort++) {
            if (ticket[r_sort][c] !== null) {
                colVals.push(ticket[r_sort][c]);
            }
        }
        colVals.sort((a, b) => a - b);
        let currentIdx = 0;
        for (let r_sort = 0; r_sort < 3; r_sort++) {
            if (ticket[r_sort][c] !== null) {
                ticket[r_sort][c] = colVals[currentIdx++];
            }
        }
    }
    // console.log("Generated ticket with numbers: ", numbersOnTicket.size, JSON.stringify(ticket));
    return ticket;
}


function broadcastToRoom(roomId, message, excludeWs = null) {
    const room = rooms[roomId];
    if (room) {
        const recipients = [];
        // Add admin if connected
        if (room.admin && room.admin.ws && room.admin.ws.readyState === WebSocket.OPEN) {
            recipients.push(room.admin.ws);
        }
        // Add players if connected
        room.players.forEach(player => {
            if (player.ws && player.ws.readyState === WebSocket.OPEN) {
                recipients.push(player.ws);
            }
        });

        recipients.forEach(clientWs => {
            if (clientWs !== excludeWs) { // Check if clientWs is not the one to exclude
                try {
                    clientWs.send(JSON.stringify(message));
                } catch (e) {
                    console.error('Broadcast error to client:', e);
                    // Optionally remove problematic client from connections if error persists
                }
            }
        });
    }
}


function sendMessageToClient(ws, message) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        try {
            ws.send(JSON.stringify(message));
        } catch (e) {
            console.error('Send message error:', e);
        }
    }
}

// --- Prize Validation Helper Functions --- (Copied from original, assuming they are okay)
function getAllNumbersOnTicket(ticketNumbers) {
    return ticketNumbers.flat().filter(num => num !== null);
}
function getNumbersInRow(ticketNumbers, rowIndex) {
    if (rowIndex < 0 || rowIndex >= ticketNumbers.length) return [];
    return ticketNumbers[rowIndex].filter(num => num !== null);
}
function allNumbersAreCalled(numbersToCheck, calledNumbers) {
    if (!numbersToCheck || numbersToCheck.length === 0) return false;
    return numbersToCheck.every(num => calledNumbers.includes(num));
}
function validatePrizeClaim(ticketNumbers, calledNumbers, prizeRuleName) {
    const allTicketNums = getAllNumbersOnTicket(ticketNumbers);
    if (allTicketNums.length === 0 && prizeRuleName !== 'Unlucky 1') return false; // Most prizes need numbers

    switch (prizeRuleName) {
        case 'Top Line':
            return allNumbersAreCalled(getNumbersInRow(ticketNumbers, 0), calledNumbers);
        case 'Middle Line':
            return allNumbersAreCalled(getNumbersInRow(ticketNumbers, 1), calledNumbers);
        case 'Bottom Line':
            return allNumbersAreCalled(getNumbersInRow(ticketNumbers, 2), calledNumbers);
        case 'Full House':
            // A standard Tambola ticket aims for 15 numbers.
            // If ticket generation is imperfect, check if all *present* numbers are called.
            return allTicketNums.length > 0 && allNumbersAreCalled(allTicketNums, calledNumbers);
        case 'Early 5': {
            const markedCount = allTicketNums.filter(num => calledNumbers.includes(num)).length;
            return markedCount >= 5;
        }
        case 'Early 7': {
            const markedCount = allTicketNums.filter(num => calledNumbers.includes(num)).length;
            return markedCount >= 7;
        }
        case 'Corners': {
            const topRowActual = getNumbersInRow(ticketNumbers, 0);
            const bottomRowActual = getNumbersInRow(ticketNumbers, 2);
            if (topRowActual.length === 0 || bottomRowActual.length === 0) return false;

            const cornerNumbers = [];
            if (topRowActual.length > 0) cornerNumbers.push(topRowActual[0]);
            if (topRowActual.length > 1) cornerNumbers.push(topRowActual[topRowActual.length -1]); // Last actual number
            if (bottomRowActual.length > 0) cornerNumbers.push(bottomRowActual[0]);
            if (bottomRowActual.length > 1) cornerNumbers.push(bottomRowActual[bottomRowActual.length-1]); // Last actual number
            
            const uniqueCornerNumbers = [...new Set(cornerNumbers)]; // Ensure unique numbers if e.g. only one number in row
            return uniqueCornerNumbers.length >= 2 && allNumbersAreCalled(uniqueCornerNumbers, calledNumbers); // Need at least 2 distinct corners
        }
        case '1-2-3': {
            const r0_actual = getNumbersInRow(ticketNumbers, 0);
            const r1_actual = getNumbersInRow(ticketNumbers, 1);
            const r2_actual = getNumbersInRow(ticketNumbers, 2);
            if (r0_actual.length < 1 || r1_actual.length < 2 || r2_actual.length < 3) return false;
            const numbersFor123 = [
                r0_actual[0], r1_actual[0], r1_actual[1],
                r2_actual[0], r2_actual[1], r2_actual[2]
            ];
            return allNumbersAreCalled(numbersFor123, calledNumbers);
        }
        case 'BP (Bull\'s Eye)': {
            if (allTicketNums.length < 2) return false; // Need at least two numbers to have a min and max
            const minNum = Math.min(...allTicketNums);
            const maxNum = Math.max(...allTicketNums);
            return calledNumbers.includes(minNum) && calledNumbers.includes(maxNum);
        }
        case 'Breakfast': {
            const breakfastNumsOnTicket = allTicketNums.filter(num => num >= 1 && num <= 30);
            if (breakfastNumsOnTicket.length === 0) return false;
            return allNumbersAreCalled(breakfastNumsOnTicket, calledNumbers);
        }
        case 'Dinner': {
            const dinnerNumsOnTicket = allTicketNums.filter(num => num >= 61 && num <= 90);
            if (dinnerNumsOnTicket.length === 0) return false;
            return allNumbersAreCalled(dinnerNumsOnTicket, calledNumbers);
        }
        case 'Fat Ladies': {
            const fatLadyNumbersOnTicket = allTicketNums.filter(num => num.toString().includes('8'));
            if (fatLadyNumbersOnTicket.length === 0) return false;
            return allNumbersAreCalled(fatLadyNumbersOnTicket, calledNumbers);
        }
        case 'Unlucky 1':
            console.warn(`Prize validation for "Unlucky 1" is complex and typically game-event based; not fully implemented here.`);
            return false; // Requires tracking more game state than just called numbers.
        default:
            console.warn(`Unknown prize rule name for validation: ${prizeRuleName}`);
            return false;
    }
}

// --- WebSocket Connection Handling ---
wss.on('connection', (ws) => {
    console.log('Client connected');
    // ws.id = generateUniqueId(); // Assign a unique ID to the WebSocket connection itself for easier tracking if needed

    ws.on('message', (messageString) => {
        let message;
        try {
            message = JSON.parse(messageString);
            // console.log(`Received from client ${ws.id}:`, message);
            console.log(`Received from client:`, message);
        } catch (e) {
            console.error('Failed to parse message:', messageString, e);
            sendMessageToClient(ws, { type: 'ERROR', payload: { message: 'Invalid message format.' } });
            return;
        }

        const { type, payload } = message;
        let connectionInfo = playerConnections.get(ws); // Get existing info

        switch (type) {
            case 'ADMIN_CREATE_JOIN_ROOM': {
                const { adminName, roomId } = payload;
                if (!adminName || !roomId) {
                    return sendMessageToClient(ws, { type: 'ERROR', payload: { message: 'Admin name and Room ID are required.' } });
                }

                let adminId;
                if (rooms[roomId]) { // Room exists
                    if (rooms[roomId].admin.name === adminName) { // Admin rejoining
                        adminId = rooms[roomId].admin.id;
                        rooms[roomId].admin.ws = ws; // Update WebSocket
                        console.log(`Admin ${adminName} (ID: ${adminId}) reconnected to room ${roomId}`);
                    } else if (!rooms[roomId].admin.id || !rooms[roomId].admin.ws || rooms[roomId].admin.ws.readyState !== WebSocket.OPEN) {
                        // Room exists, but admin is different or disconnected, allow new admin to take over if old one is gone
                        console.warn(`Room ${roomId} existed. Previous admin ${rooms[roomId].admin.name}. New admin ${adminName} taking over.`);
                        adminId = generateUniqueId();
                        rooms[roomId].admin = { id: adminId, name: adminName, ws: ws };
                    } else {
                        return sendMessageToClient(ws, { type: 'ERROR', payload: { message: `Room ${roomId} already exists with a different active admin (${rooms[roomId].admin.name}).` } });
                    }
                } else { // New room
                    adminId = generateUniqueId();
                    rooms[roomId] = {
                        id: roomId,
                        admin: { id: adminId, name: adminName, ws: ws },
                        players: [],
                        numbersCalled: [],
                        availableNumbers: Array.from({ length: 90 }, (_, i) => i + 1),
                        gameStatus: 'idle', // 'idle', 'running', 'paused', 'stopped'
                        rules: [],
                        totalMoneyCollected: 0,
                        callingMode: 'manual',
                        autoCallInterval: 5, // seconds
                        createdAt: new Date().toISOString(),
                        winners: [],
                        autoCallTimerId: null, // For server-side auto-call
                    };
                    console.log(`Admin ${adminName} (ID: ${adminId}) created and connected to room ${roomId}`);
                }
                playerConnections.set(ws, { roomId, playerId: adminId, type: 'admin', ws });

                const roomDetailsPayload = {
                    roomId,
                    role: 'admin',
                    adminId,
                    adminName: rooms[roomId].admin.name,
                    gameStatus: rooms[roomId].gameStatus,
                    players: rooms[roomId].players.map(p => ({ id: p.id, name: p.name, ticketCount: p.tickets.length })),
                    rules: rooms[roomId].rules, // Send current rules
                    totalMoneyCollected: rooms[roomId].totalMoneyCollected,
                    calledNumbers: rooms[roomId].numbersCalled,
                    // any other relevant details for admin rejoining
                };
                sendMessageToClient(ws, { type: 'ROOM_JOINED_SUCCESS', payload: roomDetailsPayload });
                broadcastToRoom(roomId, { type: 'ADMIN_STATUS_UPDATE', payload: { adminName: rooms[roomId].admin.name, isConnected: true } }, ws);
                break;
            }

            case 'PLAYER_JOIN_ROOM': {
                const { playerName, roomId } = payload;
                if (!playerName || !roomId) {
                    return sendMessageToClient(ws, { type: 'ERROR', payload: { message: 'Player name and Room ID are required.' } });
                }
                const room = rooms[roomId];
                if (!room || !room.admin) {
                    return sendMessageToClient(ws, { type: 'ERROR', payload: { message: 'Room not found or not ready.' } });
                }
                if (room.players.find(p => p.name === playerName && p.ws && p.ws.readyState === WebSocket.OPEN)) {
                    // Optional: Allow rejoin or handle as error
                     console.log(`Player ${playerName} attempting to rejoin room ${roomId}.`);
                     // For simplicity, let's update their WS. A more robust system might prevent duplicate active sessions.
                     const existingPlayer = room.players.find(p => p.name === playerName);
                     if(existingPlayer){
                        existingPlayer.ws = ws;
                        playerConnections.set(ws, { roomId, playerId: existingPlayer.id, type: 'player', ws });
                        sendMessageToClient(ws, {type: 'INFO', payload: { message: 'Rejoined successfully.'}});
                        // Send them current game state
                         sendMessageToClient(ws, {
                            type: 'PLAYER_JOIN_SUCCESS', // Resend join success to resync client
                            payload: {
                                playerId: existingPlayer.id,
                                playerName: existingPlayer.name,
                                roomId,
                                tickets: existingPlayer.tickets,
                                gameStatus: room.gameStatus,
                                calledNumbers: room.numbersCalled,
                                rules: room.rules.filter(r => r.isActive),
                                totalMoneyCollected: room.totalMoneyCollected,
                                adminName: room.admin.name,
                                playersInRoom: room.players.map(p => ({ id: p.id, name: p.name, ticketCount: p.tickets.length }))
                            }
                        });
                        return;
                     }
                }

                if (room.gameStatus === 'stopped') {
                    return sendMessageToClient(ws, { type: 'ERROR', payload: { message: 'Game has already ended in this room.' } });
                }

                const playerId = generateUniqueId();
                const initialTicketNumbers = generateTambolaTicket(); // Server generates the first ticket
                const player = {
                    id: playerId,
                    name: playerName,
                    ws,
                    tickets: [{ id: generateUniqueId(), numbers: initialTicketNumbers, marked: [] }], // Auto 1 ticket
                    coins: 0
                };
                room.players.push(player);
                playerConnections.set(ws, { roomId, playerId, type: 'player', ws });

                sendMessageToClient(ws, {
                    type: 'PLAYER_JOIN_SUCCESS',
                    payload: {
                        playerId,
                        playerName,
                        roomId,
                        tickets: player.tickets,
                        gameStatus: room.gameStatus,
                        calledNumbers: room.numbersCalled,
                        rules: room.rules.filter(r => r.isActive),
                        totalMoneyCollected: room.totalMoneyCollected,
                        adminName: room.admin.name,
                        playersInRoom: room.players.map(p => ({ id: p.id, name: p.name, ticketCount: p.tickets.length }))
                    }
                });
                broadcastToRoom(roomId, { type: 'PLAYER_LIST_UPDATE', payload: { players: room.players.map(p => ({ id: p.id, name: p.name, ticketCount: p.tickets.length })) } }, ws);
                console.log(`Player ${playerName} (ID: ${playerId}) joined room ${roomId}`);
                break;
            }

            // --- Admin Actions ---
            case 'ADMIN_START_GAME': {
                if (!connectionInfo || connectionInfo.type !== 'admin' || !rooms[connectionInfo.roomId] || rooms[connectionInfo.roomId].admin.id !== connectionInfo.playerId) return sendMessageToClient(ws, { type: 'ERROR', payload: { message: 'Unauthorized or room not found.' } });
                const room = rooms[connectionInfo.roomId];

                if (room.gameStatus !== 'idle' && room.gameStatus !== 'stopped') {
                     return sendMessageToClient(ws, {type: 'ERROR', payload: {message: `Game cannot be started. Current status: ${room.gameStatus}`}});
                }

                if (!payload.rulesConfig || payload.rulesConfig.filter(r => r.isActive).length === 0) {
                    return sendMessageToClient(ws, { type: 'ERROR', payload: { message: 'Cannot start game without active rules.' } });
                }
                if (payload.totalMoneyCollected === undefined || parseFloat(payload.totalMoneyCollected) < 0) { // Allow 0 for free games
                    return sendMessageToClient(ws, { type: 'ERROR', payload: { message: 'Invalid total money collected.' } });
                }

                room.gameStatus = 'running';
                room.numbersCalled = [];
                room.availableNumbers = Array.from({ length: 90 }, (_, i) => i + 1);
                room.rules = payload.rulesConfig; // Admin client sends the rules with calculated coinsPerPrize
                room.totalMoneyCollected = parseFloat(payload.totalMoneyCollected);
                room.callingMode = payload.callingMode || 'manual';
                room.autoCallInterval = parseInt(payload.autoCallInterval, 10) || 5;
                room.winners = []; // Reset winners for a new game
                if (room.autoCallTimerId) clearTimeout(room.autoCallTimerId); // Clear any old timer

                broadcastToRoom(connectionInfo.roomId, {
                    type: 'GAME_STARTED',
                    payload: {
                        rules: room.rules.filter(r => r.isActive),
                        callingMode: room.callingMode,
                        autoCallInterval: room.autoCallInterval,
                        totalMoneyCollected: room.totalMoneyCollected,
                        startTime: new Date().toISOString(),
                        adminName: room.admin.name // For player display
                    }
                });
                console.log(`Game started in room ${connectionInfo.roomId} by admin ${room.admin.name}. Mode: ${room.callingMode}`);
                if (room.callingMode === 'auto' && room.gameStatus === 'running') {
                    // Start server-side auto-calling
                    const autoCallFn = () => {
                        if (room.gameStatus === 'running' && room.callingMode === 'auto' && room.availableNumbers.length > 0) {
                            callNextNumberForRoom(connectionInfo.roomId);
                            room.autoCallTimerId = setTimeout(autoCallFn, room.autoCallInterval * 1000);
                        } else {
                            if (room.autoCallTimerId) clearTimeout(room.autoCallTimerId);
                        }
                    };
                    room.autoCallTimerId = setTimeout(autoCallFn, room.autoCallInterval * 1000); // Initial call after interval
                }
                break;
            }

            case 'ADMIN_CALL_NUMBER': { // Only for manual mode
                if (!connectionInfo || connectionInfo.type !== 'admin' || !rooms[connectionInfo.roomId] || rooms[connectionInfo.roomId].admin.id !== connectionInfo.playerId) return;
                const room = rooms[connectionInfo.roomId];
                if (room && room.gameStatus === 'running' && room.callingMode === 'manual') {
                    callNextNumberForRoom(connectionInfo.roomId);
                } else {
                    sendMessageToClient(ws, {type: 'ERROR', payload: {message: 'Cannot call number. Game not running or not in manual mode.'}});
                }
                break;
            }
            
            case 'ADMIN_PAUSE_GAME': {
                if (!connectionInfo || connectionInfo.type !== 'admin' || !rooms[connectionInfo.roomId] || rooms[connectionInfo.roomId].admin.id !== connectionInfo.playerId) return;
                const room = rooms[connectionInfo.roomId];
                if (room && room.gameStatus === 'running' && room.callingMode === 'auto') {
                    if (room.autoCallTimerId) clearTimeout(room.autoCallTimerId);
                    room.gameStatus = 'paused';
                    broadcastToRoom(connectionInfo.roomId, { type: 'GAME_PAUSED', payload: { status: room.gameStatus } });
                    console.log(`Game paused in room ${connectionInfo.roomId}`);
                }
                break;
            }

            case 'ADMIN_RESUME_GAME': {
                if (!connectionInfo || connectionInfo.type !== 'admin' || !rooms[connectionInfo.roomId] || rooms[connectionInfo.roomId].admin.id !== connectionInfo.playerId) return;
                const room = rooms[connectionInfo.roomId];
                if (room && room.gameStatus === 'paused' && room.callingMode === 'auto') {
                    room.gameStatus = 'running';
                    broadcastToRoom(connectionInfo.roomId, { type: 'GAME_RESUMED', payload: { status: room.gameStatus } });
                    console.log(`Game resumed in room ${connectionInfo.roomId}`);
                    // Restart server-side auto-calling
                    const autoCallFn = () => {
                        if (room.gameStatus === 'running' && room.callingMode === 'auto' && room.availableNumbers.length > 0) {
                            callNextNumberForRoom(connectionInfo.roomId);
                            room.autoCallTimerId = setTimeout(autoCallFn, room.autoCallInterval * 1000);
                        } else {
                            if (room.autoCallTimerId) clearTimeout(room.autoCallTimerId);
                        }
                    };
                    autoCallFn(); // Call immediately then set timer
                }
                break;
            }
            
            case 'ADMIN_STOP_GAME': {
                if (!connectionInfo || connectionInfo.type !== 'admin' || !rooms[connectionInfo.roomId] || rooms[connectionInfo.roomId].admin.id !== connectionInfo.playerId) return;
                const room = rooms[connectionInfo.roomId];
                if (room && (room.gameStatus === 'running' || room.gameStatus === 'paused')) {
                    if (room.autoCallTimerId) clearTimeout(room.autoCallTimerId);
                    room.gameStatus = 'stopped';
                    broadcastToRoom(connectionInfo.roomId, { type: 'GAME_STOPPED', payload: { status: room.gameStatus } });
                    console.log(`Game stopped in room ${connectionInfo.roomId}`);
                    // Optionally, prepare and broadcast a game summary
                    const gameSummary = {
                        totalNumbersCalled: room.numbersCalled.length,
                        winners: room.winners,
                        players: room.players.map(p => ({name: p.name, tickets: p.tickets.length, coins: p.coins}))
                    };
                    broadcastToRoom(connectionInfo.roomId, { type: 'GAME_SUMMARY_BROADCAST', payload: gameSummary });
                }
                break;
            }

            case 'ADMIN_UPDATE_RULES': { // This implies rules can be changed mid-game, which might be complex. Usually set before start.
                if (!connectionInfo || connectionInfo.type !== 'admin' || !rooms[connectionInfo.roomId] || rooms[connectionInfo.roomId].admin.id !== connectionInfo.playerId) return;
                const room = rooms[connectionInfo.roomId];
                if (room && payload.rules && payload.financials) {
                    room.rules = payload.rules;
                    room.totalMoneyCollected = parseFloat(payload.financials.totalMoneyCollected);
                    
                    // Broadcast updated rules to players
                    broadcastToRoom(connectionInfo.roomId, { type: 'RULES_UPDATED', payload: { rules: room.rules.filter(r => r.isActive), totalMoneyCollected: room.totalMoneyCollected } }, ws); // Exclude admin who sent it
                    sendMessageToClient(ws, { type: 'RULES_SAVE_CONFIRMED', payload: {message: "Rules and financials updated on server."} });
                    console.log(`Rules updated for room ${connectionInfo.roomId}`);
                }
                break;
            }
            
            case 'ADMIN_APPROVE_TICKET_REQUEST': {
                if (!connectionInfo || connectionInfo.type !== 'admin' || !rooms[connectionInfo.roomId] || rooms[connectionInfo.roomId].admin.id !== connectionInfo.playerId) return;
                const { targetPlayerId } = payload; // Admin client sends targetPlayerId
                const room = rooms[connectionInfo.roomId];
                const player = room?.players.find(p => p.id === targetPlayerId);

                if (room && player) {
                    if (player.tickets.length >= 5) {
                        return sendMessageToClient(ws, { type: 'ADMIN_ACTION_FAIL', payload: { message: `${player.name} already has the maximum of 5 tickets.` } });
                    }
                    const newTicketNumbers = generateTambolaTicket();
                    const newTicket = { id: generateUniqueId(), numbers: newTicketNumbers, marked: [] };
                    player.tickets.push(newTicket);

                    if (player.ws) { // If player is connected
                        sendMessageToClient(player.ws, { type: 'TICKET_APPROVED', payload: { ticket: newTicket, allTickets: player.tickets } });
                    }
                    sendMessageToClient(ws, { type: 'ADMIN_ACTION_SUCCESS', payload: { message: `Ticket approved for ${player.name}. They now have ${player.tickets.length} tickets.` } });
                    broadcastToRoom(connectionInfo.roomId, { type: 'PLAYER_LIST_UPDATE', payload: { players: room.players.map(p => ({id: p.id, name: p.name, ticketCount: p.tickets.length})) } });
                } else {
                    sendMessageToClient(ws, { type: 'ADMIN_ACTION_FAIL', payload: { message: `Player ${targetPlayerId} not found in room ${connectionInfo.roomId}.` } });
                }
                break;
            }

            case 'ADMIN_REJECT_TICKET_REQUEST': {
                if (!connectionInfo || connectionInfo.type !== 'admin' || !rooms[connectionInfo.roomId] || rooms[connectionInfo.roomId].admin.id !== connectionInfo.playerId) return;
                const { targetPlayerId, reason } = payload;
                const room = rooms[connectionInfo.roomId];
                const player = room?.players.find(p => p.id === targetPlayerId);

                if (room && player && player.ws) {
                    sendMessageToClient(player.ws, { type: 'TICKET_REJECTED', payload: { reason: reason || "Admin rejected the ticket request." } });
                }
                sendMessageToClient(ws, { type: 'ADMIN_ACTION_SUCCESS', payload: { message: `Ticket request for ${player ? player.name : targetPlayerId} rejected.` } });
                break;
            }

            case 'ADMIN_APPROVE_PRIZE_CLAIM': {
                if (!connectionInfo || connectionInfo.type !== 'admin' || !rooms[connectionInfo.roomId] || rooms[connectionInfo.roomId].admin.id !== connectionInfo.playerId) return;
                const { claimId, targetPlayerId, prizeName, prizeRuleId } = payload; // Admin client sends these after reviewing
                const room = rooms[connectionInfo.roomId];
                const player = room?.players.find(p => p.id === targetPlayerId);
                const ruleInfo = room?.rules.find(r => r.id === prizeRuleId && r.isActive);

                if (!room || !player || !ruleInfo) {
                    return sendMessageToClient(ws, { type: 'ADMIN_ACTION_FAIL', payload: { message: `Cannot approve claim. Player, room, or rule not found/active.` } });
                }
                 // Check maxPrizes for the rule
                const winnersForThisRule = room.winners.filter(w => w.prizeRuleId === prizeRuleId).length;
                if (winnersForThisRule >= (ruleInfo.maxPrizes || 1)) {
                     return sendMessageToClient(ws, {type: 'ADMIN_ACTION_FAIL', payload: {message: `Max winners already reached for '${prizeName}'.`}});
                }


                const coinsAwarded = parseFloat(ruleInfo.coinsPerPrize) || 0;
                player.coins = parseFloat(((player.coins || 0) + coinsAwarded).toFixed(2));

                // Store winner info
                room.winners.push({
                    claimId, // Use the claimId that was part of the approval request
                    playerId: player.id,
                    playerName: player.name,
                    prizeName, // Use prizeName from payload for consistency
                    prizeRuleId, // Store the rule ID
                    coins: coinsAwarded,
                    timestamp: new Date().toISOString()
                });

                if (player.ws) { // If player is connected
                    sendMessageToClient(player.ws, {
                        type: 'CLAIM_STATUS_UPDATE',
                        payload: { claimId, prizeName, status: 'approved', coinsAwarded, totalCoins: player.coins }
                    });
                }
                // Announce winner to the room
                broadcastToRoom(connectionInfo.roomId, { type: 'WINNER_ANNOUNCEMENT', payload: { playerName: player.name, prizeName, coins: coinsAwarded } });
                sendMessageToClient(ws, { type: 'ADMIN_ACTION_SUCCESS', payload: { message: `Prize '${prizeName}' approved for ${player.name}. Coins: ${coinsAwarded.toFixed(2)}` } });
                break;
            }

            case 'ADMIN_REJECT_PRIZE_CLAIM': {
                if (!connectionInfo || connectionInfo.type !== 'admin' || !rooms[connectionInfo.roomId] || rooms[connectionInfo.roomId].admin.id !== connectionInfo.playerId) return;
                const { claimId, targetPlayerId, prizeName, reason } = payload;
                const room = rooms[connectionInfo.roomId];
                const player = room?.players.find(p => p.id === targetPlayerId);

                if (room && player && player.ws) { // If player is connected
                    sendMessageToClient(player.ws, {
                        type: 'CLAIM_STATUS_UPDATE',
                        payload: { claimId, prizeName, status: 'rejected', reason: reason || "Claim did not meet criteria." }
                    });
                }
                sendMessageToClient(ws, { type: 'ADMIN_ACTION_SUCCESS', payload: { message: `Prize claim for '${prizeName}' by ${player ? player.name : targetPlayerId} rejected.` } });
                break;
            }


            // --- Player Actions ---
            case 'PLAYER_REQUEST_TICKET': {
                if (!connectionInfo || connectionInfo.type !== 'player') return;
                const room = rooms[connectionInfo.roomId];
                const player = room?.players.find(p => p.id === connectionInfo.playerId);

                if (room && player) {
                    if (player.tickets.length >= 5) {
                        return sendMessageToClient(ws, { type: 'ERROR', payload: { message: 'Maximum 5 tickets allowed.' } });
                    }
                    if (room.admin && room.admin.ws && room.admin.ws.readyState === WebSocket.OPEN) {
                        sendMessageToClient(room.admin.ws, {
                            type: 'ADMIN_TICKET_REQUEST_RECEIVED',
                            payload: { playerId: player.id, playerName: player.name, currentTickets: player.tickets.length }
                        });
                        sendMessageToClient(ws, { type: 'PLAYER_TICKET_REQUEST_SENT', payload: {message: "Ticket request sent to admin."} });
                    } else {
                        sendMessageToClient(ws, { type: 'ERROR', payload: { message: 'Admin not available to approve ticket.' } });
                    }
                }
                break;
            }

            case 'PLAYER_CLAIM_PRIZE': {
                if (!connectionInfo || connectionInfo.type !== 'player') return;
                const { prizeRuleId, ticketId } = payload; // Player client sends prizeRuleId and relevant ticketId
                const room = rooms[connectionInfo.roomId];
                const player = room?.players.find(p => p.id === connectionInfo.playerId);
                const ruleToClaim = room?.rules?.find(r => r.id === prizeRuleId && r.isActive);
                const ticketForClaim = player?.tickets.find(t => t.id === ticketId);

                if (!room || !player || !ruleToClaim || !ticketForClaim) {
                    return sendMessageToClient(ws, { type: 'ERROR', payload: { message: 'Invalid claim: Room, player, rule, or ticket not found.' } });
                }
                if (room.gameStatus !== 'running') {
                    return sendMessageToClient(ws, { type: 'ERROR', payload: { message: 'Game is not currently running.' } });
                }

                // Server-side check for maxPrizes limit before forwarding to admin
                const winnersForThisRule = room.winners.filter(w => w.prizeRuleId === prizeRuleId).length;
                if (winnersForThisRule >= (ruleToClaim.maxPrizes || 1)) {
                     return sendMessageToClient(ws, {type: 'ERROR', payload: {message: `Max winners already reached for '${ruleToClaim.name}'.`}});
                }
                 // Prevent duplicate claims if already won this specific rule instance
                const alreadyWonThisRuleByPlayer = room.winners.some(w => w.playerId === player.id && w.prizeRuleId === prizeRuleId);
                if (alreadyWonThisRuleByPlayer) {
                    return sendMessageToClient(ws, {type: 'ERROR', payload: {message: `You have already won or claimed '${ruleToClaim.name}'.`}});
                }


                const isValidClaimByServer = validatePrizeClaim(ticketForClaim.numbers, room.numbersCalled, ruleToClaim.name);
                const claimId = generateUniqueId(); // Server generates the authoritative claimId

                if (room.admin && room.admin.ws && room.admin.ws.readyState === WebSocket.OPEN) {
                    sendMessageToClient(room.admin.ws, {
                        type: 'ADMIN_PRIZE_CLAIM_RECEIVED',
                        payload: {
                            claimId, // Server-generated claimId
                            playerId: player.id,
                            playerName: player.name,
                            prizeName: ruleToClaim.name,
                            prizeRuleId: ruleToClaim.id,
                            ticketId: ticketForClaim.id,
                            ticketNumbers: ticketForClaim.numbers,
                            serverValidationResult: isValidClaimByServer
                        }
                    });
                    sendMessageToClient(ws, { type: 'PLAYER_CLAIM_SUBMITTED', payload: { claimId, prizeName: ruleToClaim.name, status: 'pending_admin_approval' } });
                } else {
                    sendMessageToClient(ws, { type: 'ERROR', payload: { message: 'Admin not available to verify claim.' } });
                }
                break;
            }

            case 'PLAYER_MARK_NUMBER': {
                // This is mostly for client-side logic, server doesn't need to act on manual marks unless for boogie validation.
                // For now, just log it.
                if (!connectionInfo || connectionInfo.type !== 'player') return;
                // console.log(`Player ${connectionInfo.playerId} in room ${connectionInfo.roomId} client-side mark:`, payload);
                break;
            }

            default:
                sendMessageToClient(ws, { type: 'ERROR', payload: { message: `Unknown message type: ${type}` } });
        }
    });

    ws.on('close', () => {
        // console.log(`Client ${ws.id} disconnected`);
        console.log(`Client disconnected`);
        const connectionInfo = playerConnections.get(ws);
        if (connectionInfo) {
            const { roomId, playerId, type } = connectionInfo;
            const room = rooms[roomId];
            if (room) {
                if (type === 'admin' && room.admin && room.admin.id === playerId) {
                    console.log(`Admin ${room.admin.name} disconnected from room ${roomId}.`);
                    room.admin.ws = null; // Mark admin as disconnected
                    if (room.autoCallTimerId) clearTimeout(room.autoCallTimerId); // Stop auto-calls if admin leaves
                    broadcastToRoom(roomId, { type: 'ADMIN_STATUS_UPDATE', payload: { adminName: room.admin.name, isConnected: false } });
                    // Consider pausing the game if admin disconnects and game was running
                    // if (room.gameStatus === 'running') room.gameStatus = 'paused'; // Or some other state
                } else if (type === 'player') {
                    const playerIndex = room.players.findIndex(p => p.id === playerId);
                    if (playerIndex > -1) {
                        const playerName = room.players[playerIndex].name;
                        room.players.splice(playerIndex, 1);
                        broadcastToRoom(roomId, { type: 'PLAYER_LIST_UPDATE', payload: { players: room.players.map(p => ({ id: p.id, name: p.name, ticketCount: p.tickets.length })) } });
                        console.log(`Player ${playerName} (ID: ${playerId}) disconnected from room ${roomId}`);
                    }
                }

                // Optional: Cleanup room if admin is gone AND no players are left
                if (room.players.length === 0 && (!room.admin || !room.admin.ws)) {
                    console.log(`Room ${roomId} is empty and admin disconnected, cleaning up.`);
                    if (room.autoCallTimerId) clearTimeout(room.autoCallTimerId);
                    delete rooms[roomId];
                }
            }
            playerConnections.delete(ws);
        }
    });

    ws.on('error', (error) => {
        console.error('WebSocket error with client:', error);
        // Clean up connection if it was tracked
        const connectionInfo = playerConnections.get(ws);
        if (connectionInfo) playerConnections.delete(ws);
    });
});


function callNextNumberForRoom(roomId) {
    const room = rooms[roomId];
    if (room && room.gameStatus === 'running' && room.availableNumbers.length > 0) {
        const randomIndex = Math.floor(Math.random() * room.availableNumbers.length);
        const calledNumber = room.availableNumbers.splice(randomIndex, 1)[0];
        room.numbersCalled.push(calledNumber);
        // room.numbersCalled.sort((a, b) => a - b); // Optional: keep history sorted

        broadcastToRoom(roomId, {
            type: 'NUMBER_CALLED',
            payload: {
                number: calledNumber,
                calledNumbersHistory: [...room.numbersCalled], // Send a copy
                remainingCount: room.availableNumbers.length
            }
        });
        console.log(`Number ${calledNumber} called in room ${roomId}. Remaining: ${room.availableNumbers.length}`);

        if (room.availableNumbers.length === 0) {
            if (room.autoCallTimerId) clearTimeout(room.autoCallTimerId);
            room.gameStatus = 'stopped'; // Or a specific "all_numbers_called" status
            broadcastToRoom(roomId, { type: 'GAME_OVER_ALL_NUMBERS_CALLED', payload: { finalCalledNumbers: [...room.numbersCalled] } });
            console.log(`All numbers called in room ${roomId}. Game over.`);
            // Optionally, prepare and broadcast a game summary
            const gameSummary = {
                totalNumbersCalled: room.numbersCalled.length,
                winners: room.winners,
                 players: room.players.map(p => ({name: p.name, tickets: p.tickets.length, coins: p.coins}))
            };
            broadcastToRoom(roomId, { type: 'GAME_SUMMARY_BROADCAST', payload: gameSummary });
        }
    } else if (room && room.availableNumbers.length === 0 && room.gameStatus === 'running') {
        // This case should ideally be caught by the check above, but as a fallback:
        if (room.autoCallTimerId) clearTimeout(room.autoCallTimerId);
        room.gameStatus = 'stopped';
        broadcastToRoom(roomId, { type: 'GAME_OVER_ALL_NUMBERS_CALLED', payload: { finalCalledNumbers: [...room.numbersCalled] } });
        console.log(`Attempted to call number, but all numbers already called in room ${roomId}.`);
    }
}


// --- Basic HTTP Routes (Mostly for health checks/debug) ---
app.get('/', (req, res) => res.send('Tambola Game Backend is running! Access the game through the HTML files.'));

app.get('/health', (req, res) => res.status(200).json({ status: 'UP', timestamp: new Date().toISOString(), version: '1.1.0' }));

app.get('/debug/rooms', (req, res) => { // For admin/debug purposes
    const simplifiedRooms = {};
    for (const roomId in rooms) {
        simplifiedRooms[roomId] = {
            id: rooms[roomId].id,
            adminName: rooms[roomId].admin?.name,
            adminConnected: !!(rooms[roomId].admin?.ws && rooms[roomId].admin.ws.readyState === WebSocket.OPEN),
            playerCount: rooms[roomId].players.length,
            playersConnectedCount: rooms[roomId].players.filter(p => p.ws && p.ws.readyState === WebSocket.OPEN).length,
            gameStatus: rooms[roomId].gameStatus,
            callingMode: rooms[roomId].callingMode,
            calledCount: rooms[roomId].numbersCalled.length,
            rulesCount: rooms[roomId].rules.filter(r => r.isActive).length,
            winnersCount: rooms[roomId].winners?.length || 0,
            createdAt: rooms[roomId].createdAt
        };
    }
    res.json(simplifiedRooms);
});

// Example: To serve your HTML files (admin_join.html, player_join.html etc.)
// Create a 'public' folder, put your HTML files there, and uncomment the next line:
// app.use(express.static('public'));
// Then you can access them via http://localhost:3000/admin_join.html etc.

server.listen(PORT, () => {
    console.log(`HTTP and WebSocket server listening on ws://localhost:${PORT}`);
});

process.on('SIGINT', () => {
    console.log('Shutting down server...');
    if (wss) {
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.close(1001, "Server is shutting down.");
            }
        });
    }
    server.close(() => {
        console.log('Server shut down gracefully.');
        // Clear timers and states
        for (const roomId in rooms) {
            if (rooms[roomId].autoCallTimerId) {
                clearTimeout(rooms[roomId].autoCallTimerId);
            }
        }
        rooms = {};
        playerConnections.clear();
        process.exit(0);
    });
});
