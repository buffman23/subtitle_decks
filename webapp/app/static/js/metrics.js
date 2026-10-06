"use strict";

(function () {
  const dataEl = document.getElementById("metrics-data");
  if (!dataEl || typeof Chart === "undefined") return;

  let data;
  try {
    data = JSON.parse(dataEl.textContent);
  } catch (e) {
    return;
  }

  const activityEl = document.getElementById("activityChart");
  if (activityEl && data.activity) {
    new Chart(activityEl, {
      type: "line",
      data: {
        // "YYYY-MM-DD" → "MM-DD" so the ticks fit flat on narrow screens
        labels: data.activity.labels.map((l) => String(l).slice(5)),
        datasets: [
          {
            label: "Analyses",
            data: data.activity.analyses,
            borderColor: "#0d6efd",
            backgroundColor: "rgba(13,110,253,0.1)",
            fill: true,
            tension: 0.3,
          },
          {
            label: "Signups",
            data: data.activity.signups,
            borderColor: "#198754",
            backgroundColor: "rgba(25,135,84,0.1)",
            fill: true,
            tension: 0.3,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false, // height comes from .chart-box
        scales: {
          x: { ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 6 } },
          y: { beginAtZero: true, ticks: { precision: 0 } },
        },
      },
    });
  }

  const languageEl = document.getElementById("languageChart");
  if (languageEl && data.languages) {
    new Chart(languageEl, {
      type: "doughnut",
      data: {
        labels: data.languages.labels,
        datasets: [
          {
            data: data.languages.counts,
            backgroundColor: [
              "#0d6efd", "#198754", "#dc3545", "#ffc107",
              "#6f42c1", "#fd7e14", "#20c997", "#6c757d",
            ],
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: "bottom" } },
      },
    });
  }
})();
