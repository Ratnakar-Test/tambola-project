// ticketStore.js
// Logic for generating Tambola tickets.
// Located in: backend/ticketStore.js

/**
 * Generates a single Tambola ticket.
 * A ticket has 3 rows and 9 columns.
 * Each row has 5 numbers. Total 15 numbers per ticket.
 * Numbers are distributed in columns:
 * Col 1: 1-9
 * Col 2: 10-19
 * Col 3: 20-29
 * Col 4: 30-39
 * Col 5: 40-49
 * Col 6: 50-59
 * Col 7: 60-69
 * Col 8: 70-79
 * Col 9: 80-90
 */
function generateTambolaTicket() {
    const ticket = Array(3).fill(null).map(() => Array(9).fill(null));
    const numbersOnTicket = new Set();
    let ticketIdCounter = Date.now(); // More unique IDs

    // Helper to get a random number in a range
    const getRandomNumber = (min, max, exclude = []) => {
        let num;
        // Prevent infinite loop if range is exhausted
        let attempts = 0;
        const maxAttempts = (max - min + 1) * 2; 
        do {
            num = Math.floor(Math.random() * (max - min + 1)) + min;
            attempts++;
            if (attempts > maxAttempts) { // Safety break
                console.warn(`Could not find unique number in range ${min}-${max} after ${maxAttempts} attempts. Excludes: ${exclude.join(',')}. Numbers on ticket: ${Array.from(numbersOnTicket).join(',')}`);
                // Fallback or error handling needed here for robust ticket generation
                // For now, might return a non-unique if forced, or throw error
                // This indicates a very dense ticket or small range.
                return -1; // Indicate failure
            }
        } while (exclude.includes(num) || numbersOnTicket.has(num));
        return num;
    };

    // Define column ranges
    const columnRanges = [
        { min: 1, max: 9, count: 0, numbers: [] },
        { min: 10, max: 19, count: 0, numbers: [] },
        { min: 20, max: 29, count: 0, numbers: [] },
        { min: 30, max: 39, count: 0, numbers: [] },
        { min: 40, max: 49, count: 0, numbers: [] },
        { min: 50, max: 59, count: 0, numbers: [] },
        { min: 60, max: 69, count: 0, numbers: [] },
        { min: 70, max: 79, count: 0, numbers: [] },
        { min: 80, max: 90, count: 0, numbers: [] },
    ];

    // Try to place one number in each column first to ensure column diversity
    for (let colIdx = 0; colIdx < 9; colIdx++) {
        const num = getRandomNumber(columnRanges[colIdx].min, columnRanges[colIdx].max);
        if (num === -1) { /* Handle generation failure */ console.error("Failed to get initial number for col " + colIdx); return null; }
        numbersOnTicket.add(num);
        columnRanges[colIdx].numbers.push(num);
        columnRanges[colIdx].count++;
    }
    
    // Fill remaining 15 - 9 = 6 numbers
    let numbersToPlace = 15 - numbersOnTicket.size;
    while (numbersToPlace > 0) {
        const randomColIdx = Math.floor(Math.random() * 9);
        // Ensure column can take more numbers (typically up to 3, but simplified here to 2 for easier distribution for 15 numbers)
        // And ensure there are available unique numbers in that column's range
        if (columnRanges[randomColIdx].count < 2 && 
            columnRanges[randomColIdx].numbers.length < (columnRanges[randomColIdx].max - columnRanges[randomColIdx].min + 1)) {
            const num = getRandomNumber(columnRanges[randomColIdx].min, columnRanges[randomColIdx].max, columnRanges[randomColIdx].numbers);
            if (num === -1) { /* Handle generation failure */ console.error("Failed to get additional number for col " + randomColIdx); numbersToPlace--; continue; } // Skip if failed
            if (!numbersOnTicket.has(num)) { // Double check uniqueness, though getRandomNumber should handle it
                numbersOnTicket.add(num);
                columnRanges[randomColIdx].numbers.push(num);
                columnRanges[randomColIdx].count++;
                numbersToPlace--;
            }
        }
        // Safety break for while loop if numbers can't be placed
        if (numbersToPlace > 0 && Array.from(numbersOnTicket).length >= 15) break;
        // Add a counter to break if it loops too many times without placing numbers
        let safetyCounter = 0;
        const maxSafetyLoops = 100;
        if (safetyCounter++ > maxSafetyLoops && numbersToPlace > 0) {
            console.warn("Ticket generation stuck trying to place remaining numbers. Breaking.");
            break;
        }
    }
    
    // If not exactly 15 numbers, the logic needs refinement. For now, we proceed.
    if (numbersOnTicket.size !== 15) {
        console.warn(`Ticket generated with ${numbersOnTicket.size} numbers instead of 15. Algorithm needs improvement.`);
        // Could try to fill remaining or discard ticket and retry. For now, continue.
    }


    // Sort numbers within each column before distributing to rows
    columnRanges.forEach(col => col.numbers.sort((a, b) => a - b));

    // Distribute numbers to the ticket grid (3 rows, 9 columns)
    // Aim for 5 numbers per row. This is the trickiest part.
    // This is a simplified distribution logic.
    const rowsNumberCount = [0, 0, 0];

    for (let c = 0; c < 9; c++) { // Iterate through columns
        for (const num of columnRanges[c].numbers) { // Iterate through numbers for that column (sorted)
            let placed = false;
            // Try to place in rows that need numbers, prioritizing rows with fewer numbers.
            const rowOrderPreference = [0, 1, 2].sort((rA, rB) => rowsNumberCount[rA] - rowsNumberCount[rB]);
            
            for (const r of rowOrderPreference) {
                if (ticket[r][c] === null && rowsNumberCount[r] < 5) {
                    ticket[r][c] = num;
                    rowsNumberCount[r]++;
                    placed = true;
                    break; 
                }
            }
            if (!placed) {
                // If couldn't place (e.g., all rows have this column filled or rows are full)
                // This indicates a potential issue with this simplified placement.
                // A more robust algorithm might backtrack or use a different strategy.
                // console.warn(`Could not place number ${num} from column ${c}. Row counts: ${rowsNumberCount}`);
            }
        }
    }
    
    // Final check and adjustment for 5 numbers per row (very simplified)
    // This part is complex for perfect tickets. This is a placeholder for a more robust solution.
    // For now, we rely on the previous loop's best effort.

    const allNumbersFlatSorted = Array.from(numbersOnTicket).sort((a, b) => a - b);

    return {
        id: `TICKET_${ticketIdCounter++}`,
        rows: ticket,
        numbers: allNumbersFlatSorted // All unique numbers on the ticket, sorted
    };
}

// Store generated tickets in memory
const activeTickets = new Map(); // Stores ticketId -> ticketObject

function getNewTicket() {
    let ticket = null;
    let attempts = 0;
    // Attempt to generate a valid-looking ticket (e.g., with 15 numbers)
    // This is a simple retry; a better system would have more robust generation.
    do {
        ticket = generateTambolaTicket();
        attempts++;
        if (ticket && ticket.numbers.length !== 15) {
            console.warn(`Generated ticket ${ticket.id} has ${ticket.numbers.length} numbers. Retrying.`);
            ticket = null; // Invalidate and retry
        }
    } while (!ticket && attempts < 5); // Try a few times

    if (!ticket) {
        console.error("Failed to generate a valid ticket after several attempts.");
        // Fallback: return a dummy ticket or throw error
        return { id: "ERROR_TICKET", rows: [[],[],[]], numbers: []}; 
    }

    activeTickets.set(ticket.id, ticket);
    // console.log("Active tickets in store:", activeTickets.size);
    return ticket;
}

function getTicketById(ticketId) {
    return activeTickets.get(ticketId);
}

function clearAllTickets() { // Added for full server reset
    activeTickets.clear();
    console.log("All active tickets cleared from store.");
}


module.exports = {
    getNewTicket,
    getTicketById,
    generateTambolaTicket, // Exporting for potential direct use or testing
    clearAllTickets 
};
