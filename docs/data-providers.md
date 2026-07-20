# 数据源登记

最后核验日期：2026-07-20。所有缓存回退都必须携带生成时间和 stale 标记；生产代码不生成示例天气或模拟潮汐。

| 服务 / Provider | 功能 | 官方文档与格式 | 认证 / 费用 | 缓存 / 许可 | 覆盖与局限 | 状态 |
|---|---|---|---|---|---|---|
| PhotonGeocodingProvider | 澳大利亚搜索、反向解析 | [Photon API](https://github.com/komoot/photon/blob/master/docs/api-v1.md)，JSON | 无 key，公共实例免费且无 SLA | OSM attribution；搜索 10 分钟、反向 24 小时 | 澳大利亚边界过滤 | PARTIAL |
| OpenMeteoWeatherProvider | 七天逐小时天气与降雨 | [Open-Meteo Weather](https://open-meteo.com/en/docs)，JSON | 公共 API，无 key | 短期缓存，保留 attribution | 是预报，不是实况 | REAL |
| OpenMeteoMarineProvider | 波浪、涌浪、模型海平面趋势 | [Open-Meteo Marine](https://open-meteo.com/en/docs/marine-weather-api)，JSON | 公共 API，无 key | 短期缓存 | 保存请求/返回网格距离；港湾/河口低可信；`sea_level_height_msl` 只叫模型海平面趋势 | PARTIAL |
| BomOfficialTideProvider | NSW 官方参考港年度数据 | [BOM NSW Tide Tables](https://www.bom.gov.au/oceanography/projects/ntc/nsw_tide_tables.shtml)，官方年度文件 | 免费、无认证 | 原文件、URL、下载时间、SHA-256、解析器版本和事务导入 | 2026/2027：Eden、Newcastle、Port Kembla、Sydney (Fort Denison)、Yamba、Botany Bay；高度相对 LAT，且不是钓点现场潮位 | REAL（已覆盖导入范围） |
| MsqOfficialTideProvider | QLD 官方参考港序列 | [MSQ Open Data](https://www.msq.qld.gov.au/Tides/Open-data)，CSV | 免费、无认证 | CC BY 4.0；原文件与哈希保留 | Gold Coast Seaway 2026；全国覆盖不完整 | REAL（已覆盖导入范围） |
| Eot20TideProvider | 经纬度本地潮汐模型 | [GA eo-tides 安装](https://geoscienceaustralia.github.io/eo-tides/install/)、[模型设置](https://geoscienceaustralia.github.io/eo-tides/setup/)，NetCDF | 无按次费用 | EOT20 开放许可；模型不进 Git；坐标/整点范围/间隔/版本缓存 | `eo-tides 0.10.4`、EOT20-85762；高度相对 MSL；港湾/河口低可信，淡水不适用；缺文件返回明确错误 | REAL（模型挂载后） |

潮汐双源对比遵守垂直基准限制：BOM 参考港原始潮高（LAT）与 EOT20 模型潮高（MSL）不直接相减。系统比较高低潮事件时间及同一潮周期的潮差；曲线形状需要并排说明时，仅按该周期高低潮中点计算显示偏移，并明确标记这不是 LAT 与 MSL 的正式基准转换。
| BomWarningProvider | 官方警告与安全硬阻断 | [BOM RSS](https://www.bom.gov.au/rss/)，RSS/XML | 免费、匿名 | 10 分钟缓存，可标记旧缓存 | 州/标题区域与时间重叠已实现；CAP 几何和全国 Marine Zone 精确边界未完成 | PARTIAL |
| BomObservationProvider | 当前实况与短时预报校正 | [BOM Data Feeds](https://www.bom.gov.au/catalogue/data-feeds.shtml)，10-minute XML | 免费、匿名 | 10 分钟缓存 | 按距离、新鲜度、风/阵风/气压/雨量完整性排名；地形相似度有限 | PARTIAL |
| BomMarineForecastProvider | 官方海域文字第二意见 | [BOM Marine & Ocean](https://www.bom.gov.au/marine/)，TXT/HTML | 免费、匿名 | 45 分钟缓存 | 不是逐小时点预报；全国区域映射不完整 | PARTIAL |
| NswMhlWaveProvider | NSW 外海浮标实况 | [Data.NSW Ocean Wave Data](https://data.nsw.gov.au/data/en/dataset/nsw-ocean-wave-data-collection-program)，JSON | 免费公共访问 | 10 分钟缓存，保留站点/时间/来源 | 外海深水参考，不是岸边浪高；港湾/河口降权 | PARTIAL |
| WaterDataProvider | Brooklyn/Lower Hawkesbury 水位与降雨语境 | [Data.NSW Surface Water Monitoring](https://data.nsw.gov.au/data/en/dataset/surface-water-monitoring-streams)，JSON | 公共水位匿名；WaterNSW 完整 API 需注册 | 15 分钟缓存 | Spencer 测站受潮汐影响且公开路由无 discharge；上游降雨明确标为模型/分析 | PARTIAL |
| SunCalc | 日出日落、晨昏、月相/月出月落 | npm `suncalc`，本地算法 | 免费、无网络 | 本地计算 | 月相权重为 0，待历史验证 | REAL |
| RegulationProvider | 官方休闲钓鱼与许可入口 | NSW/QLD/VIC/WA/SA/TAS/NT/ACT 政府网站，HTML | 免费、无认证 | 链接核验日期 2026-07-19 | 只提供官方入口，不维护易过期静态规则库，不判断某坐标必然可钓 | REAL |
