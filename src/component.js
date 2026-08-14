import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Plus, Trash2, Copy, Check, AlertCircle, X, ChevronRight, ChevronDown } from 'lucide-react';
import { parseSerialized, serializeNode, validateNode } from './php-serialize';

const TYPE_BADGES = {
  string: { label: 'string', cls: 'bg-sky-100 text-sky-700 border-sky-200' },
  int: { label: 'int', cls: 'bg-violet-100 text-violet-700 border-violet-200' },
  float: { label: 'float', cls: 'bg-cyan-100 text-cyan-700 border-cyan-200' },
  bool: { label: 'bool', cls: 'bg-amber-100 text-amber-700 border-amber-200' },
  null: { label: 'null', cls: 'bg-slate-200 text-slate-600 border-slate-300' },
  array: { label: 'array', cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  object: { label: 'object', cls: 'bg-fuchsia-100 text-fuchsia-700 border-fuchsia-200' },
  reference: { label: 'ref', cls: 'bg-rose-100 text-rose-700 border-rose-200' },
};

// Types offered in the "add child" menu (references are preserved read-only,
// not creatable; they can only come from parsed input).
const ADDABLE_TYPES = ['string', 'int', 'float', 'bool', 'null', 'array', 'object'];

const VALUE_INPUT_CLS =
  'p-1.5 border rounded-md text-sm font-mono shadow-sm transition ' +
  'focus:ring-2 ' +
  'border-slate-300 focus:border-indigo-500 focus:ring-indigo-200/60';
const VALUE_INPUT_INVALID_CLS =
  'p-1.5 border rounded-md text-sm font-mono shadow-sm transition ' +
  'focus:ring-2 ' +
  'border-rose-400 focus:border-rose-500 focus:ring-rose-200/60';

const SerializedArrayEditor = () => {
  // Separate input and output so input doesn't get auto-overwritten
  const [inputSerialized, setInputSerialized] = useState('');
  const [root, setRoot] = useState(null);
  // Error bar: current error message, visible but out of the way at the
  // bottom of the card. Updates in place — no toast spam while typing.
  const [errorBar, setErrorBar] = useState(null); // { kind, message, id }
  const [expanded, setExpanded] = useState(() => new Set());
  const [copied, setCopied] = useState(false);
  // Per-container remembered "add child" type selection
  const [addTypes, setAddTypes] = useState({});
  const nextId = useRef(1);

  // Compute output from root; avoid effect-driven state to prevent render loops
  const output = useMemo(() => {
    if (!root) return { text: '', error: '' };
    try {
      return { text: serializeNode(root), error: '' };
    } catch (e) {
      return { text: '', error: e.message };
    }
  }, [root]);

  // Surface serialization errors in the error bar (invalid values also show
  // inline on their row via validateNode).
  useEffect(() => {
    if (output.error) {
      setErrorBar({ kind: 'serialize', message: output.error, id: Date.now() });
    } else {
      setErrorBar((b) => (b && b.kind === 'serialize' ? null : b));
    }
  }, [output.error]);

  // --- node tree plumbing ---------------------------------------------------

  // Attach stable ids to a parsed node tree (parse returns plain data).
  const toTree = (node) => {
    const out = { ...node, id: nextId.current++ };
    if (node.children) out.children = node.children.map((c) => ({ ...toTree(c), key: c.key }));
    return out;
  };

  const collectContainerIds = (node) => {
    const ids = new Set();
    if (node.type === 'array' || node.type === 'object') {
      ids.add(node.id);
      node.children.forEach((c) => collectContainerIds(c).forEach((id) => ids.add(id)));
    }
    return ids;
  };

  // Immutably apply fn to the node with the given id anywhere in the tree.
  const updateNode = (node, id, fn) => {
    if (node.id === id) return fn(node);
    if (node.children) {
      return { ...node, children: node.children.map((c) => updateNode(c, id, fn)) };
    }
    return node;
  };

  const patch = (id, fn) => setRoot((r) => (r ? updateNode(r, id, fn) : r));

  // --- input parsing ---------------------------------------------------------

  const handleSerializedInput = (value) => {
    setInputSerialized(value);
    const trimmed = value.trim();
    if (!trimmed) {
      setRoot(null);
      setErrorBar((b) => (b && b.kind === 'parse' ? null : b));
      return;
    }
    try {
      const parsed = parseSerialized(trimmed);
      const tree = toTree(parsed);
      setRoot(tree);
      setExpanded(collectContainerIds(tree)); // expand everything on paste
      setErrorBar((b) => (b && b.kind === 'parse' ? null : b));
    } catch (e) {
      setRoot(null);
      setErrorBar({ kind: 'parse', message: e.message, id: Date.now() });
    }
  };

  // --- tree edits ------------------------------------------------------------

  const setValue = (id, value) => patch(id, (n) => ({ ...n, value }));
  const setKey = (id, key) => patch(id, (n) => ({ ...n, key }));
  const setClassName = (id, className) => patch(id, (n) => ({ ...n, className }));

  const toggleExpanded = (id) =>
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });

  const makeChild = (type) => {
    const id = nextId.current++;
    switch (type) {
      case 'int':
        return { id, type, key: '', value: '0' };
      case 'float':
        return { id, type, key: '', value: '0' };
      case 'bool':
        return { id, type, key: '', value: 'true' };
      case 'null':
        return { id, type, key: '', value: '' };
      case 'array':
        return { id, type, key: '', children: [] };
      case 'object':
        return { id, type, key: '', className: 'stdClass', children: [] };
      case 'string':
      default:
        return { id, type: 'string', key: '', value: '' };
    }
  };

  const addChild = (parentId, type) => {
    patch(parentId, (p) => {
      const child = makeChild(type);
      // Default key: next index for arrays, empty property name for objects.
      child.key = p.type === 'object' ? '' : String(p.children.length);
      return { ...p, children: [...p.children, child] };
    });
    setExpanded((s) => new Set(s).add(parentId));
  };

  const deleteChild = (parentId, childId) =>
    patch(parentId, (p) => ({ ...p, children: p.children.filter((c) => c.id !== childId) }));

  // --- clipboard ---------------------------------------------------------------

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(output.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      setErrorBar({ kind: 'action', message: 'Could not copy to clipboard', id: Date.now() });
    }
  };

  // --- tree rendering ------------------------------------------------------------

  const renderValueEditor = (node, invalid) => {
    const cls = invalid ? VALUE_INPUT_INVALID_CLS : VALUE_INPUT_CLS;
    switch (node.type) {
      case 'string':
        return (
          <input
            type="text"
            value={node.value}
            onChange={(e) => setValue(node.id, e.target.value)}
            className={`flex-1 min-w-0 ${cls}`}
            placeholder="Value"
          />
        );
      case 'int':
        return (
          <input
            type="text"
            inputMode="numeric"
            value={node.value}
            onChange={(e) => setValue(node.id, e.target.value)}
            className={`flex-1 min-w-0 ${cls}`}
            placeholder="Integer"
            title="Whole number, e.g. 42 or -7"
          />
        );
      case 'float':
        return (
          <input
            type="text"
            inputMode="decimal"
            value={node.value}
            onChange={(e) => setValue(node.id, e.target.value)}
            className={`flex-1 min-w-0 ${cls}`}
            placeholder="Number"
            title="Decimal number; INF, -INF and NAN also accepted"
          />
        );
      case 'bool':
        return (
          <select
            value={node.value}
            onChange={(e) => setValue(node.id, e.target.value)}
            className={`${cls} flex-shrink-0`}
          >
            <option value="true">true</option>
            <option value="false">false</option>
          </select>
        );
      case 'null':
        return <span className="text-sm text-slate-400 italic flex-shrink-0">null</span>;
      case 'reference':
        return (
          <span className="text-sm text-slate-500 flex-shrink-0">
            reference #{node.value} (read-only)
          </span>
        );
      case 'array':
        return (
          <span className="text-sm text-slate-500 flex-shrink-0">
            {node.children.length} item{node.children.length === 1 ? '' : 's'}
          </span>
        );
      case 'object':
        return (
          <div className="flex-1 min-w-0 flex items-center gap-2">
            <input
              type="text"
              value={node.className}
              onChange={(e) => setClassName(node.id, e.target.value)}
              className={`w-44 ${cls}`}
              placeholder="Class name"
              title="PHP class name, e.g. stdClass"
            />
            <span className="text-sm text-slate-500 flex-shrink-0">
              {node.children.length} prop{node.children.length === 1 ? '' : 's'}
            </span>
          </div>
        );
      default:
        return null;
    }
  };

  const renderAddControls = (node) => {
    const chosen = addTypes[node.id] ?? 'string';
    return (
      <div className="flex items-center gap-1 flex-shrink-0">
        <select
          value={chosen}
          onChange={(e) => setAddTypes((m) => ({ ...m, [node.id]: e.target.value }))}
          className="p-1.5 text-xs border border-slate-300 rounded-md bg-white text-slate-700 shadow-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200/60 transition"
          title="Type of new child"
        >
          {ADDABLE_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <button
          onClick={() => addChild(node.id, chosen)}
          className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-md transition"
          title="Add child"
          aria-label="Add child"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>
    );
  };

  const renderNode = (node, depth, parentId) => {
    const badge = TYPE_BADGES[node.type];
    const isContainer = node.type === 'array' || node.type === 'object';
    const isExpanded = isContainer && expanded.has(node.id);
    const invalid = validateNode(node);
    const indent = depth * 20;
    const rowCls = invalid
      ? 'border-rose-300 bg-rose-50/60'
      : 'border-slate-200 bg-white hover:bg-slate-50/70';

    return (
      <div key={node.id}>
        <div
          className={`flex items-center gap-2 border rounded-lg p-2 transition-colors ${rowCls}`}
          style={{ marginLeft: indent }}
        >
          {isContainer ? (
            <button
              onClick={() => toggleExpanded(node.id)}
              className="p-0.5 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100 flex-shrink-0"
              title={isExpanded ? 'Collapse' : 'Expand'}
              aria-label={isExpanded ? 'Collapse' : 'Expand'}
            >
              {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </button>
          ) : (
            <span className="w-5 flex-shrink-0" />
          )}

          {parentId !== null && (
            <input
              type="text"
              value={node.key}
              onChange={(e) => setKey(node.id, e.target.value)}
              className={`w-28 flex-shrink-0 ${VALUE_INPUT_CLS}`}
              placeholder={node.type === 'object' ? 'prop' : 'key'}
              title={
                node.type === 'object'
                  ? 'Property name (always serialized as a string key)'
                  : 'Key — numeric keys serialize as i:, everything else as s:'
              }
            />
          )}

          <span
            className={`text-[11px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full border flex-shrink-0 ${badge.cls}`}
          >
            {badge.label}
          </span>

          {renderValueEditor(node, invalid)}

          {isContainer && renderAddControls(node)}

          {parentId !== null && (
            <button
              onClick={() => deleteChild(parentId, node.id)}
              className="p-1.5 text-rose-600 hover:bg-rose-50 rounded-md transition flex-shrink-0"
              title="Delete"
              aria-label="Delete"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>

        {invalid && (
          <p className="text-xs text-rose-600 mt-1" style={{ marginLeft: indent + 40 }}>
            {invalid}
          </p>
        )}

        {isContainer && isExpanded && (
          <div className="mt-1.5 ml-5 pl-3 border-l-2 border-slate-100 space-y-1.5">
            {node.children.length === 0 ? (
              <p className="text-xs text-slate-400 italic">
                Empty — add a child with the + button on the row above
              </p>
            ) : (
              node.children.map((c) => renderNode(c, depth + 1, node.id))
            )}
          </div>
        )}
      </div>
    );
  };

  // --- layout -----------------------------------------------------------------

  return (
    <div className="h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 p-6 flex flex-col">
      <div className="max-w-6xl mx-auto w-full flex-1 flex flex-col min-h-0">
        <div className="bg-white rounded-xl shadow-xl border border-slate-200 flex flex-col h-full overflow-hidden">
          <div className="bg-slate-50 border-b border-slate-200 p-6 flex-shrink-0">
            <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-600 to-violet-600">
              PHP Serialized Value Editor
            </h1>
            <p className="text-slate-500 mt-1">
              Full serialize() support — arrays, objects, and scalars, edited as a tree
            </p>
          </div>

          <div className="flex-1 flex flex-col min-h-0 p-6 gap-6">
            {/* Top Section: Input and Output 50/50 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 flex-shrink-0">
              {/* Serialized Input */}
              <div className="flex-1">
                <div className="flex justify-between items-end mb-2 h-8">
                  <label className="block text-sm font-semibold text-slate-700">
                    Serialized Input
                  </label>
                </div>
                <textarea
                  value={inputSerialized}
                  onChange={(e) => handleSerializedInput(e.target.value)}
                  className="w-full h-48 p-3 border border-slate-300 rounded-lg font-mono text-sm shadow-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200/60 transition resize-none"
                  placeholder={'Paste any PHP serialize() output here, e.g. a:2:{i:0;s:5:"hello";i:1;s:3:"foo";}'}
                />
              </div>

              {/* Serialized Output */}
              <div className="flex-1">
                <div className="flex justify-between items-end mb-2 h-8">
                  <label className="text-sm font-semibold text-slate-700">
                    Serialized Output (Live)
                  </label>
                  <button
                    onClick={copyToClipboard}
                    disabled={!output.text.trim()}
                    className="flex items-center gap-2 px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {copied ? (
                      <>
                        <Check className="w-4 h-4" />
                        Copied!
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4" />
                        Copy
                      </>
                    )}
                  </button>
                </div>
                <textarea
                  value={output.text}
                  readOnly
                  className="w-full h-48 p-3 border border-slate-200 rounded-lg font-mono text-sm bg-slate-50 text-slate-700 resize-none"
                  placeholder="Serialized output appears here as you edit the tree"
                />
              </div>
            </div>

            {/* Bottom Section: Tree view */}
            {root && (
              <div className="flex-1 flex flex-col min-h-0">
                <div className="flex justify-between items-center mb-3 flex-shrink-0">
                  <label className="text-sm font-semibold text-slate-700">Structure</label>
                  <span className="text-xs text-slate-400">
                    Type badges show how each value is serialized
                  </span>
                </div>
                <div className="space-y-1.5 overflow-y-auto flex-1 pr-1 pb-2">
                  {renderNode(root, 0, null)}
                </div>
              </div>
            )}

            {!root && !errorBar && (
              <div className="flex-1 flex items-center justify-center text-slate-400">
                <p className="text-base">Paste a serialized value above to start editing</p>
              </div>
            )}
          </div>

          {/* Error bar — visible, but out of the way at the bottom of the card */}
          {errorBar && (
            <div
              role="alert"
              className="flex-shrink-0 flex items-center gap-2 px-4 py-2.5 bg-rose-50 border-t-2 border-rose-200 text-sm text-rose-700"
            >
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span className="flex-1 min-w-0 truncate" title={errorBar.message}>
                {errorBar.message}
              </span>
              <button
                onClick={() => setErrorBar(null)}
                className="p-1 hover:bg-rose-100 rounded-md transition flex-shrink-0"
                aria-label="Dismiss error"
                title="Dismiss"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export { SerializedArrayEditor };
