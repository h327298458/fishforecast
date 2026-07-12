# 潮汐线 TideLine

面向澳大利亚、移动端优先的可解释钓鱼环境预测与出钓决策 MVP。系统分开显示安全性、舒适度、鱼口条件和数据可信度；规则输出不是“上鱼概率”，也不构成导航、安全认证或法规结论。

## 快速启动

```bash
cp .env.example .env
npm install
npm run db:migrate
npm run dev
```

打开 `http://localhost:5173`。API 位于 `http://localhost:8787/api/health`，系统审计页位于 `http://localhost:5173/system-status`。也可使用 `docker compose up --build`。

完整流程：搜索澳大利亚地点 → 选择候选 → 地图定位 → 点击或拖动标记 → 自动反向解析 → 选择钓点类型/钓法 → 保存钓点 → 查看 7 天预测与最佳窗口 → 保存实钓 → 在日志与分析页重新读取。

## 架构

```text
React + Leaflet → Fastify API → forecast/scoring modules
                              → provider ports → Photon / Open-Meteo
                              → SQLite → spots / snapshots / fishing logs
```

技术取舍见 `docs/architecture-decision.md`，数据源状态见 `docs/data-providers.md`，未完成项见 `docs/remaining-gaps.md`。

## 真实地图和搜索

- 地图：Leaflet + OpenStreetMap 标准瓦片；支持缩放、平移、点击选点和拖动标记。
- 搜索/反向解析：Photon 公共实例，经后端代理；请求强制 `countrycode=AU` 与澳大利亚边界框。
- 搜索具有 350ms 防抖、最小 3 字符、旧请求取消、键盘选择、加载/空结果/网络错误状态。
- 浏览器定位只在用户点击按钮后请求权限；显示定位精度，不自动保存。
- Photon 或瓦片失败时明确显示错误；仍保留地图点击或最终坐标。

公共 Photon 与 OSM 瓦片均无 SLA，生产商业部署应改为自托管 Photon 和商业/自托管瓦片。不要批量预取或离线下载 OSM 标准瓦片。

## 数据源

- 天气：Open‑Meteo 7 天逐小时天气，真实网络数据。
- 海洋：Open‑Meteo Marine 波高、涌浪和周期。
- 潮汐：并存 BOM/MSQ 官方参考港导入与 GA `eo-tides`/EOT20 本地模型。当前导入 NSW 六站 2026/2027 与 Gold Coast Seaway 2026；当前开发实例已安装 `EOT20-85762`，其他部署仍需运行安装脚本。Open‑Meteo `sea_level_height_msl` 只作为“模型海平面变化趋势”，不参与正式潮汐评分。
- 日照/月相：SunCalc 按钓点坐标本地计算；月相权重为 0。
- 官方警告/实况：BOM RSS 与州级 10 分钟 XML；警告无法获取时安全状态为 UNKNOWN。
- 官方海域第二意见：BOM 区域文字产品；不会伪装成逐小时点预报。

当前真实数据源不需要 API key。环境变量见 `.env.example`。第三方 URL 固定于服务端配置，用户不能提交任意 URL。

### 安装 EOT20 本地模型

EOT20 模型采用 CC BY 4.0，`eo-tides` 代码不会附带模型 NetCDF。模型文件很大，不提交 Git：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup-eot20-python.ps1 -Python <Python-3.12-path>
powershell -ExecutionPolicy Bypass -File .\scripts\install-eot20.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\check-eot20.ps1
```

设置 `EOT20_MODEL_PATH`、`EOT20_CACHE_PATH` 和 `EOT20_PYTHON`。官方 SEANOE 下载端点不支持可靠 Range/断点续传，安装器下载到临时文件，只有总字节数校验成功后才写入正式 archive。模型来源 DOI `10.17882/79489`；应用显示 EOT20 为全球模型而不是官方港口潮汐。

NSW 官方年度潮汐使用 BOM Tide Tables 文本层离线导入：

```powershell
npm run tides:nsw:download
npm run tides:nsw:import
npm run test:nsw-tides
```

原 PDF、官方 URL、下载时间与 SHA-256 保存在 `data/raw/tides/bom-nsw`；用户查询只读取 SQLite，不在页面打开时解析 PDF。

## 数据库

`npm run db:migrate` 创建/升级 `data/tideline.db`。钓点保存名称、最终地址、经纬度、州、IANA 时区、钓点类型和钓法；页面重开后从数据库读取。实钓记录通过外键关联已保存钓点，并可由日志和分析接口重新读取。

## 评分

规则位于 `server/domain/scoring.ts`，版本 `2026.07-trust.2`。缺失字段不会被当成理想值；权重只在可用字段间重新归一，并降低可信度。严重警告、极端阵风和岩钓浪高是硬阻断。官方警告未知时仍保持安全状态 UNKNOWN，可信度低于 45 的小时不会成为推荐窗口。

## 质量命令

```bash
npm run lint
npm test
npm run build
docker compose config --quiet
```

## 生产注意事项

增加认证和用户级授权后才能多用户发布；精确钓点默认应为私有。生产环境需要 TLS、固定 CORS allowlist、持久化缓存、请求预算、结构化日志脱敏、数据库备份和 Provider 监控。公共 Photon/OSM 服务应替换为有 SLA 的部署。
