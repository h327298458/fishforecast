export type Eot20Availability = {
  status?: unknown;
  available?: unknown;
  reason?: unknown;
  events?: unknown[];
};

export function canSelectEot20(model: Eot20Availability) {
  if (Array.isArray(model.events) && model.events.length > 0) return true;
  if (model.available === true || model.status === "REAL") return true;
  // Backwards compatibility while a browser/API pair is rolling between
  // releases: NOT_REQUESTED means the installed model was intentionally lazy.
  return model.status === "NOT_REQUESTED" && model.reason === "ON_DEMAND_MODEL_NOT_REQUESTED";
}
