// Folder: tambola-project/backend
// File: ticketStore.js

// ========== Imports ==========
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// ========== TicketStore Class ==========
class TicketStore {
    /**
     * Initialize TicketStore with a pool of tickets loaded from JSON.
     * @param {string} ticketsFilePath - Path to tickets.json (relative to this file's directory)
     */
    constructor(ticketsFilePath) {
        this.ticketPool = [];
        this.originalTicketPool = [];
        try {
            const fullPath = path.resolve(__dirname, ticketsFilePath);
            const fileContent = fs.readFileSync(fullPath, 'utf-8');
            const parsedTickets = JSON.parse(fileContent);

            if (!Array.isArray(parsedTickets)) {
                throw new Error("tickets.json content is not an array.");
            }
            // Basic validation of ticket structure (optional but recommended)
            if (parsedTickets.length > 0) {
                 if (!Array.isArray(parsedTickets[0]) || parsedTickets[0].length !== 3 || !Array.isArray(parsedTickets[0][0]) || parsedTickets[0][0].length !== 9) {
                     throw new Error("Invalid ticket structure in tickets.json. Expected array of 3x9 grids.");
                 }
            }

            this.ticketPool = parsedTickets;
            this.originalTicketPool = JSON.parse(JSON.stringify(this.ticketPool)); // Deep clone
            console.log(`TicketStore: Successfully loaded ${this.ticketPool.length} tickets from ${ticketsFilePath}`);
        } catch (error) {
            console.error("FATAL ERROR loading tickets.json:", error.message);
            console.error("Please ensure 'tickets.json' exists at the specified path and contains a valid JSON array of 3x9 ticket grids.");
            console.error("Expected path:", path.resolve(__dirname, ticketsFilePath));
            // Throw error to prevent server starting without tickets? Or proceed carefully?
            // For now, proceed with empty pool, but log severity.
            this.ticketPool = [];
            this.originalTicketPool = [];
            console.error("TicketStore initialized with an EMPTY ticket pool due to loading error.");
        }
        this.rooms = {}; // In-memory rooms state
    }

    /** Create or re-initialize a game room. */
    createRoom(roomId, maxTicketsPerPlayer) {
        if (this.rooms[roomId]) {
            console.warn(`TicketStore: Re-initializing existing room ${roomId}.`);
        }
        this.rooms[roomId] = {
            maxTicketsPerPlayer: parseInt(maxTicketsPerPlayer, 10) || 3,
            calledNumbers: new Set(),
            playerTickets: {}, // { playerName: [{id: string, grid: TicketGrid}, ...] }
        };
        console.log(`TicketStore: Room ${roomId} created/initialized.`);
    }

    /** Reset a room for a new game. */
    resetRoomForNewGame(roomId) {
        const room = this.rooms[roomId];
        if (!room) {
            console.warn(`TicketStore: Attempted to reset non-existent room ${roomId}`);
            return;
        }
        room.calledNumbers.clear();
        room.playerTickets = {};
        // Optional: Replenish the global pool if tickets are consumed permanently
        // if (this.ticketPool.length < this.originalTicketPool.length / 2) { // Example threshold
        //    console.log("TicketStore: Replenishing global ticket pool.");
        //    this.ticketPool = JSON.parse(JSON.stringify(this.originalTicketPool));
        // }
        console.log(`TicketStore: Room ${roomId} reset for a new game.`);
    }

    /** Check if a room exists. */
    roomExists(roomId) {
        return !!this.rooms[roomId];
    }

    /** Records a drawn number for the room. */
    recordCalledNumber(roomId, number) {
        const room = this.rooms[roomId];
        if (room) {
            room.calledNumbers.add(number);
        } else {
             console.warn(`TicketStore: Tried to record number for non-existent room ${roomId}`);
        }
    }

    /** Get the Set of called numbers. */
    getCalledNumbersSet(roomId) {
        const room = this.rooms[roomId];
        return room ? room.calledNumbers : new Set();
    }

     /** Get the sorted Array of called numbers. */
    getCalledNumbersArray(roomId) {
        const room = this.rooms[roomId];
        if (!room) return [];
        return Array.from(room.calledNumbers).sort((a, b) => a - b);
    }

    /** Generates tickets for a player. */
    generateTicketsForPlayer(roomId, playerName, numberOfTicketsToGenerate = 1) {
        const room = this.rooms[roomId];
        // Validate inputs
        if (!room) return { success: false, error: `TicketStore Error: Room ${roomId} not found.` };
        if (!playerName) return { success: false, error: `TicketStore Error: Player name is required.` };
        if (numberOfTicketsToGenerate <= 0) return { success: false, error: `TicketStore Error: Invalid number of tickets requested.` };


        if (!room.playerTickets[playerName]) {
            room.playerTickets[playerName] = [];
        }

        const currentTicketCount = room.playerTickets[playerName].length;
        const maxTickets = room.maxTicketsPerPlayer;

        if (currentTicketCount >= maxTickets) {
             return { success: false, error: `Ticket limit (${maxTickets}) already reached.` };
        }

        const ticketsNeeded = Math.min(numberOfTicketsToGenerate, maxTickets - currentTicketCount);

        if (this.ticketPool.length < ticketsNeeded) {
            console.warn(`TicketStore: Ticket pool running low! Only ${this.ticketPool.length} left. Needed ${ticketsNeeded}.`);
            if (this.ticketPool.length === 0) {
                return { success: false, error: 'No more tickets available in the pool.' };
            }
            // Adjust needed tickets if pool is low but not empty
             ticketsNeeded = this.ticketPool.length; // Assign remaining tickets
             console.warn(`TicketStore: Assigning only ${ticketsNeeded} remaining tickets.`);
        }

        const newTickets = [];
        try {
            for (let i = 0; i < ticketsNeeded; i++) {
                // Dequeue carefully
                const ticketGrid = this.ticketPool.shift();
                if (!ticketGrid) { // Should not happen if length check is correct, but safeguard
                    console.error(`TicketStore CRITICAL: Ticket pool shift returned undefined despite length check! Pool length: ${this.ticketPool.length}, Needed: ${ticketsNeeded}, i: ${i}`);
                    // Rollback any tickets already shifted in this loop
                    this.ticketPool.unshift(...newTickets.map(t => t.grid));
                    return { success: false, error: 'Internal error: Ticket pool inconsistency.' };
                }
                const newTicket = {
                    id: `TKT-${roomId.slice(0,2)}-${playerName.slice(0,3)}-${uuidv4().slice(0,4)}`,
                    grid: JSON.parse(JSON.stringify(ticketGrid)) // Deep clone
                };
                newTickets.push(newTicket);
            }
        } catch (cloneError) {
             console.error("TicketStore Error cloning ticket grid:", cloneError);
             // Rollback any tickets already shifted
             this.ticketPool.unshift(...newTickets.map(t => t.grid));
             return { success: false, error: 'Internal error: Failed to process ticket data.' };
        }


        room.playerTickets[playerName].push(...newTickets);
        console.log(`TicketStore: Assigned ${newTickets.length} ticket(s) to ${playerName} in room ${roomId}. Total: ${room.playerTickets[playerName].length}`);
        // Return only the grids for the client
        return { success: true, tickets: newTickets.map(t => t.grid) };
    }

    /** Get a player’s ticket grids. */
    getPlayerTicketGrids(roomId, playerName) {
        const room = this.rooms[roomId];
        if (!room || !room.playerTickets[playerName]) {
            return [];
        }
        try {
            // Return deep copies
            return JSON.parse(JSON.stringify(room.playerTickets[playerName].map(ticket => ticket.grid)));
        } catch (e) {
            console.error(`TicketStore Error getting/cloning tickets for ${playerName} in ${roomId}:`, e);
            return []; // Return empty on error
        }
    }

    /** Validates a claim for a player. */
    isValidClaim(roomId, playerName, claimType) {
        const room = this.rooms[roomId];
        if (!room) return { isValid: false, message: `Validation Error: Room ${roomId} not found.` };

        const playerTicketObjects = room.playerTickets[playerName];
        if (!playerTicketObjects || playerTicketObjects.length === 0) {
            return { isValid: false, message: 'Validation Error: Player has no tickets.' };
        }

        const calledNumbersSet = room.calledNumbers;
        if (calledNumbersSet.size === 0 && claimType !== 'Early Five') { // Allow Early Five even if 0 numbers called (though unlikely valid)
             return { isValid: false, message: 'Validation Error: No numbers have been called yet.' };
        }

        console.log(`Validating claim: Room ${roomId}, Player ${playerName}, Type ${claimType}, Called# ${calledNumbersSet.size}`); // Log validation attempt

        for (const ticketObj of playerTicketObjects) {
            const ticketGrid = ticketObj.grid;
            if (!Array.isArray(ticketGrid) || ticketGrid.length !== 3 || !Array.isArray(ticketGrid[0]) || ticketGrid[0].length !== 9) {
                console.error(`TicketStore: Invalid ticket grid structure found for player ${playerName}, ticket ID ${ticketObj.id}`);
                continue; // Skip invalid ticket structure
            }

            let claimNumbers = [];
            let validForThisTicket = false;

            try {
                switch (claimType) {
                    case 'Top Line':
                        const top = ticketGrid[0].filter(n => n !== null);
                        if (top.length > 0 && top.every(n => calledNumbersSet.has(n))) { validForThisTicket = true; claimNumbers = top; }
                        break;
                    case 'Middle Line':
                        const middle = ticketGrid[1].filter(n => n !== null);
                        if (middle.length > 0 && middle.every(n => calledNumbersSet.has(n))) { validForThisTicket = true; claimNumbers = middle; }
                        break;
                    case 'Bottom Line':
                        const bottom = ticketGrid[2].filter(n => n !== null);
                        if (bottom.length > 0 && bottom.every(n => calledNumbersSet.has(n))) { validForThisTicket = true; claimNumbers = bottom; }
                        break;
                    case 'Four Corners':
                        const corners = [];
                        for(let i=0; i<9; i++) if(ticketGrid[0][i] !== null) { corners.push(ticketGrid[0][i]); break; }
                        for(let i=8; i>=0; i--) if(ticketGrid[0][i] !== null) { corners.push(ticketGrid[0][i]); break; }
                        for(let i=0; i<9; i++) if(ticketGrid[2][i] !== null) { corners.push(ticketGrid[2][i]); break; }
                        for(let i=8; i>=0; i--) if(ticketGrid[2][i] !== null) { corners.push(ticketGrid[2][i]); break; }
                        const uniqueCorners = [...new Set(corners)];
                        if (uniqueCorners.length === 4 && uniqueCorners.every(n => calledNumbersSet.has(n))) { validForThisTicket = true; claimNumbers = uniqueCorners; }
                        break;
                    case 'Early Five':
                        const allNums = ticketGrid.flat().filter(n => n !== null);
                        const matched = allNums.filter(n => calledNumbersSet.has(n));
                        if (matched.length >= 5) { validForThisTicket = true; claimNumbers = matched.slice(0, 5); }
                        break;
                    case 'Full House':
                        const fhNums = ticketGrid.flat().filter(n => n !== null);
                        if (fhNums.length === 15 && fhNums.every(n => calledNumbersSet.has(n))) { validForThisTicket = true; claimNumbers = fhNums; }
                        else if (fhNums.length !== 15 && fhNums.length > 0 && fhNums.every(n => calledNumbersSet.has(n))) {
                             console.warn(`Full House claim validated on ticket with ${fhNums.length} numbers (expected 15). Player: ${playerName}, Room: ${roomId}`);
                             validForThisTicket = true; claimNumbers = fhNums; // Allow non-standard FH if all present are called
                        }
                        break;
                    default:
                        console.warn(`TicketStore: Unknown claim type during validation: ${claimType}`);
                        return { isValid: false, message: `Unknown claim type: ${claimType}` };
                } // End switch

                if (validForThisTicket) {
                    console.log(`TicketStore: Claim VALIDATED for ${playerName} (${claimType}) in room ${roomId}. Ticket ID: ${ticketObj.id}`);
                    return { isValid: true, message: `${claimType} validated.`, validatedTicketGrid: ticketGrid, validatedNumbers: claimNumbers };
                }
            } catch (validationError) {
                 console.error(`TicketStore Error validating claim type ${claimType} for player ${playerName} on ticket ${ticketObj.id}:`, validationError);
                 // Continue checking other tickets, don't stop validation for the player on one ticket error
            }
        } // End loop through player tickets

        // If loop finishes without finding a valid ticket
        console.log(`TicketStore: Claim INVALID for ${playerName} (${claimType}) in room ${roomId}. No qualifying ticket found.`);
        return { isValid: false, message: `No ticket qualifies for ${claimType} with the numbers called.` };
    }
}

module.exports = TicketStore;
