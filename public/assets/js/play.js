/* Shush the heckler — a small game, for no reason.

   Hecklers pop up in a grid of seats for a shrinking moment each; tapping one
   before it goes is a shush. Thirty seconds a set. Your own best stays in
   this browser; a set good enough for the top ten goes on the shared board. */
(function () {
  'use strict';

  var grid = document.getElementById('play-grid');
  var start = document.getElementById('play-start');
  if (!grid || !start) return;

  var scoreEl = document.getElementById('play-score');
  var timeEl = document.getElementById('play-time');
  var bestEl = document.getElementById('play-best');
  var lineEl = document.getElementById('play-line');
  var seats = Array.prototype.slice.call(grid.querySelectorAll('.seat'));
  var boardEl = document.getElementById('hiscore-list');
  var entryForm = document.getElementById('hiscore-entry');
  var entryName = document.getElementById('hiscore-name');

  var SET_SECONDS = 30;
  var BEST_KEY = 'taylosite-play-best';
  var NAME_KEY = 'taylosite-play-name';
  var BOARD_SIZE = 10;

  var HECKLES = [
    'Boo', 'Get off', 'Is this thing on?', 'Do the one about…', 'My Uber’s here',
    'Louder!', 'I could do that', 'Free bird!', 'Say something funny', 'Who booked this?',
    'Wrong room', 'Next!', 'I paid for this?', 'Tell it again', 'Woooo'
  ];
  var SHUSHES = ['Shh.', 'Sit down.', 'Not tonight.', 'Thank you.', 'Moving on.', 'Security!'];
  var VERDICTS = [
    [0, 'They heckled. You listened. Try again.'],
    [8, 'A rough room, but you held the mic.'],
    [16, 'Tight five. The crowd knows who runs the room.'],
    [26, 'Nobody got a word in. Headliner.']
  ];

  var running = false;
  var score = 0;
  var secondsLeft = SET_SECONDS;
  var elapsed = 0;
  var clock = null;
  var spawnTimer = null;
  var leaveTimers = {};
  var board = [];
  var pendingScore = 0;

  function pick(list) {
    return list[Math.floor(Math.random() * list.length)];
  }

  function readBest() {
    try {
      return parseInt(localStorage.getItem(BEST_KEY), 10) || 0;
    } catch (e) {
      return 0;
    }
  }

  function writeBest(value) {
    try {
      localStorage.setItem(BEST_KEY, String(value));
    } catch (e) {
      /* private mode, storage off — the score just does not stick */
    }
  }

  // The counters are three-digit LCDs, like every game on this machine.
  function lcd(n) {
    return ('00' + Math.max(0, n)).slice(-3);
  }

  // ------------------------------------------------------- the high scores

  function drawBoard(highlight) {
    if (!boardEl) return;
    boardEl.textContent = '';
    for (var i = 0; i < BOARD_SIZE; i++) {
      var row = board[i];
      var li = document.createElement('li');
      li.className = 'hiscore-row' + (row ? '' : ' is-empty') + (i === highlight ? ' is-new' : '');
      [[i + 1 + '.', 'rank'], [row ? row.name : '---', 'name'], [row ? String(row.score) : '--', 'score']].forEach(function (cell) {
        var span = document.createElement('span');
        span.className = 'hiscore-' + cell[1];
        span.textContent = cell[0];
        li.appendChild(span);
      });
      boardEl.appendChild(li);
    }
  }

  function loadBoard() {
    if (!window.fetch) return Promise.resolve();
    return fetch('/api/scores', { headers: { Accept: 'application/json' }, cache: 'no-store' })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) {
        if (data && Array.isArray(data.scores)) {
          board = data.scores;
          drawBoard(-1);
        }
      })
      .catch(function () { /* offline: the board stays as the page drew it */ });
  }

  function makesBoard(value) {
    if (value < 1) return false;
    if (board.length < BOARD_SIZE) return true;
    return value > board[board.length - 1].score;
  }

  function askForInitials(value) {
    if (!entryForm) return;
    pendingScore = value;
    try {
      entryName.value = localStorage.getItem(NAME_KEY) || '';
    } catch (e) {
      entryName.value = '';
    }
    entryForm.hidden = false;
    entryName.focus();
    entryName.select();
  }

  function submitInitials(event) {
    event.preventDefault();
    var name = entryName.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3);
    if (!name || !pendingScore) return;
    try {
      localStorage.setItem(NAME_KEY, name);
    } catch (e) { /* fine */ }
    var value = pendingScore;
    pendingScore = 0;
    entryForm.hidden = true;
    fetch('/api/scores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ name: name, score: value })
    })
      .then(function (res) {
        return res.json().then(function (data) { return { ok: res.ok, data: data }; });
      })
      .then(function (r) {
        if (!r.ok) {
          say(r.data && r.data.error ? r.data.error : 'The board would not take that one.');
          return;
        }
        board = r.data.scores || board;
        drawBoard(r.data.rank);
        if (r.data.rank >= 0) say(name + ' is number ' + (r.data.rank + 1) + ' on the board.');
      })
      .catch(function () {
        say('Could not reach the board. Your best is still saved here.');
      });
  }

  function say(text) {
    lineEl.textContent = text;
  }

  // The pacing: every heckler stays a little shorter and the next one comes a
  // little sooner as the set goes on, so the last ten seconds are the test.
  function progress() {
    return Math.min(1, elapsed / (SET_SECONDS * 1000));
  }
  function stayMs() {
    return Math.round(1150 - 600 * progress());
  }
  function gapMs() {
    return Math.round(650 - 400 * progress()) + Math.round(Math.random() * 150);
  }

  function raise(seat) {
    seat.classList.remove('is-shushed');
    seat.classList.add('is-up');
    seat.querySelector('.seat-face').textContent = pick(HECKLES);
    var index = seat.dataset.seat;
    leaveTimers[index] = setTimeout(function () {
      lower(seat);
    }, stayMs());
  }

  function lower(seat) {
    clearTimeout(leaveTimers[seat.dataset.seat]);
    delete leaveTimers[seat.dataset.seat];
    seat.classList.remove('is-up');
    seat.querySelector('.seat-face').textContent = '';
  }

  function spawn() {
    if (!running) return;
    var free = seats.filter(function (s) {
      return !s.classList.contains('is-up') && !s.classList.contains('is-shushed');
    });
    if (free.length) raise(pick(free));
    // Late in the set a second heckler can be up at the same time.
    if (progress() > 0.6 && free.length > 1 && Math.random() < 0.35) {
      var second = free.filter(function (s) {
        return !s.classList.contains('is-up');
      });
      if (second.length) raise(pick(second));
    }
    spawnTimer = setTimeout(spawn, gapMs());
  }

  function shush(seat) {
    lower(seat);
    score += 1;
    scoreEl.textContent = lcd(score);
    seat.classList.add('is-shushed');
    seat.querySelector('.seat-face').textContent = pick(SHUSHES);
    setTimeout(function () {
      seat.classList.remove('is-shushed');
      if (!seat.classList.contains('is-up')) seat.querySelector('.seat-face').textContent = '';
    }, 260);
  }

  function tick() {
    elapsed += 1000;
    secondsLeft -= 1;
    timeEl.textContent = lcd(secondsLeft);
    if (secondsLeft <= 0) end();
  }

  function begin() {
    running = true;
    score = 0;
    elapsed = 0;
    secondsLeft = SET_SECONDS;
    scoreEl.textContent = lcd(0);
    timeEl.textContent = lcd(SET_SECONDS);
    pendingScore = 0;
    if (entryForm) entryForm.hidden = true;
    drawBoard(-1);
    say('Here they come.');
    start.textContent = 'Set in progress';
    start.disabled = true;
    grid.classList.add('is-live');
    clock = setInterval(tick, 1000);
    spawnTimer = setTimeout(spawn, 500);
  }

  function end() {
    running = false;
    clearInterval(clock);
    clearTimeout(spawnTimer);
    seats.forEach(lower);
    grid.classList.remove('is-live');

    var best = readBest();
    var verdict = VERDICTS[0][1];
    VERDICTS.forEach(function (v) {
      if (score >= v[0]) verdict = v[1];
    });
    if (score > best) {
      writeBest(score);
      bestEl.textContent = lcd(score);
      say('New best: ' + score + '. ' + verdict);
    } else {
      say('Set over: ' + score + ' shushed. ' + verdict);
    }
    start.textContent = 'Another set';
    start.disabled = false;

    // Check against the latest board, not the one the page loaded with.
    var finalScore = score;
    loadBoard().then(function () {
      if (!running && makesBoard(finalScore)) askForInitials(finalScore);
    });
  }

  grid.addEventListener('click', function (event) {
    var seat = event.target.closest('.seat');
    if (!seat || !running) return;
    if (seat.classList.contains('is-up')) shush(seat);
  });

  start.addEventListener('click', begin);
  if (entryForm) entryForm.addEventListener('submit', submitInitials);

  // Losing the tab mid-set is not a fair way to lose the set.
  document.addEventListener('visibilitychange', function () {
    if (document.hidden && running) {
      end();
      say('The set stopped when you left. Score: ' + score + '.');
    }
  });

  bestEl.textContent = lcd(readBest());
  loadBoard();
})();
