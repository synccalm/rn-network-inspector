// diff.js — recursive, git-style structural diff between two JSON values,
// plus a renderer that turns the diff tree into colored DOM (inline or
// single-side, for side-by-side panes).

import { typeOf, isContainerType, copyToClipboard } from './json-tree.js';

function markSubtree(value, status) {
  const type = typeOf(value);
  if (!isContainerType(type)) return undefined;
  const entries = type === 'array' ? value.map((v, i) => [i, v]) : Object.entries(value);
  return entries.map(([k, v]) => ({
    key: k,
    status,
    aValue: status === 'removed' ? v : undefined,
    bValue: status === 'added' ? v : undefined,
    container: isContainerType(typeOf(v)),
    type: typeOf(v),
    children: isContainerType(typeOf(v)) ? markSubtree(v, status) : undefined,
  }));
}

/**
 * Structurally diffs `a` (old/base) against `b` (new/compare). Returns a
 * tree of { status, aValue, bValue, container, type, children }.
 * status is one of: unchanged | added | removed | changed.
 * Objects diff by key; arrays diff by index (v1 keeps this simple rather
 * than attempting a reordering-aware LCS diff).
 */
export function diffValues(a, b) {
  const ta = typeOf(a);
  const tb = typeOf(b);

  if (ta !== tb) {
    return { status: 'changed', aValue: a, bValue: b, container: false, type: tb };
  }

  if (ta === 'object') {
    const keys = Array.from(new Set([...Object.keys(a || {}), ...Object.keys(b || {})]));
    const children = keys.map((k) => {
      const inA = Object.prototype.hasOwnProperty.call(a || {}, k);
      const inB = Object.prototype.hasOwnProperty.call(b || {}, k);
      let child;
      if (inA && inB) {
        child = diffValues(a[k], b[k]);
      } else if (inA) {
        child = {
          status: 'removed',
          aValue: a[k],
          bValue: undefined,
          container: isContainerType(typeOf(a[k])),
          type: typeOf(a[k]),
          children: isContainerType(typeOf(a[k])) ? markSubtree(a[k], 'removed') : undefined,
        };
      } else {
        child = {
          status: 'added',
          aValue: undefined,
          bValue: b[k],
          container: isContainerType(typeOf(b[k])),
          type: typeOf(b[k]),
          children: isContainerType(typeOf(b[k])) ? markSubtree(b[k], 'added') : undefined,
        };
      }
      return Object.assign({ key: k }, child);
    });
    return { status: 'unchanged', aValue: a, bValue: b, container: true, type: 'object', children };
  }

  if (ta === 'array') {
    const maxLen = Math.max(a.length, b.length);
    const children = [];
    for (let i = 0; i < maxLen; i++) {
      const inA = i < a.length;
      const inB = i < b.length;
      let child;
      if (inA && inB) {
        child = diffValues(a[i], b[i]);
      } else if (inA) {
        child = {
          status: 'removed',
          aValue: a[i],
          bValue: undefined,
          container: isContainerType(typeOf(a[i])),
          type: typeOf(a[i]),
          children: isContainerType(typeOf(a[i])) ? markSubtree(a[i], 'removed') : undefined,
        };
      } else {
        child = {
          status: 'added',
          aValue: undefined,
          bValue: b[i],
          container: isContainerType(typeOf(b[i])),
          type: typeOf(b[i]),
          children: isContainerType(typeOf(b[i])) ? markSubtree(b[i], 'added') : undefined,
        };
      }
      children.push(Object.assign({ key: i }, child));
    }
    return { status: 'unchanged', aValue: a, bValue: b, container: true, type: 'array', children };
  }

  // primitive
  const equal = a === b;
  return { status: equal ? 'unchanged' : 'changed', aValue: a, bValue: b, container: false, type: ta };
}

export function countChanges(node) {
  if (!node.children) return node.status === 'unchanged' ? 0 : 1;
  return node.children.reduce((sum, c) => sum + countChanges(c), 0);
}

function formatPrimitive(value, type) {
  if (type === 'string') return JSON.stringify(value);
  if (type === 'null' || value === undefined) return 'null';
  return String(value);
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
    copyToClipboard(JSON.stringify(value, null, 2)).then(() => onCopied && onCopied());
  });
  return btn;
}

/**
 * Renders a diff node. `side` is:
 *  - undefined  → inline mode: shows both old (struck through) and new
 *    values on changed lines, skips nothing.
 *  - 'a' or 'b' → single-side mode (for side-by-side panes): only shows
 *    entries that exist on that side, using that side's value.
 */
export function buildDiffNode(diffNode, side, depth, collapseAfterDepth, onCopy) {
  const node = document.createElement('div');
  const statusClass =
    diffNode.status === 'added' || diffNode.status === 'removed' || diffNode.status === 'changed'
      ? `diff-${diffNode.status}`
      : '';
  node.className = `json-node${statusClass ? ' ' + statusClass : ''}`;

  // In single-side mode, an "added" node doesn't exist on side 'a', and a
  // "removed" node doesn't exist on side 'b' — skip entirely.
  if (side === 'a' && diffNode.status === 'added') return null;
  if (side === 'b' && diffNode.status === 'removed') return null;

  const line = document.createElement('div');
  line.className = 'json-line';
  node.appendChild(line);

  const gutter = document.createElement('span');
  gutter.className = 'diff-gutter';
  gutter.textContent =
    diffNode.status === 'added' ? '+' : diffNode.status === 'removed' ? '−' : diffNode.status === 'changed' ? '~' : ' ';
  line.appendChild(gutter);

  const toggle = document.createElement('span');
  toggle.className = 'tree-toggle';
  line.appendChild(toggle);

  if (diffNode.key !== null && diffNode.key !== undefined) {
    const keyEl = document.createElement('span');
    keyEl.className = 'json-key';
    keyEl.textContent = (typeof diffNode.key === 'number' ? `[${diffNode.key}]` : JSON.stringify(diffNode.key)) + ': ';
    line.appendChild(keyEl);
  }

  if (diffNode.container && diffNode.children) {
    const type = diffNode.type;
    const openPunct = document.createElement('span');
    openPunct.className = 'json-punct';
    openPunct.textContent = type === 'array' ? '[' : '{';
    line.appendChild(openPunct);

    const relevantChildren = diffNode.children.filter((c) => {
      if (side === 'a') return c.status !== 'added';
      if (side === 'b') return c.status !== 'removed';
      return true;
    });

    const changeCount = diffNode.children.reduce((sum, c) => sum + countChanges(c), 0);
    const preview = document.createElement('span');
    preview.className = 'json-preview';
    preview.textContent = ` ${relevantChildren.length} ${relevantChildren.length === 1 ? 'item' : 'items'}${
      changeCount ? `, ${changeCount} changed` : ''
    } ${type === 'array' ? ']' : '}'}`;
    line.appendChild(preview);

    if (!relevantChildren.length) {
      const closePunct = document.createElement('span');
      closePunct.className = 'json-punct';
      closePunct.textContent = type === 'array' ? ']' : '}';
      line.appendChild(closePunct);
    } else {
      toggle.textContent = '▾';
    }

    line.appendChild(
      makeCopyButton(
        () => (side === 'a' ? diffNode.aValue : side === 'b' ? diffNode.bValue : { old: diffNode.aValue, new: diffNode.bValue }),
        onCopy
      )
    );

    if (relevantChildren.length) {
      const childrenEl = document.createElement('div');
      childrenEl.className = 'json-children';
      relevantChildren.forEach((c) => {
        const childNode = buildDiffNode(c, side, depth + 1, collapseAfterDepth, onCopy);
        if (childNode) childrenEl.appendChild(childNode);
      });
      node.appendChild(childrenEl);

      const closeLine = document.createElement('div');
      closeLine.className = 'json-line json-close-line';
      const closeSpacer = document.createElement('span');
      closeSpacer.className = 'tree-toggle';
      closeLine.appendChild(closeSpacer);
      const closePunct2 = document.createElement('span');
      closePunct2.className = 'json-punct';
      closePunct2.textContent = type === 'array' ? ']' : '}';
      closeLine.appendChild(closePunct2);
      node.appendChild(closeLine);

      const hasNestedChange = changeCount > 0;
      if (!hasNestedChange && depth >= (collapseAfterDepth ?? 2)) {
        node.classList.add('collapsed');
        toggle.textContent = '▸';
      }

      toggle.addEventListener('click', () => {
        node.classList.toggle('collapsed');
        toggle.textContent = node.classList.contains('collapsed') ? '▸' : '▾';
      });
      line.addEventListener('dblclick', () => toggle.click());
    }
  } else if (diffNode.status === 'changed' && side === undefined) {
    const oldEl = document.createElement('span');
    oldEl.className = 'diff-old-value';
    oldEl.textContent = formatPrimitive(diffNode.aValue, typeOf(diffNode.aValue));
    line.appendChild(oldEl);

    const arrow = document.createElement('span');
    arrow.className = 'json-punct';
    arrow.textContent = '→ ';
    line.appendChild(arrow);

    const newEl = document.createElement('span');
    newEl.className = 'diff-new-value';
    newEl.textContent = formatPrimitive(diffNode.bValue, typeOf(diffNode.bValue));
    line.appendChild(newEl);

    line.appendChild(makeCopyButton(() => diffNode.bValue, onCopy));
  } else {
    const value = side === 'a' ? diffNode.aValue : side === 'b' ? diffNode.bValue : diffNode.status === 'removed' ? diffNode.aValue : diffNode.bValue;
    const valueEl = document.createElement('span');
    valueEl.className = `json-${typeOf(value)}`;
    valueEl.textContent = formatPrimitive(value, typeOf(value));
    line.appendChild(valueEl);
    line.appendChild(makeCopyButton(() => value, onCopy));
  }

  return node;
}

export function renderDiffTree(container, diffNode, side, onCopy) {
  container.innerHTML = '';
  const wrapper = document.createElement('div');
  wrapper.className = 'json-tree';
  const root = buildDiffNode(diffNode, side, 0, 3, onCopy);
  if (root) wrapper.appendChild(root);
  container.appendChild(wrapper);
}
