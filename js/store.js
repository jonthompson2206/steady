const Store = (() => {
  const DB_NAME = 'steady';
  const DB_VERSION = 1;
  const ACTIVITIES_STORE = 'activities';

  let _db = null;

  function openDB() {
    if (_db) return Promise.resolve(_db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(ACTIVITIES_STORE)) {
          const store = db.createObjectStore(ACTIVITIES_STORE, { keyPath: 'strava_id' });
          store.createIndex('user_id', 'user_id', { unique: false });
          store.createIndex('start_date', 'start_date', { unique: false });
        }
      };
      req.onsuccess = (e) => { _db = e.target.result; resolve(_db); };
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async function getAllActivities() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(ACTIVITIES_STORE, 'readonly');
      const store = tx.objectStore(ACTIVITIES_STORE);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function putActivity(activity) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(ACTIVITIES_STORE, 'readwrite');
      const store = tx.objectStore(ACTIVITIES_STORE);
      store.put(activity);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function putActivities(activities) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(ACTIVITIES_STORE, 'readwrite');
      const store = tx.objectStore(ACTIVITIES_STORE);
      for (const a of activities) store.put(a);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function getActivityIds() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(ACTIVITIES_STORE, 'readonly');
      const store = tx.objectStore(ACTIVITIES_STORE);
      const req = store.getAllKeys();
      req.onsuccess = () => resolve(new Set(req.result));
      req.onerror = () => reject(req.error);
    });
  }

  async function clearActivities() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(ACTIVITIES_STORE, 'readwrite');
      const store = tx.objectStore(ACTIVITIES_STORE);
      store.clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // localStorage helpers for settings and planned runs

  function getSettings() {
    try {
      return JSON.parse(localStorage.getItem('steady_settings')) || defaultSettings();
    } catch {
      return defaultSettings();
    }
  }

  function saveSettings(settings) {
    localStorage.setItem('steady_settings', JSON.stringify(settings));
  }

  function defaultSettings() {
    return {
      max_heart_rate: 190,
      hr_intensity_percent: 80.0,
      race_type: null,
      race_time_seconds: null,
    };
  }

  function getTokens() {
    try {
      return JSON.parse(localStorage.getItem('steady_tokens')) || null;
    } catch {
      return null;
    }
  }

  function saveTokens(tokens) {
    localStorage.setItem('steady_tokens', JSON.stringify(tokens));
  }

  function clearTokens() {
    localStorage.removeItem('steady_tokens');
  }

  function getUserProfile() {
    try {
      return JSON.parse(localStorage.getItem('steady_user')) || null;
    } catch {
      return null;
    }
  }

  function saveUserProfile(profile) {
    localStorage.setItem('steady_user', JSON.stringify(profile));
  }

  function clearUserProfile() {
    localStorage.removeItem('steady_user');
  }

  // Planned runs stored as JSON array keyed by week start date
  function getPlannedRuns(weekKey) {
    try {
      const all = JSON.parse(localStorage.getItem('steady_planned_runs')) || {};
      return all[weekKey] || [];
    } catch {
      return [];
    }
  }

  function savePlannedRuns(weekKey, runs) {
    try {
      const all = JSON.parse(localStorage.getItem('steady_planned_runs')) || {};
      all[weekKey] = runs;
      localStorage.setItem('steady_planned_runs', JSON.stringify(all));
    } catch {
      const obj = {};
      obj[weekKey] = runs;
      localStorage.setItem('steady_planned_runs', JSON.stringify(obj));
    }
  }

  function getAllPlannedRuns() {
    try {
      return JSON.parse(localStorage.getItem('steady_planned_runs')) || {};
    } catch {
      return {};
    }
  }

  function getLastSyncTime() {
    return localStorage.getItem('steady_last_sync') || null;
  }

  function saveLastSyncTime() {
    localStorage.setItem('steady_last_sync', new Date().toISOString());
  }

  async function clearAll() {
    localStorage.removeItem('steady_settings');
    localStorage.removeItem('steady_tokens');
    localStorage.removeItem('steady_user');
    localStorage.removeItem('steady_planned_runs');
    localStorage.removeItem('steady_last_sync');
    await clearActivities();
  }

  return {
    getAllActivities,
    putActivity,
    putActivities,
    getActivityIds,
    clearActivities,
    getSettings,
    saveSettings,
    getTokens,
    saveTokens,
    clearTokens,
    getUserProfile,
    saveUserProfile,
    clearUserProfile,
    getPlannedRuns,
    savePlannedRuns,
    getAllPlannedRuns,
    getLastSyncTime,
    saveLastSyncTime,
    clearAll,
  };
})();
