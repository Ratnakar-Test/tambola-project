// server.js
// Tambola Game Backend - Enhanced Sync & Broadcast

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');

const PORT = process.env.PORT || 3000;

const app = express();
app.use(cors());
app.use(express.json());

let rooms = {};
let playerConnections = new Map(); // ws -> { roomId, playerId, type: 'admin'/'player' }

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

console.log(`Tambola backend server running on port ${PORT}`);

// --- Helper Functions ---
function generateUniqueId() { return Math.random().toString(36).substr(2, 9) + Date.now().toString(36); }

function generateTambolaTicket() {
    let ticket = Array(3).fill(null).map(() => Array(9).fill(null));
    const numbersOnTicket = new Set();
    const colRanges = [
        { min: 1, max: 9 }, { min: 10, max: 19 }, { min: 20, max: 29 },
        { min: 30, max: 39 }, { min: 40, max: 49 }, { min: 50, max: 59 },
        { min: 60, max: 69 }, { min: 70, max: 79 }, { min: 80, max: 90 }
    ];

    function getRandomUniqueNumber(min, max, existingNumbers) {
        let num; let attempts = 0;
        do { num = Math.floor(Math.random() * (max - min + 1)) + min; attempts++; }
        while (existingNumbers.has(num) && attempts < 50);
        return existingNumbers.has(num) ? null : num;
    }

    let placedNumbers = 0;
    for (let col = 0; col < 9; col++) {
        let placedInCol = false;
        for (let attempt = 0; attempt < 3 && !placedInCol; attempt++) {
            let row = Math.floor(Math.random() * 3);
            if (ticket[row][col] === null) {
                const num = getRandomUniqueNumber(colRanges[col].min, colRanges[col].max, numbersOnTicket);
                if (num !== null) { ticket[row][col] = num; numbersOnTicket.add(num); placedInCol = true; placedNumbers++; }
            }
        }
    }

    let rowCounts = ticket.map(r => r.filter(n => n !== null).length);
    while (placedNumbers < 15) {
        let breakOuter = false; let placedThisCycle = false;
        for (let r = 0; r < 3; r++) {
            if (rowCounts[r] < 5) {
                for (let c = 0; c < 9; c++) {
                    if (ticket[r][c] === null) {
                        let numsInThisCol = 0;
                        for (let i = 0; i < 3; i++) if (ticket[i][c] !== null) numsInThisCol++;
                        if (numsInThisCol < 3) {
                             const num = getRandomUniqueNumber(colRanges[c].min, colRanges[c].max, numbersOnTicket);
                             if (num !== null) {
                                ticket[r][c] = num; numbersOnTicket.add(num); rowCounts[r]++; placedNumbers++; placedThisCycle = true;
                                if (placedNumbers === 15) {breakOuter = true; break;}
                             }
                        }
                    }
                }
            }
            if (breakOuter) break;
        }
        if (breakOuter || placedNumbers === 15) break;
        if (!placedThisCycle && placedNumbers < 15) { break; }
    }
    for (let r = 0; r < 3; r++) {
        let currentNumbersInRow = ticket[r].filter(n => n !== null).length; let attempts = 0;
        while (currentNumbersInRow < 5 && attempts < 50) { 
            attempts++; let emptyColIndices = [];
            for(let c=0; c<9; c++) if(ticket[r][c] === null) emptyColIndices.push(c);
            if(emptyColIndices.length === 0) break;
            let c = emptyColIndices[Math.floor(Math.random() * emptyColIndices.length)];
            let numsInThisCol = 0; for (let i = 0; i < 3; i++) if (ticket[i][c] !== null) numsInThisCol++;
            if (numsInThisCol < 3) {
                const num = getRandomUniqueNumber(colRanges[c].min, colRanges[c].max, numbersOnTicket);
                if (num !== null) { ticket[r][c] = num; numbersOnTicket.add(num); currentNumbersInRow++; }
            }
        }
        while (currentNumbersInRow > 5 && attempts < 100) { 
             attempts++; let filledColIndices = [];
             for(let c=0; c<9; c++) if(ticket[r][c] !== null) filledColIndices.push(c);
             if(filledColIndices.length === 0) break;
             let c = filledColIndices[Math.floor(Math.random() * filledColIndices.length)];
             numbersOnTicket.delete(ticket[r][c]); ticket[r][c] = null; currentNumbersInRow--;
        }
    }
    for (let c = 0; c < 9; c++) {
        let colVals = []; for (let r = 0; r < 3; r++) if (ticket[r][c] !== null) colVals.push(ticket[r][c]);
        colVals.sort((a, b) => a - b); let currentIdx = 0;
        for (let r = 0; r < 3; r++) if (ticket[r][c] !== null) ticket[r][c] = colVals[currentIdx++];
    }
    return ticket;
}

function broadcastToRoom(roomId, message, excludeWs = null) {
    const room = rooms[roomId];
    if (room) {
        const recipients = [];
        if (room.admin && room.admin.ws && room.admin.ws.readyState === WebSocket.OPEN) {
            recipients.push(room.admin.ws);
        }
        room.players.forEach(player => {
            if (player.ws && player.ws.readyState === WebSocket.OPEN) {
                recipients.push(player.ws);
            }
        });

        // console.log(`Broadcasting to room ${roomId} (Admin: ${room.admin && room.admin.ws ? 'connected' : 'not connected'}, Players: ${room.players.length}):`, message.type);
        
        recipients.forEach(clientWs => {
            if (clientWs !== excludeWs) {
                try {
                    clientWs.send(JSON.stringify(message));
                } catch (error) {
                    console.error('Error sending message during broadcast:', error);
                }
            }
        });
    } else {
        console.warn(`Attempted to broadcast to non-existent room: ${roomId}`);
    }
}

function sendMessageToClient(ws, message) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        try {
            ws.send(JSON.stringify(message));
        } catch (error) {
            console.error('Error sending message to client:', error);
        }
    }
}

function getAllNumbersOnTicket(ticketNumbers) { return ticketNumbers.flat().filter(num => num !== null); }
function getNumbersInRow(ticketNumbers, rowIndex) { if (rowIndex < 0 || rowIndex >= ticketNumbers.length) return []; return ticketNumbers[rowIndex].filter(num => num !== null); }
function allNumbersAreCalled(numbersToCheck, calledNumbers) { if (!numbersToCheck || numbersToCheck.length === 0) return false; return numbersToCheck.every(num => calledNumbers.includes(num)); }

function validatePrizeClaim(ticketNumbers, calledNumbers, prizeRuleName) {
    const allTicketNums = getAllNumbersOnTicket(ticketNumbers);
    switch (prizeRuleName) {
        case 'Top Line': return allNumbersAreCalled(getNumbersInRow(ticketNumbers, 0), calledNumbers);
        case 'Middle Line': return allNumbersAreCalled(getNumbersInRow(ticketNumbers, 1), calledNumbers);
        case 'Bottom Line': return allNumbersAreCalled(getNumbersInRow(ticketNumbers, 2), calledNumbers);
        case 'Full House': return allTicketNums.length >= 15 && allNumbersAreCalled(allTicketNums, calledNumbers);
        case 'Early 5': return allTicketNums.filter(num => calledNumbers.includes(num)).length >= 5;
        case 'Early 7': return allTicketNums.filter(num => calledNumbers.includes(num)).length >= 7;
        case 'Corners': {
            const topRowActual = getNumbersInRow(ticketNumbers, 0); const bottomRowActual = getNumbersInRow(ticketNumbers, 2);
            if (topRowActual.length < 2 || bottomRowActual.length < 2) return false; 
            const cornerNumbers = [topRowActual[0], topRowActual[topRowActual.length - 1], bottomRowActual[0], bottomRowActual[bottomRowActual.length - 1]];
            return cornerNumbers.filter(n => n !== undefined && n !== null).length === 4 && allNumbersAreCalled(cornerNumbers.filter(n => n !== undefined && n !== null), calledNumbers);
        }
        case '1-2-3': {
            const r0 = getNumbersInRow(ticketNumbers, 0); const r1 = getNumbersInRow(ticketNumbers, 1); const r2 = getNumbersInRow(ticketNumbers, 2);
            if (r0.length < 1 || r1.length < 2 || r2.length < 3) return false;
            return allNumbersAreCalled([r0[0], r1[0], r1[1], r2[0], r2[1], r2[2]], calledNumbers);
        }
        case 'BP (Bull\'s Eye)': { if (allTicketNums.length === 0) return false; return calledNumbers.includes(Math.min(...allTicketNums)) && calledNumbers.includes(Math.max(...allTicketNums)); }
        case 'Breakfast': { const nums = allTicketNums.filter(n => n >= 1 && n <= 30); return nums.length > 0 && allNumbersAreCalled(nums, calledNumbers); }
        case 'Dinner': { const nums = allTicketNums.filter(n => n >= 61 && n <= 90); return nums.length > 0 && allNumbersAreCalled(nums, calledNumbers); }
        case 'Fat Ladies': { const nums = allTicketNums.filter(n => n.toString().includes('8')); return nums.length > 0 && allNumbersAreCalled(nums, calledNumbers); }
        case 'Unlucky 1': console.warn(`"Unlucky 1" validation N/A.`); return false;
        default: console.warn(`Unknown prize rule: ${prizeRuleName}`); return false;
    }
}

wss.on('connection', (ws, req) => {
    const connectionId = generateUniqueId(); // For logging
    console.log(`Client ${connectionId} connected.`);

    ws.on('message', (messageString) => {
        let message;
        try {
            message = JSON.parse(messageString);
            console.log(`Received from ${connectionId}:`, message);
        } catch (e) {
            console.error(`Failed to parse message from ${connectionId}:`, messageString, e);
            sendMessageToClient(ws, { type: 'ERROR', payload: { message: 'Invalid message format.' } });
            return;
        }

        const { type, payload } = message;
        let connectionInfo = playerConnections.get(ws); // Get existing info if available

        switch (type) {
            case 'ADMIN_CREATE_JOIN_ROOM': {
                const { adminName, roomId } = payload;
                if (!adminName || !roomId) {
                    return sendMessageToClient(ws, { type: 'ERROR', payload: { message: 'Admin name and Room ID are required.' } });
                }
                
                let adminId;
                let isNewRoom = false;
                if (rooms[roomId]) { 
                    if(rooms[roomId].admin && rooms[roomId].admin.name === adminName) { 
                        adminId = rooms[roomId].admin.id;
                        rooms[roomId].admin.ws = ws; 
                        console.log(`Admin ${adminName} (ID: ${adminId}) rejoined room ${roomId}`);
                    } else if (rooms[roomId].admin && rooms[roomId].admin.name !== adminName && rooms[roomId].admin.ws && rooms[roomId].admin.ws.readyState === WebSocket.OPEN) { 
                        return sendMessageToClient(ws, { type: 'ERROR', payload: { message: 'Room already exists with an active admin.' } });
                    } else { 
                        adminId = rooms[roomId].admin?.id || generateUniqueId(); 
                        rooms[roomId].admin = { id: adminId, name: adminName, ws };
                        // If re-admining a room that might have been in progress, ensure it's idle or send current state
                        // For simplicity, let's assume it should be idle or will be reset by admin actions.
                        // rooms[roomId].gameStatus = 'idle'; // Or send current state
                        console.log(`Admin ${adminName} (ID: ${adminId}) took over/reconnected to room ${roomId}`);
                    }
                } else { 
                    adminId = generateUniqueId();
                    isNewRoom = true;
                    rooms[roomId] = {
                        id: roomId, admin: { id: adminId, name: adminName, ws }, players: [], 
                        numbersCalled: [], availableNumbers: Array.from({ length: 90 }, (_, i) => i + 1),
                        gameStatus: 'idle', rules: [], totalMoneyCollected: 0, callingMode: 'manual',
                        autoCallInterval: 5, createdAt: new Date().toISOString(), winners: [] 
                    };
                    console.log(`Admin ${adminName} (ID: ${adminId}) created room ${roomId}`);
                }
                playerConnections.set(ws, { roomId, playerId: adminId, type: 'admin' });
                
                const roomDetailsPayload = { 
                    id: rooms[roomId].id,
                    admin: { id: rooms[roomId].admin.id, name: rooms[roomId].admin.name }, 
                    players: rooms[roomId].players.map(p => ({ id: p.id, name: p.name, ticketCount: p.tickets.length })),
                    numbersCalled: rooms[roomId].numbersCalled, gameStatus: rooms[roomId].gameStatus,
                    rules: rooms[roomId].rules, totalMoneyCollected: rooms[roomId].totalMoneyCollected,
                    callingMode: rooms[roomId].callingMode, autoCallInterval: rooms[roomId].autoCallInterval
                };
                sendMessageToClient(ws, { 
                    type: isNewRoom ? 'ROOM_CREATED_SUCCESS' : 'ROOM_JOINED_SUCCESS', 
                    payload: { roomId, role: 'admin', adminId, roomDetails: roomDetailsPayload } 
                });
                // Send player list to admin if rejoining a room with players
                if (!isNewRoom && rooms[roomId].players.length > 0) {
                    sendMessageToClient(ws, { type: 'PLAYER_LIST_UPDATE', payload: { players: rooms[roomId].players.map(p => ({id: p.id, name: p.name, ticketCount: p.tickets.length})) } });
                }
                break;
            }

            case 'ADMIN_START_GAME': {
                if (!connectionInfo || connectionInfo.type !== 'admin') return;
                const room = rooms[connectionInfo.roomId];
                if (room && room.admin.id === connectionInfo.playerId && room.gameStatus === 'idle') {
                    if (!payload.rulesConfig || payload.rulesConfig.filter(r => r.isActive).length === 0) {
                        return sendMessageToClient(ws, {type: 'ERROR', payload: {message: 'Cannot start game without active rules.'}});
                    }
                    if (payload.totalMoneyCollected === undefined || parseFloat(payload.totalMoneyCollected) <= 0) {
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
                            adminName: room.admin.name // Ensure adminName is sent
                        } 
                    });
                    console.log(`Game started in room ${connectionInfo.roomId} by admin ${room.admin.name}. Mode: ${room.callingMode}`);
                } else if (room && room.gameStatus !== 'idle') {
                    sendMessageToClient(ws, {type: 'ERROR', payload: {message: `Game cannot be started. Current status: ${room.gameStatus}`}});
                } else if (!room) {
                     sendMessageToClient(ws, {type: 'ERROR', payload: {message: `Room not found.`}});
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
                        
                        broadcastToRoom(connectionInfo.roomId, { 
                            type: 'NUMBER_CALLED', 
                            payload: { 
                                number: calledNumber, 
                                calledNumbersHistory: [...room.numbersCalled], // Send a copy of the history
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
                    let newStatus = room.gameStatus; let eventType = '';
                    if (type === 'ADMIN_PAUSE_GAME' && room.gameStatus === 'running' && room.callingMode === 'auto') {
                        newStatus = 'paused'; eventType = 'GAME_PAUSED';
                    } else if (type === 'ADMIN_RESUME_GAME' && room.gameStatus === 'paused' && room.callingMode === 'auto') {
                        newStatus = 'running'; eventType = 'GAME_RESUMED';
                    } else if (type === 'ADMIN_STOP_GAME' && (room.gameStatus === 'running' || room.gameStatus === 'paused')) {
                        newStatus = 'stopped'; eventType = 'GAME_STOPPED';
                        const gameSummary = { totalNumbersCalled: room.numbersCalled.length, winners: room.winners, endTime: new Date().toISOString() };
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
                if (room && room.admin.id === connectionInfo.playerId && payload.rules && payload.financials) {
                    if (room.gameStatus === 'idle') {
                        room.rules = payload.rules; 
                        room.totalMoneyCollected = parseFloat(payload.financials.totalMoneyCollected);
                        sendMessageToClient(ws, { type: 'RULES_SAVE_CONFIRMED', payload: {message: "Rules and financials saved successfully."} });
                        console.log(`Rules updated for room ${connectionInfo.roomId}`);
                        // Broadcast updated rules to any players already in the room (if any)
                        broadcastToRoom(connectionInfo.roomId, { type: 'RULES_UPDATED', payload: { rules: room.rules.filter(r => r.isActive), totalMoneyCollected: room.totalMoneyCollected } }, ws);
                    } else {
                         sendMessageToClient(ws, {type: 'ERROR', payload: {message: `Rules can only be updated when game is idle. Current status: ${room.gameStatus}`}});
                    }
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
                        return sendMessageToClient(ws, { type: 'ADMIN_ACTION_FAIL', payload: { message: `${player.name} has max tickets.` } });
                    }
                    const newTicket = { id: generateUniqueId(), numbers: generateTambolaTicket(), marked: [] };
                    player.tickets.push(newTicket);
                    if (player.ws) sendMessageToClient(player.ws, { type: 'TICKET_APPROVED', payload: { ticket: newTicket, allTickets: player.tickets } });
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
                    sendMessageToClient(player.ws, { type: 'TICKET_REJECTED', payload: { reason: reason || "Admin rejected." } });
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
                    const existingWinsForThisRuleByPlayer = room.winners.filter(w => w.playerId === player.id && w.prizeName === prizeName).length;
                    const maxAllowedWinsForRule = ruleInfo.maxPrizes || 1;

                    if (existingWinsForThisRuleByPlayer >= maxAllowedWinsForRule) {
                        sendMessageToClient(ws, { type: 'ADMIN_ACTION_FAIL', payload: { message: `${player.name} reached max wins for '${prizeName}'.` } });
                        if (player.ws) sendMessageToClient(player.ws, { type: 'CLAIM_STATUS_UPDATE', payload: { claimId, prizeName, status: 'rejected', reason: `Max winners already declared for ${prizeName}.` } });
                        return;
                    }
                    const coinsAwarded = parseFloat(ruleInfo.coinsPerPrize) || 0;
                    player.coins = (player.coins || 0) + coinsAwarded;
                    sendMessageToClient(player.ws, { 
                        type: 'CLAIM_STATUS_UPDATE', 
                        payload: { claimId, prizeName, status: 'approved', coinsAwarded, totalCoins: player.coins } 
                    });
                    
                    room.winners.push({ claimId, playerId: player.id, playerName: player.name, prizeName, coins: coinsAwarded, timestamp: new Date().toISOString() });
                    
                    broadcastToRoom(connectionInfo.roomId, {type: 'WINNER_ANNOUNCEMENT', payload: {playerName: player.name, prizeName, coins: coinsAwarded, claimId}});
                    sendMessageToClient(ws, { type: 'ADMIN_ACTION_SUCCESS', payload: { message: `Prize '${prizeName}' approved for ${player.name}. Coins: ${coinsAwarded.toFixed(2)}` } });
                } else {
                     sendMessageToClient(ws, { type: 'ADMIN_ACTION_FAIL', payload: { message: `Could not approve claim. Player, rule not found/active.` } });
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
                        payload: { claimId, prizeName, status: 'rejected', reason: reason || "Not valid." } 
                    });
                    sendMessageToClient(ws, { type: 'ADMIN_ACTION_SUCCESS', payload: { message: `Prize '${prizeName}' rejected for ${player.name}` } });
                }
                break;
            }

            case 'PLAYER_JOIN_ROOM': {
                const { playerName, roomId } = payload;
                if (!playerName || !roomId) return sendMessageToClient(ws, { type: 'ERROR', payload: { message: 'Player name and Room ID required.' } });
                const room = rooms[roomId];
                if (!room || !room.admin || !room.admin.ws || room.admin.ws.readyState !== WebSocket.OPEN) {
                    return sendMessageToClient(ws, { type: 'ERROR', payload: { message: 'Room not found or not ready.' } });
                }
                if (room.gameStatus === 'stopped') return sendMessageToClient(ws, { type: 'ERROR', payload: { message: 'Game has ended.' } });

                const playerId = generateUniqueId();
                const player = { id: playerId, name: playerName, ws, tickets: [{ id: generateUniqueId(), numbers: generateTambolaTicket(), marked: [] }], coins: 0 };
                room.players.push(player);
                playerConnections.set(ws, { roomId, playerId, type: 'player' });

                sendMessageToClient(ws, { 
                    type: 'PLAYER_JOIN_SUCCESS', 
                    payload: { 
                        playerId, playerName, roomId, tickets: player.tickets, gameStatus: room.gameStatus,
                        calledNumbers: [...room.numbersCalled], // Send a copy
                        rules: room.rules.filter(r => r.isActive), 
                        totalMoneyCollected: room.totalMoneyCollected, 
                        adminName: room.admin.name, // Send adminName
                        playersInRoom: room.players.map(p => ({id: p.id, name: p.name, ticketCount: p.tickets.length}))
                    } 
                });
                // Broadcast updated player list to everyone in the room (including admin and other players)
                broadcastToRoom(roomId, { type: 'PLAYER_LIST_UPDATE', payload: { players: room.players.map(p => ({id: p.id, name: p.name, ticketCount: p.tickets.length})) } });
                console.log(`Player ${playerName} (ID: ${playerId}) joined room ${roomId}`);
                break;
            }

            case 'PLAYER_REQUEST_TICKET': {
                if (!connectionInfo || connectionInfo.type !== 'player') return;
                const room = rooms[connectionInfo.roomId];
                const player = room?.players.find(p => p.id === connectionInfo.playerId);
                if (room && player) {
                    if (player.tickets.length >= 5) return sendMessageToClient(ws, { type: 'ERROR', payload: { message: 'Max 5 tickets.' }});
                    if (room.admin && room.admin.ws && room.admin.ws.readyState === WebSocket.OPEN) {
                        sendMessageToClient(room.admin.ws, { type: 'ADMIN_TICKET_REQUEST_RECEIVED', payload: { playerId: player.id, playerName: player.name, currentTickets: player.tickets.length, timestamp: Date.now() } });
                        sendMessageToClient(ws, { type: 'PLAYER_TICKET_REQUEST_SENT' });
                    } else sendMessageToClient(ws, { type: 'ERROR', payload: { message: 'Admin not available.' }});
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

                if (!room || !player || !ruleToClaim || !ticketForClaim) return sendMessageToClient(ws, { type: 'ERROR', payload: { message: 'Invalid claim details.' } });
                if (room.gameStatus !== 'running') return sendMessageToClient(ws, {type: 'ERROR', payload: {message: 'Game not running.'}});
                
                const existingWinsForThisRuleByPlayer = room.winners.filter(w => w.playerId === player.id && w.prizeName === ruleToClaim.name).length;
                const maxAllowedWinsForRule = ruleToClaim.maxPrizes || 1;
                if (existingWinsForThisRuleByPlayer >= maxAllowedWinsForRule) {
                     return sendMessageToClient(ws, {type: 'ERROR', payload: {message: `You already won max times for '${ruleToClaim.name}'.`}});
                }
                
                const isValidClaim = validatePrizeClaim(ticketForClaim.numbers, room.numbersCalled, ruleToClaim.name);
                const claimId = generateUniqueId();

                if (room.admin && room.admin.ws && room.admin.ws.readyState === WebSocket.OPEN) {
                    sendMessageToClient(room.admin.ws, {
                        type: 'ADMIN_PRIZE_CLAIM_RECEIVED',
                        payload: { claimId, playerId: player.id, playerName: player.name, prizeName: ruleToClaim.name, prizeRuleId: ruleToClaim.id, ticketId: ticketForClaim.id, ticketNumbers: ticketForClaim.numbers, serverValidationResult: isValidClaim }
                    });
                    sendMessageToClient(ws, { type: 'PLAYER_CLAIM_SUBMITTED', payload: { claimId, prizeName: ruleToClaim.name, status: 'pending_admin_approval' } });
                } else sendMessageToClient(ws, { type: 'ERROR', payload: { message: 'Admin not available.' } });
                break;
            }
            
            case 'PLAYER_MARK_NUMBER': break; 

            default: sendMessageToClient(ws, { type: 'ERROR', payload: { message: `Unknown message type: ${type}` } });
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
                    room.admin.ws = null; 
                    broadcastToRoom(roomId, { type: 'ADMIN_DISCONNECTED', payload: { adminName: room.admin.name } });
                } else if (type === 'player') {
                    const playerIndex = room.players.findIndex(p => p.id === playerId);
                    if (playerIndex > -1) {
                        const playerName = room.players[playerIndex].name;
                        room.players.splice(playerIndex, 1);
                        broadcastToRoom(roomId, { type: 'PLAYER_LIST_UPDATE', payload: { players: room.players.map(p => ({id: p.id, name: p.name, ticketCount: p.tickets.length})) } });
                        console.log(`Player ${playerName} (ID: ${playerId}) disconnected from room ${roomId}`);
                    }
                }
                if (room.players.length === 0 && (!room.admin || !room.admin.ws)) {
                    console.log(`Room ${roomId} is empty and admin disconnected, cleaning up.`);
                    delete rooms[roomId];
                }
            }
            playerConnections.delete(ws);
        }
    });
    ws.on('error', (error) => { console.error('WebSocket error:', error); if (playerConnections.has(ws)) playerConnections.delete(ws); });
});

app.get('/', (req, res) => res.send('Tambola Game Backend is running!'));
app.get('/health', (req, res) => res.status(200).json({ status: 'UP', timestamp: new Date().toISOString() });
app.get('/debug/rooms', (req, res) => {
    const simplifiedRooms = {};
    for (const roomId in rooms) {
        simplifiedRooms[roomId] = {
            id: rooms[roomId].id, adminName: rooms[roomId].admin?.name,
            adminConnected: !!(rooms[roomId].admin?.ws && rooms[roomId].admin.ws.readyState === WebSocket.OPEN),
            playerCount: rooms[roomId].players.length, gameStatus: rooms[roomId].gameStatus,
            calledCount: rooms[roomId].numbersCalled.length, 
            rulesActiveCount: rooms[roomId].rules?.filter(r => r.isActive).length || 0,
            totalMoney: rooms[roomId].totalMoneyCollected,
            winnersCount: rooms[roomId].winners?.length || 0
        };
    }
    res.json(simplifiedRooms);
});

server.listen(PORT, () => { console.log(`HTTP and WebSocket server listening on ws://localhost:${PORT}`); });
process.on('SIGINT', () => { console.log('Shutting down...'); wss.clients.forEach(c => c.close()); server.close(() => { console.log('Server shut down.'); rooms = {}; playerConnections.clear(); process.exit(0); }); });
