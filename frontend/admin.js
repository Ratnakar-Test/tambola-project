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
  // Replace prompts with UI form values
  adminName = document.getElementById('admin-name-input').value.trim();
  maxTicketsPerPlayer = parseInt(document.getElementById('max-tickets-input').value, 10) || 5;

  if (!adminName) {
    alert('Please enter an Admin Name.');
    return;
  }

  socket.emit('create-room', { adminName, maxTicketsPerPlayer }, (res) => {
    if (res.success) {
      roomId = res.roomId;
      document.getElementById('room-id-display').textContent = roomId;
      initializeAdminUI();
    } else {
      alert(`Create room failed: ${res.error}`);
    }
  });
}

/**
 * Join an existing room as Admin.
 */
function joinRoom() {
  roomId = document.getElementById('room-id-input').value.trim();
  adminName = document.getElementById('admin-name-input').value.trim();

  if (!roomId || !adminName) {
    alert('Please enter both Room ID and Admin Name.');
    return;
  }

  socket.emit('join-room', { roomId, playerName: adminName }, (res) => {
    if (res.success) {
      document.getElementById('room-id-display').textContent = roomId;
      initializeAdminUI();
    } else {
      alert(`Join failed: ${res.error}`);
    }
  });
}

// ========== BLOCK 2: Admin UI Initialization ==========
/**
 * Show admin interface after room setup.
 */
function initializeAdminUI() {
  document.getElementById('setup-screen').style.display = 'none';
  document.getElementById('admin-screen').style.display = 'block';
  // TODO: Render initial number grid, players list
}

// ========== BLOCK 3: Socket Event Handlers ==========
// Player joined
socket.on('player-joined', (data) => {
  renderPlayersList(data.players);
});

// Incoming ticket request
socket.on('ticket-requested', (data) => {
  renderTicketRequest(data.requestId, data.playerName);
});

// Ticket update after approval
socket.on('ticket-updated', (data) => {
  // Optionally update pending requests
});

// New claim submitted
socket.on('claim-submitted', (data) => {
  renderClaimRequest(data.claimId, data.playerName, data.claimType);
});

// Claim verification result
socket.on('claim-updated', (data) => {
  updateClaimStatus(data.claimId, data.approved);
});

// Number called
socket.on('number-called', (data) => {
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
 */
function approveTicket(requestId, approved) {
  socket.emit('approve-ticket', { roomId, requestId, approved }, (res) => {
    if (!res.success) alert(`Approve ticket error: ${res.error}`);
  });
}

/**
 * Verify or reject a prize claim.
 */
function verifyClaim(claimId, approved) {
  socket.emit('verify-claim', { roomId, claimId, approved }, (res) => {
    if (!res.success) alert(`Verify claim error: ${res.error}`);
  });
}

// ========== BLOCK 5: Rendering Helpers ==========
function renderPlayersList(players) {
  const ul = document.getElementById('players-list');
  ul.innerHTML = '';
  players.forEach(name => {
    const li = document.createElement('li');
    li.textContent = name;
    ul.appendChild(li);
  });
}

function renderTicketRequest(requestId, playerName) {
  const container = document.getElementById('ticket-requests');
  const div = document.createElement('div');
  div.id = requestId;
  div.className = 'p-2 bg-white rounded shadow flex justify-between items-center';
  div.innerHTML = `
    <span>${playerName} requests a ticket</span>
    <div>
      <button onclick="approveTicket('${requestId}', true)" class="px-2 py-1 bg-green-600 text-white rounded mr-2">Approve</button>
      <button onclick="approveTicket('${requestId}', false)" class="px-2 py-1 bg-red-600 text-white rounded">Deny</button>
    </div>
  `;
  container.appendChild(div);
}

function renderClaimRequest(claimId, playerName, claimType) {
  const container = document.getElementById('claim-requests');
  const div = document.createElement('div');
  div.id = claimId;
  div.className = 'p-2 bg-white rounded shadow flex justify-between items-center';
  div.innerHTML = `
    <span>${playerName} claims ${claimType}</span>
    <div>
      <button onclick="verifyClaim('${claimId}', true)" class="px-2 py-1 bg-green-600 text-white rounded mr-2">Approve</button>
      <button onclick="verifyClaim('${claimId}', false)" class="px-2 py-1 bg-red-600 text-white rounded">Deny</button>
    </div>
  `;
  container.appendChild(div);
}

function updateClaimStatus(claimId, approved) {
  const div = document.getElementById(claimId);
  if (div) {
    div.querySelector('span').textContent += approved ? ' (Approved)' : ' (Denied)';
  }
}

function highlightCalledNumber(number) {
  const cell = document.getElementById(`num-${number}`);
  if (cell) cell.classList.add('bg-purple-500', 'text-white');
}

// ========== Expose Functions to HTML ==========
window.createRoom = createRoom;
window.joinRoom = joinRoom;
window.callNumber = callNumber;
window.approveTicket = approveTicket;
window.verifyClaim = verifyClaim;
