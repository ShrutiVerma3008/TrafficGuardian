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

const ANALYTICS_DATA = [
  { time: '08:00', violations: 2, revenue: 2000 },
  { time: '09:00', violations: 5, revenue: 5000 },
  { time: '10:00', violations: 8, revenue: 8000 },
  { time: '11:00', violations: 4, revenue: 4000 },
  { time: '12:00', violations: 6, revenue: 6000 },
];

// Helper to download CSV
const downloadCSV = (data) => {
  const headers = ["Vehicle ID", "Type", "Speed (km/h)", "Fine (₹)", "Date", "Time", "Source", "Evidence URL"];
  const rows = data.map(v => [
    v.vehicleId,
    v.type.label,
    v.speed,
    v.type.fine,
    v.timestamp.toLocaleDateString(),
    v.timestamp.toLocaleTimeString(),
    v.source || 'Unknown',
    v.evidence ? 'Yes' : 'No'
  ]);

  const csvContent = "data:text/csv;charset=utf-8,"
    + [headers.join(","), ...rows.map(e => e.join(","))].join("\n");

  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", `traffic_violations_${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

// --- Components ---

// 1. Live Monitor Component
const LiveMonitor = ({ addViolation }) => {
  const [mode, setMode] = useState(MODES.SIMULATION);
  const [trafficLight, setTrafficLight] = useState('RED'); // RED, GREEN, YELLOW
  const [videoSrc, setVideoSrc] = useState(null);
  const [streamUrl, setStreamUrl] = useState('');
  const [isArmed, setIsArmed] = useState(true);
  const [dragging, setDragging] = useState(null); // 'detection' | 'signal' | null
  const [resizing, setResizing] = useState(null); // 'detection' | 'signal' | null
  const mouseOffset = useRef({ x: 0, y: 0 });
  const [detectionActive, setDetectionActive] = useState(false);

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
  // --- Simulation Logic ---
  const spawnCar = (width) => {
    if (Math.random() > 0.015) return; // Slightly lower spawn rate

    // Check for overlap with last car
    const lastCar = cars.current[cars.current.length - 1];
    if (lastCar && lastCar.x < 100) return; // Don't spawn if last car is too close

    cars.current.push({
      id: Date.now() + Math.random(),
      x: -120,
      y: 360,
      width: 100,
      height: 50,
      speed: 3 + Math.random() * 2,
      color: ['#3B82F6', '#EF4444', '#10B981', '#F59E0B', '#6366F1'][Math.floor(Math.random() * 5)],
      plate: `KA-${Math.floor(Math.random() * 90) + 10}-${['A', 'B', 'C'][Math.floor(Math.random() * 3)]}${['A', 'B', 'C'][Math.floor(Math.random() * 3)]}-${Math.floor(Math.random() * 9000) + 1000}`,
      hasViolated: false,
      willViolate: Math.random() < 0.4 // 40% chance to run red light (increased from 30%)
    });
  };

  const updateSimulation = (ctx, width, height) => {
    // Draw Road
    ctx.fillStyle = '#1F2937';
    ctx.fillRect(0, 300, width, 150);

    // Draw Lane Markings
    ctx.strokeStyle = '#4B5563';
    ctx.setLineDash([20, 20]);
    ctx.beginPath();
    ctx.moveTo(0, 375);
    ctx.lineTo(width, 375);
    ctx.stroke();
    ctx.setLineDash([]);

    // Draw Stop Line
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(width / 2, 300);
    ctx.lineTo(width / 2, 450);
    ctx.stroke();

    // Spawn & Move Cars
    spawnCar(width);

    cars.current.forEach((car, index) => {
      // Collision Avoidance / Spacing Logic
      let speedMultiplier = 1;
      const carAhead = cars.current[index - 1]; // Cars are ordered by spawn time (index 0 is oldest/furthest)

      // If there is a car ahead and it's close, slow down
      // EXCEPTION: If this car is a violator and close to the stop line, it ignores the car ahead (ghost mode for simulation effect)
      if (carAhead && (carAhead.x - car.x) < 150) {
        if (!car.willViolate || (car.x < width / 2 - 100)) {
          speedMultiplier = 0.5;
          if ((carAhead.x - car.x) < 110) speedMultiplier = 0; // Stop if too close
        }
      }

      // Traffic Light Logic
      const distToStopLine = (width / 2) - (car.x + car.width);
      const shouldStop = trafficLight === 'RED' && !car.willViolate && distToStopLine > 0 && distToStopLine < 150;

      if (shouldStop) {
        if (distToStopLine < 20) speedMultiplier = 0;
        else speedMultiplier = 0.5;
      }

      car.x += car.speed * speedMultiplier;

      // Draw Car Body
      ctx.fillStyle = car.color;
      // Rounded rect for car body
      ctx.beginPath();
      ctx.roundRect(car.x, car.y, car.width, car.height, 10);
      ctx.fill();

      // Car Roof/Window
      ctx.fillStyle = '#111827';
      ctx.beginPath();
      ctx.roundRect(car.x + 20, car.y + 5, 60, 40, 5);
      ctx.fill();

      // Headlights
      ctx.fillStyle = '#FEF3C7';
      ctx.beginPath();
      ctx.arc(car.x + car.width - 5, car.y + 10, 5, 0, Math.PI * 2);
      ctx.arc(car.x + car.width - 5, car.y + car.height - 10, 5, 0, Math.PI * 2);
      ctx.fill();

      // License Plate
      ctx.fillStyle = 'white';
      ctx.fillRect(car.x + 10, car.y + 15, 25, 20);
      ctx.fillStyle = 'black';
      ctx.font = '8px monospace';
      ctx.fillText(car.plate.substring(0, 5), car.x + 12, car.y + 25);
      ctx.fillText(car.plate.substring(6), car.x + 12, car.y + 33);

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
      vehicleId: car.plate || `KA-01-AB-${Math.floor(Math.random() * 9000) + 1000}`,
      timestamp: new Date(),
      evidence: evidence,
      speed: Math.round(car.speed * 10),
      source: mode
    });
  };

  // --- Computer Vision Logic (Mocked for Prototype) ---
  // In a real app, we would use pixel manipulation here.
  // For this single-file prototype, we'll visualize the zones and logic.

  const processVideoFrame = (ctx, width, height) => {
    if (!videoRef.current) return;
    ctx.drawImage(videoRef.current, 0, 0, width, height);

    // Draw Zones with Resize Handles
    const drawZone = (zone, color, label) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.strokeRect(zone.x, zone.y, zone.w, zone.h);
      ctx.fillStyle = color.replace(')', ', 0.2)').replace('rgb', 'rgba');
      ctx.fillRect(zone.x, zone.y, zone.w, zone.h);
      ctx.fillStyle = color;
      ctx.fillText(label, zone.x, zone.y - 5);

      // Resize Handle (Bottom Right)
      ctx.fillStyle = 'white';
      ctx.fillRect(zone.x + zone.w - 10, zone.y + zone.h - 10, 10, 10);
    };

    drawZone(detectionZone.current, 'cyan', 'Detection Zone');
    drawZone(signalZone.current, 'orange', 'Signal Zone');

    // Mock Detection Feedback
    if (Math.random() > 0.95) {
      setDetectionActive(true);
      setTimeout(() => setDetectionActive(false), 200);
    }

    if (detectionActive) {
      ctx.strokeStyle = 'red';
      ctx.lineWidth = 4;
      ctx.strokeRect(detectionZone.current.x, detectionZone.current.y, detectionZone.current.w, detectionZone.current.h);
      ctx.fillStyle = 'red';
      ctx.font = '20px bold sans-serif';
      ctx.fillText("MOTION DETECTED", detectionZone.current.x, detectionZone.current.y + detectionZone.current.h + 20);
    }
  };

  // --- Interaction Logic (Draggable & Resizable Zones) ---
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

  const isOverHandle = (x, y, zone) => {
    return x >= zone.x + zone.w - 15 && x <= zone.x + zone.w + 5 &&
      y >= zone.y + zone.h - 15 && y <= zone.y + zone.h + 5;
  };

  const handleMouseDown = (e) => {
    if (mode === MODES.SIMULATION) return;
    const { x, y } = getCanvasCoordinates(e);

    // Check Signal Zone Resize
    if (isOverHandle(x, y, signalZone.current)) {
      setResizing('signal');
      return;
    }
    // Check Detection Zone Resize
    if (isOverHandle(x, y, detectionZone.current)) {
      setResizing('detection');
      return;
    }

    // Check Signal Zone Drag
    if (x >= signalZone.current.x && x <= signalZone.current.x + signalZone.current.w &&
      y >= signalZone.current.y && y <= signalZone.current.y + signalZone.current.h) {
      setDragging('signal');
      mouseOffset.current = { x: x - signalZone.current.x, y: y - signalZone.current.y };
      return;
    }

    // Check Detection Zone Drag
    if (x >= detectionZone.current.x && x <= detectionZone.current.x + detectionZone.current.w &&
      y >= detectionZone.current.y && y <= detectionZone.current.y + detectionZone.current.h) {
      setDragging('detection');
      mouseOffset.current = { x: x - detectionZone.current.x, y: y - detectionZone.current.y };
      return;
    }
  };

  const handleMouseMove = (e) => {
    const { x, y } = getCanvasCoordinates(e);

    if (resizing) {
      if (resizing === 'signal') {
        signalZone.current.w = Math.max(20, x - signalZone.current.x);
        signalZone.current.h = Math.max(20, y - signalZone.current.y);
      } else if (resizing === 'detection') {
        detectionZone.current.w = Math.max(20, x - detectionZone.current.x);
        detectionZone.current.h = Math.max(20, y - detectionZone.current.y);
      }
      return;
    }

    if (dragging) {
      if (dragging === 'signal') {
        signalZone.current.x = x - mouseOffset.current.x;
        signalZone.current.y = y - mouseOffset.current.y;
      } else if (dragging === 'detection') {
        detectionZone.current.x = x - mouseOffset.current.x;
        detectionZone.current.y = y - mouseOffset.current.y;
      }
    }
  };

  const handleMouseUp = () => {
    setDragging(null);
    setResizing(null);
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
      <div className="flex flex-col gap-4 mb-4">
        <div className="flex justify-between items-center">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Eye className="text-blue-400" /> Live Monitor
          </h2>
          <div className="flex items-center gap-2">
            <div className={`w-3 h-3 rounded-full ${isArmed ? 'bg-red-500 animate-pulse' : 'bg-gray-500'}`}></div>
            <span className="font-bold text-sm">{isArmed ? 'SYSTEM ARMED' : 'DISARMED'}</span>
            <button
              onClick={() => setIsArmed(!isArmed)}
              className="text-xs bg-gray-700 hover:bg-gray-600 px-3 py-1 rounded border border-gray-600"
            >
              {isArmed ? 'Disarm' : 'Arm'}
            </button>
          </div>
        </div>

        {/* Mode Tabs */}
        <div className="flex p-1 bg-gray-900 rounded-lg border border-gray-700">
          <button
            onClick={() => setMode(MODES.SIMULATION)}
            className={`flex-1 py-2 rounded-md text-sm font-medium transition-all ${mode === MODES.SIMULATION ? 'bg-blue-600 text-white shadow-lg' : 'text-gray-400 hover:text-white'}`}
          >
            Simulation
          </button>
          <button
            onClick={() => setMode(MODES.VIDEO)}
            className={`flex-1 py-2 rounded-md text-sm font-medium transition-all ${mode === MODES.VIDEO ? 'bg-blue-600 text-white shadow-lg' : 'text-gray-400 hover:text-white'}`}
          >
            Video Input
          </button>
          <button
            onClick={() => setMode(MODES.CCTV)}
            className={`flex-1 py-2 rounded-md text-sm font-medium transition-all ${mode === MODES.CCTV ? 'bg-blue-600 text-white shadow-lg' : 'text-gray-400 hover:text-white'}`}
          >
            CCTV Stream
          </button>
        </div>

        {/* Mode Specific Controls */}
        {mode === MODES.VIDEO && (
          <div className="flex gap-2 items-center bg-gray-900 p-2 rounded border border-gray-700 animate-fade-in">
            <button
              onClick={() => document.getElementById('videoInput').click()}
              className="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded text-sm flex items-center gap-2"
            >
              <Video size={16} /> Select Video File
            </button>
            <input
              type="file"
              id="videoInput"
              className="hidden"
              accept="video/*"
              onChange={handleFileChange}
            />
            <span className="text-xs text-gray-400">{videoSrc ? 'Video Loaded' : 'No video selected'}</span>
          </div>
        )}

        {mode === MODES.CCTV && (
          <div className="flex gap-2 items-center bg-gray-900 p-2 rounded border border-gray-700 animate-fade-in">
            <span className="text-sm text-gray-400">Stream URL:</span>
            <input
              type="text"
              placeholder="rtsp://..."
              className="bg-gray-800 border border-gray-600 text-sm px-3 py-1 rounded flex-1 focus:ring-2 focus:ring-blue-500 outline-none"
              value={streamUrl}
              onChange={(e) => setStreamUrl(e.target.value)}
            />
            <button className="bg-green-600 hover:bg-green-500 px-4 py-1 rounded text-sm">Connect</button>
          </div>
        )}
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
        {/* Overlays */}
        {/* System Status moved to header of component for better visibility */}

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
  const [filter, setFilter] = useState('ALL');
  const [selectedEvidence, setSelectedEvidence] = useState(null);
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const filteredViolations = violations.filter(v => filter === 'ALL' || v.source === filter);

  // Dynamic Analytics Data
  const analyticsData = useMemo(() => {
    const hours = {};
    violations.forEach(v => {
      const hour = v.timestamp.getHours() + ":00";
      if (!hours[hour]) hours[hour] = { time: hour, violations: 0, revenue: 0 };
      hours[hour].violations += 1;
      hours[hour].revenue += v.type.fine;
    });
    return Object.values(hours).sort((a, b) => parseInt(a.time) - parseInt(b.time));
  }, [violations]);

  // Source Stats
  const stats = useMemo(() => {
    const s = { simulation: 0, video: 0, cctv: 0, total: violations.length };
    violations.forEach(v => {
      if (v.source) s[v.source] = (s[v.source] || 0) + 1;
    });
    return s;
  }, [violations]);

  return (
    <div className="space-y-6">
      {/* Header with Clock & Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-gray-800 p-4 rounded-xl border border-gray-700 flex flex-col justify-center items-center">
          <div className="text-gray-400 text-sm">Current Time</div>
          <div className="text-2xl font-mono font-bold text-blue-400">
            {currentTime.toLocaleTimeString()}
          </div>
          <div className="text-xs text-gray-500">{currentTime.toLocaleDateString()}</div>
        </div>
        <div className="bg-gray-800 p-4 rounded-xl border border-gray-700">
          <div className="text-gray-400 text-sm">Simulation Violations</div>
          <div className="text-2xl font-bold text-purple-400">{stats.simulation}</div>
        </div>
        <div className="bg-gray-800 p-4 rounded-xl border border-gray-700">
          <div className="text-gray-400 text-sm">Video Upload Violations</div>
          <div className="text-2xl font-bold text-orange-400">{stats.video}</div>
        </div>
        <div className="bg-gray-800 p-4 rounded-xl border border-gray-700">
          <div className="text-gray-400 text-sm">CCTV/Stream Violations</div>
          <div className="text-2xl font-bold text-green-400">{stats.cctv}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Analytics */}
        <div className="lg:col-span-2 space-y-6">
          <div className="flex justify-between items-center">
            <h3 className="text-xl font-bold">Analytics Overview</h3>
            <button
              onClick={() => downloadCSV(violations)}
              className="bg-green-600 hover:bg-green-500 px-4 py-2 rounded flex items-center gap-2"
            >
              <FileText size={16} /> Export Full History (CSV)
            </button>
          </div>

          <div className="bg-gray-800 p-6 rounded-xl border border-gray-700">
            <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
              <Activity className="text-purple-400" /> Hourly Violations
            </h3>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={analyticsData.length > 0 ? analyticsData : ANALYTICS_DATA}>
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
                <BarChart data={analyticsData.length > 0 ? analyticsData : ANALYTICS_DATA}>
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
          <div className="sticky top-0 bg-gray-800 pb-4 z-10">
            <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
              <Siren className="text-red-400" /> Recent Violations
            </h3>
            <div className="flex gap-2">
              {['ALL', MODES.SIMULATION, MODES.VIDEO, MODES.CCTV].map(m => (
                <button
                  key={m}
                  onClick={() => setFilter(m)}
                  className={`text-xs px-2 py-1 rounded border ${filter === m ? 'bg-blue-600 border-blue-500' : 'border-gray-600 hover:bg-gray-700'}`}
                >
                  {m.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            {filteredViolations.length === 0 ? (
              <p className="text-gray-500 text-center py-10">No violations detected yet.</p>
            ) : (
              filteredViolations.slice(0, 8).map((v, i) => (
                <div key={i} className="bg-gray-700/50 p-4 rounded-lg border border-gray-600 hover:border-red-500 transition-colors">
                  <div className="flex justify-between items-start mb-2">
                    <span className="font-mono font-bold text-yellow-400">{v.vehicleId}</span>
                    <div className="text-right">
                      <div className="text-xs text-gray-400">{v.timestamp.toLocaleTimeString()}</div>
                      <div className="text-[10px] text-gray-500">{v.timestamp.toLocaleDateString()}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-gray-300 mb-2">
                    <span className="px-2 py-0.5 bg-red-500/20 text-red-300 rounded text-xs border border-red-500/30">
                      {v.type.label}
                    </span>
                    <span className="text-xs bg-gray-600 px-1 rounded">{v.source}</span>
                  </div>
                  <div className="flex justify-between items-center mt-3">
                    <span className="font-bold text-green-400">₹{v.type.fine}</span>
                    <button
                      onClick={() => setSelectedEvidence(v.evidence)}
                      className="text-xs bg-blue-600 hover:bg-blue-500 px-3 py-1 rounded flex items-center gap-1"
                    >
                      <FileText size={12} /> View Proof
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Evidence Modal */}
        {selectedEvidence && (
          <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-[100]" onClick={() => setSelectedEvidence(null)}>
            <div className="bg-gray-800 p-6 rounded-xl max-w-4xl w-full mx-4 border border-gray-600 shadow-2xl" onClick={e => e.stopPropagation()}>
              <div className="flex justify-between mb-4 items-center">
                <h3 className="text-2xl font-bold text-white">Violation Evidence</h3>
                <button onClick={() => setSelectedEvidence(null)} className="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded text-white">Close</button>
              </div>
              <div className="bg-black rounded-lg overflow-hidden border border-gray-700 flex justify-center">
                <img src={selectedEvidence} alt="Evidence" className="max-h-[70vh] object-contain" />
              </div>
              <div className="mt-4 text-center text-gray-400 text-sm">
                Evidence captured automatically by TrafficGuardian Computer Vision System
              </div>
            </div>
          </div>
        )}
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
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

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
    } else {
      // Fallback to LocalStorage if Firebase is not configured
      const saved = localStorage.getItem('traffic_violations');
      if (saved) {
        try {
          const parsed = JSON.parse(saved).map(v => ({
            ...v,
            timestamp: new Date(v.timestamp)
          }));
          setViolations(parsed);
        } catch (e) {
          console.error("Failed to parse local history", e);
        }
      }
    }
  }, []);

  const handleAddViolation = async (violation) => {
    // Optimistic Update
    setViolations(prev => {
      const updated = [violation, ...prev];
      if (!db) {
        localStorage.setItem('traffic_violations', JSON.stringify(updated));
      }
      return updated;
    });

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
          <div className="flex items-center gap-6">
            <div className="text-right hidden md:block">
              <div className="text-2xl font-mono font-bold text-gray-200">
                {currentTime.toLocaleTimeString()}
              </div>
              <div className="text-sm text-gray-400">
                {currentTime.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
              </div>
            </div>
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
