/* IndexedDB adapter for Habit System AI.

Mirrors the storage operations provided by core/db.py so the app can run
entirely client-side. Every function returns a Promise.

Schema version 1 — matches core/db.py SCHEMA + all _NEW_COLUMNS migrations.
*/

const habitDB = (() => {
  "use strict";

  const DB_NAME = "habit-system-ai";
  const DB_VERSION = 1;

  // ------------------------------------------------------------------ util

  function nowIso() {
    return new Date().toISOString().slice(0, 19);
  }

  function _get(db, storeName, mode) {
    return db.transaction(storeName, mode).objectStore(storeName);
  }

  function _req(store, method, ...args) {
    return new Promise((resolve, reject) => {
      const req = store[method](...args);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function _reqEvent(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  // Promise wrapper for a whole transaction
  function _tx(db, storeNames, mode, fn) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeNames, mode);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Transaction aborted"));
      try { fn(tx); } catch (e) { tx.abort(); reject(e); }
    });
  }

  // ------------------------------------------------------------------ open

  let _db = null;

  function open() {
    // If _db was set to null (e.g. by onversionchange after db.close()), re-open.
    if (_db) {
      try {
        // A closed IDBDatabase has no objectStoreNames entries.
        if (_db.objectStoreNames && _db.objectStoreNames.length > 0) {
          return Promise.resolve(_db);
        }
      } catch (_) { /* ignore */ }
      _db = null;
    }
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = (event) => {
        const db = event.target.result;

        // habits
        if (!db.objectStoreNames.contains("habits")) {
          const s = db.createObjectStore("habits", { keyPath: "id", autoIncrement: true });
          s.createIndex("identity_id", "identity_id", { unique: false });
          s.createIndex("active", "active", { unique: false });
          s.createIndex("is_demo", "is_demo", { unique: false });
        }

        // events
        if (!db.objectStoreNames.contains("events")) {
          const s = db.createObjectStore("events", { keyPath: "id", autoIncrement: true });
          s.createIndex("habit_id", "habit_id", { unique: false });
          s.createIndex("occurred_at", "occurred_at", { unique: false });
          s.createIndex("is_demo", "is_demo", { unique: false });
          s.createIndex("habit_id_occurred", ["habit_id", "occurred_at"], { unique: false });
        }

        // identities
        if (!db.objectStoreNames.contains("identities")) {
          const s = db.createObjectStore("identities", { keyPath: "id", autoIncrement: true });
          s.createIndex("active", "active", { unique: false });
          s.createIndex("is_demo", "is_demo", { unique: false });
        }

        // obstacles
        if (!db.objectStoreNames.contains("obstacles")) {
          const s = db.createObjectStore("obstacles", { keyPath: "id", autoIncrement: true });
          s.createIndex("habit_id", "habit_id", { unique: false });
        }

        // identity_links
        if (!db.objectStoreNames.contains("identity_links")) {
          const s = db.createObjectStore("identity_links", { keyPath: "id", autoIncrement: true });
          s.createIndex("habit_id", "habit_id", { unique: false });
          s.createIndex("identity_id", "identity_id", { unique: false });
          s.createIndex("habit_identity", ["habit_id", "identity_id"], { unique: true });
        }

        // daily_notes
        if (!db.objectStoreNames.contains("daily_notes")) {
          const s = db.createObjectStore("daily_notes", { keyPath: "id", autoIncrement: true });
          s.createIndex("date", "date", { unique: true });
        }

        // reviews
        if (!db.objectStoreNames.contains("reviews")) {
          const s = db.createObjectStore("reviews", { keyPath: "id", autoIncrement: true });
          s.createIndex("week_start", "week_start", { unique: true });
        }

        // settings
        if (!db.objectStoreNames.contains("settings")) {
          db.createObjectStore("settings", { keyPath: "key" });
        }

        // feedback
        if (!db.objectStoreNames.contains("feedback")) {
          const s = db.createObjectStore("feedback", { keyPath: "id", autoIncrement: true });
          s.createIndex("type", "type", { unique: false });
        }
      };

      req.onsuccess = (event) => {
        _db = event.target.result;
        _db.onversionchange = () => { _db.close(); _db = null; };
      _db.onerror = () => {};
        resolve(_db);
      };
      req.onerror = () => reject(req.error);
    });
  }

  // ------------------------------------------------------------------ habits

  function _habitFromStore(row) {
    if (!row) return null;
    const h = { ...row };
    // frequency_days and reminder_days are stored natively as arrays in IndexedDB
    if (!Array.isArray(h.frequency_days)) h.frequency_days = [];
    if (!Array.isArray(h.reminder_days)) h.reminder_days = [];
    h.active = !!h.active;
    h.reminder_enabled = !!h.reminder_enabled;
    h.is_demo = !!h.is_demo;
    return h;
  }

  async function listHabits(includeInactive) {
    const db = await open();
    const store = _get(db, "habits", "readonly");
    const all = await _req(store, "getAll");
    let result = all.map(_habitFromStore);
    if (!includeInactive) result = result.filter((h) => h.active);
    result.sort((a, b) => (b.active - a.active) || (a.created_at > b.created_at ? 1 : a.created_at < b.created_at ? -1 : 0));
    return result;
  }

  async function getHabit(id) {
    const db = await open();
    const store = _get(db, "habits", "readonly");
    const row = await _req(store, "get", id);
    return _habitFromStore(row);
  }

  async function createHabit(data) {
    const db = await open();
    const ts = nowIso();
    const obj = {
      name: (data.name || "").trim(),
      description: (data.description || "").trim() || null,
      type: data.type || "boolean",
      unit: data.unit || null,
      target_value: data.target_value != null ? data.target_value : null,
      target_unit: data.target_unit || null,
      frequency_type: data.frequency_type || "weekly",
      frequency_target: data.frequency_target != null ? data.frequency_target : 1,
      frequency_days: data.frequency_days || [],
      cue: (data.cue || "").trim() || null,
      reminder_enabled: !!data.reminder_enabled,
      reminder_time: data.reminder_time || null,
      reminder_days: data.reminder_days || [],
      color: data.color || "#4f7cff",
      icon: data.icon || "star",
      start_date: data.start_date || new Date().toISOString().slice(0, 10),
      active: data.active !== undefined ? !!data.active : true,
      is_demo: !!data.is_demo,
      identity_id: data.identity_id != null ? data.identity_id : null,
      minimum_value: data.minimum_value != null ? data.minimum_value : null,
      minimum_unit: (data.minimum_unit || "").trim() || null,
      minimum_description: (data.minimum_description || "").trim() || null,
      environment: (data.environment || "").trim() || null,
      location: (data.location || "").trim() || null,
      attraction_strategy: (data.attraction_strategy || "").trim() || null,
      friction_strategy: (data.friction_strategy || "").trim() || null,
      reward_strategy: (data.reward_strategy || "").trim() || null,
      created_at: ts,
      updated_at: ts,
    };
    const db2 = await open();
    const store = _get(db2, "habits", "readwrite");
    const id = await _req(store, "add", obj);
    return getHabit(id);
  }

  async function updateHabit(id, data) {
    const existing = await getHabit(id);
    if (!existing) return null;
    const merged = { ...existing };
    const stringKeys = [
      "name", "description", "type", "unit", "target_unit", "frequency_type",
      "cue", "color", "icon", "start_date", "reminder_time",
      "minimum_unit", "minimum_description", "environment", "location",
      "attraction_strategy", "friction_strategy", "reward_strategy",
    ];
    for (const key of stringKeys) {
      if (key in data) merged[key] = data[key];
    }
    const numKeys = ["target_value", "frequency_target", "minimum_value"];
    for (const key of numKeys) {
      if (key in data) merged[key] = data[key];
    }
    const arrayKeys = ["frequency_days", "reminder_days"];
    for (const key of arrayKeys) {
      if (key in data) merged[key] = data[key] || [];
    }
    if ("identity_id" in data) merged.identity_id = data.identity_id;
    if ("reminder_enabled" in data) merged.reminder_enabled = !!data.reminder_enabled;
    if ("active" in data) merged.active = !!data.active;
    if ("is_demo" in data) merged.is_demo = !!data.is_demo;
    merged.updated_at = nowIso();
    const db = await open();
    const store = _get(db, "habits", "readwrite");
    await _req(store, "put", merged);
    return getHabit(id);
  }

  async function deleteHabit(id) {
    const db = await open();
    return _tx(db, ["habits", "events", "obstacles", "identity_links"], "readwrite", (tx) => {
      tx.objectStore("habits").delete(id);
      // cascade: events
      const evIdx = tx.objectStore("events").index("habit_id");
      const evReq = evIdx.openCursor(IDBKeyRange.only(id));
      evReq.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) { cursor.delete(); cursor.continue(); }
      };
      // cascade: obstacles
      const obIdx = tx.objectStore("obstacles").index("habit_id");
      const obReq = obIdx.openCursor(IDBKeyRange.only(id));
      obReq.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) { cursor.delete(); cursor.continue(); }
      };
      // cascade: identity_links
      const ilIdx = tx.objectStore("identity_links").index("habit_id");
      const ilReq = ilIdx.openCursor(IDBKeyRange.only(id));
      ilReq.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) { cursor.delete(); cursor.continue(); }
      };
    });
  }

  // ------------------------------------------------------------ identities

  function _identityFromStore(row) {
    if (!row) return null;
    const i = { ...row };
    i.active = !!i.active;
    i.is_demo = !!i.is_demo;
    return i;
  }

  async function listIdentities(includeInactive) {
    const db = await open();
    const store = _get(db, "identities", "readonly");
    const all = await _req(store, "getAll");
    let result = all.map(_identityFromStore);
    if (!includeInactive) result = result.filter((i) => i.active);
    result.sort((a, b) => (b.active - a.active) || (a.created_at > b.created_at ? 1 : a.created_at < b.created_at ? -1 : 0));
    return result;
  }

  async function getIdentity(id) {
    const db = await open();
    const store = _get(db, "identities", "readonly");
    const row = await _req(store, "get", id);
    return _identityFromStore(row);
  }

  async function createIdentity(data) {
    const ts = nowIso();
    const obj = {
      name: (data.name || "").trim(),
      description: (data.description || "").trim() || null,
      icon: data.icon || "star",
      color: data.color || "#4f7cff",
      active: data.active !== undefined ? !!data.active : true,
      is_demo: !!data.is_demo,
      created_at: ts,
      updated_at: ts,
    };
    const db = await open();
    const store = _get(db, "identities", "readwrite");
    const id = await _req(store, "add", obj);
    return getIdentity(id);
  }

  async function updateIdentity(id, data) {
    const existing = await getIdentity(id);
    if (!existing) return null;
    const merged = { ...existing };
    for (const key of ["name", "description", "icon", "color"]) {
      if (key in data) merged[key] = data[key];
    }
    if ("active" in data) merged.active = !!data.active;
    if ("is_demo" in data) merged.is_demo = !!data.is_demo;
    merged.updated_at = nowIso();
    const db = await open();
    const store = _get(db, "identities", "readwrite");
    await _req(store, "put", merged);
    return getIdentity(id);
  }

  async function deleteIdentity(id) {
    const existing = await getIdentity(id);
    if (!existing) return false;
    // Cascade: unlink habits that reference this identity
    const db = await open();
    await _tx(db, ["habits", "identity_links", "identities"], "readwrite", (tx) => {
      // Update habits: set identity_id = null
      const habStore = tx.objectStore("habits");
      const habIdx = habStore.index("identity_id");
      const habReq = habIdx.openCursor(IDBKeyRange.only(id));
      habReq.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          const updated = { ...cursor.value, identity_id: null, updated_at: nowIso() };
          cursor.update(updated);
          cursor.continue();
        }
      };
      // Delete identity_links
      const ilIdx = tx.objectStore("identity_links").index("identity_id");
      const ilReq = ilIdx.openCursor(IDBKeyRange.only(id));
      ilReq.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) { cursor.delete(); cursor.continue(); }
      };
      // Delete the identity itself
      tx.objectStore("identities").delete(id);
    });
    return true;
  }

  // --------------------------------------------------------- events

  function _eventFromStore(row) {
    if (!row) return null;
    return { ...row };
  }

  async function listEvents(habitId, options) {
    const { limit, offset, includeDemo } = options || {};
    const db = await open();
    const store = _get(db, "events", "readonly");
    let rows;
    if (habitId != null) {
      const idx = store.index("habit_id");
      rows = await _req(idx, "getAll", IDBKeyRange.only(habitId));
    } else {
      rows = await _req(store, "getAll");
    }
    if (includeDemo === false) rows = rows.filter((r) => !r.is_demo);
    rows.sort((a, b) => (b.occurred_at > a.occurred_at ? 1 : b.occurred_at < a.occurred_at ? -1 : (b.id - a.id)));
    if (offset) rows = rows.slice(offset);
    if (limit) rows = rows.slice(0, limit);
    return rows.map(_eventFromStore);
  }

  async function listEventsSince(habitId, sinceIso, includeDemo) {
    const db = await open();
    const store = _get(db, "events", "readonly");
    const idx = store.index("habit_id_occurred");
    const range = IDBKeyRange.bound([habitId, sinceIso], [habitId, "\uffff"]);
    let rows = await _req(idx, "getAll", range);
    if (includeDemo === false) rows = rows.filter((r) => !r.is_demo);
    rows.sort((a, b) => (a.occurred_at > b.occurred_at ? 1 : a.occurred_at < b.occurred_at ? -1 : (a.id - b.id)));
    return rows.map(_eventFromStore);
  }

  async function createEvent(habitId, occurredAt, options) {
    const { value, unit, duration, notes, isDemo, isMinimum } = options || {};
    const ts = nowIso();
    const obj = {
      habit_id: habitId,
      occurred_at: occurredAt,
      value: value != null ? value : null,
      unit: unit || null,
      duration: duration != null ? duration : null,
      notes: notes || null,
      is_demo: !!isDemo,
      is_minimum: !!isMinimum,
      created_at: ts,
    };
    const db = await open();
    const store = _get(db, "events", "readwrite");
    const id = await _req(store, "add", obj);
    return getEvent(id);
  }

  async function getEvent(id) {
    const db = await open();
    const store = _get(db, "events", "readonly");
    const row = await _req(store, "get", id);
    return _eventFromStore(row);
  }

  async function updateEvent(id, data) {
    const existing = await getEvent(id);
    if (!existing) return null;
    const merged = { ...existing };
    if ("occurred_at" in data) merged.occurred_at = data.occurred_at;
    if ("value" in data) merged.value = data.value;
    if ("unit" in data) merged.unit = data.unit;
    if ("duration" in data) merged.duration = data.duration;
    if ("notes" in data) merged.notes = data.notes;
    if ("is_minimum" in data) merged.is_minimum = !!data.is_minimum;
    const db = await open();
    const store = _get(db, "events", "readwrite");
    await _req(store, "put", merged);
    return getEvent(id);
  }

  async function deleteEvent(id) {
    const db = await open();
    const store = _get(db, "events", "readwrite");
    const existing = await _req(store, "get", id);
    if (!existing) return false;
    await _req(store, "delete", id);
    return true;
  }

  async function habitEventCount(habitId) {
    const db = await open();
    const store = _get(db, "events", "readonly");
    const idx = store.index("habit_id");
    return _req(idx, "count", IDBKeyRange.only(habitId));
  }

  // ------------------------------------------------------- identity_links

  function _linkFromStore(row) {
    if (!row) return null;
    return { ...row };
  }

  async function listIdentityLinks(habitId, identityId) {
    const db = await open();
    const store = _get(db, "identity_links", "readonly");
    let rows;
    if (habitId != null) {
      const idx = store.index("habit_id");
      rows = await _req(idx, "getAll", IDBKeyRange.only(habitId));
    } else if (identityId != null) {
      const idx = store.index("identity_id");
      rows = await _req(idx, "getAll", IDBKeyRange.only(identityId));
    } else {
      rows = await _req(store, "getAll");
    }
    rows.sort((a, b) => (a.id - b.id));
    return rows.map(_linkFromStore);
  }

  async function getIdentityLink(habitId, identityId) {
    const db = await open();
    const store = _get(db, "identity_links", "readonly");
    const idx = store.index("habit_identity");
    const row = await _req(idx, "get", [habitId, identityId]);
    return _linkFromStore(row);
  }

  async function setIdentityLink(habitId, identityId, status, source, confidence) {
    const ts = nowIso();
    const existing = await getIdentityLink(habitId, identityId);
    const db = await open();
    const store = _get(db, "identity_links", "readwrite");
    if (existing) {
      const merged = {
        ...existing,
        status: status || "linked",
        source: source || "semantic",
        confidence: confidence != null ? confidence : null,
        updated_at: ts,
      };
      await _req(store, "put", merged);
    } else {
      const obj = {
        habit_id: habitId,
        identity_id: identityId,
        status: status || "linked",
        source: source || "semantic",
        confidence: confidence != null ? confidence : null,
        created_at: ts,
        updated_at: ts,
      };
      await _req(store, "add", obj);
    }
    return getIdentityLink(habitId, identityId);
  }

  async function deleteIdentityLink(habitId, identityId) {
    const existing = await getIdentityLink(habitId, identityId);
    if (!existing) return false;
    const db = await open();
    const store = _get(db, "identity_links", "readwrite");
    await _req(store, "delete", existing.id);
    return true;
  }

  // ---------------------------------------------------- obstacles

  function _obstacleFromStore(row) {
    if (!row) return null;
    return { ...row };
  }

  async function createObstacle(habitId, obstacle, note, type) {
    const ts = nowIso();
    const obj = {
      habit_id: habitId,
      obstacle: obstacle,
      note: (note || "").trim() || null,
      type: (type || "").trim() || null,
      created_at: ts,
    };
    const db = await open();
    const store = _get(db, "obstacles", "readwrite");
    const id = await _req(store, "add", obj);
    const row = await _req(_get(db, "obstacles", "readonly"), "get", id);
    return _obstacleFromStore(row);
  }

  async function listObstacles(habitId, limit) {
    limit = limit || 10;
    const db = await open();
    const store = _get(db, "obstacles", "readonly");
    let rows;
    if (habitId != null) {
      const idx = store.index("habit_id");
      rows = await _req(idx, "getAll", IDBKeyRange.only(habitId));
    } else {
      rows = await _req(store, "getAll");
    }
    rows.sort((a, b) => (b.id - a.id));
    return rows.slice(0, limit).map(_obstacleFromStore);
  }

  async function obstacleCounts(habitId) {
    const obstacles = await listObstacles(habitId, 1000);
    const map = {};
    for (const o of obstacles) {
      map[o.obstacle] = (map[o.obstacle] || 0) + 1;
    }
    return Object.entries(map)
      .map(([obstacle, count]) => ({ obstacle, count }))
      .sort((a, b) => b.count - a.count || a.obstacle.localeCompare(b.obstacle));
  }

  async function mainObstacle(habitId, minRecords) {
    minRecords = minRecords || 3;
    const counts = await obstacleCounts(habitId);
    if (counts.length === 0) return null;
    const top = counts[0];
    if (top.count < minRecords) return null;
    const second = counts.length > 1 ? counts[1].count : 0;
    if (top.count <= second) return null;
    return { obstacle: top.obstacle, count: top.count };
  }

  // --------------------------------------------------- daily_notes

  function _noteFromStore(row) {
    if (!row) return null;
    return { ...row };
  }

  async function getDailyNote(date) {
    const db = await open();
    const store = _get(db, "daily_notes", "readonly");
    const idx = store.index("date");
    const row = await _req(idx, "get", date);
    return _noteFromStore(row);
  }

  async function saveDailyNote(date, content) {
    const ts = nowIso();
    const db = await open();
    const store = _get(db, "daily_notes", "readwrite");
    const idx = store.index("date");
    const existing = await _req(idx, "get", date);
    if (existing) {
      const merged = { ...existing, content, updated_at: ts };
      await _req(store, "put", merged);
    } else {
      const obj = { date, content, created_at: ts, updated_at: ts };
      await _req(store, "add", obj);
    }
    return getDailyNote(date);
  }

  // --------------------------------------------------- reviews

  async function saveReviewAnswer(weekStart, answer) {
    const ts = nowIso();
    const db = await open();
    const store = _get(db, "reviews", "readwrite");
    const idx = store.index("week_start");
    const existing = await _req(idx, "get", weekStart);
    if (existing) {
      const merged = { ...existing, answer: (answer || "").trim() || null, updated_at: ts };
      await _req(store, "put", merged);
    } else {
      const obj = { week_start: weekStart, answer: (answer || "").trim() || null, created_at: ts, updated_at: ts };
      await _req(store, "add", obj);
    }
    return getReviewAnswer(weekStart);
  }

  async function getReviewAnswer(weekStart) {
    const db = await open();
    const store = _get(db, "reviews", "readonly");
    const idx = store.index("week_start");
    const row = await _req(idx, "get", weekStart);
    return row ? { ...row } : null;
  }

  // --------------------------------------------------- settings

  async function getSetting(key) {
    const db = await open();
    const store = _get(db, "settings", "readonly");
    const row = await _req(store, "get", key);
    return row ? row.value : null;
  }

  async function setSetting(key, value) {
    const db = await open();
    const store = _get(db, "settings", "readwrite");
    if (value == null || String(value).trim() === "") {
      await _req(store, "delete", key);
    } else {
      const ts = nowIso();
      await _req(store, "put", { key, value: String(value).trim(), updated_at: ts });
    }
  }

  // --------------------------------------------------- feedback

  async function createFeedback(type, message, technicalInfo) {
    const ts = nowIso();
    const obj = {
      type,
      message,
      technical_info: technicalInfo || null,
      created_at: ts,
    };
    const db = await open();
    const store = _get(db, "feedback", "readwrite");
    const id = await _req(store, "add", obj);
    const row = await _req(_get(db, "feedback", "readonly"), "get", id);
    return row ? { ...row } : null;
  }

  async function listFeedback(limit) {
    limit = limit || 50;
    const db = await open();
    const store = _get(db, "feedback", "readonly");
    const all = await _req(store, "getAll");
    all.sort((a, b) => (b.id - a.id));
    return all.slice(0, limit).map((r) => ({ ...r }));
  }

  // ------------------------------------------------ bulk operations

  async function identityHabitCount(identityId) {
    const db = await open();
    const store = _get(db, "habits", "readonly");
    const idx = store.index("identity_id");
    return _req(idx, "count", IDBKeyRange.only(identityId));
  }

  async function identityEvents(identityId, sinceIso, includeDemo) {
    sinceIso = sinceIso || "1970-01-01T00:00";
    // Get all habits for this identity, then all events for those habits
    const db = await open();
    const habStore = _get(db, "habits", "readonly");
    const habIdx = habStore.index("identity_id");
    const habits = await _req(habIdx, "getAll", IDBKeyRange.only(identityId));
    const habitIds = habits.map((h) => h.id);
    if (habitIds.length === 0) return [];

    const evStore = _get(db, "events", "readonly");
    const evIdx = evStore.index("habit_id");
    let allEvents = [];
    for (const hid of habitIds) {
      const evts = await _req(evIdx, "getAll", IDBKeyRange.only(hid));
      allEvents = allEvents.concat(evts);
    }
    allEvents = allEvents.filter((e) => e.occurred_at >= sinceIso);
    if (includeDemo === false) allEvents = allEvents.filter((e) => !e.is_demo && !e._is_demo);
    allEvents.sort((a, b) => (a.occurred_at > b.occurred_at ? 1 : a.occurred_at < b.occurred_at ? -1 : (a.id - b.id)));
    return allEvents.map(_eventFromStore);
  }

  async function hasAnyHabit() {
    const db = await open();
    const store = _get(db, "habits", "readonly");
    const count = await _req(store, "count");
    return count > 0;
  }

  // --------------------------------------------------- demo data

  async function deleteDemoData() {
    const db = await open();
    const result = { habits_deleted: 0, events_deleted: 0 };

    // Delete demo events
    await _tx(db, ["events"], "readwrite", (tx) => {
      const idx = tx.objectStore("events").index("is_demo");
      const req = idx.openCursor(IDBKeyRange.only(1));
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          cursor.delete();
          result.events_deleted++;
          cursor.continue();
        }
      };
    });

    // Get demo habit IDs
    const db2 = await open();
    const habStore = _get(db2, "habits", "readonly");
    const demoIdx = habStore.index("is_demo");
    const demoHabits = await _req(demoIdx, "getAll", IDBKeyRange.only(1));
    const demoHabitIds = new Set(demoHabits.map((h) => h.id));
    const demoIdentityIds = new Set();

    // Delete demo obstacles, identity_links
    await _tx(db2, ["obstacles", "identity_links"], "readwrite", (tx) => {
      const obStore = tx.objectStore("obstacles");
      const obReq = obStore.openCursor();
      obReq.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          if (demoHabitIds.has(cursor.value.habit_id)) cursor.delete();
          cursor.continue();
        }
      };
      const ilStore = tx.objectStore("identity_links");
      const ilReq = ilStore.openCursor();
      ilReq.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          if (demoHabitIds.has(cursor.value.habit_id)) {
            demoIdentityIds.add(cursor.value.identity_id);
            cursor.delete();
          } else {
            cursor.continue();
          }
        }
      };
    });

    // Delete demo habits
    const db3 = await open();
    await _tx(db3, ["habits"], "readwrite", (tx) => {
      const store = tx.objectStore("habits");
      const req = store.openCursor();
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          if (cursor.value.is_demo) {
            cursor.delete();
            result.habits_deleted++;
          }
          cursor.continue();
        }
      };
    });

    // Delete demo identities
    const db4 = await open();
    await _tx(db4, ["identities"], "readwrite", (tx) => {
      const store = tx.objectStore("identities");
      const req = store.openCursor();
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          if (cursor.value.is_demo) cursor.delete();
          cursor.continue();
        }
      };
    });

    return result;
  }

  // --------------------------------------------------- reset

  async function resetAllData() {
    const db = await open();
    await _tx(db, ["events", "obstacles", "reviews", "daily_notes", "identity_links", "habits", "identities"], "readwrite", (tx) => {
      tx.objectStore("events").clear();
      tx.objectStore("obstacles").clear();
      tx.objectStore("reviews").clear();
      tx.objectStore("daily_notes").clear();
      tx.objectStore("identity_links").clear();
      tx.objectStore("habits").clear();
      tx.objectStore("identities").clear();
    });
    // Note: IndexedDB auto-increment resets when the object store is cleared.
  }

  // --------------------------------------------------- public API

  return {
    open,

    // Habits
    listHabits,
    getHabit,
    createHabit,
    updateHabit,
    deleteHabit,

    // Identities
    listIdentities,
    getIdentity,
    createIdentity,
    updateIdentity,
    deleteIdentity,

    // Events
    listEvents,
    listEventsSince,
    createEvent,
    getEvent,
    updateEvent,
    deleteEvent,
    habitEventCount,

    // Identity links
    listIdentityLinks,
    getIdentityLink,
    setIdentityLink,
    deleteIdentityLink,

    // Obstacles
    createObstacle,
    listObstacles,
    obstacleCounts,
    mainObstacle,

    // Daily notes
    getDailyNote,
    saveDailyNote,

    // Reviews
    saveReviewAnswer,
    getReviewAnswer,

    // Settings
    getSetting,
    setSetting,

    // Feedback
    createFeedback,
    listFeedback,

    // Bulk
    identityHabitCount,
    identityEvents,
    hasAnyHabit,

    // Demo / reset
    deleteDemoData,
    resetAllData,

    // Expose for testing
    _nowIso: nowIso,
    _getDb: () => _db,
    _setDb: (v) => { _db = v; },
    close: () => { if (_db) { try { _db.close(); } catch (_) {} _db = null; } },
  };
})();
