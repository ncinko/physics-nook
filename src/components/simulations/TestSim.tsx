import React, { useState } from 'react';

export default function TestSim() {
  const [count, setCount] = useState(0);
  return (
    <div className="p-4 border-2 border-blue-500 rounded-lg text-center bg-gray-50">
      <h3 className="text-xl font-bold mb-2">Interactive Physics Canvas Goes Here</h3>
      <button 
        className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
        onClick={() => setCount(count + 1)}
      >
        Run Simulation (Clicked {count} times)
      </button>
    </div>
  );
}