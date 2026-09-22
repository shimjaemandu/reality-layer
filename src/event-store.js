'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const EVENT_STORE_VERSION = 'reality-event/1.6';
const ROOT = path.join(__dirname, '..');
const EVENT_FILE = path.join(ROOT, 'data', 'reality-events.json');
const MAX_EVENTS = 500;

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function ensureDir() { fs.mkdirSync(path.dirname(EVENT_FILE), { recursive:true }); }
function ensureFile() { ensureDir(); if (!fs.existsSync(EVENT_FILE)) fs.writeFileSync(EVENT_FILE, '[]\n'); }
function rawEvents() { ensureFile(); try { const value=JSON.parse(fs.readFileSync(EVENT_FILE,'utf8')); return Array.isArray(value) ? value : []; } catch { return []; } }
function writeEvents(events) { ensureDir(); fs.writeFileSync(EVENT_FILE, JSON.stringify(events.slice(-MAX_EVENTS), null, 2) + '\n'); }
function safeText(value, max=120) { return typeof value === 'string' ? value.slice(0,max) : null; }

function appendEvent({ type, source='runtime', actor_id=null, target_id=null, payload={} } = {}) {
  if (typeof type !== 'string' || !/^[a-z0-9_.-]{3,80}$/i.test(type)) throw new Error('Event type 형식이 올바르지 않습니다.');
  const events = rawEvents();
  const previous = events.at(-1) || null;
  const event = {
    schema:EVENT_STORE_VERSION,
    id:crypto.randomUUID(),
    sequence:(previous?.sequence || 0) + 1,
    at:new Date().toISOString(),
    type,
    source:safeText(source,40) || 'runtime',
    actor_id:safeText(actor_id,80),
    target_id:safeText(target_id,120),
    payload:payload && typeof payload === 'object' && !Array.isArray(payload) ? clone(payload) : {},
  };
  events.push(event); writeEvents(events); return clone(event);
}
function readEvents({ type=null, limit=200, reverse=false } = {}) {
  let events = rawEvents();
  if (type) events = events.filter((event)=>event.type === type);
  const safeLimit = Math.max(1, Math.min(MAX_EVENTS, Number(limit) || 200));
  events = events.slice(-safeLimit);
  if (reverse) events.reverse();
  return clone(events);
}
function resetEventStore() { writeEvents([]); return []; }
function publicEventStore({ limit=100, reverse=true } = {}) {
  const events = readEvents({limit,reverse});
  return {
    version:EVENT_STORE_VERSION,
    layer:'history',
    append_only:true,
    max_events:MAX_EVENTS,
    count:rawEvents().length,
    principle:'Event Store records what happened over time. Current truth is read from State Store, not reconstructed from a single event.',
    events,
  };
}

module.exports = { EVENT_STORE_VERSION, appendEvent, readEvents, resetEventStore, publicEventStore };
