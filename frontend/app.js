// Folder: tambola-project/frontend
// File: app.js

// ========== Setup Socket.IO Connection ==========
const socket = io(); // Assumes <script src="/socket.io/socket.io.js"></script> in index.html

// ========== Global State ==========
let roomId = '';
let playerName = '';
let autoMarkEnabled = false;

// ========== BLOCK 1: Join Room Function ==========
/**
 * Prompt user for room ID and name, then join.
 */
function joinRoom() {
  // TODO: Replace prompts with UI form inputs
  roomId = prompt('Enter Room ID:');
  playerName = prompt('Enter Your Name:');

  socket.emit('join-room', { roomId, playerName }, (res) => {
    if (res.success) {
      initializeUI();
    } else {
      alert(`Join failed: ${res.error}`);
    }
  });
}

// ========== BLOCK 2: UI Initialization ==========
/**
 * Show game interface after successful join.
 */
function initializeUI() {
  document.getElementById('join-screen').style.display = 'none';
  document.getElementById('game-screen').style.display = 'block';
  // TODO: Render initial tickets & called numbers
}

// ========== BLOCK 3: Socket Event Handlers ==========
// New number called
socket.on('number-called', (data) => {
  // data: { roomId, number, calledNumbers }
  renderCalledNumber(data.number);
  if (autoMarkEnabled) autoMarkTickets(data.number);
});

// Ticket update for this player
socket.on('ticket-updated', (data) => {
  // data: { roomId, playerName, tickets: [ [..], ... ] }
  renderTickets(data.tickets);
});

// Ticket request response
socket.on('ticket-request-response', (data) => {
  // data: { roomId, requestId, approved, tickets?, error? }
  if (data.approved) {
    alert('Your ticket request was approved!');
    renderTickets(data.tickets);
  } else {
    alert(`Ticket request denied: ${data.error}`);
  }
});

// Claim update (approved/denied)
socket.on('claim-updated', (data) => {
  // data: { roomId, claimId, approved, playerName, claimType }
  alert(`Your claim (${data.claimType}) was ${data.approved ? 'approved' : 'denied'}.`);
  // TODO: Update 'My Claims' section
});

// ========== BLOCK 4: Player Actions ==========
/**
 * Request an additional ticket.
 */
function requestTicket() {
  socket.emit('request-ticket', { roomId, playerName }, (res) => {
    if (res.success) {
      alert('Ticket request sent for approval.');
    } else {
      alert(`Request failed: ${res.error}`);
    }
  });
}

/**
 * Submit a prize claim.
 * @param {string} claimType - e.g., 'topLine', 'twoLines', 'fullHouse'
 * @param {number[]} numbers - Claimed numbers
 */
function submitClaim(claimType, numbers) {
  socket.emit('submit-claim', { roomId, playerName, claimType, numbers }, (res) => {
    if (res.success) {
      alert('Claim submitted for verification.');
    } else {
      alert(`Claim failed: ${res.error}`);
    }
  });
}

/**
 * Toggle auto-marking on/off.
 */
function toggleAutoMark() {
  autoMarkEnabled = !autoMarkEnabled;
  socket.emit('toggle-auto-mark', { roomId, playerName, autoMark: autoMarkEnabled });
  // TODO: Update UI toggle state
}

// ========== BLOCK 5: Rendering Helpers ==========
function renderCalledNumber(number) {
  // TODO: Highlight number in 'Called Numbers' list
}

function renderTickets(tickets) {
  // TODO: Render ticket grids for the player
}

function autoMarkTickets(number) {
  // TODO: Automatically mark number on tickets if present
}

// ========== Expose Functions to HTML ==========
window.joinRoom = joinRoom;
window.requestTicket = requestTicket;
window.submitClaim = submitClaim;
window.toggleAutoMark = toggleAutoMark;
