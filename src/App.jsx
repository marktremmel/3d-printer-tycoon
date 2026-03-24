import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
Printer,
Package,
DollarSign,
Box,
Activity,
Trash2,
Gamepad2,
ChevronRight,
Home,
Shield,
Zap,
Globe
} from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc, deleteDoc } from 'firebase/firestore';

// --- Firebase Setup ---
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

// --- Game Constants & Configuration ---
const MODELS = {
keychain: { name: 'Cat Keychain', cost: 15, duration: 3000, sellPrice: 5 },
benchy: { name: '3D Benchy', cost: 40, duration: 8000, sellPrice: 15 },
planter: { name: 'Geo Planter', cost: 100, duration: 25000, sellPrice: 40 },
lamp: { name: 'Articulated Lamp', cost: 250, duration: 70000, sellPrice: 110 },
helmet: { name: 'Cosplay Helmet', cost: 800, duration: 200000, sellPrice: 400 },
};

const PRINTER_TYPES = {
basic: { name: 'Ender Clone', speedMult: 1, color: 'text-slate-400', model: 'keychain' },
pro: { name: 'Prusa MK4', speedMult: 2.5, color: 'text-orange-400', model: 'benchy' },
industrial: { name: 'Bambu X1C', speedMult: 6, color: 'text-emerald-400', model: 'planter' },
farm: { name: 'Print Farm Rack', speedMult: 15, color: 'text-purple-400', model: 'helmet' }
};

const TYCOON_PROGRESSION = [
{ type: 'basic', cost: 0 }, // Slot 0 (Default)
{ type: 'basic', cost: 100 }, // Slot 1
{ type: 'pro', cost: 800 }, // Slot 2
{ type: 'pro', cost: 1500 }, // Slot 3
{ type: 'industrial', cost: 4000},// Slot 4
{ type: 'farm', cost: 10000 } // Slot 5
];

const PRINTER_SLOTS = [
{ x: 500, y: 700 }, { x: 900, y: 700 }, { x: 1300, y: 700 },
{ x: 500, y: 300 }, { x: 900, y: 300 }, { x: 1300, y: 300 }
];

const FILAMENT_PRICE = 20;
const BULK_FILAMENT_PRICE = 75;

const generateId = () => Math.random().toString(36).substring(2, 9);


// --- The Game Component ---
function TycoonGame({ onExit }) {
const [user, setUser] = useState(null);
const [isLoaded, setIsLoaded] = useState(false);
const [now, setNow] = useState(Date.now());

// Tycoon State
const [gameState, setGameState] = useState({
money: 50,
filament: 1000,
inventory: {},
printers: [{ id: generateId(), typeId: 'basic', state: 'idle', modelId: 'keychain', startTime: 0, duration: 0 }],
upgrades: { autoSell: false, autoManager: false, bulkSupplier: false },
stats: { totalEarned: 0, totalPrinted: 0 },
playerPos: { x: 900, y: 1200 }
});

const stateRef = useRef(gameState);
useEffect(() => { stateRef.current = gameState; }, [gameState]);

// Movement & Engine Refs
const playerRef = useRef({ x: 900, y: 1200, angle: 0 });
const keys = useRef({});
const joystick = useRef({ x: 0, y: 0 });
const cooldowns = useRef({});

// Viewport tracking for camera
const [camera, setCamera] = useState({ x: 0, y: 0 });
const [windowSize, setWindowSize] = useState({ w: window.innerWidth, h: window.innerHeight });

// Input Handlers
useEffect(() => {
const handleResize = () => setWindowSize({ w: window.innerWidth, h: window.innerHeight });
window.addEventListener('resize', handleResize);

const handleKeyDown = (e) => { keys.current[e.key.toLowerCase()] = true; };
const handleKeyUp = (e) => { keys.current[e.key.toLowerCase()] = false; };
window.addEventListener('keydown', handleKeyDown);
window.addEventListener('keyup', handleKeyUp);

return () => {
window.removeEventListener('resize', handleResize);
window.removeEventListener('keydown', handleKeyDown);
window.removeEventListener('keyup', handleKeyUp);
};
}, []);

// Firebase Setup
useEffect(() => {
const initAuth = async () => {
if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
await signInWithCustomToken(auth, __initial_auth_token);
} else {
await signInAnonymously(auth);
}
};
initAuth();
const unsubscribe = onAuthStateChanged(auth, setUser);
return () => unsubscribe();
}, []);

useEffect(() => {
if (!user) return;
const loadSave = async () => {
try {
const saveRef = doc(db, 'artifacts', appId, 'users', user.uid, 'saveData', 'tycoonSave');
const docSnap = await getDoc(saveRef);
if (docSnap.exists()) {
const data = docSnap.data();
setGameState(data);
if (data.playerPos) {
playerRef.current = { ...data.playerPos, angle: 0 };
}
}
} catch (err) {
console.error("Error loading save:", err);
} finally {
setIsLoaded(true);
}
};
loadSave();
}, [user]);

// Game/Tycoon Core Loop
useEffect(() => {
if (!isLoaded) return;

let lastTime = performance.now();
let animationFrameId;

const gameLoop = (time) => {
const dt = (time - lastTime) / 1000;
lastTime = time;

// 1. Movement Logic
const speed = 400; // pixels per second
let dx = joystick.current.x;
let dy = joystick.current.y;

if (keys.current['w'] || keys.current['arrowup']) dy = -1;
if (keys.current['s'] || keys.current['arrowdown']) dy = 1;
if (keys.current['a'] || keys.current['arrowleft']) dx = -1;
if (keys.current['d'] || keys.current['arrowright']) dx = 1;

// Normalize diagonal movement
if (dx !== 0 || dy !== 0) {
const length = Math.sqrt(dx*dx + dy*dy);
dx /= length; dy /= length;

// Update angle for character rotation
playerRef.current.angle = Math.atan2(dy, dx) * (180 / Math.PI) + 90;
}

let nx = playerRef.current.x + dx * speed * dt;
let ny = playerRef.current.y + dy * speed * dt;

// Clamp to Baseplate Bounds (200, 200 to 1600, 1600)
nx = Math.max(200, Math.min(1600, nx));
ny = Math.max(200, Math.min(1600, ny));

playerRef.current.x = nx;
playerRef.current.y = ny;

// Update Camera
setCamera({
x: nx - windowSize.w / 2,
y: ny - windowSize.h / 2
});

// 2. Collision with Tycoon Pads
const px = playerRef.current.x;
const py = playerRef.current.y;
const pads = getActivePads(stateRef.current);

pads.forEach(pad => {
// Simple AABB collision with center player point inside pad rect
if (px >= pad.x - pad.w/2 && px <= pad.x + pad.w/2 && py>= pad.y - pad.h/2 && py <= pad.y + pad.h/2) { const
        nowTime=Date.now(); if (nowTime> (cooldowns.current[pad.id] || 0)) {
        if (pad.action(stateRef.current)) {
        // Success flash/cooldown
        cooldowns.current[pad.id] = nowTime + (pad.cooldown || 500);
        } else {
        // Failed (no money) - shorter cooldown
        cooldowns.current[pad.id] = nowTime + 200;
        }
        }
        }
        });

        animationFrameId = requestAnimationFrame(gameLoop);
        };

        animationFrameId = requestAnimationFrame(gameLoop);
        return () => cancelAnimationFrame(animationFrameId);
        }, [isLoaded, windowSize]);

        // Printer Production Logic
        useEffect(() => {
        if (!isLoaded) return;
        const interval = setInterval(() => {
        const currentTime = Date.now();
        setNow(currentTime);

        setGameState(prev => {
        let newState = { ...prev, playerPos: { x: playerRef.current.x, y: playerRef.current.y } };
        let changed = false;

        const nextPrinters = newState.printers.map(p => {
        if (p.state === 'printing' && currentTime >= p.startTime + p.duration) {
        changed = true;
        const model = MODELS[p.modelId];

        if (newState.upgrades.autoManager) {
        newState.inventory = { ...newState.inventory, [p.modelId]: (newState.inventory[p.modelId] || 0) + 1 };
        newState.stats.totalPrinted++;
        if (newState.filament >= model.cost) {
        newState.filament -= model.cost;
        return { ...p, startTime: currentTime, state: 'printing' };
        } else {
        return { ...p, state: 'idle' };
        }
        } else {
        return { ...p, state: 'finished' };
        }
        }
        return p;
        });

        if (changed) newState.printers = nextPrinters;

        if (newState.upgrades.autoSell) {
        let soldValue = 0;
        let inventoryChanged = false;
        const newInventory = { ...newState.inventory };
        Object.keys(newInventory).forEach(modelId => {
        const count = newInventory[modelId];
        if (count > 0) {
        soldValue += count * MODELS[modelId].sellPrice;
        newInventory[modelId] = 0;
        inventoryChanged = true;
        }
        });
        if (inventoryChanged) {
        newState.inventory = newInventory;
        newState.money += soldValue;
        newState.stats.totalEarned += soldValue;
        changed = true;
        }
        }
        return changed ? newState : prev;
        });
        }, 100);
        return () => clearInterval(interval);
        }, [isLoaded]);

        // Cloud Auto-Save
        useEffect(() => {
        if (!user || !isLoaded) return;
        const saveInterval = setInterval(() => {
        const saveRef = doc(db, 'artifacts', appId, 'users', user.uid, 'saveData', 'tycoonSave');
        setDoc(saveRef, stateRef.current).catch(console.error);
        }, 5000);
        return () => clearInterval(saveInterval);
        }, [user, isLoaded]);

        // --- Tycoon Actions ---
        const getActivePads = (state) => {
        const pads = [];

        pads.push({
        id: 'start_all', x: 700, y: 1100, w: 100, h: 100, color: 'bg-blue-500', shadow: 'shadow-blue-500',
        text: 'START ALL\nPRINTERS',
        action: (s) => {
        let started = false;
        setGameState(prev => {
        let currentFilament = prev.filament;
        const newPrinters = prev.printers.map(p => {
        if (p.state === 'idle') {
        const modelCost = MODELS[p.modelId].cost;
        if (currentFilament >= modelCost) {
        currentFilament -= modelCost;
        started = true;
        const actualDuration = MODELS[p.modelId].duration / PRINTER_TYPES[p.typeId].speedMult;
        return { ...p, state: 'printing', startTime: Date.now(), duration: actualDuration };
        }
        }
        return p;
        });
        return started ? { ...prev, filament: currentFilament, printers: newPrinters } : prev;
        });
        return started;
        }
        });

        if (!state.upgrades.autoManager) {
        pads.push({
        id: 'collect_all', x: 1100, y: 1100, w: 100, h: 100, color: 'bg-yellow-400', shadow: 'shadow-yellow-400',
        text: 'COLLECT\nPRINTS',
        action: (s) => {
        let collected = false;
        setGameState(prev => {
        let newInv = { ...prev.inventory };
        let count = 0;
        const newPrinters = prev.printers.map(p => {
        if (p.state === 'finished') {
        newInv[p.modelId] = (newInv[p.modelId] || 0) + 1;
        count++; collected = true;
        return { ...p, state: 'idle' };
        }
        return p;
        });
        return collected ? { ...prev, inventory: newInv, stats: { ...prev.stats, totalPrinted: prev.stats.totalPrinted +
        count }, printers: newPrinters } : prev;
        });
        return collected;
        }
        });
        }

        if (!state.upgrades.autoSell) {
        pads.push({
        id: 'sell_all', x: 1100, y: 1300, w: 100, h: 100, color: 'bg-green-500', shadow: 'shadow-green-500',
        text: 'SELL ALL\nSTOCK',
        action: (s) => {
        let sold = false;
        setGameState(prev => {
        let revenue = 0;
        const newInv = { ...prev.inventory };
        Object.entries(newInv).forEach(([id, count]) => {
        if (count > 0) {
        revenue += count * MODELS[id].sellPrice;
        newInv[id] = 0;
        sold = true;
        }
        });
        return sold ? { ...prev, money: prev.money + revenue, inventory: newInv, stats: { ...prev.stats, totalEarned:
        prev.stats.totalEarned + revenue } } : prev;
        });
        return sold;
        }
        });
        }

        pads.push({
        id: 'buy_filament', x: 700, y: 1300, w: 100, h: 100, color: 'bg-slate-400', shadow: 'shadow-slate-400',
        text: `BUY FILAMENT\n$${FILAMENT_PRICE}`, cooldown: 300,
        action: (s) => {
        if (s.money < FILAMENT_PRICE) return false; setGameState(prev=> ({ ...prev, money: prev.money - FILAMENT_PRICE,
            filament: prev.filament + 1000 }));
            return true;
            }
            });

            if (state.upgrades.bulkSupplier) {
            pads.push({
            id: 'buy_bulk_filament', x: 500, y: 1300, w: 100, h: 100, color: 'bg-purple-500', shadow:
            'shadow-purple-500',
            text: `BULK BOX\n$${BULK_FILAMENT_PRICE}`, cooldown: 300,
            action: (s) => {
            if (s.money < BULK_FILAMENT_PRICE) return false; setGameState(prev=> ({ ...prev, money: prev.money -
                BULK_FILAMENT_PRICE, filament: prev.filament + 5000 }));
                return true;
                }
                });
                }

                const currentPrinterCount = state.printers.length;
                if (currentPrinterCount < TYCOON_PROGRESSION.length) { const
                    nextPrinter=TYCOON_PROGRESSION[currentPrinterCount]; const slot=PRINTER_SLOTS[currentPrinterCount];
                    pads.push({ id: `buy_printer_${currentPrinterCount}`, x: slot.x, y: slot.y + 120, w: 120, h: 80,
                    color: 'bg-red-500' , shadow: 'shadow-red-500' , text: `BUY PRINTER\n$${nextPrinter.cost}`, action:
                    (s)=> {
                    if (s.money < nextPrinter.cost) return false; setGameState(prev=> ({
                        ...prev,
                        money: prev.money - nextPrinter.cost,
                        printers: [...prev.printers, {
                        id: generateId(), typeId: nextPrinter.type, state: 'idle',
                        modelId: PRINTER_TYPES[nextPrinter.type].model, startTime: 0, duration: 0
                        }]
                        }));
                        return true;
                        }
                        });
                        }

                        if (!state.upgrades.bulkSupplier && state.printers.length >= 2) {
                        pads.push({
                        id: 'upg_bulk', x: 1300, y: 1100, w: 100, h: 100, color: 'bg-purple-600', shadow:
                        'shadow-purple-500',
                        text: 'UPGRADE:\nBULK SUPPLY\n$200',
                        action: (s) => {
                        if (s.money < 200) return false; setGameState(prev=> ({ ...prev, money: prev.money - 200,
                            upgrades: { ...prev.upgrades, bulkSupplier: true } }));
                            return true;
                            }
                            });
                            }
                            if (!state.upgrades.autoManager && state.printers.length >= 3) {
                            pads.push({
                            id: 'upg_manager', x: 1300, y: 1300, w: 100, h: 100, color: 'bg-orange-500', shadow:
                            'shadow-orange-500',
                            text: 'UPGRADE:\nAUTO-MGR\n$500',
                            action: (s) => {
                            if (s.money < 500) return false; setGameState(prev=> ({ ...prev, money: prev.money - 500,
                                upgrades: { ...prev.upgrades, autoManager: true } }));
                                return true;
                                }
                                });
                                }
                                if (!state.upgrades.autoSell && state.printers.length >= 4) {
                                pads.push({
                                id: 'upg_sell', x: 1500, y: 1300, w: 100, h: 100, color: 'bg-emerald-500', shadow:
                                'shadow-emerald-500',
                                text: 'UPGRADE:\nAUTO-SELL\n$1500',
                                action: (s) => {
                                if (s.money < 1500) return false; setGameState(prev=> ({ ...prev, money: prev.money -
                                    1500, upgrades: { ...prev.upgrades, autoSell: true } }));
                                    return true;
                                    }
                                    });
                                    }

                                    state.printers.forEach((p, idx) => {
                                    const slot = PRINTER_SLOTS[idx];
                                    pads.push({
                                    id: `cycle_model_${p.id}`, x: slot.x - 120, y: slot.y, w: 80, h: 60, color:
                                    'bg-pink-500', shadow: 'shadow-pink-500',
                                    text: 'CYCLE\nMODEL', cooldown: 300,
                                    action: (s) => {
                                    const modelKeys = Object.keys(MODELS);
                                    const currentIdx = modelKeys.indexOf(p.modelId);
                                    const nextModel = modelKeys[(currentIdx + 1) % modelKeys.length];
                                    setGameState(prev => ({
                                    ...prev,
                                    printers: prev.printers.map(printer => printer.id === p.id ? { ...printer, modelId:
                                    nextModel } : printer)
                                    }));
                                    return true;
                                    }
                                    });
                                    });

                                    return pads;
                                    };

                                    const activePads = useMemo(() => getActivePads(gameState), [gameState]);

                                    // Mobile Joystick Handlers
                                    const handleTouchStart = (e) => updateJoystick(e.touches[0]);
                                    const handleTouchMove = (e) => updateJoystick(e.touches[0]);
                                    const handleTouchEnd = () => { joystick.current = { x: 0, y: 0 }; };

                                    const updateJoystick = (touch) => {
                                    const joyBase = { x: 80, y: windowSize.h - 80 };
                                    const dx = touch.clientX - joyBase.x;
                                    const dy = touch.clientY - joyBase.y;
                                    const distance = Math.sqrt(dx*dx + dy*dy);
                                    const maxDist = 40;

                                    if (distance === 0) {
                                    joystick.current = { x: 0, y: 0 };
                                    } else {
                                    const factor = Math.min(distance, maxDist) / distance;
                                    joystick.current = { x: (dx * factor) / maxDist, y: (dy * factor) / maxDist };
                                    }
                                    };

                                    const resetGame = async () => {
                                    if (window.confirm('Wipe all Tycoon data? This cannot be undone.')) {
                                    if (user) {
                                    try {
                                    const saveRef = doc(db, 'artifacts', appId, 'users', user.uid, 'saveData',
                                    'tycoonSave');
                                    await deleteDoc(saveRef);
                                    } catch (err) {}
                                    }
                                    window.location.reload();
                                    }
                                    };

                                    if (!isLoaded) {
                                    return (
                                    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center text-slate-200 gap-4"
                                        style={{
                                        backgroundImage: 'linear-gradient(#1e293b 2px, transparent 2px), linear-gradient(90deg, #1e293b 2px, transparent 2px)'
                                        , backgroundSize: '40px 40px' }}>
                                        <Activity size={64} className="animate-spin text-blue-500" />
                                        <h2
                                            className="text-3xl font-black uppercase tracking-wider text-white drop-shadow-md">
                                            Loading Tycoon...</h2>
                                    </div>
                                    );
                                    }

                                    const renderProgressBar = (p) => {
                                    if (p.state === 'idle') return '0%';
                                    if (p.state === 'finished') return '100%';
                                    const percent = Math.min(100, ((now - p.startTime) / p.duration) * 100);
                                    return `${percent}%`;
                                    };

                                    return (
                                    <div
                                        className="w-full h-full bg-sky-900 overflow-hidden relative select-none touch-none font-sans">
                                        <div className="absolute top-0 left-0 transition-transform duration-75 ease-linear"
                                            style={{ width: '2000px' , height: '2000px' , transform:
                                            `translate(${-camera.x}px, ${-camera.y}px)`, }}>
                                            <div className="absolute top-[200px] left-[200px] w-[1400px] h-[1400px] bg-slate-700 border-[16px] border-slate-800 rounded-3xl shadow-2xl"
                                                style={{
                                                backgroundImage: 'radial-gradient(circle, #334155 20%, transparent 21%), radial-gradient(circle, #334155 20%, transparent 21%)'
                                                , backgroundSize: '40px 40px' , backgroundPosition: '0 0, 20px 20px' }}>
                                                <div
                                                    className="absolute -top-16 left-1/2 -translate-x-1/2 text-5xl font-black text-slate-800 opacity-50 uppercase tracking-widest drop-shadow-sm whitespace-nowrap">
                                                    Your Print Empire
                                                </div>
                                            </div>

                                            {activePads.map(pad => (
                                            <div key={pad.id} className={`absolute rounded-xl border-b-8 border-r-8
                                                border-black/40 flex items-center justify-center text-center
                                                shadow-[0_0_20px_rgba(0,0,0,0.5)] transition-all ${pad.color}
                                                ${pad.shadow}`} style={{ left: pad.x - pad.w/2, top: pad.y - pad.h/2,
                                                width: pad.w, height: pad.h, }}>
                                                <span
                                                    className="text-white font-black uppercase tracking-wider text-sm whitespace-pre-line drop-shadow-md leading-tight">
                                                    {pad.text}
                                                </span>
                                            </div>
                                            ))}

                                            {gameState.printers.map((p, idx) => {
                                            const slot = PRINTER_SLOTS[idx];
                                            const pType = PRINTER_TYPES[p.typeId];
                                            const model = MODELS[p.modelId];
                                            return (
                                            <div key={p.id}
                                                className="absolute flex flex-col items-center justify-end transition-all"
                                                style={{ left: slot.x - 60, top: slot.y - 100, width: 120, height: 160
                                                }}>
                                                <div
                                                    className="bg-slate-900/90 border-2 border-slate-950 p-2 rounded-lg mb-2 shadow-xl flex flex-col items-center min-w-[140px]">
                                                    <span className={`font-black uppercase text-xs
                                                        ${pType.color}`}>{pType.name}</span>
                                                    <span
                                                        className="text-white font-bold text-[10px] uppercase truncate max-w-full">
                                                        {model.name} ({model.cost}g)
                                                    </span>

                                                    <div
                                                        className="w-full h-3 bg-slate-950 rounded-full mt-1 border-2 border-slate-700 overflow-hidden relative">
                                                        <div className={`h-full ${p.state==='finished' ? 'bg-green-500'
                                                            : 'bg-blue-500' }`} style={{ width: renderProgressBar(p)
                                                            }} />
                                                    </div>
                                                    <span
                                                        className="text-[9px] text-slate-400 font-bold uppercase mt-1">
                                                        {p.state === 'printing' && gameState.upgrades.autoManager ?
                                                        'AUTO' : p.state}
                                                    </span>
                                                </div>

                                                <div className={`w-24 h-24 bg-slate-800 border-b-[12px] border-r-8
                                                    border-slate-950 rounded-xl relative flex items-center
                                                    justify-center shadow-2xl`}>
                                                    <Printer size={48} className={pType.color} />
                                                    {p.state === 'finished' && (
                                                    <div
                                                        className="absolute -top-4 right-0 text-green-400 animate-bounce">
                                                        <Package size={24} className="fill-green-500/20" />
                                                    </div>
                                                    )}
                                                </div>
                                            </div>
                                            );
                                            })}

                                            <div className="absolute z-50 w-12 h-12 flex items-center justify-center"
                                                style={{ left: playerRef.current.x - 24, top: playerRef.current.y - 24,
                                                transform: `rotate(${playerRef.current.angle}deg)`,
                                                transition: 'transform 0.1s linear' }}>
                                                <div
                                                    className="relative w-12 h-12 shadow-[0_10px_10px_rgba(0,0,0,0.5)] drop-shadow-2xl">
                                                    <div
                                                        className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-8 bg-yellow-400 rounded-md border-4 border-yellow-600 z-30">
                                                    </div>
                                                    <div
                                                        className="absolute top-6 left-1/2 -translate-x-1/2 w-12 h-10 bg-blue-600 rounded-md border-4 border-blue-800 z-20">
                                                    </div>
                                                    <div
                                                        className="absolute top-7 -left-1 w-4 h-8 bg-yellow-400 rounded-full border-2 border-yellow-600 z-10">
                                                    </div>
                                                    <div
                                                        className="absolute top-7 -right-1 w-4 h-8 bg-yellow-400 rounded-full border-2 border-yellow-600 z-10">
                                                    </div>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Header HUD */}
                                        <header
                                            className="absolute top-0 left-0 right-0 bg-slate-900/95 backdrop-blur-md border-b-8 border-slate-950 z-50 shadow-2xl">
                                            <div
                                                className="max-w-7xl mx-auto px-4 h-20 flex items-center justify-between">
                                                <div className="flex items-center gap-3">
                                                    {/* Back to Home Button added for Website integration */}
                                                    <button onClick={onExit}
                                                        className="bg-slate-800 p-2.5 rounded-xl border-b-4 border-slate-950 hover:bg-slate-700 transition-colors mr-2 flex items-center text-slate-300"
                                                        title="Back to Website">
                                                        <Home size={20} />
                                                    </button>

                                                    <div
                                                        className="bg-blue-500 p-2.5 rounded-xl border-b-4 border-blue-700 hidden sm:block">
                                                        <Printer className="text-white" size={24} />
                                                    </div>
                                                    <h1
                                                        className="text-xl sm:text-2xl font-black uppercase tracking-widest text-white drop-shadow-md">
                                                        Tycoon Base
                                                    </h1>
                                                </div>

                                                <div
                                                    className="flex gap-4 sm:gap-8 bg-slate-800/80 p-2 px-6 rounded-2xl border-4 border-slate-950 shadow-inner">
                                                    <div className="flex flex-col items-end">
                                                        <span
                                                            className="text-[10px] text-green-400 font-black uppercase tracking-widest">Cash</span>
                                                        <div
                                                            className="flex items-center gap-1 text-white font-black text-lg sm:text-2xl drop-shadow-md">
                                                            <DollarSign size={20} className="text-green-500" />
                                                            {gameState.money.toLocaleString()}
                                                        </div>
                                                    </div>
                                                    <div
                                                        className="w-1 h-10 bg-slate-700 rounded-full mx-2 hidden sm:block">
                                                    </div>
                                                    <div className="flex flex-col items-end">
                                                        <span
                                                            className="text-[10px] text-blue-400 font-black uppercase tracking-widest">Material</span>
                                                        <div
                                                            className="flex items-center gap-1 text-white font-black text-lg sm:text-2xl drop-shadow-md">
                                                            <Box size={20} className="text-blue-500" />
                                                            {gameState.filament.toLocaleString()}
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </header>

                                        {/* Inventory Mini-HUD */}
                                        <div
                                            className="absolute top-24 left-4 bg-slate-900/90 border-4 border-slate-950 p-3 rounded-xl z-50 shadow-xl max-w-[200px] pointer-events-none hidden md:block">
                                            <h3
                                                className="text-xs text-slate-400 font-black uppercase tracking-widest border-b-2 border-slate-800 pb-1 mb-2">
                                                Backpack</h3>
                                            {Object.entries(gameState.inventory).filter(([_, count]) => count >
                                            0).length === 0 ? (
                                            <span className="text-slate-600 text-xs font-bold uppercase">Empty</span>
                                            ) : (
                                            <div className="space-y-1">
                                                {Object.entries(gameState.inventory).filter(([_, count]) => count >
                                                0).map(([id, count]) => (
                                                <div key={id}
                                                    className="flex justify-between text-xs font-bold text-white uppercase">
                                                    <span className="truncate mr-2">{MODELS[id].name}</span>
                                                    <span className="text-green-400">x{count}</span>
                                                </div>
                                                ))}
                                            </div>
                                            )}
                                        </div>

                                        {/* Mobile Virtual Joystick */}
                                        <div className="absolute bottom-8 left-8 w-32 h-32 bg-slate-900/50 border-4 border-slate-800 rounded-full z-50 md:hidden touch-none"
                                            onTouchStart={handleTouchStart} onTouchMove={handleTouchMove}
                                            onTouchEnd={handleTouchEnd}>
                                            <div className="absolute w-12 h-12 bg-blue-500 rounded-full border-b-4 border-blue-700 shadow-lg pointer-events-none transition-transform duration-75"
                                                style={{ left: '50%' , top: '50%' , transform: `translate(calc(-50% +
                                                ${joystick.current.x * 40}px), calc(-50% + ${joystick.current.y *
                                                40}px))` }} />
                                        </div>

                                        <button onClick={resetGame}
                                            className="absolute bottom-4 right-4 flex items-center gap-1 text-red-500 bg-slate-900 p-3 rounded-xl border-4 border-slate-950 shadow-lg font-black text-xs uppercase z-50 hover:bg-red-950">
                                            <Trash2 size={16} /> Wipe
                                        </button>

                                        <div
                                            className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/50 font-black uppercase tracking-widest text-xs pointer-events-none hidden md:block drop-shadow-md bg-slate-900/50 px-4 py-2 rounded-full">
                                            Use WASD or Arrows to Move. Step on colored pads to interact!
                                        </div>
                                    </div>
                                    );
                                    }

                                    // --- Main Website Application ---
                                    export default function App() {
                                    const [currentView, setCurrentView] = useState('home'); // 'home' or 'game'

                                    // If the game view is active, render only the game filling the screen
                                    if (currentView === 'game') {
                                    return (
                                    <div className="w-full h-screen overflow-hidden">
                                        <TycoonGame onExit={()=> setCurrentView('home')} />
                                    </div>
                                    );
                                    }

                                    // Otherwise, render the Website Landing Page
                                    return (
                                    <div
                                        className="min-h-screen bg-slate-950 text-slate-200 font-sans selection:bg-blue-500/30 flex flex-col">

                                        {/* Background Grid Decoration */}
                                        <div className="fixed inset-0 pointer-events-none z-0 opacity-20" style={{
                                            backgroundImage: 'linear-gradient(#334155 1px, transparent 1px), linear-gradient(90deg, #334155 1px, transparent 1px)'
                                            , backgroundSize: '40px 40px' }} />

                                        {/* Navbar */}
                                        <nav
                                            className="relative z-10 border-b border-slate-800 bg-slate-950/80 backdrop-blur-md">
                                            <div
                                                className="max-w-6xl mx-auto px-6 h-20 flex items-center justify-between">
                                                <div className="flex items-center gap-3">
                                                    <div
                                                        className="bg-blue-600 p-2 rounded-xl border-b-4 border-blue-800">
                                                        <Printer className="text-white" size={24} />
                                                    </div>
                                                    <span
                                                        className="text-xl font-black uppercase tracking-widest text-white">3D
                                                        Print Tycoon</span>
                                                </div>
                                                <div
                                                    className="hidden md:flex items-center gap-8 text-sm font-bold uppercase text-slate-400">
                                                    <a href="#features"
                                                        className="hover:text-white transition-colors">Features</a>
                                                    <a href="#about"
                                                        className="hover:text-white transition-colors">About</a>
                                                    <button onClick={()=> setCurrentView('game')}
                                                        className="bg-white text-slate-900 px-6 py-2.5 rounded-full
                                                        font-black hover:bg-slate-200 transition-colors"
                                                        >
                                                        Play Free
                                                    </button>
                                                </div>
                                            </div>
                                        </nav>

                                        {/* Hero Section */}
                                        <main
                                            className="relative z-10 flex-grow flex flex-col items-center justify-center text-center px-4 py-20 overflow-hidden">

                                            {/* Decorative Glow */}
                                            <div
                                                className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-blue-600/20 rounded-full blur-[120px] pointer-events-none">
                                            </div>

                                            <div className="max-w-4xl mx-auto flex flex-col items-center relative z-10">
                                                <div
                                                    className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-slate-900 border border-slate-800 text-blue-400 text-sm font-bold uppercase tracking-wider mb-8">
                                                    <Globe size={16} /> Web Version Now Live
                                                </div>

                                                <h1
                                                    className="text-5xl md:text-7xl font-black text-white uppercase tracking-tight leading-none mb-6 drop-shadow-2xl">
                                                    Build Your Own <br />
                                                    <span
                                                        className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-emerald-400">
                                                        Printing Empire
                                                    </span>
                                                </h1>

                                                <p
                                                    className="text-lg md:text-xl text-slate-400 max-w-2xl mb-12 font-medium">
                                                    Jump into a fully 3D interactive tycoon game. Walk around your base,
                                                    buy new hardware, manage your filament supply, and become the
                                                    richest maker on the server.
                                                </p>

                                                <button onClick={()=> setCurrentView('game')}
                                                    className="group relative inline-flex items-center justify-center
                                                    gap-3 bg-blue-600 text-white px-10 py-5 rounded-2xl font-black
                                                    text-xl uppercase tracking-widest overflow-hidden transition-all
                                                    hover:scale-105 active:scale-95
                                                    shadow-[0_0_40px_rgba(37,99,235,0.4)]"
                                                    >
                                                    {/* Button 3D bottom edge styling built-in */}
                                                    <div
                                                        className="absolute inset-0 bg-blue-700 mt-2 rounded-2xl -z-10 group-hover:mt-1 transition-all">
                                                    </div>
                                                    <Gamepad2 size={28} />
                                                    Enter the Game
                                                    <ChevronRight
                                                        className="group-hover:translate-x-1 transition-transform" />
                                                </button>
                                            </div>
                                        </main>

                                        {/* Features Grid */}
                                        <section id="features"
                                            className="relative z-10 bg-slate-900/50 border-t border-slate-800 py-24">
                                            <div className="max-w-6xl mx-auto px-6">
                                                <div className="text-center mb-16">
                                                    <h2
                                                        className="text-3xl font-black uppercase text-white mb-4 tracking-wider">
                                                        Game Features</h2>
                                                    <p className="text-slate-400 max-w-xl mx-auto">Everything you love
                                                        about classic tycoon games, built directly into your browser.
                                                    </p>
                                                </div>

                                                <div className="grid md:grid-cols-3 gap-8">
                                                    <div
                                                        className="bg-slate-900 border-2 border-slate-800 p-8 rounded-3xl hover:border-blue-500/50 transition-colors">
                                                        <div
                                                            className="w-14 h-14 bg-blue-950 text-blue-400 rounded-2xl flex items-center justify-center mb-6">
                                                            <Box size={28} />
                                                        </div>
                                                        <h3 className="text-xl font-black text-white uppercase mb-3">
                                                            Interactive Base</h3>
                                                        <p className="text-slate-400 text-sm leading-relaxed">
                                                            Control your character with WASD or an on-screen joystick.
                                                            Walk onto active pads to purchase upgrades, printers, and
                                                            sell your stock.
                                                        </p>
                                                    </div>

                                                    <div
                                                        className="bg-slate-900 border-2 border-slate-800 p-8 rounded-3xl hover:border-emerald-500/50 transition-colors">
                                                        <div
                                                            className="w-14 h-14 bg-emerald-950 text-emerald-400 rounded-2xl flex items-center justify-center mb-6">
                                                            <Zap size={28} />
                                                        </div>
                                                        <h3 className="text-xl font-black text-white uppercase mb-3">
                                                            Automate Everything</h3>
                                                        <p className="text-slate-400 text-sm leading-relaxed">
                                                            Tired of pressing buttons? Buy the Auto-Manager and
                                                            Auto-Sell upgrades to turn your factory into a passive
                                                            money-printing machine.
                                                        </p>
                                                    </div>

                                                    <div
                                                        className="bg-slate-900 border-2 border-slate-800 p-8 rounded-3xl hover:border-purple-500/50 transition-colors">
                                                        <div
                                                            className="w-14 h-14 bg-purple-950 text-purple-400 rounded-2xl flex items-center justify-center mb-6">
                                                            <Shield size={28} />
                                                        </div>
                                                        <h3 className="text-xl font-black text-white uppercase mb-3">
                                                            Cloud Saves</h3>
                                                        <p className="text-slate-400 text-sm leading-relaxed">
                                                            Your progress is automatically saved to the cloud. Leave the
                                                            website and come back later; your base and money will be
                                                            waiting for you.
                                                        </p>
                                                    </div>
                                                </div>
                                            </div>
                                        </section>

                                        {/* Footer */}
                                        <footer
                                            className="relative z-10 border-t border-slate-900 bg-slate-950 py-8 text-center text-slate-500 font-bold text-sm uppercase">
                                            <p>&copy; {new Date().getFullYear()} 3D Print Tycoon. Built with React &
                                                Tailwind.</p>
                                        </footer>

                                    </div>
                                    );
                                    }