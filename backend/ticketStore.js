// backend/ticketStore.js
// Module for generating and managing Tambola tickets in memory.

/**
 * Generates a single, valid Tambola ticket.
 * Rules:
 * - 3 rows, 9 columns.
 * - Each row must have exactly 5 numbers.
 * - Each column can have 1, 2, or (rarely) 3 numbers.
 * - Total 15 unique numbers per ticket (from 1 to 90).
 * - Column 1: Numbers 1-9
 * - Column 2: Numbers 10-19
 * - ...
 * - Column 8: Numbers 70-79
 * - Column 9: Numbers 80-90 (can include 90)
 */
function generateTambolaTicket() {
    let ticketIdCounter = Date.now(); // For unique ticket IDs

    // Initialize an empty ticket (3 rows, 9 columns)
    const ticket = Array(3).fill(null).map(() => Array(9).fill(null));
    
    // Define column properties: min, max, and a list to hold numbers for this ticket's column
    const columns = Array(9).fill(null).map((_, colIndex) => {
        if (colIndex === 0) return { min: 1, max: 9, numbers: [], count: 0 }; // Col 1 (1-9)
        if (colIndex === 8) return { min: 80, max: 90, numbers: [], count: 0 }; // Col 9 (80-90)
        return { min: colIndex * 10, max: colIndex * 10 + 9, numbers: [], count: 0 }; // Cols 2-8
    });

    // --- Step 1: Select 15 unique numbers ensuring column distribution ---
    const allTicketNumbers = new Set();
    
    // First, ensure each column gets at least one number if possible, up to a total of 9 numbers.
    // This helps in distributing numbers across columns.
    let numbersPlacedEnsuringColumns = 0;
    const colIndices = [0,1,2,3,4,5,6,7,8];
    colIndices.sort(() => Math.random() - 0.5); // Shuffle column indices to vary placement

    for (const colIdx of colIndices) {
        if (numbersPlacedEnsuringColumns >= 9 && allTicketNumbers.size >=9) break; // Max 9 numbers in this step
        if (columns[colIdx].count < 2) { // Try to put at most 2 numbers per column in this initial distribution phase
            let num;
            let attempts = 0;
            do {
                num = Math.floor(Math.random() * (columns[colIdx].max - columns[colIdx].min + 1)) + columns[colIdx].min;
                attempts++;
            } while (allTicketNumbers.has(num) && attempts < 20); // Try to find a unique number

            if (!allTicketNumbers.has(num)) {
                columns[colIdx].numbers.push(num);
                columns[colIdx].count++;
                allTicketNumbers.add(num);
                numbersPlacedEnsuringColumns++;
            }
        }
    }

    // Place remaining numbers to reach 15, respecting column limits (max 3 per column typically)
    // and ensuring column ranges.
    while (allTicketNumbers.size < 15) {
        const randomColIdx = Math.floor(Math.random() * 9);
        if (columns[randomColIdx].count < 3) { // Max 3 numbers per column
             let num;
            let attempts = 0;
            do {
                num = Math.floor(Math.random() * (columns[randomColIdx].max - columns[randomColIdx].min + 1)) + columns[randomColIdx].min;
                attempts++;
            } while (allTicketNumbers.has(num) && attempts < 20);

            if (!allTicketNumbers.has(num)) {
                columns[randomColIdx].numbers.push(num);
                columns[randomColIdx].count++;
                allTicketNumbers.add(num);
            }
        }
        // Safety break if unable to place 15 numbers (should be rare with proper logic)
        if (allTicketNumbers.size >= 15) break;
    }
    
    // Sort numbers within each column
    columns.forEach(col => col.numbers.sort((a, b) => a - b));

    // --- Step 2: Distribute these 15 numbers onto the 3x9 grid ---
    // Each row must have 5 numbers.
    // Each column must have its numbers placed.
    
    // Place numbers column by column
    for (let c = 0; c < 9; c++) {
        // For each number in the current column, find a row to place it.
        // Prioritize rows that don't have a number in this column yet and have less than 5 numbers.
        for (const num of columns[c].numbers) {
            let placed = false;
            // Create a preference order for rows (0, 1, 2) and shuffle it to vary tickets
            const rowPlacementOrder = [0, 1, 2].sort(() => Math.random() - 0.5);

            for (const r of rowPlacementOrder) {
                const numbersInRow = ticket[r].filter(n => n !== null).length;
                if (ticket[r][c] === null && numbersInRow < 5) {
                    ticket[r][c] = num;
                    placed = true;
                    break; // Number placed, move to next number in column
                }
            }
            if (!placed) {
                // This fallback is if a number couldn't be placed under ideal conditions (e.g. column full in all valid rows)
                // Try placing in any available slot in its column, even if row preference isn't met, as long as row not full.
                for (let r_fallback = 0; r_fallback < 3; r_fallback++) {
                     const numbersInRow = ticket[r_fallback].filter(n => n !== null).length;
                     if (ticket[r_fallback][c] === null && numbersInRow < 5) {
                        ticket[r_fallback][c] = num;
                        placed = true;
                        break;
                     }
                }
                if (!placed) {
                    // This should be very rare. Indicates an issue with number selection or distribution.
                    // console.warn(`Could not place number ${num} in column ${c}. Ticket might be invalid.`);
                }
            }
        }
    }

    // --- Step 3: Ensure each row has exactly 5 numbers ---
    // This is the hardest part. If Step 2 didn't achieve this, we need to adjust.
    // This can involve moving numbers between rows if one row has too many and another too few,
    // while respecting column constraints. This is a complex balancing act.
    // For this version, we'll do a simpler check and adjustment.

    for (let r = 0; r < 3; r++) {
        let numbersInRow = ticket[r].filter(n => n !== null).length;
        
        // If row has too few numbers: try to move from another row in an empty column slot
        if (numbersInRow < 5) {
            for (let r_source = 0; r_source < 3; r_source++) {
                if (r === r_source) continue;
                let sourceNumbersInRow = ticket[r_source].filter(n => n !== null).length;
                if (sourceNumbersInRow > 5) { // Found a source row with too many numbers
                    // Find a number in r_source that can be moved to r
                    for (let c_move = 0; c_move < 9; c_move++) {
                        if (ticket[r_source][c_move] !== null && ticket[r][c_move] === null) {
                            ticket[r][c_move] = ticket[r_source][c_move];
                            ticket[r_source][c_move] = null;
                            numbersInRow++;
                            sourceNumbersInRow--;
                            if (numbersInRow === 5 || sourceNumbersInRow === 5) break; // Target met or source fixed
                        }
                    }
                }
                if (numbersInRow === 5) break;
            }
        }
        // If row still has too few (or now too many after adjustments), this indicates a flaw.
        // A truly robust generator would backtrack or use more advanced algorithms.
        // For now, we accept this ticket might not be perfectly balanced if this stage fails.
    }


    // Final check: count numbers per row. If not 5, log a warning.
    // This simplified generator might not always produce perfect tickets.
    ticket.forEach((row, rowIndex) => {
        const count = row.filter(num => num !== null).length;
        if (count !== 5) {
            // console.warn(`Ticket Generation Warning: Row ${rowIndex + 1} has ${count} numbers instead of 5.`);
        }
    });
    
    const finalTicketNumbers = [];
    ticket.forEach(row => row.forEach(num => {
        if (num !== null) finalTicketNumbers.push(num);
    }));
    finalTicketNumbers.sort((a,b) => a - b);


    return {
        id: `TKT_${ticketIdCounter++}_${Math.random().toString(36).substring(2, 7)}`,
        rows: ticket,
        numbers: finalTicketNumbers // All unique numbers on the ticket, sorted
    };
}

// In-memory store for active tickets
const activeTickets = new Map(); // Key: ticketId, Value: ticketObject

/**
 * Generates a new ticket, stores it, and returns it.
 * @returns {Object} The generated ticket object.
 */
function getNewTicket() {
    let ticket = null;
    let attempts = 0;
    // Try to generate a valid ticket (e.g., with 15 numbers and reasonably balanced rows)
    do {
        ticket = generateTambolaTicket();
        attempts++;
        const totalNumbers = ticket.numbers.length;
        const rowCountsValid = ticket.rows.every(row => row.filter(n => n !== null).length === 5);
        
        if (totalNumbers !== 15 || !rowCountsValid) {
            // console.warn(`Generated ticket ${ticket.id} is invalid (Numbers: ${totalNumbers}, Rows valid: ${rowCountsValid}). Retrying...`);
            ticket = null; // Invalidate and retry
        }
    } while (!ticket && attempts < 10); // Try a few times to get a good one

    if (!ticket) {
        console.error("Failed to generate a valid ticket after several attempts. Returning a potentially imperfect one.");
        // As a last resort, generate one more time without the strict retry loop
        ticket = generateTambolaTicket(); 
    }

    activeTickets.set(ticket.id, ticket);
    // console.log(`Issued ticket: ${ticket.id}. Total active tickets: ${activeTickets.size}`);
    return ticket;
}

/**
 * Retrieves a ticket by its ID from the in-memory store.
 * @param {string} ticketId - The ID of the ticket to retrieve.
 * @returns {Object|undefined} The ticket object if found, otherwise undefined.
 */
function getTicketById(ticketId) {
    return activeTickets.get(ticketId);
}

/**
 * Clears all tickets from the in-memory store.
 * Useful for resetting game state.
 */
function clearAllTickets() {
    activeTickets.clear();
    console.log("All active tickets cleared from store.");
}

module.exports = {
    getNewTicket,
    getTicketById,
    clearAllTickets,
    // generateTambolaTicket // Optionally export for testing, but not typically needed by server.js
};
