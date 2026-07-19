export type CanonicalTideSource = "BOM_OFFICIAL" | "EOT20_MODEL" | "NO_TIDE";

export function shouldCalculateEot20ForForecast(input: {
  preferredSource: CanonicalTideSource;
  officialAvailable: boolean;
  officialStationLocked: boolean;
  modelInstalled: boolean;
  modelApplicable: boolean;
}) {
  if (!input.modelInstalled || !input.modelApplicable) return false;
  if (input.preferredSource === "EOT20_MODEL") return true;
  return (
    input.preferredSource === "BOM_OFFICIAL" &&
    !input.officialAvailable &&
    !input.officialStationLocked
  );
}

export function resolveActualTideSource(input: {
  preferredSource: CanonicalTideSource;
  officialAvailable: boolean;
  officialStationLocked: boolean;
  modelAvailable: boolean;
}): CanonicalTideSource {
  if (input.preferredSource === "NO_TIDE") return "NO_TIDE";
  if (input.preferredSource === "EOT20_MODEL")
    return input.modelAvailable ? "EOT20_MODEL" : "NO_TIDE";
  if (input.officialAvailable) return "BOM_OFFICIAL";
  if (!input.officialStationLocked && input.modelAvailable)
    return "EOT20_MODEL";
  return "NO_TIDE";
}
