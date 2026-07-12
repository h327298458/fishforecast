# ADR-001：MVP 技术栈与模块边界

## 候选方案

| 维度 | TypeScript 模块化单体（React + Fastify） | Python API（FastAPI + React） |
|---|---|---|
| 地图/可视化 | React 生态成熟，同一类型贯穿 UI/API | 前端同样优秀，但跨语言 DTO 需生成 |
| 外部 API/队列 | `fetch`、Fastify 与轻量调度足够 MVP | Python 数据处理与任务队列更强 |
| 未来分析/ML | 可导出标准特征至 Python 训练服务 | 原生优势明显 |
| 类型安全/测试 | 共享 Zod/TypeScript 模型，端到端简单 | Pydantic 很强，但跨边界维护较多 |
| 部署/维护 | 单进程、单镜像、认知成本较低 | 两套依赖与构建链 |

## 决策

采用 TypeScript 模块化单体：React 19 + Vite 8、Fastify 5、SQLite（MVP）与 Ports/Adapters。选择它是因为本阶段的主要复杂度是交互式地图、逐小时图表、Provider 编排和可解释规则，而不是模型训练；共享类型能降低前后端漂移，单镜像也符合 MVP 运维目标。

放弃 Python 主后端的主要原因是首版需要维护两套语言与模型映射。未来可把 `analytics`/`prediction` 端口后的训练与批量特征工程拆为 Python 服务；API、数据表与事件载荷保持版本化，不影响现有客户端。

## 模块与数据流

`Web/PWA → HTTP API → Forecast application service → provider ports → Open-Meteo / WorldTides / BOM fallback`。标准化后进入可解释评分引擎；安全硬阻断先执行，其余权重仅在可用字段上重新归一。SQLite 保存钓点、预测快照、实钓日志、缓存与来源元数据。

## 关键边界

- `providers/ports.ts`：第三方能力接口；业务层不依赖响应格式。
- `domain/scoring.ts`：纯函数规则与规则版本。
- `services/forecast.ts`：并行编排、降级、缓存与窗口合并。
- `db`：持久化适配器；未来迁往 PostgreSQL 时保持仓储接口。
- 安全状态不与鱼口分数求平均，严重警告和岩钓浪高会直接阻断。

## 地图与地理编码补充决策（2026-07-11）

MVP 使用 Leaflet 和 OpenStreetMap 标准瓦片实现真实交互地图，使用 Photon 的 `/api` 与 `/reverse` 作为 POI/地址服务。Photon 可搜索海滩、码头、公园和 suburb，并支持 `countrycode=AU`、澳大利亚边界框、位置偏置和反向解析；相比只覆盖城市/邮编的 Open‑Meteo Geocoding，更符合钓点搜索。

公共 Photon 和 OSM 标准瓦片没有 SLA，因此只标记为 PARTIAL。后端固定上游地址、防止 SSRF，限制查询长度，使用超时、限流、旧请求取消和 TTL 缓存。生产商业部署应通过同一 `GeocodingProvider` 更换为自托管 Photon/商业搜索服务，并更换为符合流量和缓存条款的瓦片供应商。

## ER 摘要

`spots 1—N forecast_snapshots`；`spots 1—N fishing_logs`；`forecast_snapshots 1—N fishing_logs`；`provider_cache` 以 provider、坐标精度、时间范围、变量和模型版本为键。所有时间以 UTC 持久化，并保存钓点 IANA 时区。
