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
  roomId = document.getElementById('room-id-input').value.trim();
  playerName = document.getElementById('player-name-input').value.trim();

  if (!roomId || !playerName) {
    alert('Please enter both Room ID and your Name.');
    return;
  }

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
}

// ========== BLOCK 3: Socket Event Handlers ==========
// New number called
socket.on('number-called', (data) => {
  renderCalledNumber(data.number);
  if (autoMarkEnabled) autoMarkTickets(data.number);
});

// Ticket update for this player
socket.on('ticket-updated', (data) => {
  renderTickets(data.tickets);
});

// Ticket request response
socket.on('ticket-request-response', (data) => {
  if (data.approved) {
    alert('Your ticket request was approved!');
    renderTickets(data.tickets);
  } else {
    alert(`Ticket request denied: ${data.error}`);
  }
});

// Claim update (approved/denied)
socket.on('claim-updated', (data) => {
  alert(`Your claim (${data.claimType}) was ${data.approved ? 'approved' : 'denied'}.`);
});

// ========== BLOCK 4: Player Actions ==========
function requestTicket() {
  socket.emit('request-ticket', { roomId, playerName }, (res) => {
    if (res.success) {
      alert('Ticket request sent for approval.');
    } else {
      alert(`Request failed: ${res.error}`);
    }
  });
}

function submitClaim(claimType, numbers) {
  socket.emit('submit-claim', { roomId, playerName, claimType, numbers }, (res) => {
    if (res.success) {
      alert('Claim submitted for verification.');
    } else {
      alert(`Claim failed: ${res.error}`);
    }
  });
}

function toggleAutoMark() {
  autoMarkEnabled = !autoMarkEnabled;
  socket.emit('toggle-auto-mark', { roomId, playerName, autoMark: autoMarkEnabled });
}

// ========== BLOCK 5: Rendering Helpers ==========
function renderCalledNumber(number) {
  const el = document.createElement('span');
  el.textContent = number;
  el.className = 'px-2 py-1 bg-gray-200 rounded';
  document.getElementById('called-numbers').appendChild(el);
}

function renderTickets(tickets) {
  const container = document.getElementById('tickets-container');
  container.innerHTML = '';
  tickets.forEach((ticket) => {
    const card = document.createElement('div');
    card.className = 'p-4 bg-white rounded shadow';
    const grid = document.createElement('div');
    grid.className = 'grid grid-cols-9 gap-1';
    ticket.forEach(num => {
      const cell = document.createElement('div');
      cell.textContent = num !== null && num !== undefined ? num : '';
      cell.className = 'h-8 flex items-center justify-center border';
      grid.appendChild(cell);
    });
    card.appendChild(grid);
    container.appendChild(card);
  });
}

function autoMarkTickets(number) {
  // TODO: Automatically mark number on tickets if present
}

// ========== Expose Functions to HTML ==========
window.joinRoom = joinRoom;
window.requestTicket = requestTicket;
window.submitClaim = submitClaim;
window.toggleAutoMark = toggleAutoMark;
