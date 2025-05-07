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
        try {
            const fullPath = path.resolve(__dirname, ticketsFilePath);
            this.ticketPool = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
            this.originalTicketPool = JSON.parse(JSON.stringify(this.ticketPool)); // For resetting if needed for multiple full game cycles
        } catch (error) {
            console.error("Error loading tickets.json:", error.message);
            console.error("Make sure 'tickets.json' exists at the specified path and is valid JSON.");
            console.error("Expected path:", path.resolve(__dirname, ticketsFilePath));
            this.ticketPool = []; // Default to empty pool on error
            this.originalTicketPool = [];
        }
        this.rooms = {}; // In-memory rooms state
    }

    /**
     * Create a new game room with initial settings.
     * @param {string} roomId
     * @param {number} maxTicketsPerPlayer
     */
    createRoom(roomId, maxTicketsPerPlayer) {
        if (this.rooms[roomId]) {
            // If room exists, potentially reset it or handle as an error/re-init
            console.warn(`Room ${roomId} already exists. Re-initializing.`);
        }
        this.rooms[roomId] = {
            maxTicketsPerPlayer: parseInt(maxTicketsPerPlayer, 10) || 3,
            calledNumbers: new Set(),      // Numbers drawn so far in this room
            playerTickets: {},             // { playerName: [{id: string, grid: TicketGrid}, ...] }
            // ticketRequests are managed by server.js primarily for socket mapping
            // claims are managed by server.js primarily for socket mapping and admin verification flow
        };
        console.log(`TicketStore: Room ${roomId} created/initialized.`);
    }

    /**
     * Reset a room for a new game (clears called numbers and player tickets).
     * @param {string} roomId
     */
    resetRoomForNewGame(roomId) {
        const room = this.rooms[roomId];
        if (!room) {
            console.warn(`TicketStore: Attempted to reset non-existent room ${roomId}`);
            // Optionally create it if that's desired behavior: this.createRoom(roomId, 3); // default max tickets
            return;
        }
        room.calledNumbers.clear();
        room.playerTickets = {}; // Clear all player tickets for the new game in this room
        // Reset the available ticket pool for this game session if tickets are unique per game
        // For now, we assume the global pool is drawn from. If tickets should be "fresh" per game,
        // a more complex pool management per room or cloning from originalTicketPool would be needed.
        console.log(`TicketStore: Room ${roomId} reset for a new game.`);
    }

    /**
     * Check if a room exists.
     * @param {string} roomId
     * @returns {boolean}
     */
    roomExists(roomId) {
        return !!this.rooms[roomId];
    }

    /**
     * Draw a random number (1–90) that hasn't been called yet for the specific room.
     * @param {string} roomId
     * @param {Array<number>} currentAvailableNumbers - Pass the room's available numbers from server.js
     * @returns {{number: number, calledNumbers: number[]}|null}
     */
    drawNumber(roomId, currentAvailableNumbers) {
        const room = this.rooms[roomId];
        if (!room) throw new Error(`TicketStore: Room ${roomId} not found for drawing number.`);
        
        if (currentAvailableNumbers.length === 0) return null; // All numbers drawn

        const randomIndex = Math.floor(Math.random() * currentAvailableNumbers.length);
        const number = currentAvailableNumbers.splice(randomIndex, 1)[0]; // Modifies the passed array
        
        room.calledNumbers.add(number); // Track in TicketStore as well for validation consistency
        
        return {
            number,
            calledNumbers: Array.from(room.calledNumbers).sort((a, b) => a - b)
        };
    }
    
    /**
     * Generates a specified number of unique tickets for a player in a room.
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
        if (currentTicketCount + numberOfTicketsToGenerate > room.maxTicketsPerPlayer) {
            return { success: false, error: `Cannot assign ${numberOfTicketsToGenerate} tickets. Player already has ${currentTicketCount}/${room.maxTicketsPerPlayer} tickets.` };
        }

        if (this.ticketPool.length < numberOfTicketsToGenerate) {
            return { success: false, error: 'Not enough tickets available in the global pool.' };
        }

        const newTickets = [];
        for (let i = 0; i < numberOfTicketsToGenerate; i++) {
            const ticketGrid = this.ticketPool.shift(); // Get from global pool
            if (!ticketGrid) { // Should be caught by previous check, but as a safeguard
                this.ticketPool.unshift(...newTickets.map(t => t.grid)); // Rollback if partial assignment failed
                return { success: false, error: 'Ticket pool unexpectedly exhausted during assignment.' };
            }
            const newTicket = {
                id: `TICKET-${roomId}-${playerName}-${uuidv4().slice(0,4)}`, // Unique ID for the ticket instance
                grid: JSON.parse(JSON.stringify(ticketGrid)) // Deep clone the ticket grid
            };
            newTickets.push(newTicket);
        }

        room.playerTickets[playerName].push(...newTickets);
        return { success: true, tickets: newTickets.map(t => t.grid) }; // Return only the grids for client
    }


    /**
     * Get a copy of a player’s tickets for a given room.
     * Returns only the grids.
     * @param {string} roomId
     * @param {string} playerName
     * @returns {Array<TicketGrid>}
     */
    getPlayerTicketGrids(roomId, playerName) {
        const room = this.rooms[roomId];
        if (!room || !room.playerTickets[playerName]) {
            return [];
        }
        return room.playerTickets[playerName].map(ticket => ticket.grid);
    }

    /**
     * Get the list of numbers already called in a room.
     * @param {string} roomId
     * @returns {number[]}
     */
    getCalledNumbers(roomId) {
        const room = this.rooms[roomId];
        if (!room) return [];
        return Array.from(room.calledNumbers).sort((a, b) => a - b);
    }

    /**
     * Validates a claim for a player.
     * @param {string} roomId
     * @param {string} playerName
     * @param {string} claimType - e.g., 'Top Line', 'Full House'
     * @param {Set<number>} allCalledNumbersInRoom - A Set of all numbers called in the room.
     * @returns {{isValid: boolean, message: string, validatedTicketGrid?: TicketGrid, validatedNumbers?: number[]}}
     */
    isValidClaim(roomId, playerName, claimType, allCalledNumbersInRoom) {
        const room = this.rooms[roomId];
        if (!room) return { isValid: false, message: `TicketStore: Room ${roomId} not found.` };
        
        const playerTicketObjects = room.playerTickets[playerName]; // These are {id, grid}
        if (!playerTicketObjects || playerTicketObjects.length === 0) {
            return { isValid: false, message: 'Player has no tickets in this room.' };
        }

        for (const ticketObj of playerTicketObjects) {
            const ticketGrid = ticketObj.grid;
            let claimNumbers = []; // Numbers that satisfy the claim on this ticket
            let validForThisTicket = false;

            switch (claimType) {
                case 'Top Line': {
                    const topLineNumbers = ticketGrid[0].filter(num => num !== null);
                    if (topLineNumbers.length > 0 && topLineNumbers.every(num => allCalledNumbersInRoom.has(num))) {
                        validForThisTicket = true;
                        claimNumbers = topLineNumbers;
                    }
                    break;
                }
                case 'Middle Line': {
                    const middleLineNumbers = ticketGrid[1].filter(num => num !== null);
                     if (middleLineNumbers.length > 0 && middleLineNumbers.every(num => allCalledNumbersInRoom.has(num))) {
                        validForThisTicket = true;
                        claimNumbers = middleLineNumbers;
                    }
                    break;
                }
                case 'Bottom Line': {
                    const bottomLineNumbers = ticketGrid[2].filter(num => num !== null);
                    if (bottomLineNumbers.length > 0 && bottomLineNumbers.every(num => allCalledNumbersInRoom.has(num))) {
                        validForThisTicket = true;
                        claimNumbers = bottomLineNumbers;
                    }
                    break;
                }
                case 'Four Corners': {
                    const corners = [];
                    // Top-left: first non-null in first row
                    for (let i = 0; i < ticketGrid[0].length; i++) if (ticketGrid[0][i] !== null) { corners.push(ticketGrid[0][i]); break; }
                    // Top-right: last non-null in first row
                    for (let i = ticketGrid[0].length - 1; i >= 0; i--) if (ticketGrid[0][i] !== null) { corners.push(ticketGrid[0][i]); break; }
                    // Bottom-left: first non-null in last row
                    for (let i = 0; i < ticketGrid[2].length; i++) if (ticketGrid[2][i] !== null) { corners.push(ticketGrid[2][i]); break; }
                    // Bottom-right: last non-null in last row
                    for (let i = ticketGrid[2].length - 1; i >= 0; i--) if (ticketGrid[2][i] !== null) { corners.push(ticketGrid[2][i]); break; }
                    
                    // Ensure 4 unique corners were found (some tickets might have less if rows are sparse at ends)
                    const uniqueCorners = [...new Set(corners)];
                    if (uniqueCorners.length === 4 && uniqueCorners.every(num => allCalledNumbersInRoom.has(num))) {
                        validForThisTicket = true;
                        claimNumbers = uniqueCorners;
                    }
                    break;
                }
                case 'Early Five': {
                    const ticketNumbers = ticketGrid.flat().filter(num => num !== null);
                    const matchedNumbers = ticketNumbers.filter(num => allCalledNumbersInRoom.has(num));
                    if (matchedNumbers.length >= 5) {
                        validForThisTicket = true;
                        claimNumbers = matchedNumbers.slice(0, 5); // Report the first 5 matched
                    }
                    break;
                }
                case 'Full House': {
                    const ticketNumbers = ticketGrid.flat().filter(num => num !== null);
                    if (ticketNumbers.length > 0 && ticketNumbers.every(num => allCalledNumbersInRoom.has(num))) {
                        // Ensure there are typically 15 numbers for a full house
                        if (ticketNumbers.length === 15) {
                           validForThisTicket = true;
                           claimNumbers = ticketNumbers;
                        } else {
                            // This case should ideally not happen with standard Tambola tickets
                            console.warn(`Full House claim on ticket with ${ticketNumbers.length} numbers.`);
                        }
                    }
                    break;
                }
                default:
                    return { isValid: false, message: `Unknown claim type: ${claimType}` };
            }

            if (validForThisTicket) {
                return { 
                    isValid: true, 
                    message: `${claimType} validated successfully.`,
                    validatedTicketGrid: ticketGrid, // The grid of the ticket that won
                    validatedNumbers: claimNumbers   // The specific numbers that made the claim valid
                };
            }
        }
        return { isValid: false, message: `No ticket qualifies for ${claimType} with the called numbers.` };
    }

    // Methods like submitClaim and verifyClaim from the user's original ticketStore.js
    // are removed here as server.js will manage the authoritative pending claim queue and winner list.
    // TicketStore's role is primarily ticket provision and validation.
}

module.exports = TicketStore;
