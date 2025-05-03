// ✅ app.js — Alpine.js Tambola Player Logic (DaisyUI + Socket.IO integrated)

const socket = io('https://tambola-backend.onrender.com', { transports: ['websocket', 'polling'] });

function playerDashboard() {
  return {
    // 🌐 Game state
    roomId: '',
    playerName: '',
    tickets: [],
    called: [],
    autoMark: false,
    joined: false, // ✅ NEW: controls visibility of join UI

    // 📦 UI States
    showMenu: false,
    showAddModal: false,
    showClaimModal: false,
    showAutoInfo: false,

    // 🎯 Claim types
    selectedPrize: null,
    prizeTypes: ['Full House', 'Top Line', 'Middle Line', 'Bottom Line', 'Corners'],

    // 🚀 On page load
    init() {
      const urlParams = new URLSearchParams(window.location.search);
      this.roomId = urlParams.get('room') || '';
      if (this.roomId) this.showMenu = true;

      socket.on('number-called', (n) => {
        this.called.push(n);
      });

      socket.on('ticket-assigned', (tickets, pending = []) => {
        this.tickets = tickets.map((layout, i) => ({ id: i + 1, layout, marks: [] }));
        this.initLayouts();
        this.showMenu = true;
      });

      socket.on('claim-result', ({ status, claimType, reason }) => {
        if (status === 'accepted') alert(`✅ Claim for ${claimType} accepted!`);
        else alert(`❌ Claim rejected: ${reason}`);
      });

      socket.on('room-error', (msg) => alert(msg));
    },

    // 🎮 Join game
    joinGame() {
      if (!this.roomId || !this.playerName) return alert('Enter name and Room ID');
      socket.emit('join-room', { roomId: this.roomId, playerName: this.playerName });
      this.joined = true; // ✅ Show game UI after successful join
    },

    // 🎟 Ticket grid prep (no reshaping)
    initLayouts() {
      this.tickets.forEach((ticket, i) => {
        const nums = ticket.layout.flat().filter(n => n);
        this.tickets[i].marks = [];
        // Already 3x9 layout from backend
      });
    },

    // ✅ Toggle mark for number
    isMarked(tid, num) {
      if (this.autoMark) return this.called.includes(num);
      const t = this.tickets.find(t => t.id === tid);
      return t?.marks?.includes(num);
    },

    toggleMark(tid, num) {
      if (this.autoMark) return;
      const t = this.tickets.find(t => t.id === tid);
      if (!t) return;
      const idx = t.marks.indexOf(num);
      if (idx > -1) t.marks.splice(idx, 1);
      else t.marks.push(num);
    },

    // ➕ Ticket request
    requestTicket() {
      socket.emit('request-ticket', { roomId: this.roomId, playerName: this.playerName });
      this.showAddModal = false;
      alert('📨 Request sent to admin for a new ticket');
    },

    // 🏆 Submit prize claim
    submitClaim() {
      if (!this.selectedPrize) return alert('Select a prize to claim');
      const ticket = this.tickets[0]?.layout || [];
      socket.emit('claim-prize', {
        roomId: this.roomId,
        playerName: this.playerName,
        claimType: this.selectedPrize,
        ticket,
      });
      this.showClaimModal = false;
    },

    // 🎯 Toggle auto-mark UI alert
    autoChanged() {
      this.showAutoInfo = true;
      setTimeout(() => this.showAutoInfo = false, 2000);
    }
  };
}
