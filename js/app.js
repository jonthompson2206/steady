const App = (() => {
  let currentView = null;
  let chartPeriod = 13;
  let chartMetric = 'volume';

  async function init() {
    const authed = await Strava.handleCallback();
    if (authed) {
      window.location.hash = '#/dashboard';
      window.addEventListener('hashchange', route);
      route();
      await sync();
      return;
    }

    window.addEventListener('hashchange', route);
    route();
  }

  function route() {
    const hash = window.location.hash || '#/';
    const authenticated = Strava.isAuthenticated();

    updateNav(authenticated);

    if (hash.startsWith('#/dashboard') && authenticated) {
      showDashboard();
    } else if (hash.startsWith('#/plan') && authenticated) {
      showPlan(hash);
    } else if (hash.startsWith('#/settings') && authenticated) {
      showSettings();
    } else if (authenticated) {
      window.location.hash = '#/dashboard';
    } else {
      showLanding();
    }
  }

  function updateNav(authenticated) {
    const navLinks = document.getElementById('navLinks');
    if (!navLinks) return;
    navLinks.style.display = authenticated ? '' : 'none';
  }

  // =========================================================================
  // Landing
  // =========================================================================
  function showLanding() {
    currentView = 'landing';
    Charts.destroyAll();
    const main = document.getElementById('mainContent');
    main.innerHTML = `
      <div class="hero">
        <div class="hero-content">
          <img src="static/steady-logo.png" alt="Steady" class="hero-logo">
          <h1 class="hero-title">
            <span class="hero-title-line">Train Smarter.</span>
            <span class="hero-title-line">Stay <span class="accent">Injury-Free</span>.</span>
          </h1>
          <p class="hero-subtitle">
            Steady helps injury-prone runners manage training volume with the proven
            <span class="mono-highlight">25% rule</span> on a weighted 12-week basis.
          </p>
          <div class="hero-features">
            <div class="feature"><span class="feature-icon">◈</span><span class="feature-text">Weighted 12-week volume tracking</span></div>
            <div class="feature"><span class="feature-icon">◈</span><span class="feature-text">Intensity monitoring via heart rate</span></div>
            <div class="feature"><span class="feature-icon">◈</span><span class="feature-text">Weekly planning with recommendations</span></div>
            <div class="feature"><span class="feature-icon">◈</span><span class="feature-text">Historical compliance tracking</span></div>
          </div>
          <button onclick="Strava.login()" class="btn btn--primary btn--large">
            <svg class="strava-icon" viewBox="0 0 24 24" fill="currentColor">
              <path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169"/>
            </svg>
            Connect with Strava
          </button>
          <p class="hero-note">Syncs your running data automatically. We only read activity data.</p>
        </div>
        <div class="hero-visual">
          <div class="visual-card">
            <div class="visual-header">
              <span class="visual-label">This Week</span>
              <span class="visual-status status--safe">On Track</span>
            </div>
            <div class="visual-metric">
              <span class="metric-value">32.4</span>
              <span class="metric-unit">km</span>
            </div>
            <div class="visual-bar">
              <div class="bar-fill" style="width: 72%"></div>
              <div class="bar-limit"></div>
            </div>
            <div class="visual-context"><span>Max recommended: 45.0 km</span></div>
          </div>
        </div>
      </div>
      <section class="how-it-works">
        <h2 class="section-title">How the 25% Rule Works</h2>
        <div class="rule-explanation">
          <div class="rule-step"><div class="step-number">01</div><div class="step-content"><h3>Track Your Volume</h3><p>We sync your running data from Strava and calculate your weekly distance in kilometers.</p></div></div>
          <div class="rule-step"><div class="step-number">02</div><div class="step-content"><h3>Calculate Weighted Average</h3><p>Your weighted average is computed from the past 12 weeks, with recent weeks counting more.</p></div></div>
          <div class="rule-step"><div class="step-number">03</div><div class="step-content"><h3>Set Your Limit</h3><p>This week's maximum is your weighted 12-week average plus 25%. Never increase more than that.</p></div></div>
          <div class="rule-step"><div class="step-number">04</div><div class="step-content"><h3>Run Safely</h3><p>Plan your week and get recommendations on how far to run while staying within safe limits.</p></div></div>
        </div>
      </section>`;
  }

  // =========================================================================
  // Dashboard
  // =========================================================================
  async function showDashboard() {
    currentView = 'dashboard';
    Charts.destroyAll();
    const main = document.getElementById('mainContent');
    const user = Store.getUserProfile();
    const firstName = user ? (user.firstname || 'Runner') : 'Runner';
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

    main.innerHTML = `
      <div class="dashboard">
        <header class="dash-header">
          <div class="dash-greeting">
            <h1>Hey, ${esc(firstName)}</h1>
            <p class="dash-date">${dateStr}</p>
          </div>
        </header>
        <div id="dashContent"><div class="loading-state"><p>Loading your data...</p></div></div>
      </div>`;

    const activities = await Store.getAllActivities();
    console.log('[Dashboard] Activities loaded from store:', activities.length);
    const data = Calculations.calculateRecommendations(activities);
    console.log('[Dashboard] Recommendations:', { has_enough_data: data.has_enough_data, weeks_needed: data.weeks_needed, weekly_stats_count: data.weekly_stats?.length });
    const nextWeek = Calculations.calculateNextWeekPreview(data);

    const dc = document.getElementById('dashContent');
    if (!dc) return;

    if (!data.has_enough_data) {
      console.log('[Dashboard] Not enough data, showing empty state');
      dc.innerHTML = renderEmptyState(data, activities);
      return;
    }

    const trendData = Calculations.buildVolumeTrendData(data.weekly_stats);

    dc.innerHTML = renderThisWeek(data) +
      renderVolumeTrend(trendData) +
      renderLastWeek(data) +
      renderNextWeekPreview(nextWeek);

    if (trendData) {
      Charts.renderVolumeTrendChart('volumeTrendChart', trendData);
    }
  }

  function renderEmptyState(data, activities) {
    const lastSync = Store.getLastSyncTime();
    const syncInfo = lastSync ? `Last sync: ${new Date(lastSync).toLocaleString()}` : '';
    let recentWeeks = '';
    if (data.weekly_stats && data.weekly_stats.length > 0) {
      recentWeeks = `<section class="section"><h2 class="section-header">Your Recent Weeks</h2><div class="week-grid">` +
        data.weekly_stats.slice(0, 4).map(w => `
          <div class="week-card ${w.is_current ? 'week-card--current' : ''}">
            <div class="week-label">${w.week_label}</div>
            <div class="week-distance">${w.distance_km} <span class="unit">km</span></div>
            <div class="week-runs">${w.run_count} runs</div>
          </div>`).join('') +
        `</div></section>`;
    }
    return `
      <div class="empty-state">
        <div class="empty-icon">◎</div>
        <h2>Building Your Baseline</h2>
        <p>We need at least 12 weeks of running data to calculate safe recommendations.</p>
        <p class="empty-detail">${data.weeks_needed || ''} more week(s) of data needed.</p>
        <button onclick="App.sync()" class="btn btn--secondary">Sync Latest Activities</button>
        <p class="empty-detail" style="margin-top:8px">${syncInfo}</p>
      </div>${recentWeeks}`;
  }

  function renderMetricCard(label, current, max, unit, percent, increase, remaining, remainingUnit) {
    const pctClass = percent > 100 ? 'over' : (percent > 90 ? 'warning' : '');

    let fill, limit;
    if (percent > 100) { fill = 100; limit = (10000 / percent); }
    else { fill = percent; limit = 100; }

    const remainingText = remaining < 0
      ? `${Math.abs(remaining)} ${remainingUnit} over limit`
      : `${remaining} ${remainingUnit} remaining`;

    return `
      <div class="metric-card">
        <div class="metric-header">
          <span class="metric-label">${label}</span>
          <span class="metric-percent ${pctClass}">${percent}%</span>
        </div>
        <div class="metric-values">
          <span class="metric-current">${current}</span>
          <span class="metric-divider">/</span>
          <span class="metric-max">${max}</span>
          <span class="metric-unit">${unit}</span>
        </div>
        <div class="progress-bar">
          <div class="progress-fill ${pctClass}" style="width: ${fill}%"></div>
          <div class="progress-limit" style="left: ${limit}%"></div>
        </div>
        <div class="metric-remaining">${remainingText}</div>
      </div>`;
  }

  function renderPreviewCard(label, value, unit, percentLabel, avgText) {
    return `
      <div class="metric-card">
        <div class="metric-header">
          <span class="metric-label">${label}</span>
          <span class="metric-percent">${percentLabel}</span>
        </div>
        <div class="metric-values">
          <span class="metric-current">${value}</span>
          <span class="metric-unit">${unit} max</span>
        </div>
        <div class="progress-bar">
          <div class="progress-fill" style="width: 0%"></div>
          <div class="progress-limit" style="left: 100%"></div>
        </div>
        <div class="metric-remaining">${avgText}</div>
      </div>`;
  }

  function renderReviewCard(label, actual, max, unit, percent, increase) {
    const pctClass = percent > 100 ? 'over' : (percent > 90 ? 'warning' : '');

    let fill, limit;
    if (percent > 100) { fill = 100; limit = (10000 / percent); }
    else { fill = percent; limit = 100; }

    const diff = unit === 'min' ? Math.round(max - actual) : Math.round((max - actual) * 10) / 10;
    const remainingText = diff < 0
      ? `${Math.abs(diff)} ${unit} over limit`
      : `${diff} ${unit} under limit`;

    return `
      <div class="metric-card">
        <div class="metric-header">
          <span class="metric-label">${label}</span>
          <span class="metric-percent ${pctClass}">${percent}%</span>
        </div>
        <div class="metric-values">
          <span class="metric-current">${actual}</span>
          <span class="metric-divider">/</span>
          <span class="metric-max">${max}</span>
          <span class="metric-unit">${unit}</span>
        </div>
        <div class="progress-bar">
          <div class="progress-fill ${pctClass}" style="width: ${fill}%"></div>
          <div class="progress-limit" style="left: ${limit}%"></div>
        </div>
        <div class="metric-remaining">${remainingText}</div>
      </div>`;
  }

  function renderIntensityError() {
    return `
      <div class="metric-card metric-card--error">
        <div class="metric-header">
          <span class="metric-label">Intensity</span>
        </div>
        <div class="metric-error">
          <p>Set your <a href="#/settings">Max Heart Rate</a> in Settings to enable intensity tracking.</p>
        </div>
      </div>`;
  }

  function isHeartRateConfigured() {
    const settings = Store.getSettings();
    return settings.max_heart_rate !== null && settings.max_heart_rate > 0;
  }

  function renderThisWeek(data) {
    const d = data;
    const hrConfigured = isHeartRateConfigured();
    return `
      <section class="section">
        <h2 class="section-header">This Week's Progress</h2>
        <div class="metrics-grid">
          ${renderMetricCard('Volume', d.current_week.distance_km, d.max_this_week.distance_km, 'km',
            d.progress.distance_percent, d.current_week_increase.distance_increase,
            d.remaining.distance_km, 'km')}
          ${hrConfigured
            ? renderMetricCard('Intensity', d.current_week.intensity_minutes, d.max_this_week.intensity_minutes, 'min',
                d.progress.intensity_percent, d.current_week_increase.intensity_increase,
                d.remaining.intensity_minutes, 'min')
            : renderIntensityError()}
          ${renderMetricCard('Long Run', d.current_week.long_run_km, d.max_this_week.long_run_km, 'km',
            d.progress.long_run_percent, d.current_week_increase.long_run_increase,
            d.remaining.long_run_km, 'km')}
        </div>
        <div class="week-context">
          <div class="context-item"><span class="context-label">Weighted avg volume</span><span class="context-value">${d.rolling_average.distance_km} km</span></div>
          ${hrConfigured ? `<div class="context-item"><span class="context-label">Weighted avg intensity</span><span class="context-value">${d.rolling_average.intensity_minutes} min</span></div>` : ''}
          <div class="context-item"><span class="context-label">Weighted avg long run</span><span class="context-value">${d.rolling_average.long_run_km} km</span></div>
        </div>
      </section>`;
  }

  function renderVolumeTrend(trendData) {
    if (!trendData) return '';
    return `
      <section class="section">
        <h2 class="section-header">Volume Trend & Projection</h2>
        <p class="section-subtitle">12-week weighted average with 4-week forward projection assuming targets are met</p>
        <div class="chart-container">
          <canvas id="volumeTrendChart"></canvas>
        </div>
      </section>`;
  }

  function renderLastWeek(data) {
    if (!data.last_week) return '';
    const lw = data.last_week;
    const hrConfigured = isHeartRateConfigured();
    return `
      <section class="section">
        <h2 class="section-header">Review of Last Week</h2>
        <p class="section-subtitle">Week of ${lw.week_label}</p>
        <div class="metrics-grid">
          ${renderReviewCard('Volume', lw.distance_km, lw.max_distance, 'km', lw.distance_percent, lw.distance_increase)}
          ${hrConfigured
            ? renderReviewCard('Intensity', lw.intensity_minutes, lw.max_intensity, 'min', lw.intensity_percent, lw.intensity_increase)
            : renderIntensityError()}
          ${renderReviewCard('Long Run', lw.long_run_km, lw.max_long_run, 'km', lw.long_run_percent, lw.long_run_increase)}
        </div>
        <div class="week-context"><div class="context-item"><span class="context-label">Runs completed</span><span class="context-value">${lw.run_count}</span></div></div>
      </section>`;
  }

  function renderNextWeekPreview(nw) {
    if (!nw) return '';
    return `
      <section class="section">
        <h2 class="section-header">Next Week Preview</h2>
        <p class="section-subtitle">Recommended limits assuming this week ends exactly on target</p>
        <div class="metrics-grid">
          ${renderPreviewCard('Volume', nw.max_next_week.distance_km, 'km', '+25%',
            `Weighted avg: ${nw.rolling_average.distance_km} km (+${nw.uplift.distance_km} km)`)}
          ${renderPreviewCard('Intensity', nw.max_next_week.intensity_minutes, 'min', '+25%',
            `Weighted avg: ${nw.rolling_average.intensity_minutes} min (+${nw.uplift.intensity_minutes} min)`)}
          ${renderPreviewCard('Long Run', nw.max_next_week.long_run_km, 'km', '30% vol',
            `Weighted avg: ${nw.rolling_average.long_run_km} km (+${nw.uplift.long_run_km} km)`)}
        </div>
        <div class="week-context"><div class="context-item"><span class="context-label">Week</span><span class="context-value">${nw.week_label}</span></div></div>
      </section>`;
  }


  // =========================================================================
  // Plan
  // =========================================================================
  async function showPlan(hash) {
    currentView = 'plan';
    Charts.destroyAll();

    const isNext = hash.includes('next');
    const now = new Date();
    const { monday: currentMonday } = Calculations.getWeekBoundaries(now);
    const weekMonday = isNext
      ? new Date(currentMonday.getTime() + 7 * 24 * 60 * 60 * 1000)
      : currentMonday;
    const weekKey = Calculations.getWeekKey(weekMonday);

    const activities = await Store.getAllActivities();
    const recommendations = Calculations.calculateRecommendations(activities);

    const plannedRuns = Store.getPlannedRuns(weekKey);
    const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

    // Build completed runs for this week from activities
    const completedRuns = {};
    if (!isNext) {
      const weekEnd = new Date(weekMonday);
      weekEnd.setDate(weekMonday.getDate() + 6);
      weekEnd.setHours(23, 59, 59, 999);

      const weekActivities = activities.filter(a => {
        const d = new Date(a.start_date);
        return d >= weekMonday && d <= weekEnd;
      });

      for (const run of weekActivities) {
        const d = new Date(run.start_date);
        const dow = (d.getDay() + 6) % 7; // 0=Monday
        const intMin = (run.time_above_80_hr || 0) / 60.0;

        if (!completedRuns[dow]) {
          completedRuns[dow] = {
            name: run.name,
            distance_km: run.distance_km,
            intensity_minutes: intMin,
            is_completed: true,
            run_count: 1,
          };
        } else {
          completedRuns[dow].distance_km += run.distance_km;
          completedRuns[dow].intensity_minutes += intMin;
          completedRuns[dow].run_count += 1;
          completedRuns[dow].name = `${completedRuns[dow].run_count} runs`;
        }
      }
    }

    // Merge: completed runs override planned runs
    const runsByDay = {};
    for (let i = 0; i < 7; i++) runsByDay[i] = null;

    for (const pr of plannedRuns) {
      if (!(pr.day_of_week in completedRuns)) {
        runsByDay[pr.day_of_week] = { ...pr, is_completed: false };
      }
    }
    for (const [day, rd] of Object.entries(completedRuns)) {
      runsByDay[parseInt(day)] = rd;
    }

    // Totals
    let totalDist = 0, totalInt = 0, longestRun = 0;
    for (const rd of Object.values(runsByDay)) {
      if (rd) {
        totalDist += rd.distance_km || 0;
        totalInt += rd.intensity_minutes || 0;
        if ((rd.distance_km || 0) > longestRun) longestRun = rd.distance_km;
      }
    }

    // Comparison
    let comparison = null;
    if (recommendations.has_enough_data) {
      let maxDist, maxInt, maxLr, avgDist, avgInt, avgLr;
      if (isNext) {
        const nwp = Calculations.calculateNextWeekPreview(recommendations);
        if (nwp) {
          maxDist = nwp.max_next_week.distance_km;
          maxInt = nwp.max_next_week.intensity_minutes;
          maxLr = nwp.max_next_week.long_run_km;
          avgDist = nwp.rolling_average.distance_km;
          avgInt = nwp.rolling_average.intensity_minutes;
          avgLr = nwp.rolling_average.long_run_km;
        } else {
          maxDist = recommendations.max_this_week.distance_km;
          maxInt = recommendations.max_this_week.intensity_minutes;
          maxLr = recommendations.max_this_week.long_run_km;
          avgDist = recommendations.rolling_average.distance_km;
          avgInt = recommendations.rolling_average.intensity_minutes;
          avgLr = recommendations.rolling_average.long_run_km;
        }
      } else {
        maxDist = recommendations.max_this_week.distance_km;
        maxInt = recommendations.max_this_week.intensity_minutes;
        maxLr = recommendations.max_this_week.long_run_km;
        avgDist = recommendations.rolling_average.distance_km;
        avgInt = recommendations.rolling_average.intensity_minutes;
        avgLr = recommendations.rolling_average.long_run_km;
      }

      comparison = {
        distance: {
          planned: Math.round(totalDist * 10) / 10,
          max: maxDist,
          percent: maxDist > 0 ? Math.round(totalDist / maxDist * 100) : 0,
          over: totalDist > maxDist,
          increase: avgDist > 0 ? Math.round((totalDist - avgDist) / avgDist * 1000) / 10 : 0,
        },
        intensity: {
          planned: Math.round(totalInt),
          max: maxInt,
          percent: maxInt > 0 ? Math.round(totalInt / maxInt * 100) : 0,
          over: totalInt > maxInt,
          increase: avgInt > 0 ? Math.round((totalInt - avgInt) / avgInt * 1000) / 10 : 0,
        },
        long_run: {
          planned: Math.round(longestRun * 10) / 10,
          max: maxLr,
          percent: maxLr > 0 ? Math.round(longestRun / maxLr * 100) : 0,
          over: longestRun > maxLr,
          increase: avgLr > 0 ? Math.round((longestRun - avgLr) / avgLr * 1000) / 10 : 0,
        },
      };
    }

    // Build days array
    const todayDate = now.toISOString().slice(0, 10);
    const days = [];
    for (let i = 0; i < 7; i++) {
      const dayDate = new Date(weekMonday);
      dayDate.setDate(weekMonday.getDate() + i);
      const dateStr = dayDate.toISOString().slice(0, 10);
      days.push({
        index: i,
        name: dayNames[i],
        date_label: dayDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        can_edit: isNext || dateStr >= todayDate,
        run: runsByDay[i],
      });
    }

    const weekLabel = weekMonday.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

    const main = document.getElementById('mainContent');
    main.innerHTML = renderPlanPage(days, comparison, weekLabel, isNext, weekKey);
    bindPlanEvents(weekKey, isNext);
  }

  function renderPlanPage(days, comparison, weekLabel, isNext, weekKey) {
    let compHtml = '';
    if (comparison) {
      compHtml = `
        <section class="section">
          <h2 class="section-header">Plan vs Recommendations</h2>
          <div class="metrics-grid">
            ${renderPlanMetric('Volume', comparison.distance, 'km')}
            ${renderPlanMetric('Intensity', comparison.intensity, 'min')}
            ${renderPlanMetric('Long Run', comparison.long_run, 'km')}
          </div>
        </section>`;
    }

    const daysHtml = days.map(day => {
      if (day.run) {
        const r = day.run;
        const dist = Math.round((r.distance_km || 0) * 10) / 10;
        const intMin = Math.round(r.intensity_minutes || 0);
        const badge = r.is_completed
          ? `<span class="plan-run-badge">Completed</span>`
          : `<button class="plan-run-delete" onclick="App.deletePlannedRun('${weekKey}', ${day.index})">×</button>`;
        const editBtn = !r.is_completed
          ? `<button class="plan-run-edit" onclick="App.openRunModal(${day.index}, '${esc(r.name || 'Run')}', ${dist}, ${intMin}, true)">Edit</button>`
          : '';
        return `
          <div class="plan-day">
            <div class="plan-day-header"><div class="plan-day-name">${day.name}</div><div class="plan-day-date">${day.date_label}</div></div>
            <div class="plan-run-card ${r.is_completed ? 'plan-run-card--completed' : ''}">
              <div class="plan-run-header"><span class="plan-run-name">${esc(r.name || 'Run')}</span>${badge}</div>
              <div class="plan-run-stats">
                <div class="plan-run-stat"><span class="plan-run-stat-label">Volume</span><span class="plan-run-stat-value">${dist} km</span></div>
                <div class="plan-run-stat"><span class="plan-run-stat-label">Intensity</span><span class="plan-run-stat-value">${intMin} min</span></div>
              </div>
              ${editBtn}
            </div>
          </div>`;
      }

      if (day.can_edit) {
        return `
          <div class="plan-day">
            <div class="plan-day-header"><div class="plan-day-name">${day.name}</div><div class="plan-day-date">${day.date_label}</div></div>
            <button class="plan-add-run" onclick="App.openRunModal(${day.index}, 'Run', 0, 0, false)">+ Add Run</button>
          </div>`;
      }

      return `
        <div class="plan-day">
          <div class="plan-day-header"><div class="plan-day-name">${day.name}</div><div class="plan-day-date">${day.date_label}</div></div>
          <div class="plan-add-run plan-add-run--disabled">Past day</div>
        </div>`;
    }).join('');

    return `
      <div class="plan-page">
        <header class="plan-header">
          <div><h1>Weekly Plan</h1><p class="plan-subtitle">Week of ${weekLabel}</p></div>
          <div class="week-toggle">
            <a href="#/plan" class="week-toggle-btn ${!isNext ? 'active' : ''}">This Week</a>
            <a href="#/plan?week=next" class="week-toggle-btn ${isNext ? 'active' : ''}">Next Week</a>
          </div>
        </header>
        ${compHtml}
        <section class="section">
          <h2 class="section-header">${isNext ? "Next" : "This"} Week's Plan</h2>
          <div class="plan-week">${daysHtml}</div>
        </section>
      </div>
      ${renderRunModal()}`;
  }

  function renderPlanMetric(label, comp, unit) {
    const overThreshold = label === 'Long Run' ? 110 : 30;
    const warnThreshold = label === 'Long Run' ? 100 : 25;
    const pctClass = comp.increase > overThreshold ? 'over' : (comp.increase > warnThreshold ? 'warning' : '');
    const sign = comp.increase > 0 ? '+' : '';

    let fill, limit;
    if (comp.percent > 100) { fill = 100; limit = (10000 / comp.percent); }
    else { fill = comp.percent; limit = 100; }

    return `
      <div class="metric-card">
        <div class="metric-header">
          <span class="metric-label">${label}</span>
          <span class="metric-percent ${pctClass}">${sign}${comp.increase}%</span>
        </div>
        <div class="metric-values">
          <span class="metric-current">${comp.planned}</span>
          <span class="metric-divider">/</span>
          <span class="metric-max">${comp.max}</span>
          <span class="metric-unit">${unit}</span>
        </div>
        <div class="progress-bar">
          <div class="progress-fill ${pctClass}" style="width: ${fill}%"></div>
          <div class="progress-limit" style="left: ${limit}%"></div>
        </div>
        <div class="metric-remaining">
          ${comp.percent}% of recommended max
          ${comp.over ? '<span class="over-indicator">Over limit</span>' : ''}
        </div>
      </div>`;
  }

  function renderRunModal() {
    return `
      <div id="runModal" class="modal" style="display:none;">
        <div class="modal-content">
          <div class="modal-header">
            <h3 id="modalTitle">Add Run</h3>
            <button class="modal-close" onclick="App.closeRunModal()">×</button>
          </div>
          <form id="runForm" onsubmit="App.saveRun(event)">
            <input type="hidden" id="modalDayOfWeek">
            <input type="hidden" id="modalIsEdit" value="false">
            <div class="form-group">
              <label for="runName">Run Name</label>
              <input type="text" id="runName" placeholder="e.g., Easy Run, Tempo, Long Run" required>
            </div>
            <div class="form-group">
              <label for="runDistance">Volume (km)</label>
              <input type="number" id="runDistance" step="0.1" min="0" placeholder="0.0" required>
            </div>
            <div class="form-group">
              <label for="runIntensity">Intensity (min)</label>
              <input type="number" id="runIntensity" step="0.1" min="0" placeholder="0.0" required>
              <p class="form-help">Expected minutes of high-intensity running.</p>
            </div>
            <div class="form-actions">
              <button type="submit" class="btn btn--primary">Save</button>
              <button type="button" class="btn btn--secondary" onclick="App.closeRunModal()">Cancel</button>
            </div>
          </form>
        </div>
      </div>`;
  }

  let _currentWeekKey = '';

  function bindPlanEvents(weekKey) {
    _currentWeekKey = weekKey;
  }

  function openRunModal(dayIndex, name, distance, intensity, isEdit) {
    document.getElementById('modalTitle').textContent = isEdit ? 'Edit Run' : 'Add Run';
    document.getElementById('modalDayOfWeek').value = dayIndex;
    document.getElementById('modalIsEdit').value = isEdit ? 'true' : 'false';
    document.getElementById('runName').value = name;
    document.getElementById('runDistance').value = distance || '';
    document.getElementById('runIntensity').value = intensity || '';
    document.getElementById('runModal').style.display = 'flex';
  }

  function closeRunModal() {
    const m = document.getElementById('runModal');
    if (m) m.style.display = 'none';
  }

  function saveRun(e) {
    e.preventDefault();
    const dayOfWeek = parseInt(document.getElementById('modalDayOfWeek').value, 10);
    const name = document.getElementById('runName').value.trim() || 'Run';
    const distanceKm = parseFloat(document.getElementById('runDistance').value) || 0;
    const intensityMin = parseFloat(document.getElementById('runIntensity').value) || 0;

    const runs = Store.getPlannedRuns(_currentWeekKey);
    const existing = runs.findIndex(r => r.day_of_week === dayOfWeek);

    const run = { day_of_week: dayOfWeek, name, distance_km: distanceKm, intensity_minutes: intensityMin };

    if (existing >= 0) {
      runs[existing] = run;
    } else {
      runs.push(run);
    }

    Store.savePlannedRuns(_currentWeekKey, runs);
    closeRunModal();
    route();
  }

  function deletePlannedRun(weekKey, dayIndex) {
    if (!confirm('Delete this planned run?')) return;
    const runs = Store.getPlannedRuns(weekKey);
    const filtered = runs.filter(r => r.day_of_week !== dayIndex);
    Store.savePlannedRuns(weekKey, filtered);
    route();
  }

  // =========================================================================
  // Settings
  // =========================================================================
  function showSettings() {
    currentView = 'settings';
    Charts.destroyAll();
    const settings = Store.getSettings();
    const lastSync = Store.getLastSyncTime();
    const syncText = lastSync ? new Date(lastSync).toLocaleString() : 'Never';

    const raceHours = settings.race_time_seconds ? Math.floor(settings.race_time_seconds / 3600) : 0;
    const raceMinutes = settings.race_time_seconds ? Math.floor((settings.race_time_seconds % 3600) / 60) : 0;
    const raceSecs = settings.race_time_seconds ? settings.race_time_seconds % 60 : 0;

    const main = document.getElementById('mainContent');
    main.innerHTML = `
      <div class="settings-page">
        <h1>Settings</h1>
        <form id="settingsForm" onsubmit="App.saveSettingsForm(event)">
          <section class="settings-section">
            <h2>Heart Rate</h2>
            <div class="form-group">
              <label for="maxHr">Max Heart Rate (bpm)</label>
              <input type="number" id="maxHr" min="100" max="250" placeholder="e.g. 190" value="${settings.max_heart_rate || ''}">
            </div>
            <div class="form-group">
              <label for="hrPercent">Intensity Threshold (%)</label>
              <input type="number" id="hrPercent" min="60" max="95" step="0.5" value="${settings.hr_intensity_percent}">
              <p class="form-help">Time above this % of max HR counts as intensity.</p>
            </div>
          </section>
          <section class="settings-section">
            <h2>Pace (VDOT)</h2>
            <div class="form-group">
              <label for="raceType">Recent Race</label>
              <select id="raceType">
                <option value="">None</option>
                <option value="5k" ${settings.race_type === '5k' ? 'selected' : ''}>5K</option>
                <option value="10k" ${settings.race_type === '10k' ? 'selected' : ''}>10K</option>
                <option value="half_marathon" ${settings.race_type === 'half_marathon' ? 'selected' : ''}>Half Marathon</option>
              </select>
            </div>
            <div class="form-group">
              <label>Race Time</label>
              <div class="race-time-inputs">
                <input type="number" id="raceHours" min="0" max="9" placeholder="H" value="${raceHours || ''}">
                <span>:</span>
                <input type="number" id="raceMinutes" min="0" max="59" placeholder="MM" value="${raceMinutes || ''}">
                <span>:</span>
                <input type="number" id="raceSeconds" min="0" max="59" placeholder="SS" value="${raceSecs || ''}">
              </div>
            </div>
          </section>
          <div class="form-actions">
            <button type="submit" class="btn btn--primary">Save Settings</button>
          </div>
        </form>
        <section class="settings-section">
          <h2>Data</h2>
          <p class="form-help">Last sync: ${syncText}</p>
          <div class="form-actions" style="margin-top: 12px">
            <button type="button" class="btn btn--secondary" onclick="App.sync()">Sync Activities</button>
            <button type="button" class="btn btn--secondary" onclick="App.fullResync()">Full Re-sync</button>
            <button type="button" class="btn btn--danger" onclick="App.clearCachedData()">Clear Cached Data</button>
            <button type="button" class="btn btn--secondary" onclick="App.logout()">Logout</button>
          </div>
        </section>
      </div>`;
  }

  async function saveSettingsForm(e) {
    e.preventDefault();
    const settings = Store.getSettings();

    const maxHr = parseInt(document.getElementById('maxHr').value, 10);
    const hrPct = parseFloat(document.getElementById('hrPercent').value);
    const raceType = document.getElementById('raceType').value || null;
    const hours = parseInt(document.getElementById('raceHours').value, 10) || 0;
    const mins = parseInt(document.getElementById('raceMinutes').value, 10) || 0;
    const secs = parseInt(document.getElementById('raceSeconds').value, 10) || 0;
    const totalSecs = hours * 3600 + mins * 60 + secs;

    const needsRecalc =
      settings.max_heart_rate !== maxHr ||
      settings.hr_intensity_percent !== hrPct ||
      settings.race_type !== raceType ||
      settings.race_time_seconds !== (totalSecs > 0 ? totalSecs : null);

    settings.max_heart_rate = maxHr >= 100 && maxHr <= 250 ? maxHr : settings.max_heart_rate;
    settings.hr_intensity_percent = hrPct >= 60 && hrPct <= 95 ? hrPct : settings.hr_intensity_percent;
    settings.race_type = raceType;
    settings.race_time_seconds = totalSecs > 0 ? totalSecs : null;

    Store.saveSettings(settings);

    if (needsRecalc) {
      const activities = await Store.getAllActivities();
      const updated = Calculations.recalculateAllIntensity(activities, settings);
      await Store.putActivities(updated);
    }

    window.location.hash = '#/dashboard';
  }

  // =========================================================================
  // Sync
  // =========================================================================
  async function sync() {
    const main = document.getElementById('mainContent');
    const existing = main.innerHTML;

    const overlay = document.createElement('div');
    overlay.id = 'syncOverlay';
    overlay.className = 'sync-overlay';
    overlay.innerHTML = `<div class="sync-modal"><h3>Syncing Activities</h3><p id="syncStatus">Starting...</p></div>`;
    document.body.appendChild(overlay);

    try {
      await Strava.syncActivities((p) => {
        const statusEl = document.getElementById('syncStatus');
        if (!statusEl) return;
        if (p.status === 'fetching') statusEl.textContent = `Fetching page ${p.page}... (${p.totalAdded} new)`;
        else if (p.status === 'processing') statusEl.textContent = `Processing: ${p.current} (${p.totalAdded} new)`;
        else if (p.status === 'complete') statusEl.textContent = `Done! ${p.totalAdded} new activities added.`;
      });
    } catch (err) {
      console.error('Sync failed:', err);
      const statusEl = document.getElementById('syncStatus');
      if (statusEl) statusEl.textContent = 'Sync failed: ' + err.message;
      await new Promise(r => setTimeout(r, 2000));
    }

    await new Promise(r => setTimeout(r, 1000));
    const ov = document.getElementById('syncOverlay');
    if (ov) ov.remove();

    route();
  }

  async function fullResync() {
    if (!confirm('This will re-download all activities from the past year. Continue?')) return;

    const overlay = document.createElement('div');
    overlay.id = 'syncOverlay';
    overlay.className = 'sync-overlay';
    overlay.innerHTML = `<div class="sync-modal"><h3>Full Re-sync</h3><p id="syncStatus">Starting...</p></div>`;
    document.body.appendChild(overlay);

    try {
      await Strava.fullResync((p) => {
        const statusEl = document.getElementById('syncStatus');
        if (!statusEl) return;
        if (p.status === 'fetching') statusEl.textContent = `Fetching page ${p.page}... (${p.totalAdded} new)`;
        else if (p.status === 'processing') statusEl.textContent = `Processing: ${p.current} (${p.totalAdded} new)`;
        else if (p.status === 'complete') statusEl.textContent = `Done! ${p.totalAdded} activities synced.`;
      });
    } catch (err) {
      console.error('Full resync failed:', err);
    }

    await new Promise(r => setTimeout(r, 1000));
    const ov = document.getElementById('syncOverlay');
    if (ov) ov.remove();

    route();
  }

  function logout() {
    if (!confirm('Log out of this browser session?')) return;
    Strava.logout();
    window.location.hash = '#/';
    route();
  }

  async function clearCachedData() {
    if (!confirm('Clear all cached data for this account from this browser?')) return;
    await Store.clearCurrentUserData();
    window.location.hash = '#/dashboard';
    route();
  }

  // =========================================================================
  // Utilities
  // =========================================================================
  function esc(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  return {
    init,
    sync,
    fullResync,
    logout,
    clearCachedData,
    openRunModal,
    closeRunModal,
    saveRun,
    deletePlannedRun,
    saveSettingsForm,
  };
})();

document.addEventListener('DOMContentLoaded', App.init);
