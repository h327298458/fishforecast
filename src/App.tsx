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
  getCurrentUser,
  getEot20Tide,
  getForecast,
  getLogs,
  getSpotComparisons,
  getSpots,
  logout,
  reverseLocation,
  saveEnvironmentPreferences,
  saveSpot,
} from "./api";
import type { AuthUser } from "./api";
import type {
  FishingLog,
  Forecast,
  LocationPoint,
  SavedSpot,
  SpotComparison,
  TideSource,
  Window,
} from "./types";
import { MapPanel } from "./components/MapPanel";
import { MapView } from "./components/MapView";
import { MetricRow } from "./components/MetricRow";
import { TideChart, WindChart } from "./components/Charts";
import { LogModal } from "./components/LogModal";
import { SystemStatusPage } from "./components/SystemStatusPage";
import { EnvironmentEvidence } from "./components/EnvironmentEvidence";
import { AuthPage } from "./components/AuthPage";
import { InvitationManager } from "./components/InvitationManager";
import { AccountSecurity } from "./components/AccountSecurity";
import { SpotSafetySettings } from "./components/SpotSafetySettings";
import { SpotComparisonTable } from "./components/SpotComparisonTable";
import { TideSourceControl } from "./components/TideSourceControl";
import { ForecastProgressPanel } from "./components/ForecastProgressPanel";
import { createForecastProgress, updateForecastProgress, type ForecastProgress, type ForecastStageUpdate } from "./domain/forecastProgress";
import "./styles.css";

type View = "forecast" | "compare" | "logs" | "analytics" | "settings";
export default function App() {
  if (window.location.pathname === "/system-status")
    return <SystemStatusPage />;
  return <AuthenticatedApp />;
}
function AuthenticatedApp() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [checking, setChecking] = useState(true);
  useEffect(() => { getCurrentUser().then((result) => setUser(result.user)).catch(() => setUser(null)).finally(() => setChecking(false)); }, []);
  if (checking) return <div className="auth-loading"><LoaderCircle className="spin" />正在验证登录状态…</div>;
  return user ? <ForecastApp user={user} onSignedOut={() => setUser(null)} /> : <AuthPage onAuthenticated={setUser} />;
}
function ForecastApp({ user, onSignedOut }: { user: AuthUser; onSignedOut: () => void }) {
  const [point, setPoint] = useState<LocationPoint | null>(null),
    [saved, setSaved] = useState<SavedSpot[]>([]),
    [forecast, setForecast] = useState<Forecast | null>(null),
    [day, setDay] = useState(0),
    [spotType, setSpotType] = useState("wharf"),
    [method, setMethod] = useState("bottom_fishing"),
    [tideSource, setTideSource] = useState<TideSource>("BOM_OFFICIAL"),
    [loading, setLoading] = useState(true),
    [progress, setProgress] = useState<ForecastProgress | null>(null),
    [error, setError] = useState(""),
    [modal, setModal] = useState(false),
    [toast, setToast] = useState(""),
    [accuracy, setAccuracy] = useState<number | null>(null),
    [view, setView] = useState<View>("forecast"),
    [logs, setLogs] = useState<FishingLog[]>([]),
    [comparisons, setComparisons] = useState<SpotComparison[]>([]),
    [analytics, setAnalytics] = useState<Record<
      string,
      number | boolean
    > | null>(null);
  const reverseRequest = useRef<AbortController | null>(null);
  const loadSequence = useRef(0);
  async function signOut() { try { await logout(); } finally { onSignedOut(); } }
  const updateProgress = useCallback((requestId: number, updates: ForecastStageUpdate[]) => {
    setProgress((current) => current?.requestId === requestId ? updateForecastProgress(current, updates) : current);
  }, []);
  const load = useCallback(
    async (
      target: LocationPoint,
      type: string,
      fishing: string,
      source: TideSource,
    ) => {
      const requestId = ++loadSequence.current;
      setLoading(true);
      setForecast(null);
      setError("");
      setDay(0);
      setProgress(createForecastProgress(requestId));
      try {
        const baseForecast = await getForecast(target, type, fishing, source, true);
        if (loadSequence.current !== requestId) return;
        setForecast(baseForecast);
        setLoading(false);
        const officialAvailable = Boolean(baseForecast.tides.official?.events.length);
        updateProgress(requestId, [
          { id: "base", status: "completed", detail: "天气、风、Marine 与安全信息已可先查看" },
          { id: "official", status: "completed", detail: officialAvailable ? `已匹配 ${baseForecast.tides.official?.station.name ?? "官方参考港"}` : "当前时段没有匹配到可用的官方潮汐事件" },
        ]);
        if (baseForecast.tides.calculationStatus !== "PENDING") {
          updateProgress(requestId, [
            { id: "eot20", status: "completed", detail: baseForecast.tides.actualTideSourceUsed === "EOT20_MODEL" ? "模型结果已从缓存或本次请求取得" : "当前评分来源不需要运行 EOT20" },
            { id: "scoring", status: "completed", detail: "评分、图表和推荐窗口已完成" },
          ]);
          return;
        }
        updateProgress(requestId, [
          { id: "eot20", status: "running", detail: "正在加载本地 NetCDF 模型并计算 7 天潮位" },
          { id: "scoring", status: "pending", detail: "EOT20 完成后自动重算，不需要再次点击" },
        ]);
        try {
          const model = await getEot20Tide(target, type, baseForecast.tides.model.request);
          if (loadSequence.current !== requestId) return;
          updateProgress(requestId, [
            { id: "eot20", status: "completed", detail: model.cacheHit ? `EOT20 ${model.version} 已从缓存读取` : `EOT20 ${model.version} 本地计算完成` },
            { id: "scoring", status: "running", detail: "正在应用潮汐并重算评分、曲线与全部窗口" },
          ]);
          const finalForecast = await getForecast(target, type, fishing, source, false);
          if (loadSequence.current !== requestId) return;
          setForecast(finalForecast);
          setDay(0);
          updateProgress(requestId, [
            { id: "scoring", status: "completed", detail: "最终评分、潮汐曲线和推荐窗口已更新" },
          ]);
        } catch (modelError) {
          if (loadSequence.current !== requestId) return;
          updateProgress(requestId, [
            { id: "eot20", status: "error", detail: modelError instanceof Error ? modelError.message : "EOT20 模型计算失败" },
            { id: "scoring", status: "error", detail: "已保留天气与风浪结果；潮汐未被假数据替代" },
          ]);
        }
      } catch (e) {
        if (loadSequence.current !== requestId) return;
        setForecast(null);
        setError(e instanceof Error ? e.message : "预测加载失败");
        updateProgress(requestId, [{ id: "base", status: "error", detail: e instanceof Error ? e.message : "基础预测加载失败" }]);
      } finally {
        if (loadSequence.current === requestId) setLoading(false);
      }
    },
    [updateProgress],
  );
  useEffect(() => {
    let cancelled = false;
    getSpots()
      .then((items) => {
        if (cancelled) return;
        setSaved(items);
        if (items[0]) {
          const first = items[0];
          setPoint(first);
          setSpotType(first.spotType);
          setMethod(first.fishingMethod);
          const initialTideSource=first.preferredTideSource??"BOM_OFFICIAL";
          setTideSource(initialTideSource);
          void load(first, first.spotType, first.fishingMethod, initialTideSource);
        } else setLoading(false);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "收藏读取失败"))
      .finally(() => { if (!cancelled && loadSequence.current === 0) setLoading(false); });
    return () => { cancelled = true; };
  }, [load]);
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
      await load(stored, spotType, method, tideSource);
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
  async function saveSpotSafetySettings(options: Record<string, unknown>) {
    if (!point || !saved.some((item) => item.id === point.id)) {
      setToast("请先保存钓点，再设置现场安全属性");
      return;
    }
    try {
      await saveEnvironmentPreferences(point.id, tideSource, options);
      const items = await getSpots();
      setSaved(items);
      const updated = items.find((item) => item.id === point.id) ?? point;
      setPoint(updated);
      await load(updated, spotType, method, tideSource);
      setToast("钓点属性已保存，并已重新计算评分");
    } catch (e) {
      setToast(e instanceof Error ? e.message : "钓点属性保存失败");
    }
  }
  async function showView(next: View) {
    setView(next);
    if (next === "logs")
      getLogs()
        .then(setLogs)
        .catch((e) => setError(String(e)));
    if (next === "compare")
      getSpotComparisons()
        .then(setComparisons)
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
      () => {
        const generatedAt = new Date(forecast?.generatedAtUtc ?? 0).getTime();
        const actionable = current?.hours.filter(
          (hour) =>
            new Date(hour.timestampUtc).getTime() >= generatedAt - 3_600_000,
        );
        const candidates = actionable?.length ? actionable : current?.hours;
        return candidates?.reduce(
          (a, b) =>
            a.score.fishingConditionScore > b.score.fishingConditionScore
              ? a
              : b,
          candidates[0],
        );
      },
      [current, forecast?.generatedAtUtc],
    );
  const tideChartHours =
    forecast?.tides.actualTideSourceUsed === "EOT20_MODEL" &&
    forecast.tides.model.values?.length &&
    current
      ? forecast.tides.model.values
          .filter((value) => value.timestampLocal.slice(0, 10) === current.date)
          .map((value) => ({
            timestampUtc: value.timestampUtc,
            timestampLocal: value.timestampLocal,
            tideHeightM: value.heightM,
          }))
      : current?.hours;
  const isSaved = Boolean(point && saved.some((item) => item.id === point.id));
  const tideCalculationPending = forecast?.tides.calculationStatus === "PENDING";
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
          <button onClick={() => void showView("compare")}>
            <BarChart3 />
            钓点比较
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
          <span className="avatar" title={user.role}>{user.username.slice(0, 1).toUpperCase()}</span>
          <button className="logout-button" onClick={() => void signOut()}>退出</button>
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
          ) : view === "compare" ? (
            <SpotComparisonTable rows={comparisons} />
          ) : view === "analytics" ? (
            <AnalyticsView data={analytics} />
          ) : view === "settings" ? (
            <SettingsView user={user} />
          ) : loading ? (
            <div className="loading progressive-loading">
              {progress ? <ForecastProgressPanel progress={progress} /> : <><LoaderCircle /><b>正在获取真实天气、海洋和安全数据…</b></>}
            </div>
          ) : error ? (
            <div className="loading error">
              <ShieldAlert />
              <b>{error}</b>
              {point ? (
                <button onClick={() => void load(point, spotType, method, tideSource)}>
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
              {progress ? <ForecastProgressPanel progress={progress} /> : null}
              <div className="forecast-controls">
                <label>
                  钓点类型
                  <select
                    value={spotType}
                    onChange={(e) => {
                      setSpotType(e.target.value);
                      void load(point, e.target.value, method, tideSource);
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
                      void load(point, spotType, e.target.value, tideSource);
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
              {best.score.confidenceReasons.length ? (
                <p className="confidence-reasons">
                  <b>数据可信度依据：</b>{best.score.confidenceReasons.join("；")}
                </p>
              ) : null}
              <RecommendedWindows windows={current.windows} timezone={point.timezone} />
              <TideSourceControl
                forecast={forecast}
                busy={tideCalculationPending}
                onSelect={(source) => void chooseTideSource(source)}
              />
              <ProviderStrip status={forecast.providerStatus} />
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
              <WindChart hours={current.hours} />
              {tideCalculationPending ? (
                <div className="tide-calculation-placeholder" role="status">
                  <LoaderCircle className="spin" />
                  <span><b>EOT20 潮汐正在后台计算</b><small>风、天气和当前可用窗口已先展示；完成后这里会自动替换为真实潮汐曲线并重算窗口。</small></span>
                </div>
              ) : (
                <TideChart hours={tideChartHours ?? current.hours} windows={current.windows} timezone={point.timezone} />
              )}
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
              <details className="environment-details">
                <summary>查看潮汐、警告、实况、海域与水文依据</summary>
                <EnvironmentEvidence
                  key={`${point.id}-${forecast.tides.actualTideSourceUsed}`}
                  forecast={forecast}
                  timezone={point.timezone}
                  spotType={spotType}
                  onTideSource={(source) => void chooseTideSource(source)}
                  onOfficialSettings={(options) => void saveOfficialSettings(options)}
                />
              </details>
              <SpotSafetySettings key={point.id} spot={point as SavedSpot} saved={isSaved} onSave={saveSpotSafetySettings} />
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
        <span key={key} className={item.status === "available" ? "ok" : item.status === "pending" ? "pending" : "warn"}>
          <b>{key}</b> {item.status}
          {item.reason ? ` · ${item.reason}` : ""}
        </span>
      ))}
    </div>
  );
}
function RecommendedWindows({ windows, timezone }: { windows: Window[]; timezone: string }) {
  const format = (value: string) => new Intl.DateTimeFormat("zh-CN", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
  return <section className="recommended-windows"><div><h2>推荐出钓窗口</h2><small>仅显示安全状态为 SAFE、环境条件至少 72 分、数据可信度至少 55 分的连续 2–4 小时最佳片段。</small></div>{windows.length ? <div className="window-list">{windows.map((window) => <article key={window.startUtc}><b>{format(window.startUtc)}–{format(window.endUtc)}</b><span>环境条件 {window.averageScore}</span></article>)}</div> : <p>今天没有满足安全、可信度和环境阈值的连续窗口。</p>}</section>;
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
            {log.comparisonJson ? <DetailedLogComparison value={log.comparisonJson} /> : null}
          </article>
        ))
      ) : (
        <p>尚无实钓记录。从已保存钓点的预测页开始记录。</p>
      )}
    </div>
  );
}
function LogComparison({ value }: { value: string }) {
  type Comparison = { snapshotAvailable?: boolean; trainingEligible?: boolean; reason?: string; tideSource?: string };
  let comparison: Comparison | null = null;
  try {
    comparison = JSON.parse(value) as Comparison;
  } catch { /* Invalid legacy comparison data is rendered below. */ }
  if (!comparison) return <small>历史比较数据格式无效</small>;
  return <small>预测快照 {comparison.snapshotAvailable ? "已关联" : "缺失"} · 潮汐源 {comparison.tideSource ?? "—"} · {comparison.trainingEligible ? "可作为环境样本" : `不作为纯环境样本：${comparison.reason ?? "未说明"}`}</small>;
}
function DetailedLogComparison({ value }: { value: string }) {
  void LogComparison;
  type Comparison = { snapshotAvailable?: boolean; trainingEligible?: boolean; reason?: string; tideSource?: string; windowHit?: boolean; predictedSafetyStatus?: string | null; predictedFishingConditionScore?: number | null; predictedConfidenceScore?: number | null; forecastWindKmh?: number | null; observedWindKmh?: number | null; windBiasKmh?: number | null };
  let comparison: Comparison | null = null;
  try { comparison = JSON.parse(value) as Comparison; } catch { return <small>历史比较数据格式无效</small>; }
  return <div className="log-comparison">
    <b>预测与实际</b>
    <span>预测快照：{comparison.snapshotAvailable ? "已关联" : "缺失"}</span>
    <span>推荐窗口：{comparison.windowHit ? "实际出钓与窗口重叠" : "未命中或无窗口"}</span>
    <span>出钓时预测：安全 {comparison.predictedSafetyStatus ?? "—"} · 环境 {comparison.predictedFishingConditionScore ?? "—"} · 可信度 {comparison.predictedConfidenceScore ?? "—"}</span>
    <span>风速：预报 {comparison.forecastWindKmh ?? "—"} / BOM快照实测 {comparison.observedWindKmh ?? "—"} km/h{comparison.windBiasKmh == null ? "" : `（偏差 ${comparison.windBiasKmh > 0 ? "+" : ""}${comparison.windBiasKmh}）`}</span>
    <span>潮汐源：{comparison.tideSource ?? "—"}</span>
    <span>{comparison.trainingEligible ? "可作为环境结果样本" : `存在装备问题，不作为纯环境样本（${comparison.reason ?? "未说明"}）`}</span>
  </div>;
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
function SettingsView({ user }: { user: AuthUser }) {
  return (
    <div className="secondary-view">
      <h1>设置与系统状态</h1>
      <p>默认单位：°C、km/h、mm、hPa、m、km。</p>
      <a className="status-link" href="/system-status">
        打开 Provider 与降级状态审计页 →
      </a>
      <AccountSecurity user={user} />
      {user.role === "ADMIN" ? <InvitationManager /> : null}
    </div>
  );
}
