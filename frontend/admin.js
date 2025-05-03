// Folder: tambola-project/frontend
// File: admin.js

// ========== Setup Socket.IO Connection ==========
const socket = io(); // Assumes <script src="/socket.io/socket.io.js"></script> in admin.html

// ========== Global State ==========
let roomId = '';
let adminName = '';
let maxTicketsPerPlayer = 5;

// ========== BLOCK 1: Create or Join Room ==========
/**
 * Create a new game room as Admin.
 */
function createRoom() {
  // TODO: Replace prompt with UI form inputs
  adminName = prompt('Enter your admin name:');
  maxTicketsPerPlayer = parseInt(prompt('Max tickets per player (default 5):'), 10) || 5;
  socket.emit('create-room', { adminName, maxTicketsPerPlayer }, (res) => {
    if (res.success) {
      roomId = res.roomId;
      alert(`Room created: ${roomId}`);
      initializeAdminUI();
    } else {
      alert(`Create room failed: ${res.error}`);
    }
  });
}

/**
 * Join an existing room as Admin observer.
 */
function joinRoom() {
  // TODO: Replace prompt with UI form input
  roomId = prompt('Enter Room ID to join:');
  adminName = prompt('Enter your admin name:');
  socket.emit('join-room', { roomId, playerName: adminName }, (res) => {
    if (res.success) {
      initializeAdminUI();
    } else {
      alert(`Join failed: ${res.error}`);
    }
  });
}

// ========== BLOCK 2: Admin UI Initialization ==========
/**
 * Show admin panels after join/create.
 */
function initializeAdminUI() {
  document.getElementById('setup-screen').style.display = 'none';
  document.getElementById('admin-screen').style.display = 'block';
  // TODO: Render initial grids, lists
}

// ========== BLOCK 3: Socket Event Handlers ==========
// New player joined
socket.on('player-joined', (data) => {
  // data: { roomId, playerName, players }
  renderPlayersList(data.players);
});

// Incoming ticket request
socket.on('ticket-requested', (data) => {
  // data: { roomId, requestId, playerName }
  renderTicketRequest(data.requestId, data.playerName);
});

// Ticket approval results
socket.on('ticket-updated', (data) => {
  // data: { roomId, playerName, tickets }
  // Optionally update request queue and notify
});

// New claim submitted
socket.on('claim-submitted', (data) => {
  // data: { roomId, claimId, playerName, claimType, numbers }
  renderClaimRequest(data.claimId, data.playerName, data.claimType);
});

// Claim verification results
socket.on('claim-updated', (data) => {
  // data: { roomId, claimId, approved, playerName, claimType }
  updateClaimStatus(data.claimId, data.approved);
});

// Number called
socket.on('number-called', (data) => {
  // data: { roomId, number, calledNumbers }
  highlightCalledNumber(data.number);
});

// ========== BLOCK 4: Admin Actions ==========
/**
 * Draw and broadcast the next number.
 */
function callNumber() {
  socket.emit('call-number', { roomId }, (res) => {
    if (!res.success) alert(`Call number error: ${res.error}`);
  });
}

/**
 * Approve or deny a ticket request.
 * @param {string} requestId
 * @param {boolean} approved
 */
function approveTicket(requestId, approved) {
  socket.emit('approve-ticket', { roomId, requestId, approved }, (res) => {
    if (!res.success) alert(`Approve ticket error: ${res.error}`);
  });
}

/**
 * Verify (approve/deny) a prize claim.
 * @param {string} claimId
 * @param {boolean} approved
 */
function verifyClaim(claimId, approved) {
  socket.emit('verify-claim', { roomId, claimId, approved }, (res) => {
    if (!res.success) alert(`Verify claim error: ${res.error}`);
  });
}

// ========== BLOCK 5: Rendering Helpers ==========
function renderPlayersList(players) {
  // TODO: update players list UI
}

function renderTicketRequest(requestId, playerName) {
  // TODO: display pending ticket with approve/deny buttons
}

function renderClaimRequest(claimId, playerName, claimType) {
  // TODO: display pending claim for admin action
}

function updateClaimStatus(claimId, approved) {
  // TODO: update claim status in UI
}

function highlightCalledNumber(number) {
  // TODO: highlight number in 1–90 grid
}

// ========== Expose Functions to HTML ==========
window.createRoom = createRoom;
window.joinRoom = joinRoom;
window.callNumber = callNumber;
window.approveTicket = approveTicket;
window.verifyClaim = verifyClaim;
