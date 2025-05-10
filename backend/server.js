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
// Structure for a room:
// roomId: {
//     id: string,
//     admin: { id: string, name: string, ws: WebSocket },
//     players: [{ id: string, name: string, ws: WebSocket, tickets: [{id: string, numbers: number[][], marked: number[]}], coins: number }],
//     numbersCalled: number[],
//     availableNumbers: number[],
//     gameStatus: 'idle' | 'running' | 'paused' | 'stopped',
//     rules: any[], // Array of rule objects configured by admin
//     totalMoneyCollected: number,
//     callingMode: 'manual' | 'auto',
//     autoCallInterval: number, // in seconds for auto mode
//     winners: any[], // Stores { claimId, playerId, playerName, prizeName, coins, timestamp }
//     createdAt: string
// }
let playerConnections = new Map(); // ws -> { roomId, playerId, type: 'admin'/'player' }

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

console.log(`Tambola backend server starting on port ${PORT}...`);

// --- Helper Functions ---

function generateUniqueId() {
    return Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
}

/**
 * Generates a Tambola ticket.
 * - 3 rows, 9 columns.
 * - Each row has exactly 5 numbers.
 * - Each column has numbers from its specific range (1-9, 10-19, ..., 80-90).
 * - Numbers in a column are sorted top to bottom.
 * - No duplicate numbers on a single ticket.
 * @returns {Array<Array<number|null>>} A 2D array representing the ticket.
 */
function generateTambolaTicket() {
    let ticket = Array(3).fill(null).map(() => Array(9).fill(null));
    const numbersOnTicket = new Set(); // To ensure uniqueness across the ticket

    // Define column ranges
    const colRanges = [
        { min: 1, max: 9 }, { min: 10, max: 19 }, { min: 20, max: 29 },
        { min: 30, max: 39 }, { min: 40, max: 49 }, { min: 50, max: 59 },
        { min: 60, max: 69 }, { min: 70, max: 79 }, { min: 80, max: 90 }
    ];

    // Helper to get a random number in a range, excluding already picked numbers for the ticket
    function getRandomUniqueNumber(min, max, existingNumbers) {
        let num;
        let attempts = 0;
        do {
            num = Math.floor(Math.random() * (max - min + 1)) + min;
            attempts++;
        } while (existingNumbers.has(num) && attempts < 50); // Limit attempts to prevent infinite loops
        return existingNumbers.has(num) ? null : num; // Return null if unique not found quickly
    }

    // Distribute numbers: 15 numbers total, 5 per row.
    // Columns 0-8: typically 1 or 2 numbers, some columns can have 3. No column empty.
    let placedNumbers = 0;
    
    // Step 1: Ensure each column gets at least one number
    for (let col = 0; col < 9; col++) {
        let placedInCol = false;
        for (let attempt = 0; attempt < 3 && !placedInCol; attempt++) { // Try to place in any row
            let row = Math.floor(Math.random() * 3);
            if (ticket[row][col] === null) {
                const num = getRandomUniqueNumber(colRanges[col].min, colRanges[col].max, numbersOnTicket);
                if (num !== null) {
                    ticket[row][col] = num;
                    numbersOnTicket.add(num);
                    placedInCol = true;
                    placedNumbers++;
                }
            }
        }
    }

    // Step 2: Fill remaining spots to reach 15 numbers, respecting 5 per row
    let rowCounts = ticket.map(r => r.filter(n => n !== null).length);
    
    while (placedNumbers < 15) {
        let bestRow = -1, bestCol = -1, maxEmptySlotsInCol = -1;

        // Try to find a row that needs numbers
        for (let r = 0; r < 3; r++) {
            if (rowCounts[r] < 5) {
                // Find a column in this row that is empty and can accept a number
                for (let c = 0; c < 9; c++) {
                    if (ticket[r][c] === null) {
                        // Check how many numbers are already in this column
                        let numsInThisCol = 0;
                        for (let i = 0; i < 3; i++) if (ticket[i][c] !== null) numsInThisCol++;
                        
                        if (numsInThisCol < 3) { // Max 3 numbers per column (typical rule)
                             const num = getRandomUniqueNumber(colRanges[c].min, colRanges[c].max, numbersOnTicket);
                             if (num !== null) {
                                ticket[r][c] = num;
                                numbersOnTicket.add(num);
                                rowCounts[r]++;
                                placedNumbers++;
                                if (placedNumbers === 15) break;
                             }
                        }
                    }
                }
            }
            if (placedNumbers === 15) break;
        }
        if (placedNumbers === 15) break;
        // If the loop finishes and not 15, it means constraints are hard to meet with pure random.
        // This simple generator might sometimes produce slightly less than 15 or not perfectly distributed.
        // For a production game, a more deterministic or backtracking algorithm is needed.
        if (bestRow === -1) break; // Cannot place more numbers
    }


    // Step 3: Ensure each row has exactly 5 numbers (if possible with placed numbers)
    // This might involve removing/moving numbers if previous steps overfilled a row while others are empty
    // For simplicity, this step is kept minimal. A more robust solution is complex.
    for (let r = 0; r < 3; r++) {
        let currentNumbersInRow = ticket[r].filter(n => n !== null).length;
        let attempts = 0;
        while (currentNumbersInRow < 5 && attempts < 50) { // Try to add if less than 5
            attempts++;
            let emptyColIndices = [];
            for(let c=0; c<9; c++) if(ticket[r][c] === null) emptyColIndices.push(c);
            if(emptyColIndices.length === 0) break;

            let c = emptyColIndices[Math.floor(Math.random() * emptyColIndices.length)];
            let numsInThisCol = 0;
            for (let i = 0; i < 3; i++) if (ticket[i][c] !== null) numsInThisCol++;

            if (numsInThisCol < 3) {
                const num = getRandomUniqueNumber(colRanges[c].min, colRanges[c].max, numbersOnTicket);
                if (num !== null) {
                    ticket[r][c] = num;
                    numbersOnTicket.add(num);
                    currentNumbersInRow++;
                }
            }
        }
        while (currentNumbersInRow > 5 && attempts < 100) { // Try to remove if more than 5
             attempts++;
             let filledColIndices = [];
             for(let c=0; c<9; c++) if(ticket[r][c] !== null) filledColIndices.push(c);
             if(filledColIndices.length === 0) break;

             let c = filledColIndices[Math.floor(Math.random() * filledColIndices.length)];
             numbersOnTicket.delete(ticket[r][c]);
             ticket[r][c] = null;
             currentNumbersInRow--;
        }
    }


    // Step 4: Sort numbers within each column
    for (let c = 0; c < 9; c++) {
        let colValues = [];
        for (let r = 0; r < 3; r++) if (ticket[r][c] !== null) colValues.push(ticket[r][c]);
        colValues.sort((a, b) => a - b);
        let currentIdx = 0;
        for (let r = 0; r < 3; r++) if (ticket[r][c] !== null) ticket[r][c] = colValues[currentIdx++];
    }
    return ticket;
}


function broadcastToRoom(roomId, message, excludeWs = null) {
    const room = rooms[roomId];
    if (room) {
        const recipients = [];
        if (room.admin && room.admin.ws) recipients.push(room.admin.ws);
        room.players.forEach(p => { if (p.ws) recipients.push(p.ws); });

        recipients.forEach(clientWs => {
            if (clientWs !== excludeWs && clientWs.readyState === WebSocket.OPEN) {
                try { clientWs.send(JSON.stringify(message)); }
                catch (e) { console.error('Broadcast error:', e); }
            }
        });
    }
}

function sendMessageToClient(ws, message) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        try { ws.send(JSON.stringify(message)); }
        catch (e) { console.error('Send message error:', e); }
    }
}

// --- Prize Validation Helper Functions ---
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

    switch (prizeRuleName) {
        case 'Top Line':
            return allNumbersAreCalled(getNumbersInRow(ticketNumbers, 0), calledNumbers);
        
        case 'Middle Line':
            return allNumbersAreCalled(getNumbersInRow(ticketNumbers, 1), calledNumbers);

        case 'Bottom Line':
            return allNumbersAreCalled(getNumbersInRow(ticketNumbers, 2), calledNumbers);

        case 'Full House':
            // A standard Tambola ticket should have 15 numbers.
            // If ticket generation is imperfect, this check might be too strict.
            // For now, we assume a valid ticket would have 15 numbers for Full House.
            return allTicketNums.length === 15 && allNumbersAreCalled(allTicketNums, calledNumbers);

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

            // Ensure rows have enough numbers to define corners (at least 2 for 1st and last concept)
            if (topRowActual.length < 2 || bottomRowActual.length < 2) return false; 
            
            // Find the actual first and last numbers in the rows
            const corners = [
                topRowActual[0], topRowActual[topRowActual.length - 1],
                bottomRowActual[0], bottomRowActual[bottomRowActual.length - 1]
            ];
            // Ensure all 4 distinct corner positions had numbers and are called
            return corners.length === 4 && allNumbersAreCalled(corners, calledNumbers);
        }
        case '1-2-3': {
            const r0_actual = getNumbersInRow(ticketNumbers, 0);
            const r1_actual = getNumbersInRow(ticketNumbers, 1);
            const r2_actual = getNumbersInRow(ticketNumbers, 2);

            if (r0_actual.length < 1 || r1_actual.length < 2 || r2_actual.length < 3) return false;

            const numbersFor123 = [
                r0_actual[0],
                r1_actual[0], r1_actual[1],
                r2_actual[0], r2_actual[1], r2_actual[2]
            ];
            return allNumbersAreCalled(numbersFor123, calledNumbers);
        }
        case 'BP (Bull\'s Eye)': { 
            if (allTicketNums.length === 0) return false;
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
            console.warn(`Prize validation for "Unlucky 1" is not implemented on server.`);
            return false;

        default:
            console.warn(`Unknown prize rule name for validation: ${prizeRuleName}`);
            return false;
    }
}


// --- WebSocket Connection Handling ---
wss.on('connection', (ws) => {
    console.log('Client connected');

    ws.on('message', (messageString) => {
        let message;
        try {
            message = JSON.parse(messageString);
            console.log(`Received from client:`, message);
        } catch (e) {
            console.error('Failed to parse message:', messageString, e);
            sendMessageToClient(ws, { type: 'ERROR', payload: { message: 'Invalid message format.' } });
            return;
        }

        const { type, payload } = message;
        const connectionInfo = playerConnections.get(ws);

        switch (type) {
            case 'ADMIN_CREATE_JOIN_ROOM': {
                const { adminName, roomId } = payload;
                if (!adminName || !roomId) {
                    return sendMessageToClient(ws, { type: 'ERROR', payload: { message: 'Admin name and Room ID are required.' } });
                }
                if (rooms[roomId] && rooms[roomId].admin.id && rooms[roomId].admin.name !== adminName) {
                    return sendMessageToClient(ws, { type: 'ERROR', payload: { message: 'Room already exists with a different admin.' } });
                }
                
                let adminId;
                let isNewRoom = false;
                if (rooms[roomId] && rooms[roomId].admin.name === adminName) { // Admin rejoining
                    adminId = rooms[roomId].admin.id;
                    rooms[roomId].admin.ws = ws; // Update WebSocket
                } else { // New room or new admin for an empty room shell
                    adminId = generateUniqueId();
                    isNewRoom = true;
                    rooms[roomId] = {
                        id: roomId,
                        admin: { id: adminId, name: adminName, ws },
                        players: [],
                        numbersCalled: [],
                        availableNumbers: Array.from({ length: 90 }, (_, i) => i + 1),
                        gameStatus: 'idle',
                        rules: [], // Admin will configure these
                        totalMoneyCollected: 0,
                        callingMode: 'manual',
                        autoCallInterval: 5,
                        createdAt: new Date().toISOString(),
                        winners: [] 
                    };
                }
                playerConnections.set(ws, { roomId, playerId: adminId, type: 'admin' });
                
                const roomDetailsPayload = {
                    id: rooms[roomId].id,
                    admin: { id: rooms[roomId].admin.id, name: rooms[roomId].admin.name }, 
                    players: rooms[roomId].players.map(p => ({ id: p.id, name: p.name, tickets: p.tickets, coins: p.coins, ticketCount: p.tickets.length })),
                    numbersCalled: rooms[roomId].numbersCalled,
                    gameStatus: rooms[roomId].gameStatus,
                    rules: rooms[roomId].rules,
                    totalMoneyCollected: rooms[roomId].totalMoneyCollected,
                    callingMode: rooms[roomId].callingMode,
                    autoCallInterval: rooms[roomId].autoCallInterval
                };
                sendMessageToClient(ws, { 
                    type: isNewRoom ? 'ROOM_CREATED_SUCCESS' : 'ROOM_JOINED_SUCCESS', 
                    payload: { roomId, role: 'admin', adminId, roomDetails: roomDetailsPayload } 
                });
                console.log(`Admin ${adminName} (ID: ${adminId}) ${isNewRoom ? 'created' : 'rejoined'} room ${roomId}`);
                break;
            }

            case 'ADMIN_START_GAME': {
                if (!connectionInfo || connectionInfo.type !== 'admin') return;
                const room = rooms[connectionInfo.roomId];
                if (room && room.admin.id === connectionInfo.playerId && room.gameStatus === 'idle') {
                    if (!payload.rulesConfig || payload.rulesConfig.filter(r => r.isActive).length === 0) {
                        return sendMessageToClient(ws, {type: 'ERROR', payload: {message: 'Cannot start game without active rules.'}});
                    }
                    if (payload.totalMoneyCollected === undefined || parseFloat(payload.totalMoneyCollected) < 0) {
                        return sendMessageToClient(ws, {type: 'ERROR', payload: {message: 'Invalid total money collected.'}});
                    }
                    room.gameStatus = 'running';
                    room.numbersCalled = [];
                    room.availableNumbers = Array.from({ length: 90 }, (_, i) => i + 1);
                    room.rules = payload.rulesConfig; 
                    room.totalMoneyCollected = parseFloat(payload.totalMoneyCollected);
                    room.callingMode = payload.callingMode || 'manual';
                    room.autoCallInterval = payload.autoCallInterval || 5;
                    room.winners = []; 

                    broadcastToRoom(connectionInfo.roomId, { 
                        type: 'GAME_STARTED', 
                        payload: { 
                            rules: room.rules.filter(r => r.isActive), 
                            callingMode: room.callingMode,
                            autoCallInterval: room.autoCallInterval,
                            totalMoneyCollected: room.totalMoneyCollected,
                            startTime: new Date().toISOString(),
                            adminName: room.admin.name
                        } 
                    });
                    console.log(`Game started in room ${connectionInfo.roomId} by admin ${room.admin.name}. Mode: ${room.callingMode}`);
                }
                break;
            }

            case 'ADMIN_CALL_NUMBER': {
                if (!connectionInfo || connectionInfo.type !== 'admin') return;
                const room = rooms[connectionInfo.roomId];
                if (room && room.admin.id === connectionInfo.playerId && room.gameStatus === 'running') {
                    if (room.availableNumbers.length > 0) {
                        const randomIndex = Math.floor(Math.random() * room.availableNumbers.length);
                        const calledNumber = room.availableNumbers.splice(randomIndex, 1)[0];
                        room.numbersCalled.push(calledNumber);
                        // No need to sort room.numbersCalled for broadcast, order of calling matters.

                        broadcastToRoom(connectionInfo.roomId, { 
                            type: 'NUMBER_CALLED', 
                            payload: { 
                                number: calledNumber, 
                                calledNumbersHistory: [...room.numbersCalled], // Send a copy
                                remainingCount: room.availableNumbers.length 
                            } 
                        });
                        console.log(`Number ${calledNumber} called in room ${connectionInfo.roomId}. Remaining: ${room.availableNumbers.length}`);
                        
                        if (room.availableNumbers.length === 0) {
                            room.gameStatus = 'stopped';
                            broadcastToRoom(connectionInfo.roomId, { type: 'GAME_OVER_ALL_NUMBERS_CALLED', payload: { finalCalledNumbers: room.numbersCalled } });
                            console.log(`All numbers called in room ${connectionInfo.roomId}. Game over.`);
                        }
                    } else {
                        sendMessageToClient(ws, {type: 'INFO', payload: {message: 'All numbers have been called.'}});
                    }
                }
                break;
            }
            
            case 'ADMIN_PAUSE_GAME':
            case 'ADMIN_RESUME_GAME':
            case 'ADMIN_STOP_GAME': {
                if (!connectionInfo || connectionInfo.type !== 'admin') return;
                const room = rooms[connectionInfo.roomId];
                if (room && room.admin.id === connectionInfo.playerId) {
                    let newStatus = room.gameStatus;
                    let eventType = '';
                    if (type === 'ADMIN_PAUSE_GAME' && room.gameStatus === 'running' && room.callingMode === 'auto') {
                        newStatus = 'paused';
                        eventType = 'GAME_PAUSED';
                    } else if (type === 'ADMIN_RESUME_GAME' && room.gameStatus === 'paused' && room.callingMode === 'auto') {
                        newStatus = 'running';
                        eventType = 'GAME_RESUMED';
                    } else if (type === 'ADMIN_STOP_GAME' && (room.gameStatus === 'running' || room.gameStatus === 'paused')) {
                        newStatus = 'stopped';
                        eventType = 'GAME_STOPPED';
                        const gameSummary = {
                            totalNumbersCalled: room.numbersCalled.length,
                            winners: room.winners,
                            endTime: new Date().toISOString()
                        };
                        broadcastToRoom(connectionInfo.roomId, { type: 'GAME_SUMMARY_BROADCAST', payload: gameSummary });
                    }

                    if (eventType) {
                        room.gameStatus = newStatus;
                        broadcastToRoom(connectionInfo.roomId, { type: eventType, payload: { status: newStatus } });
                        console.log(`Game ${newStatus} in room ${connectionInfo.roomId}`);
                    }
                }
                break;
            }

            case 'ADMIN_UPDATE_RULES': {
                if (!connectionInfo || connectionInfo.type !== 'admin') return;
                const room = rooms[connectionInfo.roomId];
                // Allow rule updates only if game is idle
                if (room && room.admin.id === connectionInfo.playerId && room.gameStatus === 'idle' && payload.rules && payload.financials) {
                    room.rules = payload.rules; 
                    room.totalMoneyCollected = parseFloat(payload.financials.totalMoneyCollected);
                    
                    // Inform players about rule updates if they are already in the room (though game not started)
                    broadcastToRoom(connectionInfo.roomId, { type: 'RULES_UPDATED', payload: { rules: room.rules.filter(r => r.isActive), totalMoneyCollected: room.totalMoneyCollected } }, ws);
                    sendMessageToClient(ws, { type: 'RULES_SAVE_CONFIRMED' });
                    console.log(`Rules updated for room ${connectionInfo.roomId} (Game Idle)`);
                } else if (room && room.gameStatus !== 'idle') {
                    sendMessageToClient(ws, {type: 'ERROR', payload: {message: 'Rules can only be updated before the game starts.'}});
                }
                break;
            }
            
            case 'ADMIN_APPROVE_TICKET_REQUEST': {
                if (!connectionInfo || connectionInfo.type !== 'admin') return;
                const { targetPlayerId } = payload;
                const room = rooms[connectionInfo.roomId];
                const player = room?.players.find(p => p.id === targetPlayerId);

                if (room && player) {
                    if (player.tickets.length >= 5) {
                        sendMessageToClient(ws, { type: 'ADMIN_ACTION_FAIL', payload: { message: `${player.name} already has max tickets.` } });
                        return;
                    }
                    const newTicketNumbers = generateTambolaTicket();
                    const newTicket = { id: generateUniqueId(), numbers: newTicketNumbers, marked: [] };
                    player.tickets.push(newTicket);
                    if (player.ws) {
                        sendMessageToClient(player.ws, { type: 'TICKET_APPROVED', payload: { ticket: newTicket, allTickets: player.tickets } });
                    }
                    sendMessageToClient(ws, { type: 'ADMIN_ACTION_SUCCESS', payload: { message: `Ticket approved for ${player.name}` } });
                    broadcastToRoom(connectionInfo.roomId, { type: 'PLAYER_LIST_UPDATE', payload: { players: room.players.map(p => ({id: p.id, name: p.name, ticketCount: p.tickets.length})) } });
                } else {
                    sendMessageToClient(ws, { type: 'ADMIN_ACTION_FAIL', payload: { message: `Player ${targetPlayerId} not found.` } });
                }
                break;
            }

            case 'ADMIN_REJECT_TICKET_REQUEST': {
                if (!connectionInfo || connectionInfo.type !== 'admin') return;
                const { targetPlayerId, reason } = payload;
                const room = rooms[connectionInfo.roomId];
                const player = room?.players.find(p => p.id === targetPlayerId);
                if (room && player && player.ws) {
                    sendMessageToClient(player.ws, { type: 'TICKET_REJECTED', payload: { reason: reason || "Admin rejected the request." } });
                    sendMessageToClient(ws, { type: 'ADMIN_ACTION_SUCCESS', payload: { message: `Ticket request rejected for ${player.name}` } });
                }
                break;
            }

            case 'ADMIN_APPROVE_PRIZE_CLAIM': {
                if (!connectionInfo || connectionInfo.type !== 'admin') return;
                const { claimId, targetPlayerId, prizeName, prizeRuleId } = payload; 
                const room = rooms[connectionInfo.roomId];
                const player = room?.players.find(p => p.id === targetPlayerId);
                const ruleInfo = room?.rules.find(r => r.id === prizeRuleId && r.isActive);

                if (room && player && player.ws && ruleInfo) {
                    // Prevent duplicate prize wins for the same rule by the same player if rule.maxPrizes = 1
                    // More complex logic needed if maxPrizes > 1 for a rule type
                    const existingWinsForThisRuleByPlayer = room.winners.filter(w => w.playerId === player.id && w.prizeName === prizeName).length;
                    const maxAllowedWinsForRule = ruleInfo.maxPrizes || 1;

                    if (existingWinsForThisRuleByPlayer >= maxAllowedWinsForRule) {
                        sendMessageToClient(ws, { type: 'ADMIN_ACTION_FAIL', payload: { message: `${player.name} has already reached max wins for '${prizeName}'.` } });
                        // Optionally inform player their claim is rejected due to max wins
                        sendMessageToClient(player.ws, { 
                            type: 'CLAIM_STATUS_UPDATE', 
                            payload: { claimId, prizeName, status: 'rejected', reason: `Max winners already declared for ${prizeName}.` } 
                        });
                        return;
                    }

                    const coinsAwarded = parseFloat(ruleInfo.coinsPerPrize) || 0;
                    player.coins = (player.coins || 0) + coinsAwarded;

                    sendMessageToClient(player.ws, { 
                        type: 'CLAIM_STATUS_UPDATE', 
                        payload: { claimId, prizeName, status: 'approved', coinsAwarded, totalCoins: player.coins } 
                    });
                    
                    room.winners.push({ claimId, playerId: player.id, playerName: player.name, prizeName, coins: coinsAwarded, timestamp: new Date().toISOString() });
                    
                    broadcastToRoom(connectionInfo.roomId, {type: 'WINNER_ANNOUNCEMENT', payload: {playerName: player.name, prizeName, coins: coinsAwarded}});
                    sendMessageToClient(ws, { type: 'ADMIN_ACTION_SUCCESS', payload: { message: `Prize '${prizeName}' approved for ${player.name}. Coins: ${coinsAwarded.toFixed(2)}` } });
                } else {
                     sendMessageToClient(ws, { type: 'ADMIN_ACTION_FAIL', payload: { message: `Could not approve claim. Player, rule not found/active, or prize already maxed out.` } });
                }
                break;
            }
            
            case 'ADMIN_REJECT_PRIZE_CLAIM': {
                if (!connectionInfo || connectionInfo.type !== 'admin') return;
                const { claimId, targetPlayerId, prizeName, reason } = payload;
                const room = rooms[connectionInfo.roomId];
                const player = room?.players.find(p => p.id === targetPlayerId);
                if (room && player && player.ws) {
                    sendMessageToClient(player.ws, { 
                        type: 'CLAIM_STATUS_UPDATE', 
                        payload: { claimId, prizeName, status: 'rejected', reason: reason || "Claim did not meet criteria." } 
                    });
                    sendMessageToClient(ws, { type: 'ADMIN_ACTION_SUCCESS', payload: { message: `Prize '${prizeName}' rejected for ${player.name}` } });
                }
                break;
            }


            // --- Player Actions ---
            case 'PLAYER_JOIN_ROOM': { // This is the initial message from player_join.html
                const { playerName, roomId } = payload;
                if (!playerName || !roomId) {
                    return sendMessageToClient(ws, { type: 'ERROR', payload: { message: 'Player name and Room ID are required.' } });
                }
                const room = rooms[roomId];
                if (!room || !room.admin) { 
                    return sendMessageToClient(ws, { type: 'ERROR', payload: { message: 'Room not found or not ready.' } });
                }
                if (room.gameStatus === 'stopped') {
                     return sendMessageToClient(ws, { type: 'ERROR', payload: { message: 'Game has ended.' } });
                }

                const playerId = generateUniqueId();
                const initialTicketNumbers = generateTambolaTicket();
                const player = {
                    id: playerId, name: playerName, ws,
                    tickets: [{ id: generateUniqueId(), numbers: initialTicketNumbers, marked: [] }],
                    coins: 0
                };
                room.players.push(player);
                playerConnections.set(ws, { roomId, playerId, type: 'player' });

                sendMessageToClient(ws, { 
                    type: 'PLAYER_JOIN_SUCCESS', 
                    payload: { 
                        playerId, playerName, roomId, 
                        tickets: player.tickets,
                        gameStatus: room.gameStatus,
                        calledNumbers: room.numbersCalled,
                        rules: room.rules.filter(r => r.isActive), 
                        totalMoneyCollected: room.totalMoneyCollected,
                        adminName: room.admin.name,
                        playersInRoom: room.players.map(p => ({id: p.id, name: p.name, ticketCount: p.tickets.length}))
                    } 
                });
                broadcastToRoom(roomId, { type: 'PLAYER_LIST_UPDATE', payload: { players: room.players.map(p => ({id: p.id, name: p.name, ticketCount: p.tickets.length})) } }, ws);
                console.log(`Player ${playerName} (ID: ${playerId}) joined room ${roomId}`);
                break;
            }
            // This case is for when player_game.html connects, not player_join.html
            // case 'PLAYER_READY_FOR_GAME': {
            //     if (!connectionInfo || connectionInfo.type !== 'player') return;
            //     const room = rooms[connectionInfo.roomId];
            //     const player = room?.players.find(p => p.id === connectionInfo.playerId);
            //     if(room && player) {
            //         // Send current game state to this specific player
            //         sendMessageToClient(ws, {
            //             type: 'GAME_STATE_UPDATE',
            //             payload: {
            //                 gameStatus: room.gameStatus,
            //                 calledNumbers: room.numbersCalled,
            //                 rules: room.rules.filter(r => r.isActive),
            //                 latestCalledNumber: room.numbersCalled.length > 0 ? room.numbersCalled[room.numbersCalled.length -1] : null,
            //                 // otherPlayers: room.players.filter(op => op.id !== player.id).map(op => ({id: op.id, name: op.name, ticketCount: op.tickets.length})),
            //                 adminName: room.admin.name
            //             }
            //         });
            //     }
            //     break;
            // }


            case 'PLAYER_REQUEST_TICKET': {
                if (!connectionInfo || connectionInfo.type !== 'player') return;
                const room = rooms[connectionInfo.roomId];
                const player = room?.players.find(p => p.id === connectionInfo.playerId);
                if (room && player) {
                    if (player.tickets.length >= 5) {
                        return sendMessageToClient(ws, { type: 'ERROR', payload: { message: 'Maximum 5 tickets allowed.' }});
                    }
                    if (room.admin && room.admin.ws) {
                        sendMessageToClient(room.admin.ws, { 
                            type: 'ADMIN_TICKET_REQUEST_RECEIVED', 
                            payload: { playerId: player.id, playerName: player.name, currentTickets: player.tickets.length }
                        });
                        sendMessageToClient(ws, { type: 'PLAYER_TICKET_REQUEST_SENT' });
                    } else {
                        sendMessageToClient(ws, { type: 'ERROR', payload: { message: 'Admin not available to approve ticket.' }});
                    }
                }
                break;
            }

            case 'PLAYER_CLAIM_PRIZE': {
                if (!connectionInfo || connectionInfo.type !== 'player') return;
                const { prizeRuleId, ticketId } = payload; 
                const room = rooms[connectionInfo.roomId];
                const player = room?.players.find(p => p.id === connectionInfo.playerId);
                const ruleToClaim = room?.rules.find(r => r.id === prizeRuleId && r.isActive);
                const ticketForClaim = player?.tickets.find(t => t.id === ticketId);

                if (!room || !player || !ruleToClaim || !ticketForClaim) {
                    return sendMessageToClient(ws, { type: 'ERROR', payload: { message: 'Invalid claim request details.' } });
                }
                if (room.gameStatus !== 'running') {
                    return sendMessageToClient(ws, {type: 'ERROR', payload: {message: 'Game is not currently running.'}});
                }

                if (room.winners && room.winners.some(w => w.playerId === player.id && w.prizeName === ruleToClaim.name)) {
                    return sendMessageToClient(ws, {type: 'ERROR', payload: {message: `You have already claimed or won '${ruleToClaim.name}'.`}});
                }
                
                const isValidClaim = validatePrizeClaim(ticketForClaim.numbers, room.numbersCalled, ruleToClaim.name);
                const claimId = generateUniqueId();

                if (room.admin && room.admin.ws) {
                    sendMessageToClient(room.admin.ws, {
                        type: 'ADMIN_PRIZE_CLAIM_RECEIVED',
                        payload: {
                            claimId,
                            playerId: player.id,
                            playerName: player.name,
                            prizeName: ruleToClaim.name,
                            prizeRuleId: ruleToClaim.id, 
                            ticketId: ticketForClaim.id,
                            ticketNumbers: ticketForClaim.numbers, 
                            serverValidationResult: isValidClaim 
                        }
                    });
                    // Add to player's local claims as pending
                     sendMessageToClient(ws, { type: 'PLAYER_CLAIM_SUBMITTED', payload: { claimId, prizeName: ruleToClaim.name, status: 'pending_admin_approval' } });
                } else {
                     sendMessageToClient(ws, { type: 'ERROR', payload: { message: 'Admin not available to verify claim.' } });
                }
                break;
            }
            
            case 'PLAYER_MARK_NUMBER': { 
                // This message is primarily for logging or advanced features.
                // The client handles the visual marking and "boogie" logic.
                // if (!connectionInfo || connectionInfo.type !== 'player') return;
                // const { ticketId, number, isMarked } = payload;
                // console.log(`Player ${connectionInfo.playerId} client-side ${isMarked ? 'marked' : 'unmarked'} ${number} on ticket ${ticketId} in room ${connectionInfo.roomId}`);
                break;
            }


            default:
                sendMessageToClient(ws, { type: 'ERROR', payload: { message: `Unknown message type: ${type}` } });
        }
    });

    ws.on('close', () => {
        console.log('Client disconnected');
        const connectionInfo = playerConnections.get(ws);
        if (connectionInfo) {
            const { roomId, playerId, type } = connectionInfo;
            const room = rooms[roomId];
            if (room) {
                if (type === 'admin' && room.admin && room.admin.id === playerId) {
                    console.log(`Admin ${room.admin.name} disconnected from room ${roomId}.`);
                    room.admin.ws = null; // Mark admin as disconnected but keep their info for potential rejoin
                    broadcastToRoom(roomId, { type: 'ADMIN_DISCONNECTED', payload: { adminName: room.admin.name } });
                    // If game was running in auto mode, server might need to pause it.
                    if (room.gameStatus === 'running' && room.callingMode === 'auto') {
                        // room.gameStatus = 'paused'; // Or a specific "admin_disconnected_pause"
                        // broadcastToRoom(roomId, {type: 'GAME_PAUSED_ADMIN_DISCONNECT'});
                        console.log(`Game in room ${roomId} was in auto mode, might need manual intervention or auto-pause.`);
                    }
                } else if (type === 'player') {
                    const playerIndex = room.players.findIndex(p => p.id === playerId);
                    if (playerIndex > -1) {
                        const playerName = room.players[playerIndex].name;
                        room.players.splice(playerIndex, 1);
                        broadcastToRoom(roomId, { type: 'PLAYER_LIST_UPDATE', payload: { players: room.players.map(p => ({id: p.id, name: p.name, ticketCount: p.tickets.length})) } });
                        console.log(`Player ${playerName} (ID: ${playerId}) disconnected from room ${roomId}`);
                    }
                }
                // Consider cleaning up room if admin.ws is null AND no players are left for a while
                if (room.players.length === 0 && (!room.admin || !room.admin.ws)) {
                    console.log(`Room ${roomId} is effectively empty, cleaning up.`);
                    delete rooms[roomId];
                }
            }
            playerConnections.delete(ws);
        }
    });

    ws.on('error', (error) => {
        console.error('WebSocket error with client:', error);
        const connectionInfo = playerConnections.get(ws);
        if (connectionInfo) playerConnections.delete(ws); 
    });
});


// --- Basic HTTP Routes ---
app.get('/', (req, res) => res.send('Tambola Game Backend is running!'));
app.get('/health', (req, res) => res.status(200).json({ status: 'UP', timestamp: new Date().toISOString() }));
app.get('/debug/rooms', (req, res) => {
    const simplifiedRooms = {};
    for (const roomId in rooms) {
        simplifiedRooms[roomId] = {
            id: rooms[roomId].id,
            adminName: rooms[roomId].admin?.name,
            adminConnected: !!(rooms[roomId].admin?.ws && rooms[roomId].admin.ws.readyState === WebSocket.OPEN),
            playerCount: rooms[roomId].players.length,
            gameStatus: rooms[roomId].gameStatus,
            calledCount: rooms[roomId].numbersCalled.length,
            rulesCount: rooms[roomId].rules.length,
            winnersCount: rooms[roomId].winners?.length || 0
        };
    }
    res.json(simplifiedRooms);
});

server.listen(PORT, () => {
    console.log(`HTTP and WebSocket server listening on ws://localhost:${PORT}`);
});

process.on('SIGINT', () => {
    console.log('Shutting down server...');
    wss.clients.forEach(client => client.close());
    server.close(() => {
        console.log('Server shut down gracefully.');
        rooms = {}; 
        playerConnections.clear();
        process.exit(0);
    });
});
