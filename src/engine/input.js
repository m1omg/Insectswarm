// Unified pointer input: mouse, touch and stylus take exactly the same path.
//
// Gestures: drag to pan, two-finger pinch to zoom, wheel/trackpad to zoom, tap to inspect an
// individual, long press (or right click) to use the active sandbox tool. Whichever viewport the
// gesture starts in owns it until every pointer lifts, so a pinch that strays across the divider
// does not suddenly start zooming the other pane.

const TAP_MAX_MOVE_PX = 8;      // finger slop that still counts as a tap
const TAP_MAX_MS = 300;
const LONG_PRESS_MS = 420;

export class PointerInput {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} handlers
   * @param {(sx:number, sy:number)=>Viewport|null} handlers.viewportAt
   * @param {(vp, wx:number, wy:number)=>void} [handlers.onTap]
   * @param {(vp, wx:number, wy:number)=>void} [handlers.onLongPress]
   * @param {(vp, wx:number, wy:number, phase:'start'|'move'|'end')=>void} [handlers.onDragTool]
   * @param {()=>boolean} [handlers.toolIsDragging]  true when the active tool paints on drag
   */
  constructor(canvas, handlers) {
    this.canvas = canvas;
    this.h = handlers;
    this.pointers = new Map();      // pointerId -> {x, y, startX, startY, startTime, moved}
    this.activeViewport = null;
    this.pinchStartDist = 0;
    this.longPressTimer = null;
    this.toolDragging = false;
    this.hover = null;              // {vp, wx, wy} for desktop cursor readout

    canvas.style.touchAction = 'none';   // we handle panning ourselves
    canvas.addEventListener('pointerdown', this._down = this._down.bind(this));
    canvas.addEventListener('pointermove', this._move = this._move.bind(this));
    canvas.addEventListener('pointerup', this._up = this._up.bind(this));
    canvas.addEventListener('pointercancel', this._up);
    canvas.addEventListener('pointerleave', this._leave = this._leave.bind(this));
    canvas.addEventListener('wheel', this._wheel = this._wheel.bind(this), { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  destroy() {
    const c = this.canvas;
    c.removeEventListener('pointerdown', this._down);
    c.removeEventListener('pointermove', this._move);
    c.removeEventListener('pointerup', this._up);
    c.removeEventListener('pointercancel', this._up);
    c.removeEventListener('pointerleave', this._leave);
    c.removeEventListener('wheel', this._wheel);
    this._clearLongPress();
  }

  _local(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  _clearLongPress() {
    if (this.longPressTimer) clearTimeout(this.longPressTimer);
    this.longPressTimer = null;
  }

  _down(e) {
    const p = this._local(e);
    this.canvas.setPointerCapture?.(e.pointerId);
    this.pointers.set(e.pointerId, {
      x: p.x, y: p.y, startX: p.x, startY: p.y, startTime: performance.now(), moved: false,
    });

    if (this.pointers.size === 1) {
      this.activeViewport = this.h.viewportAt(p.x, p.y) || null;

      // Right click acts as long press, so desktop gets the tool without waiting.
      if (e.button === 2 && this.activeViewport) {
        this._emit('onLongPress', p);
        return;
      }

      // A tool that paints (placing food, digging) starts immediately on press and follows the drag.
      if (this.h.toolIsDragging?.() && this.activeViewport) {
        this.toolDragging = true;
        this._emitDragTool(p, 'start');
        return;
      }

      this._clearLongPress();
      this.longPressTimer = setTimeout(() => {
        const rec = this.pointers.get(e.pointerId);
        if (rec && !rec.moved && this.activeViewport) this._emit('onLongPress', { x: rec.x, y: rec.y });
        this.longPressTimer = null;
      }, LONG_PRESS_MS);

    } else if (this.pointers.size === 2) {
      this._clearLongPress();
      this.toolDragging = false;
      this.pinchStartDist = this._pinchDistance();
    }
  }

  _move(e) {
    const p = this._local(e);
    const rec = this.pointers.get(e.pointerId);

    if (!rec) {
      // No button held: track hover for the desktop coordinate readout.
      const vp = this.h.viewportAt(p.x, p.y);
      this.hover = vp ? { vp, wx: vp.screenToWorldX(p.x), wy: vp.screenToWorldY(p.y) } : null;
      return;
    }

    const dx = p.x - rec.x;
    const dy = p.y - rec.y;
    rec.x = p.x;
    rec.y = p.y;
    if (Math.hypot(p.x - rec.startX, p.y - rec.startY) > TAP_MAX_MOVE_PX) {
      rec.moved = true;
      this._clearLongPress();
    }

    if (!this.activeViewport) return;

    if (this.pointers.size >= 2) {
      // Pinch: scale by the change in finger separation, anchored at the midpoint.
      const dist = this._pinchDistance();
      const mid = this._pinchMidpoint();
      if (this.pinchStartDist > 0 && dist > 0) {
        this.activeViewport.zoomAt(mid.x, mid.y, dist / this.pinchStartDist);
      }
      this.pinchStartDist = dist;
      // Two-finger drag also pans, using the midpoint motion.
      if (this._lastMid) this.activeViewport.panByScreen(mid.x - this._lastMid.x, mid.y - this._lastMid.y);
      this._lastMid = mid;
    } else if (this.toolDragging) {
      this._emitDragTool(p, 'move');
    } else {
      this.activeViewport.panByScreen(dx, dy);
    }
  }

  _up(e) {
    const rec = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    this.canvas.releasePointerCapture?.(e.pointerId);
    this._clearLongPress();

    if (rec && this.activeViewport) {
      const heldMs = performance.now() - rec.startTime;
      if (this.toolDragging) {
        this._emitDragTool({ x: rec.x, y: rec.y }, 'end');
      } else if (!rec.moved && heldMs < TAP_MAX_MS && this.pointers.size === 0) {
        this._emit('onTap', { x: rec.x, y: rec.y });
      }
    }

    if (this.pointers.size === 0) {
      this.activeViewport = null;
      this.toolDragging = false;
      this._lastMid = null;
    } else if (this.pointers.size === 1) {
      this.pinchStartDist = 0;
      this._lastMid = null;
    }
  }

  _leave() {
    this.hover = null;
  }

  _wheel(e) {
    const p = this._local(e);
    const vp = this.h.viewportAt(p.x, p.y);
    if (!vp) return;
    e.preventDefault();
    // Normalise the three deltaMode units so a mouse wheel and a trackpad feel similar.
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1;
    vp.zoomAt(p.x, p.y, Math.exp(-e.deltaY * unit * 0.0016));
  }

  _emit(name, p) {
    const vp = this.activeViewport;
    if (!vp || !this.h[name]) return;
    this.h[name](vp, vp.screenToWorldX(p.x), vp.screenToWorldY(p.y));
  }

  _emitDragTool(p, phase) {
    const vp = this.activeViewport;
    if (!vp || !this.h.onDragTool) return;
    this.h.onDragTool(vp, vp.screenToWorldX(p.x), vp.screenToWorldY(p.y), phase);
  }

  _pinchDistance() {
    const [a, b] = [...this.pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  _pinchMidpoint() {
    const [a, b] = [...this.pointers.values()];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }
}

/** Keyboard shortcuts, for the desktop half of "mobile and desktop friendly". */
export function bindKeys(map) {
  const handler = (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    const fn = map[e.key] || map[e.key.toLowerCase()];
    if (fn) {
      e.preventDefault();
      fn(e);
    }
  };
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}
