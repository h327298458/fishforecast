import { useState } from "react";
import type { SavedSpot } from "../types";

type Values = {
  exposureDirectionDeg: string;
  maximumWindKmh: string;
  maximumGustKmh: string;
  maximumWaveHeightM: string;
  hasBuildingShelter: boolean;
  hasCliffShelter: boolean;
  openCoast: boolean;
  rockAccessRequired: boolean;
  slipperyAccess: boolean;
  nightFishingAllowed: boolean;
  lightingAvailable: boolean;
  notes: string;
};

const fromSpot = (spot: SavedSpot): Values => ({
  exposureDirectionDeg: spot.exposureDirectionDeg?.toString() ?? "",
  maximumWindKmh: spot.maximumWindKmh?.toString() ?? "",
  maximumGustKmh: spot.maximumGustKmh?.toString() ?? "",
  maximumWaveHeightM: spot.maximumWaveHeightM?.toString() ?? "",
  hasBuildingShelter: Boolean(spot.hasBuildingShelter),
  hasCliffShelter: Boolean(spot.hasCliffShelter),
  openCoast: Boolean(spot.openCoast),
  rockAccessRequired: Boolean(spot.rockAccessRequired),
  slipperyAccess: Boolean(spot.slipperyAccess),
  nightFishingAllowed: Boolean(spot.nightFishingAllowed),
  lightingAvailable: Boolean(spot.lightingAvailable),
  notes: spot.notes ?? "",
});

export function SpotSafetySettings({ spot, saved, onSave }: { spot: SavedSpot; saved: boolean; onSave: (values: Record<string, unknown>) => Promise<void> }) {
  const [values, setValues] = useState(() => fromSpot(spot));
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof Values>(key: K, value: Values[K]) => setValues((current) => ({ ...current, [key]: value }));
  const number = (value: string) => value.trim() === "" ? null : Number(value);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      await onSave({ ...values, exposureDirectionDeg: number(values.exposureDirectionDeg), maximumWindKmh: number(values.maximumWindKmh), maximumGustKmh: number(values.maximumGustKmh), maximumWaveHeightM: number(values.maximumWaveHeightM) });
    } finally { setSaving(false); }
  }
  const toggles: Array<[keyof Values, string]> = [
    ["hasBuildingShelter", "有建筑遮挡"], ["hasCliffShelter", "有崖壁遮挡"], ["openCoast", "开放海岸"], ["rockAccessRequired", "需要岩石通行"], ["slipperyAccess", "通道易滑"], ["nightFishingAllowed", "允许夜钓"], ["lightingAvailable", "现场有照明"],
  ];
  return (
    <details className="spot-safety-settings">
      <summary>钓点暴露方向与安全阈值</summary>
      <form onSubmit={(event) => void submit(event)}>
        <p className="form-note">这些属性会参与风向、阵风和浪高判断；留空时使用系统默认阈值。</p>
        <div className="settings-grid">
          <label>迎风/暴露方向（0–359°）<input type="number" min="0" max="359" value={values.exposureDirectionDeg} onChange={(event) => set("exposureDirectionDeg", event.target.value)} /></label>
          <label>最大平均风速（km/h）<input type="number" min="5" max="120" value={values.maximumWindKmh} onChange={(event) => set("maximumWindKmh", event.target.value)} /></label>
          <label>最大阵风（km/h）<input type="number" min="5" max="160" value={values.maximumGustKmh} onChange={(event) => set("maximumGustKmh", event.target.value)} /></label>
          <label>最大参考浪高（m）<input type="number" min="0.1" max="15" step="0.1" value={values.maximumWaveHeightM} onChange={(event) => set("maximumWaveHeightM", event.target.value)} /></label>
        </div>
        <div className="checkbox-grid">
          {toggles.map(([key, label]) => <label className="check" key={key}><input type="checkbox" checked={Boolean(values[key])} onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.checked }))} />{label}</label>)}
        </div>
        <label>现场备注<textarea rows={3} maxLength={2000} value={values.notes} onChange={(event) => set("notes", event.target.value)} /></label>
        <button className="primary" disabled={!saved || saving}>{saved ? (saving ? "正在保存…" : "保存并重新评分") : "请先保存钓点"}</button>
      </form>
    </details>
  );
}
