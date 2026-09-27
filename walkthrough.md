# Walkthrough — Maintenance Impact Analysis

## Executive Summary
RailSync AI now features **Maintenance Impact Analysis** — the pre-approval decision-support engine answering:
> **"WHAT WILL THIS MAINTENANCE AFFECT?"**

Before any maintenance plan is approved by railway personnel, RailSync AI models and transparently explains operational impacts across 6 core railway dimensions:
1. **Block & Station Impact**: Affected blocks, duration, distance, and unique start/end stations derived from railway topology.
2. **Train Impact & Conflict Analysis**: Route-aware train conflict detection distinguishing between unique affected trains and specific conflict events (without fabricating delays).
3. **Crew & Department Impact**: Assigned crews, department counts, crew capacity versus required team sizes, and workload notes.
4. **Dependency Impact**: Prerequisite tasks, blocked downstream tasks, and visual finish-to-start dependency chains.
5. **Asset Availability Impact**: Network-wide corridor asset count, restricted assets, available assets, and availability percentage changes.
6. **Traffic Impact & Maintenance Window**: Modeled route traffic scores, planning window selection, and total coordinated window duration.

---

## Architecture & Data Flow

```
Maintenance Task / Bundle / What-If Scenario
                     ↓
         Maintenance Impact Analysis
                     ↓
  ┌──────────────────┼──────────────────┐
  ↓                  ↓                  ↓
Blocks & Stations  Trains & Conflicts  Crews & Departments
  ↓                  ↓                  ↓
Dependencies       Route Traffic      Asset Availability
  └──────────────────┬──────────────────┘
                     ↓
          Deterministic Impact Level
             (Score: 0 to 7)
                     ↓
         Structured Impact Summary
                     ↓
         Human Review & Approval
```

---

## Key Backend Enhancements

### 1. Schemas (`backend/app/schemas/impact.py`)
- `AffectedBlockItem` & `AffectedStationItem`: Structural representation of blocks and their start/end stations.
- `TrainConflictItem` & `TrainImpact`: Distinguishes `affected_trains_count` from `total_conflicts`.
- `CrewMemberImpact` & `CrewImpact`: Full crew capacity, department, and task assignment tracking.
- `DependencyRelation` & `DependencyImpact`: Downstream and prerequisite dependency chains (`finish-to-start`).
- `AssetAvailabilityImpact`: Real corridor availability percentages and deltas.
- `TrafficImpact`: Traffic levels ("Low", "Medium", "High"), slot scores, and operational indicators.
- `MaintenanceWindowImpact`: Exact planned start, end, and duration.
- `ImpactSummary`: 11-metric structured operational summary.
- `BaselineVsOptimized`: Real Before vs After comparison for bundles and What-If scenarios.
- `MaintenanceImpactResponse`: Complete response including deterministic formula explanation, human approval requirement, and decision-support disclaimer.

### 2. Service Logic (`backend/app/services/ai/impact_analyzer.py`)
- **Deterministic Impact Level Formula**:
  - Affected Trains: $> 3 \to +2\text{ pts}$, $1\text{–}3 \to +1\text{ pt}$, $0 \to 0\text{ pts}$
  - Restricted Assets: $\ge 2 \to +2\text{ pts}$, $1 \to +1\text{ pt}$, $0 \to 0\text{ pts}$
  - Blocked Tasks: $> 0 \to +1\text{ pt}$, $0 \to 0\text{ pts}$
  - Route Traffic: $\text{High} \to +2\text{ pts}$, $\text{Medium} \to +1\text{ pt}$, $\text{Low} \to 0\text{ pts}$
  - Total $\ge 4 \to \text{High}$, $2\text{–}3 \to \text{Moderate}$, $0\text{–}1 \to \text{Low}$.
- **Analysis Functions**:
  - `analyze_task_impact(db, maintenance_id)`: Individual task analysis.
  - `analyze_bundle_impact(db, bundle_id)`: Coordinated bundle analysis.
  - `analyze_what_if_impact(db, request)`: Simulated scenario impact evaluation.

### 3. API Endpoints (`backend/app/api/routes/ai.py`)
- `GET /ai/maintenance-impact/{maintenance_id}`
- `GET /ai/maintenance-impact/bundle/{bundle_id}`
- `POST /ai/maintenance-impact/what-if`

---

## Frontend Integration (`frontend/src/`)

### 1. New Component: `MaintenanceImpactSection.tsx`
- **Selector**: Toggle between Individual Task, Multi-Department Bundle, and What-If Scenario.
- **Top KPI Cards**: 7 instant metrics (Affected Blocks, Stations, Trains, Conflicts, Crews & Depts, Restricted Assets, Maintenance Window).
- **Before vs After Comparison**: Clear comparison rows for bundles and What-If simulations.
- **6 Expandable Category Cards**:
  1. Block & Station Impact (with station code chips)
  2. Train Impact & Conflict Analysis (table with train number, name, station, severity, recommendation)
  3. Crew & Department Impact (crew capacity, required size, workload)
  4. Dependency Impact (visual dependency arrow links)
  5. Asset Availability Impact (progress bar with percentage)
  6. Route Traffic & Planning Window
- **Human Approval Action Bar**: Pre-approval prompt with "Approve Maintenance Plan" and "Request Modification / Reject" buttons.

### 2. Page Navigation: `Maintenance.tsx`
- Added Tab 9: **"Maintenance Impact"** (`activeTab === 'impact'`).
- Preserves single-section-at-a-time display cleanly.

---

## Verification & Test Results

### 1. Automated Test Suite (`backend/tests/test_maintenance_impact.py`)
Ran: `powershell -Command "$env:PYTHONPATH='.'; .\venv\Scripts\python.exe -m pytest -q tests/test_maintenance_impact.py"`
- `test_single_task_impact_analysis` — **PASSED**
- `test_dependent_task_impact_analysis` — **PASSED**
- `test_bundle_impact_analysis` — **PASSED**
- `test_deterministic_impact_level_formula` — **PASSED**
- `test_what_if_scenario_impact` — **PASSED**
- `test_maintenance_impact_api_endpoints` — **PASSED**

### 2. Full Regression Suite
Ran: `powershell -Command ".\venv\Scripts\python.exe -m pytest -q"`
- **103 passed, 1 warning in 9.65s**
- Zero regressions across predictive maintenance, urgency scheduling, crew queue, bundling, asset availability, and route-aware planning.

### 3. Frontend Type Verification
Ran: `npx tsc --noEmit`
- **0 errors, clean build**.

### 4. Real Live API Responses
- `GET /ai/maintenance-impact/1`: Analyzed Signal Maintenance on `OGL-CLX-01` (7 trains, 7 conflicts, 74/75 assets available, predictive origin matched).
- `GET /ai/maintenance-impact/bundle/BUNDLE-GNT-BZA-01`: Analyzed 3 tasks across 3 departments (Electrical, Engineering, S&T), 3 crews, 150-minute coordinated window, Electrical $\to$ Signal dependency captured, and 60 minutes saved.
