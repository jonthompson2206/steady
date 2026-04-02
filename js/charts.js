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

  function destroyAll() {
    if (vsRecommendedChart) { vsRecommendedChart.destroy(); vsRecommendedChart = null; }
    if (overUnderChart) { overUnderChart.destroy(); overUnderChart = null; }
    if (outlook6MonthChart) { outlook6MonthChart.destroy(); outlook6MonthChart = null; }
  }

  return {
    renderPerformanceChart,
    renderOverUnderChart,
    renderOutlookChart,
    destroyAll,
  };
})();
