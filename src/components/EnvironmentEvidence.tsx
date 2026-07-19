import { useState } from "react";
import type { Forecast, TideSource } from "../types";
import { getEot20Tide, type Eot20Model } from "../api";
import { canSelectEot20 } from "../domain/tideAvailability";
const time = (value: string | undefined, timezone: string) =>
  value
    ? new Intl.DateTimeFormat("zh-CN", {
        timeZone: timezone,
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(value))
    : "—";
type Mode = "official" | "model" | "compare";
export function EnvironmentEvidence({
  forecast,
  timezone,
  spotType,
  onTideSource,
  onOfficialSettings,
}: {
  forecast: Forecast;
  timezone: string;
  spotType: string;
  onTideSource: (source: TideSource) => void;
  onOfficialSettings: (options: Record<string, unknown>) => void;
}) {
  const [mode, setMode] = useState<Mode>(() =>
    forecast.tides.actualTideSourceUsed === "EOT20_MODEL"
      ? "model"
      : "official",
  );
  const [onDemandModel, setOnDemandModel] = useState<{ spotId: string; model: Eot20Model } | null>(null);
  const [modelLoading, setModelLoading] = useState(false);
  const [modelError, setModelError] = useState<{ spotId: string; message: string } | null>(null);
  const { official, model: initialModel, comparison: storedComparison } = forecast.tides;
  const model = onDemandModel?.spotId === forecast.spot.id ? onDemandModel.model : initialModel;
  const visibleModelError = modelError?.spotId === forecast.spot.id ? modelError.message : "";
  const modelAvailable = Boolean(model.events);
  const modelSelectable = canSelectEot20(initialModel) || canSelectEot20(model);
  const officialAvailable = Boolean(official?.events.length);
  const comparison = (() => {
    if (storedComparison || !official?.events.length || !model.events?.length) return storedComparison;
    const officialHigh = official.events.find((event) => event.type === "HIGH");
    const officialLow = official.events.find((event) => event.type === "LOW");
    const modelHigh = model.events.find((event) => event.type === "HIGH");
    const modelLow = model.events.find((event) => event.type === "LOW");
    if (!officialHigh || !modelHigh) return null;
    return { officialHigh, modelHigh, officialLow: officialLow ?? null, modelLow: modelLow ?? null, timeDifferenceMinutes: Math.round(Math.abs(new Date(officialHigh.timeUtc).getTime() - new Date(modelHigh.timestampUtc).getTime()) / 60_000), heightDifferenceM: Math.abs(officialHigh.heightM - modelHigh.heightM), lowTimeDifferenceMinutes: officialLow && modelLow ? Math.round(Math.abs(new Date(officialLow.timeUtc).getTime() - new Date(modelLow.timestampUtc).getTime()) / 60_000) : null, officialConfidence: 0.9, modelConfidence: Number(model.confidence ?? 0), actualTideSourceUsed: forecast.tides.actualTideSourceUsed };
  })();
  async function selectMode(next: Mode) {
    setMode(next);
    if (next === "official" || modelAvailable || !modelSelectable || modelLoading) return;
    setModelLoading(true); setModelError(null);
    try { setOnDemandModel({ spotId: forecast.spot.id, model: await getEot20Tide(forecast.spot, spotType) }); }
    catch (error) { setModelError({ spotId: forecast.spot.id, message: error instanceof Error ? error.message : "EOT20_UNAVAILABLE" }); }
    finally { setModelLoading(false); }
  }
  return (
    <div className="evidence-grid">
      <section className="evidence-card tide-evidence">
        <div className="mode-tabs" aria-label="潮汐显示模式">
          <button
            className={mode === "official" ? "active" : ""}
            onClick={() => void selectMode("official")}
          >
            官方参考港
          </button>
          <button
            className={mode === "model" ? "active" : ""}
            onClick={() => void selectMode("model")}
          >
            经纬度模型
          </button>
          <button
            className={mode === "compare" ? "active" : ""}
            onClick={() => void selectMode("compare")}
          >
            对比模式
          </button>
        </div>
        <h3>潮汐来源与对比</h3>
        <p>
          <b>本次评分实际使用：</b>
          {forecast.tides.actualTideSourceUsed}
        </p>
        {forecast.tides.fallbackReason ? (
          <p className="conflict">
            未使用首选源：{forecast.tides.fallbackReason}
          </p>
        ) : null}
        <div className="mode-tabs" aria-label="评分潮汐来源">
          <button
            disabled={!officialAvailable}
            className={
              forecast.tides.preferredSource === "BOM_OFFICIAL" ? "active" : ""
            }
            onClick={() => onTideSource("BOM_OFFICIAL")}
          >
            用官方源评分
          </button>
          <button
            disabled={!modelSelectable}
            className={
              forecast.tides.preferredSource === "EOT20_MODEL" ? "active" : ""
            }
            onClick={() => onTideSource("EOT20_MODEL")}
          >
            用 EOT20 评分
          </button>
          <button
            className={
              forecast.tides.preferredSource === "NO_TIDE" ? "active" : ""
            }
            onClick={() => onTideSource("NO_TIDE")}
          >
            不计潮汐
          </button>
        </div>
        {mode === "official" ? (
          official ? (
            <OfficialPanel
              official={official}
              timezone={timezone}
              onSave={onOfficialSettings}
            />
          ) : (
            <p className="unavailable">
              同州没有已导入且覆盖查询时间的官方参考港；该评分选项已禁用。
            </p>
          )
        ) : null}
        {mode === "model" ? (
          modelAvailable ? (
            <div>
              <p>
                模型：{String(model.version ?? "EOT20")} · 坐标{" "}
                {JSON.stringify(model.calculationCoordinates)} · 适用性{" "}
                {model.applicability}
              </p>
              <p>
                下一事件：{model.events?.[0]?.type}{" "}
                {time(model.events?.[0]?.timestampUtc, timezone)} ·{" "}
                {model.events?.[0]?.heightM.toFixed(2)} m
              </p>
              <small>
                EOT20
                是全球潮汐模型，不是当地官方港口潮汐表；港湾、河口和河流内部可能存在较大误差。
              </small>
            </div>
          ) : (
            <p className="unavailable">
              EOT20：{modelLoading ? "正在按需计算模型…" : visibleModelError || String((model as Record<string, unknown>).reason ?? (model as Record<string, unknown>).status ?? "UNAVAILABLE")}
              。缺少或损坏模型时不会生成假潮汐。
            </p>
          )
        ) : null}
        {mode === "compare" ? (
          comparison ? (
            <div>
              <p>
                BOM 高潮：{time(comparison.officialHigh.timeUtc, timezone)} ·{" "}
                {comparison.officialHigh.heightM.toFixed(2)} m
              </p>
              <p>
                EOT20 高潮：{time(comparison.modelHigh.timestampUtc, timezone)}{" "}
                · {comparison.modelHigh.heightM.toFixed(2)} m
              </p>
              <p
                className={
                  comparison.timeDifferenceMinutes > 45 ? "conflict" : ""
                }
              >
                高潮时间差 {comparison.timeDifferenceMinutes} 分钟 · 潮高差{" "}
                {comparison.heightDifferenceM.toFixed(2)} m
              </p>
              {comparison.officialLow && comparison.modelLow ? (
                <>
                  <p>
                    BOM 低潮：{time(comparison.officialLow.timeUtc, timezone)} ·{" "}
                    {comparison.officialLow.heightM.toFixed(2)} m
                  </p>
                  <p>
                    EOT20 低潮：
                    {time(comparison.modelLow.timestampUtc, timezone)} ·{" "}
                    {comparison.modelLow.heightM.toFixed(2)} m
                  </p>
                  <p>低潮时间差 {comparison.lowTimeDifferenceMinutes} 分钟</p>
                </>
              ) : null}
              <p>
                官方源可信度 {Math.round(comparison.officialConfidence * 100)}%
                · 模型可信度 {Math.round(comparison.modelConfidence * 100)}% ·
                评分使用 {comparison.actualTideSourceUsed}
              </p>
              {comparison.timeDifferenceMinutes > 45 ? (
                <small>
                  两个潮汐来源差异较大，可能受港湾、河口或局部地形影响，请结合现场水流观察。
                </small>
              ) : null}
            </div>
          ) : (
            <p className="unavailable">
              只有两个真实来源在同一日期均可用时才显示对比。
            </p>
          )
        ) : null}
      </section>
      <section className="evidence-card">
        <h3>BOM 官方警告</h3>
        {forecast.warnings.warnings?.length ? (
          forecast.warnings.warnings.map((w) => (
            <p key={w.warningId}>
              <a href={w.sourceUrl} target="_blank" rel="noreferrer">
                {w.title}
              </a>
              <br />
              <small>
                {w.severity} · {w.matchStatus ?? "UNKNOWN"} · {w.lifecycle ?? "ACTIVE"} · {time(w.issuedAtUtc, timezone)}
                {w.validUntilUtc ? ` 至 ${time(w.validUntilUtc, timezone)}` : " · 官方产品未提供明确失效时间"}
                {w.matchReason ? ` · ${w.matchReason}` : ""}
              </small>
            </p>
          ))
        ) : (
          <p className="unavailable">
            {forecast.warnings.status === "UNAVAILABLE"
              ? "警告获取失败，安全状态保持 UNKNOWN。"
              : "本次成功检查未返回相关警告；不代表绝对安全。"}
          </p>
        )}
        <small>
          匹配状态：{forecast.warnings.matchStatus ?? "UNKNOWN"}。`AFFECTED` 会硬阻断重叠窗口；`POSSIBLY_AFFECTED` 不显示绿色安全；无法确认点位时请打开 BOM 原文核实。
        </small>
      </section>
      <section className="evidence-card">
        <h3>BOM 当前实况</h3>
        {forecast.observation.selected ? (
          <>
            <p>
              {forecast.observation.selected.stationName} ·{" "}
              {forecast.observation.selected.distanceKm.toFixed(1)} km
            </p>
            <p>
              风 {forecast.observation.selected.windSpeedKmh ?? "—"} km/h · 阵风{" "}
              {forecast.observation.selected.gustKmh ?? "—"} km/h · 气压{" "}
              {forecast.observation.selected.pressureHpa ?? "—"} hPa
            </p>
            <small>
              观测时间{" "}
              {time(forecast.observation.selected.observedAtUtc, timezone)}
              {forecast.observation.selected.ageMinutes !== undefined ? ` · 数据年龄 ${forecast.observation.selected.ageMinutes} 分钟` : ""}
              {forecast.observation.selected.selectionReason ? ` · ${forecast.observation.selected.selectionReason}` : ""}
            </small>
            {forecast.observation.forecastVsObservation ? <p>预报风 {forecast.observation.forecastVsObservation.forecastWindKmh ?? "—"} km/h · 实测风 {forecast.observation.forecastVsObservation.observedWindKmh ?? "—"} km/h · 差值 {forecast.observation.forecastVsObservation.windDifferenceKmh ?? "—"} km/h{forecast.observation.forecastVsObservation.affectsSafety ? " · 已影响近期安全判断" : ""}</p> : null}
            {forecast.observation.candidates?.length ? <details><summary>查看候选观测站（{forecast.observation.candidates.length}）</summary>{forecast.observation.candidates.map(candidate=>candidate?<p key={`${candidate.stationName}-${candidate.observedAtUtc}`}>{candidate.stationName} · {candidate.distanceKm.toFixed(1)} km · {candidate.ageMinutes ?? "—"} 分钟</p>:null)}</details> : null}
          </>
        ) : (
          <p className="unavailable">
            {forecast.observation.reason ?? "没有足够新且包含风数据的候选站"}
          </p>
        )}
      </section>
      <section className="evidence-card">
        <h3>BOM 海域预报 / Marine 适用性</h3>
        {forecast.bomMarineForecast.text ? (
          <>
            <p>
              {forecast.bomMarineForecast.zone} ·{" "}
              {forecast.bomMarineForecast.productCode}
            </p>
            <details>
              <summary>查看官方区域文字预报</summary>
              <pre>{forecast.bomMarineForecast.text.slice(0, 2400)}</pre>
            </details>
          </>
        ) : (
          <p className="unavailable">
            {forecast.bomMarineForecast.reason ?? "不可用"}
          </p>
        )}
        <p>
          Open-Meteo Marine：{forecast.marineApplicability.status}
          {forecast.marineApplicability.gridDistanceKm !== null
            ? ` · 网格距离 ${forecast.marineApplicability.gridDistanceKm.toFixed(1)} km`
            : ""}
        </p>
        <small>
          {forecast.marineApplicability.reason ??
            "数值模型仅作该水域类型的环境参考。"}{" "}
          外海网格和浮标均不等同岸边实际浪高。
        </small>
      </section>
      <section className="evidence-card">
        <h3>NSW MHL 外海浮标实况</h3>
        {forecast.nswMhlWave.stationName ? (
          <>
            <p>{forecast.nswMhlWave.stationName} · {forecast.nswMhlWave.distanceToSpotKm?.toFixed(1)} km</p>
            <p>有效波高 {forecast.nswMhlWave.significantWaveHeightM ?? "—"} m · 周期 {forecast.nswMhlWave.wavePeriodSeconds ?? "—"} s · 波向 {forecast.nswMhlWave.waveDirectionDeg ?? "—"}°</p>
            <small>{forecast.nswMhlWave.applicability} · {forecast.nswMhlWave.applicabilityReason}{forecast.nswMhlWave.usingStaleCache ? " · 正在使用仍有效的缓存" : ""}</small>
          </>
        ) : <p className="unavailable">{forecast.nswMhlWave.reason ?? "NSW MHL 浮标数据不可用"}</p>}
      </section>
      <section className="evidence-card">
        <h3>Brooklyn / Hawkesbury 水文</h3>
        {forecast.waterData.status === "PARTIAL" ? (
          <>
            <p>{forecast.waterData.stationName} · {forecast.waterData.distanceToSpotKm?.toFixed(1)} km · 水位 {forecast.waterData.waterLevelM ?? "—"} m {forecast.waterData.datum ?? ""}</p>
            <p>24小时变化 {forecast.waterData.change24hM ?? "—"} m · 72小时变化 {forecast.waterData.change72hM ?? "—"} m · {forecast.waterData.trend}</p>
            {forecast.waterData.upstreamRain ? <p>上游参考点降雨（Open-Meteo）：过去24h {forecast.waterData.upstreamRain.past24hMm} mm · 过去72h {forecast.waterData.upstreamRain.past72hMm} mm · 未来24h {forecast.waterData.upstreamRain.future24hMm} mm</p> : null}
            <small>{forecast.waterData.limitation}</small>
          </>
        ) : <p className="unavailable">{forecast.waterData.limitation ?? forecast.waterData.detail ?? "水文状态不可用"}</p>}
      </section>
      <section className="evidence-card regulation-card">
        <h3>官方休闲钓鱼规则</h3>
        {forecast.regulations.status === "REAL" ? <><p>{forecast.regulations.authority} · 最后核验 {forecast.regulations.lastVerifiedAt}</p><div className="regulation-links"><a href={forecast.regulations.rulesUrl} target="_blank" rel="noreferrer">规则、尺寸、袋限和禁渔期</a>{forecast.regulations.licenceUrl ? <a href={forecast.regulations.licenceUrl} target="_blank" rel="noreferrer">Fishing licence</a> : null}{forecast.regulations.marineParksUrl ? <a href={forecast.regulations.marineParksUrl} target="_blank" rel="noreferrer">Marine parks / sanctuary zones</a> : null}</div><small>{forecast.regulations.notice} 系统不声明该地点一定允许垂钓。</small></> : <p className="unavailable">{forecast.regulations.notice}</p>}
      </section>
    </div>
  );
}
function OfficialPanel({
  official,
  timezone,
  onSave,
}: {
  official: NonNullable<Forecast["tides"]["official"]>;
  timezone: string;
  onSave: (options: Record<string, unknown>) => void;
}) {
  const station = official.station;
  return (
    <div>
      <p>
        参考港：{String(station.station_name)} ·{" "}
        {Number(station.distanceKm).toFixed(1)} km · 数据年{" "}
        {official.dataYears?.length ? official.dataYears.join(" / ") : String(station.source_year)}
      </p>
      <p>
        坐标：{Number(station.latitude).toFixed(4)},{" "}
        {Number(station.longitude).toFixed(4)} · 时间修正{" "}
        {official.timeOffsetMinutes} 分钟 · 潮高修正 {official.heightOffsetM} m
      </p>
      <p>
        下一事件：{official.events[0]?.type}{" "}
        {time(official.events[0]?.timeUtc, timezone)} ·{" "}
        {official.events[0]?.heightM.toFixed(2)} m
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          onSave({
            officialStationId: data.get("station"),
            officialStationTimeOffset: Number(data.get("timeOffset")),
            officialStationHeightOffset: Number(data.get("heightOffset")),
            stationLocked: true,
          });
        }}
      >
        <label>
          参考港
          <select name="station" defaultValue={String(station.station_id)}>
            {official.candidates.map((candidate) => (
              <option
                value={String(candidate.station_id)}
                key={String(candidate.station_id)}
              >
                {String(candidate.station_name)}（
                {Number(candidate.distanceKm).toFixed(1)} km）
              </option>
            ))}
          </select>
        </label>
        <label>
          时间修正（分钟）
          <input
            name="timeOffset"
            type="number"
            min="-720"
            max="720"
            defaultValue={official.timeOffsetMinutes}
          />
        </label>
        <label>
          潮高修正（m）
          <input
            name="heightOffset"
            type="number"
            step="0.01"
            min="-10"
            max="10"
            defaultValue={official.heightOffsetM}
          />
        </label>
        <button type="submit">保存并锁定参考港</button>
        <button
          type="button"
          onClick={() =>
            onSave({
              stationLocked: false,
              officialStationId: null,
              officialStationTimeOffset: 0,
              officialStationHeightOffset: 0,
            })
          }
        >
          恢复自动匹配
        </button>
      </form>
      <small>{official.interpolationNotice}</small>
    </div>
  );
}
