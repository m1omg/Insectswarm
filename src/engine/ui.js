// A very small DOM helper layer for the control panel.
//
// Not a framework — just enough to build sliders, toggles and readouts without string-concatenating
// HTML. Readouts are rebuilt in place each frame from a pull function, so nothing has to remember
// to notify the UI when the simulation changes.

/** el('div.card', {id:'x'}, child, child…) — tag supports .class and #id shorthand. */
export function el(spec, props = null, ...children) {
  const [tag, ...classes] = spec.split('.');
  let name = tag || 'div';
  let id = null;
  if (name.includes('#')) [name, id] = name.split('#');

  const node = document.createElement(name || 'div');
  if (id) node.id = id;
  if (classes.length) node.className = classes.join(' ');

  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'text') node.textContent = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
      else node.setAttribute(k, v === true ? '' : String(v));
    }
  }

  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function section(title, ...children) {
  return el('div.section', null, title && el('h2', { text: title }), ...children);
}

/**
 * Labelled slider. `format` renders the live value; `onInput` receives the number.
 * Values are plain numbers — biological units live in the label, e.g. "Trail half-life (min)".
 */
export function slider(label, { min, max, step = 1, value, format = (v) => String(v), onInput }) {
  const valueEl = el('span.value', { text: format(value) });
  const input = el('input', {
    type: 'range', min, max, step, value,
    oninput: (e) => {
      const v = Number(e.target.value);
      valueEl.textContent = format(v);
      onInput?.(v);
    },
  });
  const wrap = el('label.field', null, label, valueEl, input);
  wrap.setValue = (v) => { input.value = String(v); valueEl.textContent = format(v); };
  return wrap;
}

/** Push-button toggle that reports its state through aria-pressed. */
export function toggle(label, { value = false, onChange, title = '' } = {}) {
  const btn = el('button.chip', {
    type: 'button', 'aria-pressed': value ? 'true' : 'false', title, text: label,
  });
  btn.addEventListener('click', () => {
    const next = btn.getAttribute('aria-pressed') !== 'true';
    btn.setAttribute('aria-pressed', next ? 'true' : 'false');
    onChange?.(next);
  });
  btn.setValue = (v) => btn.setAttribute('aria-pressed', v ? 'true' : 'false');
  return btn;
}

/** Mutually exclusive chip group. */
export function chipGroup(options, { value, onChange } = {}) {
  const chips = [];
  const group = el('div.chips');
  for (const opt of options) {
    const { id, label, title = '' } = typeof opt === 'string' ? { id: opt, label: opt } : opt;
    const chip = el('button.chip', {
      type: 'button', title, text: label, 'aria-pressed': id === value ? 'true' : 'false',
    });
    chip.addEventListener('click', () => {
      for (const c of chips) c.setAttribute('aria-pressed', c === chip ? 'true' : 'false');
      onChange?.(id);
    });
    chips.push(chip);
    group.append(chip);
  }
  group.setValue = (v) => {
    chips.forEach((c, i) => {
      const id = typeof options[i] === 'string' ? options[i] : options[i].id;
      c.setAttribute('aria-pressed', id === v ? 'true' : 'false');
    });
  };
  return group;
}

/**
 * Definition-list readout driven by a pull function returning [[term, value], …].
 * Rows are reused between refreshes so we are not churning DOM nodes at 60 Hz.
 */
export function readout(pull) {
  const dl = el('dl.readout');
  const rows = [];
  dl.refresh = () => {
    const data = pull() || [];
    while (rows.length < data.length) {
      const dt = el('dt');
      const dd = el('dd');
      dl.append(dt, dd);
      rows.push([dt, dd]);
    }
    for (let i = 0; i < rows.length; i++) {
      const [dt, dd] = rows[i];
      if (i < data.length) {
        const [term, value] = data[i];
        if (dt.textContent !== term) dt.textContent = term;
        const text = String(value);
        if (dd.textContent !== text) dd.textContent = text;
        dt.hidden = dd.hidden = false;
      } else {
        dt.hidden = dd.hidden = true;
      }
    }
  };
  dl.refresh();
  return dl;
}

/** A science note with its citation, for the fidelity panel. */
export function note(text, source) {
  return el('p.note', null, text, source && el('cite', { text: source }));
}

/**
 * Bottom-sheet behaviour for narrow screens. On desktop the panel is a static sidebar and this is
 * inert; the handle button is hidden by CSS at wide widths.
 */
export function bindSheet(panel, handle) {
  const setOpen = (open) => {
    panel.classList.toggle('open', open);
    handle.setAttribute('aria-expanded', open ? 'true' : 'false');
  };
  handle.addEventListener('click', () => setOpen(!panel.classList.contains('open')));

  // Dragging the handle down closes it, which is what the gesture implies on a sheet.
  let startY = null;
  handle.addEventListener('pointerdown', (e) => { startY = e.clientY; });
  handle.addEventListener('pointermove', (e) => {
    if (startY == null) return;
    const dy = e.clientY - startY;
    if (Math.abs(dy) > 24) {
      setOpen(dy < 0);
      startY = null;
    }
  });
  handle.addEventListener('pointerup', () => { startY = null; });

  return { setOpen, isOpen: () => panel.classList.contains('open') };
}
