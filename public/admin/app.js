const STATUS_LABELS = {
  operational: "Operational",
  degraded: "Degraded",
  partial_outage: "Partial outage",
  major_outage: "Major outage",
};

const state = {
  token: loadStoredToken(),
  catalog: null,
  publicSnapshot: null,
  selectedServiceSlug: null,
};

const elements = {
  tokenInput: document.querySelector("#admin-token"),
  connectTokenButton: document.querySelector("#connect-token"),
  adminStatus: document.querySelector("#admin-status"),
  previewSummary: document.querySelector("#preview-summary"),
  previewService: document.querySelector("#preview-service"),
  previewAnnouncements: document.querySelector("#preview-announcements"),
  serviceSearch: document.querySelector("#service-search"),
  serviceList: document.querySelector("#service-list"),
  newServiceButton: document.querySelector("#new-service"),
  serviceForm: document.querySelector("#service-form"),
  saveServiceButton: document.querySelector("#save-service"),
  newComponentButton: document.querySelector("#new-component"),
  componentList: document.querySelector("#component-list"),
  overrideTargetType: document.querySelector("#override-target-type"),
  overrideTargetSlug: document.querySelector("#override-target-slug"),
  submitOverrideButton: document.querySelector("#submit-override"),
  announcementTitle: document.querySelector("#announcement-title"),
  announcementBody: document.querySelector("#announcement-body"),
  announcementStatus: document.querySelector("#announcement-status"),
  submitAnnouncementButton: document.querySelector("#submit-announcement"),
};

function loadStoredToken() {
  try {
    return window.localStorage.getItem("flarestatus.adminToken") ?? "";
  } catch {
    return "";
  }
}

function storeToken(token) {
  try {
    window.localStorage.setItem("flarestatus.adminToken", token);
  } catch {
    // Ignore storage failures in constrained environments.
  }
}

function setStatus(message, tone = "warning") {
  if (!elements.adminStatus) {
    return;
  }

  elements.adminStatus.textContent = message;
  elements.adminStatus.className = `admin-status status-${tone}`;
}

function getStatusLabel(status) {
  return STATUS_LABELS[status] ?? "Unknown";
}

function getSelectedService() {
  if (!state.catalog || !state.selectedServiceSlug) {
    return null;
  }

  return (
    state.catalog.services.find((service) => service.slug === state.selectedServiceSlug) ??
    null
  );
}

async function apiFetch(path, init = {}) {
  if (!state.token) {
    throw new Error("Missing admin token");
  }

  const headers = new Headers(init.headers ?? {});
  headers.set("authorization", `Bearer ${state.token}`);

  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(path, {
    ...init,
    headers,
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return response;
}

async function refreshPublicPreview() {
  const response = await fetch("/api/public/status");
  const snapshot = await response.json();
  state.publicSnapshot = snapshot;
  renderPreview();
}

async function refreshCatalog() {
  const response = await apiFetch("/api/admin/catalog");
  state.catalog = await response.json();

  if (!state.selectedServiceSlug && state.catalog.services[0]) {
    state.selectedServiceSlug = state.catalog.services[0].slug;
  }

  if (
    state.selectedServiceSlug &&
    !state.catalog.services.some((service) => service.slug === state.selectedServiceSlug)
  ) {
    state.selectedServiceSlug = state.catalog.services[0]?.slug ?? null;
  }

  render();
}

function renderPreview() {
  const summary = state.publicSnapshot?.summary?.status ?? "operational";
  const announcements = state.publicSnapshot?.announcements ?? [];
  const selectedService = getSelectedService();

  if (elements.previewSummary) {
    elements.previewSummary.textContent = getStatusLabel(summary);
  }

  if (elements.previewAnnouncements) {
    elements.previewAnnouncements.textContent = announcements.length
      ? `${announcements.length} active`
      : "None";
  }

  if (elements.previewService) {
    elements.previewService.textContent = selectedService
      ? `${selectedService.name} (${selectedService.enabled ? "enabled" : "disabled"})`
      : "No service selected";
  }
}

function renderServiceList() {
  if (!elements.serviceList) {
    return;
  }

  const query = elements.serviceSearch?.value.trim().toLowerCase() ?? "";
  const services = state.catalog?.services ?? [];
  const filteredServices = services.filter((service) =>
    service.name.toLowerCase().includes(query) ||
    service.slug.toLowerCase().includes(query),
  );

  if (filteredServices.length === 0) {
    elements.serviceList.innerHTML =
      '<p class="empty-state">No services match the current filter.</p>';
    return;
  }

  elements.serviceList.innerHTML = filteredServices
    .map(
      (service) => `
        <article class="service-item ${service.slug === state.selectedServiceSlug ? "active" : ""}">
          <button type="button" data-service-select="${service.slug}">
            <strong>${service.name}</strong>
            <div class="service-meta">
              <span>${getStatusLabel(service.status)}</span>
              <span>${service.enabled ? "Enabled" : "Disabled"}</span>
            </div>
          </button>
        </article>
      `,
    )
    .join("");

  elements.serviceList
    .querySelectorAll("[data-service-select]")
    .forEach((button) => {
      button.addEventListener("click", () => {
        state.selectedServiceSlug = button.getAttribute("data-service-select");
        render();
      });
    });
}

function renderServiceForm() {
  const service = getSelectedService();

  if (!service || !elements.serviceForm) {
    return;
  }

  elements.serviceForm.querySelector("#service-name").value = service.name;
  elements.serviceForm.querySelector("#service-slug").value = service.slug;
  elements.serviceForm.querySelector("#service-description").value =
    service.description;
  elements.serviceForm.querySelector("#service-sort-order").value =
    String(service.sortOrder);
  elements.serviceForm.querySelector("#service-enabled").checked = service.enabled;

  if (elements.overrideTargetSlug) {
    elements.overrideTargetSlug.value = service.slug;
  }
}

function createComponentEditor(component) {
  return `
    <article class="component-item">
      <div class="component-meta">
        <strong>${component.name}</strong>
        <span>${component.enabled ? "Enabled" : "Disabled"}</span>
      </div>
      <div class="component-fields">
        <div class="component-row">
          <input data-component-field="name" data-component-slug="${component.slug}" value="${component.name}" />
          <input data-component-field="slug" data-component-slug="${component.slug}" value="${component.slug}" />
          <select data-component-field="probeType" data-component-slug="${component.slug}">
            ${["http", "synthetic-http", "redis", "postgres", "tcp", "command"]
              .map(
                (probeType) =>
                  `<option value="${probeType}" ${component.probeType === probeType ? "selected" : ""}>${probeType}</option>`,
              )
              .join("")}
          </select>
          <button type="button" data-save-component="${component.slug}">Save</button>
        </div>
        <div class="component-row">
          <input data-component-field="description" data-component-slug="${component.slug}" value="${component.description}" />
          <input data-component-field="sortOrder" data-component-slug="${component.slug}" type="number" value="${component.sortOrder}" />
          <select data-component-field="enabled" data-component-slug="${component.slug}">
            <option value="true" ${component.enabled ? "selected" : ""}>Enabled</option>
            <option value="false" ${component.enabled ? "" : "selected"}>Disabled</option>
          </select>
          <select data-component-field="isCritical" data-component-slug="${component.slug}">
            <option value="true" ${component.isCritical ? "selected" : ""}>Critical</option>
            <option value="false" ${component.isCritical ? "" : "selected"}>Non-critical</option>
          </select>
        </div>
      </div>
    </article>
  `;
}

function renderComponentList() {
  const service = getSelectedService();

  if (!elements.componentList) {
    return;
  }

  if (!service) {
    elements.componentList.innerHTML =
      '<p class="empty-state">Select a service to edit components.</p>';
    return;
  }

  elements.componentList.innerHTML = service.components.length
    ? service.components.map(createComponentEditor).join("")
    : '<p class="empty-state">No components yet. Use "New" to add one.</p>';

  elements.componentList
    .querySelectorAll("[data-save-component]")
    .forEach((button) => {
      button.addEventListener("click", () =>
        saveComponent(button.getAttribute("data-save-component")),
      );
    });
}

function render() {
  renderServiceList();
  renderServiceForm();
  renderComponentList();
  renderPreview();
}

async function saveService() {
  const service = getSelectedService();

  if (!service || !elements.serviceForm) {
    return;
  }

  const payload = {
    slug: elements.serviceForm.querySelector("#service-slug").value.trim(),
    name: elements.serviceForm.querySelector("#service-name").value.trim(),
    description: elements.serviceForm.querySelector("#service-description").value,
    sortOrder: Number(elements.serviceForm.querySelector("#service-sort-order").value),
    enabled: elements.serviceForm.querySelector("#service-enabled").checked,
  };

  await apiFetch(`/api/admin/services/${service.slug}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  setStatus(`Saved service ${payload.name}`, "success");
  state.selectedServiceSlug = payload.slug;
  await Promise.all([refreshCatalog(), refreshPublicPreview()]);
}

function readComponentPayload(componentSlug) {
  const fields = Array.from(
    document.querySelectorAll(`[data-component-slug="${componentSlug}"]`),
  );
  const findValue = (fieldName) =>
    fields.find((field) => field.getAttribute("data-component-field") === fieldName)
      ?.value;

  return {
    slug: findValue("slug")?.trim(),
    name: findValue("name")?.trim(),
    description: findValue("description") ?? "",
    probeType: findValue("probeType"),
    isCritical: findValue("isCritical") === "true",
    sortOrder: Number(findValue("sortOrder")),
    enabled: findValue("enabled") === "true",
  };
}

async function saveComponent(componentSlug) {
  const payload = readComponentPayload(componentSlug);

  await apiFetch(`/api/admin/components/${componentSlug}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });

  setStatus(`Saved component ${payload.name}`, "success");
  await Promise.all([refreshCatalog(), refreshPublicPreview()]);
}

async function createServiceDraft() {
  const baseSlug = `service-${Date.now()}`;
  await apiFetch("/api/admin/services", {
    method: "POST",
    body: JSON.stringify({
      slug: baseSlug,
      name: "New Service",
      description: "",
      sortOrder: (state.catalog?.services.length ?? 0) + 1,
      enabled: false,
    }),
  });

  setStatus("Created draft service", "success");
  state.selectedServiceSlug = baseSlug;
  await Promise.all([refreshCatalog(), refreshPublicPreview()]);
}

async function createComponentDraft() {
  const service = getSelectedService();

  if (!service) {
    setStatus("Select a service before adding a component.", "warning");
    return;
  }

  const slug = `${service.slug}-component-${Date.now()}`;
  await apiFetch("/api/admin/components", {
    method: "POST",
    body: JSON.stringify({
      serviceSlug: service.slug,
      slug,
      name: "New Component",
      description: "",
      probeType: "http",
      isCritical: false,
      sortOrder: service.components.length + 1,
      enabled: false,
    }),
  });

  setStatus("Created draft component", "success");
  await Promise.all([refreshCatalog(), refreshPublicPreview()]);
}

async function submitOverride() {
  const payload = {
    targetType: elements.overrideTargetType?.value ?? "service",
    targetSlug: elements.overrideTargetSlug?.value.trim() ?? "",
    overrideStatus: document.querySelector("#override-status")?.value ?? "degraded",
    message: document.querySelector("#override-message")?.value ?? "",
  };

  await apiFetch("/api/admin/overrides", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  setStatus("Override published", "success");
  await refreshPublicPreview();
}

async function submitAnnouncement() {
  const payload = {
    title: elements.announcementTitle?.value.trim() ?? "",
    body: elements.announcementBody?.value ?? "",
    statusLevel: elements.announcementStatus?.value ?? "operational",
  };

  await apiFetch("/api/admin/announcements", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  setStatus("Announcement published", "success");
  await refreshPublicPreview();
}

async function bootstrap() {
  if (elements.tokenInput) {
    elements.tokenInput.value = state.token;
  }

  try {
    await refreshPublicPreview();
  } catch {
    setStatus("Public preview is temporarily unavailable.", "warning");
  }

  if (!state.token) {
    render();
    return;
  }

  try {
    await refreshCatalog();
    setStatus("Editable catalog loaded.", "success");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Unable to load catalog.", "error");
  }
}

elements.connectTokenButton?.addEventListener("click", async () => {
  state.token = elements.tokenInput?.value.trim() ?? "";

  if (!state.token) {
    setStatus("Enter an admin token first.", "warning");
    return;
  }

  storeToken(state.token);
  await bootstrap();
});

elements.serviceSearch?.addEventListener("input", () => {
  renderServiceList();
});

elements.saveServiceButton?.addEventListener("click", async () => {
  try {
    await saveService();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Unable to save service.", "error");
  }
});

elements.newServiceButton?.addEventListener("click", async () => {
  try {
    await createServiceDraft();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Unable to create service.", "error");
  }
});

elements.newComponentButton?.addEventListener("click", async () => {
  try {
    await createComponentDraft();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Unable to create component.", "error");
  }
});

elements.submitOverrideButton?.addEventListener("click", async () => {
  try {
    await submitOverride();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Unable to publish override.", "error");
  }
});

elements.submitAnnouncementButton?.addEventListener("click", async () => {
  try {
    await submitAnnouncement();
  } catch (error) {
    setStatus(
      error instanceof Error ? error.message : "Unable to publish announcement.",
      "error",
    );
  }
});

await bootstrap();
