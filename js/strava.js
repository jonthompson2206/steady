const Strava = (() => {
  const STRAVA_CLIENT_ID = '181272';
  const TOKEN_ENDPOINT = '/api/strava-token';
  const API_BASE = 'https://www.strava.com/api/v3';
  const RUNNING_TYPES = ['Run', 'VirtualRun', 'TrailRun'];

  function getRedirectUri() {
    return window.location.origin + window.location.pathname;
  }

  function login() {
    const redirectUri = getRedirectUri();
    const url = `https://www.strava.com/oauth/authorize?client_id=${STRAVA_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=read,activity:read_all`;
    window.location.href = url;
  }

  function hasAuthCode() {
    const params = new URLSearchParams(window.location.search);
    return params.has('code');
  }

  function getAuthCode() {
    const params = new URLSearchParams(window.location.search);
    return params.get('code');
  }

  function clearAuthCodeFromUrl() {
    const url = new URL(window.location);
    url.searchParams.delete('code');
    url.searchParams.delete('scope');
    url.searchParams.delete('state');
    window.history.replaceState({}, '', url.pathname + url.hash);
  }

  async function exchangeToken(code) {
    const res = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_type: 'authorization_code', code }),
    });
    if (!res.ok) throw new Error('Token exchange failed');
    return res.json();
  }

  async function refreshToken(refreshTokenStr) {
    const res = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: refreshTokenStr }),
    });
    if (!res.ok) throw new Error('Token refresh failed');
    return res.json();
  }

  async function getValidToken() {
    const tokens = Store.getTokens();
    if (!tokens) return null;

    const now = Math.floor(Date.now() / 1000);
    if (tokens.expires_at && tokens.expires_at < now + 300) {
      try {
        const data = await refreshToken(tokens.refresh_token);
        const updated = {
          access_token: data.access_token,
          refresh_token: data.refresh_token,
          expires_at: data.expires_at,
        };
        Store.saveTokens(updated);
        return updated.access_token;
      } catch {
        Store.clearTokens();
        return null;
      }
    }

    return tokens.access_token;
  }

  function isAuthenticated() {
    return Store.getTokens() !== null;
  }

  async function handleCallback() {
    if (!hasAuthCode()) return false;

    const code = getAuthCode();
    clearAuthCodeFromUrl();

    try {
      const data = await exchangeToken(code);
      Store.saveTokens({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_at: data.expires_at,
      });
      if (data.athlete) {
        Store.saveUserProfile({
          id: data.athlete.id,
          firstname: data.athlete.firstname,
          lastname: data.athlete.lastname,
          username: (data.athlete.firstname || '') + ' ' + (data.athlete.lastname || ''),
        });
      }
      return true;
    } catch (err) {
      console.error('OAuth callback failed:', err);
      return false;
    }
  }

  function logout() {
    Store.clearTokens();
    Store.clearUserProfile();
  }

  async function apiFetch(path, params = {}) {
    const token = await getValidToken();
    if (!token) throw new Error('Not authenticated');

    const url = new URL(API_BASE + path);
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }

    console.log('[Strava API]', path, Object.fromEntries(url.searchParams));

    const res = await fetch(url.toString(), {
      headers: { 'Authorization': `Bearer ${token}` },
    });

    if (res.status === 401) {
      Store.clearTokens();
      throw new Error('Authentication expired');
    }

    if (res.status === 429) {
      console.error('[Strava API] Rate limited!');
      throw new Error('Strava rate limit hit. Try again in 15 minutes.');
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error('[Strava API] Error:', res.status, body);
      throw new Error(`Strava API error: ${res.status}`);
    }
    return res.json();
  }

  async function syncActivities(onProgress) {
    const settings = Store.getSettings();
    const hrThreshold = settings.max_heart_rate * (settings.hr_intensity_percent / 100.0);

    const existingIds = await Store.getActivityIds();
    const SIXTEEN_WEEKS_MS = 16 * 7 * 24 * 60 * 60 * 1000;
    const after = Math.floor((Date.now() - SIXTEEN_WEEKS_MS) / 1000);

    console.log('[Sync] Starting sync. Fetching activities after', new Date(after * 1000).toISOString());
    console.log('[Sync] Existing cached activities:', existingIds.size);

    let page = 1;
    let totalAdded = 0;
    let totalSkipped = 0;

    while (true) {
      if (onProgress) onProgress({ status: 'fetching', page, totalAdded });

      let activities;
      try {
        activities = await apiFetch('/athlete/activities', { after, page, per_page: 100 });
      } catch (err) {
        console.error('[Sync] Failed to fetch activities page', page, err);
        break;
      }

      console.log(`[Sync] Page ${page}: received ${activities ? activities.length : 0} activities`);

      if (!activities || activities.length === 0) break;

      const newActivities = [];

      for (const act of activities) {
        const actType = act.sport_type || act.type;
        if (!RUNNING_TYPES.includes(actType)) continue;
        if (existingIds.has(act.id)) {
          totalSkipped++;
          continue;
        }

        const distanceKm = (act.distance || 0) / 1000;
        const movingTime = act.moving_time || 0;
        const avgHr = act.average_heartrate || null;

        const timeAboveThreshold = Calculations.estimateIntensityFromAvgHR(
          avgHr, hrThreshold, movingTime
        );

        const activity = {
          strava_id: act.id,
          name: act.name || 'Run',
          activity_type: actType,
          distance_km: distanceKm,
          moving_time_seconds: movingTime,
          elapsed_time_seconds: act.elapsed_time || 0,
          total_elevation_gain: act.total_elevation_gain || 0,
          average_heartrate: avgHr,
          max_heartrate: act.max_heartrate || null,
          average_power: act.average_watts || null,
          time_above_80_hr: timeAboveThreshold,
          start_date: act.start_date_local || act.start_date,
        };

        newActivities.push(activity);
        existingIds.add(act.id);
        totalAdded++;

        if (onProgress) onProgress({ status: 'processing', page, totalAdded, current: act.name });
      }

      if (newActivities.length > 0) {
        await Store.putActivities(newActivities);
      }

      console.log(`[Sync] Page ${page} done: ${newActivities.length} new, ${totalSkipped} skipped so far`);

      page++;
      if (activities.length < 100) break;
    }

    Store.saveLastSyncTime();
    console.log(`[Sync] Complete. Added: ${totalAdded}, Skipped: ${totalSkipped}`);

    if (onProgress) onProgress({ status: 'complete', totalAdded, totalSkipped });

    return { added: totalAdded, skipped: totalSkipped };
  }

  async function fullResync(onProgress) {
    await Store.clearActivities();
    return syncActivities(onProgress);
  }

  return {
    login,
    handleCallback,
    isAuthenticated,
    logout,
    syncActivities,
    fullResync,
    getValidToken,
    STRAVA_CLIENT_ID,
  };
})();
