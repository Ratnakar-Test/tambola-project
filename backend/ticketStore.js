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
        this.originalTicketPool = []; // Keep a copy for potential reset/reuse
        try {
            const fullPath = path.resolve(__dirname, ticketsFilePath);
            const fileContent = fs.readFileSync(fullPath, 'utf-8');
            this.ticketPool = JSON.parse(fileContent);
            // Ensure it's an array
            if (!Array.isArray(this.ticketPool)) {
                throw new Error("tickets.json content is not an array.");
            }
            // Deep clone for the original pool
            this.originalTicketPool = JSON.parse(JSON.stringify(this.ticketPool));
            console.log(`TicketStore: Successfully loaded ${this.ticketPool.length} tickets from ${ticketsFilePath}`);
        } catch (error) {
            console.error("Error loading tickets.json:", error.message);
            console.error("Please ensure 'tickets.json' exists at the specified path and contains a valid JSON array of ticket grids.");
            console.error("Expected path:", path.resolve(__dirname, ticketsFilePath));
            // Proceed with an empty pool if loading fails
            this.ticketPool = [];
            this.originalTicketPool = [];
        }
        this.rooms = {}; // In-memory rooms state: { roomId: { maxTicketsPerPlayer, calledNumbers: Set, playerTickets: { playerName: [{id, grid}] } } }
    }

    /**
     * Create or re-initialize a game room.
     * @param {string} roomId
     * @param {number} maxTicketsPerPlayer
     */
    createRoom(roomId, maxTicketsPerPlayer) {
        if (this.rooms[roomId]) {
            console.warn(`TicketStore: Re-initializing existing room ${roomId}.`);
        }
        this.rooms[roomId] = {
            maxTicketsPerPlayer: parseInt(maxTicketsPerPlayer, 10) || 3,
            calledNumbers: new Set(),
            playerTickets: {},
        };
        console.log(`TicketStore: Room ${roomId} created/initialized with max ${this.rooms[roomId].maxTicketsPerPlayer} tickets per player.`);
    }

    /**
     * Reset a room for a new game (clears called numbers and player tickets).
     * @param {string} roomId
     */
    resetRoomForNewGame(roomId) {
        const room = this.rooms[roomId];
        if (!room) {
            console.warn(`TicketStore: Attempted to reset non-existent room ${roomId}`);
            return;
        }
        room.calledNumbers.clear();
        room.playerTickets = {};
        // Optional: Reset the global pool if tickets shouldn't be reused across games *ever*
        // this.ticketPool = JSON.parse(JSON.stringify(this.originalTicketPool));
        console.log(`TicketStore: Room ${roomId} reset for a new game.`);
    }

    /** Check if a room exists. */
    roomExists(roomId) {
        return !!this.rooms[roomId];
    }

    /**
     * Records a drawn number for the room. Called by server.js after drawing.
     * @param {string} roomId
     * @param {number} number - The number that was drawn.
     */
    recordCalledNumber(roomId, number) {
        const room = this.rooms[roomId];
        if (room) {
            room.calledNumbers.add(number);
        } else {
             console.warn(`TicketStore: Tried to record number for non-existent room ${roomId}`);
        }
    }

    /**
     * Get the Set of numbers already called in a room.
     * @param {string} roomId
     * @returns {Set<number>}
     */
    getCalledNumbersSet(roomId) {
        const room = this.rooms[roomId];
        return room ? room.calledNumbers : new Set();
    }

     /**
     * Get the sorted Array of numbers already called in a room.
     * @param {string} roomId
     * @returns {number[]}
     */
    getCalledNumbersArray(roomId) {
        const room = this.rooms[roomId];
        if (!room) return [];
        return Array.from(room.calledNumbers).sort((a, b) => a - b);
    }


    /**
     * Generates a specified number of unique tickets for a player in a room from the pool.
     * @param {string} roomId
     * @param {string} playerName
     * @param {number} numberOfTicketsToGenerate
     * @returns {{success: boolean, tickets?: Array<{id: string, grid: TicketGrid}>, error?: string}}
     */
    generateTicketsForPlayer(roomId, playerName, numberOfTicketsToGenerate = 1) {
        const room = this.rooms[roomId];
        if (!room) return { success: false, error: `TicketStore: Room ${roomId} not found.` };

        if (!room.playerTickets[playerName]) {
            room.playerTickets[playerName] = [];
        }

        const currentTicketCount = room.playerTickets[playerName].length;
        if (currentTicketCount >= room.maxTicketsPerPlayer) {
             return { success: false, error: `Ticket limit (${room.maxTicketsPerPlayer}) already reached.` };
        }
        
        const ticketsNeeded = Math.min(numberOfTicketsToGenerate, room.maxTicketsPerPlayer - currentTicketCount);

        if (this.ticketPool.length < ticketsNeeded) {
            console.warn(`TicketStore: Ticket pool running low! Only ${this.ticketPool.length} left.`);
            if (this.ticketPool.length === 0) {
                return { success: false, error: 'No more tickets available in the pool.' };
            }
            // Adjust needed tickets if pool is low but not empty
             ticketsNeeded = this.ticketPool.length;
        }

        const newTickets = [];
        for (let i = 0; i < ticketsNeeded; i++) {
            const ticketGrid = this.ticketPool.shift(); // Get from global pool
            if (!ticketGrid) { // Safeguard
                this.ticketPool.unshift(...newTickets.map(t => t.grid)); // Rollback partial assignment
                return { success: false, error: 'Ticket pool unexpectedly exhausted.' };
            }
            const newTicket = {
                id: `TKT-${roomId.slice(0,2)}-${playerName.slice(0,3)}-${uuidv4().slice(0,4)}`, // Unique ID
                grid: JSON.parse(JSON.stringify(ticketGrid)) // Deep clone
            };
            newTickets.push(newTicket);
        }

        room.playerTickets[playerName].push(...newTickets);
        console.log(`TicketStore: Assigned ${newTickets.length} ticket(s) to ${playerName} in room ${roomId}.`);
        // Return only the grids for the client
        return { success: true, tickets: newTickets.map(t => t.grid) };
    }

    /**
     * Get a copy of a player’s ticket grids for a given room.
     * @param {string} roomId
     * @param {string} playerName
     * @returns {Array<TicketGrid>}
     */
    getPlayerTicketGrids(roomId, playerName) {
        const room = this.rooms[roomId];
        if (!room || !room.playerTickets[playerName]) {
            return [];
        }
        // Return deep copies to prevent accidental modification
        return JSON.parse(JSON.stringify(room.playerTickets[playerName].map(ticket => ticket.grid)));
    }


    /**
     * Validates a claim for a player based on their tickets and called numbers.
     * @param {string} roomId
     * @param {string} playerName
     * @param {string} claimType - e.g., 'Top Line', 'Full House'
     * @returns {{isValid: boolean, message: string, validatedTicketGrid?: TicketGrid, validatedNumbers?: number[]}}
     */
    isValidClaim(roomId, playerName, claimType) {
        const room = this.rooms[roomId];
        if (!room) return { isValid: false, message: `TicketStore: Room ${roomId} not found.` };

        const playerTicketObjects = room.playerTickets[playerName]; // Array of {id, grid}
        if (!playerTicketObjects || playerTicketObjects.length === 0) {
            return { isValid: false, message: 'Player has no tickets in this room.' };
        }

        const calledNumbersSet = room.calledNumbers; // Use the Set for efficient lookup

        for (const ticketObj of playerTicketObjects) {
            const ticketGrid = ticketObj.grid;
            let claimNumbers = [];
            let validForThisTicket = false;

            try { // Add try-catch for safety during validation logic
                switch (claimType) {
                    case 'Top Line': {
                        const lineNumbers = ticketGrid[0].filter(num => num !== null);
                        if (lineNumbers.length > 0 && lineNumbers.every(num => calledNumbersSet.has(num))) {
                            validForThisTicket = true; claimNumbers = lineNumbers;
                        }
                        break;
                    }
                    case 'Middle Line': {
                        const lineNumbers = ticketGrid[1].filter(num => num !== null);
                        if (lineNumbers.length > 0 && lineNumbers.every(num => calledNumbersSet.has(num))) {
                            validForThisTicket = true; claimNumbers = lineNumbers;
                        }
                        break;
                    }
                    case 'Bottom Line': {
                        const lineNumbers = ticketGrid[2].filter(num => num !== null);
                        if (lineNumbers.length > 0 && lineNumbers.every(num => calledNumbersSet.has(num))) {
                            validForThisTicket = true; claimNumbers = lineNumbers;
                        }
                        break;
                    }
                    case 'Four Corners': {
                        const corners = [];
                        // Find first non-null in row 0
                        for(let i=0; i<9; i++) if(ticketGrid[0][i] !== null) { corners.push(ticketGrid[0][i]); break; }
                        // Find last non-null in row 0
                        for(let i=8; i>=0; i--) if(ticketGrid[0][i] !== null) { corners.push(ticketGrid[0][i]); break; }
                        // Find first non-null in row 2
                        for(let i=0; i<9; i++) if(ticketGrid[2][i] !== null) { corners.push(ticketGrid[2][i]); break; }
                         // Find last non-null in row 2
                        for(let i=8; i>=0; i--) if(ticketGrid[2][i] !== null) { corners.push(ticketGrid[2][i]); break; }

                        const uniqueCorners = [...new Set(corners)]; // Handle cases where corners might be same number if ticket is sparse
                        // Standard tickets should yield 4 unique corners
                        if (uniqueCorners.length === 4 && uniqueCorners.every(num => calledNumbersSet.has(num))) {
                            validForThisTicket = true; claimNumbers = uniqueCorners;
                        }
                        break;
                    }
                    case 'Early Five': {
                        const ticketNumbers = ticketGrid.flat().filter(num => num !== null);
                        const matchedNumbers = ticketNumbers.filter(num => calledNumbersSet.has(num));
                        if (matchedNumbers.length >= 5) {
                            validForThisTicket = true;
                            claimNumbers = matchedNumbers.slice(0, 5); // Report the first 5 matched
                        }
                        break;
                    }
                    case 'Full House': {
                        const ticketNumbers = ticketGrid.flat().filter(num => num !== null);
                        // Check if all numbers on the ticket (usually 15) have been called
                        if (ticketNumbers.length === 15 && ticketNumbers.every(num => calledNumbersSet.has(num))) {
                           validForThisTicket = true; claimNumbers = ticketNumbers;
                        } else if (ticketNumbers.length !== 15) {
                             console.warn(`Full House claim attempted on ticket with ${ticketNumbers.length} numbers (expected 15). Player: ${playerName}, Room: ${roomId}`);
                             // Optionally allow if all numbers are called, regardless of count, but log it.
                             if (ticketNumbers.length > 0 && ticketNumbers.every(num => calledNumbersSet.has(num))) {
                                validForThisTicket = true; claimNumbers = ticketNumbers;
                             }
                        }
                        break;
                    }
                    default:
                        console.warn(`TicketStore: Unknown claim type received: ${claimType}`);
                        // Return invalid immediately if type is unknown
                        return { isValid: false, message: `Unknown claim type: ${claimType}` };
                } // End switch
            } catch (validationError) {
                 console.error(`Error validating claim type ${claimType} for player ${playerName} in room ${roomId}:`, validationError);
                 return { isValid: false, message: `Internal error during validation for ${claimType}.` };
            }

            if (validForThisTicket) {
                console.log(`TicketStore: Claim validated for ${playerName} (${claimType}) in room ${roomId}.`);
                return {
                    isValid: true,
                    message: `${claimType} validated successfully.`,
                    validatedTicketGrid: ticketGrid,
                    validatedNumbers: claimNumbers
                };
            }
        } // End loop through player tickets

        // If loop finishes without finding a valid ticket
        return { isValid: false, message: `No ticket qualifies for ${claimType} with the numbers called so far.` };
    }
}

module.exports = TicketStore;
