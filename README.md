# Qalam-Sense

Qalam-Sense is a React + TypeScript adaptive reading platform focused on young readers, multilingual content (French/Arabic), and neurodivergent-friendly presentation.

The system combines role-based education workflows (teacher, student, parent), a real-time adaptation pipeline, and privacy-aware local data handling.

## Table of contents

1. Overview
2. Core capabilities
3. Architecture at a glance
4. Project structure
5. Getting started
6. User workflows
7. Adaptation model and levels
8. Privacy and security
9. Data and storage
10. Available scripts
11. Known gaps and next steps

## Overview

Qalam-Sense helps students read assigned texts with adaptive visual support. The interface can tune typography and contrast based on detected reading difficulty.

Main goals:

- Improve readability with smooth, non-disruptive UI adaptations.
- Support bilingual reading contexts (LTR and RTL).
- Keep parent consent and data minimization central to the workflow.

## Core capabilities

- Role-based app flows:
	- Teacher dashboard to upload and assign texts.
	- Student reading flow with adaptive reader.
	- Parent dashboard for child linkage and oversight.
- Adaptive text presentation:
	- Font size, spacing, line-height, and contrast adjustments.
	- Progressive level transitions (LOW, MEDIUM, HIGH).
	- Anti-oscillation gating and gradual recovery.
- Eye-tracking integration:
	- Real-time gaze events.
	- Confidence filtering and smoothing.
	- Tracking-loss handling and recalibration hooks.
- Privacy-aware runtime:
	- Consent-gated eye tracking.
	- Local encrypted session storage.
	- Event-driven architecture for modularity and auditability.

## Architecture at a glance

The adaptation pipeline is event-driven:

1. Eye-tracking module emits gaze points and status events.
2. AI layer computes difficulty signals.
3. Text adapter maps signals to visual adaptations.
4. Reader UI applies CSS token updates with transitions.

Key modules:

- `src/core/eye-tracking`: gaze collection, filters, and reading behavior signals.
- `src/core/ai-engine`: difficulty inference and adaptive loop control.
- `src/core/text-adapter`: adaptation rules, transitions, and CSS token emission.
- `src/core/event-bus`: strongly typed app-wide event exchange.

## Project structure

High-level workspace layout:

- `src/auth`: authentication and password hashing.
- `src/core`: engine modules (event bus, AI, eye tracking, text adaptation).
- `src/security`: consent, encryption, access control, minimization, auditing.
- `src/storage`: local DB and repositories.
- `src/ui`: pages, components, hooks, styles, and i18n.
- `docs`: architecture/API/privacy placeholders and documentation files.

## Getting started

### Prerequisites

- Node.js 18+
- npm 9+
- Modern browser (camera permission needed for eye-tracking mode)

### Install dependencies

```bash
npm install
```

### Run development server

```bash
npm run dev
```

Default local URL:

- `http://localhost:5173/`

### Build for production

```bash
npm run build
```

### Preview production build

```bash
npm run preview
```

### Optional scaffold script

The repository includes `setup.ps1`, which creates the project folder/file scaffold. It is useful for bootstrapping an empty workspace but is not required for normal day-to-day development.

## User workflows

### Teacher

1. Log in with teacher credentials.
2. Upload or create reading texts.
3. Assign texts to one or more students.

### Student

1. Log in with student ID + 4-digit PIN.
2. Select an assigned text.
3. Read in AdaptiveReader with visual supports applied dynamically.

### Parent

1. Log in with parent credentials.
2. Link child profiles.
3. Manage consent-related behavior and child visibility.

## Adaptation model and levels

The text adaptation engine now applies three explicit levels:

- `LOW`: normal reading presentation.
- `MEDIUM`: slight spacing increase with subtle readability assistance.
- `HIGH`: larger text, stronger spacing, and higher visual support.

Behavioral controls:

- Stability window to avoid rapid level flicker.
- Timed recovery steps to de-escalate support gradually.
- CSS transition durations tuned to provide smooth visual changes.

## Privacy and security

Security and compliance patterns currently implemented:

- Password hashing with salt for non-student account credentials.
- Student PIN-based sign-in with hashed verification.
- Consent manager that gates eye tracking and local storage behavior.
- Event emissions for consent granted/revoked.
- Local encrypted storage flow for reading sessions.

Notes:

- Eye tracking is optional and should run only when consent and permission are present.
- Camera-denied mode falls back to non-camera adaptation behavior.

## Data and storage

Current storage model uses local browser storage layers:

- `localStorage` for account-like app state and profiles.
- `sessionStorage` for authentication sessions.
- IndexedDB via LocalDB/SessionRepository for session persistence.

This architecture enables local-first prototyping without a backend dependency.

## Available scripts

- `npm run dev`: start Vite dev server.
- `npm run build`: compile TypeScript and build production assets.
- `npm run preview`: serve the production build locally.
- `npm run train:model`: train the ETDD70 logistic model and export JSON artifacts for runtime use.

## ETDD70 model artifacts

- Training entry point: `ml/train_etdd70_logreg.py`
- Training artifact output: `ml/artifacts/etdd70_logreg_v0.json`
- Runtime artifact consumed by the app: `src/core/ai-engine/model/etdd70_logreg_v0.json`

The trainer expects the dataset folder `13332134/` to be a sibling of `qalam_sense_baya/`.

## Known gaps and next steps

- Several files in `docs/` are placeholders and need full technical documentation.
- Automated tests are scaffolded by folder but not fully implemented.
- Production deployment pipeline and server-side sync are not yet finalized.

---

If you are onboarding this project for research/demo use, start with:

1. `npm install`
2. `npm run dev`
3. Open `http://localhost:5173/`
