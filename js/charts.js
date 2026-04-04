const Charts = (() => {
  const accentGreen = '#00ff88';
  const accentPink = '#ff6b9d';
  const accentRed = '#ff4d4d';

  const metrics = {
    volume: {
      label: 'Volume',
      unit: 'km',
      weightedKey: 'distance_km',
      actualKey: 'actual_weekly_distance',
      recommendedKey: 'recommended_distance',
      diffKey: 'diff_distance',
      color: accentGreen,
    },
    intensity: {
      label: 'Intensity',
      unit: 'min',
      weightedKey: 'intensity_minutes',
      actualKey: 'actual_weekly_intensity',
      recommendedKey: 'recommended_intensity',
      diffKey: 'diff_intensity',
      color: accentPink,
    },
  };

  function commonAxisStyle() {
    return {
      x: {
        grid: { color: '#222', drawBorder: false },
        ticks: {
          color: '#666',
          font: { family: "'Inter', sans-serif", size: 10 },
          maxRotation: 45,
          autoSkip: true,
          maxTicksLimit: 15,
        },
      },
      y: {
        grid: { color: '#222', drawBorder: false },
        ticks: {
          color: '#666',
          font: { family: "'Inter', sans-serif", size: 10 },
        },
        beginAtZero: true,
      },
    };
  }

  function tooltipStyle() {
    return {
      backgroundColor: '#1a1a1a',
      titleColor: '#fff',
      bodyColor: '#888',
      borderColor: '#333',
      borderWidth: 1,
      titleFont: { family: "'Inter', sans-serif" },
      bodyFont: { family: "'Inter', sans-serif" },
      padding: 12,
      displayColors: true,
    };
  }

  function legendStyle() {
    return {
      position: 'top',
      labels: {
        color: '#888',
        font: { family: "'Inter', sans-serif", size: 11 },
        usePointStyle: true,
      },
    };
  }

  function getDiffColors(values) {
    return values.map(v => {
      if (v === null) return '#33333380';
      return v > 0 ? accentRed + '80' : accentGreen + '80';
    });
  }

  function getDiffBorderColors(values) {
    return values.map(v => {
      if (v === null) return '#333333';
      return v > 0 ? accentRed : accentGreen;
    });
  }

  let vsRecommendedChart = null;
  let overUnderChart = null;
  let outlook6MonthChart = null;
  let volumeTrendChart = null;

  function renderPerformanceChart(canvasId, chartData, period, metricKey) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const allHistorical = chartData.historical || [];
    const filtered = allHistorical.length <= period
      ? allHistorical
      : allHistorical.slice(allHistorical.length - period);
    const labels = filtered.map(w => w.week_label);
    const metric = metrics[metricKey];

    if (vsRecommendedChart) vsRecommendedChart.destroy();

    vsRecommendedChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Recommended Zone (+30%)',
            data: filtered.map(w => Math.round(w[metric.weightedKey] * 1.30 * 10) / 10),
            borderColor: accentGreen + '40',
            borderWidth: 1,
            borderDash: [4, 4],
            backgroundColor: accentGreen + '15',
            fill: { target: 1, above: accentGreen + '15', below: 'transparent' },
            tension: 0.3,
            pointRadius: 0,
            pointHoverRadius: 0,
            order: 4,
          },
          {
            label: `Weighted 12wk Avg (${metric.unit})`,
            data: filtered.map(w => w[metric.weightedKey]),
            borderColor: metric.color,
            borderWidth: 2,
            fill: false,
            tension: 0.3,
            pointRadius: 2,
            pointHoverRadius: 5,
            pointBackgroundColor: metric.color,
            order: 3,
          },
          {
            label: `Actual Weekly ${metric.label} (${metric.unit})`,
            data: filtered.map(w => w[metric.actualKey]),
            borderColor: '#ffffff',
            borderWidth: 2,
            fill: false,
            tension: 0.3,
            pointRadius: 3,
            pointHoverRadius: 5,
            pointBackgroundColor: '#ffffff',
            order: 1,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { intersect: false, mode: 'index' },
        plugins: {
          legend: legendStyle(),
          tooltip: {
            ...tooltipStyle(),
            callbacks: {
              title: (items) => 'Week of ' + items[0].label,
            },
          },
        },
        scales: commonAxisStyle(),
      },
    });
  }

  function renderOverUnderChart(canvasId, chartData, period, metricKey) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const allHistorical = chartData.historical || [];
    const filtered = allHistorical.length <= period
      ? allHistorical
      : allHistorical.slice(allHistorical.length - period);
    const labels = filtered.map(w => w.week_label);
    const metric = metrics[metricKey];
    const diffData = filtered.map(w => w[metric.diffKey]);

    if (overUnderChart) overUnderChart.destroy();

    overUnderChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: `Difference (${metric.unit})`,
          data: diffData,
          backgroundColor: getDiffColors(diffData),
          borderColor: getDiffBorderColors(diffData),
          borderWidth: 1,
          borderRadius: 3,
          barPercentage: 0.8,
          categoryPercentage: 0.85,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { intersect: false, mode: 'index' },
        plugins: {
          legend: { display: false },
          tooltip: {
            ...tooltipStyle(),
            callbacks: {
              title: (items) => 'Week of ' + items[0].label,
              label: (context) => {
                const v = context.parsed.y;
                if (v > 0) return `Over by ${v}`;
                if (v < 0) return `Under by ${Math.abs(v)}`;
                return 'On target';
              },
            },
          },
        },
        scales: {
          ...commonAxisStyle(),
          y: {
            ...commonAxisStyle().y,
            ticks: {
              ...commonAxisStyle().y.ticks,
              callback: (value) => value > 0 ? '+' + value : value,
            },
          },
        },
      },
    });
  }

  function renderOutlookChart(canvasId, outlookData) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || !outlookData) return;
    const ctx = canvas.getContext('2d');

    const projections = outlookData.projections;

    if (outlook6MonthChart) outlook6MonthChart.destroy();

    outlook6MonthChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: projections.map(w => w.date_label),
        datasets: [
          {
            label: 'Volume (km)',
            data: projections.map(w => w.max.distance_km),
            borderColor: accentGreen,
            backgroundColor: accentGreen + '20',
            borderWidth: 2,
            tension: 0.3,
            fill: false,
          },
          {
            label: 'Intensity (min)',
            data: projections.map(w => w.max.intensity_minutes),
            borderColor: accentPink,
            backgroundColor: accentPink + '20',
            borderWidth: 2,
            tension: 0.3,
            fill: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            display: true,
            position: 'top',
            labels: {
              color: '#fff',
              font: { family: "'Inter', sans-serif", size: 11 },
              padding: 15,
              usePointStyle: true,
            },
          },
          tooltip: {
            ...tooltipStyle(),
            titleColor: '#fff',
            bodyColor: '#fff',
            callbacks: {
              title: (context) => 'Week ' + (context[0].dataIndex + 1) + ' - ' + context[0].label,
              label: (context) => {
                let label = context.dataset.label || '';
                if (label) label += ': ';
                label += context.parsed.y + (label.includes('Intensity') ? ' min' : ' km');
                return label;
              },
            },
          },
        },
        scales: {
          x: {
            grid: { color: '#222', drawBorder: false },
            ticks: {
              color: '#666',
              font: { family: "'Inter', sans-serif", size: 9 },
              maxRotation: 45,
              autoSkip: true,
              maxTicksLimit: 13,
              callback: function(value, index) {
                if (index % 4 === 0 || index === this.chart.data.labels.length - 1) {
                  return this.chart.data.labels[index];
                }
                return '';
              },
            },
          },
          y: {
            type: 'linear',
            display: true,
            position: 'left',
            grid: { color: '#222', drawBorder: false },
            ticks: {
              color: '#666',
              font: { family: "'Inter', sans-serif", size: 10 },
              callback: (v) => v + ' km',
            },
            title: {
              display: true,
              text: 'Volume (km) & Intensity (min)',
              color: '#888',
              font: { family: "'Inter', sans-serif", size: 10 },
            },
          },
        },
      },
    });
  }

  function renderVolumeTrendChart(canvasId, trendData) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || !trendData || trendData.length === 0) return;
    const ctx = canvas.getContext('2d');

    if (volumeTrendChart) volumeTrendChart.destroy();

    const labels = trendData.map(d => d.week_label);
    const weightedAvgData = trendData.map(d => d.weighted_avg);
    const recommendationData = trendData.map(d => d.recommendation);
    const actualData = trendData.map(d => d.is_future ? null : d.actual_volume);
    const projectedData = trendData.map(d => d.is_future ? d.projected_volume : null);

    const actualBgColors = trendData.map((d, i) => {
      if (d.is_future || d.actual_volume === null) return 'transparent';
      if (d.is_current) return accentGreen + '60';
      return d.actual_volume > recommendationData[i] ? accentRed + '60' : 'rgba(255,255,255,0.25)';
    });
    const actualBorderColors = trendData.map((d, i) => {
      if (d.is_future || d.actual_volume === null) return 'transparent';
      if (d.is_current) return accentGreen;
      return d.actual_volume > recommendationData[i] ? accentRed : 'rgba(255,255,255,0.5)';
    });

    const todayDivider = {
      id: 'todayDivider',
      beforeDraw(chart) {
        const currentIdx = trendData.findIndex(d => d.is_current);
        if (currentIdx < 0 || currentIdx >= trendData.length - 1) return;
        const xScale = chart.scales.x;
        const yScale = chart.scales.y;
        const x = (xScale.getPixelForValue(currentIdx) + xScale.getPixelForValue(currentIdx + 1)) / 2;
        const c = chart.ctx;
        c.save();
        c.setLineDash([4, 4]);
        c.strokeStyle = '#444';
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(x, yScale.top);
        c.lineTo(x, yScale.bottom);
        c.stroke();
        c.restore();
        c.save();
        c.fillStyle = '#555';
        c.font = "10px 'Inter', sans-serif";
        c.textAlign = 'left';
        c.fillText('Projected', x + 6, yScale.top + 14);
        c.restore();
      },
    };

    volumeTrendChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            type: 'line',
            label: 'Rec. Max (+25%)',
            data: recommendationData,
            borderColor: accentGreen + '50',
            borderWidth: 1,
            borderDash: [5, 5],
            backgroundColor: 'transparent',
            fill: {
              target: 1,
              above: accentGreen + '12',
            },
            tension: 0.3,
            pointRadius: 0,
            pointHoverRadius: 4,
            pointBackgroundColor: accentGreen + '50',
            order: 4,
          },
          {
            type: 'line',
            label: '12wk Weighted Avg',
            data: weightedAvgData,
            borderColor: accentGreen,
            borderWidth: 2,
            fill: false,
            tension: 0.3,
            pointRadius: 2,
            pointHoverRadius: 5,
            pointBackgroundColor: accentGreen,
            order: 3,
          },
          {
            label: 'Actual Volume',
            data: actualData,
            backgroundColor: actualBgColors,
            borderColor: actualBorderColors,
            borderWidth: 1,
            borderRadius: 3,
            barPercentage: 0.65,
            categoryPercentage: 0.85,
            stack: 'volume',
            order: 1,
          },
          {
            label: 'Projected Volume',
            data: projectedData,
            backgroundColor: accentGreen + '25',
            borderColor: accentGreen + '50',
            borderWidth: 1,
            borderRadius: 3,
            barPercentage: 0.65,
            categoryPercentage: 0.85,
            stack: 'volume',
            order: 1,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { intersect: false, mode: 'index' },
        plugins: {
          legend: legendStyle(),
          tooltip: {
            ...tooltipStyle(),
            callbacks: {
              title: (items) => {
                const idx = items[0].dataIndex;
                const d = trendData[idx];
                if (d.is_current) return 'This Week (' + d.week_label + ')';
                if (d.is_future) return 'Projected (' + d.week_label + ')';
                return 'Week of ' + d.week_label;
              },
              label: (context) => {
                const value = context.parsed.y;
                if (value === null || value === undefined) return null;
                return context.dataset.label + ': ' + value + ' km';
              },
            },
            filter: (item) => item.parsed.y !== null && item.parsed.y !== undefined,
          },
        },
        scales: {
          x: {
            stacked: true,
            grid: { color: '#222', drawBorder: false },
            ticks: {
              color: '#666',
              font: { family: "'Inter', sans-serif", size: 10 },
              maxRotation: 45,
              autoSkip: true,
              maxTicksLimit: 17,
            },
          },
          y: {
            stacked: true,
            grid: { color: '#222', drawBorder: false },
            ticks: {
              color: '#666',
              font: { family: "'Inter', sans-serif", size: 10 },
              callback: (v) => v + ' km',
            },
            beginAtZero: true,
          },
        },
      },
      plugins: [todayDivider],
    });
  }

  function destroyAll() {
    if (vsRecommendedChart) { vsRecommendedChart.destroy(); vsRecommendedChart = null; }
    if (overUnderChart) { overUnderChart.destroy(); overUnderChart = null; }
    if (outlook6MonthChart) { outlook6MonthChart.destroy(); outlook6MonthChart = null; }
    if (volumeTrendChart) { volumeTrendChart.destroy(); volumeTrendChart = null; }
  }

  return {
    renderPerformanceChart,
    renderOverUnderChart,
    renderOutlookChart,
    renderVolumeTrendChart,
    destroyAll,
  };
})();
