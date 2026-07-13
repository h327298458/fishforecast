import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  Bell,
  BookOpen,
  Fish,
  Home,
  LoaderCircle,
  Map,
  RefreshCw,
  Save,
  Settings,
  ShieldAlert,
  Star,
} from "lucide-react";
import {
  getAnalytics,
  getForecast,
  getLogs,
  getSpots,
  reverseLocation,
  saveEnvironmentPreferences,
  saveSpot,
} from "./api";
import type {
  FishingLog,
  Forecast,
  LocationPoint,
  SavedSpot,
  TideSource,
} from "./types";
import { MapPanel } from "./components/MapPanel";
import { MapView } from "./components/MapView";
import { MetricRow } from "./components/MetricRow";
import { TideChart, WindChart } from "./components/Charts";
import { LogModal } from "./components/LogModal";
import { SystemStatusPage } from "./components/SystemStatusPage";
import { EnvironmentEvidence } from "./components/EnvironmentEvidence";
import "./styles.css";

type View = "forecast" | "logs" | "analytics" | "settings";
export default function App() {
  if (window.location.pathname === "/system-status")
    return <SystemStatusPage />;
  return <ForecastApp />;
}
function ForecastApp() {
  const [point, setPoint] = useState<LocationPoint | null>(null),
    [saved, setSaved] = useState<SavedSpot[]>([]),
    [forecast, setForecast] = useState<Forecast | null>(null),
    [day, setDay] = useState(0),
    [spotType, setSpotType] = useState("wharf"),
    [method, setMethod] = useState("bottom_fishing"),
    [tideSource, setTideSource] = useState<TideSource>("BOM_OFFICIAL"),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [modal, setModal] = useState(false),
    [toast, setToast] = useState(""),
    [accuracy, setAccuracy] = useState<number | null>(null),
    [view, setView] = useState<View>("forecast"),
    [logs, setLogs] = useState<FishingLog[]>([]),
    [analytics, setAnalytics] = useState<Record<
      string,
      number | boolean
    > | null>(null);
  const reverseRequest = useRef<AbortController | null>(null);
  const load = useCallback(
    async (
      target: LocationPoint,
      type = spotType,
      fishing = method,
      source = tideSource,
    ) => {
      setLoading(true);
      setError("");
      try {
        setForecast(await getForecast(target, type, fishing, source));
        setDay(0);
      } catch (e) {
        setForecast(null);
        setError(e instanceof Error ? e.message : "预测加载失败");
      } finally {
        setLoading(false);
      }
    },
    [spotType, method, tideSource],
  );
  useEffect(() => {
    getSpots()
      .then(async (items) => {
        setSaved(items);
        if (items[0]) {
          const first = items[0];
          setPoint(first);
          setSpotType(first.spotType);
          setMethod(first.fishingMethod);
          const initialTideSource=first.preferredTideSource??"BOM_OFFICIAL";
          setTideSource(initialTideSource);
          try {
            setForecast(
              await getForecast(first, first.spotType, first.fishingMethod,initialTideSource),
            );
          } catch (e) {
            setError(e instanceof Error ? e.message : "预测加载失败");
          }
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : "收藏读取失败"))
      .finally(() => setLoading(false));
  }, []);
  const select = useCallback(
    (next: LocationPoint, type = spotType, fishing = method) => {
      const nextSource='preferredTideSource' in next?(next as SavedSpot).preferredTideSource??tideSource:tideSource;
      setPoint(next);
      setTideSource(nextSource);
      setView("forecast");
      void load(next, type, fishing,nextSource);
    },
    [load, method, spotType,tideSource],
  );
  async function resolveCoordinate(latitude: number, longitude: number) {
    reverseRequest.current?.abort();
    const controller = new AbortController();
    reverseRequest.current = controller;
    setToast("正在反向解析地址…");
    try {
      const resolved = await reverseLocation(
        latitude,
        longitude,
        controller.signal,
      );
      const next = resolved
        ? {
            ...resolved,
            latitude,
            longitude,
            id: `draft-${latitude.toFixed(5)}-${longitude.toFixed(5)}`,
          }
        : {
            id: `manual-${latitude}-${longitude}`,
            name: "手动选择位置",
            address: `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`,
            latitude,
            longitude,
            state: "NSW",
            timezone: "Australia/Sydney",
          };
      setToast(resolved ? "地址已更新" : "未找到地址，已保留手动坐标");
      select(next);
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        const next = {
          id: `manual-${latitude}-${longitude}`,
          name: "手动选择位置",
          address: `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`,
          latitude,
          longitude,
          state: "NSW",
          timezone: "Australia/Sydney",
        };
        setToast("反向解析失败，已保留手动坐标");
        select(next);
      }
    }
  }
  function chooseSaved(spot: SavedSpot) {
    setSpotType(spot.spotType);
    setMethod(spot.fishingMethod);
    select(spot, spot.spotType, spot.fishingMethod);
  }
  async function persist() {
    if (!point) return;
    try {
      const stored = await saveSpot(point, spotType, method);
      setPoint(stored);
      const items = await getSpots();
      setSaved(items);
      setToast("钓点已保存为私有收藏");
    } catch (e) {
      setToast(e instanceof Error ? e.message : "保存失败");
    }
  }
  async function chooseTideSource(source: TideSource) {
    if (!point) return;
    setTideSource(source);
    try {
      if (saved.some((item) => item.id === point.id))
        await saveEnvironmentPreferences(point.id, source);
      await load(point, spotType, method, source);
      setToast(
        source === "NO_TIDE"
          ? "潮汐已从评分中移除"
          : `评分潮汐源已切换为 ${source}`,
      );
    } catch (e) {
      setToast(e instanceof Error ? e.message : "潮汐来源切换失败");
    }
  }
  async function saveOfficialSettings(options: Record<string, unknown>) {
    if (!point || !saved.some((item) => item.id === point.id)) {
      setToast("请先收藏钓点，再保存参考港设置");
      return;
    }
    try {
      await saveEnvironmentPreferences(point.id, "BOM_OFFICIAL", options);
      setTideSource("BOM_OFFICIAL");
      await load(point, spotType, method, "BOM_OFFICIAL");
      setToast(options.stationLocked === false ? "已恢复自动匹配参考港" : "参考港设置已保存");
    } catch (e) {
      setToast(e instanceof Error ? e.message : "参考港设置保存失败");
    }
  }
  async function showView(next: View) {
    setView(next);
    if (next === "logs")
      getLogs()
        .then(setLogs)
        .catch((e) => setError(String(e)));
    if (next === "analytics")
      getAnalytics()
        .then(setAnalytics)
        .catch((e) => setError(String(e)));
  }
  function currentLocation(position: GeolocationPosition) {
    const { latitude, longitude, accuracy: metres } = position.coords;
    if (
      latitude < -44 ||
      latitude > -10 ||
      longitude < 112 ||
      longitude > 154
    ) {
      setToast("当前位置不在澳大利亚支持范围内");
      return;
    }
    setAccuracy(Math.round(metres));
    void resolveCoordinate(latitude, longitude);
  }
  const current = forecast?.days[day],
    best = useMemo(
      () =>
        current?.hours.reduce(
          (a, b) =>
            a.score.fishingConditionScore > b.score.fishingConditionScore
              ? a
              : b,
          current.hours[0],
        ),
      [current],
    );
  const isSaved = Boolean(point && saved.some((item) => item.id === point.id));
  return (
    <div className="app">
      <header>
        <button className="brand" onClick={() => void showView("forecast")}>
          <span>≈</span>
          <b>潮汐线</b>
          <em>TideLine</em>
        </button>
        <nav>
          <button onClick={() => void showView("forecast")}>
            <Star />
            我的钓点
          </button>
          <button onClick={() => void showView("logs")}>
            <BookOpen />
            钓鱼日志
          </button>
          <button onClick={() => void showView("analytics")}>
            <BarChart3 />
            数据分析
          </button>
          <button onClick={() => void showView("settings")}>
            <Settings />
            设置
          </button>
        </nav>
        <div className="header-actions">
          <Bell />
          <span className="avatar">钓</span>
        </div>
      </header>
      <main>
        <MapPanel
          point={point}
          saved={saved}
          onSelect={select}
          onSavedSelect={chooseSaved}
          onLocate={currentLocation}
        />
        <MapView
          point={point}
          onCoordinate={(lat, lon) => void resolveCoordinate(lat, lon)}
        />
        <section className="workspace">
          {view === "logs" ? (
            <LogsView logs={logs} />
          ) : view === "analytics" ? (
            <AnalyticsView data={analytics} />
          ) : view === "settings" ? (
            <SettingsView />
          ) : loading ? (
            <div className="loading">
              <LoaderCircle />
              <b>正在获取真实天气、海洋和海平面数据…</b>
            </div>
          ) : error ? (
            <div className="loading error">
              <ShieldAlert />
              <b>{error}</b>
              {point ? (
                <button onClick={() => void load(point)}>
                  <RefreshCw />
                  重试
                </button>
              ) : null}
            </div>
          ) : forecast && current && best && point ? (
            <>
              <div className="spot-heading">
                <div>
                  <h1>
                    {point.name}{" "}
                    <Star fill={isSaved ? "currentColor" : "none"} />
                  </h1>
                  <p>{point.address}</p>
                  <small>
                    {point.latitude.toFixed(5)}, {point.longitude.toFixed(5)} ·{" "}
                    {point.timezone}
                    {accuracy ? ` · 定位精度约 ${accuracy} m` : ""}
                  </small>
                </div>
                <div>
                  <b>
                    {new Intl.DateTimeFormat("zh-CN", {
                      timeZone: point.timezone,
                      timeStyle: "short",
                    }).format(new Date())}
                  </b>
                  <span>
                    更新于{" "}
                    {new Date(forecast.generatedAtUtc).toLocaleTimeString(
                      "zh-CN",
                      { hour: "2-digit", minute: "2-digit" },
                    )}
                  </span>
                </div>
              </div>
              <div className="forecast-controls">
                <label>
                  钓点类型
                  <select
                    value={spotType}
                    onChange={(e) => {
                      setSpotType(e.target.value);
                      void load(point, e.target.value, method);
                    }}
                  >
                    <option value="wharf">码头岸钓</option>
                    <option value="estuary">河口/港湾</option>
                    <option value="beach">沙滩钓</option>
                    <option value="rock">岩钓</option>
                    <option value="freshwater">淡水岸钓</option>
                  </select>
                </label>
                <label>
                  钓法
                  <select
                    value={method}
                    onChange={(e) => {
                      setMethod(e.target.value);
                      void load(point, spotType, e.target.value);
                    }}
                  >
                    <option value="bottom_fishing">沉底钓</option>
                    <option value="lure">路亚</option>
                    <option value="float">浮漂钓</option>
                    <option value="surf_casting">沙滩远投</option>
                  </select>
                </label>
              </div>
              <h2>今天适合去吗？</h2>
              <div
                className={`status ${best.score.safetyStatus.toLowerCase()}`}
              >
                <ShieldAlert />
                <strong>
                  {best.score.safetyStatus === "UNKNOWN"
                    ? "安全状态未知"
                    : best.score.safetyStatus}
                </strong>
                <span>
                  {forecast.providerStatus.warnings.status === "available"
                    ? "BOM 州级警告已获取；区域匹配精度有限，请打开原文核实。"
                    : "BOM 警告无法获取，安全状态不得显示为安全。"}
                </span>
              </div>
              <MetricRow score={best.score} />
              <ProviderStrip status={forecast.providerStatus} />
              <EnvironmentEvidence
                forecast={forecast}
                timezone={point.timezone}
                onTideSource={(source) => void chooseTideSource(source)}
                onOfficialSettings={(options) => void saveOfficialSettings(options)}
              />
              <div className="day-tabs" role="tablist">
                {forecast.days.map((d, i) => (
                  <button
                    role="tab"
                    aria-selected={day === i}
                    className={day === i ? "active" : ""}
                    key={d.date}
                    onClick={() => setDay(i)}
                  >
                    <b>
                      {i === 0
                        ? "今天"
                        : i === 1
                          ? "明天"
                          : `周${["日", "一", "二", "三", "四", "五", "六"][new Date(d.date).getDay()]}`}
                    </b>
                    <span>{d.date.slice(5).replace("-", "/")}</span>
                  </button>
                ))}
              </div>
              <TideChart
                hours={current.hours}
                window={current.windows[0]}
                timezone={point.timezone}
              />
              <WindChart hours={current.hours} />
              <div className="factor-grid">
                <article className="positive">
                  <h3>有利因素</h3>
                  {best.score.positives.map((x) => (
                    <p key={x}>✓ {x}</p>
                  ))}
                </article>
                <article className="negative">
                  <h3>不利因素</h3>
                  {best.score.negatives.map((x) => (
                    <p key={x}>! {x}</p>
                  ))}
                </article>
              </div>
              <div className="footer-actions">
                <p>
                  <ShieldAlert /> 请在出发前核对最新官方预报和当地法规
                </p>
                <button onClick={() => void persist()}>
                  <Save />
                  {isSaved ? "更新钓点" : "保存钓点"}
                </button>
                <button
                  className="primary"
                  disabled={!isSaved}
                  title={isSaved ? "记录本次实钓" : "请先保存钓点"}
                  onClick={() => setModal(true)}
                >
                  <Fish />
                  开始钓鱼
                </button>
              </div>
            </>
          ) : (
            <div className="empty-workspace">
              <Map />
              <h1>搜索或点击地图选择钓点</h1>
              <p>
                选择澳大利亚境内的真实坐标后，系统才会请求预测；不会用固定测试地点替代。
              </p>
            </div>
          )}
        </section>
      </main>
      <nav className="mobile-nav">
        {(
          [
            [Home, "首页", "forecast"],
            [Map, "地图", "forecast"],
            [BookOpen, "日志", "logs"],
            [BarChart3, "分析", "analytics"],
            [Settings, "设置", "settings"],
          ] as const
        ).map(([Icon, label, target]) => (
          <button key={label} onClick={() => void showView(target)}>
            <Icon size={20} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      {modal && point ? (
        <LogModal
          spotId={point.id}
          forecastSnapshotId={forecast?.snapshotId}
          onClose={() => {
            setModal(false);
            void showView("logs");
          }}
        />
      ) : null}
      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  );
}
function ProviderStrip({ status }: { status: Forecast["providerStatus"] }) {
  return (
    <div className="provider-strip">
      {Object.entries(status).map(([key, item]) => (
        <span key={key} className={item.status === "available" ? "ok" : "warn"}>
          <b>{key}</b> {item.status}
          {item.reason ? ` · ${item.reason}` : ""}
        </span>
      ))}
    </div>
  );
}
function LogsView({ logs }: { logs: FishingLog[] }) {
  return (
    <div className="secondary-view">
      <h1>实钓历史</h1>
      {logs.length ? (
        logs.map((log) => (
          <article key={log.id}>
            <b>{new Date(log.startedAtUtc).toLocaleString("zh-CN")}</b>
            <span>
              {log.method} · 鱼口 {log.bites} · 上鱼 {log.catches} · 评分{" "}
              {log.rating}/4
            </span>
            {log.notes ? <p>{log.notes}</p> : null}
            {log.comparisonJson ? <LogComparison value={log.comparisonJson} /> : null}
          </article>
        ))
      ) : (
        <p>尚无实钓记录。从已保存钓点的预测页开始记录。</p>
      )}
    </div>
  );
}
function LogComparison({ value }: { value: string }) {
  try {
    const comparison = JSON.parse(value) as { snapshotAvailable?: boolean; trainingEligible?: boolean; reason?: string; tideSource?: string };
    return <small>预测快照 {comparison.snapshotAvailable ? "已关联" : "缺失"} · 潮汐源 {comparison.tideSource ?? "—"} · {comparison.trainingEligible ? "可作为环境样本" : `不作为纯环境样本：${comparison.reason ?? "未说明"}`}</small>;
  } catch { return <small>历史比较数据格式无效</small>; }
}
function AnalyticsView({
  data,
}: {
  data: Record<string, number | boolean> | null;
}) {
  return (
    <div className="secondary-view">
      <h1>数据分析</h1>
      {data ? (
        <div className="analytics-grid">
          <article>
            <b>{String(data.sessions)}</b>
            <span>总出钓次数</span>
          </article>
          <article>
            <b>{String(data.blankRate)}%</b>
            <span>空军率</span>
          </article>
          <article>
            <b>{String(data.bites)}</b>
            <span>鱼口总数</span>
          </article>
          <article>
            <b>{String(data.catches)}</b>
            <span>上鱼总数</span>
          </article>
        </div>
      ) : (
        <p>正在读取…</p>
      )}
      {data?.insufficientSample ? (
        <p className="sample-warning">当前样本量不足，结果仅供参考。</p>
      ) : null}
    </div>
  );
}
function SettingsView() {
  return (
    <div className="secondary-view">
      <h1>设置与系统状态</h1>
      <p>默认单位：°C、km/h、mm、hPa、m、km。</p>
      <a className="status-link" href="/system-status">
        打开 Provider 与降级状态审计页 →
      </a>
    </div>
  );
}
