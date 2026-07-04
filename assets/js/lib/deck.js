(function () {
    if (!document.body.classList.contains('is-deck')) return;

    // Measure the site header height so CSS can size the stage to fill the rest
    function syncHeaderHeight() {
        var h = document.querySelector('#gh-head');
        document.documentElement.style.setProperty('--header-height', (h ? h.offsetHeight : 0) + 'px');
    }
    syncHeaderHeight();
    window.addEventListener('resize', syncHeaderHeight);

    var source = document.querySelector('.deck-content-source');
    var stage  = document.querySelector('.deck-stage');
    if (!source || !stage) return;

    // ── Parse content into slide objects ──────────────────────────────────
    var slides = [];
    var cur    = null;

    Array.from(source.children).forEach(function (el) {
        if (el.classList.contains('kg-image-card')) {
            if (cur) slides.push(cur);
            cur = { img: el.querySelector('img'), notes: [] };
        } else if (cur) {
            cur.notes.push(el.cloneNode(true));
        }
    });
    if (cur) slides.push(cur);
    if (!slides.length) return;

    // ── Build DOM ─────────────────────────────────────────────────────────
    var track = document.createElement('div');
    track.className = 'deck-track';

    slides.forEach(function (s, i) {
        var slide = document.createElement('div');
        slide.className = 'deck-slide';
        slide.setAttribute('role', 'group');
        slide.setAttribute('aria-label', 'Slide ' + (i + 1));

        var visual = document.createElement('div');
        visual.className = 'deck-visual';
        var img = document.createElement('img');
        img.src     = s.img ? s.img.src : '';
        img.alt     = s.img ? (s.img.alt || 'Slide ' + (i + 1)) : '';
        img.loading = i === 0 ? 'eager' : 'lazy';
        visual.appendChild(img);

        var notes = document.createElement('div');
        notes.className = 'deck-notes';
        var num = document.createElement('span');
        num.className   = 'deck-slide-num';
        num.textContent = String(i + 1).padStart(2, '0');
        notes.appendChild(num);
        s.notes.forEach(function (n) { notes.appendChild(n); });

        slide.appendChild(visual);
        slide.appendChild(notes);
        track.appendChild(slide);
    });

    stage.appendChild(track);

    // ── Wire up controls ──────────────────────────────────────────────────
    var prevBtn     = document.querySelector('.deck-prev');
    var nextBtn     = document.querySelector('.deck-next');
    var counterEl   = document.querySelector('.deck-counter-current');
    var totalEl     = document.querySelector('.deck-counter-total');
    var progressBar = document.querySelector('.deck-progress-fill');

    if (totalEl) totalEl.textContent = slides.length;

    var idx       = 0;
    var animating = false;

    function update() {
        track.style.transform = 'translateX(-' + (idx * 100) + 'vw)';
        if (counterEl)   counterEl.textContent = idx + 1;
        if (progressBar) progressBar.style.width = ((idx + 1) / slides.length * 100) + '%';
        if (prevBtn)     prevBtn.disabled = idx === 0;
        if (nextBtn)     nextBtn.disabled = idx === slides.length - 1;
        // reset notes scroll
        var panels = track.querySelectorAll('.deck-notes');
        if (panels[idx]) panels[idx].scrollTop = 0;
    }

    function goTo(n) {
        if (animating) return;
        n = Math.max(0, Math.min(slides.length - 1, n));
        if (n === idx) return;
        animating = true;
        idx = n;
        update();
        setTimeout(function () { animating = false; }, 500);
    }

    // init
    update();

    if (prevBtn) prevBtn.addEventListener('click', function () { goTo(idx - 1); });
    if (nextBtn) nextBtn.addEventListener('click', function () { goTo(idx + 1); });

    // keyboard
    document.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown')  { e.preventDefault(); goTo(idx + 1); }
        if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')    { e.preventDefault(); goTo(idx - 1); }
    });

    // wheel — scoped to stage so footer area scrolls the page normally
    var wheelLock = false;
    stage.addEventListener('wheel', function (e) {
        var panel = e.target.closest('.deck-notes');
        if (panel) {
            var atBottom = panel.scrollTop + panel.clientHeight >= panel.scrollHeight - 4;
            var atTop    = panel.scrollTop <= 4;
            if (e.deltaY > 0 && !atBottom) return;
            if (e.deltaY < 0 && !atTop)    return;
        }
        e.preventDefault();
        if (wheelLock) return;
        var delta = e.deltaY || e.deltaX;
        if (Math.abs(delta) < 10) return;
        wheelLock = true;
        goTo(idx + (delta > 0 ? 1 : -1));
        setTimeout(function () { wheelLock = false; }, 600);
    }, { passive: false });

    // touch swipe
    var touchStartX = null;
    document.addEventListener('touchstart', function (e) {
        touchStartX = e.touches[0].clientX;
    }, { passive: true });
    document.addEventListener('touchend', function (e) {
        if (touchStartX === null) return;
        var dx = touchStartX - e.changedTouches[0].clientX;
        if (Math.abs(dx) > 48) goTo(idx + (dx > 0 ? 1 : -1));
        touchStartX = null;
    });
})();
