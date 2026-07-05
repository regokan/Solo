(function () {
    if (!document.body.classList.contains('is-canvas')) return;

    // When embedded as an iframe, hide chrome and fill the full viewport
    if (window.self !== window.top) {
        document.body.classList.add('is-canvas-embedded');
    }

    // Measure the site header height so CSS can size the stage to fill the rest
    function syncHeaderHeight() {
        var h = document.querySelector('#gh-head');
        document.documentElement.style.setProperty('--header-height', (h ? h.offsetHeight : 0) + 'px');
    }
    syncHeaderHeight();
    window.addEventListener('resize', syncHeaderHeight);

    var src = document.querySelector('.canvas-content-source .canvas-data');
    if (!src) return;

    var data;
    try { data = JSON.parse(src.textContent); } catch (e) { return; }

    var nodes = data.nodes || [];
    var edges = data.edges || [];
    if (!nodes.length) return;

    // ── Theme-aware color tokens (set in CSS, flip with dark/light mode) ─────
    var cs = getComputedStyle(document.documentElement);
    function tok(name, fallback) {
        return cs.getPropertyValue(name).trim() || fallback;
    }
    var C = {
        nodeFill:    tok('--canvas-node-fill',    'rgba(0,0,0,0.04)'),
        nodeStroke:  tok('--canvas-node-stroke',  'rgba(0,0,0,0.14)'),
        text:        tok('--canvas-text-color',   'rgba(0,0,0,0.82)'),
        edge:        tok('--canvas-edge-color',   '#bbb'),
        groupFill:   tok('--canvas-group-fill',   'rgba(0,0,0,0.025)'),
        groupStroke: tok('--canvas-group-stroke', 'rgba(0,0,0,0.14)'),
        groupLabel:  tok('--canvas-group-label',  'rgba(0,0,0,0.4)'),
    };

    // ── Obsidian colour presets ───────────────────────────────────────────────
    var PRESET = { '1':'#e05c5c','2':'#e9973f','3':'#e0c46e','4':'#5bcd4e','5':'#53dfdd','6':'#a882f5' };

    function resolveColor(c) {
        if (!c) return null;
        return (c[0] === '#') ? c : (PRESET[c] || null);
    }

    function hexRgba(hex, a) {
        if (!hex || hex[0] !== '#') return null;
        var r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
        return 'rgba('+r+','+g+','+b+','+a+')';
    }

    // ── Bounding box ──────────────────────────────────────────────────────────
    var minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;
    nodes.forEach(function (n) {
        minX = Math.min(minX, n.x);
        minY = Math.min(minY, n.y);
        maxX = Math.max(maxX, n.x + (n.width  || 200));
        maxY = Math.max(maxY, n.y + (n.height || 60));
    });
    var PAD  = 120;
    var cW   = maxX - minX + PAD * 2;
    var cH   = maxY - minY + PAD * 2;
    var offX = -minX + PAD;
    var offY = -minY + PAD;

    // ── Build node lookup ─────────────────────────────────────────────────────
    var nodeMap = {};
    nodes.forEach(function (n) { nodeMap[n.id] = n; });

    // ── SVG setup ─────────────────────────────────────────────────────────────
    var NS   = 'http://www.w3.org/2000/svg';
    var svg  = document.querySelector('.canvas-svg');
    var root = document.querySelector('.canvas-root');
    if (!svg || !root) return;

    // Stage fills viewport; root group gets panned/zoomed
    svg.setAttribute('width',  '100%');
    svg.setAttribute('height', '100%');

    function el(tag, attrs) {
        var e = document.createElementNS(NS, tag);
        for (var k in attrs) e.setAttribute(k, attrs[k]);
        return e;
    }

    // ── Render groups (bottom layer) ──────────────────────────────────────────
    nodes.filter(function (n) { return n.type === 'group'; }).forEach(function (n) {
        var color = resolveColor(n.color);
        var g = el('g');

        g.appendChild(el('rect', {
            x: n.x + offX, y: n.y + offY, width: n.width, height: n.height,
            rx: 10, ry: 10,
            fill:           color ? hexRgba(color, 0.08) : C.groupFill,
            stroke:         color || C.groupStroke,
            'stroke-width': 1.5,
            'stroke-dasharray': '7 4'
        }));

        if (n.label) {
            var lbl = el('text', {
                x: n.x + offX + 12, y: n.y + offY - 10,
                'font-size': 13, 'font-weight': 600,
                fill: color || C.groupLabel
            });
            lbl.textContent = n.label;
            g.appendChild(lbl);
        }
        root.appendChild(g);
    });

    // ── Helpers for edge geometry ─────────────────────────────────────────────
    function port(n, side) {
        var x = n.x + offX, y = n.y + offY;
        var w = n.width || 200, h = n.height || 60;
        switch (side) {
            case 'left':   return { x: x,         y: y + h/2 };
            case 'right':  return { x: x + w,     y: y + h/2 };
            case 'top':    return { x: x + w/2,   y: y       };
            case 'bottom': return { x: x + w/2,   y: y + h   };
            default:       return { x: x + w/2,   y: y + h/2 };
        }
    }

    function ctrl(pt, side, dist) {
        var d = Math.max(50, Math.min(280, dist * 0.42));
        switch (side) {
            case 'left':   return { x: pt.x - d, y: pt.y };
            case 'right':  return { x: pt.x + d, y: pt.y };
            case 'top':    return { x: pt.x, y: pt.y - d };
            case 'bottom': return { x: pt.x, y: pt.y + d };
            default:       return { x: pt.x, y: pt.y };
        }
    }

    // ── Render edges ──────────────────────────────────────────────────────────
    edges.forEach(function (e) {
        var fn = nodeMap[e.fromNode], tn = nodeMap[e.toNode];
        if (!fn || !tn) return;

        var fp = port(fn, e.fromSide), tp = port(tn, e.toSide);
        var dist = Math.sqrt(Math.pow(tp.x-fp.x,2) + Math.pow(tp.y-fp.y,2));
        var cp1 = ctrl(fp, e.fromSide, dist);
        var cp2 = ctrl(tp, e.toSide,   dist);

        // toEnd default = arrow; fromEnd default = none
        var toArrow   = e.toEnd   !== 'none';          // undefined → arrow
        var fromArrow = e.fromEnd === 'arrow';

        var edgeColor = resolveColor(e.color) || C.edge;
        var attrs = {
            d: 'M'+fp.x+' '+fp.y+' C'+cp1.x+' '+cp1.y+','+cp2.x+' '+cp2.y+','+tp.x+' '+tp.y,
            fill: 'none', stroke: edgeColor, 'stroke-width': 1.5
        };
        if (toArrow)   attrs['marker-end']   = 'url(#cv-arrow)';
        if (fromArrow) attrs['marker-start'] = 'url(#cv-arrow-rev)';

        root.appendChild(el('path', attrs));

        if (e.label) {
            var mx = (fp.x + cp1.x + cp2.x + tp.x) / 4;
            var my = (fp.y + cp1.y + cp2.y + tp.y) / 4;
            var bg = el('rect', { x: mx-28, y: my-9, width: 56, height: 17,
                                   rx: 4, fill: '#111' });
            var lt = el('text', { x: mx, y: my+3.5,
                                   'text-anchor': 'middle', 'font-size': 11, fill: '#aaa' });
            lt.textContent = e.label;
            root.appendChild(bg);
            root.appendChild(lt);
        }
    });

    // ── Render text nodes (top layer) ─────────────────────────────────────────
    nodes.filter(function (n) { return n.type !== 'group'; }).forEach(function (n) {
        var color = resolveColor(n.color);
        var w = n.width || 200, h = n.height || 60;
        var g = el('g');

        g.appendChild(el('rect', {
            x: n.x + offX, y: n.y + offY, width: w, height: h,
            rx: 7, ry: 7,
            fill:           color ? hexRgba(color, 0.12) : C.nodeFill,
            stroke:         color || C.nodeStroke,
            'stroke-width': 1
        }));

        // Text via foreignObject for automatic wrapping
        var fo = el('foreignObject', {
            x: n.x + offX + 10, y: n.y + offY + 8,
            width: Math.max(1, w - 20), height: Math.max(1, h - 16)
        });
        var div = document.createElement('div');
        div.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
        div.style.cssText = [
            'font-size:13px',
            'line-height:1.45',
            'color:' + (color || C.text),
            'overflow:hidden',
            'height:100%',
            'word-wrap:break-word',
            'font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif'
        ].join(';');
        div.textContent = n.text || '';
        fo.appendChild(div);
        g.appendChild(fo);

        root.appendChild(g);
    });

    // ── Pan / zoom state ──────────────────────────────────────────────────────
    var stage = document.querySelector('.canvas-stage');
    var px = 0, py = 0, sc = 1;

    function applyTransform() {
        root.setAttribute('transform', 'translate('+px+','+py+') scale('+sc+')');
    }

    function fitToScreen() {
        var sw = stage.clientWidth, sh = stage.clientHeight;
        sc  = Math.min(sw / cW, sh / cH) * 0.88;
        px  = (sw - cW * sc) / 2;
        py  = (sh - cH * sc) / 2;
        applyTransform();
    }

    fitToScreen();
    window.addEventListener('resize', fitToScreen);

    // Mouse drag
    var dragging = false, dsx, dsy, dpx, dpy;
    stage.addEventListener('mousedown', function (e) {
        if (e.button !== 0) return;
        dragging = true; dsx = e.clientX; dsy = e.clientY; dpx = px; dpy = py;
        stage.style.cursor = 'grabbing';
    });
    document.addEventListener('mousemove', function (e) {
        if (!dragging) return;
        px = dpx + (e.clientX - dsx);
        py = dpy + (e.clientY - dsy);
        applyTransform();
    });
    document.addEventListener('mouseup', function () {
        dragging = false; stage.style.cursor = 'grab';
    });

    // Wheel zoom — zoom toward cursor
    stage.addEventListener('wheel', function (e) {
        e.preventDefault();
        var r   = stage.getBoundingClientRect();
        var mx  = e.clientX - r.left;
        var my  = e.clientY - r.top;
        var factor = e.deltaY < 0 ? 1.12 : (1 / 1.12);
        var nsc = Math.max(0.04, Math.min(6, sc * factor));
        px = mx - (mx - px) * (nsc / sc);
        py = my - (my - py) * (nsc / sc);
        sc = nsc;
        applyTransform();
    }, { passive: false });

    // Keyboard nudge
    document.addEventListener('keydown', function (e) {
        var step = 60;
        if (e.key === 'ArrowRight') { px -= step; applyTransform(); }
        if (e.key === 'ArrowLeft')  { px += step; applyTransform(); }
        if (e.key === 'ArrowDown')  { py -= step; applyTransform(); }
        if (e.key === 'ArrowUp')    { py += step; applyTransform(); }
        if (e.key === '0' || e.key === 'f') fitToScreen();
    });

    // Touch: one-finger pan, two-finger pinch-zoom
    var lt = null;
    stage.addEventListener('touchstart',  function (e) { lt = e.touches; }, { passive: true });
    stage.addEventListener('touchmove', function (e) {
        if (!lt) return;
        if (e.touches.length === 1 && lt.length === 1) {
            px += e.touches[0].clientX - lt[0].clientX;
            py += e.touches[0].clientY - lt[0].clientY;
            applyTransform();
        } else if (e.touches.length === 2 && lt.length === 2) {
            var d1 = Math.hypot(lt[0].clientX-lt[1].clientX, lt[0].clientY-lt[1].clientY);
            var d2 = Math.hypot(e.touches[0].clientX-e.touches[1].clientX, e.touches[0].clientY-e.touches[1].clientY);
            sc = Math.max(0.04, Math.min(6, sc * d2 / d1));
            applyTransform();
        }
        lt = e.touches;
    }, { passive: true });
    stage.addEventListener('touchend', function () { lt = null; }, { passive: true });

    // Zoom buttons
    var btnIn  = document.querySelector('.canvas-zoom-in');
    var btnOut = document.querySelector('.canvas-zoom-out');
    var btnFit = document.querySelector('.canvas-zoom-fit');
    if (btnIn)  btnIn.addEventListener('click',  function () { sc = Math.min(6, sc*1.25); applyTransform(); });
    if (btnOut) btnOut.addEventListener('click', function () { sc = Math.max(0.04, sc/1.25); applyTransform(); });
    if (btnFit) btnFit.addEventListener('click', fitToScreen);
})();
