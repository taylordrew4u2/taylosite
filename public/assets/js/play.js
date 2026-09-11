/* Shush the heckler — a small game, for no reason.

   Hecklers pop up in a grid of seats for a shrinking moment each; tapping one
   before it goes is a shush. Thirty seconds a set. The best score stays in
   this browser and nowhere else. */
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

  var SET_SECONDS = 30;
  var BEST_KEY = 'taylosite-play-best';

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
    scoreEl.textContent = String(score);
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
    timeEl.textContent = String(Math.max(0, secondsLeft));
    if (secondsLeft <= 0) end();
  }

  function begin() {
    running = true;
    score = 0;
    elapsed = 0;
    secondsLeft = SET_SECONDS;
    scoreEl.textContent = '0';
    timeEl.textContent = String(SET_SECONDS);
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
      bestEl.textContent = String(score);
      say('New best: ' + score + '. ' + verdict);
    } else {
      say('Set over: ' + score + ' shushed. ' + verdict);
    }
    start.textContent = 'Another set';
    start.disabled = false;
  }

  grid.addEventListener('click', function (event) {
    var seat = event.target.closest('.seat');
    if (!seat || !running) return;
    if (seat.classList.contains('is-up')) shush(seat);
  });

  start.addEventListener('click', begin);

  // Losing the tab mid-set is not a fair way to lose the set.
  document.addEventListener('visibilitychange', function () {
    if (document.hidden && running) {
      end();
      say('The set stopped when you left. Score: ' + score + '.');
    }
  });

  bestEl.textContent = String(readBest());
})();
