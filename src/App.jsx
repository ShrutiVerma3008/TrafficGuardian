import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Activity, AlertTriangle, Camera, Car, CreditCard, Eye, FileText,
  LayoutDashboard, Search, Settings, Siren, Video, Zap
} from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Legend
} from 'recharts';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, addDoc, query, orderBy, limit, onSnapshot } from 'firebase/firestore';

// --- Firebase Configuration (PLACEHOLDER) ---
// TODO: Replace with your actual Firebase config
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};

// Initialize Firebase (wrapped in try-catch to prevent crash on empty config)
let db;
try {
  const app = initializeApp(firebaseConfig);
  db = getFirestore(app);
} catch (e) {
  console.warn("Firebase not configured correctly. Using local state only.");
}

// --- Constants & Helpers ---
const MODES = {
  SIMULATION: 'simulation',
  VIDEO: 'video',
  CCTV: 'cctv'
};

const VIOLATION_TYPES = {
  RED_LIGHT: { label: 'Red Light Crossing', fine: 1000, points: 50 },
  SPEEDING: { label: 'Over Speeding', fine: 2000, points: 100 },
};

const INITIAL_SCORE = 900;

// Mock Data for Analytics
const ANALYTICS_DATA = [
  { time: '08:00', violations: 12, revenue: 12000 },
  { time: '10:00', violations: 19, revenue: 19000 },
  { time: '12:00', violations: 8, revenue: 8000 },
  { time: '14:00', violations: 15, revenue: 15000 },
  { time: '16:00', violations: 22, revenue: 22000 },
  { time: '18:00', violations: 30, revenue: 30000 },
];

// --- Components ---

// 1. Live Monitor Component
const LiveMonitor = ({ addViolation }) => {
  const [mode, setMode] = useState(MODES.SIMULATION);
  const [trafficLight, setTrafficLight] = useState('RED'); // RED, GREEN, YELLOW
  const [videoSrc, setVideoSrc] = useState(null);
  const [streamUrl, setStreamUrl] = useState('');
  const [isArmed, setIsArmed] = useState(true);
  const [dragging, setDragging] = useState(null); // 'detection' | 'signal' | null
  const mouseOffset = useRef({ x: 0, y: 0 });

  const canvasRef = useRef(null);
  const videoRef = useRef(null);
  const requestRef = useRef(null);

  // Simulation State
  const cars = useRef([]);
  const lastFrameTime = useRef(0);

  // Computer Vision State
  const detectionZone = useRef({ x: 100, y: 300, w: 200, h: 100 });
  const signalZone = useRef({ x: 500, y: 50, w: 50, h: 50 });

  // --- Simulation Logic ---
  const spawnCar = () => {
    if (Math.random() > 0.02) return; // Spawn rate
    cars.current.push({
      id: Date.now() + Math.random(),
      x: -100,
      y: 350,
      speed: 2 + Math.random() * 3,
      color: ['blue', 'white', 'gray', 'black'][Math.floor(Math.random() * 4)],
      hasViolated: false,
      willViolate: Math.random() < 0.3 // 30% chance to run red light
    });
  };

  const updateSimulation = (ctx, width, height) => {
    // Draw Road
    ctx.fillStyle = '#333';
    ctx.fillRect(0, 300, width, 150);

    // Draw Stop Line
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(width / 2, 300);
    ctx.lineTo(width / 2, 450);
    ctx.stroke();

    // Spawn & Move Cars
    spawnCar();

    cars.current.forEach((car, index) => {
      // Move
      const shouldStop = trafficLight === 'RED' && !car.willViolate;
      if (shouldStop && car.x < width / 2 - 60 && car.x > width / 2 - 150) {
        // Stop logic (simple)
        car.x += 0;
      } else {
        car.x += car.speed;
      }

      // Draw Car
      ctx.fillStyle = car.color;
      ctx.fillRect(car.x, car.y, 50, 30);

      // Violation Check
      if (trafficLight === 'RED' && car.x > width / 2 && !car.hasViolated) {
        car.hasViolated = true;
        triggerViolation(car);
      }

      // Remove off-screen
      if (car.x > width) cars.current.splice(index, 1);
    });
  };

  const triggerViolation = (car) => {
    if (!isArmed) return;
    const evidence = canvasRef.current.toDataURL('image/jpeg', 0.5);
    addViolation({
      type: VIOLATION_TYPES.RED_LIGHT,
      vehicleId: `KA-01-AB-${Math.floor(Math.random() * 9000) + 1000}`,
      timestamp: new Date(),
      evidence: evidence,
      speed: Math.round(car.speed * 10) // Mock speed
    });
  };

  // --- Computer Vision Logic (Mocked for Prototype) ---
  // In a real app, we would use pixel manipulation here.
  // For this single-file prototype, we'll visualize the zones and logic.

  const processVideoFrame = (ctx, width, height) => {
    if (!videoRef.current) return;
    ctx.drawImage(videoRef.current, 0, 0, width, height);

    // Draw Zones
    ctx.strokeStyle = 'cyan';
    ctx.lineWidth = 2;
    ctx.strokeRect(detectionZone.current.x, detectionZone.current.y, detectionZone.current.w, detectionZone.current.h);
    ctx.fillStyle = 'rgba(0, 255, 255, 0.2)';
    ctx.fillText("Motion Zone", detectionZone.current.x, detectionZone.current.y - 5);

    ctx.strokeStyle = 'orange';
    ctx.strokeRect(signalZone.current.x, signalZone.current.y, signalZone.current.w, signalZone.current.h);
    ctx.fillStyle = 'rgba(255, 165, 0, 0.2)';
    ctx.fillText("Signal Zone", signalZone.current.x, signalZone.current.y - 5);

    // Mock Auto-Detection Logic
    // If we were doing real CV, we'd get ImageData here.
  };

  // --- Interaction Logic (Draggable Zones) ---
  const getCanvasCoordinates = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY
    };
  };

  const handleMouseDown = (e) => {
    if (mode === MODES.SIMULATION) return;
    const { x, y } = getCanvasCoordinates(e);

    // Check Signal Zone
    if (x >= signalZone.current.x && x <= signalZone.current.x + signalZone.current.w &&
      y >= signalZone.current.y && y <= signalZone.current.y + signalZone.current.h) {
      setDragging('signal');
      mouseOffset.current = { x: x - signalZone.current.x, y: y - signalZone.current.y };
      return;
    }

    // Check Detection Zone
    if (x >= detectionZone.current.x && x <= detectionZone.current.x + detectionZone.current.w &&
      y >= detectionZone.current.y && y <= detectionZone.current.y + detectionZone.current.h) {
      setDragging('detection');
      mouseOffset.current = { x: x - detectionZone.current.x, y: y - detectionZone.current.y };
      return;
    }
  };

  const handleMouseMove = (e) => {
    if (!dragging) return;
    const { x, y } = getCanvasCoordinates(e);

    if (dragging === 'signal') {
      signalZone.current.x = x - mouseOffset.current.x;
      signalZone.current.y = y - mouseOffset.current.y;
    } else if (dragging === 'detection') {
      detectionZone.current.x = x - mouseOffset.current.x;
      detectionZone.current.y = y - mouseOffset.current.y;
    }
  };

  const handleMouseUp = () => {
    setDragging(null);
  };

  const loop = (time) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;

    ctx.clearRect(0, 0, width, height);

    if (mode === MODES.SIMULATION) {
      updateSimulation(ctx, width, height);
    } else {
      processVideoFrame(ctx, width, height);
    }

    requestRef.current = requestAnimationFrame(loop);
  };

  useEffect(() => {
    requestRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(requestRef.current);
  }, [mode, trafficLight, isArmed]);

  // Ensure video plays when loaded
  useEffect(() => {
    if (mode === MODES.VIDEO && videoRef.current && videoSrc) {
      videoRef.current.play().catch(e => console.log("Autoplay prevented:", e));
    }
  }, [mode, videoSrc]);

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      const url = URL.createObjectURL(file);
      setVideoSrc(url);
      setMode(MODES.VIDEO);
    }
  };

  return (
    <div className="bg-gray-800 p-4 rounded-xl shadow-lg border border-gray-700">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-bold flex items-center gap-2">
          <Eye className="text-blue-400" /> Live Monitor
        </h2>
        <div className="flex gap-2">
          <button
            onClick={() => setMode(MODES.SIMULATION)}
            className={`px-3 py-1 rounded ${mode === MODES.SIMULATION ? 'bg-blue-600' : 'bg-gray-700'}`}
          >
            Simulation
          </button>
          <button
            onClick={() => document.getElementById('videoInput').click()}
            className={`px-3 py-1 rounded ${mode === MODES.VIDEO ? 'bg-blue-600' : 'bg-gray-700'}`}
          >
            Upload Video
          </button>
          <input
            type="file"
            id="videoInput"
            className="hidden"
            accept="video/*"
            onChange={handleFileChange}
          />
          <div className="flex items-center gap-2 bg-gray-900 px-2 rounded">
            <span className="text-xs text-gray-400">Stream:</span>
            <input
              type="text"
              placeholder="RTSP/HTTP URL"
              className="bg-transparent border-none text-sm w-32 focus:ring-0"
              value={streamUrl}
              onChange={(e) => setStreamUrl(e.target.value)}
            />
            <button onClick={() => setMode(MODES.CCTV)} className="text-xs bg-green-600 px-2 py-1 rounded">Go</button>
          </div>
        </div>
      </div>

      <div className="relative bg-black rounded-lg overflow-hidden aspect-video">
        <canvas
          ref={canvasRef}
          width={800}
          height={450}
          className="w-full h-full object-contain cursor-crosshair"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        />
        {/* Hidden Video Element for Processing */}
        {videoSrc && (
          <video
            ref={videoRef}
            src={videoSrc}
            autoPlay
            loop
            muted
            className="hidden"
            onPlay={() => console.log("Video playing")}
          />
        )}

        {/* Overlays */}
        <div className="absolute top-4 right-4 flex flex-col gap-2 bg-black/50 p-2 rounded">
          <div className="text-xs text-gray-300 font-mono">System Status</div>
          <div className="flex items-center gap-2">
            <div className={`w-3 h-3 rounded-full ${isArmed ? 'bg-red-500 animate-pulse' : 'bg-gray-500'}`}></div>
            <span className="font-bold">{isArmed ? 'ARMED' : 'DISARMED'}</span>
          </div>
          <button
            onClick={() => setIsArmed(!isArmed)}
            className="text-xs bg-gray-700 hover:bg-gray-600 px-2 py-1 rounded"
          >
            {isArmed ? 'Disarm' : 'Arm System'}
          </button>
        </div>

        {mode === MODES.SIMULATION && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-4 bg-black/70 p-3 rounded-full">
            <button
              onClick={() => setTrafficLight('RED')}
              className={`w-12 h-12 rounded-full border-4 ${trafficLight === 'RED' ? 'bg-red-500 border-white shadow-[0_0_20px_red]' : 'bg-red-900 border-transparent'}`}
            />
            <button
              onClick={() => setTrafficLight('YELLOW')}
              className={`w-12 h-12 rounded-full border-4 ${trafficLight === 'YELLOW' ? 'bg-yellow-500 border-white shadow-[0_0_20px_yellow]' : 'bg-yellow-900 border-transparent'}`}
            />
            <button
              onClick={() => setTrafficLight('GREEN')}
              className={`w-12 h-12 rounded-full border-4 ${trafficLight === 'GREEN' ? 'bg-green-500 border-white shadow-[0_0_20px_green]' : 'bg-green-900 border-transparent'}`}
            />
          </div>
        )}
      </div>
    </div>
  );
};

// 2. Dashboard & History
const Dashboard = ({ violations }) => {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Analytics */}
      <div className="lg:col-span-2 space-y-6">
        <div className="bg-gray-800 p-6 rounded-xl border border-gray-700">
          <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
            <Activity className="text-purple-400" /> Hourly Violations
          </h3>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={ANALYTICS_DATA}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="time" stroke="#9CA3AF" />
                <YAxis stroke="#9CA3AF" />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1F2937', borderColor: '#374151' }}
                  itemStyle={{ color: '#E5E7EB' }}
                />
                <Line type="monotone" dataKey="violations" stroke="#8B5CF6" strokeWidth={3} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-gray-800 p-6 rounded-xl border border-gray-700">
          <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
            <CreditCard className="text-green-400" /> Revenue Potential
          </h3>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={ANALYTICS_DATA}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="time" stroke="#9CA3AF" />
                <YAxis stroke="#9CA3AF" />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1F2937', borderColor: '#374151' }}
                  itemStyle={{ color: '#E5E7EB' }}
                />
                <Bar dataKey="revenue" fill="#10B981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Recent Violations Feed */}
      <div className="bg-gray-800 p-6 rounded-xl border border-gray-700 h-[calc(100vh-12rem)] overflow-y-auto">
        <h3 className="text-lg font-bold mb-4 flex items-center gap-2 sticky top-0 bg-gray-800 py-2">
          <Siren className="text-red-400" /> Recent Violations
        </h3>
        <div className="space-y-4">
          {violations.length === 0 ? (
            <p className="text-gray-500 text-center py-10">No violations detected yet.</p>
          ) : (
            violations.map((v, i) => (
              <div key={i} className="bg-gray-700/50 p-4 rounded-lg border border-gray-600 hover:border-red-500 transition-colors">
                <div className="flex justify-between items-start mb-2">
                  <span className="font-mono font-bold text-yellow-400">{v.vehicleId}</span>
                  <span className="text-xs text-gray-400">{v.timestamp.toLocaleTimeString()}</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-gray-300 mb-2">
                  <span className="px-2 py-0.5 bg-red-500/20 text-red-300 rounded text-xs border border-red-500/30">
                    {v.type.label}
                  </span>
                  <span>{v.speed} km/h</span>
                </div>
                <div className="flex justify-between items-center mt-3">
                  <span className="font-bold text-green-400">₹{v.type.fine}</span>
                  <button className="text-xs bg-blue-600 hover:bg-blue-500 px-3 py-1 rounded flex items-center gap-1">
                    <FileText size={12} /> View Proof
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

// 3. Driver Portal
const DriverPortal = () => {
  const [search, setSearch] = useState('');
  const [result, setResult] = useState(null);

  const handleSearch = () => {
    // Mock Search Logic
    if (search.length > 5) {
      setResult({
        id: search.toUpperCase(),
        score: 750,
        violations: 3,
        pendingFines: 4500,
        history: [
          { date: '2023-11-20', type: 'Red Light', fine: 1000 },
          { date: '2023-11-15', type: 'Speeding', fine: 2000 },
          { date: '2023-10-01', type: 'Parking', fine: 1500 },
        ]
      });
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <div className="bg-gray-800 p-8 rounded-2xl shadow-2xl border border-gray-700 text-center">
        <h2 className="text-3xl font-bold mb-2">Driver Safety Portal</h2>
        <p className="text-gray-400 mb-8">Check your Safety Score and Pending Fines</p>

        <div className="flex gap-2 mb-8">
          <input
            type="text"
            placeholder="Enter Vehicle Number (e.g., KA-01-AB-1234)"
            className="flex-1 bg-gray-900 border border-gray-600 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 outline-none"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button
            onClick={handleSearch}
            className="bg-blue-600 hover:bg-blue-500 px-6 py-3 rounded-lg font-bold flex items-center gap-2"
          >
            <Search size={20} /> Check
          </button>
        </div>

        {result && (
          <div className="animate-fade-in text-left">
            <div className="grid grid-cols-2 gap-4 mb-6">
              <div className="bg-gray-900 p-4 rounded-xl border border-gray-700 text-center">
                <div className="text-gray-400 text-sm mb-1">Safety Score</div>
                <div className={`text-4xl font-bold ${result.score > 800 ? 'text-green-500' : result.score > 600 ? 'text-yellow-500' : 'text-red-500'}`}>
                  {result.score}
                </div>
                <div className="text-xs text-gray-500 mt-1">/ 900</div>
              </div>
              <div className="bg-gray-900 p-4 rounded-xl border border-gray-700 text-center">
                <div className="text-gray-400 text-sm mb-1">Pending Fines</div>
                <div className="text-4xl font-bold text-red-400">₹{result.pendingFines}</div>
                <div className="text-xs text-gray-500 mt-1">{result.violations} Violations</div>
              </div>
            </div>

            <h3 className="font-bold text-lg mb-3">Violation History</h3>
            <div className="space-y-2">
              {result.history.map((h, i) => (
                <div key={i} className="flex justify-between items-center bg-gray-700/30 p-3 rounded border border-gray-700">
                  <div>
                    <div className="font-bold">{h.type}</div>
                    <div className="text-xs text-gray-400">{h.date}</div>
                  </div>
                  <div className="text-red-400 font-mono">₹{h.fine}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// --- Main App Component ---
function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [violations, setViolations] = useState([]);

  // Load violations from Firestore (or local mock)
  useEffect(() => {
    if (db) {
      const q = query(collection(db, "violations"), orderBy("timestamp", "desc"), limit(20));
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const data = snapshot.docs.map(doc => ({
          ...doc.data(),
          timestamp: doc.data().timestamp.toDate()
        }));
        setViolations(data);
      });
      return () => unsubscribe();
    }
  }, []);

  const handleAddViolation = async (violation) => {
    // Optimistic Update
    setViolations(prev => [violation, ...prev]);

    if (db) {
      try {
        await addDoc(collection(db, "violations"), violation);
      } catch (e) {
        console.error("Error adding document: ", e);
      }
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 font-sans">
      {/* Sidebar / Navigation */}
      <nav className="fixed left-0 top-0 h-full w-20 bg-gray-800 border-r border-gray-700 flex flex-col items-center py-6 gap-8 z-50">
        <div className="p-3 bg-blue-600 rounded-xl shadow-lg shadow-blue-500/20">
          <Zap size={24} className="text-white" />
        </div>

        <div className="flex flex-col gap-4 w-full px-2">
          <NavButton icon={<LayoutDashboard />} label="Dash" active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} />
          <NavButton icon={<Camera />} label="Live" active={activeTab === 'live'} onClick={() => setActiveTab('live')} />
          <NavButton icon={<Search />} label="Portal" active={activeTab === 'portal'} onClick={() => setActiveTab('portal')} />
          <NavButton icon={<Settings />} label="Settings" active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} />
        </div>
      </nav>

      {/* Main Content */}
      <main className="ml-20 p-8">
        <header className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
              TrafficGuardian
            </h1>
            <p className="text-gray-400">AI-Powered Violation Detection System</p>
          </div>
          <div className="flex items-center gap-4">
            <div className="bg-gray-800 px-4 py-2 rounded-full border border-gray-700 flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
              <span className="text-sm font-mono text-gray-300">SYSTEM ONLINE</span>
            </div>
          </div>
        </header>

        {activeTab === 'dashboard' && <Dashboard violations={violations} />}
        {activeTab === 'live' && <LiveMonitor addViolation={handleAddViolation} />}
        {activeTab === 'portal' && <DriverPortal />}
        {activeTab === 'settings' && (
          <div className="text-center text-gray-500 py-20">
            <Settings size={48} className="mx-auto mb-4 opacity-50" />
            <h2 className="text-xl">System Configuration</h2>
            <p>Configure Detection Zones, Camera Inputs, and Fine Rules here.</p>
          </div>
        )}
      </main>
    </div>
  );
}

const NavButton = ({ icon, label, active, onClick }) => (
  <button
    onClick={onClick}
    className={`flex flex-col items-center gap-1 p-3 rounded-xl transition-all ${active ? 'bg-blue-600/20 text-blue-400' : 'text-gray-400 hover:bg-gray-700 hover:text-gray-200'
      }`}
  >
    {icon}
    <span className="text-[10px] font-medium">{label}</span>
  </button>
);

export default App;
