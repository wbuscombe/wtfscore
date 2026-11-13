// WTFScore DEL-0 - viewport presets.
// Presets are MODEL dimensions rendered inside this page. They are NOT browser
// viewport or device-pixel-ratio emulation. DPR values are labels only: model
// geometry is in CSS px and does not change with DPR.

import { SCALE_MIN, clampScale, lowestScaleMeetingTextFloor } from './sizing.mjs';

export const PRESETS = Object.freeze([
  Object.freeze({ id: 'actual', kind: 'actual', label: 'Actual browser box (measured)' }),
  Object.freeze({ id: 'd1920', kind: 'desktop', w: 1920, h: 1080, dpr: 1, label: 'Desktop 1920x1080 · DPR 1 label' }),
  Object.freeze({ id: 'd1280', kind: 'desktop', w: 1280, h: 720, dpr: 1, label: 'Desktop 1280x720 · DPR 1 label' }),
  Object.freeze({ id: 'tv960d2', kind: 'tv', w: 960, h: 540, dpr: 2, label: 'TV model 960x540 · DPR 2 label' }),
  Object.freeze({ id: 'tv960d1333', kind: 'tv', w: 960, h: 540, dpr: 1.333, label: 'TV model 960x540 · DPR 1.333 label' }),
  Object.freeze({ id: 'p390', kind: 'phone', w: 390, h: 844, dpr: 3, touch: true, label: 'Phone model 390x844 · DPR 3 label' }),
]);

// The contract's comparison viewports (every preset except the measured one).
export const CONTRACT_VIEWPORTS = Object.freeze(PRESETS.filter((p) => p.kind !== 'actual'));

export function presetById(id) {
  return PRESETS.find((p) => p.id === id) || null;
}

// TV presets cannot select a scale below the 14 px text floor (plan 4.7).
export function scaleFloorFor(preset) {
  return preset && preset.kind === 'tv' ? lowestScaleMeetingTextFloor() : SCALE_MIN;
}

export function effectiveScale(preset, scale) {
  return Math.max(scaleFloorFor(preset), clampScale(scale));
}

// Default scale proposed per preset kind (see the G1 sheet; proposals only).
export function defaultScaleFor(preset) {
  if (preset && preset.kind === 'tv') return lowestScaleMeetingTextFloor();
  return 5;
}
