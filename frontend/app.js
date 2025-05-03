// ✅ app.js — Alpine.js Tambola Player Logic (DaisyUI + Socket.IO integrated)

const socket = io('https://tambola-backend.onrender.com', { transports: ['websocket', 'polling'] });

function playerDashboard() {
  return {
    roomId: '',
    playerName: '',
    tickets: [],
    called: [],
    autoMark: false,
    showMenu: false,
    showAddModal: false,
    showClaimModal: false,
    showAutoInfo: false,
    selectedPrize: null,
    prizeTypes: ['Full House', 'Top Line', 'Middle Line', 'Bottom Line', 'Corners'],

    init() {
      const urlParams = new URLSearchParams(window.location.search);
      this.roomId = urlParams.get('room') || '';
      if (this.roomId) this.showMenu = true;

      socket.on('number-called', (n) => {
        this.called.push(n);
      });

      socket.on('ticket-assigned', (tickets, pending=[]) => {
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

    joinGame() {
      if (!this.roomId || !this.playerName) return alert('Enter name and Room ID');
      socket.emit('join-room', { roomId: this.roomId, playerName: this.playerName });
    },

    initLayouts() {
      this.tickets.forEach((ticket, i) => {
        const nums = ticket.layout.flat().filter(n => n);
        this.tickets[i].marks = [];
        // No extra reshaping; layout is already 3x9 from backend
      });
    },

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

    requestTicket() {
      socket.emit('request-ticket', { roomId: this.roomId, playerName: this.playerName });
      this.showAddModal = false;
      alert('📨 Request sent to admin for a new ticket');
    },

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

    autoChanged() {
      this.showAutoInfo = true;
      setTimeout(() => this.showAutoInfo = false, 2000);
    }
  };
}
