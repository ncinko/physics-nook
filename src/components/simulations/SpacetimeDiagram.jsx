import React, { useState, useRef, useEffect } from 'react';
import { Trash2, Download, Crosshair, Info, Maximize, Minimize, Plus, Minus } from 'lucide-react';

export default function SpacetimeDiagram() {
  const [beta, setBeta] = useState(0.5);
  const [showUnprimedGrid, setShowUnprimedGrid] = useState(true);
  const [showPrimedGrid, setShowPrimedGrid] = useState(true);
  const [fullPrimedGrid, setFullPrimedGrid] = useState(false);
  const [showTicks, setShowTicks] = useState(true);
  const [showLightCone, setShowLightCone] = useState(true);
  const [events, setEvents] = useState([]);
  const [selectedEventId, setSelectedEventId] = useState(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [viewBounds, setViewBounds] = useState(10);
  const [showHint, setShowHint] = useState(true);
  const [activeScenario, setActiveScenario] = useState('custom');
  
  const svgRef = useRef(null);
  const diagramWrapperRef = useRef(null);

  // Scenarios data
  const scenarios = [
    {
      id: 'simultaneity',
      name: 'Relativity of Simultaneity',
      description: "Events A and B happen at the same time in the rest frame (ct = 4). Notice how their primed time coordinates (ct') are different—they are not simultaneous for the moving observer!",
      beta: 0.5,
      events: [
        { name: 'Event A', x: -5, ct: 4 },
        { name: 'Event B', x: 5, ct: 4 }
      ]
    },
    {
      id: 'time_dilation',
      name: 'Time Dilation (Moving Clock)',
      description: "A clock sits at the origin of the moving frame (x' = 0). Watch how its ticks (at ct' = 0, 4, 8) spread out in the rest frame's time (ct = 0, 5, 10).",
      beta: 0.6,
      events: [
        { name: 'Tick 0', x: 0, ct: 0 },
        { name: 'Tick 1', x: 3, ct: 5 },
        { name: 'Tick 2', x: 6, ct: 10 }
      ]
    },
    {
      id: 'length_contraction',
      name: 'Length Contraction',
      description: "Measuring a rod (rest length 10) from the moving frame. To measure length, the moving observer marks the ends at the same time in their frame (ct' = 0). The measured distance is 8.",
      beta: 0.6,
      events: [
        { name: 'Left End', x: -5, ct: -3 },
        { name: 'Right End', x: 5, ct: 3 }
      ]
    }
  ];

  const loadScenario = (scenarioId) => {
    setActiveScenario(scenarioId);
    if (scenarioId === 'custom') return;
    
    const scen = scenarios.find(s => s.id === scenarioId);
    if (scen) {
      setBeta(scen.beta);
      setEvents(scen.events.map((e, index) => ({...e, id: Date.now() + index})));
      setSelectedEventId(null);
    }
  };

  // Math variables
  const gamma = 1 / Math.sqrt(1 - beta * beta);

  // Track Escape key to exit our custom fullscreen
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isFullscreen) {
        setIsFullscreen(false);
        setViewBounds(10);
      }
    };
    
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isFullscreen]);

  // Fade out hint after a few seconds
  useEffect(() => {
    const timer = setTimeout(() => setShowHint(false), 5000);
    return () => clearTimeout(timer);
  }, []);

  const toggleFullscreen = () => {
    // We use a CSS-based pseudo-fullscreen to avoid browser permission policy errors
    setIsFullscreen(!isFullscreen);
    setViewBounds(!isFullscreen ? 7 : 10);
  };

  const handleZoomIn = () => setViewBounds(prev => Math.max(prev - 1, 2));
  const handleZoomOut = () => setViewBounds(prev => Math.min(prev + 1, 30));

  const uiScale = viewBounds / 10;

  // Map SVG click to Math coordinates
  const handleSvgClick = (e) => {
    setShowHint(false); // Dismiss hint immediately if user clicks early
    if (!svgRef.current) return;
    
    setActiveScenario('custom'); // Switch to custom mode if manually adding events
    
    // Check if we clicked an existing event marker
    if (e.target.tagName === 'circle' && e.target.id.startsWith('event-')) {
        const id = parseInt(e.target.id.replace('event-', ''), 10);
        setSelectedEventId(id);
        return;
    }

    const rect = svgRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;
    const pctX = clickX / rect.width;
    const pctY = clickY / rect.height;

    const x = -viewBounds + pctX * (2 * viewBounds);
    const ct = viewBounds - pctY * (2 * viewBounds);

    const newEvent = {
      id: Date.now(),
      name: `E${events.length + 1}`,
      x,
      ct
    };

    setEvents(prev => [...prev, newEvent]);
    setSelectedEventId(newEvent.id);
  };

  const removeEvent = (id) => {
    setEvents(prev => prev.filter(e => e.id !== id));
    if (selectedEventId === id) setSelectedEventId(null);
    setActiveScenario('custom');
  };

  const downloadSVG = () => {
    if (!svgRef.current) return;
    const serializer = new XMLSerializer();
    let source = serializer.serializeToString(svgRef.current);
    
    if (!source.match(/^<svg[^>]+xmlns="http\:\/\/www\.w3\.org\/2000\/svg"/)) {
      source = source.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
    }
    source = '<?xml version="1.0" standalone="no"?>\r\n' + source;
    
    const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(source);
    const link = document.createElement("a");
    link.href = url;
    link.download = `spacetime-beta-${beta.toFixed(2)}.svg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Helper to calculate primed coordinates
  const getPrimedCoords = (x, ct) => {
    return {
      xp: gamma * (x - beta * ct),
      ctp: gamma * (ct - beta * x)
    };
  };

  // Generate Grids
  const unprimedLines = [];
  const primedLines = [];
  const tickMarks = [];
  
  // Unprimed Grid (constant x and constant ct)
  for (let k = -20; k <= 20; k++) {
    if (k !== 0) {
      unprimedLines.push(
        <line key={`ux-${k}`} x1={k} y1={-20} x2={k} y2={20} stroke="#d1d5db" vectorEffect="non-scaling-stroke" strokeWidth="1" />
      );
      unprimedLines.push(
        <line key={`uct-${k}`} x1={-20} y1={-k} x2={20} y2={-k} stroke="#d1d5db" vectorEffect="non-scaling-stroke" strokeWidth="1" />
      );
    }
  }

  // Primed Grid (constant x' and constant ct')
  const startK = fullPrimedGrid ? -30 : 1;
  const startSweep = fullPrimedGrid ? -30 : 0;
  
  for (let k = startK; k <= 30; k++) {
    if (k === 0 && fullPrimedGrid) continue; // Skip axis line if full grid

    // For x' = k, sweep ct'
    const px1 = gamma * (k + beta * startSweep);
    const py1 = gamma * (startSweep + beta * k);
    const px2 = gamma * (k + beta * 30);
    const py2 = gamma * (30 + beta * k);
    primedLines.push(
      <line key={`pxp-${k}`} x1={px1} y1={-py1} x2={px2} y2={-py2} stroke="#fca5a5" vectorEffect="non-scaling-stroke" strokeWidth="1" opacity={fullPrimedGrid ? 0.6 : 1} />
    );

    // For ct' = k, sweep x'
    const qx1 = gamma * (startSweep + beta * k);
    const qy1 = gamma * (k + beta * startSweep);
    const qx2 = gamma * (30 + beta * k);
    const qy2 = gamma * (k + beta * 30);
    primedLines.push(
      <line key={`pctp-${k}`} x1={qx1} y1={-qy1} x2={qx2} y2={-qy2} stroke="#fca5a5" vectorEffect="non-scaling-stroke" strokeWidth="1" opacity={fullPrimedGrid ? 0.6 : 1} />
    );
  }

  // Axis Ticks
  if (showTicks) {
    const tickLen = 0.12 * uiScale;
    for (let k = -20; k <= 20; k++) {
      if (k !== 0) {
        // Unprimed X and ct ticks
        tickMarks.push(<line key={`tx-${k}`} x1={k} y1={-tickLen} x2={k} y2={tickLen} stroke="#111827" strokeWidth="3" vectorEffect="non-scaling-stroke" />);
        tickMarks.push(<line key={`tct-${k}`} x1={-tickLen} y1={-k} x2={tickLen} y2={-k} stroke="#111827" strokeWidth="3" vectorEffect="non-scaling-stroke" />);
        
        // Primed x' ticks (parallel to ct')
        const px1 = gamma * (k + beta * (-tickLen));
        const py1 = gamma * (-tickLen + beta * k);
        const px2 = gamma * (k + beta * tickLen);
        const py2 = gamma * (tickLen + beta * k);
        tickMarks.push(<line key={`tpx-${k}`} x1={px1} y1={-py1} x2={px2} y2={-py2} stroke="#dc2626" strokeWidth="3" vectorEffect="non-scaling-stroke" />);

        // Primed ct' ticks (parallel to x')
        const qx1 = gamma * (-tickLen + beta * k);
        const qy1 = gamma * (k + beta * (-tickLen));
        const qx2 = gamma * (tickLen + beta * k);
        const qy2 = gamma * (k + beta * tickLen);
        tickMarks.push(<line key={`tpct-${k}`} x1={qx1} y1={-qy1} x2={qx2} y2={-qy2} stroke="#dc2626" strokeWidth="3" vectorEffect="non-scaling-stroke" />);
      }
    }
  }

  // Shading polygon for the "in between" region (x' > 0 and ct' > 0)
  const polyP0 = { x: 0, y: 0 };
  const polyP1 = { x: gamma * 30, y: -(gamma * 30 * beta) };
  const polyP2 = { x: gamma * (30 + 30 * beta), y: -(gamma * (30 + 30 * beta)) };
  const polyP3 = { x: gamma * 30 * beta, y: -(gamma * 30) };

  const selectedEvent = events.find(e => e.id === selectedEventId);

  return (
    <div className="flex flex-col md:flex-row h-screen bg-gray-50 text-gray-900 font-sans overflow-hidden">
      
      {/* Sidebar Controls */}
      {!isFullscreen && (
        <div className="w-full md:w-96 bg-white border-r border-gray-200 flex flex-col shadow-sm z-10 flex-shrink-0">
          <div className="p-6 border-b border-gray-100">
          
          <div className="space-y-6">
            {/* Beta Control */}
            <div>
              <div className="flex justify-between items-center mb-2">
                <label className="text-sm font-semibold text-gray-700">Velocity (β = v/c)</label>
                <input 
                  type="number" 
                  min="-0.99" max="0.99" step="0.01" 
                  value={beta} 
                  onChange={(e) => {
                    let val = parseFloat(e.target.value);
                    if (val > 0.99) val = 0.99;
                    if (val < -0.99) val = -0.99;
                    if (!isNaN(val)) {
                      setBeta(val);
                      setActiveScenario('custom');
                    }
                  }}
                  className="w-20 px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
              </div>
              <input 
                type="range" 
                min="-0.99" max="0.99" step="0.01" 
                value={beta} 
                onChange={(e) => {
                  setBeta(parseFloat(e.target.value));
                  setActiveScenario('custom');
                }}
                className="w-full accent-blue-600"
              />
              <div className="flex justify-between text-xs text-gray-400 mt-1">
                <span>-0.99</span>
                <span>0</span>
                <span>+0.99</span>
              </div>
              <div className="mt-2 text-xs bg-gray-50 p-2 rounded text-gray-600 font-mono">
                Lorentz Factor (γ) = {gamma.toFixed(3)}
              </div>
            </div>

            {/* View Toggles */}
            <div className="space-y-3">
              <label className="text-sm font-semibold text-gray-700 block">Display Options</label>
              
              <label className="flex items-center space-x-3 cursor-pointer group">
                <input 
                  type="checkbox" 
                  checked={showUnprimedGrid} 
                  onChange={(e) => setShowUnprimedGrid(e.target.checked)}
                  className="h-4 w-4 text-gray-900 rounded border-gray-300 focus:ring-gray-900"
                />
                <span className="text-sm text-gray-700 group-hover:text-gray-900">Unprimed Grid (Rest Frame)</span>
              </label>
              
              <label className="flex items-center space-x-3 cursor-pointer group">
                <input 
                  type="checkbox" 
                  checked={showPrimedGrid} 
                  onChange={(e) => setShowPrimedGrid(e.target.checked)}
                  className="h-4 w-4 text-red-600 rounded border-gray-300 focus:ring-red-600"
                />
                <span className="text-sm text-gray-700 group-hover:text-red-700">Primed Grid (Moving Frame)</span>
              </label>

              <label className="flex items-center space-x-3 cursor-pointer group">
                <input 
                  type="checkbox" 
                  checked={fullPrimedGrid} 
                  onChange={(e) => setFullPrimedGrid(e.target.checked)}
                  className="h-4 w-4 text-red-600 rounded border-gray-300 focus:ring-red-600"
                />
                <span className="text-sm text-gray-700 group-hover:text-red-700">Full Primed Grid</span>
              </label>

              <label className="flex items-center space-x-3 cursor-pointer group">
                <input 
                  type="checkbox" 
                  checked={showTicks} 
                  onChange={(e) => setShowTicks(e.target.checked)}
                  className="h-4 w-4 text-blue-600 rounded border-gray-300 focus:ring-blue-600"
                />
                <span className="text-sm text-gray-700 group-hover:text-blue-700">Show Axis Ticks</span>
              </label>
              
              <label className="flex items-center space-x-3 cursor-pointer group">
                <input 
                  type="checkbox" 
                  checked={showLightCone} 
                  onChange={(e) => setShowLightCone(e.target.checked)}
                  className="h-4 w-4 text-amber-500 rounded border-gray-300 focus:ring-amber-500"
                />
                <span className="text-sm text-gray-700 group-hover:text-amber-600">Light Cone (x = ±ct)</span>
              </label>
            </div>

            {/* Scenarios */}
            <div className="space-y-3 pt-5 border-t border-gray-100">
              <label className="text-sm font-semibold text-gray-700 block">Preset Scenarios</label>
              <select 
                value={activeScenario} 
                onChange={(e) => loadScenario(e.target.value)}
                className="w-full text-sm border border-gray-300 rounded-md p-2 focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white"
              >
                <option value="custom">Custom (Free Play)</option>
                {scenarios.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              
              {activeScenario !== 'custom' && (
                <p className="text-xs text-gray-500 bg-gray-50 p-2 rounded leading-relaxed border border-gray-100">
                  {scenarios.find(s => s.id === activeScenario)?.description}
                </p>
              )}
            </div>
            
            <button 
              onClick={downloadSVG}
              className="w-full flex items-center justify-center space-x-2 py-2 px-4 bg-white border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors"
            >
              <Download size={16} />
              <span>Export as SVG</span>
            </button>
          </div>
        </div>

        {/* Events List */}
        <div className="flex-1 overflow-y-auto p-6 bg-gray-50/50">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-gray-700">Events</h2>
            {events.length > 0 && (
              <button 
                onClick={() => {
                  setEvents([]);
                  setActiveScenario('custom');
                }}
                className="text-xs text-red-600 hover:text-red-800"
              >
                Clear All
              </button>
            )}
          </div>
          
          {events.length === 0 ? (
            <div className="text-center py-8 text-gray-400 flex flex-col items-center">
              <Crosshair size={24} className="mb-2 opacity-50" />
              <p className="text-sm">Click the diagram to place events.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {events.map((ev) => {
                const { xp, ctp } = getPrimedCoords(ev.x, ev.ct);
                const s2 = ev.ct*ev.ct - ev.x*ev.x;
                const isSelected = selectedEventId === ev.id;
                
                return (
                  <div 
                    key={ev.id} 
                    onClick={() => setSelectedEventId(ev.id)}
                    className={`p-3 rounded-lg border transition-all cursor-pointer ${
                      isSelected ? 'bg-white border-blue-500 shadow-sm' : 'bg-white/60 border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <div className="flex justify-between items-center mb-2">
                      <span className="font-bold text-sm flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                        {ev.name}
                      </span>
                      <button 
                        onClick={(e) => { e.stopPropagation(); removeEvent(ev.id); }}
                        className="text-gray-400 hover:text-red-500"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs font-mono">
                      <div className="text-gray-700"><span className="text-gray-400 inline-block w-4">x:</span> {ev.x.toFixed(2)}</div>
                      <div className="text-red-700"><span className="text-red-400 inline-block w-6">x':</span> {xp.toFixed(2)}</div>
                      <div className="text-gray-700"><span className="text-gray-400 inline-block w-4">ct:</span> {ev.ct.toFixed(2)}</div>
                      <div className="text-red-700"><span className="text-red-400 inline-block w-6">ct':</span> {ctp.toFixed(2)}</div>
                    </div>
                    <div className="mt-2 pt-2 border-t border-gray-100 text-xs text-gray-500 flex justify-between">
                      <span>Invariant interval (s²):</span>
                      <span className="font-mono">{s2.toFixed(2)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
      )}

      {/* Main Diagram Area */}
      <div 
        ref={diagramWrapperRef}
        className={`flex-1 flex flex-col items-center justify-center relative transition-all ${
          isFullscreen ? 'fixed inset-0 z-50 bg-gray-100 p-2 md:p-8' : 'p-4 md:p-8 bg-gray-200/50'
        }`}
      >
        
        {/* Fullscreen & Zoom Controls */}
        <div className="absolute top-4 right-4 z-20 flex flex-col gap-2">
          <button 
            onClick={toggleFullscreen}
            className="p-2 bg-white rounded-md shadow-sm border border-gray-200 text-gray-600 hover:text-gray-900 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
            title={isFullscreen ? "Exit Fullscreen (Esc)" : "Enter Fullscreen"}
          >
            {isFullscreen ? <Minimize size={20} /> : <Maximize size={20} />}
          </button>
          <button 
            onClick={handleZoomIn}
            className="p-2 bg-white rounded-md shadow-sm border border-gray-200 text-gray-600 hover:text-gray-900 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
            title="Zoom In"
          >
            <Plus size={20} />
          </button>
          <button 
            onClick={handleZoomOut}
            className="p-2 bg-white rounded-md shadow-sm border border-gray-200 text-gray-600 hover:text-gray-900 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
            title="Zoom Out"
          >
            <Minus size={20} />
          </button>
        </div>

        {/* Helper Banner */}
        {!isFullscreen && (
          <div className={`bg-blue-50 text-blue-800 text-sm px-4 py-2 rounded-full shadow-sm flex items-center gap-2 mb-4 absolute top-4 z-10 transition-opacity duration-1000 ${showHint ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
             <Info size={16} />
             Click anywhere on the graph to place an event.
          </div>
        )}

        {/* SVG Container wrapper ensuring 1:1 aspect ratio bounds */}
        <div className="w-full h-full relative cursor-crosshair flex items-center justify-center">
          <svg
            ref={svgRef}
            onClick={handleSvgClick}
            viewBox={`-${viewBounds} -${viewBounds} ${2*viewBounds} ${2*viewBounds}`}
            className={`bg-white shadow-xl rounded-sm border border-gray-300 max-h-full max-w-full aspect-square ${!isFullscreen && 'max-w-[800px]'}`}
            style={{ backgroundColor: '#ffffff' }}
          >
            {/* Grids */}
            {showUnprimedGrid && <g>{unprimedLines}</g>}
            {showPrimedGrid && (
              <g>
                {!fullPrimedGrid && (
                  <polygon 
                    points={`${polyP0.x},${polyP0.y} ${polyP1.x},${polyP1.y} ${polyP2.x},${polyP2.y} ${polyP3.x},${polyP3.y}`} 
                    fill="#fee2e2" 
                    opacity="0.3"
                  />
                )}
                {primedLines}
              </g>
            )}

            {/* Ticks */}
            {tickMarks}

            {/* Light Cone */}
            {showLightCone && (
              <g>
                <line x1={-20} y1={20} x2={20} y2={-20} stroke="#fbbf24" strokeDasharray="0.2, 0.2" vectorEffect="non-scaling-stroke" strokeWidth="2" />
                <line x1={-20} y1={-20} x2={20} y2={20} stroke="#fbbf24" strokeDasharray="0.2, 0.2" vectorEffect="non-scaling-stroke" strokeWidth="2" />
              </g>
            )}

            {/* Unprimed Axes (Rest Frame) */}
            <line x1={-viewBounds} y1={0} x2={viewBounds} y2={0} stroke="#111827" vectorEffect="non-scaling-stroke" strokeWidth="2" />
            <line x1={0} y1={-viewBounds} x2={0} y2={viewBounds} stroke="#111827" vectorEffect="non-scaling-stroke" strokeWidth="2" />
            
            {/* Unprimed Axis Labels */}
            <text x={viewBounds - 0.8 * uiScale} y={-0.3 * uiScale} fontSize={0.6 * uiScale} fill="#111827" fontWeight="bold">x</text>
            <text x={0.3 * uiScale} y={-viewBounds + 0.8 * uiScale} fontSize={0.6 * uiScale} fill="#111827" fontWeight="bold">ct</text>

            {/* Primed Axes (Moving Frame) */}
            {/* x' axis (ct'=0 => ct = beta * x) */}
            <line 
              x1={-viewBounds} y1={-(-viewBounds * beta)} 
              x2={viewBounds} y2={-(viewBounds * beta)} 
              stroke="#dc2626" vectorEffect="non-scaling-stroke" strokeWidth="2" 
            />
            {/* ct' axis (x'=0 => x = beta * ct) */}
            <line 
              x1={-viewBounds * beta} y1={viewBounds} 
              x2={viewBounds * beta} y2={-viewBounds} 
              stroke="#dc2626" vectorEffect="non-scaling-stroke" strokeWidth="2" 
            />

            {/* Primed Axis Labels */}
            <text 
              x={(viewBounds - 1 * uiScale) * Math.cos(Math.atan(beta)) - 0.2 * uiScale} 
              y={-((viewBounds - 1 * uiScale) * Math.sin(Math.atan(beta))) - 0.4 * uiScale} 
              fontSize={0.6 * uiScale} fill="#dc2626" fontWeight="bold"
            >x'</text>
            <text 
              x={(viewBounds - 1 * uiScale) * Math.sin(Math.atan(beta)) + 0.3 * uiScale} 
              y={-((viewBounds - 1 * uiScale) * Math.cos(Math.atan(beta))) + 0.5 * uiScale} 
              fontSize={0.6 * uiScale} fill="#dc2626" fontWeight="bold"
            >ct'</text>

            {/* Selected Event Projection Lines */}
            {selectedEvent && (
              <g>
                {/* To Unprimed Axes */}
                <line 
                  x1={selectedEvent.x} y1={-selectedEvent.ct} 
                  x2={selectedEvent.x} y2={0} 
                  stroke="#6b7280" strokeDasharray="0.1, 0.15" vectorEffect="non-scaling-stroke" strokeWidth="1.5" 
                />
                <line 
                  x1={selectedEvent.x} y1={-selectedEvent.ct} 
                  x2={0} y2={-selectedEvent.ct} 
                  stroke="#6b7280" strokeDasharray="0.1, 0.15" vectorEffect="non-scaling-stroke" strokeWidth="1.5" 
                />
                
                {/* To Primed Axes */}
                {(() => {
                  const { xp, ctp } = getPrimedCoords(selectedEvent.x, selectedEvent.ct);
                  // Projection onto x' axis (parallel to ct' axis)
                  const projXp_x = gamma * xp;
                  const projXp_ct = gamma * beta * xp;
                  // Projection onto ct' axis (parallel to x' axis)
                  const projCtp_x = gamma * beta * ctp;
                  const projCtp_ct = gamma * ctp;
                  
                  return (
                    <React.Fragment>
                      <line 
                        x1={selectedEvent.x} y1={-selectedEvent.ct} 
                        x2={projXp_x} y2={-projXp_ct} 
                        stroke="#ef4444" strokeDasharray="0.1, 0.15" vectorEffect="non-scaling-stroke" strokeWidth="1.5" 
                      />
                      <line 
                        x1={selectedEvent.x} y1={-selectedEvent.ct} 
                        x2={projCtp_x} y2={-projCtp_ct} 
                        stroke="#ef4444" strokeDasharray="0.1, 0.15" vectorEffect="non-scaling-stroke" strokeWidth="1.5" 
                      />
                    </React.Fragment>
                  );
                })()}
              </g>
            )}

            {/* Event Markers */}
            {events.map((ev) => (
              <g key={ev.id}>
                <circle 
                  id={`event-${ev.id}`}
                  cx={ev.x} 
                  cy={-ev.ct} 
                  r={0.15 * uiScale} 
                  fill="#3b82f6"
                  stroke={selectedEventId === ev.id ? "#93c5fd" : "none"}
                  className="cursor-pointer transition-all hover:stroke-[#93c5fd]" 
                  style={{ strokeWidth: selectedEventId === ev.id ? 0.15 * uiScale : 0 }}
                />
                <text 
                  x={ev.x + 0.25 * uiScale} 
                  y={-ev.ct - 0.25 * uiScale} 
                  fontSize={0.4 * uiScale} 
                  fill={selectedEventId === ev.id ? "#3b82f6" : "#4b5563"} 
                  fontWeight="bold"
                  className="pointer-events-none"
                >
                  {ev.name}
                </text>
              </g>
            ))}

          </svg>
        </div>
      </div>
    </div>
  );
}