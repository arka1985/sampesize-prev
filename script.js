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

// --- Advanced Sample Size Helpers ---
function calculateAdvanced(p1, p2, ratio, alpha, beta, dropout) {
    const r = parseFloat(ratio) || 1;
    const za = getZAlpha((1 - alpha) * 100);
    const zb = getZBeta((1 - beta) * 100);

    const p_avg = (p1 + r * p2) / (1 + r);
    const p1_q1 = p1 * (1 - p1);
    const p2_q2 = p2 * (1 - p2);
    const p_avg_q_avg = p_avg * (1 - p_avg);

    // KELSEY
    // N_exposed = ((Za + Zb)^2 * P_avg * (1-P_avg) * (r+1)) / (r * (P1-P2)^2)
    // Note: Some sources use slightly different variance terms, but this is the standard Kelsey approximation.
    // However, OpenEpi uses:
    // n1 = ( (Za+Zb)^2 * p_avg * (1-p_avg) * (r+1) ) / ( r * (p1-p2)^2 )
    const kelsey_num = Math.pow(za + zb, 2) * p_avg_q_avg * (r + 1);
    const kelsey_den = r * Math.pow(p1 - p2, 2);
    let n1_kelsey = Math.ceil(kelsey_num / kelsey_den);

    // FLEISS
    // OpenEpi / Fleiss with Levin's modification
    // n1 = ( Za * sqrt((r+1) * p_avg * (1-p_avg)) + Zb * sqrt(r * p1 * (1-p1) + p2 * (1-p2)) )^2 / (r * (p1-p2)^2)
    const term1 = za * Math.sqrt((r + 1) * p_avg_q_avg);
    const term2 = zb * Math.sqrt((r * p1_q1) + p2_q2);
    const fleiss_num = Math.pow(term1 + term2, 2);
    const fleiss_den = r * Math.pow(p1 - p2, 2);
    let n1_fleiss = Math.ceil(fleiss_num / fleiss_den);

    // FLEISS WITH CONTINUITY CORRECTION (CC)
    // Non-iterative approximation
    // n1_cc = (n1_fleiss / 4) * (1 + sqrt(1 + (2*(r+1)) / (n1_fleiss * r * |p1-p2|)))^2
    const n1_uncorrected = fleiss_num / fleiss_den; // Using unrounded for intermediate step
    const cc_term = 2 * (r + 1) / (n1_uncorrected * r * Math.abs(p1 - p2));
    const n1_cc = (n1_uncorrected / 4) * Math.pow(1 + Math.sqrt(1 + cc_term), 2);
    let n1_fleiss_cc = Math.ceil(n1_cc);

    // Apply Dropout
    if (dropout) {
        n1_kelsey = Math.ceil(n1_kelsey / 0.9);
        n1_fleiss = Math.ceil(n1_fleiss / 0.9);
        n1_fleiss_cc = Math.ceil(n1_fleiss_cc / 0.9);
    }

    return {
        kelsey: { n1: n1_kelsey, n2: Math.ceil(n1_kelsey * r), total: n1_kelsey + Math.ceil(n1_kelsey * r) },
        fleiss: { n1: n1_fleiss, n2: Math.ceil(n1_fleiss * r), total: n1_fleiss + Math.ceil(n1_fleiss * r) },
        fleiss_cc: { n1: n1_fleiss_cc, n2: Math.ceil(n1_fleiss_cc * r), total: n1_fleiss_cc + Math.ceil(n1_fleiss_cc * r) }
    };
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
        formulaStr: 'N = 4PQ / D<sup>2</sup>',
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
            { id: 'p_controls', label: '% Exposed in Controls', type: 'range', min: 0.1, max: 99.9, step: 0.1, val: 30, desc: 'Proportion of controls exposed to the risk factor.' },
            { id: 'or', label: 'Odds Ratio (OR)', type: 'number', val: 2.0, desc: 'Minimum odds ratio you want to detect.' },
            { id: 'power', label: 'Power (%)', type: 'range', min: 80, max: 99, val: 80, desc: 'Probability of detecting a true effect (usually 80%).' },
            { id: 'confidence', label: 'Confidence Level (%)', type: 'range', min: 90, max: 99, val: 95, desc: '1 - Alpha (usually 95%).' },
            { id: 'ratio', label: 'Control to Case Ratio (r)', type: 'number', val: 1, desc: 'Number of controls per case (usually 1).' },
            { id: 'dropout', label: 'Add 10% for Non-response?', type: 'checkbox', val: false, desc: 'Increases sample size to account for 10% dropout.' }
        ],
        formulaStr: `
            <div style="font-size:0.9em; line-height:1.4">
                <strong>Kelsey Formula (Main):</strong><br>
                N<sub>1</sub> = (Z<sub>α/2</sub>+Z<sub>β</sub>)<sup>2</sup> P(1-P)(r+1) / [r(P<sub>1</sub>-P<sub>2</sub>)<sup>2</sup>]<br>
                <div style="font-size:0.8em; margin-top:5px; opacity:0.8">
                    (See Interpretation regarding Fleiss & Fleiss CC methods)
                </div>
            </div>
        `,
        formulaSteps: `
            <p><strong>P<sub>1</sub></strong> = % Exposed in Cases (Calculated from OR)</p>
            <p><strong>P<sub>2</sub></strong> = % Exposed in Controls (User Input)</p>
            <p><strong>r</strong> = Ratio (Controls / Cases)</p>
            <p>Calculates Sample Size using:</p>
            <ul>
                <li><strong>Kelsey</strong>: Standard approximation</li>
                <li><strong>Fleiss</strong>: With Levin's modification</li>
                <li><strong>Fleiss CC</strong>: With Continuity Correction</li>
            </ul>
        `,
        interpretation: `
            <p>Comparative sample sizes for Case-Control studies. Essential for retrospective studies recruited based on outcome.</p>
            <div style="font-size:0.85em; margin-top:10px; border-top:1px solid rgba(255,255,255,0.2); padding-top:5px;">
                <strong>Formulas Used:</strong><br>
                <strong>Kelsey:</strong> N<sub>1</sub> = (Z<sub>α/2</sub>+Z<sub>β</sub>)<sup>2</sup> P(1-P)(r+1) / [r(P<sub>1</sub>-P<sub>2</sub>)<sup>2</sup>]<br>
                <strong>Fleiss:</strong> N<sub>1</sub> = [Z<sub>α/2</sub>&radic;((r+1)P(1-P)) + Z<sub>β</sub>&radic;(rP<sub>1</sub>(1-P<sub>1</sub>)+P<sub>2</sub>(1-P<sub>2</sub>))]<sup>2</sup> / [r(P<sub>1</sub>-P<sub>2</sub>)<sup>2</sup>]<br>
                *N<sub>Fleiss,CC</sub> applies continuity correction to N<sub>Fleiss</sub>
            </div>
        `,
        calc: (state) => {
            const P0 = parseFloat(state.p_controls) / 100;
            const OR = parseFloat(state.or);
            const r = parseFloat(state.ratio) || 1;
            const power = parseInt(state.power);
            const conf = parseInt(state.confidence) || 95;
            const alpha = (100 - conf) / 100;
            const beta = (100 - power) / 100;

            // Floating point safety for OR=1
            if (Math.abs(OR - 1) < 0.001) {
                return { n: 0, display: 'OR=1 implies no effect. N is infinite.', table: null };
            }

            // Calc P1 (Percent Exposed in Cases) based on OR
            let P1 = (OR * P0) / (1 + P0 * (OR - 1));

            // Safety Cap for P1
            if (P1 > 0.999) {
                return { n: 'Error', display: 'Impossible inputs: P1 > 100%. Lower Baseline or OR.', table: null };
            }

            // Case-Control Mapping for calculateAdvanced(p1, p2, r...)
            // Standard Formula typically:
            // n1 = number of CASES
            // n2 = number of CONTROLS = r * n1
            // p1 = Proportion exposed in CASES
            // p2 = Proportion exposed in CONTROLS
            //
            // calculateAdvanced(p1, p2, ratio...)
            // Returns { n1, n2 ... } where n2 = n1*ratio.
            // So if we pass p1=P_cases, p2=P_controls, ratio=Controls/Cases
            // Then n1 = Cases, n2 = Controls.

            const results = calculateAdvanced(P1, P0, r, alpha, beta, state.dropout);

            let displayStr = `P_cases=${(P1 * 100).toFixed(2)}% P_controls=${(P0 * 100).toFixed(2)}% OR=${OR}`;
            if (state.dropout) displayStr += " (Incl. 10% Dropout)";

            return {
                n: results.fleiss.total,
                display: displayStr,
                table: results,
                visualData: {
                    n1: results.fleiss.n2, // Controls (Group 2 in helper)
                    n2: results.fleiss.n1, // Cases (Group 1 in helper)
                    label1: 'Controls',
                    label2: 'Cases'
                }
            };
        }
    },
    'cohort': {
        inputs: [
            { id: 'p_unexposed', label: '% Unexposed with Outcome', type: 'range', min: 0.1, max: 99.9, step: 0.1, val: 5, desc: 'Baseline risk in unexposed group (P2).' },
            { id: 'p_exposed', label: '% Exposed with Outcome', type: 'range', min: 0.1, max: 99.9, step: 0.1, val: 9.5, desc: 'Risk in exposed group (P1).' },
            { id: 'power', label: 'Power (%)', type: 'range', min: 80, max: 99, val: 80, desc: 'Probability of detecting a true effect.' },
            { id: 'confidence', label: 'Confidence Level (%)', type: 'range', min: 90, max: 99, val: 95, desc: '1 - Alpha (usually 95%).' },
            { id: 'ratio', label: 'Unexposed to Exposed Ratio (r)', type: 'number', val: 1, desc: 'Number of unexposed per exposed (usually 1).' },
            { id: 'dropout', label: 'Add 10% for Non-response?', type: 'checkbox', val: false, desc: 'Increases sample size to account for 10% dropout.' }
        ],
        formulaStr: `
            <div style="font-size:0.9em; line-height:1.4">
                <strong>Kelsey Formula (Main):</strong><br>
                N<sub>1</sub> = (Z<sub>α/2</sub>+Z<sub>β</sub>)<sup>2</sup> P(1-P)(r+1) / [r(P<sub>1</sub>-P<sub>2</sub>)<sup>2</sup>]<br>
                <div style="font-size:0.8em; margin-top:5px; opacity:0.8">
                    (See Interpretation regarding Fleiss & Fleiss CC methods)
                </div>
            </div>
        `,
        formulaSteps: `
            <p><strong>P<sub>1</sub></strong> = % Exposed with Outcome</p>
            <p><strong>P<sub>2</sub></strong> = % Unexposed with Outcome</p>
            <p><strong>r</strong> = Ratio (Unexposed / Exposed)</p>
            <p>Calculates Sample Size using:</p>
            <ul>
                <li><strong>Kelsey</strong>: Standard approximation</li>
                <li><strong>Fleiss</strong>: With Levin's modification</li>
                <li><strong>Fleiss CC</strong>: With Continuity Correction</li>
            </ul>
        `,
        interpretation: `
            <p>Provides comparative sample sizes using three common methods. Fleiss with Continuity Correction is the most conservative (largest sample size).</p>
            <div style="font-size:0.85em; margin-top:10px; border-top:1px solid rgba(255,255,255,0.2); padding-top:5px;">
                <strong>Formulas Used:</strong><br>
                <strong>Kelsey:</strong> N<sub>1</sub> = (Z<sub>α/2</sub>+Z<sub>β</sub>)<sup>2</sup> P(1-P)(r+1) / [r(P<sub>1</sub>-P<sub>2</sub>)<sup>2</sup>]<br>
                <strong>Fleiss:</strong> N<sub>1</sub> = [Z<sub>α/2</sub>&radic;((r+1)P(1-P)) + Z<sub>β</sub>&radic;(rP<sub>1</sub>(1-P<sub>1</sub>)+P<sub>2</sub>(1-P<sub>2</sub>))]<sup>2</sup> / [r(P<sub>1</sub>-P<sub>2</sub>)<sup>2</sup>]<br>
                *N<sub>Fleiss,CC</sub> applies continuity correction to N<sub>Fleiss</sub>
            </div>
        `,
        calc: (state) => {
            const P2 = parseFloat(state.p_unexposed) / 100; // Unexposed
            const P1 = parseFloat(state.p_exposed) / 100;   // Exposed

            // Auto-calculate RR/OR etc for display if needed, but primarily we use the raw proportions
            const RR = (P2 > 0) ? (P1 / P2) : 0;
            const RD = (P1 - P2) * 100;

            const r = parseFloat(state.ratio) || 1;
            const power = parseInt(state.power);
            const conf = parseInt(state.confidence) || 95;
            const alpha = (100 - conf) / 100;
            const beta = (100 - power) / 100;

            if (Math.abs(P1 - P2) < 0.0001) {
                return { n: 'Error', display: 'P1 and P2 cannot be equal.', table: null };
            }

            const results = calculateAdvanced(P1, P2, r, alpha, beta, state.dropout);

            let displayStr = `P1=${(P1 * 100).toFixed(2)}% P2=${(P2 * 100).toFixed(2)}% RR=${RR.toFixed(2)} RD=${RD.toFixed(2)}%`;
            if (state.dropout) displayStr += " (Incl. 10% Dropout)";

            return {
                n: results.fleiss.total, // Default to Fleiss for big display
                display: displayStr,
                table: results,
                visualData: {
                    n1: results.fleiss.n2, // Unexposed (Group 2)
                    n2: results.fleiss.n1, // Exposed (Group 1)
                    label1: 'Unexposed',
                    label2: 'Exposed'
                }
            };
        }
    },
    'rct': {
        inputs: [
            { id: 'p1', label: 'Prop. Group 1 (%)', type: 'range', min: 0.1, max: 99.9, step: 0.1, val: 50, desc: 'Anticipated outcome in Control Group (e.g., Unexposed).' },
            { id: 'p2', label: 'Prop. Group 2 (%)', type: 'range', min: 0.1, max: 99.9, step: 0.1, val: 40, desc: 'Anticipated outcome in Treatment Group (e.g., Exposed).' },
            { id: 'power', label: 'Power (%)', type: 'range', min: 80, max: 99, val: 80, desc: '' },
            { id: 'confidence', label: 'Confidence Level (%)', type: 'range', min: 90, max: 99, val: 95, desc: '' },
            { id: 'ratio', label: 'Group Ratio (N1/N2) (r)', type: 'number', val: 1, desc: '' },
            { id: 'dropout', label: 'Add 10% for Non-response?', type: 'checkbox', val: false, desc: '' }
        ],
        formulaStr: `
            <div style="font-size:0.9em; line-height:1.4">
                <strong>Kelsey Formula (Main):</strong><br>
                N<sub>1</sub> = (Z<sub>α/2</sub>+Z<sub>β</sub>)<sup>2</sup> P(1-P)(r+1) / [r(P<sub>1</sub>-P<sub>2</sub>)<sup>2</sup>]<br>
                <div style="font-size:0.8em; margin-top:5px; opacity:0.8">
                    (See Interpretation regarding Fleiss & Fleiss CC methods)
                </div>
            </div>
        `,
        formulaSteps: `
            <p><strong>P<sub>1</sub></strong> = Prop. Group 1 (Control)</p>
            <p><strong>P<sub>2</sub></strong> = Prop. Group 2 (Treatment)</p>
            <p><strong>r</strong> = Ratio (Group 1 / Group 2)</p>
            <p>Calculates Sample Size using:</p>
            <ul>
                <li><strong>Kelsey</strong>: Standard approximation</li>
                <li><strong>Fleiss</strong>: With Levin's modification</li>
                <li><strong>Fleiss CC</strong>: With Continuity Correction</li>
            </ul>
        `,
        interpretation: `
            <p>Standard calculation for Randomized Controlled Trials comparing binary outcomes. Fleiss CC is recommended for conservative estimates.</p>
            <div style="font-size:0.85em; margin-top:10px; border-top:1px solid rgba(255,255,255,0.2); padding-top:5px;">
                <strong>Formulas Used:</strong><br>
                <strong>Kelsey:</strong> N<sub>1</sub> = (Z<sub>α/2</sub>+Z<sub>β</sub>)<sup>2</sup> P(1-P)(r+1) / [r(P<sub>1</sub>-P<sub>2</sub>)<sup>2</sup>]<br>
                <strong>Fleiss:</strong> N<sub>1</sub> = [Z<sub>α/2</sub>&radic;((r+1)P(1-P)) + Z<sub>β</sub>&radic;(rP<sub>1</sub>(1-P<sub>1</sub>)+P<sub>2</sub>(1-P<sub>2</sub>))]<sup>2</sup> / [r(P<sub>1</sub>-P<sub>2</sub>)<sup>2</sup>]<br>
                *N<sub>Fleiss,CC</sub> applies continuity correction to N<sub>Fleiss</sub>
            </div>
        `,
        calc: (state) => {
            const P1 = parseFloat(state.p1) / 100; // Control / Group 1
            const P2 = parseFloat(state.p2) / 100; // Treatment / Group 2
            const r = parseFloat(state.ratio) || 1;
            const power = parseInt(state.power);
            const conf = parseInt(state.confidence) || 95;
            const alpha = (100 - conf) / 100;
            const beta = (100 - power) / 100;

            if (Math.abs(P1 - P2) < 0.0001) {
                return { n: 'Error', display: 'P1 and P2 cannot be equal.', table: null };
            }

            // We pass P2 (Treatment/Exposed) as p1, and P1 (Control/Unexposed) as p2 to match our helper's logic
            // Helper assumes p1=Exposed, p2=Unexposed for variance naming, but mathematically symmetric except for r
            // If r = N1/N2 (Control/Treatment). 
            // In helper: r = ratio argument. 
            // Helper logic: p_avg = (p1 + r*p2)/(1+r).
            // If we want p_avg = (P_treatment + r*P_control)/(1+r)? 
            // Usually Pooled P = (n1*p1 + n2*p2)/(n1+n2).
            // = (n1*p1 + (n1/r)*p2) ... no r=n1/n2.
            // Let's check Cohort r definition: r = Unexposed/Exposed = N_unexposed / N_exposed.
            // Cohort passed: calcAdvanced(P_exposed, P_unexposed, r).  (p1, p2, r)
            // Helper p_avg = (p1 + r*p2) / (1+r) = (P_exp + (N_unexp/N_exp)*P_unexp) / (1 + N_unexp/N_exp)
            // Multiply by N_exp: (N_exp*P_exp + N_unexp*P_unexp) / (N_exp + N_unexp). Correct.

            // Now RCT: r = N1/N2 = Control/Treatment.
            // We want (N_control*P_control + N_treat*P_treatment) / Total.
            // Target: (N1*P1 + N2*P2) / (N1+N2)
            // If we use helper(p_A, p_B, r):
            // (p_A + r*p_B)/(1+r)
            // If r = N1/N2.
            // = (p_A + (N1/N2)*p_B) / (1 + N1/N2)
            // Multiply by N2: (N2*p_A + N1*p_B) / (N2 + N1).
            // So p_B must be P1 (Control), p_A must be P2 (Treatment).

            // So: calculateAdvanced(P2, P1, r).

            const results = calculateAdvanced(P2, P1, r, alpha, beta, state.dropout);

            let displayStr = `P1=${(P1 * 100).toFixed(2)}% P2=${(P2 * 100).toFixed(2)}% Power=${power}% Conf=${conf}%`;
            if (state.dropout) displayStr += " (Incl. 10% Dropout)";

            return {
                n: results.fleiss.total,
                display: displayStr,
                table: results,
                visualData: {
                    n1: results.fleiss.n2, // n2 in struct is derived from n1*r. n1 was passed as P2 (Treatment). So n1_out is Treatment N.
                    // n2_out = n1_out * r = Treatment * (Control/Treatment) = Control N.
                    // So n2 in struct is Control (Group 1).
                    n2: results.fleiss.n1, // Treatment (Group 2)
                    label1: 'Group 1',
                    label2: 'Group 2'
                }
            };
        }
    },
    'two-means': {
        inputs: [
            { id: 'mean1', label: 'Mean Group 1', type: 'number', val: 132.86, desc: 'Expected mean of Group 1.' },
            { id: 'sd1', label: 'SD Group 1', type: 'number', val: 15.34, desc: 'Standard Deviation of Group 1.' },
            { id: 'mean2', label: 'Mean Group 2', type: 'number', val: 127.44, desc: 'Expected mean of Group 2.' },
            { id: 'sd2', label: 'SD Group 2', type: 'number', val: 18.23, desc: 'Standard Deviation of Group 2.' },
            { id: 'ratio', label: 'Group Ratio (N2/N1) (r)', type: 'number', val: 1, desc: '' },
            { id: 'power', label: 'Power (%)', type: 'range', min: 80, max: 99, val: 80, desc: '' },
            { id: 'confidence', label: 'Confidence Level (%)', type: 'range', min: 90, max: 99, val: 95, desc: '' },
            { id: 'dropout', label: 'Add 10% for Non-response?', type: 'checkbox', val: false, desc: 'Increases sample size to account for 10% dropout.' }
        ],
        formulaStr: `
            <div style="font-size:0.8em; line-height:1.4">
                N<sub>1</sub> = (Z<sub>α/2</sub>+Z<sub>β</sub>)<sup>2</sup> (&sigma;<sub>1</sub><sup>2</sup> + &sigma;<sub>2</sub><sup>2</sup>/r) / (&mu;<sub>1</sub>-&mu;<sub>2</sub>)<sup>2</sup><br>
                N<sub>2</sub> = r * N<sub>1</sub>
            </div>
        `,
        formulaSteps: '', // Will be dynamic
        interpretation: `
            <p>Calculates sample size for comparing two independent means (Student's t-test equivalent).</p>
        `,
        calc: (state) => {
            const m1 = parseFloat(state.mean1);
            const s1 = parseFloat(state.sd1);
            const m2 = parseFloat(state.mean2);
            const s2 = parseFloat(state.sd2);
            const r = parseFloat(state.ratio) || 1;
            const power = parseInt(state.power);
            const conf = parseInt(state.confidence) || 95;
            const alpha = (100 - conf) / 100;
            const beta = (100 - power) / 100;
            const za = getZAlpha(conf);
            const zb = getZBeta(power);

            if (m1 === m2) return { n: 'Error', display: 'Means cannot be equal.', visualData: null };

            const num = Math.pow(za + zb, 2) * (s1 * s1 + (s2 * s2) / r);
            const den = Math.pow(m1 - m2, 2);

            let n1 = Math.ceil(num / den);
            if (state.dropout) n1 = Math.ceil(n1 / 0.9);

            let n2 = Math.ceil(n1 * r);
            let total = n1 + n2;

            let displayStr = `M1=${m1} SD1=${s1} M2=${m2} SD2=${s2} Diff=${(m1 - m2).toFixed(2)}`;
            if (state.dropout) displayStr += " (Incl. 10% Dropout)";

            return {
                n: total,
                display: displayStr,
                visualData: {
                    n1: n1, // Group 1
                    n2: n2, // Group 2
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
        // For Formula Steps, we now generate it dynamically in calculate(), but we can set a placeholder or static text if needed.
        // interpretationContent.innerHTML = config.interpretation; // Moved to calculate() to append table
        formulaDisplay.innerHTML = config.formulaStr;

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

        // --- 1. Main Display (Kelsey Priority) ---
        let mainValue = result.n;
        let subText = '';

        if (result.table && result.table.kelsey) {
            mainValue = result.table.kelsey.total;
            subText = '<div style="font-size:1rem; opacity:0.7">Kelsey Estimate</div>';
        }

        if (typeof mainValue === 'string') {
            nValueDisplay.innerHTML = `<span style="font-size:3rem">${mainValue}</span>`;
        } else {
            nValueDisplay.innerHTML = `<span style="font-size:5rem">${mainValue.toLocaleString()}</span>${subText}`;
        }

        dynamicParamsDisplay.textContent = result.display;

        // --- 2. Dynamic Formula Steps (Input Summary) ---
        let stepsHTML = '<p><strong>Input Parameters:</strong></p><ul style="list-style:none; padding-left:0; font-size:0.9em;">';
        // Get current inputs directly from state to ensure we show what user sees
        const config = MODES[currentMode];
        config.inputs.forEach(input => {
            if (!input.hidden) {
                const val = inputsState[input.id];
                let label = input.label;

                // Explicit Mapping for P1/P2 based on mode
                if (currentMode === 'case-control') {
                    if (input.id === 'p_controls') label = 'P<sub>2</sub> (% Exposed in Controls)';
                    if (input.id === 'ratio') label = 'r (Control/Case Ratio)';
                } else if (currentMode === 'cohort') {
                    if (input.id === 'p_exposed') label = 'P<sub>1</sub> (% Exposed with Outcome)';
                    if (input.id === 'p_unexposed') label = 'P<sub>2</sub> (% Unexposed with Outcome)';
                    if (input.id === 'ratio') label = 'r (Unexposed/Exposed Ratio)';
                } else if (currentMode === 'rct') {
                    if (input.id === 'p1') label = 'P<sub>1</sub> (Prop. Group 1)'; // Actually typically Control in standard formula
                    if (input.id === 'p2') label = 'P<sub>2</sub> (Prop. Group 2)';
                    if (input.id === 'ratio') label = 'r (Group Ratio)';
                } else if (currentMode === 'two-means') {
                    if (input.id === 'mean1') label = '&mu;<sub>1</sub> (Mean Group 1)';
                    if (input.id === 'mean2') label = '&mu;<sub>2</sub> (Mean Group 2)';
                    if (input.id === 'sd1') label = '&sigma;<sub>1</sub> (SD Group 1)';
                    if (input.id === 'sd2') label = '&sigma;<sub>2</sub> (SD Group 2)';
                }

                // Truncate very long labels if not replaced
                if (label.length > 40) label = label.substring(0, 38) + '..';

                let displayVal = val;
                if (input.type === 'checkbox') displayVal = val ? 'Yes' : 'No';

                stepsHTML += `<li style="margin-bottom:4px; border-bottom:1px solid rgba(255,255,255,0.1); display:flex; justify-content:space-between;">
                    <span style="opacity:0.8">${label}:</span> 
                    <strong>${displayVal}</strong>
                 </li>`;
            }
        });

        // Add Calculated values if available
        if (currentMode === 'case-control' && result.display.includes('P_cases')) {
            // Extract P_cases from display string
            const pCasesMatch = result.display.match(/P_cases=([\d.]+)%/);
            if (pCasesMatch) {
                stepsHTML += `<li style="margin-bottom:4px; border-bottom:1px solid rgba(255,255,255,0.1); display:flex; justify-content:space-between; color:orange;">
                    <span>P<sub>1</sub> (Calc. % Exposed in Cases):</span> <strong>${pCasesMatch[1]}%</strong>
                 </li>`;
            }
        }
        stepsHTML += '</ul>';
        formulaStepsContent.innerHTML = stepsHTML;

        // --- 3. Interpretation & Table ---
        let interpHTML = mode.interpretation;

        if (result.table) {
            // Render Table
            let tableHTML = `
                <br><strong>Comparison of Methods:</strong>
                <table style="width:100%; text-align:center; margin-top:5px; border-collapse: collapse; font-size:0.9em;">
                    <thead>
                        <tr style="border-bottom: 1px solid rgba(255,255,255,0.2);">
                            <th style="padding:4px;">Method</th>
                            <th style="padding:4px;">${result.visualData.label2}</th>
                            <th style="padding:4px;">${result.visualData.label1}</th>
                            <th style="padding:4px;">Total</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td style="padding:4px; text-align:left;">Kelsey</td>
                            <td>${result.table.kelsey.n1}</td>
                            <td>${result.table.kelsey.n2}</td>
                            <td>${result.table.kelsey.total}</td>
                        </tr>
                        <tr>
                            <td style="padding:4px; text-align:left;">Fleiss</td>
                            <td>${result.table.fleiss.n1}</td>
                            <td>${result.table.fleiss.n2}</td>
                            <td>${result.table.fleiss.total}</td>
                        </tr>
                        <tr>
                            <td style="padding:4px; text-align:left;">Fleiss CC</td>
                            <td>${result.table.fleiss_cc.n1}</td>
                            <td>${result.table.fleiss_cc.n2}</td>
                            <td>${result.table.fleiss_cc.total}</td>
                        </tr>
                    </tbody>
                </table>
             `;
            interpHTML += tableHTML;
        }

        interpretationContent.innerHTML = interpHTML;

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
