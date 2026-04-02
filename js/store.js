const Store = (() => {
  const DB_NAME = 'steady';
  const DB_VERSION = 2;
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
        } else {
          const store = req.transaction.objectStore(ACTIVITIES_STORE);
          if (!store.indexNames.contains('user_id')) {
            store.createIndex('user_id', 'user_id', { unique: false });
          }
          if (!store.indexNames.contains('start_date')) {
            store.createIndex('start_date', 'start_date', { unique: false });
          }
        }
      };
      req.onsuccess = (e) => { _db = e.target.result; resolve(_db); };
      req.onerror = (e) => reject(e.target.error);
    });
  }

  function getCurrentUserId() {
    const profile = getUserProfile();
    if (!profile || profile.id === undefined || profile.id === null) return null;
    return String(profile.id);
  }

  function scopedKey(baseKey, userId) {
    return userId ? `${baseKey}:${userId}` : baseKey;
  }

  function removeKeysWithPrefix(prefix) {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && key.startsWith(prefix)) {
        localStorage.removeItem(key);
      }
    }
  }

  async function getAllActivities() {
    const db = await openDB();
    const userId = getCurrentUserId();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(ACTIVITIES_STORE, 'readonly');
      const store = tx.objectStore(ACTIVITIES_STORE);
      const req = store.getAll();
      req.onsuccess = () => {
        const all = req.result || [];
        if (!userId) {
          resolve(all);
          return;
        }
        resolve(all.filter(a => String(a.user_id || '') === userId));
      };
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
    const userId = getCurrentUserId();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(ACTIVITIES_STORE, 'readonly');
      const store = tx.objectStore(ACTIVITIES_STORE);
      const req = store.openCursor();
      const ids = new Set();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) {
          resolve(ids);
          return;
        }
        const activity = cursor.value;
        if (!userId || String(activity.user_id || '') === userId) {
          ids.add(activity.strava_id);
        }
        cursor.continue();
      };
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

  async function clearActivitiesForUser(userId) {
    const db = await openDB();
    if (!userId) {
      await clearActivities();
      return;
    }
    return new Promise((resolve, reject) => {
      const tx = db.transaction(ACTIVITIES_STORE, 'readwrite');
      const store = tx.objectStore(ACTIVITIES_STORE);
      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return;
        const activity = cursor.value;
        if (String(activity.user_id || '') === String(userId)) {
          cursor.delete();
        }
        cursor.continue();
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // localStorage helpers for settings and planned runs

  function getSettings() {
    const key = scopedKey('steady_settings', getCurrentUserId());
    try {
      return JSON.parse(localStorage.getItem(key)) || defaultSettings();
    } catch {
      return defaultSettings();
    }
  }

  function saveSettings(settings) {
    const key = scopedKey('steady_settings', getCurrentUserId());
    localStorage.setItem(key, JSON.stringify(settings));
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
    const key = scopedKey('steady_planned_runs', getCurrentUserId());
    try {
      const all = JSON.parse(localStorage.getItem(key)) || {};
      return all[weekKey] || [];
    } catch {
      return [];
    }
  }

  function savePlannedRuns(weekKey, runs) {
    const key = scopedKey('steady_planned_runs', getCurrentUserId());
    try {
      const all = JSON.parse(localStorage.getItem(key)) || {};
      all[weekKey] = runs;
      localStorage.setItem(key, JSON.stringify(all));
    } catch {
      const obj = {};
      obj[weekKey] = runs;
      localStorage.setItem(key, JSON.stringify(obj));
    }
  }

  function getAllPlannedRuns() {
    const key = scopedKey('steady_planned_runs', getCurrentUserId());
    try {
      return JSON.parse(localStorage.getItem(key)) || {};
    } catch {
      return {};
    }
  }

  function getLastSyncTime() {
    const key = scopedKey('steady_last_sync', getCurrentUserId());
    return localStorage.getItem(key) || null;
  }

  function saveLastSyncTime() {
    const key = scopedKey('steady_last_sync', getCurrentUserId());
    localStorage.setItem(key, new Date().toISOString());
  }

  async function migrateLegacyActivitiesToUser(userId) {
    const db = await openDB();
    if (!userId) return;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(ACTIVITIES_STORE, 'readwrite');
      const store = tx.objectStore(ACTIVITIES_STORE);
      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return;
        const activity = cursor.value;
        if (activity.user_id === undefined || activity.user_id === null || activity.user_id === '') {
          activity.user_id = String(userId);
          cursor.update(activity);
        }
        cursor.continue();
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function clearCurrentUserData() {
    const userId = getCurrentUserId();
    await clearActivitiesForUser(userId);
    if (userId) {
      localStorage.removeItem(scopedKey('steady_settings', userId));
      localStorage.removeItem(scopedKey('steady_planned_runs', userId));
      localStorage.removeItem(scopedKey('steady_last_sync', userId));
    } else {
      localStorage.removeItem('steady_settings');
      localStorage.removeItem('steady_planned_runs');
      localStorage.removeItem('steady_last_sync');
      removeKeysWithPrefix('steady_settings:');
      removeKeysWithPrefix('steady_planned_runs:');
      removeKeysWithPrefix('steady_last_sync:');
    }
  }

  async function clearAll() {
    localStorage.removeItem('steady_settings');
    localStorage.removeItem('steady_tokens');
    localStorage.removeItem('steady_user');
    localStorage.removeItem('steady_planned_runs');
    localStorage.removeItem('steady_last_sync');
    removeKeysWithPrefix('steady_settings:');
    removeKeysWithPrefix('steady_planned_runs:');
    removeKeysWithPrefix('steady_last_sync:');
    await clearActivities();
  }

  return {
    getAllActivities,
    putActivity,
    putActivities,
    getActivityIds,
    clearActivities,
    clearActivitiesForUser,
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
    migrateLegacyActivitiesToUser,
    clearCurrentUserData,
    clearAll,
  };
})();
