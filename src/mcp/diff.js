'use strict';

/**
 * Structural diff for MCP output — deliberately separate from
 * dashboard/assets/diff.js, which is browser-only (ESM, builds a DOM tree
 * for rendering). This one is a plain Node/CJS module and produces a flat
 * list of leaf-level changes rather than a rendering-oriented nested tree:
 * exactly the shape a model should reason over, not a UI needs to draw.
 */

function typeOf(value) {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/**
 * Diffs `a` (old/base) against `b` (new/compare) and returns a flat array
 * of `{ path, status, oldValue?, newValue? }` — one entry per changed leaf.
 * Unchanged values produce no entries at all.
 */
function flattenDiff(a, b, basePath) {
  const path = basePath || '';
  const ta = typeOf(a);
  const tb = typeOf(b);

  if (ta !== tb) {
    return [{ path: path || '$', status: 'changed', oldValue: a, newValue: b }];
  }

  if (ta === 'object') {
    const changes = [];
    const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
    for (const key of keys) {
      const childPath = path ? `${path}.${key}` : key;
      const inA = Object.prototype.hasOwnProperty.call(a || {}, key);
      const inB = Object.prototype.hasOwnProperty.call(b || {}, key);
      if (inA && !inB) changes.push({ path: childPath, status: 'removed', oldValue: a[key] });
      else if (!inA && inB) changes.push({ path: childPath, status: 'added', newValue: b[key] });
      else changes.push(...flattenDiff(a[key], b[key], childPath));
    }
    return changes;
  }

  if (ta === 'array') {
    const changes = [];
    const maxLen = Math.max(a.length, b.length);
    for (let i = 0; i < maxLen; i++) {
      const childPath = `${path}[${i}]`;
      if (i >= a.length) changes.push({ path: childPath, status: 'added', newValue: b[i] });
      else if (i >= b.length) changes.push({ path: childPath, status: 'removed', oldValue: a[i] });
      else changes.push(...flattenDiff(a[i], b[i], childPath));
    }
    return changes;
  }

  if (a !== b) {
    return [{ path: path || '$', status: 'changed', oldValue: a, newValue: b }];
  }
  return [];
}

function summarize(changes) {
  const summary = { added: 0, removed: 0, changed: 0 };
  for (const c of changes) summary[c.status] = (summary[c.status] || 0) + 1;
  summary.total = changes.length;
  return summary;
}

module.exports = { flattenDiff, summarize };
