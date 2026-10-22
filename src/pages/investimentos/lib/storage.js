// Persistência local (localStorage) e compartilhamento por URL. Nenhum dado sai do navegador:
// o estado compartilhado vai no fragmento (#), que não é enviado ao servidor.

import { sanitizeState } from './state.js';

const KEYS = { current: 'rfcalc.current', simulations: 'rfcalc.simulations', rates: 'rfcalc.rates' };

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback; // JSON corrompido ou storage bloqueado
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false; // modo privado, cota cheia etc.
  }
}

export const loadCurrent = () => {
  const raw = read(KEYS.current, null);
  return raw ? sanitizeState(raw) : null;
};
export const saveCurrent = (state) => write(KEYS.current, state);

export const loadRatesCache = () => {
  const raw = read(KEYS.rates, {});
  return raw && typeof raw === 'object' ? raw : {};
};
export const saveRatesCache = (rates) => write(KEYS.rates, rates);

// Simulações salvas: [{ id, name, savedAt, state }]
export function listSimulations() {
  const raw = read(KEYS.simulations, []);
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s) => s && typeof s.id === 'string' && typeof s.name === 'string')
    .map((s) => ({ id: s.id, name: s.name, savedAt: String(s.savedAt || ''), state: sanitizeState(s.state) }));
}

export function saveSimulation(name, state, id = crypto.randomUUID()) {
  const list = listSimulations().filter((s) => s.id !== id);
  list.unshift({ id, name, savedAt: new Date().toISOString(), state });
  return write(KEYS.simulations, list) ? id : null;
}

export function deleteSimulation(id) {
  return write(KEYS.simulations, listSimulations().filter((s) => s.id !== id));
}

// base64url de JSON UTF-8.
export function encodeShare(state) {
  const bytes = new TextEncoder().encode(JSON.stringify(state));
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function decodeShare(code) {
  try {
    const b64 = code.replaceAll('-', '+').replaceAll('_', '/');
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    return sanitizeState(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return null;
  }
}
