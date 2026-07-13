# 数据来源登记

## 2026-07-13 verification update

| Provider | Function | Official documentation / format | Auth / cost / limits | Licence / cache | Coverage and known limitations | Status |
|---|---|---|---|---|---|---|
| BomMarineForecastProvider | Government marine-zone second opinion | [BOM Gold Coast Waters](https://www.bom.gov.au/qld/forecasts/gold-coast-waters.shtml), official HTML; legacy BOM text products where available | Anonymous, free; 45-minute in-process cache | BOM attribution and source link retained | Sydney BOM text products and Gold Coast official HTML page verified. It is zone text, not an hourly point forecast; national zone mapping remains incomplete. | PARTIAL |
| NswMhlWaveProvider | NSW MHL offshore buoy observation | [Data.NSW ocean-wave dataset](https://data.nsw.gov.au/data/en/dataset/nsw-ocean-wave-data-collection-program), JSON from MHL public endpoint | Public `publicwww` access, no paid key; 10-minute cache | Data.NSW states CC BY; station/source URL and observation time retained | Seven offshore NSW buoys. Sydney buoy verified for Bondi, Walsh Bay and Brooklyn. It is a deep-water regional reference, never shore wave height; harbour/estuary use is LOW_CONFIDENCE. | PARTIAL |
| WaterDataProvider | Brooklyn / lower Hawkesbury water-level context | [WaterNSW real-time water metadata](https://data.nsw.gov.au/data/en/dataset/surface-water-monitoring-streams), public MHL JSON `latest-readings` and `rawdatatable` | WaterNSW documented API requires registration/subscription; this public MHL route is anonymous and free | NSW source URL, observation time and 15-minute cache retained | Spencer level gauge is 12.5 km from Brooklyn and is tidally influenced. Level trends are real; it has no public discharge series through this route. North Richmond upstream rainfall is explicitly Open-Meteo model/analysis. | PARTIAL |

最后核验日期：2026-07-11。状态是当前代码与本机数据的真实状态，不因“存在接口文件”而升级。

| 服务名称 / Provider | 功能 | 官方文档与格式 | 认证 / 费用 / 调用限制 | 许可与缓存 | 适用区域 / 已知局限 / 降级 | 状态 |
|---|---|---|---|---|---|---|
| PhotonGeocodingProvider | AU 地址搜索、反向解析 | [Photon API](https://github.com/komoot/photon/blob/master/docs/api-v1.md)，JSON | 无 key；公共实例无 SLA；免费 | OSM attribution；搜索 10 分钟、反向 24 小时 | 澳大利亚边界过滤；失败保留地图坐标 | PARTIAL |
| OpenMeteoWeatherProvider | 7 天逐小时预报、近期降雨 | [Weather API](https://open-meteo.com/en/docs)，JSON | 非商业公共 API 无 key；免费；8 秒超时 | 遵守 Open-Meteo attribution；短期缓存 | 预报不是实测；失败不生成示例值 | REAL |
| OpenMeteoMarineProvider | 波浪/涌浪、模型海平面趋势 | [Marine API](https://open-meteo.com/en/docs/marine-weather-api)，JSON | 无 key；免费公共服务 | 短期缓存 | 保存返回网格与距离；港湾/河口 LOW_CONFIDENCE，淡水 NOT_APPLICABLE；`sea_level_height_msl` 仅叫 `modelSeaLevelTrend`，不作正式潮汐 | PARTIAL |
| BomOfficialTideProvider / MSQ | 官方站点预测潮位导入 | [BOM NSW Tide Tables](https://www.bom.gov.au/oceanography/projects/ntc/nsw_tide_tables.shtml)，PDF 文本层；[MSQ open data](https://www.msq.qld.gov.au/Tides/Open-data)，CSV | 无认证、免费、年度文件 | BOM attribution/modified-product disclaimer；MSQ CC BY 4.0；原文件、SHA-256、解析版本及事务导入长期保留 | NSW 已真实导入 2026/2027 Eden、Newcastle、Port Kembla、Sydney (Fort Denison)、Yamba、Botany Bay；QLD Gold Coast Seaway 2026；均为参考港而非钓点现场潮位；最后核验 2026-07-12 | REAL |
| Eot20TideProvider | 本地经纬度潮汐模型 | [GA eo-tides setup](https://geoscienceaustralia.github.io/eo-tides/setup/)，NetCDF；EOT20 DOI 10.17882/79489 | 无按次费用；官方 archive 2,330,678,793 bytes | EOT20 CC BY 4.0；模型不进 Git；按坐标、日期、间隔、版本与 manifest 缓存 | 当前实例以 `eo-tides 0.10.4` 真实运行 `EOT20-85762`，17 个分潮文件，归档 SHA-256 `bced7af7…e07018`；港湾/河口低可信度；淡水不适用；最后核验 2026-07-12 | REAL |
| BomWarningProvider | 当前官方警告 | [BOM RSS](https://www.bom.gov.au/rss/)、[warning guide](https://www.bom.gov.au/catalogue/Bureau_of_Meteorology_warning_products_user_guide.pdf)，RSS/XML | 无认证、免费匿名产品；服务无 SLA | BOM attribution/link；10 分钟缓存，可显式 stale 回退 | 已解析州级 RSS；CAP 几何与精确 expiry 未完成，只能州/标题区域匹配 | PARTIAL |
| BomObservationProvider | 当前实况 | [BOM data feeds](https://www.bom.gov.au/catalogue/data-feeds.shtml)、[10-minute XML guide](https://www.bom.gov.au/catalogue/Observations-XML.pdf)，XML | 无认证、免费匿名产品 | BOM attribution；10 分钟缓存 | 候选按距离/新鲜度/完整度排序；地形相似性仍有限 | PARTIAL |
| BomMarineForecastProvider | 官方海域文字第二意见 | [BOM text forecast guide](https://www.bom.gov.au/catalogue/Bureau_of_Meteorology_text_forecasts_user_guide.pdf)，TXT | 无认证、免费匿名产品 | BOM attribution；45 分钟缓存 | 已验证 Sydney Enclosed/Coastal；Gold Coast 产品页存在但 `.txt` 当前 404；不是逐小时点预报；全国 zone map 未完成 | PARTIAL |
| WaterDataProvider | 河流水位/流量 | [Water Data Online FAQ/API](https://www.bom.gov.au/waterdata/wiski-web-public/faq.htm)、SOS2/WaterML2 | 无 key、免费；官方明确有限频率/体积保护 | 供应者许可不一；应长缓存 | 2026-07-11 GetCapabilities 与 bbox 请求均 HTTP 500；未获取 Brooklyn 水位，绝不返回假值 | BLOCKED_BY_PROVIDER_LIMITATION |
| SunCalc local | 日出日落、晨昏、月相/月出月落 | npm `suncalc`，本地算法 | 无认证、无网络、免费开源 | 可按坐标/日期缓存 | 月相权重为 0，明确为待验证变量 | REAL |
| NswMhlWaveProvider | NSW 外海浮标实况 | NSW MHL 官方开放数据（待接入） | 待核验 | 待核验 | 本版本没有适配器；外海浮标不能等同岸边浪高 | NOT_IMPLEMENTED |
| RegulationProvider | 官方法规入口 | 各州渔业主管部门 | 无认证 | 定期核验链接 | 本版本尚未展示官方入口，不维护静态全国规则库 | NOT_IMPLEMENTED |

## 已联网验证

- BOM NSW `IDN60920.xml`：HTTP 200，真实站点、风/阵风/气压字段。
- BOM NSW `IDZ00054.warnings_nsw.xml`：HTTP 200，含 Marine Wind、Severe Thunderstorm、Severe Weather 条目。
- BOM `IDN11013.txt`、`IDN11009.txt`：HTTP 200；`IDQ11311.txt` 当前 HTTP 404，未标记可用。
- MSQ Gold Coast 2026 CSV：52,560 条 10 分钟读数，提取 1,410 个转折事件。
- BOM Water Data Online SOS2：本次 HTTP 500，故 Brooklyn 水位未完成。
