# TideLine 澳大利亚个人钓鱼决策系统

TideLine 分开显示安全状态、安全评分、舒适度、鱼口环境条件和数据可信度。它不把评分称为上鱼概率，也不替代 BOM 警告、现场判断或当地法规。

## 本地启动

```bash
cp .env.example .env
# 首次启动必须在 .env 设置唯一的 INITIAL_ADMIN_PASSWORD
npm install
npm run db:migrate
npm run dev
```

打开 `http://localhost:5173`。API 默认位于 `http://localhost:8787`，状态页为 `/system-status`。首个用户由环境变量创建为管理员；之后只能使用管理员生成的邀请码注册。密码以 scrypt 哈希保存，会话 Cookie 为 HttpOnly + SameSite=Strict；设置页支持改密、禁用用户和撤销会话。

## Ubuntu / Docker（推荐）

1 核/1GB 或 2 核/1GB 主机请使用独立部署文件，不要修改根目录旧 Compose：

```bash
cp .env.example .env.server
# 编辑 .env.server：设置 INITIAL_ADMIN_PASSWORD、EOT20_MODEL_PATH、ALLOWED_ORIGIN
docker compose --env-file .env.server \
  -f deploy/compose.server.yml \
  -f deploy/compose.low-memory.yml \
  up -d --build
```

完整模型目录、更新和验证命令见 [`deploy/README.md`](deploy/README.md)。服务器本地值全部保留在被 Git 忽略的 `.env.server`；后续更新直接：

```bash
git pull --ff-only origin master
docker compose --env-file .env.server \
  -f deploy/compose.server.yml \
  -f deploy/compose.low-memory.yml \
  up -d --build
```

## EOT20 模型

应用使用 Geoscience Australia `eo-tides` 支持的开放 EOT20 NetCDF。模型约 2.3GB，不进入 Git，也不复制进 Docker 镜像；服务端只读挂载：

```text
data/tide-models/EOT20/ocean_tides/*_ocean_eot20.nc
```

Windows 安装与校验：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup-eot20-python.ps1 -Python <Python-3.12-path>
powershell -ExecutionPolicy Bypass -File .\scripts\install-eot20.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\check-eot20.ps1
```

有覆盖事件的官方参考港模式不会为对比而额外阻塞等待 Python。若默认官方源没有覆盖事件、用户没有锁定官方站且本机 EOT20 可用，系统会明确提示并自动采用 EOT20，避免首次使用出现空潮汐；用户仍可在推荐窗口下方直接切换来源。请求范围对齐 UTC 整点并覆盖当前本地日，使内存及磁盘缓存可以复用、曲线不会把首个值向午夜倒推。缺少或损坏模型时返回明确 `MODEL_FILES_MISSING`/校验错误，绝不生成正弦假潮汐。

## 数据与适用性

- 地图与地址：Leaflet、OpenStreetMap、Photon；公共服务无 SLA。
- 天气：Open-Meteo 七天逐小时预报。
- Marine：Open-Meteo Marine；保存网格距离，港湾/河口降为低可信，淡水不适用。
- 官方潮汐：NSW BOM 2026/2027 六个参考港，QLD MSQ Gold Coast 2026。
- 模型潮汐：EOT20 本地计算；不是官方港口潮汐。
- 警告、实况、海域预报：BOM 官方 RSS/XML/TXT/HTML；无法核实警告时安全状态为 UNKNOWN。
- NSW 海浪：MHL 外海浮标；绝不称为岸边实测浪高。
- Brooklyn 水文：Spencer 水位趋势与上游降雨语境；不硬编码“水越高越好钓”。
- 法规：只链接各州/领地官方入口，不维护易过期全国静态规则库。

Open-Meteo `sea_level_height_msl` 在代码、API 和 UI 中只叫“模型海平面变化趋势”，不是正式潮汐。

## 评分透明性

EOT20 尚在计算时，页面只显示“临时环境评分（未计潮汐）”，临时时段也会标记为待潮汐确认。模型完成后，页面同时展示未计潮汐基线、潮汐贡献和最终鱼口环境评分，并说明潮汐来源、涨退阶段、每小时变化速度、距下一高低潮时间以及最佳小时是否改变。

潮汐子评分使用涨退阶段、潮位变化速度和距最近高低潮时间，不把绝对潮高跨站直接比较。潮汐来源可信度单独进入数据可信度与窗口决策，不与鱼口条件混成“概率”。模型失败时保留无潮汐降级评分并明确标记，不生成假潮位。

详细来源、认证、许可、缓存与限制见 [`docs/data-providers.md`](docs/data-providers.md)，真实剩余缺口见 [`docs/remaining-gaps.md`](docs/remaining-gaps.md)。

## 主要流程

登录 → 搜索澳大利亚地址或定位 → 地图点击/拖动 → 保存钓点 → 查看最佳窗口 → 查看官方/EOT20/对比模式 → 选择评分潮汐源 → 查看警告、实况、海域和水文依据 → 设置钓点暴露方向与安全阈值 → 保存详细实钓 → 历史预测对比 → 收藏钓点横向比较。

## 质量命令

```bash
npm run lint
npm test
npm run test:eot20
npm run test:eot20:minimal
npm run test:nsw-tides
npm run test:e2e
npm run build
```

`test:e2e` 使用本机 Chrome/Chromium，覆盖搜索、保存、实钓、历史回读、定位成功/拒绝/超时以及 390×844、430×932 视口。Linux 若 Chrome 不在 `/usr/bin/google-chrome`，设置 `PLAYWRIGHT_EXECUTABLE_PATH`。

## 生产安全

生产环境必须启用 HTTPS，并设置 `COOKIE_SECURE=true`、准确的 `ALLOWED_ORIGIN`、唯一强管理员密码、数据库备份和日志轮换。公共 Photon/OSM 不适合需要 SLA 的商业部署。精确钓点和实钓记录按用户隔离，管理接口需要管理员角色且写请求进行同源校验与限流。
