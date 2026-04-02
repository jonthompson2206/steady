const Calculations = (() => {

  function getWeekBoundaries(date) {
    const d = new Date(date);
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day; // Monday = start
    const monday = new Date(d);
    monday.setDate(d.getDate() + diff);
    monday.setHours(0, 0, 0, 0);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);
    return { monday, sunday };
  }

  function getWeekKey(date) {
    const { monday } = getWeekBoundaries(date);
    return monday.toISOString().slice(0, 10);
  }

  function getWeeklyStats(activities, numWeeks = 20) {
    const now = new Date();
    const { monday: currentMonday } = getWeekBoundaries(now);
    const weeks = [];

    for (let i = 0; i < numWeeks; i++) {
      const weekStart = new Date(currentMonday);
      weekStart.setDate(currentMonday.getDate() - i * 7);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6);
      weekEnd.setHours(23, 59, 59, 999);

      const weekActivities = activities.filter(a => {
        const d = new Date(a.start_date);
        return d >= weekStart && d <= weekEnd;
      });

      const totalDistance = weekActivities.reduce((s, a) => s + (a.distance_km || 0), 0);
      const totalIntensityMinutes = weekActivities.reduce(
        (s, a) => s + ((a.time_above_80_hr || 0) / 60.0), 0
      );
      const longRunKm = weekActivities.reduce(
        (max, a) => Math.max(max, a.distance_km || 0), 0
      );

      const label = weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

      weeks.push({
        week_start: weekStart,
        week_end: weekEnd,
        week_label: label,
        week_index: -i,
        distance_km: Math.round(totalDistance * 10) / 10,
        intensity_minutes: Math.round(totalIntensityMinutes),
        long_run_km: Math.round(longRunKm * 10) / 10,
        run_count: weekActivities.length,
        is_current: i === 0,
        is_complete: i > 0,
      });
    }

    return weeks;
  }

  function calculateWeightedAverage(weeklyStats, metric, index, weeks = 12) {
    if (index + weeks >= weeklyStats.length) return null;

    let weightedSum = 0;
    let totalWeight = 0;
    for (let w = 0; w < weeks; w++) {
      const weight = weeks - w;
      weightedSum += (weeklyStats[index + 1 + w][metric] || 0) * weight;
      totalWeight += weight;
    }

    return totalWeight > 0 ? weightedSum / totalWeight : 0;
  }

  function calculateRecommendations(activities) {
    const weeklyStats = getWeeklyStats(activities, 65);

    if (weeklyStats.length < 13) {
      return {
        has_enough_data: false,
        weeks_needed: 13 - weeklyStats.length,
        weekly_stats: weeklyStats,
      };
    }

    const avgDistance = calculateWeightedAverage(weeklyStats, 'distance_km', 0);
    const avgIntensity = calculateWeightedAverage(weeklyStats, 'intensity_minutes', 0);
    const avgLongRun = calculateWeightedAverage(weeklyStats, 'long_run_km', 0);

    if (avgDistance === null) {
      return { has_enough_data: false, weeks_needed: 1, weekly_stats: weeklyStats };
    }

    const maxDistance = avgDistance * 1.25;
    const maxIntensity = avgIntensity * 1.25;
    const longRunMax = maxDistance * 0.30;

    const currentWeek = weeklyStats[0];
    const distanceRemaining = Math.max(0, maxDistance - currentWeek.distance_km);
    const intensityRemaining = Math.max(0, maxIntensity - currentWeek.intensity_minutes);
    const longRunRemaining = Math.max(0, longRunMax - currentWeek.long_run_km);

    const { sunday } = getWeekBoundaries(new Date());
    const today = new Date();
    const daysLeft = Math.ceil((sunday - today) / (1000 * 60 * 60 * 24)) + 1;

    const distancePercent = maxDistance > 0 ? (currentWeek.distance_km / maxDistance * 100) : 0;
    const intensityPercent = maxIntensity > 0 ? (currentWeek.intensity_minutes / maxIntensity * 100) : 0;
    const longRunPercent = longRunMax > 0 ? (currentWeek.long_run_km / longRunMax * 100) : 0;

    const chartData = buildChartData(weeklyStats);

    // Historical comparison (last 4 completed weeks)
    const historicalComparison = [];
    for (let i = 1; i < Math.min(5, weeklyStats.length); i++) {
      const histAvgDist = calculateWeightedAverage(weeklyStats, 'distance_km', i);
      const histAvgInt = calculateWeightedAverage(weeklyStats, 'intensity_minutes', i);
      if (histAvgDist === null || histAvgInt === null) continue;

      const histMaxDist = histAvgDist * 1.25;
      const histLongRunMax = histMaxDist * 0.30;

      historicalComparison.push({
        week_label: weeklyStats[i].week_label,
        volume: {
          recommended_max: r1(histMaxDist),
          actual: r1(weeklyStats[i].distance_km),
          difference: r1(weeklyStats[i].distance_km - histMaxDist),
          over_limit: weeklyStats[i].distance_km > histMaxDist,
        },
        intensity: {
          recommended_max: Math.round(histAvgInt * 1.25),
          actual: Math.round(weeklyStats[i].intensity_minutes),
          difference: Math.round(weeklyStats[i].intensity_minutes - histAvgInt * 1.25),
          over_limit: weeklyStats[i].intensity_minutes > histAvgInt * 1.25,
        },
        long_run: {
          recommended_max: r1(histLongRunMax),
          actual: r1(weeklyStats[i].long_run_km),
          difference: r1(weeklyStats[i].long_run_km - histLongRunMax),
          over_limit: weeklyStats[i].long_run_km > histLongRunMax,
        },
      });
    }

    // Last week review
    let lastWeek = null;
    if (weeklyStats.length > 1) {
      const lwd = weeklyStats[1];
      const lwAvgDist = calculateWeightedAverage(weeklyStats, 'distance_km', 1);
      const lwAvgInt = calculateWeightedAverage(weeklyStats, 'intensity_minutes', 1);
      const lwAvgLr = calculateWeightedAverage(weeklyStats, 'long_run_km', 1);

      if (lwAvgDist !== null) {
        const lwMaxDist = lwAvgDist * 1.25;
        const lwMaxInt = lwAvgInt * 1.25;
        const lwLrMax = lwMaxDist * 0.30;

        const lwDistPct = lwMaxDist > 0 ? (lwd.distance_km / lwMaxDist * 100) : 0;
        const lwIntPct = lwMaxInt > 0 ? (lwd.intensity_minutes / lwMaxInt * 100) : 0;
        const lwLrPct = lwLrMax > 0 ? (lwd.long_run_km / lwLrMax * 100) : 0;

        lastWeek = {
          week_label: lwd.week_label,
          distance_km: r1(lwd.distance_km),
          intensity_minutes: Math.round(lwd.intensity_minutes),
          long_run_km: r1(lwd.long_run_km),
          run_count: lwd.run_count,
          max_distance: r1(lwMaxDist),
          max_intensity: Math.round(lwMaxInt),
          max_long_run: r1(lwLrMax),
          distance_percent: Math.round(lwDistPct),
          intensity_percent: Math.round(lwIntPct),
          long_run_percent: Math.round(lwLrPct),
          distance_increase: r1(lwAvgDist > 0 ? ((lwd.distance_km - lwAvgDist) / lwAvgDist * 100) : 0),
          intensity_increase: r1(lwAvgInt > 0 ? ((lwd.intensity_minutes - lwAvgInt) / lwAvgInt * 100) : 0),
          long_run_increase: r1(lwAvgLr > 0 ? ((lwd.long_run_km - lwAvgLr) / lwAvgLr * 100) : 0),
        };
      }
    }

    return {
      has_enough_data: true,
      weekly_stats: weeklyStats,
      rolling_average: {
        distance_km: r1(avgDistance),
        intensity_minutes: Math.round(avgIntensity),
        long_run_km: r1(avgLongRun),
      },
      max_this_week: {
        distance_km: r1(maxDistance),
        intensity_minutes: Math.round(maxIntensity),
        long_run_km: r1(maxDistance * 0.30),
      },
      current_week: {
        distance_km: currentWeek.distance_km,
        intensity_minutes: currentWeek.intensity_minutes,
        long_run_km: currentWeek.long_run_km,
        run_count: currentWeek.run_count,
      },
      remaining: {
        distance_km: r1(distanceRemaining),
        intensity_minutes: Math.round(intensityRemaining),
        long_run_km: r1(longRunRemaining),
        days_left: daysLeft,
      },
      progress: {
        distance_percent: Math.round(distancePercent),
        intensity_percent: Math.round(intensityPercent),
        long_run_percent: Math.round(longRunPercent),
      },
      current_week_increase: {
        distance_increase: r1(avgDistance > 0 ? ((currentWeek.distance_km - avgDistance) / avgDistance * 100) : 0),
        intensity_increase: r1(avgIntensity > 0 ? ((currentWeek.intensity_minutes - avgIntensity) / avgIntensity * 100) : 0),
        long_run_increase: r1(avgLongRun > 0 ? ((currentWeek.long_run_km - avgLongRun) / avgLongRun * 100) : 0),
      },
      last_week: lastWeek,
      chart_data: chartData,
      historical_comparison: historicalComparison,
    };
  }

  function calculateNextWeekPreview(recommendations) {
    if (!recommendations.has_enough_data) return null;

    const weeklyStats = recommendations.weekly_stats;
    const maxThisWeek = recommendations.max_this_week;
    if (!maxThisWeek || weeklyStats.length < 12) return null;

    const totalWeight = 78; // sum(1..12)

    let weightedDist = maxThisWeek.distance_km * 12;
    let weightedInt = maxThisWeek.intensity_minutes * 12;
    let weightedLr = (maxThisWeek.long_run_km || 0) * 12;

    for (let w = 0; w < 11; w++) {
      const weight = 11 - w;
      if (weeklyStats.length > w + 1) {
        weightedDist += (weeklyStats[w + 1].distance_km || 0) * weight;
        weightedInt += (weeklyStats[w + 1].intensity_minutes || 0) * weight;
        weightedLr += (weeklyStats[w + 1].long_run_km || 0) * weight;
      }
    }

    const nextAvgDist = weightedDist / totalWeight;
    const nextAvgInt = weightedInt / totalWeight;
    const nextAvgLr = weightedLr / totalWeight;

    const nextMaxDist = nextAvgDist * 1.25;
    const nextMaxInt = nextAvgInt * 1.25;
    const nextLrMax = nextMaxDist * 0.30;

    const { monday: currentMonday } = getWeekBoundaries(new Date());
    const nextMonday = new Date(currentMonday);
    nextMonday.setDate(currentMonday.getDate() + 7);
    const nextSunday = new Date(nextMonday);
    nextSunday.setDate(nextMonday.getDate() + 6);

    const fmtOpts = { month: 'short', day: 'numeric' };

    return {
      rolling_average: {
        distance_km: r1(nextAvgDist),
        intensity_minutes: Math.round(nextAvgInt),
        long_run_km: r1(nextAvgLr),
      },
      max_next_week: {
        distance_km: r1(nextMaxDist),
        intensity_minutes: Math.round(nextMaxInt),
        long_run_km: r1(nextLrMax),
      },
      uplift: {
        distance_km: r1(nextMaxDist - maxThisWeek.distance_km),
        intensity_minutes: Math.round(nextMaxInt - maxThisWeek.intensity_minutes),
        long_run_km: r1(nextLrMax - (maxThisWeek.long_run_km || 0)),
      },
      week_label: `${nextMonday.toLocaleDateString('en-US', fmtOpts)} - ${nextSunday.toLocaleDateString('en-US', fmtOpts)}`,
    };
  }

  function calculate6MonthOutlook(recommendations) {
    if (!recommendations.has_enough_data) return null;

    const weeklyStats = recommendations.weekly_stats;
    const maxThisWeek = recommendations.max_this_week;
    if (!maxThisWeek || weeklyStats.length < 12) return null;

    const totalWeight = 78;
    const projections = [];

    const currentWeekMax = {
      distance_km: maxThisWeek.distance_km,
      intensity_minutes: maxThisWeek.intensity_minutes,
      long_run_km: maxThisWeek.long_run_km || 0,
    };

    let historyDist = [currentWeekMax.distance_km];
    let historyInt = [currentWeekMax.intensity_minutes];
    for (let w = 1; w < 12; w++) {
      historyDist.push(weeklyStats.length > w ? (weeklyStats[w].distance_km || 0) : 0);
      historyInt.push(weeklyStats.length > w ? (weeklyStats[w].intensity_minutes || 0) : 0);
    }

    const { monday: currentMonday } = getWeekBoundaries(new Date());

    for (let weekNum = 0; weekNum < 26; weekNum++) {
      const weekStart = new Date(currentMonday);
      weekStart.setDate(currentMonday.getDate() + (weekNum + 1) * 7);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6);

      let wDist = 0, wInt = 0;
      for (let i = 0; i < 12; i++) {
        wDist += historyDist[i] * (12 - i);
        wInt += historyInt[i] * (12 - i);
      }

      const rollingAvgDist = wDist / totalWeight;
      const rollingAvgInt = wInt / totalWeight;
      const weekMaxDist = rollingAvgDist * 1.25;
      const weekMaxInt = rollingAvgInt * 1.25;
      const weekLrMax = weekMaxDist * 0.30;

      projections.push({
        week_num: weekNum + 1,
        week_label: `Week ${weekNum + 1}`,
        date_label: weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        rolling_avg: {
          distance_km: r1(rollingAvgDist),
          intensity_minutes: Math.round(rollingAvgInt),
        },
        max: {
          distance_km: r1(weekMaxDist),
          intensity_minutes: Math.round(weekMaxInt),
          long_run_km: r1(weekLrMax),
        },
      });

      historyDist = [weekMaxDist, ...historyDist.slice(0, 11)];
      historyInt = [weekMaxInt, ...historyInt.slice(0, 11)];
    }

    return { projections, current_max: currentWeekMax };
  }

  function buildChartData(weeklyStats) {
    const lookback = 12;
    const totalWeight = 78;

    if (weeklyStats.length < lookback + 2) {
      return { historical: [] };
    }

    const historical = [];
    const maxI = weeklyStats.length - lookback - 1;

    for (let i = maxI; i > 0; i--) {
      let weightedDist = 0, weightedInt = 0;
      for (let w = 0; w < lookback; w++) {
        weightedDist += weeklyStats[i + 1 + w].distance_km * (lookback - w);
        weightedInt += weeklyStats[i + 1 + w].intensity_minutes * (lookback - w);
      }

      const weightedAvgDist = weightedDist / totalWeight;
      const weightedAvgInt = weightedInt / totalWeight;

      const recDistance = weightedAvgDist > 0 ? r1(weightedAvgDist * 1.25) : null;
      const recIntensity = weightedAvgInt > 0 ? Math.round(weightedAvgInt * 1.25) : null;

      const actualDist = weeklyStats[i].distance_km;
      const actualInt = weeklyStats[i].intensity_minutes;

      historical.push({
        week_label: weeklyStats[i].week_label,
        week_index: weeklyStats[i].week_index,
        is_current: weeklyStats[i].is_current,
        distance_km: r1(weightedAvgDist),
        intensity_minutes: Math.round(weightedAvgInt),
        actual_weekly_distance: r1(actualDist),
        actual_weekly_intensity: Math.round(actualInt),
        recommended_distance: recDistance,
        recommended_intensity: recIntensity,
        diff_distance: recDistance !== null ? r1(actualDist - recDistance) : null,
        diff_intensity: recIntensity !== null ? Math.round(actualInt - recIntensity) : null,
      });
    }

    return { historical };
  }

  function estimateIntensityFromAvgHR(avgHR, hrThreshold, movingTime) {
    if (!avgHR || !hrThreshold || hrThreshold <= 0 || movingTime <= 0) return 0;

    const ratio = avgHR / hrThreshold;
    let proportion;
    if (ratio >= 1.05) proportion = 0.85;
    else if (ratio >= 1.0) proportion = 0.65;
    else if (ratio >= 0.97) proportion = 0.40;
    else if (ratio >= 0.94) proportion = 0.20;
    else if (ratio >= 0.90) proportion = 0.10;
    else if (ratio >= 0.85) proportion = 0.05;
    else proportion = 0.02;

    return Math.round(movingTime * proportion);
  }

  function recalculateAllIntensity(activities, settings) {
    const hrThreshold = settings.max_heart_rate * (settings.hr_intensity_percent / 100.0);
    return activities.map(a => ({
      ...a,
      time_above_80_hr: estimateIntensityFromAvgHR(
        a.average_heartrate, hrThreshold, a.moving_time_seconds
      ),
    }));
  }

  function calculateVdotFromRaceTime(raceType, raceTimeSeconds) {
    const raceTimeMinutes = raceTimeSeconds / 60.0;
    const raceDistanceMeters = { '5k': 5000, '10k': 10000, 'half_marathon': 21097.5 }[raceType] || 5000;
    const velocityMPerMin = raceDistanceMeters / raceTimeMinutes;

    const vo2 = -4.60 + (0.182258 * velocityMPerMin) + (0.000104 * velocityMPerMin * velocityMPerMin);
    const pctVo2max = 0.8
      + 0.1894393 * Math.exp(-0.012778 * raceTimeMinutes)
      + 0.2989558 * Math.exp(-0.1932605 * raceTimeMinutes);

    if (pctVo2max <= 0) return 20.0;
    const vdot = vo2 / pctVo2max;
    return Math.max(Math.round(vdot * 10) / 10, 20.0);
  }

  function calculateEasyPaceFromVdot(vdot) {
    if (vdot <= 0) return 999;
    const targetVo2 = vdot * 0.70;
    const a = 0.000104, b = 0.182258, c = -(targetVo2 + 4.60);
    const discriminant = b * b - 4 * a * c;
    if (discriminant < 0) return 999;
    const velocity = (-b + Math.sqrt(discriminant)) / (2 * a); // m/min
    if (velocity <= 0) return 999;
    return Math.max(1000.0 / velocity * 60.0, 180.0); // s/km
  }

  function r1(v) {
    return Math.round(v * 10) / 10;
  }

  return {
    getWeekBoundaries,
    getWeekKey,
    getWeeklyStats,
    calculateWeightedAverage,
    calculateRecommendations,
    calculateNextWeekPreview,
    calculate6MonthOutlook,
    buildChartData,
    estimateIntensityFromAvgHR,
    recalculateAllIntensity,
    calculateVdotFromRaceTime,
    calculateEasyPaceFromVdot,
  };
})();
