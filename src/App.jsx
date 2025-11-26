import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Activity, AlertTriangle, Camera, Car, CreditCard, Eye, FileText,
  LayoutDashboard, Moon, Search, Settings, Siren, Sun, Video, Zap
} from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Legend
} from 'recharts';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, addDoc, query, orderBy, limit, onSnapshot } from 'firebase/firestore';

// --- Firebase Configuration (PLACEHOLDER) ---
// TODO: Replace with your actual Firebase config
// const firebaseConfig = {
//   apiKey: "AIzaSyC81mOF23hP6j4F_rTUtKhDQFcQIdGlrSU",
//   authDomain: "traffic-6f24a.firebaseapp.com",
//   projectId: "traffic-6f24a",
//   storageBucket: "traffic-6f24a.firebasestorage.app",
//   messagingSenderId: "907265529400",
//   appId: "1:907265529400:web:692081d574aa61ab79f8cd"
// };

// apiKey: "AIzaSyC81mOF23hP6j4F_rTUtKhDQFcQIdGlrSU",
// authDomain: "traffic-6f24a.firebaseapp.com",
// projectId: "traffic-6f24a",
// storageBucket: "traffic-6f24a.firebasestorage.app",
// messagingSenderId: "907265529400",
// appId: "1:907265529400:web:692081d574aa61ab79f8cd",
// measurementId: "G-47EHBSNPLK"
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
  RED_LIGHT: { label: 'Red Light Crossing', baseFine: 500, points: 50 },
  SPEEDING: { label: 'Over Speeding', baseFine: 500, points: 100 },
};

// Fine Calculation Rules
const FINE_RULES = {
  BASE_FINE: 500,
  REPEAT_OFFENDER_MULTIPLIERS: {
    0: 1,    // No previous violations
    1: 2,    // 1-2 violations
    3: 4,    // 3-4 violations
    5: 6,    // 5-7 violations
    8: 10    // 8+ violations
  },
  SPEED_PENALTIES: {
    NORMAL: 0,      // ≤60 km/h
    MODERATE: 500,  // >60 km/h
    HIGH: 1000      // >80 km/h
  },
  VEHICLE_TYPE_SURCHARGE: {
    CAR: 0,
    BIKE: 0,
    TRUCK: 400,
    BUS: 400
  },
  PEAK_HOUR_SURCHARGE: 300,
  SPECIAL_ZONE_SURCHARGE: {
    SCHOOL: 800,
    HOSPITAL: 800,
    NORMAL: 0
  },
  RISK_SCORE_ADJUSTMENT: {
    VERY_HIGH: 1200,  // 0-200
    HIGH: 800,        // 201-400
    MEDIUM: 500,      // 401-600
    LOW: 200,         // 601-800
    VERY_LOW: 0       // 801-900
  }
};

// Dynamic Fine Calculation Function
const calculateDynamicFine = (violationData) => {
  const {
    speed = 40,
    vehicleType = 'car',
    timestamp = new Date(),
    zone = 'normal',
    repeatOffenses = 0,
    riskScore = 750
  } = violationData;

  let breakdown = {
    baseFine: FINE_RULES.BASE_FINE,
    repeatMultiplier: 1,
    speedPenalty: 0,
    vehicleSurcharge: 0,
    peakHourSurcharge: 0,
    zoneSurcharge: 0,
    riskAdjustment: 0
  };

  // 1. Repeat Offender Multiplier
  if (repeatOffenses >= 8) breakdown.repeatMultiplier = 10;
  else if (repeatOffenses >= 5) breakdown.repeatMultiplier = 6;
  else if (repeatOffenses >= 3) breakdown.repeatMultiplier = 4;
  else if (repeatOffenses >= 1) breakdown.repeatMultiplier = 2;
  else breakdown.repeatMultiplier = 1;

  // 2. Speed-Based Penalty
  if (speed > 80) breakdown.speedPenalty = FINE_RULES.SPEED_PENALTIES.HIGH;
  else if (speed > 60) breakdown.speedPenalty = FINE_RULES.SPEED_PENALTIES.MODERATE;

  // 3. Vehicle Type Surcharge
  const vType = vehicleType.toUpperCase();
  breakdown.vehicleSurcharge = FINE_RULES.VEHICLE_TYPE_SURCHARGE[vType] || 0;

  // 4. Peak Hour Surcharge (8-11 AM or 5-9 PM)
  const hour = timestamp.getHours();
  if ((hour >= 8 && hour < 11) || (hour >= 17 && hour < 21)) {
    breakdown.peakHourSurcharge = FINE_RULES.PEAK_HOUR_SURCHARGE;
  }

  // 5. Special Zone Surcharge
  const zoneType = zone.toUpperCase();
  breakdown.zoneSurcharge = FINE_RULES.SPECIAL_ZONE_SURCHARGE[zoneType] || 0;

  // 6. Risk Score Adjustment
  if (riskScore <= 200) breakdown.riskAdjustment = FINE_RULES.RISK_SCORE_ADJUSTMENT.VERY_HIGH;
  else if (riskScore <= 400) breakdown.riskAdjustment = FINE_RULES.RISK_SCORE_ADJUSTMENT.HIGH;
  else if (riskScore <= 600) breakdown.riskAdjustment = FINE_RULES.RISK_SCORE_ADJUSTMENT.MEDIUM;
  else if (riskScore <= 800) breakdown.riskAdjustment = FINE_RULES.RISK_SCORE_ADJUSTMENT.LOW;
  else breakdown.riskAdjustment = FINE_RULES.RISK_SCORE_ADJUSTMENT.VERY_LOW;

  // Calculate Total
  const totalFine = (breakdown.baseFine * breakdown.repeatMultiplier) +
    breakdown.speedPenalty +
    breakdown.vehicleSurcharge +
    breakdown.peakHourSurcharge +
    breakdown.zoneSurcharge +
    breakdown.riskAdjustment;

  return {
    total: totalFine,
    breakdown
  };
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
    v.fine || v.type.baseFine || 500,
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

// 0. Error Boundary
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-8 text-red-500 bg-gray-900 min-h-screen flex flex-col items-center justify-center">
          <div className="max-w-2xl w-full bg-gray-800 p-8 rounded-xl shadow-2xl border border-red-900">
            <h1 className="text-3xl font-bold mb-4 flex items-center gap-2">
              <AlertTriangle className="w-8 h-8" /> Application Error
            </h1>
            <p className="text-gray-300 mb-4">Something went wrong while rendering the application.</p>
            <pre className="bg-black/50 p-4 rounded text-sm font-mono overflow-auto max-h-60 text-red-400">
              {this.state.error && this.state.error.toString()}
            </pre>
            <button
              onClick={() => {
                localStorage.clear();
                window.location.reload();
              }}
              className="mt-6 bg-red-600 hover:bg-red-700 text-white px-6 py-2 rounded-lg font-bold transition-colors"
            >
              Clear Data & Reload
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// 1. Live Monitor Component
const LiveMonitor = ({ addViolation, darkMode }) => {
  const [mode, setMode] = useState(MODES.SIMULATION);
  const [trafficLight, setTrafficLight] = useState('RED'); // RED, GREEN, YELLOW
  const [videoSrc, setVideoSrc] = useState(null);
  const [streamUrl, setStreamUrl] = useState('');
  const [isArmed, setIsArmed] = useState(true);
  const [dragging, setDragging] = useState(null); // 'detection' | 'signal' | null
  const [resizing, setResizing] = useState(null); // 'detection' | 'signal' | null
  const mouseOffset = useRef({ x: 0, y: 0 });
  const [detectionActive, setDetectionActive] = useState(false);
  const [videoStats, setVideoStats] = useState({
    framesProcessed: 0,
    detections: 0,
    signalStatus: 'Unknown',
    lastDetection: null
  });

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

  const spawnCar = (width) => {
    if (Math.random() > 0.03) return; // Spawn rate

    const lanes = [320, 370, 420]; // 3 Lanes Y-coordinates
    const lane = lanes[Math.floor(Math.random() * lanes.length)];

    // Check overlap in specific lane
    const lastCarInLane = cars.current.findLast(c => Math.abs(c.y - lane) < 10);
    if (lastCarInLane && lastCarInLane.x < 150) return;

    const types = [
      { type: 'car', width: 100, height: 40, color: '#3B82F6', speedMod: 1 },
      { type: 'bike', width: 60, height: 25, color: '#F59E0B', speedMod: 1.2 },
      { type: 'truck', width: 160, height: 50, color: '#4B5563', speedMod: 0.7 },
    ];
    const vehicleType = types[Math.floor(Math.random() * types.length)];

    cars.current.push({
      id: Date.now() + Math.random(),
      x: -180,
      y: lane,
      ...vehicleType,
      speed: (3 + Math.random() * 2) * vehicleType.speedMod,
      plate: `GJ-${Math.floor(Math.random() * 90) + 10}-${['A', 'B', 'C', 'D', 'E'][Math.floor(Math.random() * 5)]}${['A', 'B', 'C', 'D', 'E'][Math.floor(Math.random() * 5)]}-${Math.floor(Math.random() * 9000) + 1000}`,
      hasViolated: false,
      willViolate: Math.random() < 0.4
    });
  };

  const updateSimulation = (ctx, width, height) => {
    // Draw Road (Full Width, 3 Lanes)
    ctx.fillStyle = '#1F2937';
    ctx.fillRect(0, 280, width, 180);

    // Draw Lane Markings
    ctx.strokeStyle = '#4B5563';
    ctx.setLineDash([30, 30]);
    ctx.lineWidth = 2;

    // Lane 1 Divider
    ctx.beginPath();
    ctx.moveTo(0, 340);
    ctx.lineTo(width, 340);
    ctx.stroke();

    // Lane 2 Divider
    ctx.beginPath();
    ctx.moveTo(0, 400);
    ctx.lineTo(width, 400);
    ctx.stroke();

    ctx.setLineDash([]);

    // Draw Stop Line
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 12;
    ctx.beginPath();
    ctx.moveTo(width / 2, 280);
    ctx.lineTo(width / 2, 460);
    ctx.stroke();

    // Spawn & Move Cars
    spawnCar(width);

    cars.current.forEach((car, index) => {
      // Collision Avoidance / Spacing Logic (Per Lane)
      let speedMultiplier = 1;
      // Find the closest car ahead IN THE SAME LANE
      const carAhead = cars.current.find(c => c.id !== car.id && Math.abs(c.y - car.y) < 10 && c.x > car.x && (c.x - car.x) < 200);

      if (carAhead) {
        const dist = carAhead.x - car.x;
        if (dist < 150) speedMultiplier = 0.5;
        if (dist < 110) speedMultiplier = 0;
      }

      // Traffic Light Logic
      const distToStopLine = (width / 2) - (car.x + car.width);
      const shouldStop = trafficLight === 'RED' && !car.willViolate && distToStopLine > 0 && distToStopLine < 150;

      if (shouldStop) {
        if (distToStopLine < 20) speedMultiplier = 0;
        else speedMultiplier = 0.5;
      }

      car.x += car.speed * speedMultiplier;

      // Draw Vehicle
      ctx.fillStyle = car.color;

      if (car.type === 'bike') {
        // Bike Shape
        ctx.beginPath();
        ctx.roundRect(car.x, car.y + 5, car.width, car.height - 10, 5);
        ctx.fill();
        // Rider
        ctx.fillStyle = '#111827';
        ctx.beginPath();
        ctx.arc(car.x + 30, car.y + 12, 8, 0, Math.PI * 2);
        ctx.fill();
      } else if (car.type === 'truck') {
        // Truck Shape
        ctx.fillRect(car.x, car.y, car.width, car.height);
        ctx.fillStyle = '#374151'; // Cargo
        ctx.fillRect(car.x, car.y + 5, car.width - 40, car.height - 10);
        ctx.fillStyle = '#111827'; // Cab Window
        ctx.fillRect(car.x + car.width - 35, car.y + 5, 30, 40);
      } else {
        // Car Shape
        ctx.beginPath();
        ctx.roundRect(car.x, car.y, car.width, car.height, 10);
        ctx.fill();
        // Roof
        ctx.fillStyle = '#111827';
        ctx.beginPath();
        ctx.roundRect(car.x + 20, car.y + 5, 60, car.height - 10, 5);
        ctx.fill();
      }

      // Headlights (All)
      ctx.fillStyle = '#FEF3C7';
      ctx.beginPath();
      ctx.arc(car.x + car.width - 2, car.y + 10, 4, 0, Math.PI * 2);
      ctx.arc(car.x + car.width - 2, car.y + car.height - 10, 4, 0, Math.PI * 2);
      ctx.fill();

      // License Plate (All)
      if (car.type !== 'bike') {
        ctx.fillStyle = 'white';
        ctx.fillRect(car.x + 5, car.y + car.height / 2 - 8, 25, 16);
        ctx.fillStyle = 'black';
        ctx.font = '7px monospace';
        ctx.fillText(car.plate.substring(0, 5), car.x + 7, car.y + car.height / 2 - 1);
        ctx.fillText(car.plate.substring(6), car.x + 7, car.y + car.height / 2 + 6);
      }

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

    // Generate random violation factors
    const violationData = {
      speed: Math.round(car.speed * 10),
      vehicleType: car.type,
      timestamp: new Date(),
      zone: Math.random() > 0.8 ? (Math.random() > 0.5 ? 'school' : 'hospital') : 'normal',
      repeatOffenses: Math.floor(Math.random() * 10), // 0-9 previous violations
      riskScore: Math.floor(Math.random() * 900) // 0-900
    };

    const fineCalculation = calculateDynamicFine(violationData);

    addViolation({
      type: VIOLATION_TYPES.RED_LIGHT,
      vehicleId: car.plate || `GJ-01-AB-${Math.floor(Math.random() * 9000) + 1000}`,
      timestamp: violationData.timestamp,
      evidence: evidence,
      speed: violationData.speed,
      source: mode,
      zone: violationData.zone,
      repeatOffenses: violationData.repeatOffenses,
      riskScore: violationData.riskScore,
      fine: fineCalculation.total,
      fineBreakdown: fineCalculation.breakdown
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

    // Mock Detection Feedback & Stats Update
    if (Math.random() > 0.95) {
      setDetectionActive(true);
      setVideoStats(prev => ({
        ...prev,
        detections: prev.detections + 1,
        lastDetection: new Date().toLocaleTimeString()
      }));
      setTimeout(() => setDetectionActive(false), 200);
    }

    // Update frame count and signal status
    setVideoStats(prev => ({
      ...prev,
      framesProcessed: prev.framesProcessed + 1,
      signalStatus: Math.random() > 0.5 ? 'Red' : 'Green'
    }));

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

            {/* Mock SRCGAN / Enhancement UI */}
            <button className="bg-purple-600 hover:bg-purple-500 px-3 py-1 rounded text-xs flex items-center gap-1 ml-4" title="Simulate Super-Resolution">
              <Zap size={12} /> Enhance (SRCGAN)
            </button>
            <button className="bg-blue-600 hover:bg-blue-500 px-3 py-1 rounded text-xs flex items-center gap-1" title="Simulate ANPR">
              <Search size={12} /> Detect Plates
            </button>
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
        {/* Video Analysis Info Panel */}
        {(mode === MODES.VIDEO || mode === MODES.CCTV) && (
          <div className="absolute top-4 right-4 bg-black/80 backdrop-blur-sm p-4 rounded-lg border border-cyan-500/50 min-w-[250px]">
            <h3 className="text-cyan-400 font-bold text-sm mb-3 flex items-center gap-2">
              <Activity size={16} className="animate-pulse" />
              Video Analysis
            </h3>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-gray-400">Frames Processed:</span>
                <span className="text-white font-mono">{videoStats.framesProcessed}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Motion Detections:</span>
                <span className="text-green-400 font-mono">{videoStats.detections}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Signal Status:</span>
                <span className={`font-bold ${videoStats.signalStatus === 'Red' ? 'text-red-500' : 'text-green-500'}`}>
                  {videoStats.signalStatus}
                </span>
              </div>
              {videoStats.lastDetection && (
                <div className="flex justify-between">
                  <span className="text-gray-400">Last Detection:</span>
                  <span className="text-yellow-400 font-mono text-[10px]">{videoStats.lastDetection}</span>
                </div>
              )}
              <div className="mt-3 pt-2 border-t border-gray-700">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
                  <span className="text-green-400 text-[10px]">AI Processing Active</span>
                </div>
              </div>
            </div>
          </div>
        )}

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
const Dashboard = ({ violations, darkMode }) => {
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
      if (!v.timestamp || typeof v.timestamp.getHours !== 'function') return;
      const hour = v.timestamp.getHours() + ":00";
      if (!hours[hour]) hours[hour] = { time: hour, violations: 0, revenue: 0 };
      hours[hour].violations += 1;
      hours[hour].revenue += (v.fine || v.type.baseFine || 500);
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
        <div className={`p-4 rounded-xl border flex flex-col justify-center items-center transition-colors ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200 shadow-sm'}`}>
          <div className="text-gray-400 text-sm">Current Time</div>
          <div className="text-2xl font-mono font-bold text-blue-500">
            {currentTime.toLocaleTimeString()}
          </div>
          <div className="text-xs text-gray-500">{currentTime.toLocaleDateString()}</div>
        </div>
        <div className={`p-4 rounded-xl border transition-colors ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200 shadow-sm'}`}>
          <div className="text-gray-400 text-sm">Simulation Violations</div>
          <div className="text-2xl font-bold text-purple-500">{stats.simulation}</div>
        </div>
        <div className={`p-4 rounded-xl border transition-colors ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200 shadow-sm'}`}>
          <div className="text-gray-400 text-sm">Video Upload Violations</div>
          <div className="text-2xl font-bold text-orange-500">{stats.video}</div>
        </div>
        <div className={`p-4 rounded-xl border transition-colors ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200 shadow-sm'}`}>
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
              className="bg-green-600 hover:bg-green-500 px-4 py-2 rounded flex items-center gap-2 text-white shadow-lg shadow-green-500/20"
            >
              <FileText size={16} /> Export Full History (CSV)
            </button>
          </div>

          <div className={`p-6 rounded-xl border transition-colors ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200 shadow-sm'}`}>
            <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
              <Activity className="text-purple-400" /> Hourly Violations
            </h3>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={analyticsData.length > 0 ? analyticsData : ANALYTICS_DATA}>
                  <CartesianGrid strokeDasharray="3 3" stroke={darkMode ? "#374151" : "#E5E7EB"} />
                  <XAxis dataKey="time" stroke={darkMode ? "#9CA3AF" : "#6B7280"} />
                  <YAxis stroke={darkMode ? "#9CA3AF" : "#6B7280"} />
                  <Tooltip
                    contentStyle={{ backgroundColor: darkMode ? '#1F2937' : '#FFFFFF', borderColor: darkMode ? '#374151' : '#E5E7EB', color: darkMode ? '#E5E7EB' : '#111827' }}
                    itemStyle={{ color: darkMode ? '#E5E7EB' : '#111827' }}
                  />
                  <Line type="monotone" dataKey="violations" stroke="#8B5CF6" strokeWidth={3} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className={`p-6 rounded-xl border transition-colors ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200 shadow-sm'}`}>
            <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
              <CreditCard className="text-green-400" /> Revenue Potential
            </h3>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={analyticsData.length > 0 ? analyticsData : ANALYTICS_DATA}>
                  <CartesianGrid strokeDasharray="3 3" stroke={darkMode ? "#374151" : "#E5E7EB"} />
                  <XAxis dataKey="time" stroke={darkMode ? "#9CA3AF" : "#6B7280"} />
                  <YAxis stroke={darkMode ? "#9CA3AF" : "#6B7280"} />
                  <Tooltip
                    contentStyle={{ backgroundColor: darkMode ? '#1F2937' : '#FFFFFF', borderColor: darkMode ? '#374151' : '#E5E7EB', color: darkMode ? '#E5E7EB' : '#111827' }}
                    itemStyle={{ color: darkMode ? '#E5E7EB' : '#111827' }}
                  />
                  <Bar dataKey="revenue" fill="#10B981" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Recent Violations Feed */}
        <div className={`p-6 rounded-xl border transition-colors h-[calc(100vh-12rem)] overflow-y-auto ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200 shadow-sm'}`}>
          <div className={`sticky top-0 pb-4 z-10 ${darkMode ? 'bg-gray-800' : 'bg-white'}`}>
            <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
              <Siren className="text-red-400" /> Recent Violations
            </h3>
            <div className="flex gap-2">
              {['ALL', MODES.SIMULATION, MODES.VIDEO, MODES.CCTV].map(m => (
                <button
                  key={m}
                  onClick={() => setFilter(m)}
                  className={`text-xs px-2 py-1 rounded border transition-colors ${filter === m ? 'bg-blue-600 border-blue-500 text-white' : darkMode ? 'border-gray-600 hover:bg-gray-700' : 'border-gray-300 hover:bg-gray-100'}`}
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
                <div key={i} className={`p-4 rounded-lg border transition-colors ${darkMode ? 'bg-gray-700/50 border-gray-600 hover:border-red-500' : 'bg-gray-50 border-gray-200 hover:border-red-500'}`}>
                  <div className="flex justify-between items-start mb-2">
                    <span className={`font-mono font-bold ${darkMode ? 'text-yellow-400' : 'text-blue-600'}`}>{v.vehicleId}</span>
                    <div className="text-right">
                      <div className="text-xs text-gray-400">{v.timestamp.toLocaleTimeString()}</div>
                      <div className="text-[10px] text-gray-500">{v.timestamp.toLocaleDateString()}</div>
                    </div>
                  </div>
                  <div className={`flex items-center gap-2 text-sm mb-2 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                    <span className="px-2 py-0.5 bg-red-500/20 text-red-500 rounded text-xs border border-red-500/30">
                      {v.type.label}
                    </span>
                    <span className={`text-xs px-1 rounded ${darkMode ? 'bg-gray-600' : 'bg-gray-200'}`}>{v.source}</span>
                  </div>
                  <div className="flex justify-between items-center mt-3">
                    <span className="font-bold text-green-500 text-lg">₹{v.fine || v.type.baseFine || 500}</span>
                    <button
                      onClick={() => setSelectedEvidence(v.evidence)}
                      className="text-xs bg-blue-600 hover:bg-blue-500 text-white px-3 py-1 rounded flex items-center gap-1"
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
const DriverPortal = ({ darkMode }) => {
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

// 4. Settings Component - Fine Calculation Rules
const SettingsComponent = ({ darkMode }) => {
  return (
    <div className="max-w-6xl mx-auto">
      <div className={`p-8 rounded-2xl shadow-2xl border transition-colors ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
        <div className="flex items-center gap-3 mb-6">
          <Settings className="text-blue-500" size={32} />
          <div>
            <h2 className="text-3xl font-bold">Fine Calculation Rules</h2>
            <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Dynamic penalty system for red-light violations</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Base Fine */}
          <div className={`p-6 rounded-xl border ${darkMode ? 'bg-gray-700/50 border-gray-600' : 'bg-gray-50 border-gray-200'}`}>
            <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-blue-500"></div>
              Base Fine
            </h3>
            <div className="text-4xl font-bold text-blue-500 mb-2">₹500</div>
            <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Starting point for all red-light violations</p>
          </div>

          {/* Repeat Offender Multipliers */}
          <div className={`p-6 rounded-xl border ${darkMode ? 'bg-gray-700/50 border-gray-600' : 'bg-gray-50 border-gray-200'}`}>
            <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-red-500"></div>
              Repeat Offender Multipliers
            </h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span>0 violations:</span><span className="font-bold">1× (₹500)</span></div>
              <div className="flex justify-between"><span>1-2 violations:</span><span className="font-bold text-orange-500">2× (₹1,000)</span></div>
              <div className="flex justify-between"><span>3-4 violations:</span><span className="font-bold text-orange-600">4× (₹2,000)</span></div>
              <div className="flex justify-between"><span>5-7 violations:</span><span className="font-bold text-red-500">6× (₹3,000)</span></div>
              <div className="flex justify-between"><span>8+ violations:</span><span className="font-bold text-red-600">10× (₹5,000)</span></div>
            </div>
          </div>

          {/* Speed-Based Penalties */}
          <div className={`p-6 rounded-xl border ${darkMode ? 'bg-gray-700/50 border-gray-600' : 'bg-gray-50 border-gray-200'}`}>
            <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
              Speed-Based Penalties
            </h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span>≤ 60 km/h:</span><span className="font-bold text-green-500">₹0</span></div>
              <div className="flex justify-between"><span>&gt; 60 km/h:</span><span className="font-bold text-yellow-500">+₹500</span></div>
              <div className="flex justify-between"><span>&gt; 80 km/h:</span><span className="font-bold text-red-500">+₹1,000</span></div>
            </div>
          </div>

          {/* Vehicle Type Surcharge */}
          <div className={`p-6 rounded-xl border ${darkMode ? 'bg-gray-700/50 border-gray-600' : 'bg-gray-50 border-gray-200'}`}>
            <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-purple-500"></div>
              Vehicle Type Surcharge
            </h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span>Car/Bike:</span><span className="font-bold text-green-500">₹0</span></div>
              <div className="flex justify-between"><span>Truck/Bus:</span><span className="font-bold text-purple-500">+₹400</span></div>
            </div>
          </div>

          {/* Peak Hour Surcharge */}
          <div className={`p-6 rounded-xl border ${darkMode ? 'bg-gray-700/50 border-gray-600' : 'bg-gray-50 border-gray-200'}`}>
            <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-orange-500"></div>
              Peak Hour Surcharge
            </h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span>8:00 AM - 11:00 AM:</span><span className="font-bold text-orange-500">+₹300</span></div>
              <div className="flex justify-between"><span>5:00 PM - 9:00 PM:</span><span className="font-bold text-orange-500">+₹300</span></div>
              <div className="flex justify-between"><span>Other times:</span><span className="font-bold text-green-500">₹0</span></div>
            </div>
          </div>

          {/* Special Zone Surcharge */}
          <div className={`p-6 rounded-xl border ${darkMode ? 'bg-gray-700/50 border-gray-600' : 'bg-gray-50 border-gray-200'}`}>
            <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-pink-500"></div>
              Special Zone Surcharge
            </h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span>School Zone:</span><span className="font-bold text-pink-500">+₹800</span></div>
              <div className="flex justify-between"><span>Hospital Zone:</span><span className="font-bold text-pink-500">+₹800</span></div>
              <div className="flex justify-between"><span>Regular Zone:</span><span className="font-bold text-green-500">₹0</span></div>
            </div>
          </div>
        </div>

        {/* Risk Score Adjustment */}
        <div className={`mt-6 p-6 rounded-xl border ${darkMode ? 'bg-gray-700/50 border-gray-600' : 'bg-gray-50 border-gray-200'}`}>
          <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-cyan-500"></div>
            Risk Score Adjustment
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4 text-sm">
            <div className="text-center p-3 rounded-lg bg-red-500/20 border border-red-500">
              <div className="font-bold text-red-500">Very High Risk</div>
              <div className={darkMode ? 'text-gray-300' : 'text-gray-700'}>Score: 0-200</div>
              <div className="text-lg font-bold text-red-500 mt-2">+₹1,200</div>
            </div>
            <div className="text-center p-3 rounded-lg bg-orange-500/20 border border-orange-500">
              <div className="font-bold text-orange-500">High Risk</div>
              <div className={darkMode ? 'text-gray-300' : 'text-gray-700'}>Score: 201-400</div>
              <div className="text-lg font-bold text-orange-500 mt-2">+₹800</div>
            </div>
            <div className="text-center p-3 rounded-lg bg-yellow-500/20 border border-yellow-500">
              <div className="font-bold text-yellow-500">Medium Risk</div>
              <div className={darkMode ? 'text-gray-300' : 'text-gray-700'}>Score: 401-600</div>
              <div className="text-lg font-bold text-yellow-500 mt-2">+₹500</div>
            </div>
            <div className="text-center p-3 rounded-lg bg-blue-500/20 border border-blue-500">
              <div className="font-bold text-blue-500">Low Risk</div>
              <div className={darkMode ? 'text-gray-300' : 'text-gray-700'}>Score: 601-800</div>
              <div className="text-lg font-bold text-blue-500 mt-2">+₹200</div>
            </div>
            <div className="text-center p-3 rounded-lg bg-green-500/20 border border-green-500">
              <div className="font-bold text-green-500">Very Low Risk</div>
              <div className={darkMode ? 'text-gray-300' : 'text-gray-700'}>Score: 801-900</div>
              <div className="text-lg font-bold text-green-500 mt-2">₹0</div>
            </div>
          </div>
        </div>

        {/* Formula */}
        <div className={`mt-6 p-6 rounded-xl border-2 border-blue-500 ${darkMode ? 'bg-blue-500/10' : 'bg-blue-50'}`}>
          <h3 className="text-lg font-bold mb-3 text-blue-500">Final Fine Calculation Formula</h3>
          <div className={`font-mono text-sm p-4 rounded-lg ${darkMode ? 'bg-gray-900' : 'bg-white'} border ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
            <div className="text-center">
              <span className="text-blue-500">Total Fine</span> =
              (<span className="text-blue-500">Base Fine</span> × <span className="text-red-500">Repeat Multiplier</span>) +
              <span className="text-yellow-500">Speed Penalty</span> +
              <span className="text-purple-500">Vehicle Surcharge</span> +
              <span className="text-orange-500">Peak Hour</span> +
              <span className="text-pink-500">Special Zone</span> +
              <span className="text-cyan-500">Risk Adjustment</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// --- Main App Component ---
const NavButton = ({ icon, label, active, onClick, darkMode }) => (
  <button
    onClick={onClick}
    className={`p-3 rounded-xl flex flex-col items-center gap-1 transition-all duration-200 group relative ${active
      ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/30'
      : darkMode
        ? 'text-gray-400 hover:bg-gray-700 hover:text-white'
        : 'text-gray-500 hover:bg-gray-100 hover:text-blue-600'
      }`}
  >
    {icon}
    <span className="text-[10px] font-medium">{label}</span>
    {active && (
      <div className="absolute -right-1 top-1/2 -translate-y-1/2 w-1 h-8 bg-white rounded-l-full opacity-20"></div>
    )}
  </button>
);

function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [violations, setViolations] = useState([]);
  const [darkMode, setDarkMode] = useState(true);

  const toggleTheme = () => setDarkMode(!darkMode);

  // Apply theme class to body
  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Initialize with dummy violations for demonstration
  useEffect(() => {
    const createDummyViolation = (vehicleId, minutesAgo, speed, source, zone, repeatOffenses, riskScore) => {
      const timestamp = new Date(Date.now() - 1000 * 60 * minutesAgo);
      const violationData = { speed, vehicleType: 'car', timestamp, zone, repeatOffenses, riskScore };
      const fineCalculation = calculateDynamicFine(violationData);
      return {
        type: VIOLATION_TYPES.RED_LIGHT,
        vehicleId,
        timestamp,
        evidence: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iODAwIiBoZWlnaHQ9IjQ1MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iODAwIiBoZWlnaHQ9IjQ1MCIgZmlsbD0iIzFGMjkzNyIvPjx0ZXh0IHg9IjQwMCIgeT0iMjI1IiBmb250LWZhbWlseT0iQXJpYWwiIGZvbnQtc2l6ZT0iMjQiIGZpbGw9IiNmZmYiIHRleHQtYW5jaG9yPSJtaWRkbGUiPlZpb2xhdGlvbiBFdmlkZW5jZTwvdGV4dD48L3N2Zz4=',
        speed, source, zone, repeatOffenses, riskScore,
        fine: fineCalculation.total,
        fineBreakdown: fineCalculation.breakdown
      };
    };
    const dummyViolations = [
      createDummyViolation('GJ-01-AB-5678', 15, 85, 'video', 'school', 2, 350),
      createDummyViolation('GJ-12-CD-3421', 30, 65, 'video', 'normal', 0, 750),
      createDummyViolation('GJ-05-EF-7890', 45, 55, 'cctv', 'hospital', 5, 250),
      createDummyViolation('GJ-22-GH-1234', 60, 72, 'video', 'normal', 1, 820),
      createDummyViolation('GJ-18-IJ-5567', 90, 48, 'cctv', 'normal', 8, 150)
    ];

    // Only set dummy data if no violations exist yet
    setViolations(prev => prev.length === 0 ? dummyViolations : prev);
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
    <ErrorBoundary>
      <div className={`min-h-screen font-sans transition-colors duration-300 ${darkMode ? 'bg-gray-900 text-gray-100' : 'bg-gray-100 text-gray-900'}`}>
        {/* Sidebar / Navigation */}
        <nav className={`fixed left-0 top-0 h-full w-20 border-r flex flex-col items-center py-6 gap-8 z-50 transition-colors duration-300 ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200 shadow-lg'}`}>
          <div className="p-3 bg-blue-600 rounded-xl shadow-lg shadow-blue-500/20">
            <Zap size={24} className="text-white" />
          </div>

          <div className="flex flex-col gap-4 w-full px-2">
            <NavButton icon={<LayoutDashboard />} label="Dash" active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} darkMode={darkMode} />
            <NavButton icon={<Camera />} label="Live" active={activeTab === 'live'} onClick={() => setActiveTab('live')} darkMode={darkMode} />
            <NavButton icon={<Search />} label="Portal" active={activeTab === 'portal'} onClick={() => setActiveTab('portal')} darkMode={darkMode} />
            <NavButton icon={<Settings />} label="Settings" active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} darkMode={darkMode} />
          </div>

          <div className="mt-auto pb-6">
            <button
              onClick={toggleTheme}
              className={`p-3 rounded-xl transition-colors ${darkMode ? 'bg-gray-700 hover:bg-gray-600 text-yellow-400' : 'bg-gray-100 hover:bg-gray-200 text-orange-500'}`}
            >
              {darkMode ? <Sun size={20} /> : <Moon size={20} />}
            </button>
          </div>
        </nav>

        {/* Main Content */}
        <main className="ml-20 p-4 md:p-8 transition-all duration-300">
          <header className="flex justify-between items-center mb-8">
            <div>
              <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-500 to-purple-600 bg-clip-text text-transparent">
                TrafficGuardian
              </h1>
              <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                Intelligent Violation Detection System
              </p>
            </div>
            <div className="flex items-center gap-4">
              <div className={`flex items-center gap-2 px-4 py-2 rounded-lg border ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200 shadow-sm'}`}>
                <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
                <span className="text-sm font-medium">System Online</span>
              </div>
            </div>
          </header>

          {activeTab === 'dashboard' && <Dashboard violations={violations} darkMode={darkMode} />}
          {activeTab === 'live' && <LiveMonitor addViolation={handleAddViolation} darkMode={darkMode} />}
          {activeTab === 'portal' && <DriverPortal darkMode={darkMode} />}
          {activeTab === 'settings' && <SettingsComponent darkMode={darkMode} />}
        </main>
      </div>
    </ErrorBoundary>
  );
}


export default App;


