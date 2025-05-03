// ✅ app.js (Player Page Logic with Alpine.js & DaisyUI)
const socket = io('https://tambola-backend.onrender.com', {
  transports: ['websocket', 'polling']
});

function playerDashboard() {
  return {
    // 🎮 Game State
    joined: false,
    roomId: '',
    playerName: '',
    roomErrorMessage: '',

    // 🎟️ Tickets
    tickets: [],
    pending: [],
    prizeTypes: ['Full House', 'Top Line', 'Middle Line', 'Bottom Line', 'Corners'],
    selectedPrize: null,

    // 🔢 Number Calls
    called: [],
    latest: null,
    autoMark: true,

    // 🧠 Modals & UI Flags
    showAddModal: false,
    showClaimModal: false,
    showAutoInfo: false,

    // ✅ Join Room
    join() {
      if (!this.roomId || !this.playerName) {
        this.roomErrorMessage = 'Please enter Room ID and Name';
        return;
      }
      socket.emit('join-room', {
        roomId: this.roomId,
        playerName: this.playerName
      });
    },

    // ✅ Handle Ticket Assignment
    handleTicketAssigned(tickets, pending = []) {
      this.joined = true;
      this.tickets = tickets.map((t, i) => ({ id: i + 1, layout: t, marks: [] }));
      this.pending = pending;
      if (this.autoMark) this.markCalled();
    },

    // ✅ Add Ticket Request
    requestTicket() {
      socket.emit('request-ticket', {
        roomId: this.roomId,
        playerName: this.playerName
      });
      this.showAddModal = true;
      setTimeout(() => this.showAddModal = false, 2500);
    },

    // ✅ Claim Prize
    claimPrize() {
      if (!this.selectedPrize) return alert('Select a prize to claim');
      this.tickets.forEach(ticket => {
        socket.emit('claim-prize', {
          roomId: this.roomId,
          playerName: this.playerName,
          claimType: this.selectedPrize,
          ticket
        });
      });
      this.showClaimModal = false;
    },

    // ✅ Manual Marking Toggle
    toggleMark(tid, num) {
      if (!this.autoMark) {
        const ticket = this.tickets.find(t => t.id === tid);
        ticket.marks = ticket.marks || [];
        if (ticket.marks.includes(num)) {
          ticket.marks = ticket.marks.filter(n => n !== num);
        } else {
          ticket.marks.push(num);
        }
      }
    },

    isMarked(ticket, num) {
      return this.autoMark ? this.called.includes(num) : (ticket.marks || []).includes(num);
    },

    // ✅ Confetti
    fireConfetti() {
      const duration = 1000;
      const animationEnd = Date.now() + duration;
      const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 1000 };
      const interval = setInterval(() => {
        if (Date.now() > animationEnd) return clearInterval(interval);
        confetti(Object.assign({}, defaults, {
          particleCount: 50,
          origin: { x: Math.random(), y: Math.random() * 0.5 }
        }));
      }, 200);
    },

    autoChanged() {
      this.showAutoInfo = true;
      setTimeout(() => this.showAutoInfo = false, 2000);
    },

    // ✅ Called number logic
    markCalled() {
      this.tickets.forEach(ticket => {
        ticket.marks = [];
        ticket.layout.flat().forEach(n => {
          if (n && this.called.includes(n)) ticket.marks.push(n);
        });
      });
    },

    // ✅ Setup Socket Events
    init() {
      socket.on('room-error', msg => {
        this.roomErrorMessage = msg || 'Room error';
        this.joined = false;
      });

      socket.on('ticket-assigned', this.handleTicketAssigned.bind(this));

      socket.on('number-called', num => {
        this.latest = num;
        this.called.push(num);
        if (this.autoMark) this.markCalled();
        if (document.querySelector(`.cell-${num}`)) this.fireConfetti();
      });

      socket.on('claim-result', ({ status, claimType, reason }) => {
        alert(`${claimType}: ${status === 'accepted' ? '✅ Accepted' : '❌ Rejected'}${reason ? ' - ' + reason : ''}`);
        if (status === 'accepted') this.fireConfetti();
      });
    }
  };
}
