const summaryEl = document.querySelector("#summary");
const announcementListEl = document.querySelector("#announcement-list");
const serviceListEl = document.querySelector("#service-list");
const fallbackMessage = "Unable to load current system status";

function formatStatusLabel(status) {
  switch (status) {
    case "operational":
      return "Operational";
    case "degraded":
      return "Degraded performance";
    case "partial_outage":
      return "Partial outage";
    case "major_outage":
      return "Major outage";
    default:
      return "Status unknown";
  }
}

function renderSummary(status) {
  if (!summaryEl) {
    return;
  }

  summaryEl.textContent =
    status === "operational" ? "All Systems Operational" : formatStatusLabel(status);
}

function renderAnnouncements(announcements) {
  if (!announcementListEl) {
    return;
  }

  if (!announcements || announcements.length === 0) {
    announcementListEl.innerHTML =
      '<p class="empty-state">No active announcements.</p>';
    return;
  }

  announcementListEl.innerHTML = announcements
    .map(
      (announcement) => `
        <article class="announcement-item">
          <h3 class="announcement-title">${announcement.title}</h3>
          <p class="announcement-body">${announcement.body}</p>
        </article>
      `,
    )
    .join("");
}

function renderServices(services) {
  if (!serviceListEl) {
    return;
  }

  if (!services || services.length === 0) {
    serviceListEl.innerHTML =
      '<p class="empty-state">Service details will appear here soon.</p>';
    return;
  }

  serviceListEl.innerHTML = services
    .map(
      (service) => `
        <article class="service-item">
          <div class="service-row">
            <h3 class="service-name">${service.name}</h3>
            <p class="service-status">${formatStatusLabel(service.status)}</p>
          </div>
          <ul class="service-components">
            ${(service.components ?? [])
              .map(
                (component) => `
                  <li>
                    <span class="component-name">${component.name}</span>
                    <span class="component-status">${formatStatusLabel(component.displayStatus)}</span>
                  </li>
                `,
              )
              .join("")}
          </ul>
        </article>
      `,
    )
    .join("");
}

if (summaryEl) {
  try {
    const response = await fetch("/api/public/status");

    if (!response.ok) {
      throw new Error(`Unexpected status ${response.status}`);
    }

    const snapshot = await response.json();

    renderSummary(snapshot.summary.status);
    renderAnnouncements(snapshot.announcements);
    renderServices(snapshot.services);
  } catch {
    summaryEl.textContent = fallbackMessage;
  }
}
