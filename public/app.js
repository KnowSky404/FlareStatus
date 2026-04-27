const summaryEl = document.querySelector("#summary");
const fallbackMessage = "Unable to load current system status";

if (summaryEl) {
  try {
    const response = await fetch("/api/public/status");

    if (!response.ok) {
      throw new Error(`Unexpected status ${response.status}`);
    }

    const snapshot = await response.json();

    summaryEl.textContent =
      snapshot.summary.status === "operational"
        ? "All Systems Operational"
        : "Some systems are experiencing issues";
  } catch {
    summaryEl.textContent = fallbackMessage;
  }
}
