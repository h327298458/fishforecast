# 使用指南

## 本地运行

```powershell
Copy-Item .env.example .env
npm install
npm run db:migrate
npm run dev
```

打开 `http://localhost:5173`。API 健康检查为 `http://localhost:8787/api/health`，系统状态页为 `http://localhost:5173/system-status`。

## 基本使用流程

1. 搜索澳大利亚地点，或点击地图选择坐标。
2. 拖动标记后确认反向地址，选择钓点类型与钓法并保存。
3. 查看天气、官方参考港潮汐、EOT20 模型及对比模式。
4. 选择用于评分的潮汐来源；来源不可用时该选项会被禁用。
5. 查看官方警告、BOM 实况、海域预报、MHL 外海浮标与适用性说明。
6. 保存实钓记录；装备问题会被单独记录，不会当作环境预测失败。

## 安装 EOT20（可选但推荐）

EOT20 模型文件不会提交到 Git。先安装 Python 依赖，再下载并校验模型：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup-eot20-python.ps1 -Python <Python-3.12-path>
powershell -ExecutionPolicy Bypass -File .\scripts\install-eot20.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\check-eot20.ps1
```

然后在 `.env` 设置 `EOT20_MODEL_PATH`、`EOT20_CACHE_PATH` 和 `EOT20_PYTHON`。未安装时系统会明确显示 EOT20 不可用，不会生成模拟潮汐。

## 官方潮汐数据

```powershell
npm run tides:nsw:download
npm run tides:nsw:import
```

## 测试与 Docker

```powershell
npm test
npm run build
docker compose up --build
```

Docker 使用 named volume 保存 SQLite 数据；本地 EOT20 目录以只读方式挂载到容器。
