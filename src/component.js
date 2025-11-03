import React, { useState, useMemo } from 'react';
import { Plus, Trash2, Copy, Check, AlertCircle } from 'lucide-react';

const SerializedArrayEditor = () => {
  // Separate input and output so input doesn't get auto-overwritten
  const [inputSerialized, setInputSerialized] = useState('');
  const [items, setItems] = useState([]);
  // Compute output from items; avoid effect-driven state to prevent render loops
  const outputSerialized = useMemo(() => {
    if (!items || items.length === 0) return '';
    return serializeArray(items);
  }, [items]);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  // Parse PHP serialized array
  const parseSerializedArray = (str) => {
    try {
      const matches = str.match(/a:(\d+):\{(.+)\}/);
      if (!matches) throw new Error('Invalid serialized array format');
      
      const count = parseInt(matches[1]);
      const content = matches[2];
      const parsed = [];
      
      let pos = 0;
      for (let i = 0; i < count; i++) {
        // Parse key (i:N;)
        const keyMatch = content.slice(pos).match(/^i:(\d+);/);
        if (!keyMatch) break;
        pos += keyMatch[0].length;
        
        // Parse value (s:N:"value";)
        const valueMatch = content.slice(pos).match(/^s:(\d+):"(.+?)";/);
        if (!valueMatch) break;
        const valueLength = parseInt(valueMatch[1]);
        const value = content.slice(pos + valueMatch[0].length - valueLength - 2, pos + valueMatch[0].length - 2);
        pos += valueMatch[0].length;
        
        parsed.push({ key: i, value });
      }
      
      return parsed;
    } catch (e) {
      throw new Error('Failed to parse serialized array');
    }
  };

  // Serialize array back to PHP format
  const serializeArray = (arr) => {
    let serialized = `a:${arr.length}:{`;
    arr.forEach((item, idx) => {
      serialized += `i:${idx};s:${item.value.length}:"${item.value}";`;
    });
    serialized += '}';
    return serialized;
  };

  // No initial parse; only parse when user types/pastes input

  // Removed useEffect that set state based on items to avoid possible update loops

  const handleSerializedInput = (value) => {
    setInputSerialized(value);
    if (value.trim()) {
      try {
        const parsed = parseSerializedArray(value);
        setItems(parsed);
        setError('');
      } catch (e) {
        setError(e.message);
      }
    } else {
      setItems([]);
      setError('');
    }
  };

  const updateItem = (index, value) => {
    const newItems = [...items];
    newItems[index] = { key: index, value };
    setItems(newItems);
  };

  const addItem = () => {
    setItems([...items, { key: items.length, value: '' }]);
  };

  const deleteItem = (index) => {
    const newItems = items.filter((_, i) => i !== index);
    // Reindex keys
    const reindexed = newItems.map((item, idx) => ({ key: idx, value: item.value }));
    setItems(reindexed);
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(outputSerialized);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 p-6 flex flex-col">
      <div className="max-w-6xl mx-auto w-full flex-1 flex flex-col min-h-0">
        <div className="bg-white rounded-xl shadow-xl border border-slate-200 flex flex-col h-full overflow-hidden">
          <div className="bg-slate-50 border-b border-slate-200 p-6 flex-shrink-0">
            <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-600 to-violet-600">PHP Serialized Array Editor</h1>
            <p className="text-slate-500 mt-1">Live editing with instant serialization</p>
          </div>

          <div className="flex-1 flex flex-col min-h-0 p-6 gap-6">
            {/* Top Section: Input and Output 50/50 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 flex-shrink-0">
              {/* Serialized Input */}
              <div className="flex-1">
                <div className="flex justify-between items-end mb-2 h-8">
                  <label className="block text-sm font-semibold text-slate-700">
                    Serialized Array Input
                  </label>
                </div>
                <textarea
                  value={inputSerialized}
                  onChange={(e) => handleSerializedInput(e.target.value)}
                  className="w-full h-48 p-3 border border-slate-300 rounded-lg font-mono text-sm shadow-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200/60 transition resize-none"
                  placeholder="Paste your serialized array here..."
                />
                {error && (
                  <div className="mt-2 flex items-center gap-2 text-red-700 text-sm bg-red-50 border border-red-200 px-3 py-2 rounded-md">
                    <AlertCircle className="w-4 h-4" />
                    {error}
                  </div>
                )}
              </div>

              {/* Serialized Output */}
              <div className="flex-1">
                <div className="flex justify-between items-end mb-2 h-8">
                  <label className="text-sm font-semibold text-slate-700">
                    Serialized Output (Live)
                  </label>
                  <button
                    onClick={copyToClipboard}
                    disabled={!outputSerialized.trim()}
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
                  value={outputSerialized}
                  readOnly
                  className="w-full h-48 p-3 border border-slate-200 rounded-lg font-mono text-sm bg-slate-50 text-slate-700 resize-none"
                />
              </div>
            </div>

            {/* Bottom Section: Scrollable Array Items */}
            {items.length > 0 && (
              <div className="flex-1 flex flex-col min-h-0">
                <div className="flex justify-between items-center mb-3 flex-shrink-0">
                  <label className="text-sm font-semibold text-slate-700">
                    Array Items ({items.length})
                  </label>
                  <button
                    onClick={addItem}
                    className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-md hover:bg-emerald-700 transition shadow-sm"
                  >
                    <Plus className="w-4 h-4" />
                    Add Item
                  </button>
                </div>

                <div className="space-y-2 overflow-y-auto flex-1 pr-1">
                  {items.map((item, idx) => (
                    <div
                      key={idx}
                      className="flex gap-2 items-center bg-white border border-slate-200 p-3 rounded-lg hover:bg-slate-50 transition-colors"
                    >
                      <span className="text-xs font-medium text-slate-600 bg-slate-100 rounded-md px-2 py-1 min-w-[44px] text-center">[{idx}]</span>
                      <input
                        type="text"
                        value={item.value}
                        onChange={(e) => updateItem(idx, e.target.value)}
                        className="flex-1 p-2 border border-slate-300 rounded-md font-mono text-sm shadow-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200/60 transition"
                        placeholder="Enter value..."
                      />
                      <button
                        onClick={() => deleteItem(idx)}
                        className="p-2 text-rose-600 hover:bg-rose-50 rounded-md transition"
                        aria-label={`Delete item ${idx}`}
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {items.length === 0 && !error && (
              <div className="flex-1 flex items-center justify-center text-slate-400">
                <p className="text-base">Paste a serialized array above to start editing</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export { SerializedArrayEditor };