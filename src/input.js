// Pointer, wheel, touch-pinch and keyboard input for the canvas.
// Calls back into the app with CSS-pixel coordinates relative to the stage.

export function attachInput(stage, app) {
    const pointers = new Map();
    let last = null;          // last single-pointer position
    let pinch = null;         // { dist, mid }
    let velocity = [0, 0];
    let lastMoveTime = 0;
    let downAt = null;

    const local = (e) => {
        const r = stage.getBoundingClientRect();
        return [e.clientX - r.left, e.clientY - r.top];
    };

    const pinchState = () => {
        const [a, b] = [...pointers.values()];
        return { dist: Math.hypot(a[0] - b[0], a[1] - b[1]), mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] };
    };

    stage.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 && e.pointerType === 'mouse') return;
        stage.setPointerCapture(e.pointerId);
        pointers.set(e.pointerId, local(e));
        app.stopMotion();
        velocity = [0, 0];
        if (pointers.size === 1) {
            last = local(e);
            downAt = { pos: last, time: performance.now() };
            stage.classList.add('dragging');
        } else if (pointers.size === 2) {
            pinch = pinchState();
        }
        app.interact();
    });

    stage.addEventListener('pointermove', (e) => {
        const pos = local(e);
        if (!pointers.has(e.pointerId)) {
            if (e.pointerType === 'mouse') app.hover(pos);
            return;
        }
        pointers.set(e.pointerId, pos);
        if (pointers.size === 1 && last) {
            const dx = pos[0] - last[0], dy = pos[1] - last[1];
            app.panBy(dx, dy);
            const now = performance.now();
            const dt = Math.max(1, now - lastMoveTime);
            velocity = [0.8 * dx / dt * 16 + 0.2 * velocity[0], 0.8 * dy / dt * 16 + 0.2 * velocity[1]];
            lastMoveTime = now;
            last = pos;
        } else if (pointers.size === 2 && pinch) {
            const p = pinchState();
            app.panBy(p.mid[0] - pinch.mid[0], p.mid[1] - pinch.mid[1]);
            if (p.dist > 0 && pinch.dist > 0) app.zoomAt(p.mid, -Math.log2(p.dist / pinch.dist));
            pinch = p;
        }
        app.interact();
    });

    const end = (e) => {
        if (!pointers.has(e.pointerId)) return;
        pointers.delete(e.pointerId);
        if (pointers.size === 0) {
            stage.classList.remove('dragging');
            const idle = performance.now() - lastMoveTime;
            if (idle < 60 && Math.hypot(velocity[0], velocity[1]) > 1.5) app.fling(velocity);
            // A short tap (touch) toggles the hint; treat like a click.
            last = null;
            pinch = null;
        } else if (pointers.size === 1) {
            last = [...pointers.values()][0];
            pinch = null;
        }
    };
    stage.addEventListener('pointerup', end);
    stage.addEventListener('pointercancel', end);
    stage.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') app.hover(null); });

    stage.addEventListener('wheel', (e) => {
        e.preventDefault();
        let dy = e.deltaY;
        if (e.deltaMode === 1) dy *= 16;
        else if (e.deltaMode === 2) dy *= 400;
        // Trackpad pinch arrives as ctrl+wheel with small deltas.
        const k = e.ctrlKey ? 0.012 : 0.0022;
        app.zoomAt(local(e), Math.max(-1.5, Math.min(1.5, dy * k)));
        app.interact();
    }, { passive: false });

    stage.addEventListener('dblclick', (e) => {
        app.zoomAnimated(local(e), e.shiftKey ? 1.5 : -1.5);
    });

    window.addEventListener('keydown', (e) => {
        if (e.target.closest?.('input, select, textarea') && e.key !== 'Escape') return;
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        const handled = app.key(e.key, e.shiftKey);
        if (handled) e.preventDefault();
    });

    return { get dragging() { return pointers.size > 0; } };
}
