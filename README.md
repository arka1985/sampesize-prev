# Visual Understanding of Sample Size Calculation for Common Epidemiological Studies

A comprehensive, interactive web application designed to help researchers, students, and epidemiologists visualize and understand sample size calculations for various study designs.

## Features

### 1. Multi-Study Design Support
Switch instantly between four major epidemiological study types:
*   **Prevalence Study (Cross-Sectional)**: Calculate sample size for estimating population prevalence.
*   **Case-Control Study**: Determine sample size based on Odds Ratio (OR) and exposure in controls.
*   **Cohort Study**: Calculate sample size based on Risk Ratio (RR) and incidence in unexposed group.
*   **Randomized Controlled Trial (RCT)**: Plan trials comparing binary outcomes between two groups.

### 2. Interactive Calculation & Visualization
*   **Dynamic Inputs**: Sliders and input fields update the calculation in real-time.
*   **Visual Feedback**:
    *   **Prevalence Curve**: See how sample size changes with Prevalence (P) and Precision (D). Features auto-scaling Y-axis.
    *   **Population Grid (Dot Matrix)**: A 1:1 visual representation of participants for Case-Control, Cohort, and RCT studies. See exactly how many Control vs. Case subjects you need.
    *   **Color-Coded Groups**: Distinct colors (Green for Control/Group 1, Pink for Case/Group 2) for immediate clarity.

### 3. Transparent Methodology
*   **Formula Display**: The tool displays the actual mathematical formula used for the current mode.
*   **Step-by-Step Logic**: A dedicated "Formula Steps" panel explains every variable in the equation.
*   **Dynamic Parameters**: See the exact values being plugged into the formula, including statistical constants like:
    *   **Z<sub>&alpha;/2</sub>** (Confidence Level, e.g., 1.96 for 95%)
    *   **Z<sub>&beta;</sub>** (Power, e.g., 0.84 for 80%)

### 4. Advanced Options
*   **Finite Population Correction (FPC)**: Toggle Cochran's correction for small populations in prevalence studies.
*   **Confidence Level Selection**: Adjust alpha (90%, 95%, 99%) for comparative studies.
*   **Dropout Correction**: Toggle to automatically add a 10% buffer for non-response ($N / 0.9$).
*   **Control/Case Ratio**: Adjust the ratio of controls to cases (e.g., 1:1, 2:1) to see the impact on total sample size.

## Usage

1.  **Select Study Design**: Use the dropdown menu at the top.
2.  **Adjust Parameters**: Use the sliders to change Prevalence, Power, Odds Ratio, etc.
3.  **Visual Confirmation**: Watch the "Population Grid" or "Prevalence Curve" update instantly.
4.  **Review Steps**: Check the "Formula Steps" and "Interpretation" cards to understand the *why* behind the number.

## Developer

**Developed By**
Dr. Arkaprabha Sau, MBBS, MD (Gold Medalist), DPH, Dip. Geriatric Medicine, CCEBDM
PhD (Computer Science & Engineering)
