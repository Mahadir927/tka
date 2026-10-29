// Main Application Logic for Anki TKA Bahasa Jepang

class AnkiApp {
  constructor() {
    this.decks = [];
    this.cardStats = {}; // { [cardId]: { reps, interval, easeFactor, nextReview, state } }
    this.studiedToday = 0;
    this.lastStudiedDate = new Date().toDateString();

    // Study session state
    this.currentDeck = null;
    this.studyQueue = [];
    this.currentCardIndex = 0;
    this.isCardFlipped = false;
    this.furiganaEnabled = true;

    // Bedah Soal mode state (khusus 29 soal TKA langsung gambar + penjelasan)
    this.bedahIndex = 0;
    this.bedahCards = [];

    this.init();
  }

  async init() {
    this.loadState();
    if (!this.decks || this.decks.length === 0) {
      await this.loadDefaultDecks();
    } else {
      await this.syncDefaultDecksUpdate();
    }
    this.checkDayRollover();
    this.renderHome();
    this.bindKeyboardShortcuts();
  }

  // Load persistence
  async loadState() {
    try {
      const savedDecks = localStorage.getItem('anki_tka_decks');
      if (savedDecks) {
        this.decks = JSON.parse(savedDecks);
      }
      const savedStats = localStorage.getItem('anki_tka_stats');
      if (savedStats) {
        this.cardStats = JSON.parse(savedStats);
      }
      const savedSession = localStorage.getItem('anki_tka_daily');
      if (savedSession) {
        const parsed = JSON.parse(savedSession);
        this.studiedToday = parsed.count || 0;
        this.lastStudiedDate = parsed.date || new Date().toDateString();
      }
    } catch (e) {
      console.error('Gagal membaca data dari localStorage:', e);
    }
  }

  // Update materi bawaan jika ada pembaruan konten seperti arti terjemahan
  async syncDefaultDecksUpdate() {
    try {
      const res = await fetch('data/default_decks.json?v=' + Date.now());
      if (res.ok) {
        const latestDecks = await res.json();
        if (!this.decks || this.decks.length === 0) {
          this.decks = latestDecks;
        } else {
          // Merge pembaruan field seperti meaning, back, example ke deck lokal
          latestDecks.forEach(newDeck => {
            const existingDeck = this.decks.find(d => d.id === newDeck.id);
            if (existingDeck) {
              newDeck.cards.forEach(newCard => {
                const existingCard = existingDeck.cards.find(c => c.id === newCard.id);
                if (existingCard) {
                  existingCard.meaning = newCard.meaning || existingCard.meaning;
                  existingCard.back = newCard.back || existingCard.back;
                  existingCard.furigana = newCard.furigana || existingCard.furigana;
                } else {
                  existingDeck.cards.push(newCard);
                }
              });
            } else {
              this.decks.push(newDeck);
            }
          });
        }
        this.saveState();
      }
    } catch (e) {
      console.warn('Gagal sync default decks update:', e);
    }
  }

  saveState() {
    try {
      localStorage.setItem('anki_tka_decks', JSON.stringify(this.decks));
      localStorage.setItem('anki_tka_stats', JSON.stringify(this.cardStats));
      localStorage.setItem('anki_tka_daily', JSON.stringify({
        date: this.lastStudiedDate,
        count: this.studiedToday
      }));
    } catch (e) {
      console.error('Gagal menyimpan ke localStorage:', e);
    }
  }

  checkDayRollover() {
    const today = new Date().toDateString();
    if (this.lastStudiedDate !== today) {
      this.lastStudiedDate = today;
      this.studiedToday = 0;
      this.saveState();
    }
  }

  async loadDefaultDecks() {
    try {
      const res = await fetch('data/default_decks.json');
      if (res.ok) {
        this.decks = await res.json();
        this.saveState();
      }
    } catch (e) {
      console.warn('Gagal load file json, mengabaikan default.', e);
    }
  }

  // Parse Kanji[furigana] syntax into HTML <ruby>
  formatFurigana(text) {
    if (!text) return '';
    // Pola: Kanji[furigana] -> <ruby>Kanji<rt>furigana</rt></ruby>
    return text.replace(/([一-龯々]+)\[(.*?)\]/g, '<ruby>$1<rt>$2</rt></ruby>');
  }

  // Text-to-Speech (Pelafalan Suara Bahasa Jepang)
  speakJapanese(textToSpeak) {
    if (!('speechSynthesis' in window)) {
      alert('Browser kamu belum mendukung Web Speech Synthesis.');
      return;
    }

    let raw = textToSpeak;
    if (!raw && this.currentDeck && this.studyQueue[this.currentCardIndex]) {
      const card = this.studyQueue[this.currentCardIndex];
      // Ambil teks kana/kanji, buang kurung & karakter bantuan
      raw = (card.furigana || card.front || card.back).replace(/\[.*?\]/g, '').split('\n')[0];
    }

    if (!raw) return;

    window.speechSynthesis.cancel(); // Stop ucapan sebelumnya
    const utterance = new SpeechSynthesisUtterance(raw);
    utterance.lang = 'ja-JP';
    utterance.rate = 0.9; // Sedikit lebih lambat agar jelas bagi pembelajar TKA

    // Cari voice Jepang jika ada di sistem
    const voices = window.speechSynthesis.getVoices();
    const jaVoice = voices.find(v => v.lang.startsWith('ja'));
    if (jaVoice) {
      utterance.voice = jaVoice;
    }

    window.speechSynthesis.speak(utterance);
  }

  // View: Render Home & Deck Stats
  renderHome() {
    document.getElementById('view-home').classList.remove('hidden');
    document.getElementById('view-study').classList.add('hidden');
    document.getElementById('view-complete').classList.add('hidden');
    const bedahEl = document.getElementById('view-bedah');
    if (bedahEl) bedahEl.classList.add('hidden');

    let totalDue = 0;
    let totalCards = 0;

    const container = document.getElementById('deck-list-container');
    container.innerHTML = '';

    this.decks.forEach(deck => {
      let deckDue = 0;
      let deckNew = 0;
      let deckLearning = 0;

      deck.cards.forEach(card => {
        totalCards++;
        const stats = this.cardStats[card.id];
        if (!stats) {
          deckNew++;
          deckDue++;
          totalDue++;
        } else if (SRS.isDue(stats)) {
          deckDue++;
          totalDue++;
          if (stats.state === 'learning') deckLearning++;
        }
      });

      const cardEl = document.createElement('div');
      cardEl.className = 'bg-slate-800 border border-slate-700/80 hover:border-slate-600 rounded-2xl p-5 flex flex-col justify-between transition-all hover:shadow-xl hover:shadow-indigo-500/5 group';
      
      const badgeColor = deck.category === 'Bunpou' ? 'text-indigo-400 bg-indigo-500/10 border-indigo-500/20' : 
                         deck.category === 'Kosakata' ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' : 
                         'text-amber-400 bg-amber-500/10 border-amber-500/20';

      const isGladi = deck.id === 'deck-gladi-bersih';
      cardEl.innerHTML = `
        <div class="space-y-3">
          <div class="flex items-center justify-between">
            <span class="text-xs px-2.5 py-0.5 rounded-full border ${badgeColor} font-medium">${deck.category || 'Materi'}</span>
            <span class="text-xs text-slate-400">${deck.cards.length} kartu</span>
          </div>
          <div>
            <h4 class="font-bold text-white text-lg group-hover:text-indigo-300 transition">${deck.name}</h4>
            <p class="text-xs text-slate-400 line-clamp-2 mt-1">${deck.description}</p>
          </div>
        </div>

        <div class="mt-5 pt-4 border-t border-slate-700/60 flex items-center justify-between flex-wrap gap-2">
          <div class="flex items-center gap-2 text-xs">
            <span class="text-blue-400 font-semibold" title="Kartu Baru">${deckNew} Baru</span>
            <span class="text-slate-600">•</span>
            <span class="text-amber-400 font-semibold" title="Perlu Diulang">${deckDue} Due</span>
          </div>

          <div class="flex items-center gap-2">
            ${isGladi ? `
              <button onclick="app.startBedahSoal(0)" class="px-3 py-2 rounded-xl text-xs font-semibold bg-amber-600 hover:bg-amber-500 text-white shadow-md shadow-amber-600/30 transition flex items-center gap-1.5" title="Lihat gambar langsung dengan penjelasan di bawah">
                <i class="fa-solid fa-book-open-reader text-[10px]"></i> Bedah Soal
              </button>
            ` : ''}
            <button onclick="app.startStudy('${deck.id}')" class="px-3 py-2 rounded-xl text-xs font-semibold ${deckDue > 0 ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-600/30' : 'bg-slate-700 hover:bg-slate-600 text-slate-300'} transition flex items-center gap-1.5">
              <i class="fa-solid fa-play text-[10px]"></i> ${deckDue > 0 ? 'Flashcard' : 'Review'}
            </button>
          </div>
        </div>
      `;
      container.appendChild(cardEl);
    });

    // Update Banner Stats
    document.getElementById('total-due-count').innerText = totalDue;
    document.getElementById('total-cards-count').innerText = totalCards;
    document.getElementById('total-studied-today').innerText = this.studiedToday;
  }

  showHome() {
    this.renderHome();
  }

  // Start Study Session
  startStudy(deckId) {
    const deck = this.decks.find(d => d.id === deckId);
    if (!deck || deck.cards.length === 0) {
      alert('Deck ini belum memiliki kartu!');
      return;
    }

    this.currentDeck = deck;
    
    // Prioritaskan kartu yang due/baru
    let dueCards = deck.cards.filter(card => {
      const stats = this.cardStats[card.id];
      return !stats || SRS.isDue(stats);
    });

    // Jika tidak ada yang due, perbolehkan latihan seluruh kartu deck
    if (dueCards.length === 0) {
      if (confirm('Hebat! Semua kartu di deck ini sudah selesai dipelajari untuk jadwal sekarang. Ingin tetap mereview ulang kartu?')) {
        dueCards = [...deck.cards];
      } else {
        return;
      }
    }

    // Acak urutan kartu agar latihan lebih menantang
    this.studyQueue = dueCards.sort(() => Math.random() - 0.5);
    this.currentCardIndex = 0;
    this.isCardFlipped = false;

    // Switch view
    document.getElementById('view-home').classList.add('hidden');
    document.getElementById('view-complete').classList.add('hidden');
    const bedahEl = document.getElementById('view-bedah');
    if (bedahEl) bedahEl.classList.add('hidden');
    document.getElementById('view-study').classList.remove('hidden');

    document.getElementById('study-deck-title').innerText = deck.name;
    this.displayCurrentCard();
  }

  displayCurrentCard() {
    if (this.currentCardIndex >= this.studyQueue.length) {
      this.finishSession();
      return;
    }

    const card = this.studyQueue[this.currentCardIndex];
    const stats = this.cardStats[card.id];

    // Status Badge
    const badgeEl = document.getElementById('card-status-badge');
    if (!stats) {
      badgeEl.innerText = 'New Card';
      badgeEl.className = 'px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 font-medium';
    } else if (stats.state === 'learning') {
      badgeEl.innerText = 'Learning (Ulangi)';
      badgeEl.className = 'px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-medium';
    } else {
      badgeEl.innerText = `Review (Interval: ${stats.interval}h)`;
      badgeEl.className = 'px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-medium';
    }

    // Progress counter & bar
    const progressText = `${this.currentCardIndex + 1} / ${this.studyQueue.length}`;
    document.getElementById('study-progress-badge').innerText = progressText;
    const progressPercent = ((this.currentCardIndex) / this.studyQueue.length) * 100;
    document.getElementById('study-progress-bar').style.width = `${progressPercent}%`;

    // Render Front content
    const imgContainer = document.getElementById('card-image-container');
    const imgEl = document.getElementById('card-image-element');
    if (card.image) {
      imgEl.src = card.image;
      imgContainer.classList.remove('hidden');
    } else {
      imgContainer.classList.add('hidden');
      imgEl.src = '';
    }

    const frontEl = document.getElementById('card-front-content');
    let frontHtml = this.formatFurigana(card.furigana && !card.furigana.includes('[') ? card.front : (card.furigana || card.front));
    frontEl.innerHTML = frontHtml;
    this.applyFuriganaVisibility();

    // Render Back content
    const backEl = document.getElementById('card-back-content');
    backEl.innerText = card.back;

    // Render Example / Additional info
    const exampleEl = document.getElementById('card-example-content');
    if (card.example || card.romaji) {
      let extraHtml = '';
      if (card.romaji) extraHtml += `<p class="text-indigo-400 font-mono text-xs mb-1">Rōmaji: ${card.romaji}</p>`;
      if (card.example) extraHtml += `<p class="text-slate-300"><b>Contoh:</b> ${card.example}</p>`;
      exampleEl.innerHTML = extraHtml;
      exampleEl.classList.add('hidden'); // hidden until flipped
    } else {
      exampleEl.classList.add('hidden');
    }

    // Update interval labels for 4 buttons
    document.getElementById('interval-again').innerText = SRS.getIntervalLabel(stats, 1);
    document.getElementById('interval-hard').innerText = SRS.getIntervalLabel(stats, 2);
    document.getElementById('interval-good').innerText = SRS.getIntervalLabel(stats, 3);
    document.getElementById('interval-easy').innerText = SRS.getIntervalLabel(stats, 4);

    // Reset card flip view
    this.isCardFlipped = false;
    document.getElementById('card-answer-divider').classList.add('hidden');
    document.getElementById('card-back-content').classList.add('hidden');
    document.getElementById('card-meaning-content').classList.add('hidden');
    document.getElementById('controls-front').classList.remove('hidden');
    document.getElementById('controls-back').classList.add('hidden');
    document.getElementById('card-tip-label').innerText = '💡 Coba tebak atau ucapkan sebelum melihat jawaban';
  }

  flipCard() {
    if (this.isCardFlipped) return;
    this.isCardFlipped = true;

    document.getElementById('card-answer-divider').classList.remove('hidden');
    document.getElementById('card-back-content').classList.remove('hidden');
    
    const card = this.studyQueue[this.currentCardIndex];

    // Tampilkan Arti Kalimat / Terjemahan jika ada
    const meaningEl = document.getElementById('card-meaning-content');
    if (card.meaning) {
      meaningEl.innerHTML = `<i class="fa-solid fa-language mr-1.5"></i> Arti: "${card.meaning}"`;
      meaningEl.classList.remove('hidden');
    } else {
      meaningEl.classList.add('hidden');
    }

    if (card.example || card.romaji) {
      document.getElementById('card-example-content').classList.remove('hidden');
    }

    document.getElementById('controls-front').classList.add('hidden');
    document.getElementById('controls-back').classList.remove('hidden');
    document.getElementById('card-tip-label').innerText = '🎯 Beri nilai seberapa mudah kamu mengingat kartu ini:';

    // Otomatis bunyikan pelafalan jika tersedia
    this.speakJapanese();
  }

  rateCard(rating) {
    if (!this.isCardFlipped) return;

    const currentCard = this.studyQueue[this.currentCardIndex];
    const prevStats = this.cardStats[currentCard.id];
    const newStats = SRS.processRating(prevStats, rating);
    
    this.cardStats[currentCard.id] = newStats;
    this.studiedToday += 1;
    this.saveState();

    // Jika pilih "Again" (Rating 1), masukkan kembali kartu ke antrean sesi ini (di akhir antrean)
    if (rating === 1) {
      this.studyQueue.push(currentCard);
    }

    this.currentCardIndex++;
    this.displayCurrentCard();
  }

  finishSession() {
    document.getElementById('study-progress-bar').style.width = '100%';
    document.getElementById('view-study').classList.add('hidden');
    document.getElementById('view-complete').classList.remove('hidden');
    document.getElementById('summary-studied-count').innerText = this.studyQueue.length;
  }

  toggleFurigana() {
    this.furiganaEnabled = !this.furiganaEnabled;
    const btnText = document.getElementById('furigana-status');
    btnText.innerText = this.furiganaEnabled ? 'ON' : 'OFF';
    this.applyFuriganaVisibility();
  }

  applyFuriganaVisibility() {
    const cardEl = document.getElementById('card-front-content');
    if (this.furiganaEnabled) {
      cardEl.classList.remove('hide-furigana');
    } else {
      cardEl.classList.add('hide-furigana');
    }
  }

  // Keyboard Shortcuts (Space = Flip, 1/2/3/4 = Rate)
  bindKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
      // Jangan trigger saat sedang mengetik di textarea / input modal
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;

      // Navigasi Keyboard untuk Mode Bedah Soal (Panah Kiri & Kanan)
      const bedahView = document.getElementById('view-bedah');
      if (bedahView && !bedahView.classList.contains('hidden')) {
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          this.prevBedahSoal();
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          this.nextBedahSoal();
        }
        return;
      }

      const studyView = document.getElementById('view-study');
      if (studyView.classList.contains('hidden')) return;

      if (e.code === 'Space') {
        e.preventDefault();
        if (!this.isCardFlipped) {
          this.flipCard();
        }
      } else if (this.isCardFlipped) {
        if (e.key === '1') this.rateCard(1);
        if (e.key === '2') this.rateCard(2);
        if (e.key === '3') this.rateCard(3);
        if (e.key === '4') this.rateCard(4);
      }
    });
  }

  // Modal: Tambah Kartu Baru
  openNewCardModal() {
    const select = document.getElementById('modal-deck-select');
    select.innerHTML = '';
    this.decks.forEach(d => {
      const opt = document.createElement('option');
      opt.value = d.id;
      opt.innerText = d.name;
      select.appendChild(opt);
    });
    document.getElementById('modal-new-card').classList.remove('hidden');
  }

  closeNewCardModal() {
    document.getElementById('modal-new-card').classList.add('hidden');
    document.getElementById('form-new-card').reset();
  }

  handleSaveCard(e) {
    e.preventDefault();
    const deckId = document.getElementById('modal-deck-select').value;
    const front = document.getElementById('modal-card-front').value.trim();
    const back = document.getElementById('modal-card-back').value.trim();
    const furigana = document.getElementById('modal-card-furigana').value.trim();
    const example = document.getElementById('modal-card-example').value.trim();

    if (!front || !back) return;

    const deck = this.decks.find(d => d.id === deckId);
    if (deck) {
      const newCard = {
        id: 'user_' + Date.now(),
        front,
        back,
        furigana: furigana || front,
        example: example || ''
      };
      deck.cards.push(newCard);
      this.saveState();
      this.closeNewCardModal();
      this.renderHome();
      alert('Kartu baru berhasil ditambahkan!');
    }
  }

  // ==========================================
  // FITUR KHUSUS: BEDAH SOAL TKA (29 SOAL)
  // Langsung tampilkan gambar soal + penjelasan di bawahnya
  // Tanpa flip kartu dan tanpa sistem hafalan tebak-tebakan
  // ==========================================
  startBedahSoal(targetIndex = 0) {
    const gladiDeck = this.decks.find(d => d.id === 'deck-gladi-bersih');
    if (!gladiDeck || !gladiDeck.cards || gladiDeck.cards.length === 0) {
      alert('Deck Gladi Bersih TKA belum tersedia. Silakan klik tombol Reset (putar) di kanan atas untuk memuat!');
      return;
    }

    this.bedahCards = gladiDeck.cards;
    this.bedahIndex = Math.max(0, Math.min(targetIndex, this.bedahCards.length - 1));

    // Siapkan dropdown lompat soal
    const select = document.getElementById('bedah-select');
    if (select) {
      select.innerHTML = '';
      this.bedahCards.forEach((c, i) => {
        const opt = document.createElement('option');
        opt.value = i;
        opt.innerText = `Soal #${i + 1}`;
        if (i === this.bedahIndex) opt.selected = true;
        select.appendChild(opt);
      });
    }

    // Tampilkan View Bedah Soal
    document.getElementById('view-home').classList.add('hidden');
    document.getElementById('view-study').classList.add('hidden');
    document.getElementById('view-complete').classList.add('hidden');
    document.getElementById('view-bedah').classList.remove('hidden');

    this.renderBedahCard();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  goToBedahSoal(index) {
    this.bedahIndex = parseInt(index, 10) || 0;
    this.renderBedahCard();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  prevBedahSoal() {
    if (this.bedahIndex > 0) {
      this.bedahIndex--;
      this.renderBedahCard();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  nextBedahSoal() {
    if (this.bedahIndex < this.bedahCards.length - 1) {
      this.bedahIndex++;
      this.renderBedahCard();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  renderBedahCard() {
    if (!this.bedahCards || this.bedahCards.length === 0) return;
    const card = this.bedahCards[this.bedahIndex];
    const total = this.bedahCards.length;

    // Update Counter & Badge
    document.getElementById('bedah-number-badge').innerText = `Soal #${this.bedahIndex + 1}`;
    document.getElementById('bedah-counter-text').innerText = `${this.bedahIndex + 1} / ${total}`;

    const select = document.getElementById('bedah-select');
    if (select) select.value = this.bedahIndex;

    // Disable / Enable Prev & Next buttons
    const btnPrev = document.getElementById('btn-bedah-prev');
    const btnNext = document.getElementById('btn-bedah-next');
    if (btnPrev) btnPrev.disabled = this.bedahIndex === 0;
    if (btnNext) btnNext.disabled = this.bedahIndex === total - 1;

    // Gambar Soal
    const imgEl = document.getElementById('bedah-image');
    if (imgEl) {
      imgEl.src = card.image || `images/soal/soal_${this.bedahIndex + 1}.webp`;
    }

    // Terjemahan / Meaning
    const meaningBox = document.getElementById('bedah-meaning-box');
    const meaningText = document.getElementById('bedah-meaning-text');
    if (card.meaning && card.meaning.trim() !== '') {
      meaningText.innerText = card.meaning;
      meaningBox.classList.remove('hidden');
    } else {
      meaningBox.classList.add('hidden');
    }

    // Kunci Jawaban & Pembahasan
    // card.back biasanya berisi format: "✅ Kunci Jawaban:\n...\n\n💡 Pembahasan:\n..."
    const rawBack = card.back || '';
    let answerPart = '';
    let explanationPart = '';

    if (rawBack.includes('💡 Pembahasan:')) {
      const parts = rawBack.split('💡 Pembahasan:');
      answerPart = parts[0].replace('✅ Kunci Jawaban:', '').trim();
      explanationPart = parts[1].trim();
    } else if (rawBack.includes('✅ Kunci Jawaban:')) {
      answerPart = rawBack.replace('✅ Kunci Jawaban:', '').trim();
    } else {
      explanationPart = rawBack;
    }

    document.getElementById('bedah-answer-text').innerText = answerPart || 'Lihat pembahasan di bawah.';
    document.getElementById('bedah-explanation-text').innerText = explanationPart || 'Tidak ada pembahasan tambahan.';

    // Kosakata
    const vocabBox = document.getElementById('bedah-vocab-box');
    const vocabText = document.getElementById('bedah-vocab-text');
    if (card.example && card.example.trim() !== '') {
      vocabText.innerText = card.example;
      vocabBox.classList.remove('hidden');
    } else {
      vocabBox.classList.add('hidden');
    }
  }

  speakJapaneseBedah() {
    if (!this.bedahCards || !this.bedahCards[this.bedahIndex]) return;
    const card = this.bedahCards[this.bedahIndex];
    const text = card.furigana || card.front;
    this.speakJapanese(text);
  }

  async resetAllProgress() {
    if (confirm('Yakin ingin mereset dan memuat ulang semua deck materi terbaru (termasuk Soal Gladi Bersih)?')) {
      localStorage.removeItem('anki_tka_decks');
      localStorage.removeItem('anki_tka_stats');
      localStorage.removeItem('anki_tka_daily');
      this.cardStats = {};
      this.studiedToday = 0;
      this.decks = [];
      await this.loadDefaultDecks();
      this.renderHome();
      alert('Semua deck berhasil diperbarui! Total kartu sekarang: ' + this.decks.reduce((acc, d) => acc + d.cards.length, 0));
    }
  }
}

// Inisialisasi Aplikasi
const app = new AnkiApp();
window.app = app;

