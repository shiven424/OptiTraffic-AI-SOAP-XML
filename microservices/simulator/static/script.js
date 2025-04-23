/**
 * Updated script.js
 * --------------------------------------------
 * - After toggling debug mode, the simulation is re-drawn.
 * - When a user selects an event type (Accident, Congestion, or Traffic Light Failure)
 *   from the dropdown and clicks on a component, a corresponding effect is triggered:
 *     • "Accident": the selected road is tinted red and vehicles on that road are hidden for 100 steps.
 *     • "Congestion": the selected road is tinted yellow for 100 steps (vehicles remain visible).
 *     • "Traffic Light Failure": the clicked traffic light is tinted white for 100 steps.
 * - The road-matching logic uses vehicle position and direction (transformed into canvas space)
 *   to compute which road the vehicle is on.
 */

// ---------------- Global Variables ----------------
const SIMULATION_SERVER = "ws://localhost:5010/ws";
let ws = null;
let simulationBuffer = [];
let currentStep = 0;
let requestInterval = null;
const MAX_SPEED = 10;
const BASE_STEPS_PER_SECOND = 2;
let lastFrameTime = performance.now();
let accumulatedTime = 0;

const TRAFFIC_LIGHT_WIDTH = 3;
let TRAFFIC_LIGHT_TEXTURE;
let CAR_TEXTURE;  // Global car texture
let turnSignalTextures = []; // Array of turn signal textures

// Global dictionaries for events:
const roadAccidents = {};      // { roadId: { startStep, endStep, originalTint, highlightGraphics: [] } }
const roadCongestions = {};    // { roadId: { startStep, endStep, originalTint, highlightGraphics: [] } }
const trafficLightFailures = {}; // { lightId: { startStep, endStep, originalTint, lightSprite } }

// Store the last step rendered (for redrawing on debug toggle)
let lastRenderedStep = null;

// ---------------- Helper Functions: Texture Creation ----------------
function createValidTexture(width, height, color) {
    const graphic = new PIXI.Graphics();
    graphic.beginFill(color);
    graphic.drawRect(0, 0, width, height);
    graphic.endFill();
    const texture = app.renderer.generateTexture(graphic, {
        resolution: 1,
        scaleMode: PIXI.SCALE_MODES.LINEAR
    });
    graphic.destroy();
    return texture;
}

function createTurnSignalTexture(graphics, yOffset) {
    graphics.clear();
    graphics.beginFill(TURN_SIGNAL_COLOR, 0.7);
    graphics.drawRect(0, yOffset, TURN_SIGNAL_LENGTH, TURN_SIGNAL_WIDTH);
    graphics.endFill();
    return app.renderer.generateTexture(graphics);
}

id = Math.random().toString(36).substring(2, 15);

// ---------------- Constants ----------------
BACKGROUND_COLOR = 0xe8ebed;
LANE_COLOR = 0x586970;
LANE_BORDER_WIDTH = 1;
LANE_BORDER_COLOR = 0x82a8ba;
LANE_INNER_COLOR = 0xbed8e8;
LANE_DASH = 10;
LANE_GAP = 12;
MAX_TRAFFIC_LIGHT_NUM = 100000;
ROTATE = 90;
CAR_LENGTH = 5;
CAR_WIDTH = 2;
const CAR_COLORS = [0x1976d2, 0x4caf50, 0xffc107, 0x9c27b0, 0xf44336];
CAR_COLORS_NUM = CAR_COLORS.length;
NUM_CAR_POOL = 150000;
const LIGHT_RED = 0xf44336;
const LIGHT_GREEN = 0x4caf50;
TURN_SIGNAL_COLOR = 0xFFFFFF;
TURN_SIGNAL_WIDTH   = 1;
TURN_SIGNAL_LENGTH  = 5;

// ---------------- Global Simulation State ----------------
var simulation, roadnet;
var nodes = {};
var edges = {};
var gettingLog = false;

// ---------------- PIXI Classes and Containers ----------------
let Application = PIXI.Application,
    Sprite = PIXI.Sprite,
    Graphics = PIXI.Graphics,
    Container = PIXI.Container,
    ParticleContainer = PIXI.particles.ParticleContainer,
    Texture = PIXI.Texture,
    Rectangle = PIXI.Rectangle;

var controls = new function () {
    this.replaySpeedMax = 1;
    this.replaySpeedMin = 0.01;
    this.replaySpeed = 0.5;
    this.paused = false;
};

var trafficLightsG = {}; // For traffic light sprites keyed by roadId

var app, viewport, renderer, simulatorContainer, carContainer, trafficLightContainer;
var turnSignalContainer;
var carPool;
var cnt = 0;
var frameElapsed = 0;
var totalStep = 0;

// DOM elements
var nodeCarNum = document.getElementById("car-num") || { innerText: '0' };
var nodeProgressPercentage = document.getElementById("progress-percentage") || { innerText: '' };
var nodeTotalStep = document.getElementById("total-step-num") || { innerText: '0' };
var nodeCurrentStep = document.getElementById("current-step-num") || { innerText: '0' };
var nodeSelectedEntity = document.getElementById("selected-entity") || { innerText: '' };

var SPEED = 3, SCALE_SPEED = 1.01;
var LEFT = 37, UP = 38, RIGHT = 39, DOWN = 40;
var MINUS = 189, EQUAL = 187, P = 80;
var LEFT_BRACKET = 219, RIGHT_BRACKET = 221;
var ONE = 49, TWO = 50;
var SPACE = 32;
var keyDown = new Set();

let pauseButton = document.getElementById("pause");
let nodeCanvas = document.getElementById("simulator-canvas");
let replayControlDom = document.getElementById("replay-control");
let replaySpeedDom = document.getElementById("replay-speed");
let loading = false;
let infoDOM = document.getElementById("info");
const selectedDOM = document.getElementById("selected-entity");
const debugToggleBtn = document.getElementById("debugToggleBtn");
const debugEventTypeSelect = document.getElementById("debugEventType");
let debugMode = false;  // global flag for debug mode

// ---------------- Road-Matching Helpers ----------------
function normalizeAngle(a) {
    while (a > Math.PI) a -= 2 * Math.PI;
    while (a < -Math.PI) a += 2 * Math.PI;
    return Math.abs(a);
}

function distancePointToSegment(pt, v, w) {
    let l2 = (v.x - w.x) ** 2 + (v.y - w.y) ** 2;
    if (l2 === 0) return pt.distanceTo(v);
    let t = ((pt.x - v.x) * (w.x - v.x) + (pt.y - v.y) * (w.y - v.y)) / l2;
    t = Math.max(0, Math.min(1, t));
    let projection = new Point(v.x + t * (w.x - v.x), v.y + t * (w.y - v.y));
    return pt.distanceTo(projection);
}

function computePenalty(pt, v, w, vehAngle, factor = 20) {
    let d = distancePointToSegment(pt, v, w);
    let segAngle = Math.atan2(w.y - v.y, w.x - v.x);
    let angleDiff = normalizeAngle(vehAngle - segAngle);
    return d + factor * angleDiff;
}

/**
 * Computes the best matching road edge id for the given vehicle.
 */
function getRoadIdForVehicle(vehicle) {
    let pos = new Point(transCoord(vehicle.position));
    let vehAngle = 2 * Math.PI - vehicle.direction;
    let bestCandidate = "unknown";
    let bestPenalty = Infinity;
    for (let edgeId in edges) {
        let edge = edges[edgeId];
        for (let i = 1; i < edge.points.length; i++) {
            let p1 = edge.points[i - 1];
            let p2 = edge.points[i];
            let penalty = computePenalty(pos, p1, p2, vehAngle);
            if (penalty < bestPenalty) {
                bestPenalty = penalty;
                bestCandidate = edge.id;
            }
        }
    }
    return (bestPenalty < 30) ? bestCandidate : "unknown";
}

// ---------------- Event Trigger Functions ----------------
function onAccidentAtRoad(roadId) {
    roadAccidents[roadId] = {
        startStep: currentStep,
        endStep: currentStep + 100,
        originalTint: 0xFFFFFF,
        highlightGraphics: []
    };
    const edge = edges[roadId];
    if (!edge) return;
    edge.roadGraphicsList.forEach(gfx => {
        gfx.tint = 0xFF4444; // Red tint for accident
        roadAccidents[roadId].highlightGraphics.push(gfx);
    });
    console.log(`Accident triggered on road ${roadId} from step ${currentStep} to ${currentStep + 100}`);
}

function onCongestionAtRoad(roadId) {
    roadCongestions[roadId] = {
        startStep: currentStep,
        endStep: currentStep + 100,
        originalTint: 0xFFFFFF,
        highlightGraphics: []
    };
    const edge = edges[roadId];
    if (!edge) return;
    edge.roadGraphicsList.forEach(gfx => {
        gfx.tint = 0xFFFF00; // Yellow tint for congestion
        roadCongestions[roadId].highlightGraphics.push(gfx);
    });
    console.log(`Congestion triggered on road ${roadId} from step ${currentStep} to ${currentStep + 100}`);
}

function onTrafficLightFailure(light, lightId) {
    trafficLightFailures[lightId] = {
        startStep: currentStep,
        endStep: currentStep + 100,
        originalTint: light.tint || 0xFFFFFF,
        lightSprite: light
    };
    light.tint = 0xFFFFFF; // White tint for failure
    console.log(`Traffic light failure triggered on ${lightId} from step ${currentStep} to ${currentStep + 100}`);
}

// ---------------- UI Event Handlers ----------------
debugToggleBtn.addEventListener("click", () => {
    debugMode = !debugMode;
    debugToggleBtn.textContent = debugMode ? "Disable Debug" : "Enable Debug";
    console.log("Toggling debug mode. Now debugMode =", debugMode);
    drawRoadnet();
    if (lastRenderedStep) {
        console.log("Re-drawing last rendered step #", lastRenderedStep.step);
        drawStep(lastRenderedStep);
    }
    infoAppend(debugMode ? "Debug mode enabled" : "Debug mode disabled");
});

function sendDebugEvent(eventType, targetType, targetId) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        console.error("WebSocket not connected, cannot send debug event");
        return;
    }
    const debugEventMsg = {
        type: "debug_event",
        event_type: eventType,
        target_type: targetType,
        target_id: targetId
    };
    ws.send(JSON.stringify(debugEventMsg));
    infoAppend(`${eventType} Detected at ${targetType} ${targetId}`);
}

function highlightTemporary(graphics, color, duration = 2000) {
    const originalTint = graphics.tint || 0xFFFFFF;
    graphics.tint = color;
    setTimeout(() => graphics.tint = originalTint, duration);
}

function infoAppend(msg) {
    infoDOM.innerText += "- " + msg + "\n";
}

function infoReset() {
    infoDOM.innerText = "";
}

let ready = false;

// ---------------- WebSocket Connection ----------------
function connectWebSocket() {
    if (ws && ws.readyState !== WebSocket.CLOSED) {
        ws.close();
    }
    ws = new WebSocket(SIMULATION_SERVER);
    ws.onopen = (event) => {
        console.info("WebSocket connection established");
        simulationBuffer = [];
        ws.send(JSON.stringify({ type: "ready" }));
        if (requestInterval) clearInterval(requestInterval);
        requestInterval = setInterval(() => {
            if (ws && ws.readyState === WebSocket.OPEN && simulationBuffer.length < 10) {
                ws.send(JSON.stringify({ type: "request", count: 50 }));
            }
        }, 2000);
        const connectionAlert = document.getElementById("connection-alert");
        if (connectionAlert) {
            connectionAlert.className = "alert alert-success";
            connectionAlert.textContent = "Connected";
        }
        infoAppend("Connected to simulation server");
    };
    ws.onclose = (event) => {
        console.warn(`WebSocket closed: [${event.code}] ${event.reason}`);
        const connectionAlert = document.getElementById("connection-alert");
        if (connectionAlert) {
            connectionAlert.className = "alert alert-danger";
            connectionAlert.textContent = "Disconnected";
        }
        infoAppend("Disconnected from simulation server");
    };
    ws.onerror = (event) => {
        console.error("WebSocket error:", event);
        infoAppend("WebSocket error occurred");
    };
    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            debugIncomingMessage(data);
            if (data.type === 'step') {
                simulationBuffer.push(data.payload);
                updateBufferHealth();
            } else {
                handleSimulationData(data);
            }
        } catch (error) {
            console.error("WebSocket message error:", error);
            infoAppend(`Error: ${error.message}`);
        }
    };
}

function debugIncomingMessage(data) {
    const messageType = data.type || "unknown";
    if (messageType === 'metadata') {
        if (debugMode) {
            console.debug("[Metadata Update]", {
                total_steps: data.payload?.total_steps,
                received_steps: data.payload?.received_steps
            });
        }
        return;
    }
    switch (messageType) {
        case 'roadnet':
            if (data.payload?.static) {
                console.debug("Nodes:", data.payload.static.nodes?.length || 0);
                console.debug("Edges:", data.payload.static.edges?.length || 0);
                console.debug("Sample Node:", data.payload.static.nodes?.[0]);
            } else {
                console.warn("Malformed roadnet data");
            }
            break;
        case 'step':
            console.debug(`Step: ${data.payload?.step}`);
            console.debug(`Vehicles: ${data.payload?.vehicles?.length || 0}`);
            console.debug(`Active Traffic Lights: ${data.payload?.traffic_lights?.length || 0}`);
            break;
        default:
            console.debug("Full Message:", data);
    }
}

function updateBufferHealth() {
    const bufferSize = simulationBuffer.length;
    const health = Math.min((bufferSize / 50) * 100, 100);
    const bufferHealth = document.getElementById("buffer-health");
    if (bufferHealth) {
        bufferHealth.textContent = `${Math.round(health)}%`;
        bufferHealth.className = health < 20 ? "text-danger" : (health < 50 ? "text-warning" : "text-success");
    }
    console.debug(`Buffer status: ${bufferSize} items (${health.toFixed(0)}% health)`);
}

function handleSimulationData(data) {
    try {
        switch (data?.type) {
            case 'roadnet':
                console.log("Roadnet Data:", data.payload.static);
                if (data.payload?.static?.nodes && data.payload?.static?.edges) {
                    initSimulation(data.payload);
                } else {
                    throw new Error("Invalid roadnet structure");
                }
                break;
            case 'step':
                if (data.payload?.step !== undefined) {
                    simulationBuffer.push(data.payload);
                    updateBufferHealth();
                }
                break;
            case 'metadata':
                if (data.payload) {
                    totalStep = data.payload.total_steps || 1000;
                    document.getElementById("total-step-num").innerText = totalStep;
                    document.getElementById("received-steps").innerText = data.payload.received_steps;
                    updateBufferHealth();
                }
                break;
            default:
                console.warn("Unknown message type:", data?.type);
        }
    } catch (e) {
        console.error("Error handling simulation data:", e);
        infoAppend(e.message);
    }
}

// ---------------- Accident/Congestion/Traffic Light Failure Updates ----------------
function updateAccidents() {
    for (const roadId in roadAccidents) {
        const a = roadAccidents[roadId];
        if (currentStep >= a.endStep) {
            a.highlightGraphics.forEach(gfx => { gfx.tint = a.originalTint; });
            delete roadAccidents[roadId];
            console.log(`Accident on road ${roadId} ended at step ${currentStep}`);
        }
    }
    for (const roadId in roadCongestions) {
        const a = roadCongestions[roadId];
        if (currentStep >= a.endStep) {
            a.highlightGraphics.forEach(gfx => { gfx.tint = a.originalTint; });
            delete roadCongestions[roadId];
            console.log(`Congestion on road ${roadId} ended at step ${currentStep}`);
        }
    }
    for (const tlId in trafficLightFailures) {
        const tlf = trafficLightFailures[tlId];
        if (currentStep >= tlf.endStep) {
            tlf.lightSprite.tint = tlf.originalTint;
            delete trafficLightFailures[tlId];
            console.log(`Traffic light failure on ${tlId} ended at step ${currentStep}`);
        }
    }
}

// ---------------- Road-Matching Helper ----------------
function getRoadIdForVehicle(vehicle) {
    let pos = new Point(transCoord(vehicle.position));
    let vehAngle = 2 * Math.PI - vehicle.direction;
    let bestCandidate = "unknown";
    let bestPenalty = Infinity;
    for (let edgeId in edges) {
        let edge = edges[edgeId];
        for (let i = 1; i < edge.points.length; i++) {
            let p1 = edge.points[i - 1];
            let p2 = edge.points[i];
            let penalty = computePenalty(pos, p1, p2, vehAngle);
            if (penalty < bestPenalty) {
                bestPenalty = penalty;
                bestCandidate = edge.id;
            }
        }
    }
    return (bestPenalty < 30) ? bestCandidate : "unknown";
}

function normalizeAngle(a) {
    while (a > Math.PI) a -= 2 * Math.PI;
    while (a < -Math.PI) a += 2 * Math.PI;
    return Math.abs(a);
}

function distancePointToSegment(pt, v, w) {
    let l2 = (v.x - w.x) ** 2 + (v.y - w.y) ** 2;
    if (l2 === 0) return pt.distanceTo(v);
    let t = ((pt.x - v.x) * (w.x - v.x) + (pt.y - v.y) * (w.y - v.y)) / l2;
    t = Math.max(0, Math.min(1, t));
    let projection = new Point(v.x + t * (w.x - v.x), v.y + t * (w.y - v.y));
    return pt.distanceTo(projection);
}

function computePenalty(pt, v, w, vehAngle, factor = 20) {
    let d = distancePointToSegment(pt, v, w);
    let segAngle = Math.atan2(w.y - v.y, w.x - v.x);
    let angleDiff = normalizeAngle(vehAngle - segAngle);
    return d + factor * angleDiff;
}

/**
 * Draw the road network from simulation.static data.
 */
function initSimulation(roadnetData) {
    console.log("Initializing simulation with:", roadnetData);
    app.loader.onProgress.add(() => {
        infoAppend(`Loading resources: ${app.loader.progress}%`);
    });
    app.loader.onError.add((err) => {
        console.error("Resource loading error:", err);
        infoAppend("Failed to load graphics resources");
    });
    infoAppend("Initializing simulation...");
    ready = false;
    let guideElement = document.getElementById("guide");
    if (guideElement) {
        guideElement.classList.add("d-none");
    }
    if (app && app.view) hideCanvas();
    try {
        if (!roadnetData.static || !roadnetData.static.nodes || !roadnetData.static.edges) {
            throw new Error("Invalid roadnet structure received from server");
        }
        simulation = roadnetData;
        totalStep = simulation.total_steps || 10000;
        simulation.static.nodes.forEach(node => {
            if (node.virtual === undefined) node.virtual = false;
        });
        setTimeout(() => {
            try {
                drawRoadnet();
                ready = true;
                infoAppend("Simulation ready");
                ws.send(JSON.stringify({ type: "request", count: 50 }));
            } catch (e) {
                infoAppend("Drawing roadnet failed");
                console.error(e.message);
            }
        }, 200);
    } catch (e) {
        infoAppend("Initialization failed");
        console.error(e.message);
    }
}

function updateSimulationStats(stats) {
    try {
        if (stats && nodeTotalStep) {
            nodeTotalStep.innerText = stats.total_steps || 0;
        }
        totalStep = stats?.total_steps || 0;
        if (nodeCurrentStep) nodeCurrentStep.innerText = currentStep;
    } catch (e) {
        console.error("Error updating stats:", e);
    }
}

// ---------------- Drawing Functions ----------------
function drawStep(stepData) {
    lastRenderedStep = stepData;
    updateAccidents();
    try {
        if (stepData?.traffic_lights) {
            console.debug("Processing traffic lights:", stepData.traffic_lights);
            stepData.traffic_lights.forEach(intersection => {
                if (intersection.lights) {
                    intersection.lights.forEach(light => {
                        const sprites = trafficLightsG[light.roadLink];
                        if (sprites) {
                            light.states.forEach((state, idx) => {
                                if (sprites[idx]) {
                                    sprites[idx].tint = _statusToColor(state);
                                    sprites[idx].visible = (state !== 'i');
                                }
                            });
                        }
                    });
                }
            });
        }
        if (carContainer && turnSignalContainer) {
            carContainer.removeChildren();
            turnSignalContainer.removeChildren();
            if (stepData?.vehicles) {
                stepData.vehicles.forEach((vehicle, i) => {
                    // Use the computed road id for matching events.
                    let computedRoad = getRoadIdForVehicle(vehicle);
                    console.log("Vehicle", vehicle.id, "computed road =", computedRoad);
                    if (isRoadBlocked(computedRoad)) {
                        return;
                    }
                    if (i >= NUM_CAR_POOL) return;
                    if (!carPool[i]) return;
                    const [car, signal] = carPool[i];
                    if (!car || !signal) return;
                    const pos = transCoord(vehicle.position);
                    car.position.set(pos[0], pos[1]);
                    car.rotation = 2 * Math.PI - vehicle.direction;
                    car.name = vehicle.id;
                    car.tint = CAR_COLORS[stringHash(vehicle.id) % CAR_COLORS_NUM];
                    car.alpha = 1.0;
                    car.scale.set((vehicle.length || CAR_LENGTH) / CAR_LENGTH,
                        (vehicle.width || CAR_WIDTH) / CAR_WIDTH);
                    signal.position.set(pos[0], pos[1]);
                    signal.rotation = car.rotation;
                    let texIndex = ((vehicle.lane_change !== undefined ? vehicle.lane_change : 0) + 1);
                    if (!turnSignalTextures[texIndex]) texIndex = 0;
                    signal.texture = turnSignalTextures[texIndex];
                    signal.scale.set((vehicle.length || CAR_LENGTH) / TURN_SIGNAL_LENGTH,
                                    (vehicle.width || CAR_WIDTH) / TURN_SIGNAL_WIDTH);
                    carContainer.addChild(car);
                    turnSignalContainer.addChild(signal);
                });
            }
        }
        if (nodeCarNum) nodeCarNum.innerText = stepData?.vehicles?.length || 0;
        if (nodeCurrentStep) nodeCurrentStep.innerText = currentStep;
        if (nodeProgressPercentage) {
            nodeProgressPercentage.innerText = ((currentStep / totalStep) * 100).toFixed(2) + "%";
        }
    } catch (e) {
        console.error("Error in drawStep:", e);
        infoAppend(`Error: ${e.message}`);
    }
}

function _statusToColor(status) {
    switch (status.toLowerCase()) {
        case 'r': return 0xFF0000;
        case 'g': return 0x00FF00;
        case 'y': return 0xFFFF00;
        default:  return 0x444444;
    }
}

function stringHash(str) {
    let hash = 0, p = 127, p_pow = 1;
    const m = 1e9 + 9;
    for (let i = 0; i < str.length; i++) {
        hash = (hash + str.charCodeAt(i) * p_pow) % m;
        p_pow = (p_pow * p) % m;
    }
    return hash;
}

function isRoadBlocked(roadId) {
    if (!roadAccidents[roadId]) return false;
    return currentStep < roadAccidents[roadId].endStep;
}

// ---------------- Main Animation Loop ----------------
function run(delta) {
    if (!ready || controls.paused) return;
    const now = performance.now();
    const deltaTime = (now - lastFrameTime) / 1000;
    lastFrameTime = now;
    const targetSteps = deltaTime * BASE_STEPS_PER_SECOND * controls.replaySpeed;
    accumulatedTime += targetSteps;
    const stepsToProcess = Math.floor(accumulatedTime);
    accumulatedTime -= stepsToProcess;
    const maxStepsPerFrame = Math.min(50, Math.floor(controls.replaySpeed * 5));
    const actualSteps = Math.min(stepsToProcess, maxStepsPerFrame, simulationBuffer.length);
    if (simulationBuffer.length === 0) {
        console.warn("Simulation buffer empty!");
        return;
    }
    for (let i = 0; i < actualSteps; i++) {
        const stepData = simulationBuffer.shift();
        if (stepData && stepData.step !== undefined) {
            currentStep = stepData.step;
            drawStep(stepData);
        } else {
            console.warn("Invalid step data:", stepData);
        }
    }
    if (nodeCurrentStep) nodeCurrentStep.innerText = currentStep;
    if (nodeProgressPercentage) {
        const progress = ((currentStep / totalStep) * 100).toFixed(2);
        nodeProgressPercentage.innerText = `${progress}%`;
    }
    if (currentStep >= totalStep - 1) {
        restartSimulation();
    }
    const bufferThreshold = Math.max(10, 20 * controls.replaySpeed);
    if (ws && ws.readyState === WebSocket.OPEN) {
        if (simulationBuffer.length < bufferThreshold) {
            const requestCount = Math.floor(100 * controls.replaySpeed);
            ws.send(JSON.stringify({ type: "request", count: requestCount }));
        }
    }
    requestAnimationFrame(run);
}

function restartSimulation() {
    infoAppend("Simulation ended. Restarting...");
    ready = false;
    currentStep = 0;
    accumulatedTime = 0;
    simulationBuffer = [];
    if (ws) {
        ws.onclose = ws.onerror = ws.onmessage = null;
        ws.close();
        ws = null;
    }
    if (requestInterval) clearInterval(requestInterval);
    if (app) {
        app.destroy(true, { children: true });
        app = null;
        viewport = null;
    }
    while (nodeCanvas.firstChild) {
        nodeCanvas.removeChild(nodeCanvas.firstChild);
    }
    setTimeout(() => {
        initCanvas();
        connectWebSocket();
        infoAppend("Simulation restarted successfully.");
    }, 1500);
}

window.addEventListener('beforeunload', () => {
    if (ws) ws.close();
    if (requestInterval) clearInterval(requestInterval);
});

document.addEventListener("DOMContentLoaded", () => {
    initCanvas();
    connectWebSocket();

    const pauseBtn = document.getElementById("pause");
    if (pauseBtn) {
        pauseBtn.addEventListener('click', () => {
            controls.paused = !controls.paused;
            console.log("Pause button clicked. controls.paused =", controls.paused);
        });
    }
});

// ---------------- Initialization: UI & Replay Controls ----------------
replayControlDom.addEventListener('input', function(e) {
    const rawValue = parseFloat(e.target.value);
    const minp = 5, maxp = 100, minv = Math.log(0.1), maxv = Math.log(MAX_SPEED);
    const scale = (Math.log(0.1) + (Math.log(MAX_SPEED) - Math.log(0.1)) * ((rawValue - minp) / (maxp - minp)));
    const speed = Math.exp(scale);
    updateReplaySpeed(speed);
});

document.getElementById("slow-btn").addEventListener("click", function() {
    updateReplaySpeed(controls.replaySpeed * 0.8);
});

document.getElementById("fast-btn").addEventListener("click", function() {
    updateReplaySpeed(controls.replaySpeed * 1.25);
});

function updateReplaySpeed(speed) {
    speed = Math.min(Math.max(speed, 0.1), MAX_SPEED);
    controls.replaySpeed = speed;
    const minp = 5, maxp = 100, minv = Math.log(0.1), maxv = Math.log(MAX_SPEED);
    const sliderPos = ((Math.log(speed) - minv) / (maxv - minv)) * (maxp - minp) + minp;
    replayControlDom.value = sliderPos;
    replaySpeedDom.textContent = speed.toFixed(1) + "x";
}
updateReplaySpeed(0.5);

document.addEventListener('keydown', function(e) {
    if (e.keyCode == P) {
        controls.paused = !controls.paused;
    } else if (e.keyCode == ONE) {
        updateReplaySpeed(Math.max(controls.replaySpeed / 1.5, controls.replaySpeedMin));
    } else if (e.keyCode == TWO) {
        updateReplaySpeed(Math.min(controls.replaySpeed * 1.5, controls.replaySpeedMax));
    }
});

document.addEventListener('keyup', (e) => keyDown.delete(e.keyCode));
nodeCanvas.addEventListener('dblclick', function(e) { controls.paused = !controls.paused; });
pauseButton.addEventListener('click', function(e) { controls.paused = !controls.paused; });

// ---------------- Canvas Initialization ----------------
function initCanvas() {
    const resize = () => {
        if (app && viewport) {
            app.renderer.resize(nodeCanvas.offsetWidth, nodeCanvas.offsetHeight);
            viewport.resize(nodeCanvas.offsetWidth, nodeCanvas.offsetHeight);
        }
    };
    window.addEventListener('resize', resize);
    app = new Application({
        width: nodeCanvas.offsetWidth,
        height: nodeCanvas.offsetHeight,
        transparent: false,
        backgroundColor: BACKGROUND_COLOR,
        antialias: true,
        forceCanvas: false
    });
    console.log("PixiJS Renderer type:", app.renderer.type === PIXI.RENDERER_TYPE.WEBGL ? "WebGL" : "Canvas");
    const trafficLightGraphic = new PIXI.Graphics();
    trafficLightGraphic.beginFill(0xFFFFFF);
    trafficLightGraphic.drawRect(0, 0, 2, 2);
    trafficLightGraphic.endFill();
    TRAFFIC_LIGHT_TEXTURE = app.renderer.generateTexture(trafficLightGraphic);
    trafficLightGraphic.destroy();
    const carGraphic = new PIXI.Graphics();
    carGraphic.beginFill(0xFFFFFF, 0.8);
    carGraphic.drawRect(0, 0, CAR_LENGTH, CAR_WIDTH);
    carGraphic.endFill();
    CAR_TEXTURE = app.renderer.generateTexture(carGraphic);
    carGraphic.destroy();
    const turnSignalGraphic = new PIXI.Graphics();
    turnSignalTextures = [
        createTurnSignalTexture(turnSignalGraphic, 0),
        createTurnSignalTexture(turnSignalGraphic, CAR_WIDTH),
        createTurnSignalTexture(turnSignalGraphic, CAR_WIDTH * 2)
    ];
    renderer = app.renderer;
    app.view.style.position = 'absolute';
    nodeCanvas.appendChild(app.view);
    resize();
    simulatorContainer = null;
    carContainer = null;
    turnSignalContainer = null;
    trafficLightContainer = null;
    carPool = [];
    app.view.classList.add("d-none");
    renderer.interactive = true;
    renderer.autoResize = true;
    renderer.resize(nodeCanvas.offsetWidth, nodeCanvas.offsetHeight);
    app.ticker.add(() => { if (!controls.paused) { run(); } });
}

// ---------------- Drawing Road Network ----------------
function drawRoadnet() {
    console.log("drawRoadnet() called. Debug mode:", debugMode);
    try {
        if (!simulation?.static) throw new Error("Roadnet data not properly initialized");
        if (!Array.isArray(simulation.static.nodes) || !Array.isArray(simulation.static.edges))
            throw new Error("Invalid roadnet node/edge structure");
        console.log("Cleared containers, about to recreate them");
        if (simulatorContainer) { simulatorContainer.destroy({ children: true }); simulatorContainer = null; }
        app.stage.removeChildren();
        viewport = new Viewport.Viewport({
            screenWidth: app.screen.width,
            screenHeight: app.screen.height,
            worldWidth: 600,
            worldHeight: 600,
            interaction: app.renderer.plugins.interaction
        });
        viewport.drag().pinch().wheel({ smooth: 10 }).decelerate().clampZoom({ minScale: 0.1, maxScale: 10 });
        app.stage.addChild(viewport);
        simulatorContainer = new Container();
        viewport.addChild(simulatorContainer);
        if (debugMode) {
            trafficLightContainer = new Container();
        } else {
            trafficLightContainer = new ParticleContainer(MAX_TRAFFIC_LIGHT_NUM, { tint: true, alpha: true });
        }
        simulatorContainer.sortableChildren = true;
        trafficLightContainer.zIndex = 999;
        let mapContainer = new Container();
        console.log("Creating mapContainer, will now build 'nodes' and 'edges'");
        roadnet = simulation.static;
        nodes = {};
        edges = {};
        trafficLightsG = {};
        console.log("About to iterate roadnet.nodes. roadnet.nodes =", roadnet.nodes);
        roadnet.nodes.forEach(node => {
            console.log("Node coords before transCoord:", node.point, " => after:", transCoord(node.point));
            if (Array.isArray(node.point)) {
                node.point = new Point(transCoord(node.point));
            }
            if (node.virtual === undefined) node.virtual = false;
            nodes[node.id] = node;
        });
        console.log("Node object built. # keys in 'nodes' =", Object.keys(nodes).length);
        console.log("About to iterate roadnet.edges. roadnet.edges =", roadnet.edges);
        roadnet.edges.forEach(edgeData => {
            console.log("Edge from:", edgeData.from, "to:", edgeData.to, " => checking if these exist in nodes{}");
            if (nodes[edgeData.from] && nodes[edgeData.to]) {
                console.log("Both from & to exist. Building edges entry for", edgeData.id);
                edgeData.fromNode = nodes[edgeData.from];
                edgeData.toNode = nodes[edgeData.to];
                edgeData.points = edgeData.points.map(p => new Point(transCoord(p)));
                edges[edgeData.id] = edgeData;
            } else {
                console.warn("Skipping edge", edgeData.id, "because from/to not found in nodes{}");
            }
        });
        console.log("Edge object built. # keys in 'edges' =", Object.keys(edges).length);
        console.log("Drawing intersections...");
        for (let nodeId in nodes) {
            const node = nodes[nodeId];
            if (!node.virtual) {
                const nodeGraphics = new Graphics();
                mapContainer.addChild(nodeGraphics);
                drawNode(node, nodeGraphics);
            }
        }
        console.log("Intersections done. Drawing edges...");
        for (let edgeId in edges) {
            const edgeGraphics = new Graphics();
            mapContainer.addChild(edgeGraphics);
            console.log("drawEdge()", edgeId, edges[edgeId]);
            drawEdge(edges[edgeId], edgeGraphics);
        }
        console.log("Edge loop done, continuing with container setup...");
        simulatorContainer.addChild(mapContainer);
        console.log("mapContainer alpha=", mapContainer.alpha, "visible=", mapContainer.visible);
        if (debugMode) {
            carContainer = new Container();
        } else {
            carContainer = new ParticleContainer(NUM_CAR_POOL, { scale: true, position: true, rotation: true, tint: true });
        }
        turnSignalContainer = new ParticleContainer(NUM_CAR_POOL, { position: true, rotation: true, tint: true });
        simulatorContainer.addChild(carContainer);
        simulatorContainer.addChild(turnSignalContainer);
        simulatorContainer.addChild(trafficLightContainer);
        carPool = [];
        for (let i = 0; i < NUM_CAR_POOL; i++) {
            let car = new Sprite(CAR_TEXTURE);
            let signal = new Sprite(turnSignalTextures[1]);
            car.anchor.set(1, 0.5);
            signal.anchor.set(1, 0.5);
            car.name = `Vehicle-${i}`;
            if (debugMode) {
                car.interactive = true;
                car.on('mouseover', () => { selectedDOM.innerText = "Vehicle " + car.name; });
                car.on('click', () => {
                    selectedDOM.innerText = "Vehicle " + car.name;
                    car.tint = 0xFF4444;
                    setTimeout(() => { car.tint = 0xFFFFFF; }, 1000);
                    sendDebugEvent(debugEventTypeSelect.value, "vehicle", car.name);
                });
            }
            carPool.push([car, signal]);
        }
        let bounds = simulatorContainer.getBounds();
        simulatorContainer.pivot.set(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
        simulatorContainer.position.set(renderer.width / 2-400, renderer.height / 2-75);
        console.log("Simulator bounds after drawing:", simulatorContainer.getBounds());
        bounds = simulatorContainer.getBounds();
        viewport.fitWorld(true);
        viewport.moveCenter(bounds.width / 2, bounds.height / 2);
        console.log("Simulator bounds after drawing:", simulatorContainer.getBounds());
        showCanvas();
        return true;
    } catch (e) {
        console.error("Failed to draw roadnet:", e);
        infoAppend(`Drawing error: ${e.message}`);
        throw e;
    }
}

function transCoord(point) {
    if (!point) return [0, 0];
    if (Array.isArray(point)) {
        return [point[0], -point[1]];
    } else if (point instanceof Point) {
        return [point.x, -point.y];
    } else {
        return [0, 0];
    }
}

PIXI.Graphics.prototype.drawLine = function(pointA, pointB) {
    this.moveTo(pointA.x, pointA.y);
    this.lineTo(pointB.x, pointB.y);
};

PIXI.Graphics.prototype.drawDashLine = function(pointA, pointB, dash = 16, gap = 8) {
    let direct = pointA.directTo(pointB);
    let distance = pointA.distanceTo(pointB);
    let currentPoint = pointA;
    let currentDistance = 0;
    let length;
    let finish = false;
    while (true) {
        this.moveTo(currentPoint.x, currentPoint.y);
        if (currentDistance + dash >= distance) {
            length = distance - currentDistance;
            finish = true;
        } else {
            length = dash;
        }
        currentPoint = currentPoint.moveAlong(direct, length);
        this.lineTo(currentPoint.x, currentPoint.y);
        if (finish) break;
        currentDistance += length;
        if (currentDistance + gap >= distance) break;
        currentPoint = currentPoint.moveAlong(direct, gap);
        currentDistance += gap;
    }
};

function drawNode(node, graphics) {
    graphics.beginFill(LANE_COLOR);
    let outline = node.outline.slice();
    const centerX = node.point.x;
    const centerY = node.point.y;
    const angle = Math.PI / 4;
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    for (let i = 0; i < outline.length; i += 2) {
        let x = outline[i];
        let y = -outline[i + 1];
        x -= centerX;
        y -= centerY;
        const rotatedX = x * cosA - y * sinA;
        const rotatedY = x * sinA + y * cosA;
        outline[i] = centerX + rotatedX;
        outline[i + 1] = centerY + rotatedY;
    }
    graphics.drawPolygon(outline);
    graphics.endFill();
    if (debugMode) {
        graphics.hitArea = new PIXI.Polygon(outline);
        graphics.interactive = true;
        graphics.on("mouseover", () => {
            selectedDOM.innerText = "Intersection " + node.id;
            graphics.alpha = 0.5;
        });
        graphics.on("mouseout", () => { graphics.alpha = 1; });
        graphics.on("click", () => {
            selectedDOM.innerText = "Intersection " + node.id;
            const highlight = new PIXI.Graphics();
            highlight.beginFill(0xFFFF00, 0.3);
            highlight.drawPolygon(outline);
            highlight.endFill();
            simulatorContainer.addChild(highlight);
            setTimeout(() => simulatorContainer.removeChild(highlight), 2000);
            sendDebugEvent(debugEventTypeSelect.value, "intersection", node.id);
        });
    }
}

function drawEdge(edge, graphics) {
    let fromNode = edge.fromNode;
    let toNode = edge.toNode;
    if (!fromNode || !toNode) return;
    let points = edge.points;
    let prevPointBOffset = null;
    let roadWidth = edge.laneWidths.reduce((acc, w) => acc + w, 0);
    let coords = [], coords1 = [];
    for (let i = 1; i < points.length; ++i) {
        let pointA, pointB, pointAOffset, pointBOffset;
        if (i === 1) {
            pointA = points[0].moveAlongDirectTo(points[1], fromNode.virtual ? 0 : fromNode.width);
            pointAOffset = points[0].directTo(points[1]).rotate(ROTATE);
        } else {
            pointA = points[i - 1];
            pointAOffset = prevPointBOffset;
        }
        if (i === points.length - 1) {
            pointB = points[i].moveAlongDirectTo(points[i - 1], toNode.virtual ? 0 : toNode.width);
            pointBOffset = points[i - 1].directTo(points[i]).rotate(ROTATE);
        } else {
            pointB = points[i];
            pointBOffset = points[i - 1].directTo(points[i + 1]).rotate(ROTATE);
        }
        prevPointBOffset = pointBOffset;
        coords.push(pointA.x, pointA.y, pointB.x, pointB.y);
        let pointA1 = pointA.moveAlong(pointAOffset, roadWidth);
        let pointB1 = pointB.moveAlong(pointBOffset, roadWidth);
        coords1.push(pointA1.x, pointA1.y, pointB1.x, pointB1.y);
        if (i === points.length - 1 && !toNode.virtual) {
            const edgeTrafficLights = [];
            let prevOffset = 0;
            for (let lane = 0; lane < edge.laneWidths.length; ++lane) {
                const laneWidth = edge.laneWidths[lane];
                const light = new Sprite(TRAFFIC_LIGHT_TEXTURE);
                light.anchor.set(0, 0.5);
                light.scale.set(laneWidth, 1);
                const point_ = pointB.moveAlong(pointBOffset, prevOffset);
                light.position.set(point_.x, point_.y);
                light.rotation = pointBOffset.getAngleInRadians();
                edgeTrafficLights.push(light);
                prevOffset += laneWidth;
                trafficLightContainer.addChild(light);
                if (debugMode) {
                    light.interactive = true;
                    light.on("mouseover", () => {
                        selectedDOM.innerText = "Traffic Light @ " + toNode.id;
                        light.tint = 0xffcc00;
                    });
                    light.on("mouseout", () => { light.tint = 0xFFFFFF; });
                    light.on("click", () => {
                        selectedDOM.innerText = "Traffic Light @ " + toNode.id;
                        let eventType = debugEventTypeSelect.value.toLowerCase();
                        if (eventType === "traffic light failure") {
                            onTrafficLightFailure(light, toNode.id);
                        } else {
                            const highlight = new Graphics();
                            highlight.beginFill(0xFF0000, 0.3);
                            highlight.drawPolygon(toNode.outline);
                            highlight.endFill();
                            simulatorContainer.addChild(highlight);
                            setTimeout(() => simulatorContainer.removeChild(highlight), 2000);
                        }
                        sendDebugEvent(eventType, "traffic light", toNode.id);
                    });
                }
            }
            trafficLightsG[edge.id] = edgeTrafficLights;
        }
        graphics.lineStyle(LANE_BORDER_WIDTH, LANE_BORDER_COLOR, 1);
        graphics.drawLine(pointA, pointB);
        graphics.lineStyle(0);
        graphics.beginFill(LANE_COLOR, 1);
        graphics.drawPolygon([pointA.x, pointA.y, pointB.x, pointB.y, pointB1.x, pointB1.y, pointA1.x, pointA1.y]);
        graphics.endFill();
        let offset = 0;
        for (let l = 0; l < edge.nLane - 1; ++l) {
            offset += edge.laneWidths[l];
            let laneStart = pointA.moveAlong(pointAOffset, offset);
            let laneEnd = pointB.moveAlong(pointBOffset, offset);
            const INTERSECTION_PADDING = 3;
            laneStart = laneStart.moveAlongDirectTo(laneEnd, INTERSECTION_PADDING);
            laneEnd = laneEnd.moveAlongDirectTo(laneStart, INTERSECTION_PADDING);
            graphics.lineStyle(LANE_BORDER_WIDTH, LANE_INNER_COLOR);
            graphics.drawDashLine(laneStart, laneEnd, LANE_DASH, LANE_GAP);
        }
    }
    if (!edge.roadGraphicsList) edge.roadGraphicsList = [];
    edge.roadGraphicsList.push(graphics);
    if (debugMode) {
        let hitCoords = coords.concat(coords1.reverse());
        graphics.interactive = true;
        graphics.on("mouseover", () => {
            graphics.alpha = 0.5;
            selectedDOM.innerText = "Road " + edge.id;
        });
        graphics.on("mouseout", () => { graphics.alpha = 1; });
        graphics.on("click", () => {
            selectedDOM.innerText = "Road " + edge.id;
            const highlight = new PIXI.Graphics();
            highlight.beginFill(0xFFFF00, 0.25);
            highlight.drawPolygon(hitCoords);
            highlight.endFill();
            simulatorContainer.addChild(highlight);
            setTimeout(() => simulatorContainer.removeChild(highlight), 2000);
            let eventType = debugEventTypeSelect.value.toLowerCase();
            if (eventType === "accident") {
                onAccidentAtRoad(edge.id);
            } else if (eventType === "congestion") {
                onCongestionAtRoad(edge.id);
            }
            sendDebugEvent(eventType, "road", edge.id);
        });
    }
}

function run(delta) {
    if (!ready || controls.paused) return;
    const now = performance.now();
    const deltaTime = (now - lastFrameTime) / 1000;
    lastFrameTime = now;
    const targetSteps = deltaTime * BASE_STEPS_PER_SECOND * controls.replaySpeed;
    accumulatedTime += targetSteps;
    const stepsToProcess = Math.floor(accumulatedTime);
    accumulatedTime -= stepsToProcess;
    const maxStepsPerFrame = Math.min(50, Math.floor(controls.replaySpeed * 5));
    const actualSteps = Math.min(stepsToProcess, maxStepsPerFrame, simulationBuffer.length);
    if (simulationBuffer.length === 0) {
        console.warn("Simulation buffer empty!");
        return;
    }
    for (let i = 0; i < actualSteps; i++) {
        const stepData = simulationBuffer.shift();
        if (stepData && stepData.step !== undefined) {
            currentStep = stepData.step;
            drawStep(stepData);
        } else {
            console.warn("Invalid step data:", stepData);
        }
    }
    nodeCurrentStep.innerText = currentStep;
    nodeProgressPercentage.innerText = ((currentStep / totalStep) * 100).toFixed(2) + "%";
    if (currentStep >= totalStep - 1) {
        restartSimulation();
    }
    const bufferThreshold = Math.max(10, 20 * controls.replaySpeed);
    if (ws && ws.readyState === WebSocket.OPEN && simulationBuffer.length < bufferThreshold) {
        const requestCount = Math.floor(100 * controls.replaySpeed);
        ws.send(JSON.stringify({ type: "request", count: requestCount }));
    }
    requestAnimationFrame(run);
}

function restartSimulation() {
    infoAppend("Simulation ended. Restarting...");
    ready = false;
    currentStep = 0;
    accumulatedTime = 0;
    simulationBuffer = [];
    if (ws) {
        ws.onclose = ws.onerror = ws.onmessage = null;
        ws.close();
        ws = null;
    }
    if (requestInterval) clearInterval(requestInterval);
    if (app) {
        app.destroy(true, { children: true });
        app = null;
        viewport = null;
    }
    while (nodeCanvas.firstChild) {
        nodeCanvas.removeChild(nodeCanvas.firstChild);
    }
    setTimeout(() => {
        initCanvas();
        connectWebSocket();
        infoAppend("Simulation restarted successfully.");
    }, 1500);
}

window.addEventListener('beforeunload', () => {
    if (ws) ws.close();
    if (requestInterval) clearInterval(requestInterval);
});

document.addEventListener("DOMContentLoaded", () => {
    initCanvas();
    connectWebSocket();
});

// ---------------- Replay Control Initialization ----------------
replayControlDom.addEventListener('input', function(e) {
    const rawValue = parseFloat(e.target.value);
    const minp = 5, maxp = 100, minv = Math.log(0.1), maxv = Math.log(MAX_SPEED);
    const scale = (Math.log(0.1) + (Math.log(MAX_SPEED) - Math.log(0.1)) * ((rawValue - minp) / (maxp - minp)));
    const speed = Math.exp(scale);
    updateReplaySpeed(speed);
});
document.getElementById("slow-btn").addEventListener("click", () => {
    updateReplaySpeed(controls.replaySpeed * 0.8);
});
document.getElementById("fast-btn").addEventListener("click", () => {
    updateReplaySpeed(controls.replaySpeed * 1.25);
});
function updateReplaySpeed(speed) {
    speed = Math.min(Math.max(speed, 0.1), MAX_SPEED);
    controls.replaySpeed = speed;
    const minp = 5, maxp = 100, minv = Math.log(0.1), maxv = Math.log(MAX_SPEED);
    const sliderPos = ((Math.log(speed) - minv) / (maxv - minv)) * (maxp - minp) + minp;
    replayControlDom.value = sliderPos;
    replaySpeedDom.textContent = speed.toFixed(1) + "x";
}
updateReplaySpeed(0.5);
document.addEventListener('keydown', (e) => {
    if (e.keyCode == P) {
        controls.paused = !controls.paused;
    } else if (e.keyCode == ONE) {
        updateReplaySpeed(Math.max(controls.replaySpeed / 1.5, controls.replaySpeedMin));
    } else if (e.keyCode == TWO) {
        updateReplaySpeed(Math.min(controls.replaySpeed * 1.5, controls.replaySpeedMax));
    }
});
document.addEventListener('keyup', (e) => keyDown.delete(e.keyCode));
nodeCanvas.addEventListener('dblclick', () => { controls.paused = !controls.paused; });
pauseButton.addEventListener('click', () => { controls.paused = !controls.paused; });

// ---------------- Canvas Initialization ----------------
function initCanvas() {
    const resize = () => {
        if (app && viewport) {
            app.renderer.resize(nodeCanvas.offsetWidth, nodeCanvas.offsetHeight);
            viewport.resize(nodeCanvas.offsetWidth, nodeCanvas.offsetHeight);
        }
    };
    window.addEventListener('resize', resize);
    app = new Application({
        width: nodeCanvas.offsetWidth * 1.5,
        height: nodeCanvas.offsetHeight * 1.5,
        transparent: false,
        backgroundColor: BACKGROUND_COLOR,
        antialias: true,
        forceCanvas: false
    });
    console.log("PixiJS Renderer type:", app.renderer.type === PIXI.RENDERER_TYPE.WEBGL ? "WebGL" : "Canvas");
    const trafficLightGraphic = new PIXI.Graphics();
    trafficLightGraphic.beginFill(0xFFFFFF);
    trafficLightGraphic.drawRect(0, 0, 2, 2);
    trafficLightGraphic.endFill();
    TRAFFIC_LIGHT_TEXTURE = app.renderer.generateTexture(trafficLightGraphic);
    trafficLightGraphic.destroy();
    const carGraphic = new PIXI.Graphics();
    carGraphic.beginFill(0xFFFFFF, 0.8);
    carGraphic.drawRect(0, 0, CAR_LENGTH, CAR_WIDTH);
    carGraphic.endFill();
    CAR_TEXTURE = app.renderer.generateTexture(carGraphic);
    carGraphic.destroy();
    const turnSignalGraphic = new PIXI.Graphics();
    turnSignalTextures = [
        createTurnSignalTexture(turnSignalGraphic, 0),
        createTurnSignalTexture(turnSignalGraphic, CAR_WIDTH),
        createTurnSignalTexture(turnSignalGraphic, CAR_WIDTH * 2)
    ];
    renderer = app.renderer;
    app.view.style.position = 'absolute';
    nodeCanvas.appendChild(app.view);
    resize();
    simulatorContainer = null;
    carContainer = null;
    turnSignalContainer = null;
    trafficLightContainer = null;
    carPool = [];
    app.view.classList.add("d-none");
    renderer.interactive = true;
    renderer.autoResize = true;
    renderer.resize(nodeCanvas.offsetWidth, nodeCanvas.offsetHeight);
    app.ticker.add(() => { if (!controls.paused) run(); });
}

// ---------------- Show/Hide Canvas ----------------
function showCanvas() {
    const spinner = document.getElementById("spinner");
    if (spinner) spinner.classList.add("d-none");
    if (app && app.view) app.view.classList.remove("d-none");
}
function hideCanvas() {
    const spinner = document.getElementById("spinner");
    if (spinner) spinner.classList.remove("d-none");
    if (app && app.view) app.view.classList.add("d-none");
}
