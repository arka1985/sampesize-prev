// Elements
const prevalenceSlider = document.getElementById('prevalence');
const precisionSlider = document.getElementById('precision');
const pValDisplay = document.getElementById('p-val');
const dValDisplay = document.getElementById('d-val');
const nValueDisplay = document.getElementById('n-value');
const bgCanvas = document.getElementById('bg-canvas');
const sampleCanvas = document.getElementById('sample-canvas');

// State
let p = 50; // percentage
let d = 5;  // percentage
let n = 400;

// Visualization State
let bgCtx = null;
let sampleCtx = null;
let bgParticles = [];
let sampleParticles = [];
let width = window.innerWidth;
let height = window.innerHeight;

// Constants
const FORMULA_CONSTANT = 4;

function init() {
    if (bgCanvas) {
        bgCtx = bgCanvas.getContext('2d');
        resizeCanvas(bgCanvas);
    }
    if (sampleCanvas) {
        sampleCtx = sampleCanvas.getContext('2d');
        // Sample canvas is inside a container, size it to container
        const rect = sampleCanvas.parentElement?.getBoundingClientRect();
        if (rect) {
            sampleCanvas.width = rect.width;
            sampleCanvas.height = rect.height;
        }
    }

    // Initial Calculation
    updateCalculation();

    // Listeners
    prevalenceSlider.addEventListener('input', (e) => {
        p = parseInt(e.target.value);
        pValDisplay.textContent = `${p}%`;
        updateCalculation();
    });

    precisionSlider.addEventListener('input', (e) => {
        d = parseInt(e.target.value);
        dValDisplay.textContent = `${d}%`;
        updateCalculation();
    });

    window.addEventListener('resize', () => {
        width = window.innerWidth;
        height = window.innerHeight;
        if (bgCanvas) resizeCanvas(bgCanvas);
        if (sampleCanvas && sampleCanvas.parentElement) {
            const rect = sampleCanvas.parentElement.getBoundingClientRect();
            sampleCanvas.width = rect.width;
            sampleCanvas.height = rect.height;
        }
        initBgParticles();
    });

    initBgParticles();
    loop();
}

function resizeCanvas(canvas) {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}

function updateCalculation() {
    // Formula: N = 4PQ / D^2
    const P = p / 100;
    const Q = 1 - P;
    const D = d / 100;

    const numerator = FORMULA_CONSTANT * P * Q;
    const denominator = D * D;

    n = Math.ceil(numerator / denominator);

    // Update Display
    nValueDisplay.textContent = n.toLocaleString();
}

// Particle System (Background only)
class Particle {
    constructor(w, h) {
        this.x = Math.random() * w;
        this.y = Math.random() * h;
        this.vx = (Math.random() - 0.5) * 0.5;
        this.vy = (Math.random() - 0.5) * 0.5;
        this.size = Math.random() * 3;
        this.color = `rgba(0, 123, 255, ${Math.random() * 0.2 + 0.1})`;
    }

    update(w, h) {
        this.x += this.vx;
        this.y += this.vy;
        if (this.x < 0) this.x = w;
        if (this.x > w) this.x = 0;
        if (this.y < 0) this.y = h;
        if (this.y > h) this.y = 0;
    }

    draw(ctx) {
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fillStyle = this.color;
        ctx.fill();
    }
}

function initBgParticles() {
    bgParticles = [];
    const count = Math.floor((width * height) / 10000);
    for (let i = 0; i < count; i++) {
        bgParticles.push(new Particle(width, height));
    }
}

let time = 0;

function loop() {
    // Background: Clear completely each frame
    if (bgCtx && bgCanvas) {
        bgCtx.clearRect(0, 0, bgCanvas.width, bgCanvas.height);
        bgParticles.forEach(p => {
            p.update(bgCanvas.width, bgCanvas.height);
            p.draw(bgCtx);
        });
    }

    // Sample Visuals: Sample Size (N) vs Prevalence (P) Curve
    if (sampleCtx && sampleCanvas) {
        sampleCtx.clearRect(0, 0, sampleCanvas.width, sampleCanvas.height);

        const w = sampleCanvas.width;
        const h = sampleCanvas.height;
        const padding = 20;
        const graphW = w - padding * 2;
        const graphH = h - padding * 2;

        // We plot N on Y axis, P on X axis.
        // P goes 0 to 1.
        // Equation: N(x) = 4 * x * (1-x) / D^2

        const currentD = d / 100;

        // Define Y-axis scale (Max N)
        // If we fix visual Scale based on D=5% (N=400) being 'normal height', say 50% of canvas.
        // Then Max visual N = 800.
        // But N can go to 10000.
        // Visuals should clamp or compress?
        // User wants "Incremental/Decremental".
        // Let's use a dynamic scale that shifts but allows growth.
        // Let's fix the top of the canvas to N = 1000 (just above standard 400).
        // If N > 1000, it goes off chart (or we scale down?)
        // Let's simply scale such that N=500 is roughly 60% height.
        // Scaling factor: pixels per unit N.
        const pixelsPerN = graphH / 600;

        // Draw the theoretical curve for Current D
        sampleCtx.beginPath();
        sampleCtx.lineWidth = 4;
        sampleCtx.strokeStyle = 'rgba(0, 123, 255, 0.3)'; // Primary blue, dim

        // Iterate P from 0 to 1
        for (let ix = 0; ix <= graphW; ix += 5) {
            const xVal = ix / graphW; // This is P (0..1)

            // Calculate N for this P
            const nVal = (4 * xVal * (1 - xVal)) / (currentD * currentD);

            // Map N to Y pixels (inverted, 0 at bottom)
            // Y = h - padding - (n * scale)
            const yVal = h - padding - (nVal * pixelsPerN);

            if (ix === 0) sampleCtx.moveTo(padding + ix, yVal);
            else sampleCtx.lineTo(padding + ix, yVal);
        }
        sampleCtx.stroke();

        // Highlight Current Position
        const currentP = p / 100;
        const currentN = n; // Already calculated correctly via formula
        const cx = padding + currentP * graphW;
        const cy = h - padding - (currentN * pixelsPerN);

        // Visual feedback based on growth direction?
        // Glow effect
        const gradient = sampleCtx.createRadialGradient(cx, cy, 5, cx, cy, 30);
        gradient.addColorStop(0, 'rgba(232, 62, 140, 1)');
        gradient.addColorStop(0.5, 'rgba(232, 62, 140, 0.4)');
        gradient.addColorStop(1, 'rgba(232, 62, 140, 0)');

        sampleCtx.fillStyle = gradient;
        sampleCtx.beginPath();
        sampleCtx.arc(cx, cy, 30, 0, Math.PI * 2);
        sampleCtx.fill();

        // Solid Dot
        sampleCtx.fillStyle = '#fff';
        sampleCtx.beginPath();
        sampleCtx.arc(cx, cy, 6, 0, Math.PI * 2);
        sampleCtx.fill();
        sampleCtx.strokeStyle = '#e83e8c';
        sampleCtx.lineWidth = 2;
        sampleCtx.stroke();

        // Fill Area under curve for "Incremental" feel?
        sampleCtx.beginPath();
        // Top edge
        for (let ix = 0; ix <= graphW; ix += 5) {
            const xVal = ix / graphW;
            const nVal = (4 * xVal * (1 - xVal)) / (currentD * currentD);
            const yVal = h - padding - (nVal * pixelsPerN);
            if (ix === 0) sampleCtx.moveTo(padding + ix, yVal);
            else sampleCtx.lineTo(padding + ix, yVal);
        }
        // Close bottom
        sampleCtx.lineTo(w - padding, h - padding);
        sampleCtx.lineTo(padding, h - padding);
        sampleCtx.closePath();
        sampleCtx.fillStyle = 'rgba(0, 123, 255, 0.05)';
        sampleCtx.fill();

        // Draw Axes lines?
        /*
        sampleCtx.beginPath();
        sampleCtx.moveTo(padding, h - padding);
        sampleCtx.lineTo(w - padding, h - padding); // X Axis
        sampleCtx.strokeStyle = '#999';
        sampleCtx.lineWidth = 1;
        sampleCtx.stroke();
        */

        time += 0.01;
    }

    requestAnimationFrame(loop);
}

// Start
init();
