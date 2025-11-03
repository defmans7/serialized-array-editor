import React, { useState, useEffect } from 'react';
import { Plus, Trash2, Copy, Check, AlertCircle } from 'lucide-react';

const SerializedArrayEditor = () => {
  const [serialized, setSerialized] = useState('');
  const [items, setItems] = useState([]);
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

  // Initial parse
  useEffect(() => {
    if (serialized) {
      try {
        const parsed = parseSerializedArray(serialized);
        setItems(parsed);
        setError('');
      } catch (e) {
        setError(e.message);
      }
    }
  }, []);

  // Live update serialized output when items change
  useEffect(() => {
    if (items.length > 0) {
      setSerialized(serializeArray(items));
    }
  }, [items]);

  const handleSerializedInput = (value) => {
    setSerialized(value);
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
    navigator.clipboard.writeText(serialized);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 p-6">
      <div className="max-w-6xl mx-auto">
        <div className="bg-white rounded-lg shadow-2xl overflow-hidden">
          <div className="bg-gradient-to-r from-blue-600 to-purple-600 p-6">
            <h1 className="text-3xl font-bold text-white">PHP Serialized Array Editor</h1>
            <p className="text-blue-100 mt-2">Live editing with instant serialization</p>
          </div>

          <div className="p-6 space-y-6">
            {/* Serialized Input */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Serialized Array Input
              </label>
              <textarea
                value={serialized}
                onChange={(e) => handleSerializedInput(e.target.value)}
                className="w-full h-32 p-3 border-2 border-gray-300 rounded-lg font-mono text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition"
                placeholder="Paste your serialized array here..."
              />
              {error && (
                <div className="mt-2 flex items-center gap-2 text-red-600 text-sm">
                  <AlertCircle className="w-4 h-4" />
                  {error}
                </div>
              )}
            </div>

            {/* Array Items Editor */}
            {items.length > 0 && (
              <div>
                <div className="flex justify-between items-center mb-3">
                  <label className="text-sm font-semibold text-gray-700">
                    Array Items ({items.length})
                  </label>
                  <button
                    onClick={addItem}
                    className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition"
                  >
                    <Plus className="w-4 h-4" />
                    Add Item
                  </button>
                </div>

                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {items.map((item, idx) => (
                    <div key={idx} className="flex gap-2 items-center bg-gray-50 p-3 rounded-lg">
                      <span className="text-sm font-mono text-gray-500 w-12">[{idx}]</span>
                      <input
                        type="text"
                        value={item.value}
                        onChange={(e) => updateItem(idx, e.target.value)}
                        className="flex-1 p-2 border border-gray-300 rounded font-mono text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition"
                        placeholder="Enter value..."
                      />
                      <button
                        onClick={() => deleteItem(idx)}
                        className="p-2 text-red-600 hover:bg-red-50 rounded transition"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Serialized Output */}
            {items.length > 0 && (
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="text-sm font-semibold text-gray-700">
                    Serialized Output (Live)
                  </label>
                  <button
                    onClick={copyToClipboard}
                    className="flex items-center gap-2 px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 transition"
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
                  value={serialized}
                  readOnly
                  className="w-full h-32 p-3 border-2 border-gray-300 rounded-lg font-mono text-sm bg-gray-50"
                />
              </div>
            )}

            {items.length === 0 && !error && (
              <div className="text-center py-12 text-gray-400">
                <p className="text-lg">Paste a serialized array above to start editing</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export { SerializedArrayEditor };