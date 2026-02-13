// Elements
const studySelector = document.getElementById('study-type');
const controlsContainer = document.getElementById('controls-container');
const nValueDisplay = document.getElementById('n-value');
const formulaDisplay = document.getElementById('formula-display');
const dynamicParamsDisplay = document.getElementById('dynamic-params');
const formulaStepsContent = document.getElementById('formula-steps-content');
const interpretationContent = document.getElementById('interpretation-content');
const bgCanvas = document.getElementById('bg-canvas');
const sampleCanvas = document.getElementById('sample-canvas');

// State
let currentMode = 'prevalence';
let inputsState = {};

// Z-score constants
const Z_ALPHA = 1.96; // Default
const Z_MAP = {
    80: 0.842, 81: 0.878, 82: 0.915, 83: 0.954, 84: 0.994,
    85: 1.036, 86: 1.080, 87: 1.126, 88: 1.175, 89: 1.227,
    90: 1.282, 91: 1.341, 92: 1.405, 93: 1.476, 94: 1.555,
    95: 1.645, 96: 1.751, 97: 1.881, 98: 2.054, 99: 2.326
};

const Z_ALPHA_MAP = {
    90: 1.645,
    95: 1.96,
    98: 2.326,
    99: 2.576
};

function getZBeta(p) {
    // Return exact match or default to 80% if out of range (though UI constrains it)
    return Z_MAP[p] || 0.842;
}

function getZAlpha(c) {
    // Exact match
    if (Z_ALPHA_MAP[c]) return Z_ALPHA_MAP[c];
    // Range approx
    if (c < 95) return 1.645; // 90%
    if (c < 98) return 1.96;  // 95%
    if (c < 99) return 2.326; // 98%
    return 2.576;             // 99%
}

// Mode Configurations
const MODES = {
    'prevalence': {
        inputs: [
            { id: 'prevalence', label: 'Prevalence (P) %', type: 'range', min: 1, max: 99, val: 50, desc: 'Expected proportion of the disease/condition.' },
            { id: 'precision', label: 'Precision (D) %', type: 'range', min: 1, max: 20, val: 5, desc: 'Acceptable error margin (absolute precision).' },
            { id: 'fpc', label: "Cochran's Formula with Finite Population Correction (FPC)?", type: 'checkbox', val: false, desc: 'Use when the total population is small or known.' },
            { id: 'dropout', label: 'Add 10% for Non-response?', type: 'checkbox', val: false, desc: 'Increases sample size to account for 10% dropout (N / 0.9).' },
            { id: 'popSize', label: 'Population Size (N)', type: 'number', val: 1000, desc: 'Total population size.', hidden: true }
        ],
        formulaStr: 'N = 4PQ / D²',
        formulaSteps: `
            <p>1. <strong>N</strong> = Sample Size</p>
            <p>2. <strong>P</strong> = Prevalence (as decimal)</p>
            <p>3. <strong>Q</strong> = 1 - P</p>
            <p>4. <strong>D</strong> = Precision (as decimal)</p>
            <p>5. <strong>4</strong> = Constant for 95% Confidence (approx 1.96² ≈ 4)</p>
        `,
        interpretation: `
            <p>This formula determines the minimum number of participants needed to estimate a population prevalence with a specified level of precision and confidence (usually 95%).</p>
        `,
        calc: (state) => {
            const P = state.prevalence / 100;
            const Q = 1 - P;
            const D = state.precision / 100;
            let n = (4 * P * Q) / (D * D);

            if (state.fpc && state.popSize > 0) {
                const pop = parseInt(state.popSize);
                n = n / (1 + (n / pop));
            }

            // Dropout Correction
            if (state.dropout) {
                n = n / 0.9;
            }

            let displayStr = `P=${P.toFixed(2)} Q=${Q.toFixed(2)} D=${D.toFixed(2)}`;
            if (state.dropout) displayStr += " (Incl. 10% Dropout)";

            return {
                n: Math.ceil(n),
                display: displayStr,
                visualData: null // prevalence uses its own specific renderer
            };
        }
    },
    'case-control': {
        inputs: [
            { id: 'p_controls', label: '% Exposed in Controls', type: 'range', min: 1, max: 99, val: 30, desc: 'Proportion of controls exposed to the risk factor.' },
            { id: 'or', label: 'Odds Ratio (OR)', type: 'number', val: 2.0, desc: 'Minimum odds ratio you want to detect.' },
            { id: 'power', label: 'Power (%)', type: 'range', min: 80, max: 99, val: 80, desc: 'Probability of detecting a true effect (usually 80%).' },
            { id: 'confidence', label: 'Confidence Level (%)', type: 'range', min: 90, max: 99, val: 95, desc: '1 - Alpha (usually 95%).' },
            { id: 'ratio', label: 'Control to Case Ratio', type: 'number', val: 1, desc: 'Number of controls per case (usually 1).' },
            { id: 'dropout', label: 'Add 10% for Non-response?', type: 'checkbox', val: false, desc: 'Increases sample size to account for 10% dropout.' }
        ],
        formulaStr: 'N = (Zα/2 + Zβ)² P(1-P)(r+1) / r(P₁-P₂)²',
        formulaSteps: `
            <p>1. <strong>P<sub>0</sub></strong> = Proportion exposed in controls</p>
            <p>2. <strong>P<sub>1</sub></strong> = Proportion exposed in cases (calculated from OR)</p>
            <p>3. <strong>Z<sub>&alpha;/2</sub></strong> = 1.96 (std. normal for &alpha;=5%)</p>
            <p>4. <strong>Z<sub>&beta;</sub></strong> = 0.84 (std. normal for &beta;=20%)</p>
            <p>5. Calculates <strong>N<sub>cases</sub></strong> and applies ratio.</p>
        `,
        interpretation: `
            <p>Calculates the number of Cases and Controls required to detect a specific Odds Ratio with a given Power. Essential for retrospective studies where you recruit based on outcome status.</p>
            <p><em>Method: Kelsey / Fleiss with unpooled variance estimate.</em></p>
        `,
        calc: (state) => {
            const P0 = state.p_controls / 100;
            const OR = parseFloat(state.or);
            const r = parseFloat(state.ratio) || 1;
            const power = parseInt(state.power);
            const conf = parseInt(state.confidence) || 95;
            const Z_beta = getZBeta(power);
            const Z_alpha_curr = getZAlpha(conf);

            // Floating point safety for OR=1
            if (Math.abs(OR - 1) < 0.001) {
                return { n: 0, display: 'OR=1 implies no effect. N is infinite.', visualData: null };
            }

            // Calc P1 (Percent Exposed in Cases) based on OR
            let P1 = (OR * P0) / (1 + P0 * (OR - 1));

            // Safety Cap for P1
            if (P1 > 0.999) {
                return { n: 'Error', display: 'Impossible inputs: P1 > 100%. Lower Baseline or OR.', visualData: null };
            }

            const P_avg = (P1 + r * P0) / (1 + r);

            const num = Math.pow(Z_alpha_curr * Math.sqrt((1 + 1 / r) * P_avg * (1 - P_avg)) + Z_beta * Math.sqrt(P1 * (1 - P1) + (P0 * (1 - P0) / r)), 2);
            const den = Math.pow(P1 - P0, 2);

            let n_cases = Math.ceil(num / den);
            // Dropout
            if (state.dropout) n_cases = Math.ceil(n_cases / 0.9);

            const n_controls = Math.ceil(n_cases * r);
            const n_total = n_cases + n_controls;

            let displayStr = `P_controls=${P0.toFixed(2)} OR=${OR} Power=${power}% Conf=${conf}% Z_{\u03B1/2}=${Z_alpha_curr} Z_{\u03B2}=${Z_beta}`;
            if (state.dropout) displayStr += " (Incl. 10% Dropout)";

            return {
                n: n_total,
                display: displayStr,
                visualData: {
                    n1: n_controls,
                    n2: n_cases,
                    label1: 'Controls',
                    label2: 'Cases'
                }
            };
        }
    },
    'cohort': {
        inputs: [
            { id: 'p_unexposed', label: '% Incidence in Unexposed', type: 'range', min: 1, max: 99, val: 10, desc: 'Baseline risk/incidence in the unexposed group.' },
            { id: 'rr', label: 'Risk Ratio (RR)', type: 'number', val: 2.0, desc: 'Relative risk you want to detect.' },
            { id: 'power', label: 'Power (%)', type: 'range', min: 80, max: 99, val: 80, desc: 'Probability of detecting a true effect.' },
            { id: 'confidence', label: 'Confidence Level (%)', type: 'range', min: 90, max: 99, val: 95, desc: '1 - Alpha (usually 95%).' },
            { id: 'ratio', label: 'Unexposed to Exposed Ratio', type: 'number', val: 1, desc: 'Number of unexposed per exposed (usually 1).' },
            { id: 'dropout', label: 'Add 10% for Non-response?', type: 'checkbox', val: false, desc: 'Increases sample size to account for 10% dropout.' }
        ],
        formulaStr: 'N = (Zα/2 + Zβ)² [P₁(1-P₁) + P₂(1-P₂)] / (P₁-P₂)²',
        formulaSteps: `
            <p>1. <strong>P<sub>0</sub></strong> = Incidence in Unexposed</p>
            <p>2. <strong>P<sub>1</sub></strong> = Incidence in Exposed (P<sub>0</sub> * RR)</p>
            <p>3. <strong>Z<sub>&alpha;/2</sub></strong> = 1.96 (std. normal for &alpha;=5%)</p>
            <p>4. <strong>Z<sub>&beta;</sub></strong> = 0.84 (std. normal for &beta;=20%)</p>
            <p>5. Calculates sample size to detect difference (P<sub>1</sub> - P<sub>0</sub>)</p>
        `,
        interpretation: `
            <p>Determines the number of exposed and unexposed subjects needed to detect a specific Risk Ratio (Relative Risk) over the study period.</p>
            <p><em>Method: Two-sample proportion test (unpooled variance).</em></p>
        `,
        calc: (state) => {
            const P0 = state.p_unexposed / 100;
            const RR = parseFloat(state.rr);
            const r = parseFloat(state.ratio) || 1;
            const power = parseInt(state.power);
            const conf = parseInt(state.confidence) || 95;
            const Z_beta = getZBeta(power);
            const Z_alpha_curr = getZAlpha(conf);

            // Floating point safety for RR=1
            if (Math.abs(RR - 1) < 0.001) {
                return { n: 0, display: 'RR=1 implies no effect. N is infinite.', visualData: null };
            }

            const P1 = P0 * RR;
            if (P1 >= 1) return { n: 'Error', display: 'P1 > 100%. Decrease Baseline or Risk Ratio.', visualData: null };

            const P_avg = (P1 + r * P0) / (1 + r);
            const num = Math.pow(Z_alpha_curr * Math.sqrt((1 + 1 / r) * P_avg * (1 - P_avg)) + Z_beta * Math.sqrt(P1 * (1 - P1) + (P0 * (1 - P0) / r)), 2);
            const den = Math.pow(P1 - P0, 2);

            let n_exposed = Math.ceil(num / den);
            // Dropout
            if (state.dropout) n_exposed = Math.ceil(n_exposed / 0.9);

            const n_unexposed = Math.ceil(n_exposed * r);
            const n_total = n_exposed + n_unexposed;

            let displayStr = `P0=${P0.toFixed(2)} RR=${RR} Power=${power}% Conf=${conf}% Z_{\u03B1/2}=${Z_alpha_curr} Z_{\u03B2}=${Z_beta}`;
            if (state.dropout) displayStr += " (Incl. 10% Dropout)";

            return {
                n: n_total,
                display: displayStr,
                visualData: {
                    n1: n_unexposed,
                    n2: n_exposed,
                    label1: 'Unexposed',
                    label2: 'Exposed'
                }
            };
        }
    },
    'rct': {
        inputs: [
            { id: 'p1', label: 'Prop. Group 1 (%)', type: 'range', min: 1, max: 99, val: 50, desc: 'Anticipated outcome in Control Group.' },
            { id: 'p2', label: 'Prop. Group 2 (%)', type: 'range', min: 1, max: 99, val: 40, desc: 'Anticipated outcome in Treatment Group.' },
            { id: 'power', label: 'Power (%)', type: 'range', min: 80, max: 99, val: 80, desc: '' },
            { id: 'confidence', label: 'Confidence Level (%)', type: 'range', min: 90, max: 99, val: 95, desc: '' },
            { id: 'ratio', label: 'Group Ratio (N1/N2)', type: 'number', val: 1, desc: '' },
            { id: 'dropout', label: 'Add 10% for Non-response?', type: 'checkbox', val: false, desc: '' }
        ],
        formulaStr: 'N = (Zα/2 + Zβ)² [P₁(1-P₁) + P₂(1-P₂)] / (P₁-P₂)²',
        formulaSteps: `
            <p>1. <strong>P<sub>1</sub></strong>, <strong>P<sub>2</sub></strong> = Proportions in the two groups</p>
            <p>2. Uses the pooled proportion to estimate variance under the null hypothesis</p>
            <p>3. <strong>Z<sub>&alpha;/2</sub></strong> = 1.96 (std. normal for &alpha;=5%)</p>
            <p>4. <strong>Z<sub>&beta;</sub></strong> = 0.84 (std. normal for &beta;=20%)</p>
            <p>5. Calculates sample size to detect difference (P<sub>1</sub> - P<sub>2</sub>)</p>
        `,
        interpretation: `
            <p>Standard calculation for Randomized Controlled Trials comparing binary outcomes (e.g., Cured vs. Not Cured) between two groups.</p>
        `,
        calc: (state) => {
            const P1 = state.p1 / 100;
            const P2 = state.p2 / 100;
            const r = parseFloat(state.ratio) || 1;
            const power = parseInt(state.power);
            const conf = parseInt(state.confidence) || 95;
            const Z_beta = getZBeta(power);
            const Z_alpha_curr = getZAlpha(conf);

            const P_avg = (P1 + r * P2) / (1 + r);
            const num = Math.pow(Z_alpha_curr * Math.sqrt((1 + 1 / r) * P_avg * (1 - P_avg)) + Z_beta * Math.sqrt(P1 * (1 - P1) + (P2 * (1 - P2) / r)), 2);
            const den = Math.pow(P1 - P2, 2);

            if (den === 0) return { n: 'Undefined', display: 'P1 must differ from P2', visualData: null };

            let n_group2 = Math.ceil(num / den);
            // Dropout
            if (state.dropout) n_group2 = Math.ceil(n_group2 / 0.9);

            const n_group1 = Math.ceil(n_group2 * r);
            const n_total = n_group1 + n_group2;

            let displayStr = `P1=${P1.toFixed(2)} P2=${P2.toFixed(2)} Power=${power}% Conf=${conf}% Z_{\u03B1/2}=${Z_alpha_curr} Z_{\u03B2}=${Z_beta}`;
            if (state.dropout) displayStr += " (Incl. 10% Dropout)";

            return {
                n: n_total,
                display: displayStr,
                visualData: {
                    n1: n_group1,
                    n2: n_group2,
                    label1: 'Group 1',
                    label2: 'Group 2'
                }
            };
        }
    }
};

// Visualization State
let bgCtx = null;
let sampleCtx = null;
let bgParticles = [];
let width = window.innerWidth;
let height = window.innerHeight;
let currentVisualData = null;

function init() {
    // Canvas Setup
    if (bgCanvas) {
        bgCtx = bgCanvas.getContext('2d');
        resizeCanvas(bgCanvas);
    }
    if (sampleCanvas) {
        sampleCtx = sampleCanvas.getContext('2d');
        const rect = sampleCanvas.parentElement?.getBoundingClientRect();
        if (rect) {
            sampleCanvas.width = rect.width;
            sampleCanvas.height = rect.height;
        }
        // Resize Observer for Sample Canvas
        const observer = new ResizeObserver(() => {
            // Debounce/Defer to avoid Loop Limit Exceeded
            requestAnimationFrame(() => {
                resizeSampleCanvas();
                loop();
            });
        });
        observer.observe(sampleCanvas);
    }

    // Initialize logic
    const initialMode = studySelector.value || 'prevalence';
    setupMode(initialMode);

    // UI Listeners
    studySelector.addEventListener('change', (e) => {
        setupMode(e.target.value);
    });

    window.addEventListener('resize', () => {
        width = window.innerWidth;
        height = window.innerHeight;
        if (bgCanvas) resizeCanvas(bgCanvas);
        // sampleCanvas handled by Observer mostly, but good to ensure
        initBgParticles();
    });

    initBgParticles();
    loop();
}

function resizeCanvas(canvas) {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}

function resizeSampleCanvas() {
    if (sampleCanvas) {
        // Use the CANVAS client rect, not parent
        const rect = sampleCanvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;

        const newWidth = Math.floor(rect.width * dpr);
        const newHeight = Math.floor(rect.height * dpr);

        if (sampleCanvas.width !== newWidth || sampleCanvas.height !== newHeight) {
            sampleCanvas.width = newWidth;
            sampleCanvas.height = newHeight;

            // Logical size for drawing
            sampleCanvas.logicalWidth = rect.width;
            sampleCanvas.logicalHeight = rect.height;

            // Scale context
            if (sampleCtx) {
                sampleCtx.setTransform(1, 0, 0, 1, 0, 0); // Reset
                sampleCtx.scale(dpr, dpr);
            }
        }
    }
}

function setupMode(mode) {
    try {
        currentMode = mode;
        const config = MODES[mode];

        // Update Info Tiles
        formulaStepsContent.innerHTML = config.formulaSteps;
        interpretationContent.innerHTML = config.interpretation;
        formulaDisplay.innerText = config.formulaStr;

        // Clear Container
        controlsContainer.innerHTML = '';
        inputsState = {}; // Reset State

        // Generate Inputs
        config.inputs.forEach(input => {
            inputsState[input.id] = input.val;

            const group = document.createElement('div');
            group.className = 'control-group';
            if (input.hidden) group.style.display = 'none';
            group.id = `group-${input.id}`;

            if (input.type === 'checkbox') {
                const wrapper = document.createElement('div');
                wrapper.className = 'checkbox-wrapper';

                const label = document.createElement('label');
                label.className = 'selector-label';
                label.innerText = input.label;

                const toggleHtml = `
                    <input class="tgl tgl-ios" id="${input.id}" type="checkbox">
                    <label class="tgl-btn" for="${input.id}"></label>
                 `;

                wrapper.insertAdjacentHTML('beforeend', toggleHtml);
                wrapper.appendChild(label);
                group.appendChild(wrapper);

                if (input.desc) {
                    const p = document.createElement('p');
                    p.className = 'description-text';
                    p.innerText = input.desc;
                    group.appendChild(p);
                }

                const el = group.querySelector(`#${input.id}`);
                el.checked = input.val;
                el.addEventListener('change', (e) => {
                    inputsState[input.id] = e.target.checked;
                    // Handle dependencies like FPC
                    if (input.id === 'fpc') {
                        const popGroup = document.getElementById('group-popSize');
                        const isFinite = e.target.checked;
                        if (popGroup) popGroup.style.display = isFinite ? 'flex' : 'none';

                        // Dynamic Formula Update
                        const formulaEl = document.getElementById('formula-display');
                        const stepsEl = document.getElementById('formula-steps-content');

                        if (currentMode === 'prevalence') {
                            if (isFinite) {
                                formulaEl.innerText = 'N_adjusted = (4PQ/D²) / [1 + (4PQ/D²)/Population]';
                                stepsEl.innerHTML = `
                                    <p>1. Calculate Infinite Sample Size: <strong>n = 4PQ / D²</strong></p>
                                    <p>2. Apply Finite Population Correction:</p>
                                    <p style="text-align:center;"><strong>N_adj = n / (1 + n/N)</strong></p>
                                    <p>3. Where <strong>N</strong> is the Total Population Size.</p>
                                 `;
                            } else {
                                // Revert to default
                                formulaEl.innerText = MODES['prevalence'].formulaStr;
                                stepsEl.innerHTML = MODES['prevalence'].formulaSteps;
                            }
                        }
                    }
                    calculate();
                });

            } else {
                const labelRow = document.createElement('label');
                labelRow.htmlFor = input.id;
                labelRow.innerHTML = `${input.label} <span id="val-${input.id}">${input.val}</span>`;
                group.appendChild(labelRow);

                if (input.desc) {
                    const p = document.createElement('p');
                    p.className = 'description-text';
                    p.innerText = input.desc;
                    group.appendChild(p);
                }

                const el = document.createElement('input');
                el.type = input.type;
                el.id = input.id;
                el.value = input.val;
                if (input.min) el.min = input.min;
                if (input.max) el.max = input.max;
                if (input.type === 'range') el.className = 'slider';

                el.addEventListener('input', (e) => {
                    let val = e.target.value;
                    inputsState[input.id] = parseFloat(val);
                    const badge = document.getElementById(`val-${input.id}`);
                    if (badge) badge.innerText = input.label.includes('%') ? val + '%' : val;
                    calculate();
                });
                group.appendChild(el);
            }
            controlsContainer.appendChild(group);
        });

        // Force initial calc
        calculate();

    } catch (e) {
        console.error("Setup Mode Error:", e);
    }
}

function calculate() {
    try {
        const mode = MODES[currentMode];
        if (!mode) return;

        const result = mode.calc(inputsState);

        if (typeof result.n === 'string') {
            nValueDisplay.textContent = result.n;
            nValueDisplay.style.fontSize = '3rem';
        } else {
            nValueDisplay.textContent = result.n.toLocaleString();
            nValueDisplay.style.fontSize = '5rem';
        }

        dynamicParamsDisplay.textContent = result.display;
        currentVisualData = result.visualData;
    } catch (e) {
        console.error("Calc Error:", e);
    }
}

// Particle System
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

function loop() {
    if (bgCtx && bgCanvas) {
        bgCtx.clearRect(0, 0, bgCanvas.width, bgCanvas.height);
        bgParticles.forEach(p => {
            p.update(bgCanvas.width, bgCanvas.height);
            p.draw(bgCtx);
        });
    }

    if (sampleCtx && sampleCanvas) {
        sampleCtx.clearRect(0, 0, sampleCanvas.width, sampleCanvas.height);

        // Visualization Logic
        // Visualization Logic
        const w = sampleCanvas.logicalWidth || sampleCanvas.width;
        const h = sampleCanvas.logicalHeight || sampleCanvas.height;

        if (currentMode === 'prevalence') {
            drawPrevalenceCurve(sampleCtx, w, h);
        } else if (currentVisualData) {
            // Draw SCALED Population Grids
            drawPopulationGrid(sampleCtx, w, h, currentVisualData);
        }
    }
    requestAnimationFrame(loop);
}

// --- Visualizations ---

// 1. Prevalence Curve (Gaussian-ish / Sample vs Precision)
function drawPrevalenceCurve(ctx, w, h) {
    const padding = 20;
    const graphW = w - padding * 2;
    const graphH = h - padding * 2;

    const P_val = inputsState['prevalence'] || 50;
    const D_val = inputsState['precision'] || 5;

    const currentD = D_val / 100;

    // Calculate Max Possible N (at P=50%) for this Precision
    // N = 4 * 0.5 * 0.5 / D^2 = 1 / D^2
    let maxN = 1 / (currentD * currentD);
    if (inputsState.fpc && inputsState.popSize) {
        // Apply FPC to maxN
        maxN = maxN / (1 + (maxN / inputsState.popSize));
    }

    // Scale factor to make Peak N fit in ~85% of Height
    const pixelsPerN = (graphH * 0.85) / maxN;

    ctx.beginPath();
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(0, 123, 255, 0.5)';

    // Formula: N = 4 * x * (1-x) / D^2
    // We plot N (y-axis) vs P (x-axis)
    let moved = false;
    for (let ix = 0; ix <= graphW; ix += 5) {
        const xVal = ix / graphW; // P (0..1)
        if (xVal <= 0.01 || xVal >= 0.99) continue; // Avoid Infinity

        let nVal = (4 * xVal * (1 - xVal)) / (currentD * currentD);

        if (inputsState.fpc && inputsState.popSize) {
            nVal = nVal / (1 + (nVal / inputsState.popSize));
        }

        const yVal = h - padding - (nVal * pixelsPerN);
        const clampedY = Math.max(padding, Math.min(h - padding, yVal));

        if (!moved) {
            ctx.moveTo(padding + ix, clampedY);
            moved = true;
        } else {
            ctx.lineTo(padding + ix, clampedY);
        }
    }
    ctx.stroke();

    // Draw Point for Current Selection
    const currentP = P_val / 100;
    let currentN = (4 * currentP * (1 - currentP)) / (currentD * currentD);
    if (inputsState.fpc && inputsState.popSize) {
        currentN = currentN / (1 + (currentN / inputsState.popSize));
    }

    // Exact position map
    const cx = padding + currentP * graphW;
    const cy = Math.max(padding, Math.min(h - padding, h - padding - (currentN * pixelsPerN)));

    // Glow Effect
    const gradient = ctx.createRadialGradient(cx, cy, 5, cx, cy, 30);
    gradient.addColorStop(0, 'rgba(232, 62, 140, 1)');
    gradient.addColorStop(1, 'rgba(232, 62, 140, 0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(cx, cy, 30, 0, Math.PI * 2);
    ctx.fill();

    // Solid Dot
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(cx, cy, 6, 0, Math.PI * 2);
    ctx.fill();

    // Clear Legend for Curve Mode
    const legendEl = document.getElementById('visual-legend');
    if (legendEl) legendEl.innerText = '';
}


// 2. Population Grid (Dot Matrix for comparisons)
function drawPopulationGrid(ctx, w, h, data) {
    const padding = 20;
    const contentW = w - padding * 2;

    const n1 = data.n1 || 0;
    const n2 = data.n2 || 0;

    // Group Layout
    const gap = 40;
    const groupW = (contentW - gap) / 2;
    // Increase bottom padding to prevent cutoff (was h - 60)
    const groupH = h - 80;

    // We want 1:1 representation as much as possible.
    // Instead of shrinking dots continuously, we use discrete sizes so growth is visible.
    const PRESET_SIZES = [20, 15, 12, 10, 8, 6, 5, 4, 3];
    const minCell = 3;

    function getCapacity(cellSize) {
        const cols = Math.floor(groupW / cellSize);
        const rows = Math.floor(groupH / cellSize);
        return cols * rows;
    }

    const maxN = Math.max(n1, n2);

    // 1. Find the best discrete size for 1:1
    let bestCellSize = 0;
    let scale = 1;

    for (let size of PRESET_SIZES) {
        if (maxN <= getCapacity(size)) {
            bestCellSize = size;
            break;
        }
    }

    // 2. If even the smallest size (3px) doesn't fit, we must scale.
    if (bestCellSize === 0) {
        bestCellSize = 3;
        const maxCap = getCapacity(3);
        scale = Math.ceil(maxN / maxCap);
    }

    const sN1 = Math.ceil(n1 / scale);
    const sN2 = Math.ceil(n2 / scale);

    // Recalculate columns for the chosen size
    const cols = Math.floor(groupW / bestCellSize);

    // Visual Props
    const dotRadius = Math.max(1, bestCellSize * 0.35); // Slightly smaller for spacing

    function drawGroup(xStart, totalDots, color, label, originalN) {
        // Label
        ctx.fillStyle = color;
        ctx.font = 'bold 20px sans-serif';
        ctx.textAlign = 'center';
        const centerX = xStart + groupW / 2;

        ctx.fillText(label, centerX, 30);
        ctx.font = '16px sans-serif';
        ctx.fillStyle = '#555';
        ctx.fillText(`N = ${originalN.toLocaleString()}`, centerX, 55);

        // Grid
        const startY = 70;

        // "Centering" the block of dots vertically or top-align? top-align is standard reading.
        // We just draw index-based.

        ctx.fillStyle = color;
        for (let i = 0; i < totalDots; i++) {
            const r = Math.floor(i / cols);
            const c = i % cols;

            const cx = xStart + c * bestCellSize + bestCellSize / 2;
            const cy = startY + r * bestCellSize + bestCellSize / 2;

            // Safety break 
            if (cy > h - 40) break;

            ctx.beginPath();
            ctx.arc(cx, cy, dotRadius, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    const x1 = w / 2 - gap / 2 - groupW;
    const x2 = w / 2 + gap / 2;

    drawGroup(x1, sN1, '#28a745', data.label1, n1); // Green for Control/Unexposed
    drawGroup(x2, sN2, '#e83e8c', data.label2, n2);

    // Legend -> HTML
    const legendEl = document.getElementById('visual-legend');
    if (legendEl) {
        let legendText = scale > 1 ? `* 1 Dot ≈ ${scale} Participants` : `* 1 Dot = 1 Participant (Actual Size)`;
        if (bestCellSize <= 4) legendText += " (High Density)";
        legendEl.innerText = legendText;
    }
}

// Start
init();
