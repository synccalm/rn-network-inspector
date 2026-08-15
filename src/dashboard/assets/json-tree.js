// json-tree.js — collapsible JSON tree view: expand/collapse nodes,
// per-type syntax highlighting, and a copy button on every node/subtree.
// No dependencies, no framework — plain DOM.

export function typeOf(value) {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

export function isContainerType(t) {
  return t === 'object' || t === 'array';
}

function formatPrimitive(value, type) {
  if (type === 'string') return JSON.stringify(value);
  if (type === 'null') return 'null';
  return String(value);
}

export function copyToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text);
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
  } catch (e) {
    // ignore
  }
  document.body.removeChild(ta);
  return Promise.resolve();
}

function makeCopyButton(getValue, onCopied) {
  const btn = document.createElement('button');
  btn.className = 'copy-btn';
  btn.type = 'button';
  btn.title = 'Copy as JSON';
  btn.textContent = '⧉';
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const value = getValue();
    const text = typeof value === 'string' && isContainerType(typeOf(value)) === false
      ? value
      : JSON.stringify(value, null, 2);
    copyToClipboard(text).then(() => onCopied && onCopied());
  });
  return btn;
}

function entriesOf(value, type) {
  return type === 'array' ? value.map((v, i) => [i, v]) : Object.entries(value);
}

/**
 * Renders a single JSON node (and its children, recursively) as a DOM tree.
 * `opts.collapseAfterDepth` (default 3) auto-collapses deeply nested nodes
 * so large payloads don't render fully expanded by default.
 */
export function buildJsonNode(key, value, opts, depth) {
  const options = opts || {};
  const collapseAfterDepth = options.collapseAfterDepth ?? 3;
  const type = typeOf(value);
  const node = document.createElement('div');
  node.className = 'json-node';

  const line = document.createElement('div');
  line.className = 'json-line';
  node.appendChild(line);

  const toggle = document.createElement('span');
  toggle.className = 'tree-toggle';
  line.appendChild(toggle);

  if (key !== null && key !== undefined) {
    const keyEl = document.createElement('span');
    keyEl.className = 'json-key';
    keyEl.textContent = (typeof key === 'number' ? `[${key}]` : JSON.stringify(key)) + ': ';
    line.appendChild(keyEl);
  }

  if (isContainerType(type)) {
    const entries = entriesOf(value, type);
    const openPunct = document.createElement('span');
    openPunct.className = 'json-punct';
    openPunct.textContent = type === 'array' ? `[` : `{`;
    line.appendChild(openPunct);

    const preview = document.createElement('span');
    preview.className = 'json-preview';
    preview.textContent = ` ${entries.length} ${entries.length === 1 ? 'item' : 'items'} ${
      type === 'array' ? ']' : '}'
    }`;
    line.appendChild(preview);

    if (entries.length === 0) {
      const closePunct = document.createElement('span');
      closePunct.className = 'json-punct';
      closePunct.textContent = type === 'array' ? ']' : '}';
      line.appendChild(closePunct);
    } else {
      toggle.textContent = '▾';
    }

    line.appendChild(makeCopyButton(() => value, options.onCopy));

    if (entries.length) {
      const children = document.createElement('div');
      children.className = 'json-children';
      entries.forEach(([k, v]) => {
        children.appendChild(buildJsonNode(k, v, options, depth + 1));
      });
      node.appendChild(children);

      const closeLine = document.createElement('div');
      closeLine.className = 'json-line json-close-line';
      const closeSpacer = document.createElement('span');
      closeSpacer.className = 'tree-toggle';
      closeLine.appendChild(closeSpacer);
      const closePunct = document.createElement('span');
      closePunct.className = 'json-punct';
      closePunct.textContent = type === 'array' ? ']' : '}';
      closeLine.appendChild(closePunct);
      node.appendChild(closeLine);

      if (depth >= collapseAfterDepth) {
        node.classList.add('collapsed');
        toggle.textContent = '▸';
      }

      toggle.addEventListener('click', () => {
        node.classList.toggle('collapsed');
        toggle.textContent = node.classList.contains('collapsed') ? '▸' : '▾';
      });
      line.addEventListener('dblclick', () => toggle.click());
    }
  } else {
    const valueEl = document.createElement('span');
    valueEl.className = `json-${type}`;
    valueEl.textContent = formatPrimitive(value, type);
    line.appendChild(valueEl);
    line.appendChild(makeCopyButton(() => value, options.onCopy));
  }

  return node;
}

/**
 * Clears `container` and renders `value` as a collapsible JSON tree.
 */
export function renderJsonTree(container, value, opts) {
  container.innerHTML = '';
  if (value === undefined) {
    const empty = document.createElement('div');
    empty.className = 'json-null mono';
    empty.textContent = '(no body)';
    container.appendChild(empty);
    return;
  }
  const wrapper = document.createElement('div');
  wrapper.className = 'json-tree';
  wrapper.appendChild(buildJsonNode(null, value, opts, 0));
  container.appendChild(wrapper);
}

function expandAncestors(startNode) {
  let current = startNode;
  while (current) {
    const wrapper = current.parentElement;
    if (!wrapper) break;
    const ancestor = wrapper.closest('.json-node');
    if (!ancestor || ancestor === current) break;
    ancestor.classList.remove('collapsed');
    const toggle = ancestor.querySelector(':scope > .json-line > .tree-toggle');
    if (toggle && toggle.textContent === '▸') toggle.textContent = '▾';
    current = ancestor;
  }
}

/**
 * Removes any highlighting previously applied by applySearch(), restoring
 * the tree's original text nodes.
 */
export function clearSearch(rootEl) {
  rootEl.querySelectorAll('mark.json-match').forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    parent.replaceChild(document.createTextNode(mark.textContent), mark);
    parent.normalize();
  });
}

/**
 * Case-insensitive substring search over every key and primitive value
 * currently rendered under `rootEl`. Wraps matches in <mark class="json-match">,
 * and expands any collapsed ancestor so every match stays visible. Returns
 * the number of matches found (query the resulting `mark.json-match`
 * elements, in document order, to step through them).
 */
export function applySearch(rootEl, query) {
  clearSearch(rootEl);
  if (!query) return 0;

  const q = query.toLowerCase();
  const candidates = rootEl.querySelectorAll('.json-key, .json-string, .json-number, .json-boolean, .json-null');
  let count = 0;

  candidates.forEach((el) => {
    const text = el.textContent;
    const lower = text.toLowerCase();
    if (!lower.includes(q)) return;

    const frag = document.createDocumentFragment();
    let cursor = 0;
    let idx = lower.indexOf(q);
    while (idx !== -1) {
      if (idx > cursor) frag.appendChild(document.createTextNode(text.slice(cursor, idx)));
      const mark = document.createElement('mark');
      mark.className = 'json-match';
      mark.textContent = text.slice(idx, idx + query.length);
      frag.appendChild(mark);
      count++;
      cursor = idx + query.length;
      idx = lower.indexOf(q, cursor);
    }
    if (cursor < text.length) frag.appendChild(document.createTextNode(text.slice(cursor)));

    el.textContent = '';
    el.appendChild(frag);
    expandAncestors(el.closest('.json-node'));
  });

  return count;
}
