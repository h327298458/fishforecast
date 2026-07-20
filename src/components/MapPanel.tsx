import { Crosshair, LoaderCircle, MapPin, Search, Star } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { searchLocations } from "../api";
import type { LocationPoint, SavedSpot } from "../types";

export function MapPanel({
  point,
  saved,
  onSelect,
  onSavedSelect,
  onLocate,
}: {
  point: LocationPoint | null;
  saved: SavedSpot[];
  onSelect: (point: LocationPoint) => void;
  onSavedSelect: (spot: SavedSpot) => void;
  onLocate: (position: GeolocationPosition) => void;
}) {
  const [query, setQuery] = useState(""),
    [results, setResults] = useState<LocationPoint[]>([]),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [activeIndex, setActiveIndex] = useState(-1),
    [locating, setLocating] = useState(false);
  const request = useRef<AbortController | null>(null),
    skipNextSearch = useRef(false),
    pointRef = useRef(point);
  useEffect(() => {
    pointRef.current = point;
  }, [point]);
  useEffect(() => {
    if (skipNextSearch.current) {
      skipNextSearch.current = false;
      return;
    }
    if (query.trim().length < 3) return;
    const timer = setTimeout(async () => {
      request.current?.abort();
      const controller = new AbortController();
      request.current = controller;
      setLoading(true);
      setError("");
      try {
        const data = await searchLocations(
          query,
          pointRef.current ?? undefined,
          controller.signal,
        );
        const uniqueResults = [...new Map(data.map((item) => [
          `${item.id}:${item.latitude.toFixed(6)}:${item.longitude.toFixed(6)}`,
          item,
        ])).values()];
        setResults(uniqueResults);
        setActiveIndex(uniqueResults.length ? 0 : -1);
        if (!uniqueResults.length) setError("没有找到澳大利亚范围内的结果");
      } catch (err) {
        if ((err as Error).name !== "AbortError")
          setError(err instanceof Error ? err.message : "搜索失败");
      } finally {
        if (request.current === controller) setLoading(false);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [query]);
  function choose(result: LocationPoint) {
    request.current?.abort();
    skipNextSearch.current = true;
    onSelect(result);
    setQuery(result.address);
    setResults([]);
    setActiveIndex(-1);
    setLoading(false);
  }
  function keyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!results.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (event.key === "Enter" && activeIndex >= 0) {
      event.preventDefault();
      choose(results[activeIndex]);
    } else if (event.key === "Escape") setResults([]);
  }
  function locate() {
    setLocating(true);
    setError("");
    if (!navigator.geolocation) {
      setError("当前浏览器不支持定位");
      setLocating(false);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        onLocate(position);
        setLocating(false);
      },
      (err) => {
        setError(
          err.code === 1
            ? "定位权限被拒绝"
            : err.code === 3
              ? "定位超时"
              : "无法获取当前位置",
        );
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  }
  function updateQuery(value: string) {
    const next = value.slice(0, 80);
    setQuery(next);
    if (next.trim().length < 3) {
      request.current?.abort();
      setResults([]);
      setError("");
      setLoading(false);
    }
  }
  return (
    <aside className="map-panel">
      <div className="search-block">
        <label htmlFor="spot-search">搜索钓点（仅限澳大利亚）</label>
        <div className="search-input">
          <Search size={16} />
          <input
            id="spot-search"
            value={query}
            onChange={(e) => updateQuery(e.target.value)}
            onKeyDown={keyDown}
            aria-label="搜索澳大利亚钓点"
            aria-expanded={results.length > 0}
            aria-controls="search-results"
            aria-activedescendant={
              activeIndex >= 0 ? `search-${activeIndex}` : undefined
            }
            placeholder="地址、海滩、码头或 suburb"
            autoComplete="off"
          />
          {loading ? (
            <LoaderCircle className="spin" size={16} />
          ) : (
            <button
              type="button"
              aria-label="使用当前位置"
              onClick={locate}
              disabled={locating}
            >
              {locating ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <Crosshair size={16} />
              )}
            </button>
          )}
        </div>
        {results.length ? (
          <div id="search-results" className="search-results" role="listbox">
            {results.map((result, index) => (
              <button
                id={`search-${index}`}
                role="option"
                aria-selected={activeIndex === index}
                className={activeIndex === index ? "active" : ""}
                key={`${result.id}:${result.latitude.toFixed(6)}:${result.longitude.toFixed(6)}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(result)}
              >
                <MapPin size={15} />
                <span>
                  <b>{result.name}</b>
                  <small>{result.address}</small>
                </span>
              </button>
            ))}
          </div>
        ) : null}
        {error ? (
          <p className="search-error" role="status">
            {error}
          </p>
        ) : null}
        {point ? (
          <div className="coordinate-fields">
            <label>
              纬度
              <input value={point.latitude.toFixed(6)} readOnly />
            </label>
            <label>
              经度
              <input value={point.longitude.toFixed(6)} readOnly />
            </label>
          </div>
        ) : (
          <p className="search-hint">搜索或点击地图选择真实坐标</p>
        )}
      </div>
      <div className="saved-title">
        <strong>我的钓点</strong>
        <span>{saved.length}</span>
      </div>
      <div className="spot-list">
        {saved.length ? (
          saved.map((spot) => (
            <button
              key={spot.id}
              onClick={() => onSavedSelect(spot)}
              className={point?.id === spot.id ? "active" : ""}
            >
              <MapPin size={17} />
              <span>
                <b>{spot.name}</b>
                <small>
                  {spot.address ||
                    `${spot.latitude.toFixed(4)}, ${spot.longitude.toFixed(4)}`}
                </small>
              </span>
              {point?.id === spot.id ? (
                <Star size={16} fill="currentColor" />
              ) : null}
            </button>
          ))
        ) : (
          <p className="empty-saved">尚未保存钓点</p>
        )}
      </div>
      <div className="source-box">
        <b>ⓘ 数据来源</b>
        <span>地图：OpenStreetMap</span>
        <span>搜索：Photon / OSM</span>
        <span>天气：Open-Meteo</span>
        <span>海洋：Open-Meteo Marine（按水域适用性）</span>
        <span>潮汐：官方参考港 / EOT20（按实际可用性）</span>
        <span>预警与实况：BOM 官方产品</span>
      </div>
    </aside>
  );
}
